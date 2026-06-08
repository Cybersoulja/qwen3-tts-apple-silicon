// App State
let appState = {
    selectedModel: null,     // '3' (Pro) or '6' (Lite)
    selectedVoice: null,     // Name of selected voice from library
    quickRefFile: null,      // Quick reference file upload
    recordedBlob: null,      // Recorded audio blob
    mediaRecorder: null,
    audioChunks: [],
    recordingTimer: null,
    recordingSeconds: 0,
    wavesurfer: null,        // Main Wavesurfer instance
    isPlaying: false,
    pollingIntervals: {}     // Model download polling intervals
};

// DOM Elements
const elements = {
    voicesList: document.getElementById('voices-list'),
    enrollForm: document.getElementById('enroll-form'),
    enrollName: document.getElementById('enroll-name'),
    enrollTranscript: document.getElementById('enroll-transcript'),
    uploadFile: document.getElementById('upload-file'),
    recordBtn: document.getElementById('record-btn'),
    recordingStatus: document.getElementById('recording-status'),
    recordingTimerDisp: document.getElementById('recording-timer'),
    stopRecordBtn: document.getElementById('stop-record-btn'),
    refPreviewContainer: document.getElementById('ref-preview-container'),
    refPreviewFilename: document.getElementById('ref-preview-filename'),
    refPreviewPlayer: document.getElementById('ref-preview-player'),
    clearRefBtn: document.getElementById('clear-ref-btn'),
    
    // Synthesis Studio
    modelCards: {
        '3': document.getElementById('model-card-3'),
        '6': document.getElementById('model-card-6')
    },
    selectedVoiceDisplay: document.getElementById('selected-voice-display'),
    targetText: document.getElementById('target-text'),
    charCount: document.getElementById('char-count'),
    clearTextBtn: document.getElementById('clear-text-btn'),
    speedSlider: document.getElementById('speed-slider'),
    speedVal: document.getElementById('speed-val'),
    outputCustomName: document.getElementById('output-custom-name'),
    
    // Quick clone
    quickUploadFile: document.getElementById('quick-upload-file'),
    quickRefInfo: document.getElementById('quick-ref-info'),
    quickRefName: document.getElementById('quick-ref-name'),
    quickRefTranscript: document.getElementById('quick-ref-transcript'),
    clearQuickRefBtn: document.getElementById('clear-quick-ref-btn'),
    
    generateBtn: document.getElementById('generate-btn'),
    
    // Output player
    outputPlayerCard: document.getElementById('output-player-card'),
    wavePlayBtn: document.getElementById('wave-play-btn'),
    wavePlayLocal: document.getElementById('wave-play-local'),
    waveDownloadLink: document.getElementById('wave-download-link'),
    
    // History
    historyList: document.getElementById('history-list'),
    
    // Global displays
    activeModelDisplay: document.getElementById('active-model-display')
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // Re-render Lucide icons
    lucide.createIcons();
    
    // Fetch data
    fetchModels();
    fetchVoices();
    fetchHistory();
    
    // Set up event listeners
    setupEventListeners();
}

function setupEventListeners() {
    // Model Selection
    Object.keys(elements.modelCards).forEach(key => {
        elements.modelCards[key].addEventListener('click', () => selectModel(key));
    });
    
    // Enroll Audio Source Handlers
    elements.recordBtn.addEventListener('click', startRecording);
    elements.stopRecordBtn.addEventListener('click', stopRecording);
    elements.uploadFile.addEventListener('change', handleUploadFile);
    elements.clearRefBtn.addEventListener('click', clearRefAudio);
    
    // Enroll Form Submit
    elements.enrollForm.addEventListener('submit', handleEnrollSubmit);
    
    // Preset Texts
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.targetText.value = e.target.getAttribute('data-text');
            updateCharCount();
            validateGenerateState();
        });
    });
    
    // Target Textarea Counters/Validators
    elements.targetText.addEventListener('input', () => {
        updateCharCount();
        validateGenerateState();
    });
    elements.clearTextBtn.addEventListener('click', () => {
        elements.targetText.value = '';
        updateCharCount();
        validateGenerateState();
    });
    
    // Speed Slider
    elements.speedSlider.addEventListener('input', (e) => {
        elements.speedVal.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
    });
    
    // Quick clone file handler
    elements.quickUploadFile.addEventListener('change', handleQuickUploadFile);
    elements.clearQuickRefBtn.addEventListener('click', clearQuickRefAudio);
    
    // Generate Button
    elements.generateBtn.addEventListener('click', generateVoiceClone);
    
    // Mini Wavesurfer setup placeholder logic, we'll initialize it dynamically
    elements.wavePlayBtn.addEventListener('click', toggleWavePlayback);
}

// Model Management
async function fetchModels() {
    try {
        const response = await fetch('/api/models');
        if (!response.ok) throw new Error("Failed to load models");
        const models = await response.json();
        
        models.forEach(model => {
            const card = elements.modelCards[model.key];
            const statusLabel = card.querySelector('.model-status-text');
            const downloadBtn = card.querySelector('.download-model-btn');
            
            // Clear click handlers from download button to prevent multiple bindings
            const newDownloadBtn = downloadBtn.cloneNode(true);
            downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
            
            if (model.status === 'Completed' || model.downloaded) {
                statusLabel.textContent = "Downloaded";
                statusLabel.style.color = "var(--success)";
                newDownloadBtn.classList.add('hidden');
                card.classList.remove('downloading');
                
                // Clear interval if completed
                if (appState.pollingIntervals[model.key]) {
                    clearInterval(appState.pollingIntervals[model.key]);
                    delete appState.pollingIntervals[model.key];
                    showToast(`Model ${model.name} downloaded successfully!`, 'success');
                }
            } else if (model.status === 'Downloading') {
                statusLabel.textContent = "Downloading...";
                statusLabel.style.color = "var(--warning)";
                newDownloadBtn.classList.add('hidden');
                card.classList.add('downloading');
                
                // Start polling if not already started
                if (!appState.pollingIntervals[model.key]) {
                    startPollingModel(model.key);
                }
            } else {
                statusLabel.textContent = model.status;
                statusLabel.style.color = "var(--text-muted)";
                newDownloadBtn.classList.remove('hidden');
                
                newDownloadBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Avoid card click selection
                    downloadModel(model.key);
                });
            }
        });
        
        // Reapply active visual
        if (appState.selectedModel) {
            Object.keys(elements.modelCards).forEach(key => {
                if (key === appState.selectedModel) {
                    elements.modelCards[key].classList.add('active');
                } else {
                    elements.modelCards[key].classList.remove('active');
                }
            });
        }
    } catch (err) {
        console.error(err);
        showToast("Error checking models status", "error");
    }
}

async function downloadModel(modelKey) {
    try {
        const response = await fetch(`/api/models/download?model_key=${modelKey}`, { method: 'POST' });
        if (!response.ok) throw new Error("Download trigger failed");
        
        showToast("Model download started in the background...", "info");
        fetchModels(); // Instantly refresh status to show downloading
    } catch (err) {
        showToast(err.message, "error");
    }
}

function startPollingModel(modelKey) {
    appState.pollingIntervals[modelKey] = setInterval(() => {
        fetchModels();
    }, 4000);
}

function selectModel(modelKey) {
    const card = elements.modelCards[modelKey];
    
    // Check if model is downloaded
    const isDownloaded = card.querySelector('.model-status-text').textContent === "Downloaded";
    if (!isDownloaded) {
        showToast("Please download this model before selecting it.", "warning");
        return;
    }
    
    appState.selectedModel = modelKey;
    
    // Visual toggle
    Object.keys(elements.modelCards).forEach(key => {
        elements.modelCards[key].classList.remove('active');
    });
    card.classList.add('active');
    
    // Update header status
    const modelName = modelKey === '3' ? "Qwen3 1.7B Base (Pro)" : "Qwen3 0.6B Base (Lite)";
    elements.activeModelDisplay.textContent = `Model: ${modelName}`;
    
    validateGenerateState();
}

// Voice Library Management
async function fetchVoices() {
    try {
        const response = await fetch('/api/voices');
        if (!response.ok) throw new Error("Failed to load voices");
        const voices = await response.json();
        
        if (voices.length === 0) {
            elements.voicesList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="user-x"></i>
                    <p>No enrolled voices. Enroll a voice below to get started!</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }
        
        elements.voicesList.innerHTML = '';
        voices.forEach(voice => {
            const card = document.createElement('div');
            card.className = `voice-card ${appState.selectedVoice === voice.name ? 'active' : ''}`;
            card.dataset.name = voice.name;
            
            const initials = voice.name.slice(0, 2).toUpperCase();
            
            card.innerHTML = `
                <div class="voice-card-info">
                    <div class="voice-avatar">${initials}</div>
                    <div class="voice-details">
                        <span class="voice-name">${voice.name.replace(/_/g, ' ')}</span>
                        <span class="voice-transcript-snippet" title="${voice.transcript}">${voice.transcript}</span>
                    </div>
                </div>
                <button class="voice-play-btn" title="Preview reference audio">
                    <i data-lucide="play"></i>
                </button>
            `;
            
            // Selection event (clicking anywhere except the play button)
            card.addEventListener('click', (e) => {
                if (e.target.closest('.voice-play-btn')) return;
                selectVoice(voice.name);
            });
            
            // Play Reference Audio event
            const playBtn = card.querySelector('.voice-play-btn');
            let isRefPlaying = false;
            let refAudioObj = new Audio(voice.audio_url);
            
            refAudioObj.addEventListener('ended', () => {
                isRefPlaying = false;
                playBtn.innerHTML = '<i data-lucide="play"></i>';
                lucide.createIcons();
            });
            
            playBtn.addEventListener('click', () => {
                if (isRefPlaying) {
                    refAudioObj.pause();
                    isRefPlaying = false;
                    playBtn.innerHTML = '<i data-lucide="play"></i>';
                } else {
                    // Stop any other HTML5 Audio
                    document.querySelectorAll('audio').forEach(el => el.pause());
                    refAudioObj.play();
                    isRefPlaying = true;
                    playBtn.innerHTML = '<i data-lucide="pause"></i>';
                }
                lucide.createIcons();
            });
            
            elements.voicesList.appendChild(card);
        });
        
        lucide.createIcons();
    } catch (err) {
        console.error(err);
        showToast("Error loading enrolled voices", "error");
    }
}

function selectVoice(voiceName) {
    if (appState.selectedVoice === voiceName) {
        // Deselect
        appState.selectedVoice = null;
        elements.selectedVoiceDisplay.innerHTML = `
            <i data-lucide="user-x" class="display-icon"></i>
            <span>No voice selected. Click a voice in the Library or upload reference.</span>
        `;
        elements.selectedVoiceDisplay.classList.add('empty');
    } else {
        appState.selectedVoice = voiceName;
        
        // Clear quick reference file if any
        clearQuickRefAudio();
        
        elements.selectedVoiceDisplay.innerHTML = `
            <i data-lucide="user-check" class="display-icon"></i>
            <span>Cloning: <strong>${voiceName.replace(/_/g, ' ')}</strong></span>
        `;
        elements.selectedVoiceDisplay.classList.remove('empty');
    }
    
    // Visual update of list
    document.querySelectorAll('.voice-card').forEach(card => {
        if (card.dataset.name === appState.selectedVoice) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });
    
    lucide.createIcons();
    validateGenerateState();
}

// Live Audio Recording logic
async function startRecording() {
    if (appState.mediaRecorder && appState.mediaRecorder.state === "recording") return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        appState.audioChunks = [];
        appState.mediaRecorder = new MediaRecorder(stream);
        
        appState.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                appState.audioChunks.push(event.data);
            }
        };
        
        appState.mediaRecorder.onstop = () => {
            appState.recordedBlob = new Blob(appState.audioChunks, { type: 'audio/wav' });
            
            // Setup preview
            const url = URL.createObjectURL(appState.recordedBlob);
            elements.refPreviewPlayer.src = url;
            elements.refPreviewFilename.textContent = `Recorded_Audio_${Date.now().toString().slice(-4)}.wav`;
            elements.refPreviewContainer.classList.remove('hidden');
            
            // Clear recording state visual
            elements.recordingStatus.classList.add('hidden');
            elements.recordBtn.classList.remove('hidden');
            
            // Set for form upload
            appState.quickRefFile = null; // Prioritize recording
        };
        
        appState.mediaRecorder.start();
        
        // Show recording visual
        elements.recordingStatus.classList.remove('hidden');
        elements.recordBtn.classList.add('hidden');
        
        // Start Timer
        appState.recordingSeconds = 0;
        elements.recordingTimerDisp.textContent = "00:00";
        appState.recordingTimer = setInterval(() => {
            appState.recordingSeconds++;
            const mins = Math.floor(appState.recordingSeconds / 60).toString().padStart(2, '0');
            const secs = (appState.recordingSeconds % 60).toString().padStart(2, '0');
            elements.recordingTimerDisp.textContent = `${mins}:${secs}`;
        }, 1000);
        
    } catch (err) {
        console.error(err);
        showToast("Microphone access denied or failed", "error");
    }
}

function stopRecording() {
    if (appState.mediaRecorder && appState.mediaRecorder.state === "recording") {
        appState.mediaRecorder.stop();
        // Stop stream tracks
        appState.mediaRecorder.stream.getTracks().forEach(track => track.stop());
        clearInterval(appState.recordingTimer);
    }
}

function handleUploadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    appState.quickRefFile = file;
    appState.recordedBlob = null;
    
    const url = URL.createObjectURL(file);
    elements.refPreviewPlayer.src = url;
    elements.refPreviewFilename.textContent = file.name;
    elements.refPreviewContainer.classList.remove('hidden');
    elements.recordBtn.classList.add('hidden');
}

function clearRefAudio() {
    elements.refPreviewPlayer.pause();
    elements.refPreviewPlayer.src = '';
    elements.refPreviewContainer.classList.add('hidden');
    elements.recordBtn.classList.remove('hidden');
    elements.uploadFile.value = '';
    appState.quickRefFile = null;
    appState.recordedBlob = null;
}

// Quick Clone Upload Logic
function handleQuickUploadFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    appState.quickRefFile = file;
    // Clear selection in Voice Library
    if (appState.selectedVoice) {
        selectVoice(appState.selectedVoice);
    }
    
    elements.quickRefName.textContent = file.name;
    elements.quickRefInfo.classList.remove('hidden');
    
    validateGenerateState();
}

function clearQuickRefAudio() {
    elements.quickUploadFile.value = '';
    elements.quickRefInfo.classList.add('hidden');
    appState.quickRefFile = null;
    elements.quickRefTranscript.value = '';
    validateGenerateState();
}

// Enroll Voice Submit
async function handleEnrollSubmit(e) {
    e.preventDefault();
    
    const name = elements.enrollName.value.strip();
    const transcript = elements.enrollTranscript.value.strip();
    const audioFile = appState.quickRefFile || (appState.recordedBlob ? new File([appState.recordedBlob], "recorded.wav", {type: "audio/wav"}) : null);
    
    if (!name || !transcript || !audioFile) {
        showToast("Please complete all fields and record or upload audio", "warning");
        return;
    }
    
    const submitBtn = document.getElementById('submit-enroll');
    const originalContent = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<div class="spinner"></div> <span>Enrolling...</span>';
    
    const formData = new FormData();
    formData.append('name', name);
    formData.append('transcript', transcript);
    formData.append('file', audioFile);
    
    try {
        const response = await fetch('/api/voices/enroll', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Failed to enroll voice");
        }
        
        showToast(`Voice '${name}' successfully enrolled!`, 'success');
        elements.enrollForm.reset();
        clearRefAudio();
        fetchVoices();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalContent;
    }
}

// Generate Voice Clone
async function generateVoiceClone() {
    const text = elements.targetText.value.trim();
    const speed = parseFloat(elements.speedSlider.value);
    const customPrefix = elements.outputCustomName.value.trim();
    
    if (!appState.selectedModel) {
        showToast("Please select a model size first", "warning");
        return;
    }
    
    if (!text) {
        showToast("Please enter target script text", "warning");
        return;
    }
    
    if (!appState.selectedVoice && !appState.quickRefFile) {
        showToast("Please select a voice from the library or upload a quick reference file", "warning");
        return;
    }
    
    // Setup button loading
    elements.generateBtn.disabled = true;
    const btnSpan = elements.generateBtn.querySelector('span');
    const btnIcon = elements.generateBtn.querySelector('.btn-icon');
    const originalText = btnSpan.textContent;
    btnSpan.textContent = "Synthesizing... (typically 5-15s)";
    btnIcon.className = "spinner animate-spin";
    
    const formData = new FormData();
    formData.append('model_key', appState.selectedModel);
    formData.append('text', text);
    formData.append('speed', speed);
    
    if (appState.selectedVoice) {
        formData.append('voice_name', appState.selectedVoice);
    } else if (appState.quickRefFile) {
        formData.append('file', appState.quickRefFile);
        formData.append('ref_text', elements.quickRefTranscript.value.trim() || ".");
    }
    
    try {
        const response = await fetch('/api/clone', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || "Synthesis failed");
        }
        
        const result = await response.json();
        
        // Show result player
        displayOutputResult(result);
        
        // Reload history
        fetchHistory();
        
        showToast("Voice clone generated successfully!", "success");
    } catch (err) {
        console.error(err);
        showToast(err.message, "error");
    } finally {
        elements.generateBtn.disabled = false;
        btnSpan.textContent = originalText;
        btnIcon.className = "";
        btnIcon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
        validateGenerateState();
    }
}

function displayOutputResult(result) {
    elements.outputPlayerCard.classList.remove('hidden');
    
    // Initialize/Update Wavesurfer
    if (appState.wavesurfer) {
        appState.wavesurfer.destroy();
    }
    
    appState.wavesurfer = WaveSurfer.create({
        container: '#waveform',
        waveColor: '#4f46e5',
        progressColor: '#06b6d4',
        cursorColor: '#ffffff',
        barWidth: 2,
        barRadius: 3,
        responsive: true,
        height: 60,
        normalize: true,
        backend: 'WebAudio'
    });
    
    // Load audio URL
    appState.wavesurfer.load(result.url);
    
    // Update play button state
    appState.isPlaying = false;
    elements.wavePlayBtn.innerHTML = '<i data-lucide="play"></i>';
    
    // Waveform events
    appState.wavesurfer.on('ready', () => {
        const duration = appState.wavesurfer.getDuration();
        elements.waveformDuration.textContent = formatTime(duration);
        elements.waveformCurrent.textContent = "0:00";
    });
    
    appState.wavesurfer.on('audioprocess', () => {
        const current = appState.wavesurfer.getCurrentTime();
        elements.waveformCurrent.textContent = formatTime(current);
    });
    
    appState.wavesurfer.on('finish', () => {
        appState.isPlaying = false;
        elements.wavePlayBtn.innerHTML = '<i data-lucide="play"></i>';
        lucide.createIcons();
    });
    
    // Play button callback
    elements.wavePlayBtn.onclick = toggleWavePlayback;
    
    // Play locally afplay trigger
    elements.wavePlayLocal.onclick = () => playLocalAudio(result.filename);
    
    // Download link
    elements.waveDownloadLink.href = result.url;
    elements.waveDownloadLink.download = result.filename;
    
    lucide.createIcons();
    
    // Auto scroll to card
    elements.outputPlayerCard.scrollIntoView({ behavior: 'smooth' });
}

function toggleWavePlayback() {
    if (!appState.wavesurfer) return;
    
    if (appState.isPlaying) {
        appState.wavesurfer.pause();
        appState.isPlaying = false;
        elements.wavePlayBtn.innerHTML = '<i data-lucide="play"></i>';
    } else {
        // Stop any other HTML5 Audio
        document.querySelectorAll('audio').forEach(el => el.pause());
        appState.wavesurfer.play();
        appState.isPlaying = true;
        elements.wavePlayBtn.innerHTML = '<i data-lucide="pause"></i>';
    }
    lucide.createIcons();
}

async function playLocalAudio(filename) {
    try {
        const formData = new FormData();
        formData.append('filename', filename);
        
        showToast("Playing locally on Mac speakers...", "info");
        const response = await fetch('/api/play_local', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error("Local playback failed");
    } catch (err) {
        showToast(err.message, "error");
    }
}

// History Manager
async function fetchHistory() {
    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error("Failed to load history");
        const history = await response.json();
        
        if (history.length === 0) {
            elements.historyList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="history"></i>
                    <p>No history yet. Synthesize audio to see history cards here.</p>
                </div>
            `;
            lucide.createIcons();
            return;
        }
        
        elements.historyList.innerHTML = '';
        history.forEach(item => {
            const card = document.createElement('div');
            card.className = "history-card";
            card.innerHTML = `
                <div class="history-card-header">
                    <span class="history-timestamp">${item.timestamp}</span>
                    <button class="history-delete-btn" title="Delete clone output">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
                <p class="history-text" title="${item.text}">${item.text}</p>
                <div class="history-actions">
                    <button class="history-action-btn play-browser-btn">
                        <i data-lucide="play"></i> Play Browser
                    </button>
                    <button class="history-action-btn play-mac-btn">
                        <i data-lucide="volume-2"></i> Play Mac
                    </button>
                    <a href="${item.url}" download="${item.filename}" class="history-action-btn">
                        <i data-lucide="download"></i> Download
                    </a>
                </div>
            `;
            
            // Delete button handler
            card.querySelector('.history-delete-btn').addEventListener('click', () => deleteHistoryItem(item.filename));
            
            // Browser playback
            const playBrowserBtn = card.querySelector('.play-browser-btn');
            let isItemPlaying = false;
            let audioObj = new Audio(item.url);
            
            audioObj.addEventListener('ended', () => {
                isItemPlaying = false;
                playBrowserBtn.innerHTML = '<i data-lucide="play"></i> Play Browser';
                lucide.createIcons();
            });
            
            playBrowserBtn.addEventListener('click', () => {
                if (isItemPlaying) {
                    audioObj.pause();
                    isItemPlaying = false;
                    playBrowserBtn.innerHTML = '<i data-lucide="play"></i> Play Browser';
                } else {
                    document.querySelectorAll('audio').forEach(el => el.pause());
                    if (appState.wavesurfer) {
                        appState.wavesurfer.pause();
                        appState.isPlaying = false;
                        elements.wavePlayBtn.innerHTML = '<i data-lucide="play"></i>';
                    }
                    audioObj.play();
                    isItemPlaying = true;
                    playBrowserBtn.innerHTML = '<i data-lucide="pause"></i> Pause';
                }
                lucide.createIcons();
            });
            
            // Mac Playback
            card.querySelector('.play-mac-btn').addEventListener('click', () => playLocalAudio(item.filename));
            
            elements.historyList.appendChild(card);
        });
        
        lucide.createIcons();
    } catch (err) {
        console.error(err);
        showToast("Error loading clone history", "error");
    }
}

async function deleteHistoryItem(filename) {
    if (!confirm("Are you sure you want to delete this audio file?")) return;
    
    try {
        const formData = new FormData();
        formData.append('filename', filename);
        const response = await fetch('/api/delete_history', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error("Delete failed");
        
        showToast("File deleted", "info");
        fetchHistory();
    } catch (err) {
        showToast(err.message, "error");
    }
}

// Helpers
function validateGenerateState() {
    const text = elements.targetText.value.trim();
    const hasModel = appState.selectedModel !== null;
    const hasVoice = appState.selectedVoice !== null || appState.quickRefFile !== null;
    
    elements.generateBtn.disabled = !(text && hasModel && hasVoice);
}

function updateCharCount() {
    const len = elements.targetText.value.length;
    elements.charCount.textContent = `${len} characters`;
}

function formatTime(secs) {
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Custom String clean method
String.prototype.strip = function() {
    return this.replace(/^\s+|\s+$/g, '');
};

// Toast notification trigger
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';
    if (type === 'warning') iconName = 'alert-circle';
    
    toast.innerHTML = `
        <i data-lucide="${iconName}" class="toast-icon"></i>
        <div class="toast-text">${message}</div>
        <button class="toast-close"><i data-lucide="x"></i></button>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    // Auto-remove toast after 4 seconds
    const timer = setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
    
    // Close button click
    toast.querySelector('.toast-close').onclick = () => {
        clearTimeout(timer);
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    };
}
