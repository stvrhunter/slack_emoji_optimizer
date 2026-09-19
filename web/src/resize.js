// Scales frames to 128px. Mirrors scale_filter() in slackmoji.sh:
//   fit     -> scale=128:128:force_original_aspect_ratio=decrease:flags=lanczos
//   square  -> the above, then pad to 128x128 (transparent, or a colour)
//   crop    -> crop='min(iw,ih)', then scale to exactly 128x128
//   custom  -> crop the user-selected normalized square, then scale to 128x128
//
// lanczos3 here is the same filter as ffmpeg's flags=lanczos. linearRGB is off
// on purpose: ffmpeg resizes in the source's gamma space, and the 84 emoji
// already in this repo were built that way.

import resizeImage from '@jsquash/resize';
import { FIT, TARGET_PX } from './constants.js';
import { canvas2d } from './canvas.js';

const RESIZE_OPTS = { method: 'lanczos3', fitMethod: 'stretch', premultiply: true, linearRGB: false };

const ctx2d = (width, height) => canvas2d(width, height, { willReadFrequently: true })[1];

/** Target dimensions for the "fit" case — longest side becomes px, aspect kept. */
export function fitDims(w, h, px = TARGET_PX) {
  const s = Math.min(px / w, px / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Centre-crop an ImageData to a square. */
function cropSquare(image) {
  const side = Math.min(image.width, image.height);
  if (side === image.width && side === image.height) return image;
  const ctx = ctx2d(image.width, image.height);
  ctx.putImageData(image, 0, 0);
  const out = ctx2d(side, side);
  out.drawImage(ctx.canvas,
    Math.floor((image.width - side) / 2), Math.floor((image.height - side) / 2), side, side,
    0, 0, side, side);
  return out.getImageData(0, 0, side, side);
}

/** Crop a normalized region from an ImageData frame. */
function cropRegion(image, crop) {
  const x = Math.max(0, Math.min(image.width - 1, Math.round(crop.x * image.width)));
  const y = Math.max(0, Math.min(image.height - 1, Math.round(crop.y * image.height)));
  const width = Math.max(1, Math.min(image.width - x, Math.round(crop.width * image.width)));
  const height = Math.max(1, Math.min(image.height - y, Math.round(crop.height * image.height)));
  const ctx = ctx2d(image.width, image.height);
  ctx.putImageData(image, 0, 0);
  const out = ctx2d(width, height);
  out.drawImage(ctx.canvas, x, y, width, height, 0, 0, width, height);
  return out.getImageData(0, 0, width, height);
}

/** Centre an ImageData on a px-by-px canvas. background null = transparent. */
function pad(image, px, background) {
  const ctx = ctx2d(px, px);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, px, px); }
  const src = ctx2d(image.width, image.height);
  src.putImageData(image, 0, 0);
  ctx.drawImage(src.canvas, Math.floor((px - image.width) / 2), Math.floor((px - image.height) / 2));
  return ctx.getImageData(0, 0, px, px);
}

/**
 * @param {ImageData} image
 * @param {{mode: string, px: number, background: string|null, crop: object|null}} opts
 */
export async function scaleFrame(image,
  { mode = FIT.FIT, px = TARGET_PX, background = null, crop = null } = {}) {
  if (mode === FIT.CROP) {
    return resizeImage(cropSquare(image), { ...RESIZE_OPTS, width: px, height: px });
  }
  if (mode === FIT.CUSTOM && crop) {
    return resizeImage(cropRegion(image, crop), { ...RESIZE_OPTS, width: px, height: px });
  }
  const { width, height } = fitDims(image.width, image.height, px);
  const scaled = (width === image.width && height === image.height)
    ? image
    : await resizeImage(image, { ...RESIZE_OPTS, width, height });

  // Padding happens after scaling, on a canvas that always has an alpha channel —
  // this is the bug that made `-s` produce solid black bars on JPEG sources.
  return mode === FIT.SQUARE ? pad(scaled, px, background) : scaled;
}
