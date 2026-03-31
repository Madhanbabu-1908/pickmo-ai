import { useState } from 'react';
import axios from 'axios';

export default function Suggestion({ apiUrl }) {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      await axios.post(`${apiUrl}/feedback`, { type: 'suggestion', message });
      setStatus('💡 Suggestion sent! Thank you for helping improve Pickmo.ai.');
      setMessage('');
      setTimeout(() => setStatus(''), 5000);
    } catch (err) {
      setStatus('❌ Failed to send. Please try again later.');
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">💡 Suggest an Improvement</h2>
      <p className="text-gray-400 mb-6">Help us make Pickmo.ai better. Your idea matters to us.</p>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          rows="6"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What would you like to see added or changed? Features, UI improvements, new models, etc."
          className="w-full bg-gray-800 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-700 px-6 py-2 rounded-lg transition">
          Submit Suggestion
        </button>
        {status && <div className="text-sm text-green-400">{status}</div>}
      </form>
    </div>
  );
}