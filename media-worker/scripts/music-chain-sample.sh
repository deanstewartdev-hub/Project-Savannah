#!/usr/bin/env bash
# Local sample of the music chain used by assemble.js: gain, fades and narration ducking.
# Generated tones only (no paid calls, no real narration). Prints measured levels.
# The narration stand-in speaks 0.0-0.4 s, pauses 0.4-0.8 s, and repeats every 0.8 s.
# Usage: bash scripts/music-chain-sample.sh <output-folder>
set -euo pipefail
OUT="${1:?output folder required}"
mkdir -p "$OUT"
T=10.0
VOL=0.25
FADE_IN=0.5
FADE_OUT=1.0
FADE_OUT_START=$(awk "BEGIN{print $T - $FADE_OUT}")
GAIN="volume=$VOL,afade=t=in:st=0:d=$FADE_IN,afade=t=out:st=$FADE_OUT_START:d=$FADE_OUT"
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=220:duration=$T" "$OUT/music-raw.wav"
ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=330:duration=$T" \
  -af "aeval=val(0)*if(lt(mod(t\,0.8)\,0.4)\,1\,0):c=same" "$OUT/narration.wav"
# Music alone through gain and fades, and the same music ducked under narration (as assemble.js does).
ffmpeg -loglevel error -y -i "$OUT/music-raw.wav" -af "$GAIN" "$OUT/music-only.wav"
ffmpeg -loglevel error -y -i "$OUT/music-raw.wav" -i "$OUT/narration.wav" -filter_complex \
  "[0:a]$GAIN[m];[m][1:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=250[ducked]" \
  -map "[ducked]" "$OUT/music-ducked.wav"
level() { ffmpeg -hide_banner -i "$1" -af "atrim=$2:$3,volumedetect" -f null - 2>&1 | grep mean_volume | awk '{print $5, $6}'; }
echo "music alone, gap 0.4-0.8 s (no narration):      $(level "$OUT/music-only.wav" 0.4 0.8)"
echo "music ducked, gap 0.4-0.8 s (no narration):     $(level "$OUT/music-ducked.wav" 0.4 0.8)"
echo "music alone, speech 0.0-0.4 s (narration on):   $(level "$OUT/music-only.wav" 0.0 0.4)"
echo "music ducked, speech 0.0-0.4 s (narration on):  $(level "$OUT/music-ducked.wav" 0.0 0.4)"
