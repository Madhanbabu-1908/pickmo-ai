import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export default function ChatArea({ messages, onSendStream, chatId, updateChatMessages }) {
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    const userMsg = input;
    setInput('');
    setIsStreaming(true);

    updateChatMessages(chatId, (prev) => [...prev, { role: 'user', content: userMsg }]);
    updateChatMessages(chatId, (prev) => [...prev, { role: 'assistant', content: '' }]);

    let fullContent = '';
    await onSendStream(userMsg, 
      (chunk) => {
        fullContent += chunk;
        updateChatMessages(chatId, (prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: fullContent };
          return newMessages;
        });
      },
      (error) => {
        console.error(error);
        updateChatMessages(chatId, (prev) => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1] = { role: 'assistant', content: '❌ Error: ' + error.message };
          return newMessages;
        });
      }
    );
    setIsStreaming(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-lg">Welcome to Pickmo.ai! 🎉</p>
            <p className="text-sm mt-2">Send a message to start chatting</p>
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-3xl rounded-lg p-3 ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'}`}>
              {msg.role === 'assistant' ? <ReactMarkdown>{msg.content}</ReactMarkdown> : msg.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Waiting for response..." : "Type your message..."}
            disabled={isStreaming}
            className="flex-1 bg-gray-800 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button type="submit" disabled={isStreaming} className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded transition disabled:opacity-50">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}