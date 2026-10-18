#!/usr/bin/env bash
# 从 src/assets/noise/*.mp3 的 ID3 内嵌封面（APIC / attached_pic）提取音色封面图。
# 白噪音选择弹窗里的圆形缩略图就是这些图 —— 不另外维护一套设计资源，
# 换音频时重跑本脚本即可，避免「图与声音对不上」的错配。
#
# 用法：bash tools/extract-noise-covers.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v ffmpeg >/dev/null || { echo "需要 ffmpeg（brew install ffmpeg）" >&2; exit 1; }

out=src/assets/noise/covers
mkdir -p "$out"

shopt -s nullglob
files=(src/assets/noise/*.mp3)
[ ${#files[@]} -gt 0 ] || { echo "src/assets/noise 下没有 mp3" >&2; exit 1; }

for f in "${files[@]}"; do
  name=$(basename "$f" .mp3)
  if ffprobe -v error -select_streams v -show_entries stream_disposition=attached_pic \
       -of default=nw=1 "$f" 2>/dev/null | grep -q 'attached_pic=1'; then
    ffmpeg -v error -y -i "$f" -an -c:v copy "$out/$name.jpg"
    printf '  %-10s -> %s\n' "$name.mp3" "$out/$name.jpg"
  else
    echo "  $name.mp3 没有内嵌封面，跳过" >&2
  fi
done

echo "完成：$(ls -1 "$out"/*.jpg 2>/dev/null | wc -l | tr -d ' ') 张封面"
