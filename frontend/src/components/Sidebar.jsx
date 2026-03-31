import { 
  PlusCircle, 
  MessageSquare, 
  FolderOpen, 
  HelpCircle, 
  Lightbulb, 
  Download,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { useState } from 'react';

export default function Sidebar({ 
  chats, 
  activeChatId, 
  onSelectChat, 
  onNewChat, 
  onSelectResources, 
  onSelectHelp, 
  onSelectSuggestion, 
  onSelectDownload,
  isCollapsed,
  onToggleCollapse
}) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);
  
  const SidebarContent = () => (
    <div className={`h-full flex flex-col bg-gradient-to-b from-gray-900/95 to-gray-900 backdrop-blur-xl border-r border-gray-800/50 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-80'}`}>
      {/* Brand Header */}
      <div className={`p-5 border-b border-gray-800/50 ${isCollapsed ? 'px-2' : ''}`}>
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles size={20} className="text-white" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Pickmo.ai
              </h1>
              <p className="text-xs text-gray-400 mt-0.5">Free AI Chatbot</p>
            </div>
          )}
        </div>
      </div>

      {/* Collapse Toggle Button */}
      <button 
        onClick={onToggleCollapse}
        className="absolute -right-3 top-20 bg-gray-800 border border-gray-700 rounded-full p-1.5 hover:bg-gray-700 transition-all duration-200 hidden md:block"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* New Chat Button */}
      <button 
        onClick={() => {
          onNewChat();
          setIsMobileOpen(false);
        }} 
        className={`mx-3 mt-4 flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 p-3 rounded-xl transition-all duration-200 shadow-lg shadow-blue-500/20 ${isCollapsed ? 'justify-center' : 'w-auto'}`}
      >
        <PlusCircle size={18} />
        {!isCollapsed && <span className="font-medium">New Chat</span>}
      </button>
      
      {/* Chat History */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {!isCollapsed && (
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2">
            Recent Chats
          </div>
        )}
        {chats.length === 0 ? (
          <div className={`text-xs text-gray-500 text-center py-8 ${isCollapsed ? 'hidden' : ''}`}>
            No conversations yet
          </div>
        ) : (
          <div className="space-y-1">
            {chats.map(chat => (
              <div 
                key={chat.id} 
                onClick={() => {
                  onSelectChat(chat.id);
                  setIsMobileOpen(false);
                }} 
                className={`group relative px-3 py-2 rounded-xl cursor-pointer transition-all duration-200 ${
                  activeChatId === chat.id 
                    ? 'bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30' 
                    : 'hover:bg-gray-800/50'
                } ${isCollapsed ? 'flex justify-center' : ''}`}
              >
                <div className={`flex items-center gap-2 ${isCollapsed ? 'justify-center' : ''}`}>
                  <MessageSquare size={14} className={`flex-shrink-0 ${activeChatId === chat.id ? 'text-blue-400' : 'text-gray-500'}`} />
                  {!isCollapsed && (
                    <span className="text-sm truncate font-medium">{chat.title}</span>
                  )}
                </div>
                {isCollapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    {chat.title}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Navigation Menu */}
      <div className="border-t border-gray-800/50 pt-4 pb-6 px-2 space-y-1">
        <NavButton icon={FolderOpen} label="Resources" onClick={() => {
          onSelectResources();
          setIsMobileOpen(false);
        }} isCollapsed={isCollapsed} />
        <NavButton icon={HelpCircle} label="Help & Support" onClick={() => {
          onSelectHelp();
          setIsMobileOpen(false);
        }} isCollapsed={isCollapsed} />
        <NavButton icon={Lightbulb} label="Suggestions" onClick={() => {
          onSelectSuggestion();
          setIsMobileOpen(false);
        }} isCollapsed={isCollapsed} />
        <NavButton icon={Download} label="Download App" onClick={() => {
          onSelectDownload();
          setIsMobileOpen(false);
        }} isCollapsed={isCollapsed} />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Menu Button */}
      <button 
        onClick={toggleMobile}
        className="fixed top-4 left-4 z-50 bg-gray-800/80 backdrop-blur-xl p-2.5 rounded-xl shadow-lg md:hidden border border-gray-700"
      >
        {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Desktop Sidebar */}
      <div className="hidden md:block h-full relative">
        <SidebarContent />
      </div>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
            onClick={toggleMobile}
          />
          <div className="fixed top-0 left-0 h-full w-80 z-50 md:hidden animate-slide-in">
            <SidebarContent />
          </div>
        </>
      )}
    </>
  );
}

function NavButton({ icon: Icon, label, onClick, isCollapsed }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-all duration-200 text-gray-400 hover:text-white hover:bg-gray-800/50 group ${isCollapsed ? 'justify-center' : ''}`}
    >
      <Icon size={18} className="group-hover:scale-110 transition-transform" />
      {!isCollapsed && <span className="text-sm font-medium">{label}</span>}
      {isCollapsed && (
        <div className="absolute left-full ml-2 px-2 py-1 bg-gray-800 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
          {label}
        </div>
      )}
    </button>
  );
}