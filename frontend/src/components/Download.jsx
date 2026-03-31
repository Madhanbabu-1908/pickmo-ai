import { Download as DownloadIcon, Smartphone, Monitor, Apple, Globe } from 'lucide-react';

export default function Download() {
  return (
    <div className="p-6 overflow-y-auto">
      <h2 className="text-3xl font-bold mb-2 text-center">📥 Download Pickmo.ai</h2>
      <p className="text-gray-400 text-center mb-8">Choose your platform and start chatting for free</p>

      <div className="max-w-4xl mx-auto">
        {/* iPhone Notice */}
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 mb-8">
          <div className="flex items-center gap-3">
            <Apple size={24} className="text-yellow-500" />
            <div>
              <p className="font-semibold">iPhone / iPad Users</p>
              <p className="text-sm text-gray-300">Use our web app for now. Add to home screen for a native-like experience!</p>
            </div>
            <a href="https://pickmo.ai" className="ml-auto bg-blue-600 px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">
              Open Web App →
            </a>
          </div>
        </div>

        {/* Download Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition">
            <Monitor size={48} className="mx-auto mb-4 text-blue-400" />
            <h3 className="text-xl font-semibold text-center mb-2">Windows</h3>
            <p className="text-gray-400 text-center text-sm mb-4">Windows 10/11, 64-bit</p>
            <a 
              href="/downloads/pickmo-setup.exe" 
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg transition"
            >
              <DownloadIcon size={18} /> Download .exe
            </a>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition">
            <Smartphone size={48} className="mx-auto mb-4 text-green-400" />
            <h3 className="text-xl font-semibold text-center mb-2">Android</h3>
            <p className="text-gray-400 text-center text-sm mb-4">Android 8.0+, 50MB</p>
            <a 
              href="/downloads/pickmo.apk" 
              className="flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 py-2 rounded-lg transition"
            >
              <DownloadIcon size={18} /> Download .apk
            </a>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition">
            <Monitor size={48} className="mx-auto mb-4 text-purple-400" />
            <h3 className="text-xl font-semibold text-center mb-2">Linux</h3>
            <p className="text-gray-400 text-center text-sm mb-4">Ubuntu/Debian, AppImage</p>
            <a 
              href="/downloads/pickmo.AppImage" 
              className="flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 py-2 rounded-lg transition"
            >
              <DownloadIcon size={18} /> Download .AppImage
            </a>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition">
            <Globe size={48} className="mx-auto mb-4 text-cyan-400" />
            <h3 className="text-xl font-semibold text-center mb-2">Web App</h3>
            <p className="text-gray-400 text-center text-sm mb-4">Any browser, no install</p>
            <a 
              href="https://pickmo.ai" 
              className="flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 py-2 rounded-lg transition"
            >
              Launch in Browser →
            </a>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-500">
          <p>Pickmo.ai v1.0 | Free AI Chatbot with RAG | Your data stays private</p>
        </div>
      </div>
    </div>
  );
}