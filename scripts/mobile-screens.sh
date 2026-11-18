#!/usr/bin/env bash
# Phone-sized copies of the published promo shots for the phone/tablet page (src/MobileGate.ts).
# Re-run after changing promo/screenshots; then update SHOTS in src/MobileGate.ts if files were added or renamed.
set -euo pipefail
cd "$(dirname "$0")/.."
out=public/screens
rm -rf "$out" && mkdir -p "$out"
for f in promo/screenshots/*.png; do
  sips -s format jpeg -s formatOptions 72 --resampleWidth 1280 "$f" --out "$out/$(basename "${f%.png}").jpg" >/dev/null
done
ls -l "$out"
