#!/bin/zsh
set -euo pipefail
task_root="$(cd -- "$(dirname -- "$0")/../../.." && pwd)"
cd "$task_root"
export XDG_CACHE_HOME="$task_root/.video-work/cache"
video_python="$task_root/.video-work/venv/bin/python"
pilot_dir="docs/video/pilot"
"$video_python" -m manim -qh --fps 30 --media_dir "$pilot_dir/media" \
  --disable_caching "$pilot_dir/pilot.py" TurboPilot
ffmpeg -v warning -y \
  -i "$pilot_dir/media/videos/pilot/1080p30/TurboPilot.mp4" \
  -i "$pilot_dir/audio/narration.wav" -i "$pilot_dir/captions.srt" \
  -map 0:v:0 -map 1:a:0 -map 2:0 \
  -vf 'tpad=stop_mode=clone:stop_duration=1,fps=30' \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p \
  -c:a aac -b:a 192k -ar 48000 \
  -af 'loudnorm=I=-16:TP=-1.5:LRA=11' -c:s mov_text \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title=English \
  -disposition:s:0 0 -map_metadata -1 \
  -metadata title='Pi Turbo — Fast judgments, deeper help' \
  -t 60 -movflags +faststart "$pilot_dir/pi-turbo-pilot.mp4"
