// The pipeline, ported from slackmoji.sh.
//
// Walks the same quality/fps ladder, stops at the first rung that fits under the
// size cap, then falls back to gifsicle --lossy exactly as the script does.
// Unlike the script it reports real progress, because it drives each step itself.

import { decode } from './decode.js';
import { scaleFrame } from './resize.js';
import { countGifFrames, encodeGif, encodePng, encodeJpeg, runGifsicle } from './encode.js';
import {
  FIT, FPS_CAP, GIF_CAP, HARD_CAP, LADDER, LOSSY_RAMP, MAX_FRAMES, PNG_CAP, TARGET_PX,
} from './constants.js';

/**
 * @param {File} file
 * @param {{mode?: string, px?: number, background?: string|null, fpsCap?: number, crop?: object|null}} opts
 * @param {(p: {percent: number, label: string}) => void} onProgress
 */
export async function optimize(file, opts = {}, onProgress = () => {}) {
  const { mode = FIT.FIT, px = TARGET_PX, background = null, fpsCap = FPS_CAP, crop = null } = opts;
  const say = (percent, label) => onProgress({ percent, label });

  say(2, 'reading');
  const src = await decode(file, (p) => say(2 + p * 16, 'reading frames'));
  say(18, `${src.frames.length} frame${src.frames.length === 1 ? '' : 's'}`);

  // Scaling a given source frame gives the same result at every rung, so do it
  // once and reuse. This is the whole reason the browser version isn't slower.
  const scaled = new Map();
  const scaleOnce = async (i) => {
    if (!scaled.has(i)) {
      scaled.set(i, await scaleFrame(src.frames[i], { mode, px, background, crop }));
    }
    return scaled.get(i);
  };

  if (!src.animated || src.frames.length < 2) {
    return finishStatic(await scaleOnce(0), file, say);
  }
  return finishAnimated(src, scaleOnce, fpsCap, file, say);
}

// --- static ------------------------------------------------------------------
async function finishStatic(image, file, say) {
  say(60, 'encoding png');
  let bytes = await encodePng(image);
  let ext = 'png', type = 'image/png';

  // A 128x128 PNG tops out around 66 KB even for pure noise, so this only ever
  // runs if someone raises the target size well past Slack's 128px.
  if (bytes.length > PNG_CAP) {
    for (const q of [0.92, 0.85, 0.75, 0.65, 0.5]) {
      say(70, `png too big, trying jpeg q${Math.round(q * 100)}`);
      const jpg = await encodeJpeg(image, q);
      if (jpg.length <= PNG_CAP) { bytes = jpg; ext = 'jpg'; type = 'image/jpeg'; break; }
      bytes = jpg; ext = 'jpg'; type = 'image/jpeg';
    }
  }
  say(100, 'done');
  return result(bytes, ext, type, image, 1, file);
}

// --- animated ----------------------------------------------------------------
async function finishAnimated(src, scaleOnce, fpsCap, file, say) {
  const ladder = LADDER.map(([fps, q]) => [Math.min(fps, fpsCap), q]);
  const duration = src.duration > 0
    ? src.duration
    : src.delays.reduce((a, b) => a + b, 0) / 1000;

  let best = null;
  for (let rung = 0; rung < ladder.length; rung++) {
    const [wantFps, quality] = ladder[rung];

    // Respect the 50-frame ceiling by dropping fps, same as the script — plus a
    // hard truncation below, for sources whose duration we can't trust.
    let fps = wantFps;
    if (duration > 0 && Math.round(duration * fps) > MAX_FRAMES) {
      fps = Math.max(1, Math.floor(MAX_FRAMES / duration));
    }

    const picks = pickFrames(src.delays, duration, fps).slice(0, MAX_FRAMES);
    if (picks.length < 2) break;

    const base = 20 + (rung / ladder.length) * 65;
    say(base, `${fps} fps, quality ${quality}`);

    const frames = [];
    for (let i = 0; i < picks.length; i++) {
      frames.push(await scaleOnce(picks[i]));
      if (i % 6 === 0) say(base + (i / picks.length) * 4, `${fps} fps, quality ${quality}`);
    }

    let gif;
    try {
      gif = await encodeGif(frames, fps, quality);
      gif = await runGifsicle(gif, '-O3').catch(() => gif); // lossless squeeze
    } catch (e) {
      console.warn(`rung ${fps}/${quality} failed`, e);
      continue;
    }

    const candidate = {
      bytes: gif, fps, quality, frames: picks.length,
      width: frames[0].width, height: frames[0].height,
    };
    if (!best || gif.length < best.bytes.length) best = candidate;
    if (gif.length <= GIF_CAP) { best = candidate; break; }
  }

  if (!best) throw new Error('no ladder rung produced a GIF');

  // Last resort, straight from the script: ramp gifsicle's lossy quantizer up
  // until it fits.
  if (best.bytes.length > GIF_CAP) {
    const lossless = best.bytes;
    for (let i = 0; i < LOSSY_RAMP.length; i++) {
      const lossy = LOSSY_RAMP[i];
      say(88 + (i / LOSSY_RAMP.length) * 10, `squeezing (lossy ${lossy})`);
      try {
        // Start every rung from the lossless candidate. Feeding each result
        // into the next rung compounds artifacts without a reliable size win.
        best.bytes = await runGifsicle(lossless, `-O3 --lossy=${lossy}`);
      } catch { continue; }
      if (best.bytes.length <= GIF_CAP) break;
    }
  }

  say(100, 'done');
  const realFrames = countGifFrames(best.bytes) ?? best.frames;
  return result(best.bytes, 'gif', 'image/gif',
    { width: best.width, height: best.height }, realFrames, file,
    { fps: best.fps, quality: best.quality, framesEncoded: best.frames });
}

/**
 * Which source frames to use for `fps` output frames, by walking the source's
 * own timeline — the same thing ffmpeg's fps filter does.
 */
function pickFrames(delays, duration, fps) {
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration * fps)));
  const ends = [];
  let t = 0;
  for (const d of delays) { t += d / 1000; ends.push(t); }

  const picks = [];
  for (let i = 0; i < count; i++) {
    const want = (i + 0.5) * (duration / count);
    let idx = ends.findIndex((e) => e > want);
    if (idx === -1) idx = delays.length - 1;
    picks.push(idx);
  }
  return picks;
}

function result(bytes, ext, type, dims, frames, file, meta = {}) {
  const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'emoji';
  return {
    blob: new Blob([bytes], { type }),
    bytes: bytes.length,
    ext, type, frames,
    width: dims.width, height: dims.height,
    name: base,
    overCap: bytes.length > HARD_CAP,
    ...meta,
  };
}
