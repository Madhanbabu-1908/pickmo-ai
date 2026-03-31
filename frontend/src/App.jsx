import { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ModelSelector from './components/ModelSelector';
import Resources from './components/Resources';
import HelpSupport from './components/HelpSupport';
import Suggestion from './components/Suggestion';
import Download from './components/Download';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('chatHistory');
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure all messages have unique IDs
      return parsed.map(chat => ({
        ...chat,
        messages: chat.messages.map(msg => ({
          ...msg,
          id: msg.id || `msg-${Date.now()}-${Math.random()}`
        }))
      }));
    }
    return [{ 
      id: '1', 
      title: 'New conversation', 
      messages: [] 
    }];
  });
  const [activeChatId, setActiveChatId] = useState('1');
  const [activeView, setActiveView] = useState('chat');
  const [useRAG, setUseRAG] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/models`).then(res => {
      setModels(res.data);
      const textModels = res.data.filter(m => !m.type);
      if (textModels.length) setSelectedModel(textModels[0].id);
    }).catch(err => {
      console.error('Failed to load models:', err);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(chats));
  }, [chats]);

  // ========== CRITICAL FIX ==========
  // This function now removes the 'id' property from messages before sending to API
  const sendMessageStream = async (userMessage, onChunk, onError) => {
    const activeChat = chats.find(c => c.id === activeChatId);
    let context = '';
    
    if (useRAG) {
      try {
        const ragRes = await axios.post(`${API_URL}/rag/search`, { query: userMessage });
        if (ragRes.data.length) {
          context = "Use the following documents to answer:\n" + ragRes.data.map(d => d.text).join('\n\n');
        }
      } catch (err) { 
        console.error('RAG search failed', err); 
      }
    }
    
    // CRITICAL: Remove 'id' property from messages for API
    // Map each message to only include role and content
    const cleanMessages = activeChat.messages
      .filter(msg => msg && msg.content && msg.content.length > 0)
      .map(msg => ({
        role: msg.role,
        content: msg.content
        // 'id' property is EXCLUDED here
      }));
    
    // Add context if RAG is enabled
    if (context) {
      cleanMessages.push({ role: 'system', content: context });
    }
    
    // Add the new user message
    cleanMessages.push({ role: 'user', content: userMessage });
    
    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          modelId: selectedModel, 
          messages: cleanMessages  // Now without 'id' property
        })
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(decoder.decode(value));
      }
    } catch (err) {
      onError(err);
    }
  };
  // ========== END FIX ==========

  const newChat = () => {
    const newId = Date.now().toString();
    setChats(prev => [{ id: newId, title: 'New conversation', messages: [] }, ...prev]);
    setActiveChatId(newId);
    setActiveView('chat');
    setUseRAG(false);
  };

  const updateChatMessages = (chatId, updater) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: updater(c.messages) } : c));
  };

  const activeChat = chats.find(c => c.id === activeChatId) || { messages: [] };
  const textModels = models.filter(m => !m.type);

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 text-white overflow-hidden">
      <Sidebar 
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => { setActiveChatId(id); setActiveView('chat'); setUseRAG(false); }}
        onNewChat={newChat}
        onSelectResources={() => setActiveView('resources')}
        onSelectHelp={() => setActiveView('help')}
        onSelectSuggestion={() => setActiveView('suggestion')}
        onSelectDownload={() => setActiveView('download')}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeView === 'chat' && (
          <>
            <ModelSelector 
              models={textModels} 
              selected={selectedModel} 
              onChange={setSelectedModel}
            />
            <ChatArea 
              messages={activeChat.messages} 
              onSendStream={sendMessageStream}
              chatId={activeChatId}
              updateChatMessages={updateChatMessages}
              apiUrl={API_URL}
              useRAG={useRAG}
              setUseRAG={setUseRAG}
            />
          </>
        )}
        {activeView === 'resources' && <Resources apiUrl={API_URL} />}
        {activeView === 'help' && <HelpSupport apiUrl={API_URL} />}
        {activeView === 'suggestion' && <Suggestion apiUrl={API_URL} />}
        {activeView === 'download' && <Download />}
      </div>
    </div>
  );
}

export default App;