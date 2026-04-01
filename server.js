// Import required libraries
const express = require('express');
const cors = require('cors');
const { OpenRouter } = require('openrouter');
const { Groq } = require('groq');

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up Streaming Chat
app.post('/chat', async (req, res) => {
    const { userMessage } = req.body;
    // Process the user message with RAG and OpenRouter models
    const response = await OpenRouter.streamResponse(userMessage);
    res.status(200).send(response);
});

// Handle email feedback
app.post('/feedback', (req, res) => {
    const { email, feedback } = req.body;
    // Process feedback (e.g., save to database)
    console.log(`Feedback received from ${email}: ${feedback}`);
    res.status(200).send('Feedback received successfully');
});

// Social Media Integration
app.get('/groq-model', async (req, res) => {
    // Fetch data using Groq
    const data = await Groq.fetchData();
    res.status(200).json(data);
});

// Start server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});