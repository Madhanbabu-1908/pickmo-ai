require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const Groq = require('groq-sdk');
const axios = require('axios');
const cosineSimilarity = require('cosine-similarity');
const { pipeline } = require('@xenova/transformers');
const modelsConfig = require('./models.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Email transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_PORT === '465',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
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
    // Simple fallback
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

// Routes
app.get('/api/models', (req, res) => {
  res.json(modelsConfig.models);
});

app.post('/api/chat/stream', async (req, res) => {
  const { modelId, messages } = req.body;
  const model = modelsConfig.models.find(m => m.id === modelId);
  if (!model) return res.status(400).json({ error: 'Invalid model' });

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    if (model.provider === 'groq') {
      const stream = await groq.chat.completions.create({
        model: model.id,
        messages,
        stream: true,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) res.write(content);
      }
    } else if (model.provider === 'openrouter') {
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model: model.id, messages, stream: true },
        { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, responseType: 'stream' }
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
    console.error(err);
    res.status(500).end('Error');
  }
});

app.post('/api/rag/upload', async (req, res) => {
  const { text, name } = req.body;
  if (!text) return res.status(400).json({ error: 'No text' });
  try {
    const embedding = await getEmbedding(text);
    documents.push({ id: Date.now(), text, name, embedding });
    res.json({ success: true, count: documents.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Embedding failed' });
  }
});

app.post('/api/rag/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.json([]);
  try {
    const queryEmbed = await getEmbedding(query);
    const scored = documents.map(doc => ({
      ...doc,
      score: cosineSimilarity(queryEmbed, doc.embedding)
    }));
    scored.sort((a,b) => b.score - a.score);
    res.json(scored.slice(0, 3));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

app.post('/api/feedback', async (req, res) => {
  const { type, message } = req.body;
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.FEEDBACK_EMAIL,
      subject: `Pickmo.ai ${type}`,
      text: message,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Email failed' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`📊 Embedding mode: ${EMBEDDING_MODE}`);
});