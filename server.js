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
const documentsByChat = new Map(); // key: chatId, value: array of {id, text, name, embedding}
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

// ========== Dynamic model fetching (unchanged) ==========
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
      const isTextModel = !model.modality || model.modality === 'text';
      const isFree = isModelFree(model);
      return isTextModel && isFree;
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
  }
  return name;
}

async function refreshModels() {
  console.log('🔄 Fetching available FREE models from providers...');
  const [groqModels, openRouterModels] = await Promise.all([
    fetchGroqModels(),
    fetchOpenRouterModels()
  ]);
  const allModels = [...groqModels, ...openRouterModels];
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

// ========== Streaming chat (unchanged except for RAG integration) ==========
// (Keep your existing /api/chat/stream – it does not need to know about chatId because RAG is handled on frontend)
// The frontend will call /api/rag/search separately and inject the context.

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
  loadDocumentsFromDisk(); // restore previous documents
  const models = await getModels();
  console.log(`🤖 FREE Models loaded: ${models.length} text models`);
  console.log(`🔑 Groq: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Email: ${process.env.SMTP_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔄 Models will refresh every hour automatically\n`);
});
