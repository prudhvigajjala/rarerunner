import { createFriendReader, spriteFrame } from "@rarefriends/friendsdk/sprites";

export const SPRITE_SIZE = 16;

export interface HeroSprite {
  /** 16 x 16 one-bit mask, row-major, true = filled pixel. */
  mask: boolean[];
  /** "canonical" when read through the SDK sprite reader, otherwise "fallback". */
  source: "canonical" | "fallback";
}

const FALLBACK_ROWS = [
  "................",
  "....########....",
  "...##########...",
  "..############..",
  "..##..####..##..",
  "..##..####..##..",
  "..############..",
  "..############..",
  "...##########...",
  "....########....",
  "...##########...",
  "...###....###...",
  "...###....###...",
  "..####....####..",
  "................",
  "................",
];

const fromRows = (rows: readonly string[]) =>
  rows.flatMap((row) => Array.from(row.padEnd(SPRITE_SIZE, ".").slice(0, SPRITE_SIZE), (ch) => ch !== "." && ch !== "0" && ch !== " "));

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "#";

// Normalises the shapes a one-bit 16 x 16 frame could plausibly arrive in.
function toMask(value: unknown, depth = 0): boolean[] | null {
  if (!value || depth > 3) return null;
  if (typeof value === "string") {
    const rows = value.split(/\r?\n/).filter(Boolean);
    return rows.length === SPRITE_SIZE ? fromRows(rows) : null;
  }
  if (Array.isArray(value)) {
    if (value.length === SPRITE_SIZE * SPRITE_SIZE) return value.map(truthy);
    if (value.length === SPRITE_SIZE) {
      if (value.every((row) => typeof row === "string")) return fromRows(value as string[]);
      if (value.every((row) => Array.isArray(row) && row.length === SPRITE_SIZE)) {
        return (value as unknown[][]).flatMap((row) => row.map(truthy));
      }
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["mask", "pixels", "bits", "data", "frame"]) {
      const found = toMask(record[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Reads the selected Friend's canonical walking sprite.
 *
 * NOTE: this is the single place that depends on the exact createFriendReader /
 * spriteFrame signatures. It tries the documented entry points defensively and
 * falls back to a built-in mask (shown with a notice in the UI) rather than
 * failing the run. If the fallback appears, wire `read` below to the real API.
 */
export async function loadHeroSprite(friendId: bigint, signal?: AbortSignal): Promise<HeroSprite> {
  try {
    const reader = createFriendReader() as unknown as Record<string, unknown>;
    const read = (reader["read"] ?? reader["readSprite"] ?? reader["load"]) as
      | ((id: bigint, signal?: AbortSignal) => Promise<unknown>)
      | undefined;
    if (typeof read === "function") {
      const sprite = await read.call(reader, friendId, signal);
      const frame = spriteFrame as unknown as (...args: unknown[]) => unknown;
      const attempts: Array<() => unknown> = [
        () => frame(sprite, "down", 0),
        () => frame(sprite, { direction: "down", frame: 0 }),
        () => sprite,
      ];
      for (const attempt of attempts) {
        try {
          const mask = toMask(attempt());
          if (mask) return { mask, source: "canonical" };
        } catch {
          // try the next call shape
        }
      }
    }
  } catch {
    // fall through to the visible fallback
  }
  return { mask: fromRows(FALLBACK_ROWS), source: "fallback" };
}

/** Pre-renders mask + one-pixel halo into an 18 x 18 canvas for integer scaling. */
export function buildSpriteCanvas(mask: readonly boolean[], halo: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE + 2;
  canvas.height = SPRITE_SIZE + 2;
  const g = canvas.getContext("2d")!;
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < SPRITE_SIZE && y < SPRITE_SIZE && mask[y * SPRITE_SIZE + x] === true;
  g.fillStyle = halo;
  for (let y = -1; y <= SPRITE_SIZE; y++) {
    for (let x = -1; x <= SPRITE_SIZE; x++) {
      if (!at(x, y) && (at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1))) g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  g.fillStyle = "#000";
  for (let y = 0; y < SPRITE_SIZE; y++) for (let x = 0; x < SPRITE_SIZE; x++) if (at(x, y)) g.fillRect(x + 1, y + 1, 1, 1);
  return canvas;
}
