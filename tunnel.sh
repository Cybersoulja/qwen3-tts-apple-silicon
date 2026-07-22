#!/bin/bash
# Cloudflare Tunnel Exposer for Qwen3-TTS Dashboard

PORT=8080

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "cloudflared is not installed on your system."
    echo "Attempting to install via Homebrew..."
    
    if command -v brew &> /dev/null; then
        brew install cloudflared
    else
        echo "Error: Homebrew is not installed. Please install cloudflared manually:"
        echo "  brew install cloudflared"
        echo "Or download it from: https://github.com/cloudflare/cloudflared/releases"
        exit 1
    fi
fi

echo "--------------------------------------------------------"
echo "Starting Cloudflare Tunnel pointing to http://localhost:$PORT"
echo "Copy the '.trycloudflare.com' URL displayed below to access"
echo "your local Qwen3-TTS studio dashboard from any device!"
echo "--------------------------------------------------------"

# Run the tunnel integration script (automatically updates Data Jar & Pushcut)
python3 "$(dirname "$0")/tunnel_integration.py"

