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
const { GoogleGenAI } = require("@google/genai");

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

// ========== Groq client ==========
let groq;
try {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('✅ Groq client initialized');
} catch (err) {
  console.warn('⚠️ Groq API key not configured');
}

// ========== Google Gemini client ==========
let googleAi;
try {
  if (process.env.GOOGLE_API_KEY) {
    googleAi = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    console.log('✅ Google Gemini client initialized');
  }
} catch (err) {
  console.warn('⚠️ Google Gemini API key not configured');
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
    for (let i = 0; i < text.length; i++) {
      vec[i % 384] += text.charCodeAt(i);
    }
    const norm = Math.hypot(...vec);
    return vec.map(v => v / norm);
  }
}

// ========== Per‑chat document store ==========
const documentsByChat = new Map();
const BACKUP_FILE = path.join(__dirname, 'documents_backup.json');

function saveDocumentsToDisk() {
  if (process.env.SAVE_DOCUMENTS !== 'true') return;
  const data = {};
  for (const [chatId, docs] of documentsByChat.entries()) {
    data[chatId] = docs.map(doc => ({
      id: doc.id,
      text: doc.text,
      name: doc.name,
      embedding: doc.embedding
    }));
  }
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(data, null, 2));
  console.log(`💾 Saved ${documentsByChat.size} chats to disk`);
}

function loadDocumentsFromDisk() {
  if (!fs.existsSync(BACKUP_FILE)) return;
  const data = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  for (const [chatId, docs] of Object.entries(data)) {
    documentsByChat.set(chatId, docs);
  }
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
  return patterns.some(pattern => pattern.test(text));
}

// ========== Multimodal helper ==========
function toPlainText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textPart = content.find(p => p.type === 'text');
    return textPart?.text || '';
  }
  return '';
}

// Extract base64 image from multimodal content (for Google)
function extractImages(content) {
  if (!Array.isArray(content)) return [];
  return content.filter(part => part.type === 'image_url').map(part => ({
    mimeType: 'image/jpeg', // default, could be improved by checking data URI
    data: part.image_url.url.split(',')[1] // remove data:image/...;base64,
  }));
}

// ========== Dynamic model fetching ==========
let cachedModels = [];
let lastFetchTime = null;
const CACHE_DURATION = 60 * 60 * 1000;

async function fetchGroqModels() {
  if (!groq) return [];
  try {
    const response = await groq.models.list();
    const models = response.data || [];
    return models
      .filter(model => model.active === true || model.active === undefined)
      .map(model => ({
        id: model.id,
        name: formatModelName(model.id),
        provider: 'groq',
        context: model.context_window || 8192,
        available: true,
        free: true
      }));
  } catch (err) {
    console.error('Failed to fetch Groq models:', err.message);
    return [];
  }
}

function isModelFree(model) {
  if (model.id.includes(':free')) return true;
  if (model.pricing && model.pricing.prompt === 0) return true;
  if (model.description && model.description.toLowerCase().includes('free')) return true;
  return false;
}

async function fetchOpenRouterModels() {
  if (!process.env.OPENROUTER_API_KEY) return [];
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://pickmo.ai',
        'X-Title': 'Pickmo.ai'
      }
    });
    const models = response.data.data || [];
    const freeModels = models.filter(model => {
      const isTextOrMultimodal = !model.modality || model.modality === 'text' || model.modality === 'multimodal';
      const isFree = isModelFree(model);
      return isTextOrMultimodal && isFree;
    });
    console.log(`   Found ${freeModels.length} free models out of ${models.length} total`);
    return freeModels.map(model => ({
      id: model.id,
      name: formatModelName(model.id),
      provider: 'openrouter',
      context: model.context_length || 8192,
      available: true,
      free: true,
      type: (model.id.includes('gemini') || model.id.includes('nemotron-nano-12b-vl') || model.id.includes('step-1.5v')) ? 'vision' : undefined
    }));
  } catch (err) {
    console.error('Failed to fetch OpenRouter models:', err.message);
    return [];
  }
}

async function fetchGoogleModels() {
  if (!googleAi) return [];
  // List of free Gemini models (text and multimodal)
  const freeModels = [
    {
      id: "gemini-2.0-flash",
      name: "Gemini 2.0 Flash (Fast & Free)",
      provider: "google",
      context: 1048576,
      free: true,
      type: "vision"
    },
    // You can add more free models here (e.g., "gemini-1.5-flash")
  ];
  return freeModels;
}

function formatModelName(modelId) {
  let name = modelId
    .replace(':free', '')
    .replace('-instruct', '')
    .replace('-preview', '')
    .replace('-versatile', '')
    .replace('-instant', '')
    .replace('-chat', '');
  const parts = name.split('/');
  name = parts[parts.length - 1];
  name = name.replace(/[_-]/g, ' ');
  name = name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  if (modelId.includes('groq') || modelId.startsWith('llama') || modelId.startsWith('mixtral') || modelId.startsWith('qwen') || modelId.startsWith('deepseek')) {
    name = name + ' (Groq)';
  } else if (modelId.includes('openrouter') || modelId.includes(':')) {
    name = name + ' (Free)';
  } else if (modelId.startsWith('gemini')) {
    name = name + ' (Google)';
  }
  return name;
}

async function refreshModels() {
  console.log('🔄 Fetching available FREE models from providers...');
  const [groqModels, openRouterModels, googleModels] = await Promise.all([
    fetchGroqModels(),
    fetchOpenRouterModels(),
    fetchGoogleModels()
  ]);
  const allModels = [...groqModels, ...openRouterModels, ...googleModels];
  const uniqueModels = Array.from(new Map(allModels.map(model => [model.id, model])).values());
  uniqueModels.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return a.name.localeCompare(b.name);
  });
  cachedModels = uniqueModels;
  lastFetchTime = Date.now();
  console.log(`📊 FREE Models fetched: ${cachedModels.length} total`);
  console.log(`   - Groq: ${groqModels.length} free models`);
  console.log(`   - OpenRouter: ${openRouterModels.length} free models`);
  console.log(`   - Google: ${googleModels.length} free models`);
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
  res.json({ status: 'ok', message: 'Backend is running!', timestamp: new Date().toISOString(), embedding_mode: EMBEDDING_MODE, total_models: models.length, documents: Array.from(documentsByChat.values()).reduce((sum, arr) => sum + arr.length, 0), last_refresh: lastFetchTime });
});

app.get('/api/models', async (req, res) => {
  try {
    const models = await getModels();
    res.json(models);
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

app.get('/api/models/:modelId', async (req, res) => {
  try {
    const models = await getModels();
    const model = models.find(m => m.id === req.params.modelId);
    if (!model) return res.status(404).json({ error: 'Model not found' });
    res.json(model);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

app.post('/api/models/refresh', async (req, res) => {
  try {
    await refreshModels();
    res.json({ success: true, count: cachedModels.length, models: cachedModels });
  } catch (err) {
    console.error('Error refreshing models:', err);
    res.status(500).json({ error: 'Failed to refresh models' });
  }
});

// ========== RAG Endpoints (per‑chat) ==========
app.post('/api/rag/upload', async (req, res) => {
  const { text, name, chatId } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  try {
    const embedding = await getEmbedding(text);
    const doc = {
      id: Date.now(),
      text: text.substring(0, 2000),
      name: name || 'Unnamed document',
      embedding
    };
    if (!documentsByChat.has(chatId)) {
      documentsByChat.set(chatId, []);
    }
    documentsByChat.get(chatId).push(doc);
    if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
    console.log(`📄 Document indexed for chat ${chatId}: ${name}`);
    res.json({ success: true, count: documentsByChat.get(chatId).length });
  } catch (err) {
    console.error('Embedding error:', err);
    res.status(500).json({ error: 'Embedding failed' });
  }
});

app.post('/api/rag/search', async (req, res) => {
  const { query, chatId } = req.body;
  if (!query) return res.json([]);
  if (!chatId) return res.status(400).json({ error: 'chatId required' });

  const docs = documentsByChat.get(chatId) || [];
  if (docs.length === 0) return res.json([]);

  try {
    const queryEmbed = await getEmbedding(query);
    const scored = docs.map(doc => ({
      id: doc.id,
      text: doc.text,
      name: doc.name,
      score: cosineSimilarity(queryEmbed, doc.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    res.json(scored.slice(0, 3));
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.get('/api/rag/documents/:chatId', (req, res) => {
  const { chatId } = req.params;
  const docs = documentsByChat.get(chatId) || [];
  const safeDocs = docs.map(doc => ({ id: doc.id, name: doc.name, text: doc.text.substring(0, 100) }));
  res.json(safeDocs);
});

app.delete('/api/rag/document/:chatId/:docId', (req, res) => {
  const { chatId, docId } = req.params;
  const docs = documentsByChat.get(chatId);
  if (docs) {
    const filtered = docs.filter(d => d.id !== parseInt(docId));
    documentsByChat.set(chatId, filtered);
    if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Chat not found' });
  }
});

app.delete('/api/rag/delete/:chatId', async (req, res) => {
  const { chatId } = req.params;
  if (!chatId) return res.status(400).json({ error: 'chatId required' });
  if (documentsByChat.has(chatId)) {
    documentsByChat.delete(chatId);
    if (process.env.SAVE_DOCUMENTS === 'true') saveDocumentsToDisk();
    console.log(`🗑️ Cleared all documents for chat ${chatId}`);
  }
  res.json({ success: true });
});

// ========== CHAT STREAMING ENDPOINT ==========
app.post('/api/chat/stream', async (req, res) => {
  const { modelId, messages } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'Model ID required' });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array required' });
  }

  const availableModels = await getModels();
  const model = availableModels.find(m => m.id === modelId);
  if (!model) {
    return res.status(400).json({ error: 'Invalid or decommissioned model: ' + modelId });
  }
  if (!model.free) {
    return res.status(403).json({ error: 'This model requires payment. Please select a free model.' });
  }

  // Clean messages – keep both string and array content
  const cleanMessages = messages
    .filter(msg => msg && (typeof msg.content === 'string' || Array.isArray(msg.content)) && msg.content.length > 0)
    .map(msg => ({ role: msg.role, content: msg.content }));

  if (cleanMessages.length === 0) {
    res.write('Please start a new conversation.');
    res.end();
    return;
  }

  // Ensure last message is from user
  if (cleanMessages[cleanMessages.length - 1].role !== 'user') {
    res.write('I\'m waiting for your message.');
    res.end();
    return;
  }

  // PII guardrail – only check text parts
  for (const msg of cleanMessages) {
    let text = '';
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(p => p.type === 'text');
      if (textPart) text = textPart.text;
    }
    if (containsPII(text)) {
      console.warn(`⚠️ Blocked request due to PII: ${text.substring(0, 50)}...`);
      res.write('⚠️ Your message contains personal information. For privacy, we cannot process this request.');
      res.end();
      return;
    }
  }

  console.log(`💬 Chat request - Model: ${model.name} (${model.provider})`);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    if (model.provider === 'groq') {
      if (!groq) throw new Error('Groq not configured');
      const textOnlyMessages = cleanMessages.map(msg => ({
        role: msg.role,
        content: toPlainText(msg.content)
      }));
      const stream = await groq.chat.completions.create({
        model: model.id,
        messages: textOnlyMessages,
        stream: true,
        max_tokens: 1024,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) res.write(content);
      }
    } 
    else if (model.provider === 'openrouter') {
      if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter not configured');
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model.id,
          messages: cleanMessages,
          stream: true,
          max_tokens: 1024,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://pickmo.ai',
            'X-Title': 'Pickmo.ai'
          },
          responseType: 'stream',
          timeout: 60000
        }
      );
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const content = json.choices[0]?.delta?.content || '';
              if (content) res.write(content);
            } catch (e) { /* ignore */ }
          }
        }
      });
      await new Promise((resolve) => response.data.on('end', resolve));
    }
    else if (model.provider === 'google') {
      if (!googleAi) throw new Error('Google Gemini not configured');
      
      // Build conversation history for Google
      const history = [];
      for (let i = 0; i < cleanMessages.length - 1; i++) {
        const msg = cleanMessages[i];
        let parts = [];
        if (typeof msg.content === 'string') {
          parts = [{ text: msg.content }];
        } else if (Array.isArray(msg.content)) {
          // Extract text and images
          const textPart = msg.content.find(p => p.type === 'text');
          if (textPart) parts.push({ text: textPart.text });
          const imageParts = extractImages(msg.content);
          for (const img of imageParts) {
            parts.push({
              inlineData: {
                mimeType: img.mimeType,
                data: img.data
              }
            });
          }
        }
        history.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts
        });
      }
      
      // Current user message (the last one)
      const lastMsg = cleanMessages[cleanMessages.length - 1];
      let currentParts = [];
      if (typeof lastMsg.content === 'string') {
        currentParts = [{ text: lastMsg.content }];
      } else if (Array.isArray(lastMsg.content)) {
        const textPart = lastMsg.content.find(p => p.type === 'text');
        if (textPart) currentParts.push({ text: textPart.text });
        const imageParts = extractImages(lastMsg.content);
        for (const img of imageParts) {
          currentParts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.data
            }
          });
        }
      }
      
      const chat = googleAi.chats.create({
        model: model.id,
        history: history,
        config: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        }
      });
      
      const response = await chat.sendMessageStream({
        message: currentParts
      });
      
      for await (const chunk of response) {
        const text = chunk.text;
        if (text) res.write(text);
      }
    }
    else {
      throw new Error(`Unsupported provider: ${model.provider}`);
    }
    res.end();
  } catch (err) {
    console.error('Chat error:', err.message);
    let errorMsg = '❌ Sorry, I encountered an error. Please try again.';
    if (err.response?.status === 401) errorMsg = '❌ Invalid API key. Please check your API keys.';
    else if (err.response?.status === 429) errorMsg = '⏰ Rate limit exceeded. Please try again in a moment.';
    else if (err.response?.data?.error?.message) errorMsg = `❌ ${err.response.data.error.message}`;
    else if (err.message.includes('vision')) errorMsg = '❌ This model does not support images. Please select a vision model (e.g., Gemini 2.0 Flash).';
    res.write(errorMsg);
    res.end();
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
      subject: `Pickmo.ai ${type}`,
      text: message,
    });
    res.json({ success: true });
  } catch (err) {
  console.error('Email error:', err);
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
  console.log(`🤖 FREE Models loaded: ${models.length} text models`);
  console.log(`🔑 Groq: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 Google: ${process.env.GOOGLE_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Email: ${process.env.SMTP_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔄 Models will refresh every hour automatically\n`);
});
