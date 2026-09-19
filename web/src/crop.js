const $ = (id) => document.getElementById(id);

const dialog = $('cropEditor');
const stage = $('cropStage');
const image = $('cropImage');
const video = $('cropVideo');
const selection = $('cropSelection');
const apply = $('cropApply');
const cancel = $('cropCancel');

let media = image;
let rect = null;
let drag = null;
let onApply = null;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function bounds() {
  return { width: media.clientWidth, height: media.clientHeight };
}

function draw() {
  if (!rect) return;
  selection.style.setProperty('--third', `${rect.size / 3}px`);
  Object.assign(selection.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.size}px`,
    height: `${rect.size}px`,
  });
}

function point(event) {
  const box = stage.getBoundingClientRect();
  const { width, height } = bounds();
  return {
    x: clamp(event.clientX - box.left, 0, width),
    y: clamp(event.clientY - box.top, 0, height),
  };
}

function initialize(initial) {
  const { width, height } = bounds();
  if (!width || !height) return;

  if (initial) {
    rect = {
      left: initial.x * width,
      top: initial.y * height,
      size: Math.min(initial.width * width, initial.height * height),
    };
  } else {
    const size = Math.min(width, height);
    rect = { left: (width - size) / 2, top: (height - size) / 2, size };
  }

  rect.size = clamp(rect.size, 36, Math.min(width, height));
  rect.left = clamp(rect.left, 0, width - rect.size);
  rect.top = clamp(rect.top, 0, height - rect.size);
  selection.hidden = false;
  draw();
}

function ready(initial) {
  requestAnimationFrame(() => initialize(initial));
}

export function openCropEditor({ url, isVideo = false, initial = null, applyCrop }) {
  onApply = applyCrop;
  dialog.hidden = false;
  selection.hidden = true;

  image.hidden = isVideo;
  video.hidden = !isVideo;
  media = isVideo ? video : image;

  if (isVideo) {
    video.src = url;
    video.currentTime = 0;
    if (video.readyState >= 1) ready(initial);
    else video.addEventListener('loadedmetadata', () => ready(initial), { once: true });
    video.play().catch(() => {});
  } else {
    image.src = url;
    if (image.complete && image.naturalWidth) ready(initial);
    else image.addEventListener('load', () => ready(initial), { once: true });
  }

  cancel.focus();
}

export function closeCropEditor() {
  dialog.hidden = true;
  drag = null;
  video.pause();
}

selection.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selection.setPointerCapture(event.pointerId);
  drag = {
    mode: event.target.dataset.handle ? 'resize' : 'move',
    handle: event.target.dataset.handle,
    start: point(event),
    rect: { ...rect },
  };
});

stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.crop-selection')) return;
  event.preventDefault();
  stage.setPointerCapture(event.pointerId);
  const start = point(event);
  drag = { mode: 'draw', start };
  rect = { left: start.x, top: start.y, size: 1 };
  draw();
});

addEventListener('pointermove', (event) => {
  if (!drag || dialog.hidden) return;
  const p = point(event);
  const { width, height } = bounds();
  const minSize = Math.min(36, width, height);

  if (drag.mode === 'move') {
    rect.left = clamp(drag.rect.left + p.x - drag.start.x, 0, width - rect.size);
    rect.top = clamp(drag.rect.top + p.y - drag.start.y, 0, height - rect.size);
  } else if (drag.mode === 'draw') {
    const sx = p.x >= drag.start.x ? 1 : -1;
    const sy = p.y >= drag.start.y ? 1 : -1;
    const maxSize = Math.min(
      sx > 0 ? width - drag.start.x : drag.start.x,
      sy > 0 ? height - drag.start.y : drag.start.y,
    );
    const size = clamp(Math.max(Math.abs(p.x - drag.start.x), Math.abs(p.y - drag.start.y)),
      Math.min(minSize, maxSize), maxSize);
    rect = {
      left: sx > 0 ? drag.start.x : drag.start.x - size,
      top: sy > 0 ? drag.start.y : drag.start.y - size,
      size,
    };
  } else {
    const handle = drag.handle;
    const dx = handle.includes('e') ? p.x - drag.start.x : drag.start.x - p.x;
    const dy = handle.includes('s') ? p.y - drag.start.y : drag.start.y - p.y;
    const wanted = drag.rect.size + (dx + dy) / 2;
    let maxSize;

    if (handle === 'se') {
      maxSize = Math.min(width - drag.rect.left, height - drag.rect.top);
      rect = { left: drag.rect.left, top: drag.rect.top, size: clamp(wanted, minSize, maxSize) };
    } else if (handle === 'sw') {
      const right = drag.rect.left + drag.rect.size;
      maxSize = Math.min(right, height - drag.rect.top);
      const size = clamp(wanted, minSize, maxSize);
      rect = { left: right - size, top: drag.rect.top, size };
    } else if (handle === 'ne') {
      const bottom = drag.rect.top + drag.rect.size;
      maxSize = Math.min(width - drag.rect.left, bottom);
      const size = clamp(wanted, minSize, maxSize);
      rect = { left: drag.rect.left, top: bottom - size, size };
    } else {
      const right = drag.rect.left + drag.rect.size;
      const bottom = drag.rect.top + drag.rect.size;
      maxSize = Math.min(right, bottom);
      const size = clamp(wanted, minSize, maxSize);
      rect = { left: right - size, top: bottom - size, size };
    }
  }
  draw();
}, { passive: true });

addEventListener('pointerup', () => { drag = null; });

let resizeFrame = 0;
addEventListener('resize', () => {
  if (dialog.hidden || !rect) return;
  const old = bounds();
  if (!old.width || !old.height) return;
  const normalized = {
    x: rect.left / old.width,
    y: rect.top / old.height,
    width: rect.size / old.width,
    height: rect.size / old.height,
  };
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => initialize(normalized));
});

apply.addEventListener('click', () => {
  if (!rect) return;
  const { width, height } = bounds();
  onApply?.({
    x: rect.left / width,
    y: rect.top / height,
    width: rect.size / width,
    height: rect.size / height,
  });
  closeCropEditor();
});

cancel.addEventListener('click', closeCropEditor);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeCropEditor();
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dialog.hidden) closeCropEditor();
});
