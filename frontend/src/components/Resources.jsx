import { useState, useEffect } from 'react';
import axios from 'axios';

export default function Resources({ apiUrl }) {
  const [files, setFiles] = useState(() => {
    const saved = localStorage.getItem('userResources');
    return saved ? JSON.parse(saved) : [];
  });
  const [uploading, setUploading] = useState(false);

  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target.result;
      const newFile = {
        id: Date.now(),
        name: file.name,
        type: file.type,
        content: text.substring(0, 500), // Preview
        date: new Date().toISOString()
      };
      try {
        await axios.post(`${apiUrl}/rag/upload`, { text, name: file.name });
        const updated = [newFile, ...files];
        setFiles(updated);
        localStorage.setItem('userResources', JSON.stringify(updated));
        alert('Document uploaded and indexed for RAG!');
      } catch (err) {
        console.error('RAG upload failed', err);
        alert('Failed to index document');
      }
      setUploading(false);
    };
    reader.readAsText(file);
  };

  const handleDelete = (id) => {
    const updated = files.filter(f => f.id !== id);
    setFiles(updated);
    localStorage.setItem('userResources', JSON.stringify(updated));
  };

  return (
    <div className="p-6 overflow-y-auto">
      <h2 className="text-2xl font-bold mb-2">📚 My Resources</h2>
      <p className="text-gray-400 mb-6">Upload documents to use as context in your chats (RAG)</p>
      
      <div className="mb-6">
        <label className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg cursor-pointer inline-block transition">
          📄 Upload Document (.txt, .md)
          <input type="file" accept=".txt,.md" onChange={handleUpload} className="hidden" />
        </label>
        {uploading && <span className="ml-3 text-gray-400">Uploading & indexing...</span>}
      </div>

      {files.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-400">
          No documents uploaded yet. Upload a text file to get started.
        </div>
      )}
      
      <div className="grid gap-3">
        {files.map(file => (
          <div key={file.id} className="bg-gray-800 p-3 rounded-lg flex justify-between items-center">
            <div className="flex-1">
              <div className="font-medium">{file.name}</div>
              <div className="text-xs text-gray-400">{new Date(file.date).toLocaleString()}</div>
              <div className="text-sm text-gray-300 mt-1 truncate">{file.content}...</div>
            </div>
            <button onClick={() => handleDelete(file.id)} className="text-red-400 hover:text-red-300 ml-4 transition">
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}