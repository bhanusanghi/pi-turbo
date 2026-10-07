"""Generate local Kokoro narration and a measured, frame-aligned film timeline."""
from pathlib import Path
import argparse
import hashlib
import json
import math
import os
import re
import textwrap

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(ROOT / ".video-work/hf-cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(ROOT / ".video-work/cache"))
MODEL = ROOT / ".video-work/models/Kokoro-82M-8bit"
REVISION = "7e173a214392b1e0cb397e71c9745cbd14c06063"
FPS = 30


def spoken_text(text):
    text = re.sub(r"\bPi\b", "Pie", text)
    text = re.sub(r"\bMCP\b", "M C P", text)
    text = re.sub(r"\bSOS\b", "S O S", text)
    text = re.sub(r"\bJev\b", "Jev", text)
    return text


def stamp(seconds, vtt=False):
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3600000)
    minutes, millis = divmod(millis, 60000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02}{'.' if vtt else ','}{millis:03}"


def caption_cues(text, start, duration):
    """Sentence/phrase timing is proportional, not claimed as word alignment."""
    for spoken, displayed in (("S O S", "SOS"), ("L L M", "LLM"), ("M C P", "MCP")):
        text = text.replace(spoken, displayed)
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    phrases = []
    for sentence in sentences:
        words = sentence.split()
        # Short cues fit two readable lines. Split long sentences at word boundaries.
        while words:
            phrases.append(" ".join(words[:16]))
            words = words[16:]
    weight = sum(len(p.split()) for p in phrases)
    cursor = start
    for phrase in phrases:
        slot = duration * len(phrase.split()) / weight
        yield cursor, cursor + slot, textwrap.fill(phrase, width=48)
        cursor += slot


def main():
    import numpy as np
    import soundfile as sf
    parser = argparse.ArgumentParser()
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--force", action="store_true", help="Regenerate existing paragraph WAVs")
    parser.add_argument("--timing-only", action="store_true", help="Require existing WAVs; do not load GPU model")
    args = parser.parse_args()
    configuration = json.loads((MODEL / "config.json").read_text())
    if configuration.get("quantization", {}).get("bits") != 8:
        raise RuntimeError("Expected the downloaded 8-bit Kokoro model")
    download_metadata = MODEL / ".cache/huggingface/download/kokoro-v1_0.safetensors.metadata"
    if download_metadata.exists() and download_metadata.read_text().splitlines()[0] != REVISION:
        raise RuntimeError("Local model snapshot differs from the recorded production revision")
    script_bytes = (HERE / "script.json").read_bytes()
    script = json.loads(script_bytes)
    scenes = script["scenes"]
    target = float(script.get("target_seconds", 420))
    model = None
    voice = str(MODEL / "voices/af_heart.safetensors")
    result_scenes = []
    sample_rate = None
    for index, scene in enumerate(scenes, 1):
        directory = HERE / "audio" / scene["id"]
        directory.mkdir(parents=True, exist_ok=True)
        paragraphs = []
        cursor = 0.5
        for number, paragraph in enumerate(scene["narration"], 1):
            text = paragraph if isinstance(paragraph, str) else paragraph["text"]
            wav = directory / f"paragraph-{number:02}.wav"
            fingerprint = hashlib.sha256((spoken_text(text) + f"|af_heart|{args.speed}|{REVISION}").encode()).hexdigest()
            cache = wav.with_suffix(".json")
            valid_cache = wav.exists() and cache.exists() and json.loads(cache.read_text()).get("fingerprint") == fingerprint
            if args.force or not valid_cache:
                if args.timing_only:
                    raise RuntimeError(f"Missing/current audio required: {wav}")
                if model is None:
                    from mlx_audio.tts.utils import load_model
                    model = load_model(MODEL)
                chunks = [np.asarray(r.audio).reshape(-1) for r in model.generate(spoken_text(text), voice=voice, lang_code="a", speed=args.speed)]
                if not chunks:
                    raise RuntimeError(f"No speech generated for {scene['id']} paragraph {number}")
                waveform = np.concatenate(chunks)
                if not np.isfinite(waveform).all():
                    raise ValueError("Non-finite audio")
                sf.write(wav, waveform, model.sample_rate, subtype="PCM_16")
                cache.write_text(json.dumps({"fingerprint": fingerprint, "text": text, "speed": args.speed}) + "\n")
            data, sr = sf.read(wav, dtype="float32")
            if not np.isfinite(data).all():
                raise ValueError(f"Non-finite cached audio: {wav}")
            if sample_rate is not None and sample_rate != sr:
                raise ValueError("Mixed sample rates are unsupported")
            sample_rate = sr
            duration = len(data) / sr
            paragraphs.append(dict(text=text, audio_start=cursor, audio_seconds=duration, wav=str(wav.relative_to(HERE)), peak=float(np.abs(data).max()), rms=float(np.sqrt(np.mean(data ** 2))), clipped_samples=int(np.count_nonzero(np.abs(data) >= 0.999)), finite=True))
            cursor += duration + 0.25
            print(f"{scene['id']} paragraph {number}: {duration:.2f}s", flush=True)
        frames = math.ceil(max(float(scene.get("min_seconds", 0)), cursor + 0.25) * FPS)
        result_scenes.append(dict(id=scene["id"], title=scene["title"], chapter=scene.get("chapter", scene["title"]), frames=frames, audio_seconds=sum(p["audio_seconds"] for p in paragraphs), paragraphs=paragraphs, class_name=f"Scene{index:02}", narration_wav=f"audio/{scene['id']}/narration.wav"))
    requested_frames = round(target * FPS)
    minimum_frames = sum(s["frames"] for s in result_scenes)
    if minimum_frames > 480 * FPS:
        raise RuntimeError(f"Narration and minimum holds need {minimum_frames / FPS:.2f}s, beyond8 minutes. Edit script; voice will not be rushed.")
    total_frames = max(requested_frames, minimum_frames)
    spare = total_frames - minimum_frames
    weights = [float(s.get("hold_weight", 1)) for s in scenes]
    extras = [int(spare * w / sum(weights)) for w in weights]
    extras[-1] += spare - sum(extras)
    mix = np.zeros(round(total_frames / FPS * sample_rate), dtype="float32")
    start_frame = 0
    for scene, extra in zip(result_scenes, extras):
        scene["frames"] += extra
        scene["start"] = start_frame / FPS
        scene["duration"] = scene["frames"] / FPS
        scene["video_path"] = f"media/videos/film/1080p30/{scene['class_name']}.mp4"
        local = np.zeros(round(scene["duration"] * sample_rate), dtype="float32")
        for paragraph in scene["paragraphs"]:
            data, _ = sf.read(HERE / paragraph["wav"], dtype="float32")
            at = round(paragraph["audio_start"] * sample_rate)
            if at + len(data) > len(local):
                raise RuntimeError("Narration exceeds measured scene slot")
            local[at:at + len(data)] += data
        sf.write(HERE / scene["narration_wav"], local, sample_rate, subtype="PCM_16")
        at = round(scene["start"] * sample_rate)
        mix[at:at + len(local)] = local[:len(mix) - at]
        start_frame += scene["frames"]
    sf.write(HERE / "audio/narration.wav", mix, sample_rate, subtype="PCM_16")
    metadata = dict(model="mlx-community/Kokoro-82M-8bit", model_revision=REVISION, voice="af_heart", speed=args.speed, sample_rate=sample_rate, fps=FPS, duration=total_frames / FPS, frames=total_frames, target_seconds=target, script_sha256=hashlib.sha256(script_bytes).hexdigest(), caption_alignment="Estimated within each measured paragraph; not word-aligned", scenes=result_scenes, by_id={s["id"]: s for s in result_scenes})
    (HERE / "timing.json").write_text(json.dumps(metadata, indent=2) + "\n")
    cues = []
    for scene in result_scenes:
        for paragraph in scene["paragraphs"]:
            cues.extend(caption_cues(paragraph["text"], scene["start"] + paragraph["audio_start"], paragraph["audio_seconds"]))
    for extension in ("srt", "vtt"):
        blocks = []
        for number, (start, end, text) in enumerate(cues, 1):
            blocks.append(f"{number}\n{stamp(start, extension == 'vtt')} --> {stamp(end, extension == 'vtt')}\n{text}\n")
        (HERE / f"captions.{extension}").write_text(("WEBVTT\n\n" if extension == "vtt" else "") + "\n".join(blocks))
    print(json.dumps({"duration": metadata["duration"], "speech_seconds": sum(s["audio_seconds"] for s in result_scenes), "scenes": len(result_scenes)}, indent=2), flush=True)


if __name__ == "__main__":
    main()
