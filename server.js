require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Groq = require('groq-sdk');
const axios = require('axios');
const cosineSimilarity = require('cosine-similarity');
const { pipeline } = require('@xenova/transformers');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const app = express();

// ========== CORS ==========
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ========== Groq Client ==========
let groq;
try {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('✅ Groq client initialized');
} catch (err) {
  console.warn('⚠️ Groq API key not configured');
}

// ========== Email ==========
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ========== Embeddings ==========
let embedder = null;
const EMBEDDING_MODE = process.env.EMBEDDING_MODE || 'simple';

async function getEmbedding(text) {
  if (EMBEDDING_MODE === 'transformers') {
    if (!embedder) {
      console.log('Loading Transformers.js model...');
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const result = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(result.data);
  } else {
    const vec = new Array(384).fill(0);
    for (let i = 0; i < text.length; i++) vec[i % 384] += text.charCodeAt(i);
    const norm = Math.hypot(...vec);
    return vec.map(v => v / norm);
  }
}

// ========== Per-chat document store ==========
const documentsByChat = new Map();
const BACKUP_FILE = path.join(__dirname, 'documents_backup.json');

function saveDocumentsToDisk() {
  if (process.env.SAVE_DOCUMENTS !== 'true') return;
  const data = {};
  for (const [chatId, docs] of documentsByChat.entries()) {
    data[chatId] = docs.map(d => ({ id: d.id, text: d.text, name: d.name, embedding: d.embedding }));
  }
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
  console.log(`💾 Saved ${documentsByChat.size} chats to disk`);
}

function loadDocumentsFromDisk() {
  if (!fs.existsSync(BACKUP_FILE)) return;
  const data = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  for (const [chatId, docs] of Object.entries(data)) documentsByChat.set(chatId, docs);
  console.log(`📚 Loaded ${documentsByChat.size} chats from backup`);
}

// ========== PII Guardrail ==========
function containsPII(text) {
  const patterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,          // email
    /\b(?:\+91[-\s]?)?[6-9]\d{9}\b/,                                  // Indian mobile only
    /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/,                           // 16-digit card w/ separators
    /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/                                   // PAN
  ];
  return patterns.some(p => p.test(text));
}
// ========== Multimodal helpers ==========
function toPlainText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find(p => p.type === 'text')?.text || '';
  return '';
}

// ========================================================
// ============ CENTRALIZED AGENTIC ARCHITECTURE ==========
// ========================================================
//
//  AgentOrchestrator coordinates specialized agents:
//
//   ┌─────────────────────────────────────────────────┐
//   │            AgentOrchestrator                    │
//   │  Routes requests to the right agent based on    │
//   │  intent classification                          │
//   └────────────┬────────────────────────────────────┘
//                │
//     ┌──────────┼──────────────────┬──────────────────┐
//     ▼          ▼                  ▼                  ▼
//  WebSearch   RAGAgent         CodeAgent         GeneralAgent
//  Agent       (docs context)   (code tasks)      (fallback)
//
// ========================================================

class AgentOrchestrator {
  constructor() {
    this.agents = {
      web_search: new WebSearchAgent(),
      rag:        new RAGAgent(),
      code:       new CodeAgent(),
      general:    new GeneralAgent(),
    };
  }

  /**
   * Classify intent from user message and context flags.
   * Returns one of: 'web_search' | 'rag' | 'code' | 'general'
   */
  classifyIntent(userMessage, enableSearch, hasDocuments) {
    const msg = userMessage.toLowerCase();

    // Explicit web search request
    if (enableSearch) return 'web_search';

    // RAG: documents are loaded
    if (hasDocuments) return 'rag';

    // Code tasks
    const codeKeywords = ['write code', 'debug', 'fix bug', 'python', 'javascript', 'function',
      'class', 'algorithm', 'sql', 'html', 'css', 'typescript', 'api', 'script',
      'program', 'implement', 'refactor', 'unit test', 'compile', 'syntax'];
    if (codeKeywords.some(k => msg.includes(k))) return 'code';

    // Web search triggers — current events, facts, real-time
    const webKeywords = ['latest', 'recent', 'today', 'news', 'current', '2024', '2025', '2026',
      'what is the price', 'stock', 'weather', 'who won', 'search', 'look up',
      'find information', 'real-time'];
    if (webKeywords.some(k => msg.includes(k))) return 'web_search';

    return 'general';
  }

  /**
   * Main entry point — builds the system prompt for the right agent.
   */
  async buildSystemPrompt(userMessage, enableSearch, hasDocuments, ragContext = '') {
    const intent = this.classifyIntent(userMessage, enableSearch, hasDocuments);
    console.log(`🤖 AgentOrchestrator → routing to: ${intent.toUpperCase()} agent`);

    const agent = this.agents[intent];
    return {
      intent,
      systemPrompt: agent.buildSystemPrompt(ragContext),
      agentName: agent.name
    };
  }
}

// ─── Base Agent ───
class BaseAgent {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }
  buildSystemPrompt(context = '') {
    return `You are a helpful AI assistant named Pickmo.ai.`;
  }
}

// ─── General Agent ───
class GeneralAgent extends BaseAgent {
  constructor() {
    super('GeneralAgent', 'Handles everyday conversation, reasoning, and Q&A');
  }
  buildSystemPrompt() {
    return `You are Pickmo.ai — a friendly, intelligent AI assistant.
- Be concise, helpful, and conversational.
- Use markdown formatting where helpful (code blocks, bullet lists, bold text).
- If the user asks something that requires real-time data, suggest enabling Web Search.
- Be honest when you're uncertain about something.
- Responsible AI: do not provide harmful, misleading, or dangerous information.`;
  }
}

// ─── Code Agent ───
class CodeAgent extends BaseAgent {
  constructor() {
    super('CodeAgent', 'Specializes in code writing, debugging, and explanation');
  }
  buildSystemPrompt() {
    return `You are Pickmo.ai — an expert software engineer and code assistant.
- Always wrap code in fenced code blocks with the correct language tag (e.g. \`\`\`python).
- Explain what the code does step by step.
- When debugging, explain the root cause and provide a fixed version.
- Follow best practices: clean code, comments, error handling.
- If multiple languages/approaches exist, briefly compare them.
- Responsible AI: do not help with malicious code, exploits, or security attacks.`;
  }
}

// ─── RAG Agent ───
class RAGAgent extends BaseAgent {
  constructor() {
    super('RAGAgent', 'Answers questions based on uploaded documents');
  }
  buildSystemPrompt(ragContext = '') {
    return `You are Pickmo.ai — a document analysis assistant.
The user has uploaded documents. Use ONLY the context below to answer their question.
If the answer is not found in the documents, say so clearly.

DOCUMENT CONTEXT:
${ragContext}

Rules:
- Always cite which document your answer came from, using [Doc: filename] format.
- Do not make up information not present in the documents.
- If asked something outside the documents, say: "I can only answer based on the uploaded documents."
- Responsible AI: summarize fairly and do not misrepresent document content.`;
  }
}

// ─── Web Search Agent ───
class WebSearchAgent extends BaseAgent {
  constructor() {
    super('WebSearchAgent', 'Searches the web and provides cited, sourced answers');
  }
  buildSystemPrompt(webContext = '') {
    return webContext; // Populated dynamically after fetching search results
  }
}

// ========== MCP Tool Registry ==========
// MCP = Model Context Protocol — a structured way to define "tools" the AI can reference.
// Each tool has a name, description, and input schema.
// This registry is surfaced at /api/mcp/tools for the frontend to display.

const MCP_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for real-time information, news, prices, and current events.',
    inputSchema: { query: 'string (the search query)' },
    icon: '🌐',
    category: 'Search'
  },
  {
    name: 'document_analysis',
    description: 'Analyze uploaded documents (PDF, TXT, DOCX) and answer questions about them.',
    inputSchema: { chatId: 'string', query: 'string' },
    icon: '📄',
    category: 'Documents'
  },
  {
    name: 'code_assist',
    description: 'Write, debug, and explain code in any programming language.',
    inputSchema: { language: 'string', task: 'string' },
    icon: '💻',
    category: 'Code'
  },
  {
    name: 'summarize',
    description: 'Summarize long text, articles, or documents concisely.',
    inputSchema: { content: 'string', length: 'short|medium|detailed' },
    icon: '📝',
    category: 'Text'
  },
  {
    name: 'translate',
    description: 'Translate text between languages.',
    inputSchema: { text: 'string', targetLanguage: 'string' },
    icon: '🌍',
    category: 'Language'
  },
  {
    name: 'explain',
    description: 'Explain complex concepts in simple terms.',
    inputSchema: { concept: 'string', level: 'beginner|intermediate|expert' },
    icon: '🎓',
    category: 'Learning'
  }
];

// Singleton orchestrator
const orchestrator = new AgentOrchestrator();

// ========== WEB SEARCH + SCRAPE + IMAGE EXTRACTION ==========

const BLOCKED_DOMAINS = [
  'reddit.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'tiktok.com', 'quora.com',
  'nytimes.com', 'wsj.com', 'ft.com', 'bloomberg.com'
];

function isBlockedDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return BLOCKED_DOMAINS.some(d => hostname.includes(d));
  } catch { return true; }
}

function resolveDDGUrl(rawHref) {
  try {
    if (rawHref.startsWith('//duckduckgo.com/l/?')) {
      const params = new URLSearchParams(rawHref.replace('//duckduckgo.com/l/?', ''));
      const uddg = params.get('uddg');
      if (uddg) return decodeURIComponent(uddg);
    }
    if (rawHref.startsWith('http')) return rawHref;
  } catch {}
  return null;
}

async function searchDuckDuckGo(query, maxResults = 5) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    const $ = cheerio.load(response.data);
    const results = [];
    $('.result').each((_, el) => {
      if (results.length >= maxResults) return false;
      const titleEl = $(el).find('.result__a');
      const snippetEl = $(el).find('.result__snippet');
      const title = titleEl.text().trim();
      const rawHref = titleEl.attr('href') || '';
      const snippet = snippetEl.text().trim();
      const resolvedUrl = resolveDDGUrl(rawHref);
      if (title && resolvedUrl && resolvedUrl.startsWith('http')) {
        results.push({ title, url: resolvedUrl, snippet });
      }
    });
    console.log(`🔍 DDG found ${results.length} results for: "${query}"`);
    return results;
  } catch (err) {
    console.error('DuckDuckGo search error:', err.message);
    return [];
  }
}

async function scrapeURL(url) {
  if (isBlockedDomain(url)) return { text: '', images: [] };
  try {
    const response = await axios.get(url, {
      timeout: 6000,
      maxContentLength: 500000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    const $ = cheerio.load(response.data);
    $('script, style, nav, footer, header, aside, .ad, .ads, .advertisement, .cookie, .popup, .modal, iframe, noscript').remove();

    let text = '';
    for (const selector of ['article', 'main', '[role="main"]', '.content', '.post-content', '.article-body', 'body']) {
      const el = $(selector).first();
      if (el.length) {
        text = el.text().replace(/\s+/g, ' ').trim();
        if (text.length > 200) break;
      }
    }
    text = text.substring(0, 4000);

    const baseUrl = new URL(url).origin;
    const images = [];
    const seenSrcs = new Set();
    $('img').each((_, el) => {
      if (images.length >= 4) return false;
      let src = $(el).attr('src') || $(el).attr('data-src') || '';
      const alt = $(el).attr('alt') || '';
      const width = parseInt($(el).attr('width') || '0');
      const height = parseInt($(el).attr('height') || '0');
      if (src.startsWith('//')) src = 'https:' + src;
      else if (src.startsWith('/')) src = baseUrl + src;
      if (!src.startsWith('http')) return;
      if (width > 0 && width < 100) return;
      if (height > 0 && height < 100) return;
      if (/icon|logo|avatar|sprite/i.test(src)) return;
      if (src.includes('data:image') || src.endsWith('.svg')) return;
      if (seenSrcs.has(src)) return;
      seenSrcs.add(src);
      images.push({ src, alt: alt.substring(0, 120) });
    });

    return { text, images };
  } catch (err) {
    console.log(`⚠️ Could not scrape ${url}: ${err.message}`);
    return { text: '', images: [] };
  }
}

async function fullWebSearch(query) {
  const searchResults = await searchDuckDuckGo(query, 5);
  if (!searchResults.length) return { pages: [], allImages: [] };

  const pages = await Promise.all(searchResults.map(async (result, i) => {
    const scraped = await scrapeURL(result.url);
    return {
      index: i + 1,
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      text: scraped.text.length > 100 ? scraped.text : result.snippet,
      images: scraped.images
    };
  }));

  const allImages = [];
  for (const page of pages) {
    for (const img of page.images) {
      allImages.push({
        src: img.src,
        alt: img.alt || page.title,
        sourceName: page.title,
        sourceUrl: page.url,
        sourceIndex: page.index
      });
    }
  }

  console.log(`✅ Scraped ${pages.length} pages, ${allImages.length} images found`);
  return { pages, allImages };
}

/**
 * Build a system prompt for the WebSearchAgent.
 * Includes MANDATORY source citation rules for Responsible AI.
 */
function buildWebSearchPrompt(pages, allImages, query) {
  const sourceContext = pages
    .filter(p => p.text && p.text.length > 50)
    .map(p => `[${p.index}] ${p.title}\nURL: ${p.url}\n${p.text.substring(0, 1500)}`)
    .join('\n\n---\n\n');

  const imageList = allImages.slice(0, 6).map((img, i) =>
    `IMAGE_${i + 1}: src="${img.src}" alt="${img.alt}" from_source=[${img.sourceIndex}]`
  ).join('\n');

  return `You are Pickmo.ai — a helpful AI assistant with real-time web search capability.

Answer the user's query using the web sources below. Be detailed, helpful, and accurate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSIBLE AI — MANDATORY CITATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Add inline citation numbers like [1], [2] after each fact from sources.
2. End your response with a "📚 **Sources:**" section listing all sources used:
   [1] Site Name – https://url-here
   [2] Site Name – https://url-here
3. If information is NOT in the sources, say "I could not find this in the current sources."
4. Never fabricate facts or URLs. Only cite sources that actually appeared.
5. Indicate the date range of sources if relevant (e.g., "As of early 2025...").

IMAGE RULES:
- Include relevant images using this exact format on its own line:
  <!--IMAGE:IMAGE_URL|ALT_TEXT|SOURCE_NAME-->
- Only include images genuinely relevant to the query (max 3)
- Never include logos, icons, or unrelated images

SOURCES:
${sourceContext}

AVAILABLE IMAGES:
${imageList || 'No images found'}

USER QUERY: "${query}"`;
}

// ========== MODEL HEALTH TRACKER ==========
const modelHealthMap = new Map();
const BASE_COOLDOWN_MS = 60 * 1000;

function markModelRateLimited(modelId) {
  const existing = modelHealthMap.get(modelId) || { failCount: 0 };
  const failCount = existing.failCount + 1;
  const cooldown = Math.min(BASE_COOLDOWN_MS * Math.pow(2, failCount - 1), 10 * 60 * 1000);
  modelHealthMap.set(modelId, { rateLimitedUntil: Date.now() + cooldown, failCount });
  console.log(`🚫 ${modelId} rate-limited for ${cooldown / 1000}s (fail #${failCount})`);
}

function markModelHealthy(modelId) {
  if (modelHealthMap.has(modelId)) {
    modelHealthMap.delete(modelId);
    console.log(`✅ ${modelId} back to healthy`);
  }
}

function isModelAvailable(modelId) {
  const health = modelHealthMap.get(modelId);
  if (!health) return true;
  return Date.now() > health.rateLimitedUntil;
}

function getModelCooldownSeconds(modelId) {
  const health = modelHealthMap.get(modelId);
  if (!health) return 0;
  const remaining = health.rateLimitedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// ========== FREE MODEL FILTERS ==========
const GROQ_FREE_PATTERNS = [
  /^llama/i, /^meta-llama/i, /^mixtral/i, /^gemma/i,
  /^qwen/i, /^deepseek/i, /^mistral/i, /^moonshotai/i,
  /^compound/i, /^playai/i
];

const GROQ_EXCLUDED_IDS = [
  'whisper-large-v3', 'whisper-large-v3-turbo', 'distil-whisper-large-v3-en',
  'llama-guard-3-8b', 'llama3-groq-8b-8192-tool-use-preview',
  'llama3-groq-70b-8192-tool-use-preview'
];

function isGroqModelFree(modelId) {
  if (GROQ_EXCLUDED_IDS.includes(modelId)) return false;
  return GROQ_FREE_PATTERNS.some(p => p.test(modelId));
}

function isOpenRouterModelFree(model) {
  if (model.id.includes(':free')) return true;
  if (model.pricing) {
    const prompt = parseFloat(model.pricing.prompt);
    const completion = parseFloat(model.pricing.completion);
    if (!isNaN(prompt) && !isNaN(completion) && prompt === 0 && completion === 0) return true;
  }
  return false;
}

// ========== Dynamic model fetching ==========
let cachedModels = [];
let lastFetchTime = null;
const CACHE_DURATION = 60 * 60 * 1000;

async function fetchGroqModels() {
  if (!groq) return [];
  try {
    const response = await groq.models.list();
    const all = response.data || [];
    const free = all
      .filter(m => (m.active === true || m.active === undefined) && isGroqModelFree(m.id))
      .map(m => ({
        id: m.id, name: formatModelName(m.id), provider: 'groq',
        context: m.context_window || 8192, free: true
      }));
    console.log(`   Groq: ${free.length} free (from ${all.length} total)`);
    return free;
  } catch (err) {
    console.error('Failed to fetch Groq models:', err.message);
    return [];
  }
}

async function fetchOpenRouterModels() {
  if (!process.env.OPENROUTER_API_KEY) return [];
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://pickmo.ai', 'X-Title': 'Pickmo.ai'
      }
    });
    const all = response.data.data || [];
    const free = all.filter(m => {
      const isText = !m.modality || m.modality === 'text' || m.modality === 'multimodal';
      return isText && isOpenRouterModelFree(m);
    });
    console.log(`   OpenRouter: ${free.length} free (from ${all.length} total)`);
    return free.map(m => ({
      id: m.id, name: formatModelName(m.id), provider: 'openrouter',
      context: m.context_length || 8192, free: true,
      type: (m.id.includes('gemini') || m.id.includes('nemotron-nano-12b-vl')) ? 'vision' : undefined
    }));
  } catch (err) {
    console.error('Failed to fetch OpenRouter models:', err.message);
    return [];
  }
}

function formatModelName(modelId) {
  let name = modelId
    .replace(':free', '').replace('-instruct', '').replace('-preview', '')
    .replace('-versatile', '').replace('-instant', '').replace('-chat', '');
  const parts = name.split('/');
  name = parts[parts.length - 1].replace(/[_-]/g, ' ');
  name = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  if (/^(llama|meta-llama|mixtral|qwen|deepseek|gemma|mistral|moonshotai)/i.test(modelId)) name += ' (Groq)';
  else if (modelId.includes(':')) name += ' (Free)';
  return name;
}

async function refreshModels() {
  console.log('🔄 Fetching FREE models from providers...');
  const [groqModels, openRouterModels] = await Promise.all([
    fetchGroqModels(), fetchOpenRouterModels()
  ]);
  const all = [...groqModels, ...openRouterModels];
  const unique = Array.from(new Map(all.map(m => [m.id, m])).values());
  unique.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  cachedModels = unique;
  lastFetchTime = Date.now();
  console.log(`📊 Total free models: ${cachedModels.length}`);
  return cachedModels;
}

async function getModels() {
  if (!lastFetchTime || Date.now() - lastFetchTime > CACHE_DURATION || cachedModels.length === 0) {
    await refreshModels();
  }
  return cachedModels;
}

// ========== Routes ==========

// Health check
app.get('/api/health', async (req, res) => {
  const models = await getModels();
  const rateLimited = [];
  for (const [id, h] of modelHealthMap.entries()) {
    if (Date.now() < h.rateLimitedUntil) rateLimited.push({ id, cooldownSeconds: getModelCooldownSeconds(id) });
  }
  res.json({
    status: 'ok', message: 'Pickmo.ai Backend is running!',
    timestamp: new Date().toISOString(),
    embedding_mode: EMBEDDING_MODE,
    total_models: models.length,
    available_models: models.filter(m => isModelAvailable(m.id)).length,
    agents: Object.keys(orchestrator.agents),
    mcp_tools: MCP_TOOLS.length,
    documents: Array.from(documentsByChat.values()).reduce((s, a) => s + a.length, 0),
    last_refresh: lastFetchTime,
    rate_limited_models: rateLimited
  });
});

// Models list
app.get('/api/models', async (req, res) => {
  try {
    const models = await getModels();
    res.json(models.map(m => ({
      ...m,
      available: isModelAvailable(m.id),
      cooldownSeconds: getModelCooldownSeconds(m.id)
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Refresh models
app.post('/api/models/refresh', async (req, res) => {
  try {
    await refreshModels();
    res.json({ success: true, count: cachedModels.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh models' });
  }
});

// ─── MCP Tools endpoint ───
app.get('/api/mcp/tools', (req, res) => {
  res.json({
    protocol: 'MCP v1.0',
    description: 'Pickmo.ai Model Context Protocol — available tools the AI can use',
    tools: MCP_TOOLS
  });
});

// ─── Agent status endpoint ───
app.get('/api/agents', (req, res) => {
  res.json({
    orchestrator: 'AgentOrchestrator',
    agents: Object.entries(orchestrator.agents).map(([key, agent]) => ({
      id: key,
      name: agent.name,
      description: agent.description
    }))
  });
});

// Chat title generation
app.post('/api/chat/title', async (req, res) => {
  const { message, modelId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try {
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groqClient.chat.completions.create({
      model: modelId || 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: 'Generate a very short title (3-5 words) for this user message. Return ONLY the title, no extra text, no quotes.' },
        { role: 'user', content: message }
      ],
      temperature: 0.5, max_tokens: 20
    });
    res.json({ title: completion.choices[0].message.content.trim().substring(0, 40) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate title' });
  }
});

// ========== RAG Endpoints ==========
app.post('/api/rag/upload', async (req, res) => {
  const { text, name, chatId } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  try {
    const embedding = await getEmbedding(text);
    const doc = { id: Date.now(), text: text.substring(0, 2000), name: name || 'Unnamed document', embedding };
    if (!documentsByChat.has(chatId)) documentsByChat.set(chatId, []);
    documentsByChat.get(chatId).push(doc);
    if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
    res.json({ success: true, count: documentsByChat.get(chatId).length });
  } catch (err) {
    res.status(500).json({ error: 'Embedding failed' });
  }
});

app.post('/api/rag/search', async (req, res) => {
  const { query, chatId } = req.body;
  if (!query) return res.json([]);
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  const docs = documentsByChat.get(chatId) || [];
  if (!docs.length) return res.json([]);
  try {
    const queryEmbed = await getEmbedding(query);
    const scored = docs.map(d => ({ ...d, score: cosineSimilarity(queryEmbed, d.embedding) }));
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 3));
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/rag/documents/:chatId', (req, res) => {
  const docs = documentsByChat.get(req.params.chatId) || [];
  res.json(docs.map(d => ({ id: d.id, name: d.name, text: d.text.substring(0, 100) })));
});

app.delete('/api/rag/document/:chatId/:docId', (req, res) => {
  const { chatId, docId } = req.params;
  const docs = documentsByChat.get(chatId);
  if (!docs) return res.status(404).json({ error: 'Chat not found' });
  documentsByChat.set(chatId, docs.filter(d => d.id !== parseInt(docId)));
  if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
  res.json({ success: true });
});

app.delete('/api/rag/delete/:chatId', (req, res) => {
  if (documentsByChat.has(req.params.chatId)) {
    documentsByChat.delete(req.params.chatId);
    if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
  }
  res.json({ success: true });
});

// ========== CORE STREAM FUNCTION ==========
async function streamFromModel(model, cleanMessages, res) {
  if (model.provider === 'groq') {
    if (!groq) throw new Error('Groq not configured');
    const textOnly = cleanMessages.map(m => ({ role: m.role, content: toPlainText(m.content) }));
    const stream = await groq.chat.completions.create({
      model: model.id, messages: textOnly, stream: true, max_tokens: 2048
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) res.write(content);
    }
  } else if (model.provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter not configured');
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model: model.id, messages: cleanMessages, stream: true, max_tokens: 2048 },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://pickmo.ai', 'X-Title': 'Pickmo.ai'
        },
        responseType: 'stream', timeout: 60000
      }
    );
    await new Promise((resolve, reject) => {
      response.data.on('data', chunk => {
        for (const line of chunk.toString().split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices[0]?.delta?.content || '';
              if (content) res.write(content);
            } catch {}
          }
        }
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });
  } else {
    throw new Error(`Unsupported provider: ${model.provider}`);
  }
}

// ========== CHAT STREAMING ENDPOINT (with Agentic routing) ==========
app.post('/api/chat/stream', async (req, res) => {
  const { modelId, messages, enableSearch = false } = req.body;

  if (!modelId) return res.status(400).json({ error: 'Model ID required' });
  if (!messages || !Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'Messages array required' });

  const availableModels = await getModels();
  const requestedModel = availableModels.find(m => m.id === modelId);
  if (!requestedModel) return res.status(400).json({ error: 'Invalid model: ' + modelId });
  if (!requestedModel.free) return res.status(403).json({ error: 'This model requires payment.' });

  let cleanMessages = messages
    .filter(m => m && (typeof m.content === 'string' || Array.isArray(m.content)) && m.content.length > 0)
    .map(m => ({ role: m.role, content: m.content }));

  if (!cleanMessages.length) { res.write('Please start a new conversation.'); res.end(); return; }
  if (cleanMessages[cleanMessages.length - 1].role !== 'user') { res.write("I'm waiting for your message."); res.end(); return; }

  // PII check
  for (const msg of cleanMessages) {
    const text = typeof msg.content === 'string' ? msg.content : (msg.content.find?.(p => p.type === 'text')?.text || '');
    // PII check — only on the NEW user message, not full history
const latestUserMsg = cleanMessages[cleanMessages.length - 1];
const latestText = typeof latestUserMsg.content === 'string'
  ? latestUserMsg.content
  : (latestUserMsg.content.find?.(p => p.type === 'text')?.text || '');

if (containsPII(latestText)) {
  res.write('⚠️ Your message contains personal information. For privacy, we cannot process this request.');
  res.end(); return;
}
  }

  let searchImages = [];
  const lastUserMsg = cleanMessages.filter(m => m.role === 'user').pop();
  const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : toPlainText(lastUserMsg?.content);

  // Check if chat has documents
  const chatId = req.body.chatId;
  const hasDocuments = chatId && (documentsByChat.get(chatId) || []).length > 0;

  // ─── Agentic routing via orchestrator ───
  let ragContext = '';
  if (hasDocuments && chatId) {
    try {
      const queryEmbed = await getEmbedding(userText);
      const docs = documentsByChat.get(chatId) || [];
      const scored = docs.map(d => ({ ...d, score: cosineSimilarity(queryEmbed, d.embedding) }));
      scored.sort((a, b) => b.score - a.score);
      ragContext = scored.slice(0, 3).map(d => `[Doc: ${d.name}]\n${d.text}`).join('\n\n---\n\n');
    } catch {}
  }

  const { intent, systemPrompt, agentName } = await orchestrator.buildSystemPrompt(
    userText, enableSearch, hasDocuments, ragContext
  );

  // For web search agent, fetch real data first
  let finalSystemPrompt = systemPrompt;
  if (intent === 'web_search') {
  try {
    const { pages, allImages } = await fullWebSearch(userText);
    searchImages = allImages.slice(0, 6);
    if (pages.length > 0) {
      finalSystemPrompt = buildWebSearchPrompt(pages, searchImages, userText);
    } else {
      finalSystemPrompt = orchestrator.agents.general.buildSystemPrompt() +
        '\n\nNOTE: Web search was attempted but returned no results (search provider may be rate-limiting). Tell the user web search is temporarily unavailable and answer from your own knowledge instead.';
    }
  } catch (err) {
    console.error('Web search pipeline error:', err.message);
    finalSystemPrompt = orchestrator.agents.general.buildSystemPrompt() +
      '\n\nNOTE: Web search failed due to an error. Tell the user web search is temporarily unavailable.';
  }
}

  // Inject agent system prompt (remove any existing system messages first)
  cleanMessages = cleanMessages.filter(m => m.role !== 'system');
  cleanMessages.unshift({ role: 'system', content: finalSystemPrompt });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  // Send agent info as first metadata line (parsed by frontend)
  res.write(`<!--AGENT:${agentName}-->`);

  const MAX_ATTEMPTS = 3;
  const sameProv = availableModels.filter(m =>
    m.id !== requestedModel.id && m.free && m.provider === requestedModel.provider && isModelAvailable(m.id)
  );
  const otherProv = availableModels.filter(m =>
    m.free && m.provider !== requestedModel.provider && isModelAvailable(m.id)
  );

  const attemptQueue = [requestedModel, ...sameProv, ...otherProv].slice(0, MAX_ATTEMPTS);

  let succeeded = false;
  let usedFallback = false;
  let lastError = null;

  for (const model of attemptQueue) {
    if (!isModelAvailable(model.id)) {
      console.log(`⏭️ Skipping ${model.id} — in cooldown (${getModelCooldownSeconds(model.id)}s left)`);
      continue;
    }

    try {
      if (usedFallback) {
        res.write(`\n⚡ *Switched to ${model.name} (previous model is temporarily busy)*\n\n`);
      }

      console.log(`💬 [${agentName}] ${usedFallback ? '[fallback] ' : ''}Trying: ${model.name} (${model.provider})`);
      await streamFromModel(model, cleanMessages, res);

      markModelHealthy(model.id);
      succeeded = true;
      break;

    } catch (err) {
      lastError = err;
      const status = err.status || err.response?.status;
      if (status === 429) {
        markModelRateLimited(model.id);
        console.warn(`⚠️ 429 on ${model.id} — trying next model`);
        usedFallback = true;
      } else if (status === 401) {
        res.write('❌ Invalid API key. Please check your configuration.');
        res.end(); return;
      } else {
        console.error(`❌ Error on ${model.id}:`, err.message);
        usedFallback = true;
      }
    }
  }

  if (!succeeded) {
    const status = lastError?.status || lastError?.response?.status;
    if (status === 429) {
      res.write('⏰ All models are currently busy. Please wait a moment and try again, or select a different model.');
    } else {
      res.write('❌ Unable to get a response right now. Please try again or switch models.');
    }
  }

  if (enableSearch && searchImages.length > 0) {
    const payload = JSON.stringify(searchImages);
    res.write(`\n\n<!--SEARCH_IMAGES_JSON:${payload}-->`);
  }

  res.end();
});

// ========== Standalone Search Endpoint ==========
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });
  try {
    const { pages, allImages } = await fullWebSearch(query);
    res.json({
      pages: pages.map(p => ({
        index: p.index, title: p.title, url: p.url, snippet: p.snippet,
        hasFullContent: p.text.length > 100
      })),
      images: allImages.slice(0, 8)
    });
  } catch (err) {
    console.error('Search endpoint error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ========== Feedback ==========
app.post('/api/feedback', async (req, res) => {
  const { type, message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.FEEDBACK_EMAIL || 'admin@pickmo.ai',
      subject: `Pickmo.ai ${type}`, text: message,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Email failed' });
  }
});

// ========== Start server ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n✅ Pickmo.ai Backend running on port ${PORT}`);
  console.log(`📊 Embedding mode: ${EMBEDDING_MODE}`);
  console.log(`🤖 Agents: ${Object.keys(orchestrator.agents).join(', ')}`);
  console.log(`🔧 MCP Tools: ${MCP_TOOLS.length} registered`);
  loadDocumentsFromDisk();
  const models = await getModels();
  console.log(`🤖 FREE Models loaded: ${models.length} total`);
  console.log(`🔑 Groq:       ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Email:      ${process.env.SMTP_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🌐 Web search: ✅ Full scraping + image extraction + citation enabled`);
  console.log(`🔄 Models refresh every hour\n`);
});
