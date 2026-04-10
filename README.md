# 🤖 Pickmo.ai — Full-Stack AI Chatbot

> A production-ready, open-source AI chatbot with **web search**, **document analysis**, **multi-model support**, **agentic architecture**, and a modern responsive UI. Built for beginners and experienced developers alike.

---

## 📑 Table of Contents

1. [What Is Pickmo.ai?](#1-what-is-pickmcoai)
2. [Architecture Overview](#2-architecture-overview)
3. [Key Concepts Explained](#3-key-concepts-explained)
4. [Project Structure](#4-project-structure)
5. [Prerequisites](#5-prerequisites)
6. [Step-by-Step Setup](#6-step-by-step-setup)
7. [Environment Variables](#7-environment-variables)
8. [Backend Code Walkthrough](#8-backend-code-walkthrough)
9. [Frontend Code Walkthrough](#9-frontend-code-walkthrough)
10. [Agentic Architecture Deep Dive](#10-agentic-architecture-deep-dive)
11. [MCP (Model Context Protocol)](#11-mcp-model-context-protocol)
12. [Web Search & Responsible AI](#12-web-search--responsible-ai)
13. [RAG (Retrieval-Augmented Generation)](#13-rag-retrieval-augmented-generation)
14. [API Reference](#14-api-reference)
15. [UI Improvements](#15-ui-improvements)
16. [Deployment Guide](#16-deployment-guide)
17. [Troubleshooting](#17-troubleshooting)
18. [Contributing](#18-contributing)

---

## 1. What Is Pickmo.ai?

Pickmo.ai is a **free AI chatbot** that lets you:

- 💬 Chat with multiple free AI models (Llama, Mixtral, Gemma, DeepSeek, etc.)
- 🌐 Search the web in real-time and get **cited answers** with sources
- 📄 Upload documents and ask questions about them (RAG)
- 🤖 Benefit from **intelligent agent routing** — the right "agent" handles each type of question
- 💻 Get expert code writing and debugging help
- 📱 Works on desktop, tablet, and mobile

### Tech Stack at a Glance

| Layer    | Technology |
|----------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, react-markdown |
| Backend  | Node.js, Express.js |
| AI       | Groq API + OpenRouter API (free models) |
| Search   | DuckDuckGo HTML scraping + Cheerio |
| RAG      | Cosine similarity + Xenova Transformers.js embeddings |
| Packaging| Electron (desktop), Capacitor (Android) |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PICKMO.AI SYSTEM                         │
│                                                             │
│  ┌──────────────────┐        ┌──────────────────────────┐  │
│  │   React Frontend  │◄──────►│    Express.js Backend     │  │
│  │  (Vite + Tailwind)│  HTTP  │  (Node.js, port 10000)   │  │
│  └──────────────────┘        └─────────────┬────────────┘  │
│                                             │               │
│                              ┌──────────────▼────────────┐  │
│                              │    AgentOrchestrator       │  │
│                              │  (classifies & routes)     │  │
│                              └──┬──────────┬──────────┬──┘  │
│                                 │          │          │      │
│                      ┌──────────▼──┐  ┌───▼────┐  ┌─▼───┐  │
│                      │ WebSearch   │  │  RAG   │  │Code │  │
│                      │   Agent     │  │ Agent  │  │Agent│  │
│                      └──────┬──────┘  └───┬────┘  └──┬──┘  │
│                             │             │           │      │
│                      ┌──────▼─────────────▼───────────▼──┐  │
│                      │          AI Model Layer            │  │
│                      │  Groq API ◄──────► OpenRouter API  │  │
│                      │  (LLaMA, Mixtral, Gemma, etc.)     │  │
│                      └───────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Data flow for a chat message:**

```
User types message
      │
      ▼
Frontend sends POST /api/chat/stream
      │
      ▼
Backend: PII check → AgentOrchestrator classifies intent
      │
      ├─ enableSearch=true?  → WebSearchAgent → DuckDuckGo → scrape → build prompt
      ├─ has documents?       → RAGAgent      → cosine similarity search → inject context
      ├─ code keywords?       → CodeAgent     → code-focused system prompt
      └─ default              → GeneralAgent  → conversational prompt
      │
      ▼
Stream response from AI model (Groq or OpenRouter)
      │
      ▼
Frontend renders markdown, shows agent badge, source citations
```

---

## 3. Key Concepts Explained

### What is an API?
An API (Application Programming Interface) is a way for two programs to communicate. When you click "Send" in Pickmo.ai, the frontend sends an API request to the backend, which then forwards it to the AI model's API.

### What is Streaming?
Instead of waiting for the entire AI response to finish, streaming sends text **word by word** as it's generated. This is why you see text appearing gradually — just like ChatGPT. Technically, the server sends chunks of data using HTTP chunked transfer encoding.

### What is RAG?
**Retrieval-Augmented Generation** = give the AI relevant text from your documents before asking a question. This is how Pickmo.ai can "read" your uploaded files:

1. Your document is split and converted to numbers (embeddings)
2. Your question is also converted to numbers
3. We find the most similar document sections using **cosine similarity**
4. Those sections are injected into the AI's context window

### What is an Agent?
In AI, an "agent" is an AI system that uses different tools or approaches based on the situation. Pickmo.ai has a central **AgentOrchestrator** that looks at your question and decides:
- Is this a web search question? → Use WebSearchAgent
- Has the user uploaded documents? → Use RAGAgent
- Is this a coding question? → Use CodeAgent
- Otherwise → Use GeneralAgent

### What is MCP?
**Model Context Protocol** is a standard for describing what "tools" an AI can use. Pickmo.ai exposes its tools (web search, document analysis, code assist, etc.) at `/api/mcp/tools` so the frontend can show users what capabilities are available.

### What is Responsible AI?
Responsible AI means building AI systems that are safe, fair, and transparent. Pickmo.ai implements:
- **PII Detection**: Blocks personal information (emails, phone numbers, credit cards) from being sent
- **Source Citations**: Web search always provides the URLs it used (so you can verify)
- **Privacy masking**: The `privacy.js` utility sanitizes inputs
- **No hallucination policy**: Web search agent is instructed to only cite actual sources

---

## 4. Project Structure

```
pickmo-ai/
├── pickmo-ai-backend/          ← Node.js Express server
│   ├── server.js               ← Main backend (all routes + agents)
│   ├── package.json            ← Backend dependencies
│   ├── .env                    ← API keys (never commit this!)
│   ├── .gitignore
│   └── models.json             ← Cached model list (auto-generated)
│
└── pickmo-ai-frontend/         ← React app
    ├── index.html              ← HTML entry point
    ├── vite.config.js          ← Vite build config
    ├── tailwind.config.js      ← Tailwind CSS config
    ├── electron/
    │   └── main.cjs            ← Electron desktop wrapper
    ├── capacitor.config.ts     ← Capacitor Android config
    └── src/
        ├── main.jsx            ← React root
        ├── App.jsx             ← Main app component + state
        ├── index.css           ← Global styles + design tokens
        └── components/
            ├── ChatArea.jsx    ← Message display + input
            ├── Sidebar.jsx     ← Chat list + navigation
            ├── ModelSelector.jsx  ← Model dropdown
            ├── PromptLibrary.jsx  ← Saved prompts
            ├── Resources.jsx   ← Saved documents
            ├── HelpSupport.jsx ← Help page
            ├── Suggestion.jsx  ← Feature suggestions
            ├── Download.jsx    ← App download page
            ├── ImageGenerator.jsx ← Image generation
            └── privacy.js      ← PII masking utility
```

---

## 5. Prerequisites

Before starting, make sure you have:

### Required Software

```bash
# Check Node.js version (need 18+)
node --version

# Check npm version (comes with Node.js)
npm --version

# Check Git
git --version
```

If you don't have Node.js, download it from [nodejs.org](https://nodejs.org) — choose the **LTS** version.

### Required API Keys (Free)

| Service | Purpose | Get it |
|---------|---------|--------|
| Groq API | Fast AI inference (LLaMA, Mixtral) | [console.groq.com](https://console.groq.com) |
| OpenRouter API | Extended model library | [openrouter.ai/keys](https://openrouter.ai/keys) |

Both are **free to start** — no credit card needed for the free tier.

---

## 6. Step-by-Step Setup

### Step 1: Clone the repositories

```bash
# Create a project folder
mkdir pickmo-project
cd pickmo-project

# Clone backend
git clone https://github.com/yourusername/pickmo-ai.git
cd pickmo-ai

# Clone frontend (in a new terminal or parallel)
git clone https://github.com/yourusername/pickmo-ai-frontend.git
```

### Step 2: Set up the Backend

```bash
# Navigate to backend folder
cd pickmo-ai

# Install all dependencies listed in package.json
npm install

# This installs:
# - express       (web server framework)
# - groq-sdk      (Groq AI client)
# - axios         (HTTP requests)
# - cheerio       (HTML scraping for web search)
# - @xenova/transformers (local embeddings for RAG)
# - cosine-similarity (math for RAG search)
# - cors          (allow frontend to call backend)
# - dotenv        (load .env file)
# - nodemailer    (send feedback emails)
```

### Step 3: Create the .env file (Backend)

```bash
# In the pickmo-ai/ folder, create a .env file
# On Mac/Linux:
touch .env

# On Windows:
type nul > .env
```

Now open `.env` in a text editor and add:

```env
# ── Required ──────────────────────────────────
GROQ_API_KEY=gsk_your_groq_key_here
OPENROUTER_API_KEY=sk-or-your_openrouter_key_here

# ── Optional ──────────────────────────────────
PORT=10000
EMBEDDING_MODE=simple        # or 'transformers' for better accuracy (slower)
SAVE_DOCUMENTS=false         # true = persist RAG documents to disk

# ── Email (for feedback feature, optional) ─────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_gmail_app_password
FEEDBACK_EMAIL=admin@yoursite.com
```

> ⚠️ **Never commit your `.env` file to Git!** It's already in `.gitignore`.

### Step 4: Start the Backend

```bash
# Development mode (auto-restarts on file changes)
npm run dev

# OR production mode
npm start
```

You should see:
```
✅ Pickmo.ai Backend running on port 10000
🤖 Agents: web_search, rag, code, general
🔧 MCP Tools: 6 registered
🤖 FREE Models loaded: 35 total
🔑 Groq:       ✅ Configured
🔑 OpenRouter: ✅ Configured
```

**Test it** by opening: http://localhost:10000/api/health

### Step 5: Set up the Frontend

```bash
# In a NEW terminal, navigate to frontend
cd pickmo-ai-frontend

# Install dependencies
npm install
```

### Step 6: Create Frontend .env

```bash
# Create .env in the pickmo-ai-frontend/ folder
touch .env
```

Add:
```env
VITE_API_URL=http://localhost:10000/api
```

> ℹ️ Vite only exposes environment variables that start with `VITE_` to the browser.

### Step 7: Start the Frontend

```bash
npm run dev
```

You'll see:
```
  VITE v4.x.x  ready in 500ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
```

Open **http://localhost:5173** in your browser. You should see the Pickmo.ai chat interface!

---

## 7. Environment Variables

### Backend (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GROQ_API_KEY` | ✅ Yes | — | Groq API key for fast LLM inference |
| `OPENROUTER_API_KEY` | ✅ Yes | — | OpenRouter API key for additional models |
| `PORT` | No | `10000` | Port the backend runs on |
| `EMBEDDING_MODE` | No | `simple` | `simple` = fast hash, `transformers` = accurate ML embeddings |
| `SAVE_DOCUMENTS` | No | `false` | Persist uploaded RAG documents across restarts |
| `SMTP_HOST` | No | `smtp.gmail.com` | Email server for feedback |
| `SMTP_PORT` | No | `587` | Email port |
| `SMTP_USER` | No | — | Email username |
| `SMTP_PASS` | No | — | Email password/app password |
| `FEEDBACK_EMAIL` | No | `admin@pickmo.ai` | Where feedback emails go |

### Frontend (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | ✅ Yes | `http://localhost:10000/api` | Backend API URL |

---

## 8. Backend Code Walkthrough

Let's walk through `server.js` section by section.

### 8.1 Server Setup

```javascript
require('dotenv').config();   // Load .env file variables into process.env
const express = require('express');
const app = express();

// CORS = Cross-Origin Resource Sharing
// Allows the frontend (localhost:5173) to call the backend (localhost:10000)
app.use(cors({ origin: '*' }));

// Parse JSON request bodies up to 10MB
app.use(express.json({ limit: '10mb' }));
```

**What is CORS?** Browsers block requests from one domain to another by default (security feature). CORS headers tell the browser "it's OK, allow this request." Since frontend and backend run on different ports, CORS is required.

### 8.2 Groq Client Initialization

```javascript
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
```

This creates a Groq client that we reuse for all AI requests. Groq provides extremely fast inference (they use custom hardware chips called LPUs).

### 8.3 PII Detection

```javascript
function containsPII(text) {
  const patterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,  // Email
    /\b(\+?91|0)?[6-9]\d{9}\b/,                                // Indian mobile
    /\b(?:\d[ -]*?){13,16}\b/,                                 // Credit card
    /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/                            // PAN card
  ];
  return patterns.some(p => p.test(text));
}
```

These are **Regular Expressions (regex)** — patterns that match text. Each one detects a different type of personal information. If any matches, we reject the message with a privacy warning.

### 8.4 Embeddings for RAG

```javascript
async function getEmbedding(text) {
  // 'simple' mode: fast but less accurate
  const vec = new Array(384).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i);  // character code → number
  }
  const norm = Math.hypot(...vec);        // normalize to unit vector
  return vec.map(v => v / norm);
}
```

An **embedding** converts text into a list of numbers (a vector). Similar texts have vectors that point in similar directions. We compare vectors using **cosine similarity** — if two vectors point in nearly the same direction (cosine close to 1.0), the texts are semantically similar.

### 8.5 Web Search Pipeline

```javascript
// 1. Search DuckDuckGo HTML version (no API key needed)
async function searchDuckDuckGo(query, maxResults = 5) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, { headers: { 'User-Agent': '...' } });
  const $ = cheerio.load(response.data);   // Load HTML for parsing
  
  // Extract result titles, URLs, and snippets
  $('.result').each((_, el) => {
    const title = $(el).find('.result__a').text();
    // ...
  });
}

// 2. Scrape the actual page content
async function scrapeURL(url) {
  const response = await axios.get(url, { timeout: 6000 });
  const $ = cheerio.load(response.data);
  
  // Remove noise (ads, navbars, footers)
  $('script, style, nav, footer, .ad').remove();
  
  // Extract main content
  const text = $('article, main, body').text().substring(0, 4000);
  return { text, images };
}
```

**Cheerio** is like jQuery for Node.js — it lets you parse HTML and extract elements using CSS selectors.

### 8.6 Streaming Responses

```javascript
app.post('/api/chat/stream', async (req, res) => {
  // Tell the browser: "I'll send data in chunks, keep connection open"
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Transfer-Encoding', 'chunked');
  
  // Stream from Groq
  const stream = await groq.chat.completions.create({
    model: model.id,
    messages: cleanMessages,
    stream: true              // ← enables streaming
  });
  
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    if (content) res.write(content);   // Write each chunk immediately
  }
  
  res.end();   // Close the connection
});
```

`for await` is an **async iterator** — it processes each chunk as it arrives from Groq's server, immediately forwarding it to the browser.

---

## 9. Frontend Code Walkthrough

### 9.1 React Component Tree

```
App.jsx                    ← Root state (chats, models, theme)
├── Sidebar.jsx            ← Chat list, navigation, theme toggle
├── ModelSelector.jsx      ← Model dropdown + agent badge
└── ChatArea.jsx           ← Messages + input area
    ├── MarkdownComponents ← Custom renderers for AI responses
    └── PromptLibrary.jsx  ← Pre-written prompts
```

### 9.2 React Hooks Used

```javascript
// useState — reactive data that triggers re-renders when changed
const [messages, setMessages] = useState([]);

// useEffect — run code when dependencies change
useEffect(() => {
  localStorage.setItem('chatHistory', JSON.stringify(chats));
}, [chats]);    // ← runs every time `chats` changes

// useRef — access DOM elements directly (doesn't cause re-renders)
const textareaRef = useRef(null);
textareaRef.current.focus();    // Focus the textarea
```

### 9.3 Reading Streaming Responses

```javascript
// fetch() with streaming:
const response = await fetch(`${API_URL}/chat/stream`, {
  method: 'POST',
  body: JSON.stringify({ modelId, messages, enableSearch })
});

// Get a "reader" to read the stream chunk by chunk
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);  // Uint8Array → string
  onChunk(chunk);                        // Update UI with each chunk
}
```

### 9.4 Markdown Rendering

AI responses come as Markdown (e.g., `**bold**`, ` ```python ` for code). We use `react-markdown` with custom components:

```jsx
// ChatArea.jsx
const MarkdownComponents = {
  code({ inline, className, children }) {
    const match = /language-(\w+)/.exec(className || '');
    
    if (!inline && match) {
      return (
        <SyntaxHighlighter language={match[1]}>
          {String(children)}
        </SyntaxHighlighter>
      );
    }
    return <code className="inline-code">{children}</code>;
  }
};

<ReactMarkdown components={MarkdownComponents}>
  {message.content}
</ReactMarkdown>
```

### 9.5 Local Storage for Persistence

```javascript
// Save chats when they change
useEffect(() => {
  localStorage.setItem('chatHistory', JSON.stringify(chats));
}, [chats]);

// Load chats on startup
const [chats, setChats] = useState(() => {
  const saved = localStorage.getItem('chatHistory');
  return saved ? JSON.parse(saved) : [defaultChat];
});
```

`localStorage` is a browser database that persists data even after closing the tab. We use it to save chat history, theme preference, and selected model.

---

## 10. Agentic Architecture Deep Dive

The centerpiece of Pickmo.ai's backend is the **AgentOrchestrator** — a system that automatically selects the right "agent" for each user request.

### How it Works

```javascript
class AgentOrchestrator {
  classifyIntent(userMessage, enableSearch, hasDocuments) {
    const msg = userMessage.toLowerCase();
    
    // Priority 1: User explicitly enabled web search
    if (enableSearch) return 'web_search';
    
    // Priority 2: Documents are loaded → use RAG
    if (hasDocuments) return 'rag';
    
    // Priority 3: Code keywords
    const codeKeywords = ['write code', 'debug', 'python', 'javascript', ...];
    if (codeKeywords.some(k => msg.includes(k))) return 'code';
    
    // Priority 4: Web search keywords
    const webKeywords = ['latest', 'today', 'news', 'current', ...];
    if (webKeywords.some(k => msg.includes(k))) return 'web_search';
    
    // Default: general conversation
    return 'general';
  }
}
```

### Each Agent's Role

| Agent | Trigger | System Prompt Focus |
|-------|---------|---------------------|
| `GeneralAgent` | Default | Friendly, concise, conversational |
| `CodeAgent` | Code keywords | Best practices, explanation, error handling |
| `RAGAgent` | Documents loaded | Only answer from uploaded docs, cite filenames |
| `WebSearchAgent` | Search enabled or web keywords | Cite sources, never fabricate URLs |

### Agent Result in the UI

The backend sends a metadata tag at the start of every response:

```
<!--AGENT:CodeAgent-->
Here is the Python code you requested...
```

The frontend strips this tag and shows the agent badge in the top bar.

---

## 11. MCP (Model Context Protocol)

MCP is Anthropic's open standard for describing AI tools. Pickmo.ai implements a simplified version.

### Registered Tools

Tools are defined in `server.js` as:

```javascript
const MCP_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for real-time information.',
    inputSchema: { query: 'string' },
    icon: '🌐',
    category: 'Search'
  },
  {
    name: 'document_analysis',
    description: 'Analyze uploaded documents and answer questions.',
    inputSchema: { chatId: 'string', query: 'string' },
    icon: '📄',
    category: 'Documents'
  },
  // ... more tools
];
```

### Accessing the Tool Registry

```bash
curl http://localhost:10000/api/mcp/tools
```

Response:
```json
{
  "protocol": "MCP v1.0",
  "tools": [
    { "name": "web_search", "icon": "🌐", "category": "Search", ... },
    { "name": "document_analysis", "icon": "📄", ... }
  ]
}
```

### Why MCP Matters

MCP makes it easy to:
- **Extend** Pickmo.ai with new tools (e.g., a calendar agent, a calculator)
- **Integrate** with external MCP-compatible servers
- **Inspect** what the AI can do via a standard API

---

## 12. Web Search & Responsible AI

### How Web Search Works

```
User question: "What is the latest iPhone price?"
      │
      ▼
1. searchDuckDuckGo("latest iPhone price")
   → Returns 5 search results (title, URL, snippet)
      │
      ▼
2. scrapeURL(each result URL)
   → Fetches full page, strips ads/navbars, extracts text
      │
      ▼
3. buildWebSearchPrompt(pages, images, query)
   → Creates system prompt with source text + citation rules
      │
      ▼
4. AI generates response with inline citations [1][2][3]
      │
      ▼
5. Response ends with "📚 Sources:" section
   [1] Apple.com – https://apple.com/...
   [2] The Verge – https://theverge.com/...
```

### Responsible AI Citation Rules

The system prompt given to the AI includes **mandatory rules**:

```
RESPONSIBLE AI — MANDATORY CITATION RULES:
1. Add inline citation numbers [1], [2] after each fact
2. End response with "📚 Sources:" listing all URLs used
3. If information is NOT in sources, say "I could not find this"
4. Never fabricate facts or URLs
5. Indicate date range if relevant
```

This ensures:
- Users can **verify** every claim
- The AI cannot **hallucinate** fake sources
- Transparency about **information recency**

### Domain Blocklist

Some domains are blocked from scraping (paywalls, login-required, social media):

```javascript
const BLOCKED_DOMAINS = [
  'reddit.com', 'facebook.com', 'twitter.com', 'nytimes.com', ...
];
```

---

## 13. RAG (Retrieval-Augmented Generation)

### Step-by-Step RAG Flow

**Step 1: Upload a Document**
```javascript
// User uploads "company_report.pdf"
POST /api/rag/upload
{ text: "...full document text...", name: "company_report.pdf", chatId: "123" }
```

**Step 2: Generate Embedding**
```javascript
const embedding = await getEmbedding(documentText);
// embedding = [0.12, -0.34, 0.89, ...] (384 numbers)

// Store in memory:
documentsByChat.set("123", [{ text, name, embedding }]);
```

**Step 3: User Asks a Question**
```javascript
// User: "What was the Q3 revenue?"
const queryEmbedding = await getEmbedding("What was the Q3 revenue?");
```

**Step 4: Find Similar Documents**
```javascript
// Compare query vector to all document vectors
const scored = docs.map(d => ({
  ...d,
  score: cosineSimilarity(queryEmbedding, d.embedding)
  // score close to 1.0 = very similar
}));

// Sort by similarity, take top 3
scored.sort((a, b) => b.score - a.score);
const topDocs = scored.slice(0, 3);
```

**Step 5: Inject Context**
```
[RAGAgent system prompt]
DOCUMENT CONTEXT:
[Doc: company_report.pdf]
Q3 revenue was $42.5 million, up 18% YoY...

---

USER QUESTION: What was the Q3 revenue?
```

**Step 6: AI Answers from Context**
```
Based on the uploaded document [Doc: company_report.pdf], 
the Q3 revenue was $42.5 million, representing an 18% 
year-over-year increase.
```

### Cosine Similarity Explained

Imagine two arrows pointing in 3D space. If they point in the same direction, the angle between them is 0°, and cosine(0°) = 1.0. If they're perpendicular, cosine(90°) = 0. We use this math with 384-dimensional vectors to measure text similarity.

---

## 14. API Reference

### GET /api/health
Returns backend status, model count, agent list.

**Response:**
```json
{
  "status": "ok",
  "total_models": 35,
  "agents": ["web_search", "rag", "code", "general"],
  "mcp_tools": 6
}
```

### GET /api/models
Returns list of all available free AI models.

**Response:**
```json
[
  { "id": "llama-3.1-70b-versatile", "name": "Llama 3.1 70B (Groq)", "provider": "groq", "context": 131072, "free": true }
]
```

### POST /api/chat/stream
Main chat endpoint. Streams text response.

**Request:**
```json
{
  "modelId": "llama-3.1-70b-versatile",
  "messages": [
    { "role": "user", "content": "Explain quantum computing" }
  ],
  "enableSearch": false,
  "chatId": "chat-123"
}
```

**Response:** Plain text stream, with optional metadata tags:
- `<!--AGENT:CodeAgent-->` — agent used
- `<!--SEARCH_IMAGES_JSON:[...]-->` — images from web search

### POST /api/rag/upload
Upload a document for RAG.

**Request:**
```json
{ "text": "Document content...", "name": "report.pdf", "chatId": "chat-123" }
```

### POST /api/rag/search
Find relevant document sections for a query.

**Request:**
```json
{ "query": "What is the revenue?", "chatId": "chat-123" }
```

### GET /api/mcp/tools
Returns available MCP tool definitions.

### GET /api/agents
Returns available agent configurations.

---

## 15. UI Improvements

### Design System

The redesigned UI uses a custom design token system in `index.css`:

```css
:root {
  --bg:       #0a0a0f;   /* Page background */
  --surface:  #111118;   /* Cards and panels */
  --sidebar:  #0d0d14;   /* Sidebar background */
  --input:    #16161f;   /* Input fields */
  --text:     #e8e8f0;   /* Primary text */
  --muted:    #6b6b88;   /* Secondary text */
  --violet:   #7c3aed;   /* Primary accent */
}
```

These are referenced in Tailwind classes:
```jsx
<div className="bg-pickmo-surface text-pickmo-text" />
```

### Responsive Design

The layout adapts for mobile:
- Sidebar slides in as an overlay on mobile (< 768px)
- Chat bubbles expand to 92% width on small screens
- Input area stacks vertically on very small screens
- Touch-friendly tap targets (min 44px)

### Agent Badges

Each response now shows which agent handled it:
```jsx
const AGENT_CONFIG = {
  WebSearchAgent:  { label: 'Web Search',  icon: Globe,    color: 'text-emerald-400' },
  RAGAgent:        { label: 'Doc Analysis', icon: BookOpen, color: 'text-violet-400'  },
  CodeAgent:       { label: 'Code Expert', icon: Code2,    color: 'text-cyan-400'    },
  GeneralAgent:    { label: 'Assistant',   icon: Brain,    color: 'text-blue-400'    },
};
```

---

## 16. Deployment Guide

### Deploy Backend to Render.com (Free)

1. Create account at [render.com](https://render.com)
2. New > Web Service > Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
4. Add Environment Variables (from your `.env`)
5. Click Deploy

Your backend URL will be: `https://pickmo-backend.onrender.com`

### Deploy Frontend to Vercel (Free)

1. Create account at [vercel.com](https://vercel.com)
2. New Project > Import your GitHub repo
3. Framework: **Vite**
4. Add Environment Variable:
   - `VITE_API_URL` = `https://pickmo-backend.onrender.com/api`
5. Click Deploy

Your app will be live at: `https://pickmo-ai.vercel.app`

### Build Desktop App (Electron)

```bash
cd pickmo-ai-frontend

# Build for Windows
npm run electron:build:win

# Output in dist-electron/ folder
```

### Build Android App (Capacitor)

```bash
# Build web assets first
npm run build

# Sync to Android
npx cap sync android

# Open in Android Studio
npx cap open android
```

---

## 17. Troubleshooting

### Backend won't start

**Error:** `Cannot find module 'groq-sdk'`
**Fix:** Run `npm install` in the backend folder.

**Error:** `GROQ_API_KEY is not configured`
**Fix:** Make sure you have a `.env` file with your API key.

### Frontend can't connect to backend

**Error:** `Network Error` or `CORS error`
**Fix:**
1. Make sure backend is running on port 10000
2. Check `VITE_API_URL` in frontend `.env`
3. Make sure backend has `cors({ origin: '*' })`

### Models not loading

**Error:** Empty model list
**Fix:** Your Groq API key may be invalid. Test it:
```bash
curl -H "Authorization: Bearer YOUR_KEY" https://api.groq.com/openai/v1/models
```

### Web search returning no results

This can happen if DuckDuckGo rate-limits requests. Try:
- Wait 30 seconds and retry
- The backend automatically falls back to snippet-only responses

### RAG not finding relevant content

If `EMBEDDING_MODE=simple` gives poor results, switch to:
```env
EMBEDDING_MODE=transformers
```
This uses a real ML model (`all-MiniLM-L6-v2`) for much better similarity matching, but takes longer to initialize on first run.

---

## 18. Contributing

We welcome contributions! Here's how:

1. **Fork** the repository on GitHub
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/pickmo-ai.git`
3. **Create a branch**: `git checkout -b feature/my-feature`
4. **Make changes** and test locally
5. **Commit**: `git commit -m "feat: add my feature"`
6. **Push**: `git push origin feature/my-feature`
7. **Open a Pull Request** on GitHub

### Ideas for Contributions

- 🌍 Add more language support
- 🔧 Add new MCP tools (calculator, calendar, weather API)
- 🎨 Light theme improvements
- 📊 Add usage statistics dashboard
- 🔒 Add user authentication
- 📱 Improve mobile keyboard handling

---

## License

MIT License — free to use, modify, and distribute.

---

## Acknowledgements

- [Groq](https://groq.com) — incredibly fast LLM inference
- [OpenRouter](https://openrouter.ai) — model marketplace
- [DuckDuckGo](https://duckduckgo.com) — privacy-respecting search
- [Xenova](https://github.com/xenova/transformers.js) — ML in JavaScript
- [Meta LLaMA](https://llama.meta.com) — open-source AI models

---

*Built with ❤️ by the Pickmo.ai team*
