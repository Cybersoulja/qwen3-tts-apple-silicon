# CLAUDE.md — qwen3-tts-apple-silicon

Local FastAPI web UI for Qwen3-TTS voice synthesis on Apple Silicon via MLX. Supports custom voice, voice design, and voice cloning modes.

## Running

```bash
.venv/bin/python server.py                          # http://127.0.0.1:8080
.venv/bin/python server.py --port 8080 --host 0.0.0.0   # expose to LAN
```

Uses the project's `.venv` (created via `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`) — the bare `python` command will fail if dependencies aren't on the system interpreter.

## Expose via Cloudflare Tunnel (any device access)

```bash
bash tunnel.sh    # wraps: cloudflared tunnel --url http://127.0.0.1:8080
```

Prints a `.trycloudflare.com` URL usable from iPhone or any device.

## Setup

```bash
pip install -r requirements.txt
python download_model.py    # download models from HuggingFace
```

Requires Apple Silicon (MLX). Python venv recommended.

## Models

| ID | Name | HuggingFace repo | Mode |
|---|---|---|---|
| 1 | Custom Voice (Pro) | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit` | custom |
| 2 | Voice Design (Pro) | `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit` | design |
| 3 | Voice Cloning (Pro) | `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit` | clone |
| 4 | Custom Voice (Lite) | `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` | custom |
| 5 | Voice Design (Lite) | `mlx-community/Qwen3-TTS-12Hz-0.6B-VoiceDesign-8bit` | design |
| 6 | Voice Cloning (Lite) | `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit` | clone |

Downloaded models stored in `models/`. Lite (0.6B) runs faster; Pro (1.7B) higher quality.

## API Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/models` | List all models + download status |
| POST | `/api/models/download` | Download a model `{ model_id }` |
| GET | `/api/models/download/status/:id` | Poll download progress |
| GET | `/api/models/active` | Get currently loaded model |
| POST | `/api/models/load` | Load a model into memory `{ model_id }` |
| GET | `/api/speakers` | List built-in speakers |
| GET | `/api/voices` | List enrolled custom voices |
| POST | `/api/voices/enroll` | Enroll a voice (multipart: `name`, `transcript`, `file`) |
| POST | `/api/generate/custom` | Generate with custom voice |
| POST | `/api/generate/design` | Generate with voice design prompt |
| POST | `/api/generate/clone` | Generate with voice cloning |
| GET | `/api/history` | List generated audio history |
| DELETE | `/api/history/:subfolder/:filename` | Delete a history item |
| GET | `/api/firebase_config` | Firebase config for client |

## File Layout

```
models/         # Downloaded MLX model weights
voices/         # Enrolled voice samples (.wav + .txt transcript)
outputs/        # Generated audio files (organized by subfolder)
static/         # Static frontend assets
frontend/       # Frontend source
```

## Key Stack

- `mlx-audio` (git) + `mlx==0.30.3` — inference on Apple Silicon
- `fastapi` + `uvicorn` — web server
- `librosa` / `soundfile` / `sounddevice` — audio processing
- Firebase (optional) — config served via `/api/firebase_config`

## Lint

```bash
ruff check --fix server.py main.py app.py download_model.py
```
