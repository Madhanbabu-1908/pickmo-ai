export default function ModelSelector({ models, selected, onChange, useRAG, setUseRAG }) {
  return (
    <div className="p-4 border-b border-gray-700 bg-gray-800 flex items-center gap-4 flex-wrap">
      <span className="text-sm font-medium">Model:</span>
      <select 
        value={selected} 
        onChange={(e) => onChange(e.target.value)} 
        className="bg-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {models.map(model => (
          <option key={model.id} value={model.id}>{model.name}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input 
          type="checkbox" 
          checked={useRAG} 
          onChange={(e) => setUseRAG(e.target.checked)} 
          className="w-4 h-4"
        />
        Use uploaded documents as context (RAG)
      </label>
    </div>
  );
}