import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, Sparkles, Layers, Save, Cpu, History as HistoryIcon, Brain, 
  Play, Pause, Volume2, Download, AlertTriangle, CheckCircle, Clock, 
  Loader2, Trash2, Upload, FileText, X, RefreshCw, VolumeX
} from 'lucide-react';
import { geminiModel } from './firebase';

interface Model {
  id: string;
  name: string;
  quality: string;
  mode: string;
  folder: string;
  repo_id: string;
  status: string;
  error?: string | null;
  progress?: number;
}

interface ActiveModel {
  status: string;
  model_id: string | null;
  info?: {
    id: string;
    name: string;
    mode: string;
    quality: string;
  };
}

interface SpeakerMap {
  [lang: string]: string[];
}

interface VoiceProfile {
  name: string;
  audio_url: string;
  transcript: string;
}

interface HistoryItem {
  filename: string;
  clean_name: string;
  subfolder: string;
  audio_url: string;
  created_at: string;
  size_bytes: number;
}

export default function App() {
  // Tabs & Navigation
  const [activeTab, setActiveTab] = useState<'preset' | 'design' | 'clone' | 'saved' | 'model' | 'history' | 'ai'>('preset');
  
  // Loaded Data States
  const [models, setModels] = useState<Model[]>([]);
  const [activeModel, setActiveModel] = useState<ActiveModel>({ status: 'none', model_id: null });
  const [speakers, setSpeakers] = useState<SpeakerMap>({});
  const [savedVoices, setSavedVoices] = useState<VoiceProfile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Generating / Loading States
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingActiveModel, setLoadingActiveModel] = useState(false);
  const [activeDownloadPolls, setActiveDownloadPolls] = useState<string[]>([]);
  
  // Preset Voices Form State
  const [presetSpeaker, setPresetSpeaker] = useState('');
  const [presetEmotion, setPresetEmotion] = useState('Normal tone');
  const [presetSpeed, setPresetSpeed] = useState(1.0);
  const [presetText, setPresetText] = useState('');
  const [presetAudioResult, setPresetAudioResult] = useState<{ url: string; time: string; text: string } | null>(null);
  
  // Voice Design Form State
  const [designDescription, setDesignDescription] = useState('');
  const [designText, setDesignText] = useState('');
  const [designAudioResult, setDesignAudioResult] = useState<{ url: string; time: string; text: string } | null>(null);
  
  // Voice Cloning Form State
  const [cloneSource, setCloneSource] = useState<'saved' | 'upload'>('saved');
  const [cloneVoiceSelect, setCloneVoiceSelect] = useState('');
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null);
  const [cloneRefTranscript, setCloneRefTranscript] = useState('');
  const [cloneText, setCloneText] = useState('');
  const [cloneAudioResult, setCloneAudioResult] = useState<{ url: string; time: string; text: string; title: string } | null>(null);
  
  // Saved Voices Enrollment State
  const [enrollName, setEnrollName] = useState('');
  const [enrollAudioFile, setEnrollAudioFile] = useState<File | null>(null);
  const [enrollTranscript, setEnrollTranscript] = useState('');
  const [enrollSuccessMessage, setEnrollSuccessMessage] = useState('');
  
  // AI Prompter Form State
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState<{ text: string; time: string } | null>(null);

  // Playback Control States
  const [currentPlayback, setCurrentPlayback] = useState<{ url: string; title: string; subtitle: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  // DOM Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  // Initial Data Fetch
  useEffect(() => {
    fetchActiveModel();
    fetchSpeakers();
    fetchSavedVoices();
    fetchHistory();
    fetchModels();

    // Poll active model status every 5 seconds
    const interval = setInterval(fetchActiveModel, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch functions
  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      setModels(data);
      
      // Start polling for models currently downloading
      data.forEach((m: Model) => {
        if (m.status === 'downloading') {
          startPollingDownload(m.id);
        }
      });
    } catch (e) {
      console.error('Error fetching models', e);
    }
  };

  const fetchActiveModel = async () => {
    try {
      const res = await fetch('/api/models/active');
      const data = await res.json();
      setActiveModel(data);
    } catch (e) {
      console.error('Error fetching active model', e);
    }
  };

  const fetchSpeakers = async () => {
    try {
      const res = await fetch('/api/speakers');
      const data = await res.json();
      setSpeakers(data);
      // Auto-select first speaker if not set
      if (Object.keys(data).length > 0) {
        const firstLang = Object.keys(data)[0];
        if (data[firstLang].length > 0) {
          setPresetSpeaker(data[firstLang][0]);
        }
      }
    } catch (e) {
      console.error('Error fetching speakers', e);
    }
  };

  const fetchSavedVoices = async () => {
    try {
      const res = await fetch('/api/voices');
      const data = await res.json();
      setSavedVoices(data);
      if (data.length > 0 && !cloneVoiceSelect) {
        setCloneVoiceSelect(data[0].name);
      }
    } catch (e) {
      console.error('Error fetching saved voices', e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data = await res.json();
      setHistory(data);
    } catch (e) {
      console.error('Error fetching history', e);
    }
  };

  // Model download polling
  const startPollingDownload = (modelId: string) => {
    if (activeDownloadPolls.includes(modelId)) return;
    setActiveDownloadPolls(prev => [...prev, modelId]);

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/models/download/status/${modelId}`);
        const data = await res.json();
        
        setModels(prevModels => 
          prevModels.map(m => m.id === modelId ? { ...m, status: data.status, progress: data.progress } : m)
        );

        if (data.status === 'downloaded' || data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollInterval);
          setActiveDownloadPolls(prev => prev.filter(id => id !== modelId));
          fetchModels();
        }
      } catch (err) {
        clearInterval(pollInterval);
        setActiveDownloadPolls(prev => prev.filter(id => id !== modelId));
      }
    }, 2500);
  };

  const triggerDownload = async (modelId: string) => {
    try {
      setModels(prevModels => 
        prevModels.map(m => m.id === modelId ? { ...m, status: 'downloading', progress: 0 } : m)
      );
      const res = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId })
      });
      await res.json();
      startPollingDownload(modelId);
    } catch (e) {
      console.error('Error triggering model download', e);
    }
  };

  const triggerLoad = async (modelId: string) => {
    setLoadingActiveModel(true);
    try {
      // Optimistically update
      setActiveModel(prev => ({ ...prev, status: 'loading', model_id: modelId }));
      const res = await fetch('/api/models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId })
      });
      await res.json();
      await fetchActiveModel();
      await fetchModels();
    } catch (e) {
      console.error('Error loading model', e);
    } finally {
      setLoadingActiveModel(false);
    }
  };

  // Model Validation Helper
  const validateModel = (requiredMode: 'custom' | 'design' | 'clone'): boolean => {
    if (activeModel.status === 'none' || !activeModel.model_id) {
      alert('No model is loaded. Go to the "Model Manager" tab to download and load a model.');
      setActiveTab('model');
      return false;
    }
    if (activeModel.status === 'loading') {
      alert('Model is currently loading into memory. Please wait a few seconds.');
      return false;
    }
    const mode = activeModel.info?.mode;
    if (mode !== requiredMode) {
      alert(`Active model is in ${mode?.toUpperCase()} mode. You must load a ${requiredMode.toUpperCase()} model for this feature.`);
      setActiveTab('model');
      return false;
    }
    return true;
  };

  // Form Submit: Preset Speech
  const handleGeneratePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateModel('custom')) return;
    if (!presetText.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: presetText.trim(),
          speaker: presetSpeaker,
          emotion: presetEmotion.trim(),
          speed: presetSpeed
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Synthesis failed');
      }

      const data = await res.json();
      setPresetAudioResult({
        url: data.audio_url,
        time: new Date().toLocaleTimeString(),
        text: presetText
      });
      
      playTrack(data.audio_url, `Preset Voice: ${presetSpeaker}`, 'Preset TTS');
      fetchHistory();
    } catch (err: any) {
      alert(`Error generating preset speech: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Form Submit: Design Voice
  const handleGenerateDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateModel('design')) return;
    if (!designDescription.trim() || !designText.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: designText.trim(),
          voice_description: designDescription.trim()
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Synthesis failed');
      }

      const data = await res.json();
      setDesignAudioResult({
        url: data.audio_url,
        time: new Date().toLocaleTimeString(),
        text: designText
      });

      playTrack(data.audio_url, 'Designed Voice', 'Voice Design');
      fetchHistory();
    } catch (err: any) {
      alert(`Error designing voice: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Form Submit: Voice Cloning
  const handleGenerateClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateModel('clone')) return;
    if (!cloneText.trim()) return;

    const formData = new FormData();
    formData.append('text', cloneText.trim());

    if (cloneSource === 'saved') {
      if (!cloneVoiceSelect) {
        alert('Please enroll or select a voice profile first.');
        return;
      }
      formData.append('voice_name', cloneVoiceSelect);
    } else {
      if (!cloneAudioFile) {
        alert('Please upload a reference audio sample.');
        return;
      }
      formData.append('file', cloneAudioFile);
      formData.append('ref_transcript', cloneRefTranscript.trim() || '.');
    }

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate/clone', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Synthesis failed');
      }

      const data = await res.json();
      const cloneTitle = cloneSource === 'saved' ? cloneVoiceSelect : 'Quick Clone';
      setCloneAudioResult({
        url: data.audio_url,
        time: new Date().toLocaleTimeString(),
        text: cloneText,
        title: `Cloned: ${cloneTitle}`
      });

      playTrack(data.audio_url, `Cloned: ${cloneTitle}`, 'Voice Cloning');
      fetchHistory();
    } catch (err: any) {
      alert(`Error cloning voice: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Form Submit: Voice Enrollment
  const handleEnrollVoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollName.trim() || !enrollAudioFile || !enrollTranscript.trim()) return;

    setIsGenerating(true);
    setEnrollSuccessMessage('');
    const formData = new FormData();
    formData.append('name', enrollName.trim());
    formData.append('transcript', enrollTranscript.trim());
    formData.append('file', enrollAudioFile);

    try {
      const res = await fetch('/api/voices/enroll', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Enrollment failed');
      }

      setEnrollSuccessMessage(`Voice Profile "${enrollName}" enrolled successfully!`);
      setEnrollName('');
      setEnrollAudioFile(null);
      setEnrollTranscript('');
      fetchSavedVoices();
    } catch (err: any) {
      alert(`Enrollment failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Form Submit: AI Prompter
  const handleAiPrompter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiFile || !aiPrompt.trim()) return;

    setIsGenerating(true);
    setAiResponse(null);
    try {
      // Convert file to Base64 Generative Part
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(aiFile);
      });

      const filePart = {
        inlineData: {
          data: base64Data,
          mimeType: aiFile.type
        }
      };

      // Call Gemini Model via Firebase AI Logic Client SDK
      const result = await geminiModel.generateContent([aiPrompt, filePart]);
      const response = await result.response;
      const text = response.text();

      setAiResponse({
        text,
        time: new Date().toLocaleTimeString()
      });
    } catch (e: any) {
      alert(`AI Prompt failed: ${e.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Playback Control Functions
  const playTrack = (url: string, title: string, subtitle: string) => {
    setCurrentPlayback({ url, title, subtitle });
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = url;
      audioRef.current.volume = volume;
      audioRef.current.play().catch(err => {
        console.error('Audio play failed', err);
      });
    }
  };

  const togglePlayback = () => {
    if (!audioRef.current || !currentPlayback) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(e => console.error(e));
      setIsPlaying(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  const handleProgressChange = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickPercent = clickX / width;
    const targetTime = clickPercent * duration;
    audioRef.current.currentTime = targetTime;
    setCurrentTime(targetTime);
  };

  // Delete History Item
  const handleDeleteHistory = async (subfolder: string, filename: string) => {
    if (!confirm('Are you sure you want to delete this generation history item?')) return;
    try {
      const res = await fetch(`/api/history/${subfolder}/${filename}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchHistory();
        if (currentPlayback?.url.includes(filename)) {
          setCurrentPlayback(null);
          setIsPlaying(false);
        }
      }
    } catch (e) {
      console.error('Failed to delete history item', e);
    }
  };

  // Drag and Drop files to read Text
  const handleTextDrop = (e: React.DragEvent<HTMLDivElement>, setText: (val: string) => void) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setText(event.target.result as string);
        }
      };
      reader.readAsText(files[0]);
    } else {
      alert('Please upload a valid .txt plain text file.');
    }
  };

  // Draw Audio Waveform Animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2.5;

      const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
      gradient.addColorStop(0, '#a855f7'); // purple
      gradient.addColorStop(0.5, '#ec4899'); // pink
      gradient.addColorStop(1, '#6366f1'); // indigo
      ctx.strokeStyle = gradient;

      ctx.beginPath();
      const waveCount = 3;
      const height = canvas.height;
      const width = canvas.width;

      // Draw waves
      for (let i = 0; i < waveCount; i++) {
        const amp = isPlaying ? (10 - i * 3) * (volume + 0.2) : 1; // wave amplitude
        const speedMultiplier = (i + 1) * 0.08;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          // Sinus wave formula
          const angle = (x / width) * Math.PI * 3 + phase * speedMultiplier;
          const y = height / 2 + Math.sin(angle) * amp * Math.sin(x / width * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      if (isPlaying) {
        phase += 0.4;
      }
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, volume]);

  // Format seconds to M:SS
  const formatTimeStr = (secs: number) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="flex min-h-screen bg-neutral-950 text-neutral-100 antialiased font-sans pb-24">
      {/* Sidebar Navigation */}
      <aside className="w-72 bg-neutral-900/60 backdrop-blur-xl border-r border-neutral-800 flex flex-col shrink-0">
        <div className="p-6 border-b border-neutral-800/80 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-pink-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-900/20">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-none tracking-tight bg-gradient-to-r from-purple-400 to-pink-300 bg-clip-text text-transparent">Qwen3-TTS</h1>
            <p className="text-xs text-neutral-500 font-medium">Apple Silicon Studio</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <button 
            onClick={() => setActiveTab('preset')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'preset' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span>Preset Voices</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('design')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'design' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Voice Design</span>
          </button>

          <button 
            onClick={() => setActiveTab('clone')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'clone' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Voice Cloning</span>
          </button>

          <button 
            onClick={() => setActiveTab('saved')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'saved' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Saved Voices</span>
          </button>

          <button 
            onClick={() => setActiveTab('model')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'model' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Model Manager</span>
          </button>

          <button 
            onClick={() => setActiveTab('history')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'history' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <HistoryIcon className="w-4 h-4" />
            <span>History</span>
          </button>

          <button 
            onClick={() => setActiveTab('ai')} 
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
              activeTab === 'ai' 
                ? 'bg-neutral-800 text-white shadow-inner border-l-2 border-purple-500' 
                : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>AI Prompter</span>
          </button>
        </nav>

        {/* Active Model Card in Sidebar */}
        <div className="p-4 border-t border-neutral-800/80 bg-neutral-900/40">
          <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider">Active Model</span>
          <div className="mt-2 p-3 bg-neutral-950/60 border border-neutral-800/85 rounded-xl flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                activeModel.status === 'loaded' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]' : 
                activeModel.status === 'loading' ? 'bg-amber-500 animate-bounce' : 'bg-red-500'
              }`} />
              <span className="text-xs font-semibold truncate text-neutral-200">
                {activeModel.status === 'loaded' ? activeModel.info?.name : 
                 activeModel.status === 'loading' ? 'Loading model...' : 'No Model Loaded'}
              </span>
            </div>
            <p className="text-[10px] text-neutral-500 leading-normal">
              {activeModel.status === 'loaded' ? `${activeModel.info?.quality} • ${activeModel.info?.mode.toUpperCase()}` : 
               activeModel.status === 'loading' ? 'Initializing weights on Apple GPU...' : 'Please load a model from the manager.'}
            </p>
            {activeModel.status === 'none' && (
              <button 
                onClick={() => setActiveTab('model')}
                className="mt-1.5 py-1.5 px-3 bg-purple-600/80 hover:bg-purple-600 text-white rounded-lg text-[10px] font-bold tracking-wide transition-all border border-purple-500/25 text-center"
              >
                Go to Model Manager
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="px-8 py-5 border-b border-neutral-950 bg-neutral-900/10 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-neutral-100 tracking-tight capitalize">
              {activeTab === 'preset' && 'Preset Voices'}
              {activeTab === 'design' && 'Voice Design'}
              {activeTab === 'clone' && 'Voice Cloning'}
              {activeTab === 'saved' && 'Saved Voices'}
              {activeTab === 'model' && 'Model Manager'}
              {activeTab === 'history' && 'Generation History'}
              {activeTab === 'ai' && 'AI Prompter'}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              {activeTab === 'preset' && 'Generate high-quality speech using local speakers and tone controllers.'}
              {activeTab === 'design' && 'Design custom local voice profiles using plain English prompt instructions.'}
              {activeTab === 'clone' && 'Clone voice profiles locally using 5-second reference audio recordings.'}
              {activeTab === 'saved' && 'Create and manage reusable custom voice files.'}
              {activeTab === 'model' && 'Manage offline MLX models downloaded and cached on your Mac.'}
              {activeTab === 'history' && 'Browse, play, download, and clean up previous generated sound clips.'}
              {activeTab === 'ai' && 'Use Gemini 2.5 Flash client-side to prompt and analyze documents/images.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold bg-neutral-800 text-neutral-300 px-3 py-1.5 rounded-lg border border-neutral-700/60 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> Local Offline
            </span>
            <span className="text-xs font-semibold bg-purple-950/40 text-purple-300 border border-purple-800/40 px-3 py-1.5 rounded-lg shadow-sm">
              Apple Silicon GPU (MLX)
            </span>
          </div>
        </header>

        {/* Tab Contents */}
        <div className="flex-1 p-8 overflow-y-auto">
          {/* Preset Voices Panel */}
          {activeTab === 'preset' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <form onSubmit={handleGeneratePreset} className="space-y-6">
                  {/* Speaker */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Select Speaker</label>
                    <select 
                      value={presetSpeaker} 
                      onChange={(e) => setPresetSpeaker(e.target.value)}
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full"
                      required
                    >
                      {Object.entries(speakers).map(([lang, names]) => (
                        <optgroup label={lang} key={lang}>
                          {names.map(name => (
                            <option value={name} key={name}>{name} ({lang})</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Emotion Prompt */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Emotion Preset / Custom tone</label>
                    <div className="flex flex-wrap gap-2 mb-1">
                      {['Normal tone', 'Sad and crying, speaking slowly', 'Excited and happy, speaking very fast', 'Angry and shouting', 'Whispering quietly'].map(emotion => (
                        <button
                          type="button"
                          key={emotion}
                          onClick={() => setPresetEmotion(emotion)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-all ${
                            presetEmotion === emotion 
                              ? 'bg-purple-600 border-purple-500 text-white shadow-md' 
                              : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:border-neutral-700'
                          }`}
                        >
                          {emotion === 'Normal tone' && 'Normal'}
                          {emotion.startsWith('Sad') && 'Sad/Slow'}
                          {emotion.startsWith('Excited') && 'Excited/Fast'}
                          {emotion.startsWith('Angry') && 'Angry'}
                          {emotion.startsWith('Whispering') && 'Whispering'}
                        </button>
                      ))}
                    </div>
                    <input 
                      type="text" 
                      value={presetEmotion} 
                      onChange={(e) => setPresetEmotion(e.target.value)}
                      placeholder="Type custom style instruction (e.g. dramatic narrator)..."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full"
                    />
                  </div>

                  {/* Speed Factor */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Speed Factor</label>
                    <div className="grid grid-cols-3 gap-3">
                      {[0.8, 1.0, 1.3].map(speed => (
                        <label key={speed} className={`flex items-center justify-center gap-2 border px-4 py-3 rounded-xl cursor-pointer text-sm font-medium transition-all ${
                          presetSpeed === speed 
                            ? 'bg-neutral-800 border-purple-500/80 text-white shadow-inner' 
                            : 'bg-neutral-950 border-neutral-800/80 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                        }`}>
                          <input 
                            type="radio" 
                            name="preset-speed" 
                            value={speed} 
                            checked={presetSpeed === speed}
                            onChange={() => setPresetSpeed(speed)}
                            className="hidden"
                          />
                          <span>{speed === 0.8 ? 'Slow (0.8x)' : speed === 1.0 ? 'Normal (1.0x)' : 'Fast (1.3x)'}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Text to Speak</label>
                    <textarea 
                      value={presetText}
                      onChange={(e) => setPresetText(e.target.value)}
                      rows={5}
                      placeholder="Enter the text you want the AI to read..."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full resize-y"
                      required
                    />
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleTextDrop(e, setPresetText)}
                      className="border border-dashed border-neutral-800 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl p-4 text-center text-xs text-neutral-500 hover:text-neutral-400 transition-all cursor-default"
                    >
                      Drag & drop a .txt file here to import text content.
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3.5 px-6 rounded-xl text-sm font-bold shadow-lg shadow-purple-950/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Synthesizing Audio...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        <span>Generate Speech</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Preview */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl min-h-[300px] flex flex-col">
                  <h3 className="text-sm font-bold text-neutral-300 mb-4">Generation Preview</h3>
                  
                  {!presetAudioResult ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-xl">
                      <div className="w-12 h-12 rounded-full bg-neutral-800/60 flex items-center justify-center text-neutral-500 mb-3">
                        <FileText className="w-5 h-5" />
                      </div>
                      <p className="text-sm text-neutral-400 font-medium">No active generation</p>
                      <p className="text-xs text-neutral-500 mt-1">Generated audio will appear here</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-neutral-950/40 border border-neutral-800 px-3.5 py-2 rounded-xl">
                          <span className="text-xs font-bold text-purple-400">Preset TTS</span>
                          <span className="text-[10px] font-semibold text-neutral-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {presetAudioResult.time}
                          </span>
                        </div>
                        <div className="bg-neutral-950/60 p-4 border border-neutral-800 rounded-xl">
                          <p className="text-xs italic text-neutral-300 leading-relaxed">
                            {presetAudioResult.text.length > 250 ? `${presetAudioResult.text.slice(0, 250)}...` : presetAudioResult.text}
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => playTrack(presetAudioResult.url, `Preset Voice: ${presetSpeaker}`, 'Preset TTS')}
                        className="mt-6 w-full py-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700/80 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                      >
                        <Play className="w-4 h-4 fill-white" /> Play Audio Result
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Voice Design Panel */}
          {activeTab === 'design' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <form onSubmit={handleGenerateDesign} className="space-y-6">
                  {/* Voice Description */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Voice Description (Design)</label>
                    <textarea 
                      value={designDescription}
                      onChange={(e) => setDesignDescription(e.target.value)}
                      rows={2}
                      placeholder="Describe the voice (e.g. A deep calm voice of an old man reading a story, clear recording, highly articulated...)"
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full resize-none"
                      required
                    />
                    
                    <div className="flex flex-wrap gap-2 mt-1">
                      {['deep male narrator', 'high-pitched energetic woman', 'whispering raspy voice', 'cheerful excited child'].map(tag => (
                        <button
                          type="button"
                          key={tag}
                          onClick={() => setDesignDescription(tag)}
                          className="text-[10px] bg-neutral-800 border border-neutral-750 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 px-2.5 py-1 rounded-lg font-semibold transition-all"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Text to Speak</label>
                    <textarea 
                      value={designText}
                      onChange={(e) => setDesignText(e.target.value)}
                      rows={5}
                      placeholder="Enter the text you want the AI to read..."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full resize-y"
                      required
                    />
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleTextDrop(e, setDesignText)}
                      className="border border-dashed border-neutral-800 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl p-4 text-center text-xs text-neutral-500 hover:text-neutral-400 transition-all cursor-default"
                    >
                      Drag & drop a .txt file here to import text content.
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3.5 px-6 rounded-xl text-sm font-bold shadow-lg shadow-purple-950/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Designing & Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Design & Generate</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Preview */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl min-h-[300px] flex flex-col">
                  <h3 className="text-sm font-bold text-neutral-300 mb-4">Generation Preview</h3>
                  
                  {!designAudioResult ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-xl">
                      <div className="w-12 h-12 rounded-full bg-neutral-800/60 flex items-center justify-center text-neutral-500 mb-3">
                        <FileText className="w-5 h-5" />
                      </div>
                      <p className="text-sm text-neutral-400 font-medium">No active generation</p>
                      <p className="text-xs text-neutral-500 mt-1">Generated audio will appear here</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-neutral-950/40 border border-neutral-800 px-3.5 py-2 rounded-xl">
                          <span className="text-xs font-bold text-purple-400">Voice Design</span>
                          <span className="text-[10px] font-semibold text-neutral-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {designAudioResult.time}
                          </span>
                        </div>
                        <div className="bg-neutral-950/60 p-4 border border-neutral-800 rounded-xl">
                          <p className="text-xs italic text-neutral-300 leading-relaxed">
                            {designAudioResult.text.length > 250 ? `${designAudioResult.text.slice(0, 250)}...` : designAudioResult.text}
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => playTrack(designAudioResult.url, 'Designed Voice', 'Voice Design')}
                        className="mt-6 w-full py-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700/80 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                      >
                        <Play className="w-4 h-4 fill-white" /> Play Audio Result
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Voice Cloning Panel */}
          {activeTab === 'clone' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <form onSubmit={handleGenerateClone} className="space-y-6">
                  {/* Clone Reference Audio Source Selector */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Reference Audio Source</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['saved', 'upload'] as const).map(source => (
                        <button
                          type="button"
                          key={source}
                          onClick={() => setCloneSource(source)}
                          className={`border px-4 py-3 rounded-xl text-sm font-medium transition-all text-center capitalize ${
                            cloneSource === source 
                              ? 'bg-neutral-800 border-purple-500/80 text-white shadow-inner' 
                              : 'bg-neutral-950 border-neutral-800/80 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
                          }`}
                        >
                          {source === 'saved' ? 'Saved Voices' : 'Quick Upload'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Reference Selection: Saved Voices */}
                  {cloneSource === 'saved' ? (
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-semibold text-neutral-300">Choose Saved Voice</label>
                      <select
                        value={cloneVoiceSelect}
                        onChange={(e) => setCloneVoiceSelect(e.target.value)}
                        className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full"
                        required
                      >
                        {savedVoices.map(v => (
                          <option value={v.name} key={v.name}>{v.name}</option>
                        ))}
                      </select>
                      <span className="text-[11px] text-neutral-500 font-semibold px-1 truncate">
                        Transcript: "{savedVoices.find(v => v.name === cloneVoiceSelect)?.transcript || '(N/A)'}"
                      </span>
                    </div>
                  ) : (
                    /* Reference Selection: Quick Upload */
                    <div className="space-y-4">
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-semibold text-neutral-300">Upload Reference Audio (WAV/MP3)</label>
                        {!cloneAudioFile ? (
                          <div 
                            onClick={() => document.getElementById('clone-file-input')?.click()}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (e.dataTransfer.files.length > 0) setCloneAudioFile(e.dataTransfer.files[0]);
                            }}
                            className="border border-dashed border-neutral-850 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl py-6 px-4 text-center cursor-pointer transition-all"
                          >
                            <Upload className="w-8 h-8 text-neutral-500 mx-auto mb-2" />
                            <p className="text-xs text-neutral-400 font-medium">Drag reference audio here or click to browse</p>
                            <span className="text-[10px] text-neutral-600 mt-1 block">Supported: WAV, MP3, M4A (5-10s clip)</span>
                            <input 
                              type="file" 
                              id="clone-file-input" 
                              accept="audio/*" 
                              onChange={(e) => {
                                if (e.target.files && e.target.files.length > 0) setCloneAudioFile(e.target.files[0]);
                              }}
                              className="hidden" 
                            />
                          </div>
                        ) : (
                          <div className="flex justify-between items-center bg-neutral-950/60 border border-neutral-800 px-4 py-2.5 rounded-xl text-xs">
                            <div className="flex items-center gap-2 truncate">
                              <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                              <span className="text-neutral-300 font-semibold truncate">{cloneAudioFile.name}</span>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => setCloneAudioFile(null)} 
                              className="text-neutral-500 hover:text-red-400 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-neutral-400">Reference Audio Transcript (Highly Recommended)</label>
                        <input 
                          type="text" 
                          value={cloneRefTranscript}
                          onChange={(e) => setCloneRefTranscript(e.target.value)}
                          placeholder="Type exactly what the reference audio clip says..."
                          className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-2.5 text-xs focus:border-purple-500 focus:outline-none w-full"
                        />
                      </div>
                    </div>
                  )}

                  {/* Text Input */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-neutral-300">Text to Speak</label>
                    <textarea 
                      value={cloneText}
                      onChange={(e) => setCloneText(e.target.value)}
                      rows={4}
                      placeholder="Enter the text you want to synthesize in the cloned voice..."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-sm focus:border-purple-500 focus:outline-none w-full resize-y"
                      required
                    />
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleTextDrop(e, setCloneText)}
                      className="border border-dashed border-neutral-800 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl p-4 text-center text-xs text-neutral-500 hover:text-neutral-400 transition-all cursor-default"
                    >
                      Drag & drop a .txt file here to import text content.
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3.5 px-6 rounded-xl text-sm font-bold shadow-lg shadow-purple-950/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Cloning & Synthesizing...</span>
                      </>
                    ) : (
                      <>
                        <Layers className="w-4 h-4" />
                        <span>Clone & Generate</span>
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Preview */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl min-h-[300px] flex flex-col">
                  <h3 className="text-sm font-bold text-neutral-300 mb-4">Generation Preview</h3>
                  
                  {!cloneAudioResult ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-xl">
                      <div className="w-12 h-12 rounded-full bg-neutral-800/60 flex items-center justify-center text-neutral-500 mb-3">
                        <FileText className="w-5 h-5" />
                      </div>
                      <p className="text-sm text-neutral-400 font-medium">No active generation</p>
                      <p className="text-xs text-neutral-500 mt-1">Generated audio will appear here</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-neutral-950/40 border border-neutral-800 px-3.5 py-2 rounded-xl">
                          <span className="text-xs font-bold text-purple-400">Voice Cloning</span>
                          <span className="text-[10px] font-semibold text-neutral-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {cloneAudioResult.time}
                          </span>
                        </div>
                        <div className="bg-neutral-950/60 p-4 border border-neutral-800 rounded-xl">
                          <p className="text-xs italic text-neutral-300 leading-relaxed">
                            {cloneAudioResult.text.length > 250 ? `${cloneAudioResult.text.slice(0, 250)}...` : cloneAudioResult.text}
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => playTrack(cloneAudioResult.url, cloneAudioResult.title, 'Voice Cloning')}
                        className="mt-6 w-full py-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700/80 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                      >
                        <Play className="w-4 h-4 fill-white" /> Play Audio Result
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Saved Voices Panel */}
          {activeTab === 'saved' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              {/* Enrollment Form */}
              <div className="lg:col-span-2 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-neutral-300 mb-1">Enroll New Voice Profile</h3>
                <p className="text-xs text-neutral-500 mb-6">Record a short 5-10s clip and create a reusable voice profile.</p>

                {enrollSuccessMessage && (
                  <div className="mb-5 p-3.5 bg-emerald-950/40 border border-emerald-900/50 text-emerald-400 text-xs font-medium rounded-xl flex items-center gap-2.5">
                    <CheckCircle className="w-4.5 h-4.5 shrink-0" /> {enrollSuccessMessage}
                  </div>
                )}

                <form onSubmit={handleEnrollVoice} className="space-y-5">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-neutral-300">Voice Profile Name</label>
                    <input 
                      type="text" 
                      value={enrollName}
                      onChange={(e) => setEnrollName(e.target.value)}
                      placeholder="e.g. Morgan, Boss, Clara"
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-xs focus:border-purple-500 focus:outline-none w-full"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-neutral-300">Reference Audio File (WAV)</label>
                    {!enrollAudioFile ? (
                      <div 
                        onClick={() => document.getElementById('enroll-file-input')?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer.files.length > 0) setEnrollAudioFile(e.dataTransfer.files[0]);
                        }}
                        className="border border-dashed border-neutral-850 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl py-6 px-4 text-center cursor-pointer transition-all"
                      >
                        <Upload className="w-8 h-8 text-neutral-500 mx-auto mb-2" />
                        <p className="text-xs text-neutral-400 font-medium">Drag reference audio here or click to browse</p>
                        <span className="text-[10px] text-neutral-600 mt-1 block">WAV file, preferably mono, 24kHz (5-10s clip)</span>
                        <input 
                          type="file" 
                          id="enroll-file-input" 
                          accept="audio/wav" 
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) setEnrollAudioFile(e.target.files[0]);
                          }}
                          className="hidden" 
                          required
                        />
                      </div>
                    ) : (
                      <div className="flex justify-between items-center bg-neutral-950/60 border border-neutral-800 px-4 py-2.5 rounded-xl text-xs">
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                          <span className="text-neutral-300 font-semibold truncate">{enrollAudioFile.name}</span>
                        </div>
                        <button 
                          type="button" 
                          onClick={() => setEnrollAudioFile(null)} 
                          className="text-neutral-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-neutral-300">Transcript (Very Important)</label>
                    <textarea 
                      value={enrollTranscript}
                      onChange={(e) => setEnrollTranscript(e.target.value)}
                      rows={3}
                      placeholder="Type EXACTLY what the reference audio clip says. Good transcripts ensure accurate voice replication."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-xs focus:border-purple-500 focus:outline-none w-full resize-none"
                      required
                    />
                  </div>

                  <button 
                    type="submit" 
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3 px-6 rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Loader2 className="w-4.5 h-4.5 animate-spin" /> Saving Profile...
                      </span>
                    ) : (
                      'Save Voice Profile'
                    )}
                  </button>
                </form>
              </div>

              {/* Voice Gallery List */}
              <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl min-h-[400px]">
                <h3 className="text-sm font-bold text-neutral-300 mb-6">Saved Voice Profiles ({savedVoices.length})</h3>

                {savedVoices.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center p-12 border border-dashed border-neutral-800 rounded-xl">
                    <Save className="w-8 h-8 text-neutral-600 mb-3" />
                    <p className="text-xs text-neutral-400 font-medium">No custom voice profiles saved yet</p>
                    <p className="text-[10px] text-neutral-500 mt-1">Enroll a profile on the left to clone voices.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {savedVoices.map(v => (
                      <div key={v.name} className="p-4 bg-neutral-950/60 border border-neutral-800/80 rounded-xl flex flex-col justify-between gap-4 group hover:border-neutral-700/80 transition-all shadow-sm">
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold text-neutral-200 capitalize">{v.name.replace(/_/g, ' ')}</h4>
                          <p className="text-[10px] text-neutral-500 italic line-clamp-3 bg-neutral-900/20 p-2 rounded-lg border border-neutral-850">
                            "{v.transcript}"
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => playTrack(v.audio_url, `Sample: ${v.name}`, 'Voice Profile')}
                            className="flex-1 py-2 px-3 bg-neutral-800 hover:bg-neutral-750 text-white rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 border border-neutral-750 transition-all"
                          >
                            <Play className="w-3 h-3 fill-white" /> Play Reference
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Model Manager Panel */}
          {activeTab === 'model' && (
            <div className="space-y-6">
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-neutral-300 mb-2">Local Model Registry</h3>
                <p className="text-xs text-neutral-400 max-w-3xl leading-relaxed">
                  Qwen3-TTS runs completely locally on your Mac. Select models to download from HuggingFace and load them into memory. Pro models (1.7B params) provide state-of-the-art voice cloning and expression details, while Lite models (0.6B params) operate with much faster speeds and low RAM requirements.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {models.map(m => {
                  const isActive = activeModel.model_id === m.id && activeModel.status === 'loaded';
                  const isLoading = activeModel.model_id === m.id && activeModel.status === 'loading';
                  
                  return (
                    <div 
                      key={m.id} 
                      className={`p-5 bg-neutral-900/40 border rounded-2xl flex flex-col justify-between gap-5 transition-all shadow-md relative overflow-hidden ${
                        isActive ? 'border-purple-500/50 shadow-purple-950/5' : 'border-neutral-800/80 hover:border-neutral-700/80'
                      }`}
                    >
                      {isActive && (
                        <div className="absolute top-0 right-0 bg-purple-600 text-white text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-bl-lg">
                          Active
                        </div>
                      )}

                      <div className="space-y-3">
                        <div>
                          <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                            m.quality.startsWith('Pro') ? 'bg-indigo-950 text-indigo-300 border border-indigo-900/40' : 'bg-teal-950 text-teal-300 border border-teal-900/40'
                          }`}>
                            {m.quality}
                          </span>
                          <h4 className="text-sm font-bold text-neutral-100 mt-2 tracking-tight">{m.name}</h4>
                        </div>
                        <p className="text-xs text-neutral-400 leading-normal">
                          {m.id === '1' && 'Premium 1.7B model optimized for presets. Gives high emotional control and expressiveness.'}
                          {m.id === '2' && 'Premium 1.7B model. Generates unique voices entirely from detailed textual prompt descriptions.'}
                          {m.id === '3' && 'Premium 1.7B base model optimized for high-fidelity zero-shot voice cloning.'}
                          {m.id === '4' && 'Fast 0.6B model. Quick generation speed and light on RAM, with support for emotion presets.'}
                          {m.id === '5' && 'Fast 0.6B model. Quickly creates unique designed voices based on text descriptions.'}
                          {m.id === '6' && 'Fast 0.6B model. Performs low-latency zero-shot voice cloning from audio files.'}
                        </p>
                        <div className="text-[10px] text-neutral-500 font-mono select-all">
                          {m.repo_id}
                        </div>
                      </div>

                      <div className="space-y-3.5 pt-2 border-t border-neutral-850">
                        {/* Downloader Status */}
                        {m.status === 'downloading' && (
                          <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400">
                              <span>Downloading weights...</span>
                              <span>{m.progress || 0}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-neutral-950 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                                style={{ width: `${m.progress || 0}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {m.status === 'failed' && (
                          <div className="p-2.5 bg-red-950/20 border border-red-900/30 rounded-xl flex items-start gap-2 text-[10px] text-red-400">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <div className="leading-relaxed font-semibold">
                              Download failed. Try triggering again.
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2.5">
                          {m.status === 'Completed' || m.status === 'downloaded' ? (
                            <button
                              onClick={() => triggerLoad(m.id)}
                              disabled={isActive || isLoading || loadingActiveModel}
                              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                                isActive 
                                  ? 'bg-emerald-950/20 border border-emerald-900/50 text-emerald-400 cursor-default' 
                                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-md'
                              }`}
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span>Loading weights...</span>
                                </>
                              ) : isActive ? (
                                <>
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Active in Memory</span>
                                </>
                              ) : (
                                <span>Load Model</span>
                              )}
                            </button>
                          ) : m.status === 'downloading' ? (
                            <button
                              disabled
                              className="flex-1 py-2 px-3 bg-neutral-800 text-neutral-500 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed border border-neutral-750"
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Downloading...</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => triggerDownload(m.id)}
                              className="flex-1 py-2 px-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700/80 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Model</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* History Panel */}
          {activeTab === 'history' && (
            <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-6 border-b border-neutral-800/80 flex items-center justify-between">
                <h3 className="text-sm font-bold text-neutral-300">Generated Clips History ({history.length})</h3>
                <button 
                  onClick={fetchHistory}
                  className="p-2 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center p-16">
                  <HistoryIcon className="w-10 h-10 text-neutral-600 mb-3" />
                  <p className="text-sm text-neutral-400 font-medium">No generated files in history</p>
                  <p className="text-xs text-neutral-500 mt-1">Audio creations will be logged here for easy local management.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="bg-neutral-950/40 border-b border-neutral-850 text-neutral-400 font-semibold">
                        <th className="px-6 py-4">Created Date</th>
                        <th className="px-6 py-4">Content / Text Snippet</th>
                        <th className="px-6 py-4">Generation Mode</th>
                        <th className="px-6 py-4">File Size</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-850">
                      {history.map(item => (
                        <tr key={item.filename} className="hover:bg-neutral-900/25 transition-all">
                          <td className="px-6 py-4 text-neutral-300 font-semibold whitespace-nowrap">{item.created_at}</td>
                          <td className="px-6 py-4 text-neutral-300 font-medium max-w-sm truncate italic">
                            "{item.clean_name}"
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                              item.subfolder === 'CustomVoice' ? 'bg-indigo-950 text-indigo-300 border border-indigo-900/40' :
                              item.subfolder === 'VoiceDesign' ? 'bg-purple-950 text-purple-300 border border-purple-900/40' :
                              'bg-pink-950 text-pink-300 border border-pink-900/40'
                            }`}>
                              {item.subfolder.replace(/Voice/g, ' Voice').trim()}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-neutral-500 font-medium font-mono whitespace-nowrap">
                            {(item.size_bytes / 1024 / 1024).toFixed(2)} MB
                          </td>
                          <td className="px-6 py-4 text-right whitespace-nowrap">
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => playTrack(item.audio_url, item.clean_name, item.subfolder.replace(/Voice/g, ' Voice'))}
                                className="p-2 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 text-white rounded-lg transition-all"
                              >
                                <Play className="w-3.5 h-3.5 fill-white" />
                              </button>
                              <a
                                href={item.audio_url}
                                download
                                className="p-2 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 text-white rounded-lg transition-all flex items-center justify-center"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              <button
                                onClick={() => handleDeleteHistory(item.subfolder, item.filename)}
                                className="p-2 bg-neutral-800 hover:bg-red-950/40 border border-neutral-700 hover:border-red-900 text-white hover:text-red-400 rounded-lg transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* AI Prompter Panel */}
          {activeTab === 'ai' && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
              <div className="lg:col-span-2 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl">
                <h3 className="text-sm font-bold text-neutral-300 mb-1">AI Prompter</h3>
                <p className="text-xs text-neutral-500 mb-6">Analyze reference images, videos or documents with Gemini 2.5 Flash.</p>

                <form onSubmit={handleAiPrompter} className="space-y-6">
                  {/* Media Uploader */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-neutral-300">Upload Reference File (Image/PDF/Video)</label>
                    {!aiFile ? (
                      <div 
                        onClick={() => document.getElementById('ai-file-input')?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer.files.length > 0) setAiFile(e.dataTransfer.files[0]);
                        }}
                        className="border border-dashed border-neutral-850 hover:border-purple-500/40 bg-neutral-950/40 rounded-xl py-8 px-4 text-center cursor-pointer transition-all"
                      >
                        <Upload className="w-8 h-8 text-neutral-500 mx-auto mb-2" />
                        <p className="text-xs text-neutral-400 font-medium">Drag reference file here or click to browse</p>
                        <span className="text-[10px] text-neutral-600 mt-1 block">Supports Image, PDF, Video (Up to 20MB)</span>
                        <input 
                          type="file" 
                          id="ai-file-input" 
                          accept="image/*,video/*,application/pdf" 
                          onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) setAiFile(e.target.files[0]);
                          }}
                          className="hidden" 
                          required
                        />
                      </div>
                    ) : (
                      <div className="flex justify-between items-center bg-neutral-950/60 border border-neutral-800 px-4 py-2.5 rounded-xl text-xs">
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="w-4 h-4 text-purple-400 shrink-0" />
                          <span className="text-neutral-300 font-semibold truncate">{aiFile.name}</span>
                        </div>
                        <button 
                          type="button" 
                          onClick={() => setAiFile(null)} 
                          className="text-neutral-500 hover:text-red-400 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Question */}
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-neutral-300">Prompt / Question</label>
                    <textarea 
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      rows={4}
                      placeholder="Ask a question about the file (e.g. Describe this image, what text is in this image?)..."
                      className="bg-neutral-950 border border-neutral-800 text-neutral-200 rounded-xl px-4 py-3 text-xs focus:border-purple-500 focus:outline-none w-full resize-none"
                      required
                    />
                  </div>

                  <button 
                    type="submit" 
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white py-3 px-6 rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <span className="flex items-center justify-center gap-1.5">
                        <Loader2 className="w-4.5 h-4.5 animate-spin" /> Thinking...
                      </span>
                    ) : (
                      'Generate Response'
                    )}
                  </button>
                </form>
              </div>

              {/* Response */}
              <div className="lg:col-span-3 bg-neutral-900/40 border border-neutral-800/80 rounded-2xl p-6 shadow-xl min-h-[400px] flex flex-col">
                <h3 className="text-sm font-bold text-neutral-300 mb-4">Gemini Response</h3>
                
                {!aiResponse ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 border border-dashed border-neutral-800 rounded-xl">
                    <div className="w-12 h-12 rounded-full bg-neutral-800/60 flex items-center justify-center text-neutral-500 mb-3">
                      <Brain className="w-5 h-5" />
                    </div>
                    <p className="text-xs text-neutral-400 font-medium">Waiting for question...</p>
                    <p className="text-[10px] text-neutral-500 mt-1">Upload a file and ask a question to analyze.</p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col">
                    <div className="flex justify-between items-center bg-neutral-950/40 border border-neutral-800 px-3.5 py-2 rounded-xl mb-4">
                      <span className="text-[10px] font-black uppercase tracking-wider text-purple-400">Gemini 2.5 Flash</span>
                      <span className="text-[10px] font-semibold text-neutral-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {aiResponse.time}
                      </span>
                    </div>
                    <div className="bg-neutral-950/60 p-5 border border-neutral-800 rounded-xl flex-1 overflow-y-auto">
                      <p className="text-xs text-neutral-200 leading-relaxed whitespace-pre-wrap font-medium">
                        {aiResponse.text}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Persistent Bottom Audio Player Bar */}
      {currentPlayback && (
        <footer className="fixed bottom-0 left-0 right-0 h-24 bg-neutral-900/90 backdrop-blur-xl border-t border-neutral-800 flex items-center justify-between px-8 z-50">
          <div className="flex items-center gap-5 w-1/4 min-w-0">
            <div className="space-y-1 truncate">
              <h4 className="text-xs font-bold text-white truncate capitalize">{currentPlayback.title.replace(/_/g, ' ')}</h4>
              <p className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider">{currentPlayback.subtitle}</p>
            </div>
            <button 
              onClick={togglePlayback}
              className="w-10 h-10 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-all shrink-0 hover:scale-105 shadow-md shadow-purple-900/10"
            >
              {isPlaying ? <Pause className="w-4.5 h-4.5 fill-white text-white" /> : <Play className="w-4.5 h-4.5 fill-white text-white ml-0.5" />}
            </button>
          </div>

          <div className="flex flex-col items-center gap-2 flex-1 max-w-xl">
            {/* Custom Canvas Waveform Animation */}
            <div className="w-full h-8 flex items-center justify-center">
              <canvas ref={canvasRef} width="400" height="30" className="opacity-80" />
            </div>
            
            {/* Timeline */}
            <div className="flex items-center gap-3 w-full text-[10px] text-neutral-500 font-bold font-mono">
              <span>{formatTimeStr(currentTime)}</span>
              <div 
                onClick={handleProgressChange}
                className="flex-1 h-1.5 bg-neutral-950 rounded-full cursor-pointer relative overflow-hidden group border border-neutral-850"
              >
                <div 
                  className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 group-hover:from-purple-400 group-hover:to-indigo-400"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>
              <span>{formatTimeStr(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-6 w-1/4 min-w-[200px]">
            {/* Volume Control */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  const newVol = volume === 0 ? 0.8 : 0;
                  setVolume(newVol);
                  if (audioRef.current) audioRef.current.volume = newVol;
                }}
                className="text-neutral-400 hover:text-white transition-colors"
              >
                {volume === 0 ? <VolumeX className="w-4.5 h-4.5" /> : <Volume2 className="w-4.5 h-4.5" />}
              </button>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                className="w-20 accent-purple-500 h-1 rounded-lg cursor-pointer bg-neutral-950 border border-neutral-850" 
              />
            </div>

            {/* Direct Download */}
            <a 
              href={currentPlayback.url} 
              download 
              className="py-2 px-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-750 hover:border-neutral-600 text-white rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
          </div>
        </footer>
      )}

      {/* Hidden HTML5 Audio Element */}
      <audio 
        ref={audioRef} 
        className="hidden" 
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onDurationChange={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
      />
    </div>
  );
}
