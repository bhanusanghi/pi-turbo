"""Generate the pilot narration locally using the downloaded 8-bit Kokoro model."""
from pathlib import Path
import argparse
import json
import math
import os
import re
import textwrap

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT / ".video-work/hf-cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(ROOT / ".video-work/cache"))

import numpy as np
import soundfile as sf
from mlx_audio.tts.utils import load_model


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--speed", type=float, default=1.0)
    args = parser.parse_args()
    model_dir = ROOT / ".video-work/models/Kokoro-82M-8bit"
    model = load_model(model_dir)
    voice = str(model_dir / "voices/af_heart.safetensors")
    output = HERE / "audio"
    output.mkdir(exist_ok=True)
    paragraphs = json.loads((HERE / "narration.json").read_text())
    for paragraph in paragraphs:
        # Display spelling remains Pi; this spelling guides English pronunciation.
        spoken = paragraph["text"].replace("Pi ", "Pie ")
        chunks = []
        for result in model.generate(spoken, voice=voice, lang_code="a", speed=args.speed):
            chunks.append(np.asarray(result.audio).reshape(-1))
        waveform = np.concatenate(chunks)
        if not np.isfinite(waveform).all():
            raise ValueError("Non-finite audio")
        sf.write(output / f'{paragraph["id"]}.wav', waveform, model.sample_rate, subtype="PCM_16")
        paragraph["audio_seconds"] = len(waveform) / model.sample_rate
        paragraph["peak"] = float(np.abs(waveform).max())
        print(paragraph["id"], round(paragraph["audio_seconds"], 3), "seconds", flush=True)

    # Each paragraph starts after a short visual lead. Distribute purposeful holds.
    fps = 30
    minimum = [7.5, 6.8, 6.0, 6.8, 6.4, 7.0, 10.0]
    frame_counts = [math.ceil(max(p["audio_seconds"] + 0.6, m) * fps)
                    for p, m in zip(paragraphs, minimum)]
    spare = 60 * fps - sum(frame_counts)
    if spare < 0:
        raise ValueError(f"Narration needs {sum(frame_counts)/fps:.2f}s; regenerate slightly faster")
    weights = [1.3, 1, 1, 1, 1, 1, 1.5]
    allocations = [int(spare * w / sum(weights)) for w in weights]
    allocations[-1] += spare - sum(allocations)
    start_frame = 0
    mix = np.zeros(60 * model.sample_rate, dtype=np.float32)
    for paragraph, count, extra in zip(paragraphs, frame_counts, allocations):
        count += extra
        paragraph.update(start=start_frame / fps, duration=count / fps, audio_lead=0.3)
        data, sr = sf.read(output / f'{paragraph["id"]}.wav', dtype="float32")
        at = round((paragraph["start"] + paragraph["audio_lead"]) * sr)
        mix[at:at + len(data)] += data
        start_frame += count
    # Normalize only overall peak, preserving Kokoro prosody; final mux handles loudness.
    mix *= 0.85 / max(float(np.abs(mix).max()), 0.001)
    sf.write(output / "narration.wav", mix, model.sample_rate, subtype="PCM_16")
    metadata = dict(model="mlx-community/Kokoro-82M-8bit", voice="af_heart",
                    speed=args.speed, sample_rate=model.sample_rate,
                    duration=60.0, fps=fps, segments=paragraphs)
    (HERE / "timing.json").write_text(json.dumps(metadata, indent=2) + "\n")
    def stamp(seconds):
        ms = round(seconds * 1000)
        h, ms = divmod(ms, 3600000)
        m, ms = divmod(ms, 60000)
        s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"
    captions = []
    for i, p in enumerate(paragraphs, 1):
        text = p["text"].replace("S O S", "SOS").replace("M C P", "MCP")
        start = p["start"] + p["audio_lead"]
        text = textwrap.fill(text, width=60)
        captions.append(f'{i}\n{stamp(start)} --> {stamp(start + p["audio_seconds"])}\n{text}\n')
    (HERE / "captions.srt").write_text("\n".join(captions))
    vtt = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", "\n".join(captions))
    (HERE / "captions.vtt").write_text("WEBVTT\n\n" + vtt)
    print("Narration seconds:", round(sum(p["audio_seconds"] for p in paragraphs), 3))
    print("Timeline:", [(p["id"], p["start"], p["duration"]) for p in paragraphs])


if __name__ == "__main__":
    main()
