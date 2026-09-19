/** Create a 2D canvas in either the window or a dedicated worker. */
export function canvas2d(width, height, options = {}) {
  // Keep DOM-backed work (notably <video> drawImage calls) on a regular canvas.
  // OffscreenCanvas is used only where there is no document: the optimizer
  // worker. This avoids browser-specific HTMLVideoElement/OffscreenCanvas bugs.
  const canvas = typeof document === 'undefined'
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  return [canvas, canvas.getContext('2d', options)];
}

/** Encode an HTMLCanvasElement or OffscreenCanvas without blocking on API differences. */
export async function canvasBlob(canvas, type, quality) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(`Could not encode ${type}`)),
      type, quality);
  });
}
