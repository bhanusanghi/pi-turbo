"""Assemble silent measured Manim chapters with local narration and captions."""
from pathlib import Path
import argparse
import json
import subprocess

HERE = Path(__file__).resolve().parent


def run(command):
    print(" ".join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--draft", action="store_true")
    args = parser.parse_args()
    timing = json.loads((HERE / "timing.json").read_text())
    fps = timing["fps"]
    quality = "480p30" if args.draft else "1080p30"
    dimensions = "854:480" if args.draft else "1920:1080"
    work = HERE / "media" / ("assembly-draft" if args.draft else "assembly-final")
    work.mkdir(parents=True, exist_ok=True)
    pieces = []
    for scene in timing["scenes"]:
        source = HERE / "media/videos/film" / quality / f"{scene['class_name']}.mp4"
        if not source.exists():
            raise FileNotFoundError(source)
        piece = work / f"{scene['class_name']}.mp4"
        run(["ffmpeg", "-v", "warning", "-y", "-i", source, "-an", "-vf", f"scale={dimensions},tpad=stop_mode=clone:stop_duration={scene['duration']},fps={fps}", "-frames:v", scene["frames"], "-c:v", "libx264", "-crf", "23" if args.draft else "18", "-preset", "fast" if args.draft else "medium", "-pix_fmt", "yuv420p", piece])
        pieces.append(piece)
    concat = work / "concat.txt"
    concat.write_text("".join("file '" + str(piece).replace("'", "'\\''") + "'\n" for piece in pieces))
    output = HERE / ("pi-turbo-full-draft.mp4" if args.draft else "pi-turbo-full.mp4")
    run(["ffmpeg", "-v", "warning", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-i", HERE / "audio/narration.wav", "-i", HERE / "captions.srt", "-map", "0:v:0", "-map", "1:a:0", "-map", "2:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-disposition:s:0", "0", "-map_metadata", "-1", "-metadata", "title=Pi Turbo — Fast judgments, deeper help", "-t", timing["duration"], "-movflags", "+faststart", output])
    probe = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-show_entries", "format=duration,size:stream=codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,sample_rate", "-of", "json", str(output)], capture_output=True, text=True, check=True)
    evidence = json.loads(probe.stdout)
    video = next(s for s in evidence["streams"] if s["codec_type"] == "video")
    if int(video["nb_read_frames"]) != timing["frames"]:
        raise RuntimeError("Output frame count differs from timeline")
    if abs(float(evidence["format"]["duration"]) - timing["duration"]) > 0.1:
        raise RuntimeError("Output duration differs from timeline")
    evidence.update(expected_frames=timing["frames"], expected_seconds=timing["duration"], model=timing["model"], model_revision=timing["model_revision"], voice=timing["voice"], caption_alignment=timing["caption_alignment"])
    (HERE / ("verification-draft.json" if args.draft else "verification.json")).write_text(json.dumps(evidence, indent=2) + "\n")
    print(f"Delivered {output}: {timing['duration']:.2f}s, {timing['frames']} frames", flush=True)


if __name__ == "__main__":
    main()
