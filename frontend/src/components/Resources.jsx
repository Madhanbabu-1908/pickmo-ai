import { useState, useEffect } from 'react';
import { FileText, Download, Trash2, Sparkles, Clock } from 'lucide-react';

export default function Resources({ apiUrl }) {
  const [uploadedFiles, setUploadedFiles] = useState(() => {
    const saved = localStorage.getItem('userResources');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [generatedDocs, setGeneratedDocs] = useState(() => {
    const saved = localStorage.getItem('generatedDocuments');
    return saved ? JSON.parse(saved) : [];
  });

  const [activeTab, setActiveTab] = useState('generated');

  const handleDeleteUploaded = (id) => {
    const updated = uploadedFiles.filter(f => f.id !== id);
    setUploadedFiles(updated);
    localStorage.setItem('userResources', JSON.stringify(updated));
  };

  const handleDeleteGenerated = (id) => {
    const updated = generatedDocs.filter(f => f.id !== id);
    setGeneratedDocs(updated);
    localStorage.setItem('generatedDocuments', JSON.stringify(updated));
  };

  const handleDownload = (content, filename) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600/20 rounded-2xl mb-4">
            <FileText size={32} className="text-blue-400" />
          </div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            My Resources
          </h2>
          <p className="text-gray-400 mt-2">Documents you've uploaded or generated with AI</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-gray-800 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('generated')}
            className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-2 ${
              activeTab === 'generated' 
                ? 'bg-purple-600 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sparkles size={16} />
            AI Generated
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full">{generatedDocs.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('uploaded')}
            className={`flex-1 py-2 rounded-lg transition flex items-center justify-center gap-2 ${
              activeTab === 'uploaded' 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <FileText size={16} />
            Uploaded
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full">{uploadedFiles.length}</span>
          </button>
        </div>

        {/* AI Generated Documents */}
        {activeTab === 'generated' && (
          <div className="space-y-3">
            {generatedDocs.length === 0 ? (
              <div className="bg-gray-800 rounded-2xl p-12 text-center">
                <Sparkles size={48} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400">No AI-generated documents yet</p>
                <p className="text-sm text-gray-500 mt-1">Click "Save to Resources" on any AI response to store it here</p>
              </div>
            ) : (
              generatedDocs.map(doc => (
                <div key={doc.id} className="bg-gray-800 rounded-xl p-4 hover:bg-gray-750 transition">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={16} className="text-purple-400" />
                        <span className="font-medium">{doc.name}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(doc.date).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 line-clamp-3 whitespace-pre-wrap">
                        {doc.content.substring(0, 300)}...
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleDownload(doc.content, doc.name)}
                        className="p-2 hover:bg-gray-700 rounded-lg transition text-green-400"
                        title="Download"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => handleDeleteGenerated(doc.id)}
                        className="p-2 hover:bg-gray-700 rounded-lg transition text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Uploaded Documents */}
        {activeTab === 'uploaded' && (
          <div className="space-y-3">
            {uploadedFiles.length === 0 ? (
              <div className="bg-gray-800 rounded-2xl p-12 text-center">
                <FileText size={48} className="mx-auto text-gray-600 mb-3" />
                <p className="text-gray-400">No uploaded documents yet</p>
                <p className="text-sm text-gray-500 mt-1">Attach files in the chat area to use them as context</p>
              </div>
            ) : (
              uploadedFiles.map(file => (
                <div key={file.id} className="bg-gray-800 rounded-xl p-4 hover:bg-gray-750 transition">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText size={16} className="text-blue-400" />
                        <span className="font-medium">{file.name}</span>
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock size={12} />
                          {new Date(file.date).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-300 line-clamp-2">
                        {file.content ? file.content.substring(0, 200) + '...' : 'Binary file'}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      {file.content && (
                        <button
                          onClick={() => handleDownload(file.content, file.name)}
                          className="p-2 hover:bg-gray-700 rounded-lg transition text-green-400"
                          title="Download"
                        >
                          <Download size={18} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteUploaded(file.id)}
                        className="p-2 hover:bg-gray-700 rounded-lg transition text-red-400"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}