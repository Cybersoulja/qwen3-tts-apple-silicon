# Developer Agent Handoff Notes (agent.md)

This document provides a comprehensive guide for developers and agent systems taking over or continuing work on the **qwen3-tts-apple-silicon** project.

---

## 🛰️ Project Overview
This repository provides a local FastAPI web interface and API service for running **Qwen3-TTS** voice synthesis models on Apple Silicon (via Apple's MLX framework). It supports three synthesis modes (Custom Voice, Voice Design, and Voice Cloning), voice enrollment, local history logging, and iCloud/Data Jar integrations.

---

## 🏗️ Architecture & Component Layout

```
.
├── models/                  # Downloaded MLX model folders (Pro 1.7B & Lite 0.6B)
├── voices/                  # Enrolled custom voices (pair of .wav reference + .txt transcript)
├── outputs/                 # Generated audio files grouped by subfolder
├── static/                  # Production build folder for UI assets
├── frontend/                # React + Vite + TypeScript frontend source code
│   └── src/firebase.ts      # Client Firebase setup (Auth, Firestore, Gemini)
├── server.py                # Main FastAPI API routes and MLX generation loop
├── tunnel.sh                # Entrypoint script to start the Cloudflare tunnel
├── tunnel_integration.py    # Python wrapper parsing tunnel logs for Data Jar & Pushcut notifications
└── firebase.json            # Firebase configuration file (Firestore & Auth rules)
```

---

## 🚀 Key Integrations & Automation

### 1. Cloudflare Tunnel Exposer
- Executing `bash tunnel.sh` fires `tunnel_integration.py` which spawns `cloudflared tunnel`.
- It dynamically reads log streams to capture the generated `*.trycloudflare.com` URL.

### 2. iOS Data Jar Bridge Syncing
- Once the tunnel URL is captured, the script updates your Data Jar storage:
  ```bash
  python3 /Users/cybersoulja/ios-datajar-bridge/bridge.py set "store.API.qwen_tts" '"https://<subdomain>.trycloudflare.com"'
  ```
- This allows external iOS Shortcuts, Telegram bots, or proxy layers to instantly route to this local Apple Silicon machine.

### 3. Pushcut Notifications
- On successful tunnel startup, a POST request is sent to the Pushcut API.
- Configured using environment variables:
  - `PUSHCUT_API_KEY`: API authentication bearer token.
  - `PUSHCUT_NOTIFICATION_NAME` (Defaults to `Qwen3-TTS`): Defined notification configuration in your Pushcut app.

### 4. Firebase Backend Services
- Pre-configured Firestore (`firestore.rules`) and Email/Password Authentication.
- Rules deployable via:
  ```bash
  npx firebase-tools deploy --only firestore
  npx firebase-tools deploy --only auth
  ```

---

## 🛠️ Development & Operational Tasks

### How to Run Locally
```bash
# Start backend server
.venv/bin/python server.py

# Run tunnel and integrations
bash tunnel.sh
```

### Next Steps & Backlog
1. **Dynamic Model Auto-Download**: Auto-download missing model snapshots on initial load instead of failing if `download_model.py` hasn't been run.
2. **Web App Deployment**: Run `/firebase:deploy` (the Firebase MCP deploy prompt) to analyze, configure, and compile the React app for production hosting.
3. **API Security**: Add basic auth tokens to the `/api/*` endpoints to secure the server when exposed publicly via Cloudflare tunnel.
