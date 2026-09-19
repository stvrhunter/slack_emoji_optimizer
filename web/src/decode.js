// Turns whatever the user dropped in into a list of RGBA frames.
//
// The script shells out to ffmpeg for this. In a browser we use what's already
// built in: gifuct-js for GIFs, a <video> element for video, createImageBitmap
// for stills, and WebCodecs' ImageDecoder for animated WebP where it exists.

import { parseGIF, decompressFrames } from 'gifuct-js';
import { FPS_CAP, MAX_FRAMES } from './constants.js';
import { canvas2d } from './canvas.js';

/** @returns {Promise<{frames: ImageData[], delays: number[], width, height, animated, duration}>} */
export async function decode(file, onProgress = () => {}) {
  const type = file.type || '';
  const ext = file.name.split('.').pop().toLowerCase();

  if (type.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) {
    return decodeVideo(file, onProgress);
  }
  if (type === 'image/gif' || ext === 'gif') {
    const gif = await decodeGif(file, onProgress);
    if (gif.frames.length > 1) return gif;
    return gif; // a one-frame gif is just a still; the caller handles that
  }
  if (type === 'image/webp' || ext === 'webp') {
    const anim = await decodeAnimatedWebp(file, onProgress).catch(() => null);
    if (anim && anim.frames.length > 1) return anim;
  }
  return decodeStill(file);
}

// --- stills ------------------------------------------------------------------
async function decodeStill(file) {
  const bmp = await createImageBitmap(file);
  // ImageBitmap dimensions may become zero after close(), so retain them first.
  const width = bmp.width, height = bmp.height;
  const [, ctx] = canvas2d(width, height, { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, width, height);
  bmp.close?.();
  return { frames: [data], delays: [0], width, height,
           animated: false, duration: 0 };
}

// --- GIF ---------------------------------------------------------------------
// gifuct hands back partial patches with GIF's disposal rules; we composite them
// onto a running canvas so every frame is a complete image.
async function decodeGif(file, onProgress) {
  const gif = parseGIF(await file.arrayBuffer());
  const raw = decompressFrames(gif, true);
  const width = gif.lsd.width, height = gif.lsd.height;

  const [, ctx] = canvas2d(width, height, { willReadFrequently: true });
  const [patchCanvas, patchCtx] = canvas2d(width, height, { willReadFrequently: true });

  const frames = [], delays = [];
  let previous = null;

  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (f.disposalType === 3) previous = ctx.getImageData(0, 0, width, height);

    patchCanvas.width = f.dims.width; patchCanvas.height = f.dims.height;
    patchCtx.putImageData(
      new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
    ctx.drawImage(patchCanvas, f.dims.left, f.dims.top);

    frames.push(ctx.getImageData(0, 0, width, height));
    delays.push(Math.max(f.delay || 100, 10));

    if (f.disposalType === 2) ctx.clearRect(f.dims.left, f.dims.top, f.dims.width, f.dims.height);
    else if (f.disposalType === 3 && previous) ctx.putImageData(previous, 0, 0);

    if (i % 8 === 0) { onProgress(i / raw.length); await tick(); }
  }
  return { frames, delays, width, height, animated: frames.length > 1,
           duration: delays.reduce((a, b) => a + b, 0) / 1000 };
}

// --- animated WebP -----------------------------------------------------------
// ffmpeg 8 still can't decode these at all. Chrome and Safari can, via ImageDecoder.
async function decodeAnimatedWebp(file, onProgress) {
  if (typeof ImageDecoder === 'undefined') throw new Error('no ImageDecoder');
  const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/webp' });
  // tracks.ready has to settle before selectedTrack exists — `completed` alone
  // leaves it null.
  await dec.tracks.ready;
  await dec.completed;
  const count = dec.tracks.selectedTrack?.frameCount ?? 0;
  if (count <= 1) throw new Error('not animated');

  const frames = [], delays = [];
  let ctx = null, width = 0, height = 0;
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    if (!ctx) {
      width = image.displayWidth; height = image.displayHeight;
      [, ctx] = canvas2d(width, height, { willReadFrequently: true });
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0);
    frames.push(ctx.getImageData(0, 0, width, height));
    delays.push(Math.max((image.duration || 100000) / 1000, 10));
    image.close();
    if (i % 8 === 0) { onProgress(i / count); await tick(); }
  }
  dec.close();
  return { frames, delays, width, height, animated: true,
           duration: delays.reduce((a, b) => a + b, 0) / 1000 };
}

// --- video -------------------------------------------------------------------
// Seek-and-draw. Slower than ffmpeg but it handles anything the browser can play,
// and we only ever need MAX_FRAMES of it.
async function decodeVideo(file, onProgress) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;

  try {
    await new Promise((ok, fail) => {
      v.onloadeddata = ok;
      v.onerror = () => fail(new Error(`browser can't decode ${file.name}`));
    });
    const duration = v.duration;
    if (!isFinite(duration) || duration <= 0) throw new Error('no duration');

    // Sample at FPS_CAP, but never more than the frame ceiling.
    const count = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration * FPS_CAP)));
    const width = v.videoWidth, height = v.videoHeight;
    const [, ctx] = canvas2d(width, height, { willReadFrequently: true });
    const frames = [], delays = [];

    for (let i = 0; i < count; i++) {
      await seek(v, (i + 0.5) * (duration / count));
      ctx.drawImage(v, 0, 0);
      frames.push(ctx.getImageData(0, 0, width, height));
      delays.push((duration / count) * 1000);
      onProgress(i / count);
    }
    return { frames, delays, width, height, animated: count > 1, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const seek = (v, t) => new Promise((ok) => {
  v.onseeked = () => ok();
  v.currentTime = Math.min(t, Math.max(0, v.duration - 0.001));
});

const tick = () => new Promise((r) => setTimeout(r, 0));
