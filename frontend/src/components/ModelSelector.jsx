import { Cpu, ChevronDown, Search } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export default function ModelSelector({ models, selected, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  const selectedModel = models.find(m => m.id === selected);

  // Filter models based on search
  const filteredModels = models.filter(model =>
    model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    model.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) &&
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (modelId) => {
    onChange(modelId);
    setIsOpen(false);
    setSearchTerm('');
  };

  return (
    <div className="border-b border-gray-800/50 bg-gray-900/30 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Model Dropdown */}
          <div className="relative">
            <button
              ref={buttonRef}
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-xl border border-gray-700 hover:border-gray-600 transition-all duration-200 group"
            >
              <Cpu size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-gray-200">
                {selectedModel?.name || 'Select model'}
              </span>
              <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            
            {isOpen && (
              <div 
                ref={dropdownRef}
                className="absolute top-full left-0 mt-2 w-80 bg-gray-800 rounded-xl border border-gray-700 shadow-2xl z-50 overflow-hidden animate-fadeIn"
              >
                {/* Search Bar */}
                <div className="p-3 border-b border-gray-700">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search models..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full bg-gray-700/50 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-600"
                      autoFocus
                    />
                  </div>
                </div>
                
                {/* Model List with Scroll */}
                <div className="max-h-80 overflow-y-auto">
                  {filteredModels.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-400 text-sm">
                      No models found
                    </div>
                  ) : (
                    filteredModels.map(model => (
                      <button
                        key={model.id}
                        onClick={() => handleSelect(model.id)}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors duration-150 ${
                          selected === model.id 
                            ? 'bg-blue-600/20 text-blue-400 border-l-2 border-blue-500' 
                            : 'text-gray-300 hover:bg-gray-700/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{model.name}</span>
                          <span className="text-xs text-gray-500 font-mono">{model.id.split('/').pop()}</span>
                        </div>
                        {model.context && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            {Math.round(model.context / 1024)}K context
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
                
                {/* Footer */}
                <div className="p-2 border-t border-gray-700 text-center">
                  <span className="text-xs text-gray-500">{models.length} models available</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Model Count Badge */}
          <div className="text-xs text-gray-500 bg-gray-800/30 px-2 py-1 rounded-full">
            {models.length} models
          </div>
        </div>
      </div>
    </div>
  );
}