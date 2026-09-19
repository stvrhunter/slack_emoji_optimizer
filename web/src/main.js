import { optimizeFile } from './optimize-client.js';
import { startFlyby, startStarfield } from './starfield.js';
import { ART_X, CANVAS, addToBag, bagFor, clearBag, readBag, saveBagToFolder } from './inventory.js';
import { FIT } from './constants.js';
import { openCropEditor } from './crop.js';

const $ = (id) => document.getElementById(id);
const el = {
  inSlot: $('inSlot'), inPreview: $('inPreview'), inPreviewVideo: $('inPreviewVideo'),
  inCap: $('inCap'), file: $('file'),
  adjust: document.querySelector('[data-fit="custom"]'),
  arrowL: $('arrowL'), arrowR: $('arrowR'),
  heretic: $('hereticImg'), start: $('start'),
  castbar: $('castbar'), castFill: $('castFill'), castLabel: $('castLabel'),
  outSlot: $('outSlot'), outPreview: $('outPreview'), outStats: $('outStats'),
  name: $('emojiName'), download: $('download'),
  bag: $('bag'), bagFrame: document.querySelector('.bag-frame'),
  bagArt: $('bagArt'), bagAvatar: $('bagAvatar'), bagGrid: $('bagGrid'),
  bagRow: document.querySelector('.bag-row'),
  flyby: $('flyby'),
  saveAll: $('saveAll'), clearBag: $('clearBag'), bagCount: $('bagCount'),
  lightbox: $('lightbox'), lbImg: $('lbImg'), lbCap: $('lbCap'),
  lbDownload: $('lbDownload'), lbClose: $('lbClose'),
};

const BAG_SCALE = 0.9;

// Overscan the portrait behind the bag artwork. The PNG's transparent opening
// becomes the mask, so the GIF fills the circle without a visible edge seam.
const PORTRAIT = { x: 142, y: 14, d: 68 };

// The visible panel sits inside the art box — the portrait ring overhangs it on
// the left. Measured on the same canvas, so the row below can line up with the
// panel's edges rather than with the art box's.
const PANEL_INSET = { left: 150 - ART_X, right: 505 - 499 };

const ART = {
  empty: 'assets/ui/UI-EmptySlot-Disabled-Opaque.png',
  filled: 'assets/ui/UI-EmptySlot-White-Opaque.png',
  done: 'assets/ui/UI-EmptySlot-Opaque.png',
  arrowOff: 'assets/ui/arrow-custom-1-d-disabled.png',
  arrowOn: 'assets/ui/arrow-custom-1-d.png',
  hereticStill: 'assets/ui/heretic-still.png',
  hereticGif: 'assets/ui/Warcraft_III_-_Heretic.gif',
};

let fitMode = FIT.FIT;
let customCrop = null;  // normalized { x, y, width, height }
let source = null;      // { file, url }
let output = null;      // result from optimize()
let outputUrl = null;
let running = false;
let bagUrls = [];
let bagRenderVersion = 0;
const objectUrls = new Set();

const trackUrl = (blob) => {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
};
const releaseUrl = (url) => {
  if (!url) return;
  URL.revokeObjectURL(url);
  objectUrls.delete(url);
};
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv)$/i;
const isVideoFile = (file) => file.type.startsWith('video/') || VIDEO_EXT.test(file.name);

function clearInputPreview() {
  el.inPreview.removeAttribute('src');
  el.inPreview.hidden = false;
  el.inPreviewVideo.pause();
  el.inPreviewVideo.removeAttribute('src');
  el.inPreviewVideo.load();
  el.inPreviewVideo.hidden = true;
}

// ---------------------------------------------------------------- input slot
function acceptFile(file) {
  if (!file || running) return;
  if (!/^(image|video)\//.test(file.type) && !/\.(gif|png|jpe?g|webp|mp4|mov|webm)$/i.test(file.name)) {
    el.inCap.textContent = "that file type won't decode";
    return;
  }
  releaseUrl(source?.url);
  source = { file, url: trackUrl(file) };
  customCrop = null;
  if (fitMode === FIT.CUSTOM) setFitMode(FIT.FIT);
  el.adjust.disabled = false;

  el.inSlot.querySelector('.slot-frame').src = ART.filled;
  if (isVideoFile(file)) {
    el.inPreview.removeAttribute('src');
    el.inPreview.hidden = true;
    el.inPreviewVideo.src = source.url;
    el.inPreviewVideo.hidden = false;
    el.inPreviewVideo.play().catch(() => {});
  } else {
    el.inPreviewVideo.pause();
    el.inPreviewVideo.removeAttribute('src');
    el.inPreviewVideo.hidden = true;
    el.inPreview.src = source.url;
    el.inPreview.hidden = false;
  }
  el.inSlot.classList.add('filled');
  el.inCap.innerHTML = `${file.name}<br><small>${kb(file.size)}</small>`;

  el.arrowL.src = ART.arrowOn;
  el.arrowL.classList.add('on');
  el.start.disabled = false;

  // a fresh source clears the previous result
  clearOutput();
}

function clearOutput() {
  output = null;
  releaseUrl(outputUrl);
  outputUrl = null;
  el.outSlot.querySelector('.slot-frame').src = ART.empty;
  el.outSlot.classList.remove('filled');
  el.outPreview.removeAttribute('src');
  el.outStats.innerHTML = '&nbsp;';
  el.arrowR.src = ART.arrowOff;
  el.arrowR.classList.remove('on');
  el.name.value = '';
  el.name.disabled = true;
  el.download.disabled = true;
  if (!el.inPreviewVideo.hidden) el.inPreviewVideo.pause();
}

function openFilePicker() {
  if (running) return;
  // A file input does not emit change when the same file is chosen twice.
  // Clear it before opening so a processed GIF can immediately be re-uploaded.
  el.file.value = '';
  el.file.click();
}

el.inSlot.addEventListener('click', openFilePicker);
el.inSlot.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
});
el.file.addEventListener('change', () => acceptFile(el.file.files[0]));

for (const ev of ['dragenter', 'dragover']) {
  el.inSlot.addEventListener(ev, (e) => { e.preventDefault(); el.inSlot.classList.add('over'); });
}
for (const ev of ['dragleave', 'drop']) {
  el.inSlot.addEventListener(ev, (e) => { e.preventDefault(); el.inSlot.classList.remove('over'); });
}
el.inSlot.addEventListener('drop', (e) => acceptFile(e.dataTransfer.files[0]));
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

// ------------------------------------------------------------------- the run
el.start.addEventListener('click', async () => {
  if (!source || running) return;
  running = true;
  document.body.classList.add('running');
  el.start.disabled = true;
  fitButtons.forEach((button) => { button.disabled = true; });
  el.name.disabled = true;
  el.download.disabled = true;

  // the heretic only moves while he's working
  el.heretic.src = `${ART.hereticGif}?${Date.now()}`;
  el.castbar.hidden = false;
  setProgress(0, 'preparing');

  try {
    const processedSource = source;
    output = await optimizeFile(processedSource.file, { mode: fitMode, crop: customCrop },
      ({ percent, label }) => setProgress(percent, label));

    outputUrl = trackUrl(output.blob);
    el.outSlot.querySelector('.slot-frame').src = ART.done;
    el.outPreview.src = outputUrl;
    el.outSlot.classList.add('filled');
    el.outStats.innerHTML = output.overCap
      ? `<span style="color:#ff8a5b">${kb(output.bytes)} — OVER SLACK'S CAP</span>`
      : `${output.width}×${output.height} · ${kb(output.bytes)} · ${output.frames} frame${output.frames === 1 ? '' : 's'}`;

    el.arrowR.src = ART.arrowOn;
    el.arrowR.classList.add('on');
    el.name.value = output.name;
    el.name.disabled = false;
    el.download.disabled = false;

    // the original has served its purpose
    source = null;
    releaseUrl(processedSource.url);
    el.adjust.disabled = true;
    el.inSlot.querySelector('.slot-frame').src = ART.empty;
    el.inSlot.classList.remove('filled');
    clearInputPreview();
    el.inCap.innerHTML = 'drop or click<br><small>gif · png · jpg · webp · mp4</small>';
    el.arrowL.src = ART.arrowOff;
    el.arrowL.classList.remove('on');

    try {
      await addToBag({
        name: output.name, ext: output.ext, blob: output.blob,
        bytes: output.bytes, width: output.width, height: output.height, frames: output.frames,
      });
      await renderBag();
    } catch (bagError) {
      // A blocked/private IndexedDB must not turn a successful optimization
      // into a failure. The result remains downloadable from the output slot.
      console.warn('Could not save the result in the bag', bagError);
    }
  } catch (err) {
    console.error(err);
    setProgress(100, 'failed');
    el.outStats.innerHTML = `<span style="color:#ff8a5b">${err.message}</span>`;
  } finally {
    running = false;
    document.body.classList.remove('running');
    fitButtons.forEach((button) => {
      button.disabled = button.dataset.fit === FIT.CUSTOM && !source;
    });
    el.heretic.src = ART.hereticStill;
    if (source && !el.inPreviewVideo.hidden) el.inPreviewVideo.play().catch(() => {});
    setTimeout(() => { if (!running) el.castbar.hidden = true; }, 1200);
  }
});

function setProgress(percent, label) {
  el.castFill.style.width = `${Math.max(0, Math.min(100, percent)) * 0.75}%`;
  el.castLabel.textContent = label;
}

// -------------------------------------------------------------------- output
el.download.addEventListener('click', () => {
  if (!output) return;
  const name = (el.name.value.trim() || output.name)
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'emoji';
  const a = document.createElement('a');
  a.href = outputUrl;
  a.download = `${name}.${output.ext}`;
  a.click();
});

// ----------------------------------------------------------------------- bag
function sizeBagAvatar() {
  const k = BAG_SCALE;
  el.bagRow.style.paddingLeft = `${PANEL_INSET.left * k}px`;
  el.bagRow.style.paddingRight = `${PANEL_INSET.right * k}px`;
  Object.assign(el.bagAvatar.style, {
    left: `${(PORTRAIT.x - ART_X) * k}px`,
    top: `${PORTRAIT.y * k}px`,
    width: `${PORTRAIT.d * k}px`,
    height: `${PORTRAIT.d * k}px`,
  });
}

/** Drops a random Warcraft avatar GIF into the bag's portrait ring. */
async function placeAvatar() {
  sizeBagAvatar();

  try {
    const list = await fetch('avatars-manifest.json').then((r) => r.json());
    if (!list.length) return;
    el.bagAvatar.src = list[(Math.random() * list.length) | 0];
  } catch { /* no avatars published — the ring just stays empty */ }
}

async function renderBag() {
  const version = ++bagRenderVersion;
  const items = await readBag();
  if (version !== bagRenderVersion) return;

  bagUrls.forEach(releaseUrl);
  bagUrls = [];

  // the bag stays on screen even with nothing in it — empty cells and all
  const layout = bagFor(items.length);
  el.bagArt.src = `assets/ui/bag-${layout.key}.png`;
  el.bagCount.textContent = items.length > layout.capacity
    ? `newest ${layout.capacity} of ${items.length}`
    : `${items.length} emoji`;
  el.saveAll.disabled = items.length === 0;
  el.clearBag.disabled = items.length === 0;

  // Draw the art at BAG_SCALE and crop the transparent margin away, so the
  // cell lattice above lines up 1:1 with what's on screen.
  const k = BAG_SCALE;
  // the art sets the bag's width, so the count and buttons below line up with
  // its edges instead of spilling out to the right
  el.bag.style.width = `${layout.artW * k}px`;
  el.bagFrame.style.width = `${layout.artW * k}px`;
  el.bagFrame.style.height = `${layout.artH * k}px`;
  el.bagArt.style.width = `${CANVAS * k}px`;
  el.bagArt.style.marginLeft = `${-ART_X * k}px`;
  el.bagGrid.innerHTML = '';

  const shown = items.slice(-layout.capacity);
  layout.cells.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'cell';
    div.style.left = `${c.x * k}px`;
    div.style.top = `${c.y * k}px`;
    div.style.width = `${layout.cellW * k}px`;
    div.style.height = `${layout.cellH * k}px`;
    el.bagGrid.appendChild(div);

    const item = shown[i];
    if (!item) return;            // an empty cell is just the frame art
    div.classList.add('full');
    div.title = `${item.name}.${item.ext} — ${kb(item.bytes)}`;

    const img = document.createElement('img');
    img.src = trackUrl(item.blob);
    bagUrls.push(img.src);
    img.alt = item.name;
    const media = document.createElement('div');
    media.className = 'cell-media';
    media.appendChild(img);
    div.appendChild(media);
    div.addEventListener('click', () => openLightbox({
      src: img.src, name: `${item.name}.${item.ext}`,
      meta: `${item.width}×${item.height} · ${kb(item.bytes)} · ${item.frames} frame${item.frames === 1 ? '' : 's'}`,
      blob: item.blob, filename: `${item.name}.${item.ext}`,
    }));
  });
}

el.clearBag.addEventListener('click', async () => {
  if (!confirm('Empty the bag? The emoji you already downloaded are unaffected.')) return;
  await clearBag();
  await renderBag();
});

el.saveAll.addEventListener('click', async () => {
  const items = await readBag();
  try {
    const n = await saveBagToFolder(items);
    el.saveAll.textContent = `saved ${n}`;
    setTimeout(() => (el.saveAll.textContent = 'Save all'), 1800);
  } catch (e) {
    if (e.name === 'AbortError') return;
    // Safari and Firefox have no directory picker; fall back to one download each
    for (const it of items) {
      downloadBlob(it.blob, `${it.name}.${it.ext}`);
      await new Promise((r) => setTimeout(r, 120));
    }
  }
});

// ---------------------------------------------------------------- lightbox
function openLightbox({ src, name, meta, blob, filename }) {
  el.lbImg.src = src;
  el.lbCap.textContent = meta ? `${name} — ${meta}` : name;
  el.lbDownload.onclick = () => {
    if (blob) downloadBlob(blob, filename || name);
    else {
      const link = document.createElement('a');
      link.href = src;
      link.download = filename || name;
      link.click();
    }
  };
  el.lightbox.hidden = false;
}
const closeLightbox = () => { el.lightbox.hidden = true; };
el.lbClose.addEventListener('click', closeLightbox);
el.lightbox.addEventListener('click', (e) => { if (e.target === el.lightbox) closeLightbox(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// ------------------------------------------------------------------ fit mode
// The slot carries the mode so CSS can reframe the preview as it changes —
// see .slot-well img in app.css. It previews the framing only; the real
// lanczos pass, the quality ladder and the frame count come from Start.
const fitButtons = [...document.querySelectorAll('.fitpick button')];

function updateInputPreview() {
  for (const preview of [el.inPreview, el.inPreviewVideo]) {
    for (const property of ['width', 'height', 'left', 'top']) {
      preview.style.removeProperty(property);
    }
  }
  if (fitMode !== FIT.CUSTOM || !customCrop) return;

  const style = (el.inPreviewVideo.hidden ? el.inPreview : el.inPreviewVideo).style;
  style.width = `${100 / customCrop.width}%`;
  style.height = `${100 / customCrop.height}%`;
  style.left = `${(-customCrop.x / customCrop.width) * 100}%`;
  style.top = `${(-customCrop.y / customCrop.height) * 100}%`;
}

function setFitMode(mode) {
  fitMode = mode;
  el.inSlot.dataset.fit = fitMode;
  fitButtons.forEach((button) => button.classList.toggle('on', button.dataset.fit === mode));
  updateInputPreview();
}

fitButtons.forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.fit !== FIT.CUSTOM) {
    setFitMode(button.dataset.fit);
    return;
  }
  if (!source) return;

  openCropEditor({
    url: source.url,
    isVideo: isVideoFile(source.file),
    initial: customCrop,
    applyCrop(crop) {
      customCrop = crop;
      setFitMode(FIT.CUSTOM);
    },
  });
}));
setFitMode(fitMode);

addEventListener('beforeunload', () => objectUrls.forEach(URL.revokeObjectURL));

// ------------------------------------------------------------------- startup
startStarfield($('stars'));
placeAvatar();
renderBag().catch((error) => console.warn('Could not open the emoji bag', error));

// The emoji library drifting past in the background; clicking one opens it.
fetch('emoji-manifest.json')
  .then((r) => r.json())
  .then((manifest) => startFlyby(el.flyby, manifest, (e) => openLightbox({
    src: e.path, name: e.name, meta: kb(e.size), filename: e.name,
  })))
  .catch(() => { /* no manifest — the starfield runs without emoji */ });
