const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;

const isVideo = (file) => file.type.startsWith('video/') || VIDEO_EXT.test(file.name);

/** Run CPU-heavy image/GIF work away from the UI thread when the browser can. */
export function optimizeFile(file, options, onProgress) {
  if (isVideo(file) || typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    // Keep the 350+ KB encoder stack out of the initial page bundle. It is only
    // loaded on the main thread for video or older-browser compatibility.
    return import('./optimize.js')
      .then(({ optimize }) => optimize(file, options, onProgress));
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./optimize-worker.js', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      callback(value);
    };

    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'progress') onProgress?.(data.progress);
      else if (data.type === 'done') finish(resolve, data.result);
      else if (data.type === 'error') {
        const error = new Error(data.error.message);
        error.name = data.error.name || 'Error';
        error.stack = data.error.stack || error.stack;
        finish(reject, error);
      }
    });
    worker.addEventListener('error', (event) => {
      finish(reject, new Error(event.message || 'Optimization worker failed'));
    }, { once: true });
    worker.postMessage({ file, options });
  });
}
