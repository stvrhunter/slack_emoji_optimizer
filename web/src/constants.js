// Single source of truth for Slack's limits and the quality ladder.
// Mirrors slackmoji.sh — if you change one, change the other.

/** Slack's hard file-size cap. */
export const HARD_CAP = 131072;
/** slackmoji.sh MAXBYTES — safety margin under the hard cap, for GIFs. */
export const GIF_CAP = 128000;
/** slackmoji.sh IMGMAX — static images get closer to the cap, favouring quality. */
export const PNG_CAP = 130000;
/** Slack's animated-emoji frame ceiling. */
export const MAX_FRAMES = 50;
/** Longest side, in px. */
export const TARGET_PX = 128;
/** Source fps ceiling. */
export const FPS_CAP = 30;

/** slackmoji.sh ladder, best to worst. First rung under GIF_CAP wins. */
export const LADDER = [
  [FPS_CAP, 100], [24, 100], [20, 95], [18, 90], [15, 90],
  [15, 80], [12, 75], [12, 65], [10, 60], [10, 50], [8, 45],
];

/** gifsicle --lossy ramp, used only when the bottom rung is still too big. */
export const LOSSY_RAMP = [30, 60, 90, 120, 160, 200, 260];

/** pngquant colour ladder for oversized static images. */
export const PNG_COLOURS = [256, 200, 128, 96, 64, 48, 32];

/** Fit modes; the first three match the script's default / -s / -b / -c. */
export const FIT = { FIT: 'fit', SQUARE: 'square', CROP: 'crop', CUSTOM: 'custom' };
