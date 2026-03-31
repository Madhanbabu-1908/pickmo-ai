import { useState, useEffect } from 'react';
import axios from 'axios';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import ModelSelector from './components/ModelSelector';
import Resources from './components/Resources';
import HelpSupport from './components/HelpSupport';
import Suggestion from './components/Suggestion';
import Download from './components/Download';

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [chats, setChats] = useState(() => {
    const saved = localStorage.getItem('chatHistory');
    return saved ? JSON.parse(saved) : [{ id: '1', title: 'New Chat', messages: [] }];
  });
  const [activeChatId, setActiveChatId] = useState('1');
  const [activeView, setActiveView] = useState('chat');
  const [useRAG, setUseRAG] = useState(false);

  useEffect(() => {
    axios.get(`${API_URL}/models`).then(res => {
      setModels(res.data);
      if (res.data.length) setSelectedModel(res.data[0].id);
    }).catch(err => console.error('Failed to load models:', err));
  }, []);

  useEffect(() => {
    localStorage.setItem('chatHistory', JSON.stringify(chats));
  }, [chats]);

  const sendMessageStream = async (userMessage, onChunk, onError) => {
    const activeChat = chats.find(c => c.id === activeChatId);
    let context = '';
    if (useRAG) {
      try {
        const ragRes = await axios.post(`${API_URL}/rag/search`, { query: userMessage });
        if (ragRes.data.length) {
          context = "Use the following documents to answer:\n" + ragRes.data.map(d => d.text).join('\n\n');
        }
      } catch (err) { console.error('RAG search failed', err); }
    }
    const messagesWithContext = context 
      ? [...activeChat.messages, { role: 'system', content: context }, { role: 'user', content: userMessage }]
      : [...activeChat.messages, { role: 'user', content: userMessage }];
    
    try {
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: selectedModel, messages: messagesWithContext })
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

  const newChat = () => {
    const newId = Date.now().toString();
    setChats(prev => [{ id: newId, title: 'New Chat', messages: [] }, ...prev]);
    setActiveChatId(newId);
    setActiveView('chat');
  };

  const updateChatMessages = (chatId, updater) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: updater(c.messages) } : c));
  };

  const activeChat = chats.find(c => c.id === activeChatId) || { messages: [] };

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <Sidebar 
        chats={chats}
        activeChatId={activeChatId}
        onSelectChat={(id) => { setActiveChatId(id); setActiveView('chat'); }}
        onNewChat={newChat}
        onSelectResources={() => setActiveView('resources')}
        onSelectHelp={() => setActiveView('help')}
        onSelectSuggestion={() => setActiveView('suggestion')}
        onSelectDownload={() => setActiveView('download')}
      />
      <div className="flex-1 flex flex-col">
        {activeView === 'chat' && (
          <>
            <ModelSelector models={models} selected={selectedModel} onChange={setSelectedModel} useRAG={useRAG} setUseRAG={setUseRAG} />
            <ChatArea 
              messages={activeChat.messages} 
              onSendStream={sendMessageStream}
              chatId={activeChatId}
              updateChatMessages={updateChatMessages}
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