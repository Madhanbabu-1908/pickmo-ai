import { useState } from 'react';
import axios from 'axios';
import { Loader2, Download, Copy, Sparkles } from 'lucide-react';

export default function ImageGenerator({ apiUrl, models }) {
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [generating, setGenerating] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [error, setError] = useState('');

  const imageModels = models.filter(m => m.type === 'image');

  const generateImage = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    if (!selectedModel) {
      setError('Please select an image generation model');
      return;
    }
    
    setGenerating(true);
    setError('');
    setImageUrl('');
    
    try {
      const response = await axios.post(`${apiUrl}/generate-image`, {
        prompt: prompt,
        modelId: selectedModel
      });
      
      setImageUrl(response.data.image);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate image. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-600/20 rounded-2xl mb-4">
            <Sparkles size={32} className="text-purple-400" />
          </div>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            AI Image Generator
          </h2>
          <p className="text-gray-400 mt-2">Describe what you want to create</p>
        </div>
        
        <div className="bg-gray-800 rounded-2xl p-6 shadow-xl">
          <form onSubmit={generateImage} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Model</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-gray-900 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700"
                required
              >
                <option value="">Choose an image model...</option>
                {imageModels.map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Prompt</label>
              <textarea
                rows="4"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="E.g., A futuristic cityscape with neon lights, cyberpunk style, 4k, highly detailed"
                className="w-full bg-gray-900 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none border border-gray-700"
                required
              />
            </div>
            
            <button 
              type="submit" 
              disabled={generating}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 py-3 rounded-xl transition disabled:opacity-50 font-medium"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={20} className="animate-spin" />
                  Generating...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Sparkles size={20} />
                  Generate Image
                </span>
              )}
            </button>
          </form>
          
          {error && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>
        
        {imageUrl && (
          <div className="mt-8">
            <div className="bg-gray-800 rounded-2xl p-6 shadow-xl">
              <h3 className="text-lg font-semibold mb-4">Generated Image:</h3>
              <div className="flex justify-center">
                <img 
                  src={imageUrl} 
                  alt={prompt}
                  className="rounded-xl max-w-full max-h-96 shadow-lg object-contain"
                />
              </div>
              <div className="mt-4 flex gap-3 justify-center">
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = imageUrl;
                    link.download = `pickmo-${Date.now()}.png`;
                    link.click();
                  }}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded-xl transition text-sm"
                >
                  <Download size={16} /> Download
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(imageUrl);
                    alert('Image URL copied to clipboard!');
                  }}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-xl transition text-sm"
                >
                  <Copy size={16} /> Copy URL
                </button>
              </div>
            </div>
          </div>
        )}
        
        {imageModels.length === 0 && (
          <div className="mt-4 p-4 bg-yellow-900/30 border border-yellow-700 rounded-xl">
            <p className="text-yellow-300 text-sm text-center">⚠️ No image generation models found. Check your models.json configuration.</p>
          </div>
        )}
      </div>
    </div>
  );
}