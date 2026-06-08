import os
import argparse
import sys

# Add models directory creation
MODELS_DIR = os.path.join(os.getcwd(), "models")
os.makedirs(MODELS_DIR, exist_ok=True)

MODELS = {
    # Pro (1.7B)
    "1": "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit",
    "2": "mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit",
    "3": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit",
    # Lite (0.6B)
    "4": "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit",
    "5": "mlx-community/Qwen3-TTS-12Hz-0.6B-VoiceDesign-8bit",
    "6": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit",
}

def download_model(choice):
    if choice not in MODELS:
        print(f"Error: Invalid model selection '{choice}'")
        return False
        
    repo_id = MODELS[choice]
    folder_name = repo_id.split("/")[-1]
    dest_dir = os.path.join(MODELS_DIR, folder_name)
    
    print(f"\nDownloading {repo_id}...")
    print(f"Target directory: {dest_dir}")
    print("This may take a few minutes depending on your internet connection...\n")
    
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=repo_id,
            local_dir=dest_dir,
            local_dir_use_symlinks=False
        )
        print(f"\nSuccessfully downloaded model to: {dest_dir}")
        return True
    except ImportError:
        print("\nError: 'huggingface_hub' is not installed in this environment.")
        print("Please activate the virtual environment and install dependencies first.")
        return False
    except Exception as e:
        print(f"\nError downloading model: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Download Qwen3-TTS models from Hugging Face")
    parser.add_argument("--model", type=str, choices=list(MODELS.keys()), help="Model number to download (1-6)")
    args = parser.parse_args()

    if args.model:
        download_model(args.model)
        return

    print("=" * 50)
    print(" Qwen3-TTS Model Downloader")
    print("=" * 50)
    print("\n  Pro Models (1.7B - Best Quality)")
    print("  ---------------------------------")
    print("  1. Custom Voice   (preset speakers + emotion control)")
    print("  2. Voice Design   (generate voice from text description)")
    print("  3. Voice Cloning  (clone voice from audio sample)")
    print("\n  Lite Models (0.6B - Faster / Less RAM)")
    print("  --------------------------------------")
    print("  4. Custom Voice   (preset speakers + emotion control)")
    print("  5. Voice Design   (generate voice from text description)")
    print("  6. Voice Cloning  (clone voice from audio sample)")
    print("\n  q. Quit")
    
    try:
        choice = input("\nSelect model to download (1-6): ").strip().lower()
        if choice == 'q':
            sys.exit(0)
        download_model(choice)
    except KeyboardInterrupt:
        print("\nExited.")

if __name__ == "__main__":
    main()
