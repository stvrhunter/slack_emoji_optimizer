# web — the Slack emoji optimizer as a site

A single page that does what `../slackmoji.sh` does, in the browser.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
```

## How it optimizes

Nothing is uploaded anywhere. The whole pipeline runs in the visitor's browser,
using the *same two encoders* the shell script uses, compiled to WebAssembly.
Image and GIF work runs in a dedicated worker so encoding does not freeze the UI:

| step | here | in `slackmoji.sh` |
|---|---|---|
| read GIF frames | `gifuct-js` | ffmpeg |
| read video frames | `<video>` + canvas | ffmpeg |
| read animated WebP | WebCodecs `ImageDecoder` | — (ffmpeg can't) |
| scale to 128px | `@jsquash/resize`, lanczos3 | `scale=…:flags=lanczos` |
| encode GIF | **gifski** (wasm) | **gifski** |
| squeeze GIF | **gifsicle** (wasm) | **gifsicle** |

`src/constants.js` holds the quality/fps ladder and the size and frame caps. It
is a copy of the numbers in `slackmoji.sh` — change one, change the other.

### Where it differs from the script

- Video decoding is the browser's, so `.mp4`/`.mov` (H.264) work but `.mkv`,
  `.avi` and ProRes don't.
- Frames are picked by resampling the source's own timeline rather than by
  ffmpeg's `fps` filter. Results land within a frame or two of the script.
- Animated WebP works here and does **not** work in ffmpeg at all. The script
  now shells out to Pillow for it.

## Where things live

```
src/constants.js   the ladder and the caps — the shared source of truth
src/decode.js      file -> RGBA frames (gif / video / webp / still)
src/canvas.js      DOM/worker canvas compatibility helpers
src/resize.js      fit | crop | manual crop | pad
src/encode.js      gifski, gifsicle, PNG
src/optimize.js    the pipeline, walking the ladder, emitting progress
src/optimize-client.js / optimize-worker.js   off-main-thread image/GIF work
src/crop.js        manual crop editor
src/starfield.js   the background, and the emoji flying through it
src/inventory.js   the bag: IndexedDB + the ContainerFrame cell geometry
src/main.js        wiring
scripts/build-assets.mjs   copies assets-source/ art and emoji into public/
```

`scripts/build-assets.mjs` runs before every dev/build. Everything it produces is
committed. Authoring builds refresh changed UI art; a build machine without the
source art or ffmpeg safely keeps the committed copies.

The title and the Replika wordmark are both artwork (`title-logo.png`,
`replika-logo.png`), so no webfont is loaded. Buttons and the name field are the
World of Warcraft `UI-Panel-Button` look, hand-built in `src/styles/buttons.css`.

### A warning you can ignore

gifsicle prints `too many colors, using local colormaps` for almost every frame.
It runs in its own Web Worker, so the main thread can't filter it out of the
devtools console. It's advice, not a failure.

## The bag

Finished emoji go to IndexedDB, so they survive a reload — a static site has no
folder to write to. **Save all** writes the whole bag into a folder you pick
(Chrome/Edge; other browsers fall back to one download per emoji).

Bag art is chosen by count: 4 → `1x4`, 6 → `1x4+2`, 8 → `2x4` … 20 → `5x4`.
Past 20 it keeps the newest 20 on screen; the rest stay in the database.

## Deploying

`../vercel.json` builds this folder; `../.vercelignore` keeps the 1.1 GB `src/`
tree and the 116 MB `_attic/` out of the upload (≈10 MB goes up instead).
No serverless functions, so there's no request size limit and no timeout.
