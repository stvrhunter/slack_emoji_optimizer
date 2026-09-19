#!/usr/bin/env bash
#
# slackmoji.sh — optimize images & GIFs into Slack custom emoji.
# Best quality that fits Slack's hard limits: 128x128, < 128 KB, PNG/JPG/GIF.
#
# Pipeline:
#   static (png/jpg/webp) -> PNG  : ffmpeg lanczos fit-128 + pngquant
#   animated (gif/webp/mp4/mov/...) -> GIF : ffmpeg lanczos frames + gifski
#         (per-frame palettes = highest perceptual quality), descending a
#         quality/fps ladder; first rung under the size cap wins; gifsicle -O3
#         squeezes losslessly, then --lossy as a last resort.
#
# Usage:
#   ./slackmoji.sh input1 [input2 ...] [options]
#
# Options:
#   -o DIR      output directory              (default: ./optimized)
#   -s          pad to square 128x128 (transparent)   (default: fit, keep aspect)
#   -b COLOR    pad/fill background color (e.g. white, #1a1a1a)  (implies -s)
#   -c          centre-crop to square, then scale to exactly SIZExSIZE
#   -m BYTES    max file size in bytes        (default: 128000, Slack cap 131072)
#   -p SIZE     target longest side in px      (default: 128)
#   -f FPS      cap source fps for animation   (default: 30)
#   -h          help
#
# Requires: ffmpeg, ffprobe, gifski, gifsicle, pngquant  (brew install ...)
# Animated .webp additionally needs python3 with Pillow — ffmpeg cannot decode it.

set -euo pipefail

# ---- defaults ----------------------------------------------------------------
OUTDIR="optimized"
SQUARE=0
CROP=0
BG=""
MAXBYTES=128000          # gif safety margin under Slack's 131072 hard cap
IMGMAX=130000            # static images: allow near-full 127 KB, favor quality
PX=128
FPSCAP=30
MAXFRAMES=50             # Slack animated-emoji frame ceiling

usage() { sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ---- parse args --------------------------------------------------------------
INPUTS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) OUTDIR="$2"; shift 2;;
    -c) CROP=1; shift;;
    -s) SQUARE=1; shift;;
    -b) BG="$2"; SQUARE=1; shift 2;;
    -m) MAXBYTES="$2"; shift 2;;
    -p) PX="$2"; shift 2;;
    -f) FPSCAP="$2"; shift 2;;
    -h|--help) usage 0;;
    -*) echo "unknown option: $1" >&2; usage 1;;
    *) INPUTS+=("$1"); shift;;
  esac
done
[[ ${#INPUTS[@]} -eq 0 ]] && usage 1

# ---- tool check --------------------------------------------------------------
for t in ffmpeg ffprobe gifski gifsicle pngquant; do
  command -v "$t" >/dev/null 2>&1 || { echo "missing tool: $t (brew install $t)" >&2; exit 1; }
done

[[ "$PX" -gt 128 ]] && echo "warning: -p $PX exceeds Slack's 128px emoji limit" >&2

mkdir -p "$OUTDIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

sizeof() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }
human()  { awk -v b="$1" 'BEGIN{ if(b<1024) printf "%d B",b; else if(b<1048576) printf "%.1f KB",b/1024; else printf "%.1f MB",b/1048576 }'; }

# scale filter: fit within PXxPX keeping aspect (lanczos). optional square pad.
scale_filter() {
  # crop to centered square, then scale to exact PXxPX.
  if [[ $CROP -eq 1 ]]; then
    printf "crop='min(iw,ih)':'min(iw,ih)',scale=%s:%s:flags=lanczos" "$PX" "$PX"; return
  fi
  local f="scale=${PX}:${PX}:force_original_aspect_ratio=decrease:flags=lanczos"
  if [[ $SQUARE -eq 1 ]]; then
    local pad="${BG:-black@0}"                      # transparent by default
    # format=rgba first: with no alpha channel ffmpeg renders black@0 as opaque
    # black, so jpeg/mp4 sources come back with solid bars instead of nothing.
    f="${f},format=rgba,pad=${PX}:${PX}:(ow-iw)/2:(oh-ih)/2:${pad}"
  fi
  printf '%s' "$f"
}

# is input animated?  0 = animated, 1 = static
is_animated() {
  local in="$1" ext="${1##*.}"
  ext="$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    mp4|mov|webm|mkv|avi|m4v|apng) return 0;;
    webp)
      # ffprobe reports N/A on animated webp, so read the container instead:
      # animated files carry an ANIM chunk in the first few dozen bytes.
      head -c 64 "$in" | LC_ALL=C grep -aq 'ANIM' && return 0 || return 1;;
    gif)
      local n
      n=$(ffprobe -v error -select_streams v:0 -count_frames \
            -show_entries stream=nb_read_frames -of csv=p=0 "$in" 2>/dev/null || echo 1)
      n="${n//[!0-9]/}"          # ffprobe can say "N/A", which -gt would try to expand
      [[ "${n:-1}" -gt 1 ]] && return 0 || return 1;;
    *) return 1;;
  esac
}

# ---- static image -> PNG -----------------------------------------------------
do_static() {
  local in="$1" out="$2"
  ffmpeg -y -loglevel error -i "$in" -vf "$(scale_filter)" -frames:v 1 "$TMP/s.png"

  # lossless first — best quality; keep as-is if it already fits.
  if [[ "$(sizeof "$TMP/s.png")" -le "$IMGMAX" ]]; then
    cp "$TMP/s.png" "$out"; return
  fi

  # too big: pngquant ladder, drop colors until under cap. every rung quantizes
  # the pristine png — feeding each rung the previous rung's output stacks up
  # dithering noise for no size win.
  local best="$TMP/best.png"
  cp "$TMP/s.png" "$best"
  for ncol in 256 200 128 96 64 48 32; do
    pngquant --force --strip --speed 1 "$ncol" --output "$TMP/q.png" "$TMP/s.png" 2>/dev/null || continue
    cp "$TMP/q.png" "$best"
    [[ "$(sizeof "$best")" -le "$IMGMAX" ]] && break
  done
  cp "$best" "$out"
}

# ffmpeg (through 8.x) cannot decode animated webp — it errors with "image data
# not found". Pillow composites the partial frames correctly, so dump them to a
# png sequence and hand ffmpeg that instead. Echoes the ffmpeg input args to use.
webp_to_frames() {
  local in="$1" dir="$2"
  # This directory is reused for each input. Clear it so a shorter second WebP
  # cannot inherit trailing frames from the previous file.
  rm -rf "$dir"; mkdir -p "$dir"
  python3 - "$in" "$dir" <<'PY' || return 1
import sys
from PIL import Image, ImageSequence
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
delays = []
for i, fr in enumerate(ImageSequence.Iterator(im)):
    fr.convert("RGBA").save(f"{dst}/{i+1:05d}.png")
    delays.append(fr.info.get("duration", 100) or 100)
print(round(1000.0 * len(delays) / sum(delays), 4))
PY
}

# ---- animated -> GIF ---------------------------------------------------------
do_animated() {
  local in="$1" out="$2"

  # normalize animated webp to a png sequence ffmpeg can actually read.
  local ff_in=(-i "$in") dur=""       # dur is set here for webp, probed below otherwise
  if [[ "$(printf '%s' "${in##*.}" | tr '[:upper:]' '[:lower:]')" == "webp" ]]; then
    local native_fps
    if ! command -v python3 >/dev/null 2>&1 \
       || ! native_fps=$(webp_to_frames "$in" "$TMP/webp" 2>/dev/null) \
       || [[ -z "$native_fps" ]]; then
      echo "skip (animated webp needs python3 + Pillow: pip install Pillow): $in" >&2
      return 1
    fi
    ff_in=(-framerate "$native_fps" -i "$TMP/webp/%05d.png")
    dur=$(awk "BEGIN{printf \"%.4f\", $(ls "$TMP/webp" | wc -l) / $native_fps}")
  fi

  awk_ok() { awk "BEGIN{exit !($1)}"; }
  # duration to respect the 50-frame ceiling (already set above for webp).
  if [[ -z "${dur:-}" ]]; then
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$in" 2>/dev/null || echo 0)
    dur="${dur//[!0-9.]/}"; dur="${dur:-0}"
  fi

  # quality/fps ladder, best -> worst. first rung under cap wins.
  #        fps  quality
  local ladder=(
    "$FPSCAP 100" "24 100" "20 95" "18 90" "15 90"
    "15 80" "12 75" "12 65" "10 60" "10 50" "8 45"
  )

  local chosen=""
  for rung in "${ladder[@]}"; do
    local fps="${rung% *}" q="${rung#* }"

    # respect 50-frame cap: drop fps if this many frames would exceed it.
    if awk_ok "$dur > 0"; then
      local nf
      nf=$(awk "BEGIN{printf \"%d\", $dur*$fps + 0.5}")
      if [[ "$nf" -gt "$MAXFRAMES" ]]; then
        fps=$(awk "BEGIN{f=$MAXFRAMES/$dur; printf \"%d\", (f<1?1:f)}")
      fi
    fi

    rm -rf "$TMP/fr"; mkdir -p "$TMP/fr"
    # -frames:v is a hard backstop: the fps maths above is skipped entirely when
    # the source reports no duration, and Slack rejects anything over 50 frames.
    ffmpeg -y -loglevel error "${ff_in[@]}" \
      -vf "fps=${fps},$(scale_filter)" -frames:v "$MAXFRAMES" "$TMP/fr/%05d.png"
    [[ -z "$(ls -A "$TMP/fr" 2>/dev/null)" ]] && continue

    gifski --quiet --fps "$fps" --quality "$q" \
      -o "$TMP/g.gif" "$TMP"/fr/*.png 2>/dev/null || continue

    # lossless squeeze.
    gifsicle -O3 "$TMP/g.gif" -o "$TMP/g2.gif" 2>/dev/null && mv "$TMP/g2.gif" "$TMP/g.gif"

    local candidate_size
    candidate_size="$(sizeof "$TMP/g.gif")"
    if [[ "$candidate_size" -le "$MAXBYTES" ]]; then
      chosen="$TMP/g.gif"; break
    fi
    # Ladder size usually falls with fps/quality, but not always. Preserve the
    # actual smallest candidate rather than blindly keeping the final rung.
    if [[ -z "$chosen" || "$candidate_size" -lt "$(sizeof "$chosen")" ]]; then
      cp "$TMP/g.gif" "$TMP/best.gif"
      chosen="$TMP/best.gif"
    fi
  done

  if [[ -z "$chosen" || ! -s "$chosen" ]]; then
    echo "failed (no ladder rung produced a gif): $in" >&2
    return 1
  fi

  # last resort: gifsicle lossy ramp on the smallest lossless candidate.
  if [[ "$(sizeof "$chosen")" -gt "$MAXBYTES" ]]; then
    cp "$chosen" "$TMP/lossless.gif"
    for lossy in 30 60 90 120 160 200 260; do
      # Every rung starts from the lossless candidate. Recompressing an already
      # lossy GIF compounds artifacts and makes the ladder unpredictable.
      gifsicle -O3 --lossy="$lossy" "$TMP/lossless.gif" -o "$TMP/gl.gif" 2>/dev/null || continue
      cp "$TMP/gl.gif" "$chosen"
      [[ "$(sizeof "$chosen")" -le "$MAXBYTES" ]] && break
    done
  fi
  cp "$chosen" "$out"
}

# ---- run ---------------------------------------------------------------------
for in in "${INPUTS[@]}"; do
  [[ -f "$in" ]] || { echo "skip (not found): $in" >&2; continue; }
  base="$(basename "${in%.*}")"

  if is_animated "$in"; then
    out="$OUTDIR/${base}.gif"; do_animated "$in" "$out" || continue
  else
    out="$OUTDIR/${base}.png"; do_static "$in" "$out" || continue
  fi

  sz=$(sizeof "$out"); flag=""
  [[ "$sz" -gt 131072 ]] && flag="  ⚠ OVER 128KB HARD CAP"
  dims=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
           -of csv=s=x:p=0 "$out" 2>/dev/null | head -1)
  printf '%-40s %-9s %-9s%s\n' "$(basename "$out")" "$dims" "$(human "$sz")" "$flag"
done
