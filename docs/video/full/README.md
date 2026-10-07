# Pi Turbo — full explanatory film

[Watch the film](pi-turbo-full.mp4) · [Player and chapter jumps](index.html)
· [Production task list](TASKS.md) · [Narration script](script.json)

An original explanatory animation for developers building applications around
typed System One judgments. It begins with the problem and audience, develops
the System One/System Two analogy, then reveals Turbo's architecture and small
application integration seams. Pi owns sessions and tool execution; developers
supply application policy and relevant state. System Two consultation returns
information to System One. Other Pi extensions and connected MCP tools remain
part of the shared Pi environment.

The examples illustrate authored behavior, not live Pi/Jev execution or measured
cost, latency, calibration or correctness. On-screen integration code is
pseudocode. The Kahneman comparison is a teaching analogy, not a literal claim
about cognition or model internals. V1 state/context management remains the
application author's responsibility.

## Production choices

| Asset | Choice |
|---|---|
| Animation | Manim Community 0.21.0, Cairo, original vectors and text |
| Delivery | H.264, 1920 × 1080, 30 fps; optional English captions |
| Voice | Local Kokoro 82M 8-bit, `af_heart`, speed 1.0 |
| Model | `mlx-community/Kokoro-82M-8bit` |
| Downloaded revision | `7e173a214392b1e0cb397e71c9745cbd14c06063` |
| Runtime | MLX Audio 0.5.8, Apple Silicon |
| Timeline | Measured speech plus deliberate frame-aligned reading holds |
| Audio | AAC 192 kbps at 48 kHz, −16 LUFS normalization target |
| Captions | Short phrase cues estimated within each measured paragraph |

Actual duration, scene timings and model revision are in `timing.json`.
`verification.json` records the encoded streams, frame count and duration after
successful assembly; it is produced from the rendered file, not a placeholder.

## Reproduce

Use the existing ignored `.video-work/venv` and local Kokoro model from the pilot.
The package versions are recorded in the [pilot lock file](../pilot/requirements.lock.txt).
No additional package install or model download is needed for this film.

From the repository root:

```sh
# Speech generation needs Apple Silicon Metal/GPU access.
.video-work/venv/bin/python docs/video/full/generate_audio.py
# Review draft first:
zsh docs/video/full/render.sh --quality 480
.video-work/venv/bin/python docs/video/full/assemble.py --draft
# Final:
zsh docs/video/full/render.sh --quality 1080
.video-work/venv/bin/python docs/video/full/assemble.py
# Loopback preview supporting chapter seeking:
.video-work/venv/bin/python docs/video/full/serve_preview.py --port 8883
# Open http://127.0.0.1:8883/
```

`generate_audio.py` caches each paragraph by content/voice/speed/model revision.
Changing narration regenerates affected paragraphs. `--force` regenerates all
paragraphs; `--timing-only` requires current cached WAVs and avoids loading Metal.
The script creates paragraph WAVs, padded scene WAVs, full narration, captions,
and `timing.json`. If speech and minimum holds exceed eight minutes it stops
rather than accelerating the voice automatically.

`render.sh --quality 1080 Scene03` rerenders a single scene without assembling.
`assemble.py` pads a short scene with its final frame or trims excess frames to
the measured slot, concatenates silent animation chapters, adds the full local
narration and optional captions, and verifies the encoded duration/frame count.
Rendering is deterministic at frame level; narration may vary with runtime
versions. Review changed scenes before final assembly.

`film.py` exposes `Scene01` through `Scene12` from the chapter modules. Scene
durations come from `timing.json`; animation sources and narration remain
separate so voice revisions do not require embedding audio in Manim clips.

## Attribution and evidence

The script, drawing and animation are original. No 3Blue1Brown character assets
or voice were copied. The visual approach uses persistent objects, progressively
introduced concepts and visible information movement. Production research is in
[video-production-review.md](../../research/video-production-review.md).

Kokoro weights: Apache-2.0. MLX Audio: MIT. Manim Community: MIT.
The [model snapshot](https://huggingface.co/mlx-community/Kokoro-82M-8bit/tree/7e173a214392b1e0cb397e71c9745cbd14c06063)
is the same local download used for the pilot. Kokoro narration uses a stock voice.

Review artifacts, when generated, live in `review/`. Stream metadata and selected
frame inspection establish media delivery checks, not agent runtime validation.
