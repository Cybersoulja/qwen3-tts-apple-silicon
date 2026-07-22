import os
import sys
import shutil
import time
import wave
import gc
import re
import threading
import subprocess
import warnings
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

# Suppress harmless library warnings
os.environ["TOKENIZERS_PARALLELISM"] = "false"
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

try:
    from mlx_audio.tts.utils import load_model
    from mlx_audio.tts.generate import generate_audio
    import mlx.core as mx
except ImportError:
    print("Error: 'mlx_audio' or 'mlx' library not found.")
    print("Please make sure your virtual environment is active and requirements are installed.")
    sys.exit(1)

# App setup
app = FastAPI(title="Qwen3-TTS Local Web UI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
BASE_OUTPUT_DIR = os.path.join(os.getcwd(), "outputs")
MODELS_DIR = os.path.join(os.getcwd(), "models")
VOICES_DIR = os.path.join(os.getcwd(), "voices")
STATIC_DIR = os.path.join(os.getcwd(), "static")

os.makedirs(BASE_OUTPUT_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

# System details
SAMPLE_RATE = 24000
FILENAME_MAX_LEN = 30

# Model Definitions
MODELS = {
    "1": {"id": "1", "name": "Custom Voice (Pro)", "folder": "Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit", "mode": "custom", "subfolder": "CustomVoice", "quality": "Pro 1.7B"},
    "2": {"id": "2", "name": "Voice Design (Pro)", "folder": "Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit", "mode": "design", "subfolder": "VoiceDesign", "quality": "Pro 1.7B"},
    "3": {"id": "3", "name": "Voice Cloning (Pro)", "folder": "Qwen3-TTS-12Hz-1.7B-Base-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit", "mode": "clone", "subfolder": "Clones", "quality": "Pro 1.7B"},
    "4": {"id": "4", "name": "Custom Voice (Lite)", "folder": "Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit", "mode": "custom", "subfolder": "CustomVoice", "quality": "Lite 0.6B"},
    "5": {"id": "5", "name": "Voice Design (Lite)", "folder": "Qwen3-TTS-12Hz-0.6B-VoiceDesign-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-VoiceDesign-8bit", "mode": "design", "subfolder": "VoiceDesign", "quality": "Lite 0.6B"},
    "6": {"id": "6", "name": "Voice Cloning (Lite)", "folder": "Qwen3-TTS-12Hz-0.6B-Base-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit", "mode": "clone", "subfolder": "Clones", "quality": "Lite 0.6B"},
}

SPEAKER_MAP = {
    "English": ["Ryan", "Aiden", "Ethan", "Chelsie", "Serena", "Vivian"],
    "Chinese": ["Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric"],
    "Japanese": ["Ono_Anna"],
    "Korean": ["Sohee"]
}

# Global State
CURRENT_MODEL = None
CURRENT_MODEL_KEY = None
CURRENT_MODEL_LOADING = False
model_lock = threading.Lock()
download_lock = threading.Lock()

# Download status tracking
# {model_id: {"status": "idle"|"downloading"|"completed"|"failed", "progress": int, "error": str|None}}
DOWNLOAD_STATUS = {k: {"status": "idle", "progress": 0, "error": None} for k in MODELS.keys()}

# Helper Functions
def get_smart_path(folder_name):
    full_path = os.path.join(MODELS_DIR, folder_name)
    if not os.path.exists(full_path):
        return None

    snapshots_dir = os.path.join(full_path, "snapshots")
    if os.path.exists(snapshots_dir):
        subfolders = [f for f in os.listdir(snapshots_dir) if not f.startswith('.')]
        if subfolders:
            return os.path.join(snapshots_dir, subfolders[0])

    return full_path

def is_model_downloaded(model_id):
    info = MODELS[model_id]
    path = get_smart_path(info["folder"])
    if not path:
        return False
    # Check if there is config file or safetensors inside
    has_files = any(f.endswith((".safetensors", ".json", ".txt")) for f in os.listdir(path))
    return has_files

def run_snapshot_download(model_id: str, repo_id: str, dest_dir: str):
    global DOWNLOAD_STATUS
    try:
        from huggingface_hub import snapshot_download
        DOWNLOAD_STATUS[model_id] = {"status": "downloading", "progress": 20, "error": None}
        
        snapshot_download(
            repo_id=repo_id,
            local_dir=dest_dir,
            local_dir_use_symlinks=False
        )
        DOWNLOAD_STATUS[model_id] = {"status": "completed", "progress": 100, "error": None}
    except Exception as e:
        print(f"Download failed for {repo_id}: {e}")
        DOWNLOAD_STATUS[model_id] = {"status": "failed", "progress": 0, "error": str(e)}

def clean_memory():
    global CURRENT_MODEL
    gc.collect()
    try:
        mx.metal.clear_cache()
    except Exception:
        pass

def convert_audio_if_needed(input_path):
    if not os.path.exists(input_path):
        return None

    filename = os.path.basename(input_path)
    name, ext = os.path.splitext(filename)

    if ext.lower() == ".wav":
        try:
            with wave.open(input_path, 'rb') as f:
                if f.getnchannels() > 0:
                    return input_path
        except wave.Error:
            pass

    temp_wav = os.path.join(os.getcwd(), f"temp_convert_{int(time.time())}.wav")
    print(f"Converting '{ext}' to WAV...")

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", input_path, 
           "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", temp_wav]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return temp_wav
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: Could not convert audio. Is ffmpeg installed?")
        return None

def save_generated_audio(temp_folder, subfolder, text_snippet):
    save_path = os.path.join(BASE_OUTPUT_DIR, subfolder)
    os.makedirs(save_path, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    clean_text = re.sub(r'[^\w\s-]', '', text_snippet)[:FILENAME_MAX_LEN].strip().replace(' ', '_') or "audio"
    filename = f"{timestamp}_{clean_text}.wav"
    final_path = os.path.join(save_path, filename)

    source_file = os.path.join(temp_folder, "audio_000.wav")

    if os.path.exists(source_file):
        shutil.move(source_file, final_path)
        if os.path.exists(temp_folder):
            shutil.rmtree(temp_folder, ignore_errors=True)
        return f"/outputs/{subfolder}/{filename}"
    
    if os.path.exists(temp_folder):
        shutil.rmtree(temp_folder, ignore_errors=True)
    return None

# API Request Models
class LoadModelRequest(BaseModel):
    model_id: str

class CustomTTSRequest(BaseModel):
    text: str
    speaker: str
    emotion: str = "Normal tone"
    speed: float = 1.0

class DesignTTSRequest(BaseModel):
    text: str
    voice_description: str

# API Routes

@app.get("/api/models")
def get_models():
    res = []
    for k, v in MODELS.items():
        downloaded = is_model_downloaded(k)
        status = "downloaded" if downloaded else DOWNLOAD_STATUS[k]["status"]
        res.append({
            "id": v["id"],
            "name": v["name"],
            "quality": v["quality"],
            "mode": v["mode"],
            "folder": v["folder"],
            "repo_id": v["repo_id"],
            "status": status,
            "error": DOWNLOAD_STATUS[k]["error"]
        })
    return res

@app.post("/api/models/download")
def download_model_endpoint(req: LoadModelRequest, background_tasks: BackgroundTasks):
    model_id = req.model_id
    if model_id not in MODELS:
        raise HTTPException(status_code=400, detail="Invalid Model ID")
    
    if is_model_downloaded(model_id):
        return {"status": "downloaded", "message": "Model already downloaded"}

    info = MODELS[model_id]
    dest_dir = os.path.join(MODELS_DIR, info["folder"])
    
    with download_lock:
        if DOWNLOAD_STATUS[model_id]["status"] == "downloading":
            return {"status": "downloading", "message": "Download is already in progress"}
        
        DOWNLOAD_STATUS[model_id] = {"status": "downloading", "progress": 0, "error": None}
        background_tasks.add_task(run_snapshot_download, model_id, info["repo_id"], dest_dir)
        
    return {"status": "downloading", "message": "Download started in background"}

@app.get("/api/models/download/status/{model_id}")
def get_download_status(model_id: str):
    if model_id not in MODELS:
        raise HTTPException(status_code=400, detail="Invalid Model ID")
    
    if is_model_downloaded(model_id):
        return {"status": "downloaded", "progress": 100}
        
    return DOWNLOAD_STATUS[model_id]

@app.get("/api/models/active")
def get_active_model():
    global CURRENT_MODEL_KEY, CURRENT_MODEL_LOADING
    if CURRENT_MODEL_LOADING:
        return {"status": "loading", "model_id": CURRENT_MODEL_KEY}
    if CURRENT_MODEL_KEY:
        return {"status": "loaded", "model_id": CURRENT_MODEL_KEY, "info": MODELS[CURRENT_MODEL_KEY]}
    return {"status": "none", "model_id": None}

@app.post("/api/models/load")
def load_model_endpoint(req: LoadModelRequest, background_tasks: BackgroundTasks):
    global CURRENT_MODEL, CURRENT_MODEL_KEY, CURRENT_MODEL_LOADING
    model_id = req.model_id
    if model_id not in MODELS:
        raise HTTPException(status_code=400, detail="Invalid Model ID")
    
    if not is_model_downloaded(model_id):
        raise HTTPException(status_code=400, detail="Model is not downloaded yet")

    if CURRENT_MODEL_KEY == model_id and CURRENT_MODEL is not None:
        return {"status": "loaded", "message": "Model already loaded"}

    if CURRENT_MODEL_LOADING:
        raise HTTPException(status_code=400, detail="Another model is currently loading")

    def sync_load():
        global CURRENT_MODEL, CURRENT_MODEL_KEY, CURRENT_MODEL_LOADING
        try:
            CURRENT_MODEL_LOADING = True
            # Free previous model
            if CURRENT_MODEL is not None:
                CURRENT_MODEL = None
                clean_memory()
            
            info = MODELS[model_id]
            model_path = get_smart_path(info["folder"])
            print(f"Loading model from {model_path}...")
            
            with model_lock:
                CURRENT_MODEL = load_model(model_path)
                CURRENT_MODEL_KEY = model_id
                
            print("Model loaded successfully!")
        except Exception as e:
            print(f"Failed to load model: {e}")
            CURRENT_MODEL_KEY = None
            CURRENT_MODEL = None
        finally:
            CURRENT_MODEL_LOADING = False

    background_tasks.add_task(sync_load)
    return {"status": "loading", "message": "Model load started in background"}

@app.get("/api/speakers")
def get_speakers():
    return SPEAKER_MAP

@app.get("/api/voices")
def get_voices():
    if not os.path.exists(VOICES_DIR):
        return []
    voices = []
    for f in sorted(os.listdir(VOICES_DIR)):
        if f.endswith(".wav"):
            name = f.replace(".wav", "")
            txt_path = os.path.join(VOICES_DIR, f"{name}.txt")
            transcript = ""
            if os.path.exists(txt_path):
                try:
                    with open(txt_path, "r", encoding="utf-8") as tf:
                        transcript = tf.read().strip()
                except Exception:
                    pass
            voices.append({
                "name": name,
                "audio_url": f"/voices/{f}",
                "transcript": transcript
            })
    return voices

@app.post("/api/voices/enroll")
async def enroll_voice(name: str = Form(...), transcript: str = Form(...), file: UploadFile = File(...)):
    safe_name = re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '_')
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid voice name")
    
    # Save uploaded file temporarily
    temp_file_path = os.path.join(os.getcwd(), f"temp_enroll_{int(time.time())}_{file.filename}")
    with open(temp_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    clean_wav = convert_audio_if_needed(temp_file_path)
    if not clean_wav:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(status_code=400, detail="Failed to parse or convert audio to WAV format. Check ffmpeg.")

    # Save to voices/
    target_wav = os.path.join(VOICES_DIR, f"{safe_name}.wav")
    target_txt = os.path.join(VOICES_DIR, f"{safe_name}.txt")
    
    shutil.copy(clean_wav, target_wav)
    with open(target_txt, "w", encoding="utf-8") as f:
        f.write(transcript)
        
    # Cleanup temp
    if os.path.exists(temp_file_path):
        os.remove(temp_file_path)
    if clean_wav != temp_file_path and os.path.exists(clean_wav):
        os.remove(clean_wav)
        
    return {"message": f"Voice '{safe_name}' enrolled successfully!"}

@app.post("/api/generate/custom")
def generate_custom(req: CustomTTSRequest):
    global CURRENT_MODEL, CURRENT_MODEL_KEY
    if CURRENT_MODEL is None:
        raise HTTPException(status_code=400, detail="Model is not loaded. Please load a Custom Voice model first.")
    
    model_info = MODELS[CURRENT_MODEL_KEY]
    if model_info["mode"] != "custom":
        raise HTTPException(status_code=400, detail=f"Active model is in '{model_info['mode']}' mode. Custom Voice generator requires a Custom Voice model.")

    temp_dir = f"temp_{int(time.time())}"
    os.makedirs(temp_dir, exist_ok=True)
    
    try:
        with model_lock:
            generate_audio(
                model=CURRENT_MODEL,
                text=req.text,
                voice=req.speaker,
                instruct=req.emotion,
                speed=req.speed,
                output_path=temp_dir
            )
        audio_url = save_generated_audio(temp_dir, model_info["subfolder"], req.text)
        if not audio_url:
            raise Exception("Audio generation output file not found")
        clean_memory()
        return {"audio_url": audio_url}
    except Exception as e:
        clean_memory()
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

@app.post("/api/generate/design")
def generate_design(req: DesignTTSRequest):
    global CURRENT_MODEL, CURRENT_MODEL_KEY
    if CURRENT_MODEL is None:
        raise HTTPException(status_code=400, detail="Model is not loaded. Please load a Voice Design model first.")
    
    model_info = MODELS[CURRENT_MODEL_KEY]
    if model_info["mode"] != "design":
        raise HTTPException(status_code=400, detail=f"Active model is in '{model_info['mode']}' mode. Voice Design generator requires a Voice Design model.")

    temp_dir = f"temp_{int(time.time())}"
    os.makedirs(temp_dir, exist_ok=True)
    
    try:
        with model_lock:
            generate_audio(
                model=CURRENT_MODEL,
                text=req.text,
                instruct=req.voice_description,
                output_path=temp_dir
            )
        audio_url = save_generated_audio(temp_dir, model_info["subfolder"], req.text)
        if not audio_url:
            raise Exception("Audio generation output file not found")
        clean_memory()
        return {"audio_url": audio_url}
    except Exception as e:
        clean_memory()
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

@app.post("/api/generate/clone")
async def generate_clone(
    text: str = Form(...),
    voice_name: Optional[str] = Form(None),
    ref_transcript: Optional[str] = Form("."),
    file: Optional[UploadFile] = File(None)
):
    global CURRENT_MODEL, CURRENT_MODEL_KEY
    if CURRENT_MODEL is None:
        raise HTTPException(status_code=400, detail="Model is not loaded. Please load a Voice Cloning model first.")
    
    model_info = MODELS[CURRENT_MODEL_KEY]
    if model_info["mode"] != "clone":
        raise HTTPException(status_code=400, detail=f"Active model is in '{model_info['mode']}' mode. Voice Cloning generator requires a Voice Cloning/Base model.")

    ref_audio_path = None
    temp_ref_path = None

    if voice_name:
        # Using enrolled voice
        ref_audio_path = os.path.join(VOICES_DIR, f"{voice_name}.wav")
        ref_txt_path = os.path.join(VOICES_DIR, f"{voice_name}.txt")
        if not os.path.exists(ref_audio_path):
            raise HTTPException(status_code=400, detail=f"Voice '{voice_name}' not found.")
        if os.path.exists(ref_txt_path):
            try:
                with open(ref_txt_path, "r", encoding="utf-8") as f:
                    ref_transcript = f.read().strip()
            except Exception:
                pass
    elif file:
        # Quick clone upload
        temp_ref_path = os.path.join(os.getcwd(), f"temp_clone_ref_{int(time.time())}_{file.filename}")
        with open(temp_ref_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        ref_audio_path = convert_audio_if_needed(temp_ref_path)
        if not ref_audio_path:
            if os.path.exists(temp_ref_path):
                os.remove(temp_ref_path)
            raise HTTPException(status_code=400, detail="Failed to parse reference audio. Ensure it is a valid WAV/MP3/M4A file.")
    else:
        raise HTTPException(status_code=400, detail="Please upload a reference audio file or select an enrolled voice.")

    temp_dir = f"temp_{int(time.time())}"
    os.makedirs(temp_dir, exist_ok=True)
    
    try:
        with model_lock:
            generate_audio(
                model=CURRENT_MODEL,
                text=text,
                ref_audio=ref_audio_path,
                ref_text=ref_transcript or ".",
                output_path=temp_dir
            )
        audio_url = save_generated_audio(temp_dir, model_info["subfolder"], text)
        if not audio_url:
            raise Exception("Audio generation output file not found")
        clean_memory()
        
        # Cleanup temp ref
        if temp_ref_path and os.path.exists(temp_ref_path):
            os.remove(temp_ref_path)
        if ref_audio_path != temp_ref_path and temp_ref_path is not None and os.path.exists(ref_audio_path):
            os.remove(ref_audio_path)
            
        return {"audio_url": audio_url}
    except Exception as e:
        clean_memory()
        if temp_ref_path and os.path.exists(temp_ref_path):
            os.remove(temp_ref_path)
        if ref_audio_path != temp_ref_path and temp_ref_path is not None and os.path.exists(ref_audio_path):
            os.remove(ref_audio_path)
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")

@app.get("/api/history")
def get_history():
    history = []
    if not os.path.exists(BASE_OUTPUT_DIR):
        return []
    
    # Traverse subfolders (CustomVoice, VoiceDesign, Clones)
    for subfolder in ["CustomVoice", "VoiceDesign", "Clones"]:
        subfolder_path = os.path.join(BASE_OUTPUT_DIR, subfolder)
        if not os.path.exists(subfolder_path):
            continue
        for f in os.listdir(subfolder_path):
            if f.endswith(".wav"):
                full_path = os.path.join(subfolder_path, f)
                stat = os.stat(full_path)
                # Parse timestamp from file name: e.g. 20260615_034730_some_text.wav
                created_str = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                # Strip out date pattern for UI display
                clean_name = f
                match = re.match(r"^\d{8}_\d{6}_(.*)\.wav$", f)
                if match:
                    clean_name = match.group(1).replace("_", " ")
                elif re.match(r"^\d{2}-\d{2}-\d{2}_(.*)\.wav$", f): # legacy main.py format
                    clean_name = re.match(r"^\d{2}-\d{2}-\d{2}_(.*)\.wav$", f).group(1).replace("_", " ")

                history.append({
                    "filename": f,
                    "clean_name": clean_name,
                    "subfolder": subfolder,
                    "audio_url": f"/outputs/{subfolder}/{f}",
                    "created_at": created_str,
                    "size_bytes": stat.st_size
                })
                
    # Sort history by date descending
    history.sort(key=lambda x: x["created_at"], reverse=True)
    return history

@app.delete("/api/history/{subfolder}/{filename}")
def delete_history_item(subfolder: str, filename: str):
    if subfolder not in ["CustomVoice", "VoiceDesign", "Clones"]:
        raise HTTPException(status_code=400, detail="Invalid subfolder")
    
    file_path = os.path.join(BASE_OUTPUT_DIR, subfolder, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        return {"message": "Deleted successfully"}
    raise HTTPException(status_code=404, detail="File not found")

# Serve UI static files
@app.get("/")
def read_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return JSONResponse(status_code=404, content={"detail": "static/index.html not found. Please create static assets."})

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")
app.mount("/voices", StaticFiles(directory="voices"), name="voices")

if __name__ == "__main__":
    import argparse
    import uvicorn
    
    parser = argparse.ArgumentParser(description="Qwen3-TTS Local Web UI")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host address to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to run server on")
    parser.add_argument("--root-path", type=str, default="", help="Root path prefix for reverse proxy (e.g. /qwen3-tts)")
    parser.add_argument("--test-startup", action="store_true", help="Test import and setup then exit")
    args = parser.parse_args()
    
    if args.test_startup:
        print("Startup check successful! Modules loaded correctly.")
        sys.exit(0)
        
    uvicorn.run("app:app", host=args.host, port=args.port, root_path=args.root_path, reload=True)
