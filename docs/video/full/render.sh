#!/bin/zsh
set -euo pipefail
task_root="$(cd -- "$(dirname -- "$0")/../../.." && pwd)"
cd "$task_root"
export XDG_CACHE_HOME="$task_root/.video-work/cache"
video_python="$task_root/.video-work/venv/bin/python"
film_dir="docs/video/full"
quality="1080"
if [[ "${1:-}" == "--quality" ]]; then
  quality="${2:?Use --quality 480 or --quality 1080}"
  shift 2
fi
if [[ "$quality" == "480" ]]; then
  quality_flag="-ql"
elif [[ "$quality" == "1080" ]]; then
  quality_flag="-qh"
else
  print -u2 "Unknown quality: $quality"
  exit 2
fi
scenes=("$@")
if (( ${#scenes[@]} == 0 )); then
  scenes=(Scene01 Scene02 Scene03 Scene04 Scene05 Scene06 Scene07 Scene08 Scene09 Scene10 Scene11 Scene12)
fi
"$video_python" -m manim "$quality_flag" --fps 30 --media_dir "$film_dir/media" \
  --disable_caching "$film_dir/film.py" "${scenes[@]}"
# Assembly is explicit so a selective rerender does not assemble stale chapters.
