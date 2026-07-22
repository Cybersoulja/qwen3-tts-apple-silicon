#!/usr/bin/env python3
import os
import re
import sys
import json
import subprocess
import urllib.request
import urllib.parse

BRIDGE_PATH = "/Users/cybersoulja/ios-datajar-bridge/bridge.py"
PORT = 8080

def load_env_vars():
    # Load from project .env if exists
    project_env = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(project_env):
        with open(project_env, "r") as f:
            for line in f:
                if line.strip() and not line.strip().startswith("#") and "=" in line:
                    k, v = line.strip().split("=", 1)
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
                    
    # Fallback to loading from user ~/.env
    home_env = os.path.expanduser("~/.env")
    if os.path.exists(home_env):
        with open(home_env, "r") as f:
            for line in f:
                if line.strip() and not line.strip().startswith("#") and "=" in line:
                    k, v = line.strip().split("=", 1)
                    if k.strip() not in os.environ:
                        os.environ[k.strip()] = v.strip().strip('"').strip("'")

def get_pushcut_config():
    load_env_vars()
    api_key = os.getenv("PUSHCUT_API_KEY")
    notification_name = os.getenv("PUSHCUT_NOTIFICATION_NAME", "Qwen3-TTS")
    return api_key, notification_name

def send_pushcut_notification(api_key, notification_name, text, tunnel_url):
    if not api_key:
        print("[Pushcut] API Key not found. Skipping notification.")
        print("Set PUSHCUT_API_KEY in your .env to enable notifications.")
        return
        
    api_url = f"https://api.pushcut.io/v1/notifications/{urllib.parse.quote(notification_name)}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "text": text,
        "actions": [
            {
                "name": "Open Studio",
                "url": tunnel_url
            }
        ]
    }
    
    req = urllib.request.Request(
        api_url, 
        data=json.dumps(payload).encode("utf-8"), 
        headers=headers, 
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as response:
            res = response.read().decode("utf-8")
            print(f"[Pushcut] Notification sent successfully: {res}")
    except Exception as e:
        print(f"[Pushcut] Failed to send notification: {e}", file=sys.stderr)

def update_data_jar(url):
    if not os.path.exists(BRIDGE_PATH):
        print(f"[Data Jar] Bridge not found at {BRIDGE_PATH}. Skipping Data Jar sync.")
        return
        
    try:
        cmd = ["python3", BRIDGE_PATH, "set", "store.API.qwen_tts", json.dumps(url)]
        subprocess.run(cmd, check=True)
        print(f"[Data Jar] Updated store.API.qwen_tts to: {url}")
    except Exception as e:
        print(f"[Data Jar] Failed to update Data Jar: {e}", file=sys.stderr)

def main():
    print(f"Starting Cloudflare Tunnel pointing to http://localhost:{PORT}")
    
    # Check if cloudflared is installed
    if subprocess.run(["which", "cloudflared"], capture_output=True).returncode != 0:
        print("Error: 'cloudflared' command not found. Please install it using Homebrew:")
        print("  brew install cloudflared")
        sys.exit(1)
        
    cmd = ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{PORT}"]
    
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")
    
    # cloudflared logs to stderr
    for line in iter(process.stderr.readline, ""):
        print(line, end="")
        match = url_pattern.search(line)
        if match:
            tunnel_url = match.group(0)
            print(f"\n[Tunnel Established] -> {tunnel_url}\n")
            
            # Sync to Data Jar
            update_data_jar(tunnel_url)
            
            # Send notification
            api_key, notif_name = get_pushcut_config()
            text = f"🧑🏾‍🚀 Trill Astro Buzz: Qwen3-TTS studio is online!\nAccess the model dashboard here: {tunnel_url}"
            send_pushcut_notification(api_key, notif_name, text, tunnel_url)
            
    process.wait()

if __name__ == "__main__":
    main()
