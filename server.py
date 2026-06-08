import os
import sys
import shutil
import time
import re
import subprocess
import gc
import asyncio
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Form, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# Configuration
BASE_OUTPUT_DIR = os.path.join(os.getcwd(), "outputs")
MODELS_DIR = os.path.join(os.getcwd(), "models")
VOICES_DIR = os.path.join(os.getcwd(), "voices")
CLONES_OUTPUT_DIR = os.path.join(BASE_OUTPUT_DIR, "Clones")

os.makedirs(BASE_OUTPUT_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)
os.makedirs(CLONES_OUTPUT_DIR, exist_ok=True)

# Try loading mlx_audio
try:
    from mlx_audio.tts.utils import load_model
    from mlx_audio.tts.generate import generate_audio
except ImportError:
    print("Error: 'mlx_audio' library not found.")
    sys.exit(1)

# Model definitions mapping
MODELS_CONFIG = {
    "3": {"name": "Voice Cloning (Pro - 1.7B)", "folder": "Qwen3-TTS-12Hz-1.7B-Base-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"},
    "6": {"name": "Voice Cloning (Lite - 0.6B)", "folder": "Qwen3-TTS-12Hz-0.6B-Base-8bit", "repo_id": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"},
}

app = FastAPI(title="Qwen3-TTS Voice Cloning Studio API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for caching loaded models
loaded_model = None
loaded_model_key = None
model_lock = asyncio.Lock()

# Download status tracking
download_status = {}

def get_smart_path(folder_name):
    full_path = os.path.join(MODELS_DIR, folder_name)
    if not os.path.exists(full_path):
        return None

    snapshots_dir = os.path.join(full_path, "snapshots")
    if os.path.exists(snapshots_dir):
        try:
            subfolders = [f for f in os.listdir(snapshots_dir) if not f.startswith('.')]
            if subfolders:
                return os.path.join(snapshots_dir, subfolders[0])
        except Exception:
            pass

    return full_path

def is_model_fully_downloaded(folder_name):
    folder_path = get_smart_path(folder_name)
    if not folder_path or not os.path.exists(folder_path):
        return False
    
    has_weights = False
    for root, dirs, files in os.walk(folder_path):
        for file in files:
            if file.endswith(".safetensors") or file.endswith(".npz"):
                has_weights = True
                break
        if has_weights:
            break
            
    return has_weights

def convert_audio_if_needed(input_path):
    if not os.path.exists(input_path):
        return None

    filename = os.path.basename(input_path)
    name, ext = os.path.splitext(filename)

    # If it is WAV, try reading it. If not standard pcm or error, convert
    if ext.lower() == ".wav":
        return input_path

    temp_wav = os.path.join(os.getcwd(), f"temp_convert_{int(time.time())}.wav")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", input_path, 
           "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", temp_wav]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return temp_wav
    except Exception as e:
        print(f"ffmpeg conversion failed: {e}")
        return None

def download_model_task(model_key: str, repo_id: str, dest_dir: str):
    download_status[model_key] = "Downloading"
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=repo_id,
            local_dir=dest_dir,
            local_dir_use_symlinks=False
        )
        if is_model_fully_downloaded(repo_id.split("/")[-1]):
            download_status[model_key] = "Completed"
        else:
            download_status[model_key] = "Error: Weight files missing after download"
    except Exception as e:
        print(f"Download failed: {e}")
        download_status[model_key] = f"Error: {str(e)}"

@app.get("/api/models")
async def list_models():
    res = []
    for key, config in MODELS_CONFIG.items():
        downloaded = is_model_fully_downloaded(config["folder"])
        
        status = "Not Downloaded"
        if downloaded:
            status = "Completed"
        elif key in download_status:
            status = download_status[key]
            
        res.append({
            "key": key,
            "name": config["name"],
            "repo_id": config["repo_id"],
            "status": status,
            "downloaded": downloaded
        })
    return res

@app.post("/api/models/download")
async def trigger_download(model_key: str, background_tasks: BackgroundTasks):
    if model_key not in MODELS_CONFIG:
        raise HTTPException(status_code=400, detail="Invalid model key")
        
    config = MODELS_CONFIG[model_key]
    dest_dir = os.path.join(MODELS_DIR, config["folder"])
    
    # Check if already downloaded
    if is_model_fully_downloaded(config["folder"]):
        return {"status": "Already Completed"}
        
    if download_status.get(model_key) == "Downloading":
        return {"status": "Downloading in progress"}
        
    background_tasks.add_task(download_model_task, model_key, config["repo_id"], dest_dir)
    return {"status": "Started"}

@app.get("/api/voices")
async def list_voices():
    voices = []
    if not os.path.exists(VOICES_DIR):
        return voices
        
    for file in os.listdir(VOICES_DIR):
        if file.endswith(".wav"):
            name = file.replace(".wav", "")
            txt_path = os.path.join(VOICES_DIR, f"{name}.txt")
            transcript = ""
            if os.path.exists(txt_path):
                try:
                    with open(txt_path, "r", encoding="utf-8") as f:
                        transcript = f.read().strip()
                except Exception:
                    pass
            voices.append({
                "name": name,
                "audio_url": f"/voices/{file}",
                "transcript": transcript
            })
    return sorted(voices, key=lambda x: x["name"])

@app.post("/api/voices/enroll")
async def enroll_voice(name: str = Form(...), transcript: str = Form(...), file: UploadFile = File(...)):
    # Sanitize name
    safe_name = re.sub(r'[^\w\s-]', '', name).strip().replace(' ', '_')
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid voice name")
        
    temp_path = os.path.join(os.getcwd(), f"temp_enroll_{int(time.time())}_{file.filename}")
    try:
        with open(temp_path, "wb") as f:
            f.write(await file.read())
            
        clean_wav = convert_audio_if_needed(temp_path)
        if not clean_wav:
            raise HTTPException(status_code=400, detail="Failed to parse or convert audio file.")
            
        target_wav = os.path.join(VOICES_DIR, f"{safe_name}.wav")
        target_txt = os.path.join(VOICES_DIR, f"{safe_name}.txt")
        
        shutil.copy(clean_wav, target_wav)
        with open(target_txt, "w", encoding="utf-8") as f:
            f.write(transcript.strip())
            
        if clean_wav != temp_path and os.path.exists(clean_wav):
            os.remove(clean_wav)
            
        return {"status": "Success", "voice_name": safe_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.post("/api/clone")
async def clone_voice(
    model_key: str = Form(...),
    text: str = Form(...),
    voice_name: Optional[str] = Form(None),
    ref_text: Optional[str] = Form(None),
    speed: float = Form(1.0),
    file: Optional[UploadFile] = File(None)
):
    global loaded_model, loaded_model_key
    
    if model_key not in MODELS_CONFIG:
        raise HTTPException(status_code=400, detail="Invalid model key")
        
    config = MODELS_CONFIG[model_key]
    model_path = get_smart_path(config["folder"])
    if not model_path or not os.path.exists(model_path):
        raise HTTPException(status_code=400, detail="Model is not downloaded yet")

    ref_audio_path = None
    ref_audio_transcript = ""
    temp_ref_audio = None
    
    if file:
        # Quick clone from uploaded file
        temp_ref_audio = os.path.join(os.getcwd(), f"temp_clone_ref_{int(time.time())}_{file.filename}")
        with open(temp_ref_audio, "wb") as f:
            f.write(await file.read())
            
        ref_audio_path = convert_audio_if_needed(temp_ref_audio)
        if not ref_audio_path:
            raise HTTPException(status_code=400, detail="Failed to convert reference audio file")
        ref_audio_transcript = ref_text or "."
    elif voice_name:
        # Enroll voice selected
        ref_audio_path = os.path.join(VOICES_DIR, f"{voice_name}.wav")
        txt_path = os.path.join(VOICES_DIR, f"{voice_name}.txt")
        if not os.path.exists(ref_audio_path):
            raise HTTPException(status_code=404, detail="Selected voice reference not found")
        if os.path.exists(txt_path):
            with open(txt_path, "r", encoding="utf-8") as f:
                ref_audio_transcript = f.read().strip()
    else:
        raise HTTPException(status_code=400, detail="Either voice_name or a reference audio file must be provided")

    async with model_lock:
        try:
            # Switch/Load model if needed
            if loaded_model_key != model_key or loaded_model is None:
                print(f"Loading model {config['name']} from {model_path}...")
                loaded_model = None
                gc.collect()
                loaded_model = load_model(model_path)
                loaded_model_key = model_key
                
            temp_output_dir = f"temp_out_{int(time.time())}"
            os.makedirs(temp_output_dir, exist_ok=True)
            
            # Generate audio synchronously using the model lock
            print(f"Generating audio for: {text[:40]}...")
            generate_audio(
                model=loaded_model,
                text=text,
                ref_audio=ref_audio_path,
                ref_text=ref_audio_transcript,
                speed=speed,
                output_path=temp_output_dir,
                verbose=False
            )
            
            # Move result file to outputs/Clones/
            source_file = os.path.join(temp_output_dir, "audio_000.wav")
            if not os.path.exists(source_file):
                raise HTTPException(status_code=500, detail="Failed to generate output audio file")
                
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            clean_text = re.sub(r'[^\w\s-]', '', text)[:20].strip().replace(' ', '_') or "audio"
            output_filename = f"{timestamp}_{clean_text}.wav"
            final_path = os.path.join(CLONES_OUTPUT_DIR, output_filename)
            
            shutil.move(source_file, final_path)
            shutil.rmtree(temp_output_dir, ignore_errors=True)
            
            # Save metadata alongside wav
            metadata_path = os.path.join(CLONES_OUTPUT_DIR, f"{output_filename}.txt")
            with open(metadata_path, "w", encoding="utf-8") as f:
                f.write(text)
                
            return {
                "status": "Success",
                "filename": output_filename,
                "url": f"/outputs/Clones/{output_filename}",
                "text": text,
                "timestamp": timestamp
            }
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            # Clean up temp file if one was converted
            if temp_ref_audio and os.path.exists(temp_ref_audio):
                os.remove(temp_ref_audio)
            if temp_ref_audio and ref_audio_path != temp_ref_audio and os.path.exists(ref_audio_path):
                os.remove(ref_audio_path)

@app.get("/api/history")
async def get_history():
    history = []
    if not os.path.exists(CLONES_OUTPUT_DIR):
        return history
        
    for file in os.listdir(CLONES_OUTPUT_DIR):
        if file.endswith(".wav"):
            txt_path = os.path.join(CLONES_OUTPUT_DIR, f"{file}.txt")
            text = ""
            if os.path.exists(txt_path):
                try:
                    with open(txt_path, "r", encoding="utf-8") as f:
                        text = f.read().strip()
                except Exception:
                    pass
            
            # Extract timestamp from filename e.g. 20260607_123456_audio.wav
            timestamp = ""
            match = re.match(r"^(\d{8}_\d{6})_", file)
            if match:
                dt_str = match.group(1)
                try:
                    dt = datetime.strptime(dt_str, "%Y%m%d_%H%M%S")
                    timestamp = dt.strftime("%b %d, %Y - %I:%M %p")
                except ValueError:
                    timestamp = dt_str
                    
            history.append({
                "filename": file,
                "url": f"/outputs/Clones/{file}",
                "text": text or "Cloned Voice Output",
                "timestamp": timestamp
            })
            
    # Sort history by filename descending (newest first)
    return sorted(history, key=lambda x: x["filename"], reverse=True)

@app.post("/api/play_local")
async def play_local(filename: str = Form(...)):
    file_path = os.path.join(CLONES_OUTPUT_DIR, filename)
    if not os.path.exists(file_path):
        # Maybe check voices folder
        file_path = os.path.join(VOICES_DIR, filename)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Audio file not found")
            
    try:
        # afplay runs on Mac locally
        subprocess.run(["afplay", file_path], check=False, 
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"status": "Success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/delete_history")
async def delete_history(filename: str = Form(...)):
    file_path = os.path.join(CLONES_OUTPUT_DIR, filename)
    meta_path = os.path.join(CLONES_OUTPUT_DIR, f"{filename}.txt")
    
    deleted = False
    if os.path.exists(file_path):
        os.remove(file_path)
        deleted = True
    if os.path.exists(meta_path):
        os.remove(meta_path)
        
    if not deleted:
        raise HTTPException(status_code=404, detail="File not found")
        
    return {"status": "Success"}

# Mount voices, outputs and static directories
app.mount("/voices", StaticFiles(directory=VOICES_DIR), name="voices")
app.mount("/outputs", StaticFiles(directory=BASE_OUTPUT_DIR), name="outputs")

# Note: StaticFiles mounting for root UI must be placed LAST so it doesn't block APIs
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8080, reload=True)
