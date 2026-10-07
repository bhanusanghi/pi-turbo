"""Download the exact Kokoro checkpoint used for this pilot from Hugging Face."""
from pathlib import Path
import os
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[3]
os.environ.setdefault("HF_HOME", str(root / ".video-work/hf-cache"))
destination = root / ".video-work/models/Kokoro-82M-8bit"
snapshot_download(
    "mlx-community/Kokoro-82M-8bit",
    revision="7e173a214392b1e0cb397e71c9745cbd14c06063",
    local_dir=destination,
    cache_dir=root / ".video-work/hf-cache/hub",
)
print(destination)
