// The encoders. These are the same two programs the shell script uses, compiled
// to WebAssembly: gifski for the GIF (per-frame palettes, highest quality) and
// gifsicle for the lossless -O3 squeeze and the --lossy last resort.

import gifskiEncode, { init as gifskiInit } from 'gifski-wasm';
import gifsicle from 'gifsicle-wasm-browser';
import { parseGIF } from 'gifuct-js';
import { canvas2d, canvasBlob } from './canvas.js';

// gifski-wasm doesn't export its .wasm, so build-assets.mjs copies it into
// public/ and we point init() at it.
let gifskiReady;
const ensureGifski = () => (gifskiReady ??= gifskiInit('/gifski_wasm_bg.wasm'));

/**
 * @param {ImageData[]} frames  all the same size
 * @param {number} fps
 * @param {number} quality 1-100
 * @returns {Promise<Uint8Array>}
 */
export async function encodeGif(frames, fps, quality) {
  await ensureGifski();
  return gifskiEncode({
    frames,
    width: frames[0].width,
    height: frames[0].height,
    fps,
    quality,
    // Leave repeat unset: gifski then writes the Netscape "loop forever"
    // extension. In this WASM binding repeat: 0 means play once.
  });
}

/**
 * Runs gifsicle over a GIF. `args` is the flag string, e.g. '-O3' or '-O3 --lossy=60'.
 *
 * Note: gifsicle prints "too many colors, using local colormaps" for nearly every
 * frame. It runs inside its own Web Worker, so that goes straight to the devtools
 * console and the main thread can't filter it. It's advice, not a failure — the
 * output is fine. Ignore it.
 */
export async function runGifsicle(bytes, args) {
  const out = await gifsicle.run({
    input: [{ file: new Blob([bytes], { type: 'image/gif' }), name: 'in.gif' }],
    command: [`${args} in.gif -o /out/out.gif`],
  });
  if (!out?.length) throw new Error('gifsicle produced nothing');
  return new Uint8Array(await out[0].arrayBuffer());
}

/** ImageData -> PNG bytes. */
export async function encodePng(image) {
  return canvasEncode(image, 'image/png');
}

/** ImageData -> JPEG bytes. Only used if a PNG somehow blows the cap. */
export async function encodeJpeg(image, quality) {
  return canvasEncode(image, 'image/jpeg', quality);
}

async function canvasEncode(image, type, quality) {
  const [canvas, ctx] = canvas2d(image.width, image.height);
  ctx.putImageData(image, 0, 0);
  const blob = await canvasBlob(canvas, type, quality);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * How many frames the finished GIF actually has. gifsicle -O3 merges frames that
 * are identical to their neighbour, so the count we fed to gifski is usually too
 * high — and it's the final count that has to clear Slack's ceiling of 50.
 */
export function countGifFrames(bytes) {
  try {
    return parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      .frames.filter((f) => f.image).length;
  } catch {
    return null;
  }
}
