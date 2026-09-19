// The bag. Finished emoji live in IndexedDB, so they survive a reload — a
// deployed site has no folder to write to. "Save all" writes the whole bag to a
// real folder via the File System Access API, for dropping into emoji/.

import { openDB } from 'idb';

const DB = 'slackmoji', STORE = 'bag';

/* Bag geometry, measured off the nine ContainerFrame PNGs.
 *
 * Every bag is drawn on a 512px-wide canvas with the frame art at x 127-505,
 * so the art box is 378 wide. Inside it the cells form an exact lattice:
 * 4 columns of 84px starting at x 24, rows of 82px, and the last row always
 * ends 17px above the bottom of the art. The "+2" bags are the same thing with
 * a two-cell half-row sitting 82px above the first full row.
 */
export const ART_X = 127, ART_W = 378, CANVAS = 512;
const COL_X = 24, COL_W = 84, ROW_H = 82, BOTTOM_PAD = 17;

const TIERS = [
  [4, '1x4', 1, false], [6, '1x4+2', 1, true],
  [8, '2x4', 2, false], [10, '2x4+2', 2, true],
  [12, '3x4', 3, false], [14, '3x4+2', 3, true],
  [16, '4x4', 4, false], [18, '4x4+2', 4, true],
  [20, '5x4', 5, false],
];

/** Which bag art holds `n` emoji, and exactly where its cells sit. */
export function bagFor(n) {
  const [capacity, key, rows, plusTwo] = TIERS.find(([cap]) => n <= cap) ?? TIERS.at(-1);
  const artH = 189 + ROW_H * (rows - 1) + (plusTwo ? 40 : 0);
  const firstRowY = artH - BOTTOM_PAD - ROW_H * rows;

  const cells = [];
  // the half-row's two cells are right-aligned, above the grid
  if (plusTwo) {
    for (let i = 2; i < 4; i++) cells.push({ x: COL_X + COL_W * i, y: firstRowY - ROW_H });
  }
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < 4; i++) cells.push({ x: COL_X + COL_W * i, y: firstRowY + ROW_H * r });
  }
  return { key, capacity, artH, artW: ART_W, cellW: COL_W, cellH: ROW_H, cells };
}

const db = () => openDB(DB, 1, {
  upgrade(d) { d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); },
});

export async function addToBag(entry) {
  return (await db()).add(STORE, { ...entry, added: Date.now() });
}
export async function readBag() {
  return (await db()).getAll(STORE);
}
export async function clearBag() {
  return (await db()).clear(STORE);
}

/** Writes every emoji in the bag into a folder the user picks. Chrome/Edge only. */
export async function saveBagToFolder(items) {
  if (!window.showDirectoryPicker) throw new Error('unsupported');
  const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
  for (const it of items) {
    const handle = await dir.getFileHandle(`${it.name}.${it.ext}`, { create: true });
    const w = await handle.createWritable();
    await w.write(it.blob);
    await w.close();
  }
  return items.length;
}
