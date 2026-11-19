#!/usr/bin/env bash
# Joins the numbered screen recordings (1.mov, 2.mov, …) into the promo video, with a fade in and a fade out.
#   promo/video/montreal-driver.mp4         1920 wide, 60 fps (full quality, for sharing)
#   promo/video/montreal-driver-720p.mp4    1280 wide, 60 fps (light, for the web)
#   promo/video/montreal-driver-poster.jpg  frame at POSTER_AT (the title screen, before the game fades to the drive)
# The 720p is copied to public/video for the phone/tablet page (src/MobileGate.ts), which uses a promo shot as its poster.
# Usage: scripts/promo-video.sh [clips dir, default promo/video]
set -euo pipefail
cd "$(dirname "$0")/.."
src=${1:-promo/video}
out=promo/video
pub=public/video
FADE_IN=0.3
FADE_OUT=0.6
POSTER_AT=0.6

clips=()
while IFS= read -r f; do clips+=("$f"); done < <(ls "$src" | grep -E '^[0-9]+\.mov$' | sort -n)
((${#clips[@]})) || { echo "no numbered .mov clips in $src" >&2; exit 1; }
echo "clips: ${clips[*]}"

inputs=() labels="" total=0
for i in "${!clips[@]}"; do
  inputs+=(-i "$src/${clips[$i]}")
  labels+="[$i:v]"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src/${clips[$i]}")
  total=$(echo "$total + $d" | bc)
done
fade_at=$(echo "$total - $FADE_OUT" | bc)
echo "total ${total}s, fade out at ${fade_at}s"

# Screen recordings are variable frame rate: fps=60 makes them constant before scaling and fading.
encode() { # width crf maxrate bufsize level file
  local f="${labels}concat=n=${#clips[@]}:v=1:a=0,fps=60,scale=$1:-2:flags=lanczos,format=yuv420p"
  f+=",fade=t=in:st=0:d=$FADE_IN,fade=t=out:st=$fade_at:d=$FADE_OUT[v]"
  ffmpeg -y -v error -stats "${inputs[@]}" -filter_complex "$f" -map "[v]" \
    -c:v libx264 -preset slow -crf "$2" -maxrate "$3" -bufsize "$4" -profile:v high -level "$5" -g 120 \
    -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -an -movflags +faststart "$6"
}
encode 1920 22 10M 20M 4.2 "$out/montreal-driver.mp4"
encode 1280 24 4M 8M 4.1 "$out/montreal-driver-720p.mp4"
ffmpeg -y -v error -ss "$POSTER_AT" -i "$out/montreal-driver-720p.mp4" -frames:v 1 -q:v 3 "$out/montreal-driver-poster.jpg"

mkdir -p "$pub"
cp "$out/montreal-driver-720p.mp4" "$pub/"
ls -lh "$out"/montreal-driver* "$pub"
