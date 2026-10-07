# Pi Turbo — one-minute pilot

[Watch the video](pi-turbo-pilot.mp4) · [Player with chapter jumps](index.html)
· [Task list](TASKS.md) · [Narration](narration.json)

An original Manim animation with local Kokoro narration. One ticket demonstrates
a direct decision, permitted System Two investigation, evidence returning to
System One, and Pi execution. The final frame shows continued composition with
other Pi extensions and connected MCP tools. This is an illustrative workflow,
not a live agent recording or a measured cost/latency demonstration.

| Asset | Production choice |
|---|---|
| Video | 60 seconds, 1920 × 1080, 30 fps, H.264 |
| Voice | Kokoro 82M **8-bit**, `af_heart`, US English, speed 1.0 |
| Model source | [Hugging Face](https://huggingface.co/mlx-community/Kokoro-82M-8bit/tree/7e173a214392b1e0cb397e71c9745cbd14c06063) |
| Model revision | `7e173a214392b1e0cb397e71c9745cbd14c06063` |
| Model download | 351,672,008 bytes including local download metadata; weights configured at 8 bits |
| Speech runtime | MLX Audio 0.5.8 on Apple Silicon; local inference |
| Animation | Manim Community 0.21.0, Cairo; vector geometry and text |
| Audio | 48.425 seconds of generated speech with deliberate holds; mono AAC, normalized to −16 LUFS target |
| Captions | Embedded optional English captions and `captions.srt` |

## Reproduce on Apple Silicon

Run from the repository root. The model and environment stay in the ignored
`.video-work` directory. First setup requires network access. GPU access is
required for MLX; run speech generation in a normal terminal if a sandbox blocks Metal.

```sh
brew install pkgconf cairo pango espeak-ng
uv venv --python 3.12 .video-work/venv
UV_CACHE_DIR="$PWD/.video-work/uv-cache" uv pip install \
  --python .video-work/venv/bin/python \
  -r docs/video/pilot/requirements.lock.txt
.video-work/venv/bin/python docs/video/pilot/download_model.py
.video-work/venv/bin/python docs/video/pilot/generate_audio.py
zsh docs/video/pilot/render.sh
# Optional player with working chapter seeking:
.video-work/venv/bin/python docs/video/pilot/serve_preview.py
# Open http://127.0.0.1:8882/
```

Edit `narration.json` for speech, `pilot.py` for animation. `generate_audio.py`
rebuilds WAVs, frame-aligned timing and captions. `render.sh` renders and muxes
the final MP4. Voice timing can vary with runtime versions; the lock file records
the packages used here. Speed may need slight adjustment if a revised script exceeds 60 seconds.

## Design and attribution

The [scene plan](scenes.md) was written before animation code. The pilot uses
progressive introduction, persistent objects and moving information packets.
The drawings, script and animation are original; no 3Blue1Brown assets or voice
were copied. This is a first explanatory-animation pilot, not a recreation of
Grant Sanderson's production style or the full planned film.

Kokoro model: Apache-2.0; MLX Audio: MIT; Manim Community: MIT.
Source references and the broader production comparison are recorded in
[video-production-review.md](../../research/video-production-review.md).

Review evidence: `verification.json`, `poster.jpg`, `review/final-contact-sheet.jpg`,
and `review/player-preview.png`. Browser playback and chapter seeking were observed;
the delivered player is left paused, ready to watch.
Checks cover stream metadata, decoding, audio levels and selected visual frames.
They do not constitute live Pi/Jev execution validation.
