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

// --- 1. Warcraft UI art from the repo root -----------------------------------
const UI_FILES = [
  'UI-EmptySlot.png', 'UI-EmptySlot-White.png', 'UI-EmptySlot-Disabled.png',
  'arrow-custom-1-d.png', 'arrow-custom-1-d-disabled.png',
  'CastBar-Border.png', 'CastBar-Flash.png',
  'Warcraft_III_-_Heretic.gif', 'replika-9-19-2026 (1).png',
  'Slack-Emoji-Optimizer-9-19-2026-2.png',
];
const BAGS = ['1x4', '1x4+2', '2x4', '2x4+2', '3x4', '3x4+2', '4x4', '4x4+2', '5x4'];

console.log('assets: ui art');
for (const f of UI_FILES) {
  const dest = f.startsWith('replika') ? 'replika-logo.png'
    : f.startsWith('Slack-Emoji') ? 'title-logo.png'
    : f;
  await copyIfChanged(path.join(repo, f), path.join(ui, dest));
}
for (const b of BAGS) {
  await copyIfChanged(path.join(repo, `ContainerFrame/UI-Bag-${b}.png`), path.join(ui, `bag-${b}.png`));
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
      path.join(repo, 'Warcraft_III_-_Heretic.gif'), '-frames:v', '1', still]);
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
// Same deal as the emoji: read from the repo when it's there, fall back to what
// has already been copied, so a deployment without ../"GIF avatars" still works.
console.log('assets: avatars');
const avatarOut = path.join(web, 'public/assets/avatars');
const avatarSrc = (await exists(path.join(repo, 'GIF avatars')))
  ? path.join(repo, 'GIF avatars')
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
// Reads from ../emoji when it's there, and from the already-copied public/emoji
// when it isn't — .vercelignore keeps the 1.1 GB src/ tree out of deployments,
// and the manifest must survive that.
console.log('assets: emoji library');
const packs = ['team', 'matrix', 'primatheus', 'animals', 'misc'];
const manifest = [];
for (const pack of packs) {
  const fromRepo = path.join(repo, 'emoji', pack);
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
if (!manifest.length) throw new Error('no emoji found in ../emoji or public/emoji');
await fs.writeFile(path.join(web, 'public/emoji-manifest.json'), JSON.stringify(manifest, null, 0));
console.log(`   manifest: ${manifest.length} emoji across ${packs.length} packs`);
