// Copies the Warcraft UI art, fonts and emoji library into public/ and writes the
// emoji manifest the starfield reads.
//
// Everything it produces is committed. Deployments without the source art use
// those committed files; authoring builds refresh UI files when their source
// changes instead of silently keeping stale copies.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const run = promisify(execFile);
const here = path.dirname(new URL(import.meta.url).pathname);
const web = path.resolve(here, '..');
const repo = path.resolve(web, '..');
const source = path.join(repo, 'assets-source');
const sourceUi = path.join(source, 'ui');
const ui = path.join(web, 'public/assets/ui');
const emojiOut = path.join(web, 'public/emoji');

const exists = (p) => fs.access(p).then(() => true, () => false);
const log = (...a) => console.log('  ', ...a);

async function copyIfMissing(from, to) {
  if (await exists(to)) return false;
  if (!(await exists(from))) { log('MISSING SOURCE', from); return false; }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  log('copied', path.basename(to));
  return true;
}

async function copyIfChanged(from, to) {
  if (!(await exists(from))) return false;
  if (await exists(to)) {
    const [source, destination] = await Promise.all([fs.readFile(from), fs.readFile(to)]);
    if (source.equals(destination)) return false;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
  log('updated', path.basename(to));
  return true;
}

// --- 1. Warcraft UI art from assets-source/ ----------------------------------
const UI_FILES = [
  ['empty-slot.png', 'UI-EmptySlot.png'],
  ['empty-slot-white.png', 'UI-EmptySlot-White.png'],
  ['empty-slot-disabled.png', 'UI-EmptySlot-Disabled.png'],
  ['arrow.png', 'arrow-custom-1-d.png'],
  ['arrow-disabled.png', 'arrow-custom-1-d-disabled.png'],
  ['castbar-border.png', 'CastBar-Border.png'],
  ['castbar-flash.png', 'CastBar-Flash.png'],
  ['heretic.gif', 'Warcraft_III_-_Heretic.gif'],
  ['replika-logo.png', 'replika-logo.png'],
  ['title-logo.png', 'title-logo.png'],
];
const BAGS = ['1x4', '1x4+2', '2x4', '2x4+2', '3x4', '3x4+2', '4x4', '4x4+2', '5x4'];

console.log('assets: ui art');
for (const [from, dest] of UI_FILES) {
  await copyIfChanged(path.join(sourceUi, from), path.join(ui, dest));
}
for (const b of BAGS) {
  await copyIfChanged(path.join(sourceUi, `bags/UI-Bag-${b}.png`), path.join(ui, `bag-${b}.png`));
}

// The source slot artwork is translucent even across its painted face (most
// pixels top out around alpha 224-239). That makes stars visibly bleed through
// in Safari. Keep the silhouette transparent, but make every painted pixel
// decisively opaque. The committed outputs remain the fallback on builders
// without ffmpeg.
for (const [source, output] of [
  ['UI-EmptySlot-Disabled.png', 'UI-EmptySlot-Disabled-Opaque.png'],
  ['UI-EmptySlot-White.png', 'UI-EmptySlot-White-Opaque.png'],
  ['UI-EmptySlot.png', 'UI-EmptySlot-Opaque.png'],
]) {
  try {
    await run('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', path.join(ui, source),
      '-vf', "lut=a='if(gte(val,128),255,0)'", path.join(ui, output),
    ]);
  } catch {
    if (!(await exists(path.join(ui, output)))) {
      throw new Error(`missing opaque slot fallback: ${output}`);
    }
    log(`kept committed ${output} (no ffmpeg)`);
  }
}

// --- 2. frozen first frame of the heretic ------------------------------------
// A GIF can't be paused, so we show this still until Start is pressed. Needs
// ffmpeg, which only exists on the authoring machine — hence commit the result.
const still = path.join(ui, 'heretic-still.png');
if (!(await exists(still))) {
  try {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i',
      path.join(sourceUi, 'heretic.gif'), '-frames:v', '1', still]);
    log('extracted heretic-still.png');
  } catch { log('SKIP heretic-still.png (no ffmpeg) — commit it from a machine that has one'); }
}

// --- 3. gifski's wasm ---------------------------------------------------------
// The package doesn't export it, so serve it ourselves and hand init() the path.
console.log('assets: gifski wasm');
await fs.copyFile(
  path.join(web, 'node_modules/gifski-wasm/pkg/gifski_wasm_bg.wasm'),
  path.join(web, 'public/gifski_wasm_bg.wasm'),
).then(() => log('copied gifski_wasm_bg.wasm'), (e) => log('SKIP gifski wasm', String(e)));

// --- 3b. GIF avatars for the bag's portrait ring ------------------------------
// Same deal as the emoji: read from the authoring assets when they're present,
// then fall back to the committed public copies on lightweight deployments.
console.log('assets: avatars');
const avatarOut = path.join(web, 'public/assets/avatars');
const avatarSrc = (await exists(path.join(source, 'avatars')))
  ? path.join(source, 'avatars')
  : avatarOut;
const avatars = [];
if (await exists(avatarSrc)) {
  for (const name of (await fs.readdir(avatarSrc)).sort()) {
    if (!/\.(gif|png)$/i.test(name)) continue;
    await copyIfMissing(path.join(avatarSrc, name), path.join(avatarOut, name));
    avatars.push(`assets/avatars/${name}`);
  }
}
await fs.writeFile(path.join(web, 'public/avatars-manifest.json'), JSON.stringify(avatars, null, 0));
console.log(`   avatars: ${avatars.length}`);

// --- 4. emoji library + manifest ---------------------------------------------
// Reads from assets-source/emoji when present, otherwise from the committed
// public copies. Vercel excludes authoring assets, so the fallback must remain.
console.log('assets: emoji library');
const packs = ['team', 'matrix', 'primatheus', 'animals', 'misc'];
const manifest = [];
for (const pack of packs) {
  const fromRepo = path.join(source, 'emoji', pack);
  const fromPublic = path.join(emojiOut, pack);
  const src = (await exists(fromRepo)) ? fromRepo : fromPublic;
  if (!(await exists(src))) continue;
  for (const name of (await fs.readdir(src)).sort()) {
    if (!/\.(gif|png|jpg|jpeg)$/i.test(name)) continue;
    await copyIfMissing(path.join(src, name), path.join(emojiOut, pack, name));
    const { size } = await fs.stat(path.join(emojiOut, pack, name));
    manifest.push({ pack, name, path: `emoji/${pack}/${name}`, size,
                    animated: name.toLowerCase().endsWith('.gif') });
  }
}
if (!manifest.length) throw new Error('no emoji found in assets-source/emoji or public/emoji');
await fs.writeFile(path.join(web, 'public/emoji-manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`   manifest: ${manifest.length} emoji across ${packs.length} packs`);
