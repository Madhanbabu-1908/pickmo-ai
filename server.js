require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Groq = require('groq-sdk');
const axios = require('axios');
const cosineSimilarity = require('cosine-similarity');
const { pipeline } = require('@xenova/transformers');

const app = express();

// ========== CORS CONFIGURATION - ALLOW ALL ORIGINS ==========  
// This is the most permissive setting to ensure Vercel can access
app.use(cors({
  origin: '*',  // Allow all origins (Vercel, localhost, etc.)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// Initialize Groq client
let groq;
try {
  groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  console.log('✅ Groq client initialized');
} catch (err) {
  console.warn('⚠️ Groq API key not configured');
}

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_PORT === '465',
  auth: { 
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASS 
  }
});

// Embeddings Setup
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

// In-memory document store
let documents = [];

// ========== DYNAMIC MODEL FETCHING ==========  
// Cache for models (refresh every hour)
let cachedModels = [];
let lastFetchTime = null;
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Fetch models from Groq
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

// Check if a model is free based on pricing
function isModelFree(model) {
  if (model.id.includes(':free')) return true;
  if (model.pricing && model.pricing.prompt === 0) return true;
  if (model.description && model.description.toLowerCase().includes('free')) return true;
  return false;
}

// Fetch FREE models from OpenRouter only
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
      free: true
    }));
  } catch (err) {
    console.error('Failed to fetch OpenRouter models:', err.message);
    return [];
  }
}

// Format model name for display
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
  name = name.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
  
  if (modelId.includes('groq') || modelId.startsWith('llama') || modelId.startsWith('mixtral') || modelId.startsWith('qwen') || modelId.startsWith('deepseek')) {
    name = name + ' (Groq)';
  } else if (modelId.includes('openrouter') || modelId.includes(':')) {
    name = name + ' (Free)';
  }
  
  return name;
}

// Refresh models cache
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

// Get cached models (refresh if needed)
async function getModels() {
  if (!lastFetchTime || Date.now() - lastFetchTime > CACHE_DURATION || cachedModels.length === 0) {
    await refreshModels();
  }
  return cachedModels;
}

// ========== ROUTES ==========  
// Health check
app.get('/api/health', async (req, res) => {
  const models = await getModels();
  res.json({ 
    status: 'ok', 
    message: 'Backend is running!',
    timestamp: new Date().toISOString(),
    embedding_mode: EMBEDDING_MODE,
    total_models: models.length,
    documents: documents.length,
    last_refresh: lastFetchTime
  });
});

// Get available free text models
app.get('/api/models', async (req, res) => {
  try {
    const models = await getModels();
    res.json(models);
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Get model details
app.get('/api/models/:modelId', async (req, res) => {
  try {
    const models = await getModels();
    const model = models.find(m => m.id === req.params.modelId);
    if (!model) {
      return res.status(404).json({ error: 'Model not found' });
    }
    res.json(model);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

// Force refresh models (admin endpoint)
app.post('/api/models/refresh', async (req, res) => {
  try {
    await refreshModels();
    res.json({ success: true, count: cachedModels.length, models: cachedModels });
  } catch (err) {
    console.error('Error refreshing models:', err);
    res.status(500).json({ error: 'Failed to refresh models' });
  }
});

// Streaming chat endpoint
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
  
  const cleanMessages = messages
    .filter(msg => msg && typeof msg.content === 'string' && msg.content.length > 0)
    .map(msg => ({ role: msg.role, content: msg.content }));
  
  if (cleanMessages.length === 0) {
    res.write('Please start a new conversation.');
    res.end();
    return;
  }
  
  if (cleanMessages[cleanMessages.length - 1].role !== 'user') {
    res.write('I\'m waiting for your message.');
    res.end();
    return;
  }
  
  console.log(`💬 Chat request - Model: ${model.name} (${model.provider})`);
  
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  try {
    if (model.provider === 'groq') {
      if (!groq) throw new Error('Groq not configured');
      
      const stream = await groq.chat.completions.create({
        model: model.id,
        messages: cleanMessages,
        stream: true,
        max_tokens: 1024,
      });
      
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) res.write(content);
      }
      
    } else if (model.provider === 'openrouter') {
      if (!process.env.OPENROUTER_API_KEY) throw new Error('OpenRouter not configured');
      
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { 
          model: model.id, 
          messages: cleanMessages, 
          stream: true,
          max_tokens: 1024
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
            } catch (e) {}
          }
        }
      });
      
      await new Promise((resolve) => response.data.on('end', resolve));
    }
    
    res.end();
    
  } catch (err) {
    console.error('Chat error:', err.message);
    
    if (err.response?.status === 401) {
      res.write('❌ Invalid API key. Please check your API keys.');
    } else if (err.response?.status === 429) {
      res.write('⏰ Rate limit exceeded. Please try again in a moment.');
    } else if (err.response?.data?.error?.message) {
      res.write(`❌ ${err.response.data.error.message}`);
    } else {
      res.write('❌ Sorry, I encountered an error. Please try again.');
    }
    res.end();
  }
});

// RAG: Upload document
app.post('/api/rag/upload', async (req, res) => {
  const { text, name } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  
  try {
    const embedding = await getEmbedding(text);
    documents.push({ 
      id: Date.now(), 
      text: text.substring(0, 2000),
      name, 
      embedding 
    });
    console.log(`📄 Document indexed: ${name}`);
    res.json({ success: true, count: documents.length });
  } catch (err) {
    console.error('Embedding error:', err);
    res.status(500).json({ error: 'Embedding failed' });
  }
});

// RAG: Search
app.post('/api/rag/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json([]);
  
  try {
    const queryEmbed = await getEmbedding(query);
    const scored = documents.map(doc => ({
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

// Feedback
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

// ========== START SERVER ==========
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n✅ Pickmo.ai Backend running on port ${PORT}`);
  console.log(`📊 Embedding mode: ${EMBEDDING_MODE}`);
  
  const models = await getModels();
  console.log(`🤖 FREE Models loaded: ${models.length} text models`);
  
  console.log(`🔑 Groq: ${process.env.GROQ_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔑 OpenRouter: ${process.env.OPENROUTER_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`📧 Email: ${process.env.SMTP_USER ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🔄 Models will refresh every hour automatically\n`);
});