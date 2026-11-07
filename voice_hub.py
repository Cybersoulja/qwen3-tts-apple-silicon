"""Oneseco Voice Hub v0.1: authenticated compatibility gateway for Qwen3 app.py.

Run: VOICE_HUB_TOKEN=<random-secret> uvicorn voice_hub:app --host 127.0.0.1 --port 8090
Set QWEN_TTS_BASE_URL if the existing app.py is not at http://127.0.0.1:8000.
This first increment is local-first; cloud fallback and durable jobs are not implemented.
"""
import asyncio
import os
import secrets
import urllib.error
import urllib.request
import json
from typing import Literal

from fastapi import FastAPI, Depends, Header, HTTPException
from pydantic import BaseModel, Field

BACKEND = os.getenv("QWEN_TTS_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
TOKEN = os.getenv("VOICE_HUB_TOKEN")
if not TOKEN:
    raise RuntimeError("VOICE_HUB_TOKEN must be set")
app = FastAPI(title="Oneseco Voice Hub", version="0.1.0")


def authenticate(authorization: str | None = Header(default=None)):
    expected = "Bearer " + TOKEN
    if not authorization or not secrets.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(min_length=1)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    emotion: str = "Normal tone"
    mode: Literal["custom"] = "custom"


def backend_request(path: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BACKEND + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Do not leak internal backend diagnostics or filesystem paths.
        raise HTTPException(status_code=502, detail="Voice engine rejected the request") from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Local voice engine unavailable") from exc


@app.get("/health")
async def health():
    # Public liveness only; does not disclose internal engine details.
    return {"status": "ok", "service": "oneseco-voice-hub"}


@app.get("/v1/voices", dependencies=[Depends(authenticate)])
async def voices():
    raw = await asyncio.to_thread(backend_request, "/api/speakers")
    return {"voices": [{"id": key, "provider": "qwen3-local", "mode": "custom"}
                       for key in raw.keys()]}


@app.post("/v1/speech", dependencies=[Depends(authenticate)])
async def speech(request: SpeechRequest):
    # The current app.py requires the corresponding CustomVoice model to be loaded.
    result = await asyncio.to_thread(
        backend_request,
        "/api/generate/custom",
        {"text": request.text, "speaker": request.voice,
         "emotion": request.emotion, "speed": request.speed},
    )
    audio_path = result.get("audio_url")
    if not isinstance(audio_path, str) or not audio_path.startswith("/outputs/"):
        raise HTTPException(status_code=502, detail="Invalid voice engine response")
    # Internal path only. Do not expose the unauthenticated upstream file URL.
    return {"status": "completed", "provider": "qwen3-local",
            "audio_path": audio_path, "delivery": "internal-only"}
