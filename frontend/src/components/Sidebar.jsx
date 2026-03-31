import { PlusCircle, History, FolderOpen, HelpCircle, Lightbulb, Download } from 'lucide-react';

export default function Sidebar({ chats, activeChatId, onSelectChat, onNewChat, onSelectResources, onSelectHelp, onSelectSuggestion, onSelectDownload }) {
  return (
    <div className="w-64 bg-gray-800 p-4 flex flex-col">
      <button onClick={onNewChat} className="mb-6 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 p-2 rounded-lg w-full justify-center transition">
        <PlusCircle size={18} /> New Chat
      </button>
      
      <div className="flex-1 overflow-y-auto">
        <div className="text-xs text-gray-400 mb-2">CHAT HISTORY</div>
        {chats.map(chat => (
          <div 
            key={chat.id} 
            onClick={() => onSelectChat(chat.id)} 
            className={`p-2 rounded cursor-pointer mb-1 truncate transition ${activeChatId === chat.id ? 'bg-gray-700' : 'hover:bg-gray-700'}`}
          >
            <History size={14} className="inline mr-2" /> {chat.title}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-700 pt-4 space-y-2">
        <button onClick={onSelectResources} className="flex items-center gap-2 w-full p-2 hover:bg-gray-700 rounded transition">
          <FolderOpen size={18} /> Resources
        </button>
        <button onClick={onSelectHelp} className="flex items-center gap-2 w-full p-2 hover:bg-gray-700 rounded transition">
          <HelpCircle size={18} /> Help & Support
        </button>
        <button onClick={onSelectSuggestion} className="flex items-center gap-2 w-full p-2 hover:bg-gray-700 rounded transition">
          <Lightbulb size={18} /> Suggestion
        </button>
        <button onClick={onSelectDownload} className="flex items-center gap-2 w-full p-2 hover:bg-gray-700 rounded transition">
          <Download size={18} /> Download App
        </button>
      </div>
    </div>
  );
}