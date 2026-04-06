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
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    /\b(\+?91|0)?[6-9]\d{9}\b/,
    /\b(\+\d{1,3}[- ]?)?\(?\d{2,4}\)?[- ]?\d{3,4}[- ]?\d{4}\b/,
    /\b(?:\d[ -]*?){13,16}\b/,
    /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/,
    /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/
  ];
  return patterns.some(p => p.test(text));
}

// ========== Multimodal helpers ==========
function toPlainText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.find(p => p.type === 'text')?.text || '';
  return '';
}

function extractImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(p => p.type === 'image_url').map(p => ({
    mimeType: 'image/jpeg',
    data: p.image_url.url.split(',')[1]
  }));
}

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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

function buildWebSearchPrompt(pages, allImages, query) {
  const sourceContext = pages
    .filter(p => p.text && p.text.length > 50)
    .map(p => `[${p.index}] ${p.title}\nURL: ${p.url}\n${p.text.substring(0, 1500)}`)
    .join('\n\n---\n\n');

  const imageList = allImages.slice(0, 6).map((img, i) =>
    `IMAGE_${i + 1}: src="${img.src}" alt="${img.alt}" from_source=[${img.sourceIndex}]`
  ).join('\n');

  return `You are a helpful AI assistant with access to live web search results.

Answer the user's query using ONLY the sources below. Be detailed and helpful.

CITATION RULES (mandatory):
- Add inline citation numbers like [1], [2] after facts from sources
- End your response with a "📚 Sources:" section:
  [1] Site Name – URL
  [2] Site Name – URL

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

// ========== STRICT FREE MODEL FILTERS ==========

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
  console.log(`📊 Total free models: ${cachedModels.length} (Groq: ${groqModels.length}, OpenRouter: ${openRouterModels.length})`);
  return cachedModels;
}

async function getModels() {
  if (!lastFetchTime || Date.now() - lastFetchTime > CACHE_DURATION || cachedModels.length === 0) {
    await refreshModels();
  }
  return cachedModels;
}

// ========== Routes ==========
app.get('/api/health', async (req, res) => {
  const models = await getModels();
  const rateLimited = [];
  for (const [id, h] of modelHealthMap.entries()) {
    if (Date.now() < h.rateLimitedUntil) rateLimited.push({ id, cooldownSeconds: getModelCooldownSeconds(id) });
  }
  res.json({
    status: 'ok', message: 'Backend is running!',
    timestamp: new Date().toISOString(),
    embedding_mode: EMBEDDING_MODE,
    total_models: models.length,
    available_models: models.filter(m => isModelAvailable(m.id)).length,
    documents: Array.from(documentsByChat.values()).reduce((s, a) => s + a.length, 0),
    last_refresh: lastFetchTime,
    rate_limited_models: rateLimited
  });
});

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

app.post('/api/models/refresh', async (req, res) => {
  try {
    await refreshModels();
    res.json({ success: true, count: cachedModels.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh models' });
  }
});

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
      model: model.id, messages: textOnly, stream: true, max_tokens: 1024
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) res.write(content);
    }
  } else if (model.provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter not configured');
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model: model.id, messages: cleanMessages, stream: true, max_tokens: 1024 },
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

// ========== CHAT STREAMING ENDPOINT ==========
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

  let searchImages = [];

  if (enableSearch) {
    const lastUserMsg = cleanMessages.filter(m => m.role === 'user').pop();
    if (lastUserMsg && typeof lastUserMsg.content === 'string') {
      try {
        const { pages, allImages } = await fullWebSearch(lastUserMsg.content);
        searchImages = allImages.slice(0, 6);
        if (pages.length > 0) {
          cleanMessages = cleanMessages.filter(m => m.role !== 'system');
          cleanMessages.unshift({
            role: 'system',
            content: buildWebSearchPrompt(pages, searchImages, lastUserMsg.content)
          });
        }
      } catch (err) {
        console.error('Web search pipeline error:', err.message);
      }
    }
  }

  for (const msg of cleanMessages) {
    const text = typeof msg.content === 'string' ? msg.content : (msg.content.find?.(p => p.type === 'text')?.text || '');
    if (containsPII(text)) {
      res.write('⚠️ Your message contains personal information. For privacy, we cannot process this request.');
      res.end(); return;
    }
  }

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

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

      console.log(`💬 ${usedFallback ? '[fallback] ' : ''}Trying: ${model.name} (${model.provider})`);
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
      res.write('⏰ All models are currently busy with too many requests. Please wait a moment and try again, or select a different model from the model selector.');
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
        index: p.index,
        title: p.title,
        url: p.url,
        snippet: p.snippet,
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
  loadDocumentsFromDisk();
  const models = await getModels();
  console.log(`🤖 FREE Models loaded: ${models.length} total`);
  console.log(`🔑 Groq:       ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Email:      ${process.env.SMTP_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🌐 Web search: ✅ Full scraping + image extraction enabled`);
  console.log(`🔄 Models refresh every hour\n`);
});
