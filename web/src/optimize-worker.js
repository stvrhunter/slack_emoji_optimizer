import { optimize } from './optimize.js';

// gifsicle-wasm-browser uses this DOM class only for a type check. Workers do
// not expose Element, so provide a harmless stand-in before the check runs.
globalThis.Element ??= class Element {};

self.addEventListener('message', async ({ data }) => {
  try {
    const result = await optimize(data.file, data.options,
      (progress) => self.postMessage({ type: 'progress', progress }));
    self.postMessage({ type: 'done', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: { name: error?.name, message: error?.message || String(error), stack: error?.stack },
    });
  }
});
