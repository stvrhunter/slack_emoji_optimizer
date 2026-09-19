# Slack Emoji Optimizer

Tooling + asset library for our Slack custom emoji.
`slackmoji.sh` turns heavy originals into files that fit Slack's hard limits:
**128×128, under 128 KB, max 50 frames, PNG/JPG/GIF only.**

There are two front ends over the same pipeline: the shell script, and `web/`,
a page that runs the same encoders (gifski, gifsicle) compiled to WebAssembly,
entirely in the browser.

## Layout

```
slackmoji.sh          the optimizer (see Usage)
web/                  the same thing as a web page — see web/README.md
assets-source/        organized UI, avatar, and Slack-ready emoji sources
src/                  heavy originals (1.1 GB) - never upload these
_attic/               duplicates + superseded passes, kept for reference
```

`assets-source/ui/` contains the Warcraft UI parts the web page is built from —
slots, arrows, castbar, the heretic, inventory frames, and the two logos.
`web/scripts/build-assets.mjs` copies them into `web/public/assets/ui/`.

`assets-source/emoji/` and `src/` share the same five packs, so an emoji's
original is always at the matching path:

| pack | what's in it | emoji | src |
|---|---|---|---|
| `team` | coworker reactions, PRD nags, deploy | 24 | 23 |
| `matrix` | The Matrix cuts | 19 | 22 |
| `primatheus` | suited-monkey pack | 18 | 26 |
| `animals` | cats, dog, hamster-vs-PC | 11 | 14 |
| `misc` | internet memes of strangers | 5 | 8 |

## Usage

```bash
./slackmoji.sh src/team/work.gif -o assets-source/emoji/team
```

Useful flags: `-s` pad to square (transparent), `-b COLOR` pad with a background,
`-c` centre-crop to square, `-p SIZE` target longest side, `-f FPS` cap source fps.
`-h` for the rest. Requires `ffmpeg gifski gifsicle pngquant` (`brew install`).
Animated `.webp` also needs `python3` with Pillow — ffmpeg cannot decode it.

Or open the web version:

```bash
npm install --prefix web && npm run dev --prefix web
```

Square crops read better in Slack's grid than letterboxed fits —
`assets-source/emoji/matrix` is a curated square-cropped pass, which is why its
names are shorter and more descriptive than the source filenames next to them.

## Recovered names

`gifs/optimized/` held 17 outputs named `Comp 1_3.gif`, `Frame 7.png`,
`untitled_ChatGPT Images…png`. Each was matched back to its named original by
perceptual signature (3 frames, 16×16 greyscale, mean-subtracted) and, for three
of them, confirmed by an md5 chain through the duplicate `luke/` pack:

| was | now |
|---|---|
| `Comp 1.gif` | `work.gif` |
| `Comp 1_1.gif` | `nice.gif` |
| `Comp 1_2.gif` | `umm-no.gif` |
| `Comp 1_3.gif` | `demiurge.gif` |
| `Comp 2.gif` | `no-problem-boyss.gif` |
| `Comp 2_1.gif` | `luke-approves.gif` |
| `Comp 2_2.gif` | `just-deployed.gif` |
| `Comp 3.gif` | `we-will-figure-it-out.gif` |
| `Comp 3_1.gif` | `scorched-budget.gif` |
| `Comp 3_2.gif` | `good-question.gif` |
| `Comp 4.gif` | `cash-burned.gif` |
| `Comp 4_1.gif` | `poof-im-gone.gif` |
| `Frame 1.png` | `stan-on-it.png` |
| `Frame 2.png` | `fixing.png` |
| `Frame 7.png` | `umm-what.png` |
| `untitled_…21-43-02.png` | `ave-av.png` |
| `untitled_…21-43-11.png` | `tough-nut.png` |

`Comp 3_1` and `Comp 4` are the same footage with different captions —
**SCORCHED BUDGET** and **CASH BURNED** — so they are two separate emoji.
Matrix sources named `giphy-5…11` and bare md5 hashes were renamed from their
content (`neo-woah`, `smith-laugh`, `bullet-stop`, `merovingian`, …), and the
three unnamed `Comp` files in the monkey pack became `monkey-side-eye`,
`monkey-pulls-gun`, `monkey-aims-gun`.

## Audit, Sept 2026

Every one of the 84 files in `assets-source/emoji/` was re-checked against
Slack's limits and all of them pass — largest 128,361 bytes, largest frame count
exactly 50, nothing over 128×128. No re-runs were needed.

Four bugs in `slackmoji.sh` were found and fixed:

- **`-s` produced solid black bars, not transparency.** ffmpeg drops the alpha
  channel on sources that don't have one, so `pad=…:black@0` came out opaque on
  every `.jpg` and `.mp4`. Now `format=rgba` runs before the pad.
- **Animated `.webp` crashed the script** with `line 96: N: unbound variable` —
  ffprobe answers `N/A`, and `-gt` then tried to expand `N` under `set -u`.
  Detection now reads the container's `ANIM` chunk, and because ffmpeg 8 still
  cannot decode animated WebP at all, the frames are dumped with Pillow first.
- **The pngquant ladder re-quantized its own output** each rung, stacking up
  dithering noise. It now always starts from the pristine PNG. In practice this
  never fired: a 128×128 RGBA PNG tops out near 66 KB even for pure noise, so
  the 130 KB ladder is unreachable unless you raise `-p` past about 180.
- **A failed file killed the whole run.** Bad inputs are now skipped with a
  message, and there's a hard `-frames:v 50` backstop for sources whose duration
  ffprobe can't read.

The 50-frame ceiling logic was checked at boundary durations (5.00 s, 5.08 s,
5.40 s) and does not overshoot.

## Known gaps

`assets-source/emoji/team/scorched-budget.gif` has **no original** — only the
128px version survived. Don't lose it.

These sources have no optimized output yet. The animated `.webp` among them used
to crash the script and now works:

```bash
./slackmoji.sh src/animals/{chef-cat-alt.jpg,cursed-blurry-cat.jpg,ginger-cat.jpg} \
  src/animals/{chipi-chipi-chapa-chapa-cat.webp,thousand-yard-stare-cat-restoration.webp} \
  -o assets-source/emoji/animals
./slackmoji.sh src/misc/{crying-man.jpg,facepalm-monkey.jpg,man-profile.jpg,smiling-bald-man.jpg} \
  -o assets-source/emoji/misc
```

## _attic

Nothing was deleted in the reorganization. `_attic/move-manifest.json` records all
201 moves, so any rename here can be traced or reversed.

- `luke-duplicate-pack/` — byte-identical copies of `cash-burned`, `luke-approves`,
  `umm-no` under meaningless names. 114 MB; safe to delete.
- `matrix-fit-pass/` — earlier letterboxed pass, superseded by the square crops in
  `emoji/matrix/`. Renamed to the recovered names.
- `superseded-variants/` — older/lower-quality encodes of `happiness`,
  `ceo-to-the-moon`, `chef-cat`.
