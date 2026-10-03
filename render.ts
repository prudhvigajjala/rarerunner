import { FOCAL, GROUND, H, HORIZON, LANE_W, W, SURGE_TIME, type Obstacle, type Run } from "./engine";

export interface Palette {
  bg: string;
  fg: string;
  dim: string;
  ground: string;
  low: string;
  high: string;
  block: string;
  coin: string;
}

export const SIGNAL = "#CCFF00";

// Default: monochrome Rare Friends look, signal green on dark.
export const MONO: Palette = { bg: "#050805", fg: SIGNAL, dim: "#5f7300", ground: "#0a0f06", low: SIGNAL, high: SIGNAL, block: SIGNAL, coin: SIGNAL };
// Optional colour mode. A local stand-in for the SDK's GAME_PALETTE (not imported
// because its export path is not documented in API.md).
export const COLOR: Palette = { bg: "#080b14", fg: SIGNAL, dim: "#4a5a8a", ground: "#10172a", low: "#ff8a5c", high: "#5cc8ff", block: "#b78cff", coin: "#ffd84a" };

export interface Cosmetics {
  trail: boolean;
  grid: boolean;
}

export interface View {
  pal: Palette;
  cos: Cosmetics;
  sprite: HTMLCanvasElement;
  reduced: boolean;
  time: number;
  shake: number;
}

export function project(lane: number, z: number, h = 0) {
  const zz = Math.max(z, -FOCAL * 0.7);
  const s = FOCAL / (FOCAL + zz);
  return { x: W / 2 + (lane - 1) * LANE_W * s, y: HORIZON + (GROUND - HORIZON) * s - h * s, s };
}

const line = (g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
};

function skyline(g: CanvasRenderingContext2D, v: View) {
  g.strokeStyle = v.pal.dim;
  g.lineWidth = 2;
  for (let i = 0; i < 31; i++) {
    const h = 24 + ((i * 37) % 5) * 18 + ((i * 13) % 3) * 12;
    g.strokeRect(i * 32 + 3, HORIZON - h, 26, h);
  }
  g.strokeStyle = v.pal.fg;
  line(g, 0, HORIZON, W, HORIZON);
}

function track(g: CanvasRenderingContext2D, run: Run, v: View) {
  const far = 3300;
  const near = -150;
  const a = project(-0.5, far);
  const b = project(2.5, far);
  const c = project(2.5, near);
  const d = project(-0.5, near);
  g.fillStyle = v.pal.ground;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.lineTo(c.x, c.y);
  g.lineTo(d.x, d.y);
  g.closePath();
  g.fill();

  const spacing = v.cos.grid ? 140 : 280;
  g.strokeStyle = v.pal.dim;
  g.lineWidth = 1;
  for (let z = -(run.dist % spacing); z < far; z += spacing) {
    const l = project(-0.5, z);
    const r = project(2.5, z);
    line(g, l.x, l.y, r.x, r.y);
  }
  // Dashed lane dividers.
  g.lineWidth = 2;
  for (const lane of [0.5, 1.5]) {
    for (let z = -(run.dist % 280); z < far; z += 280) {
      const p = project(lane, z);
      const q = project(lane, z + 140);
      line(g, p.x, p.y, q.x, q.y);
    }
  }
  g.strokeStyle = v.pal.fg;
  g.lineWidth = 3;
  line(g, a.x, a.y, d.x, d.y);
  line(g, b.x, b.y, c.x, c.y);

  // Side pylons give a sense of speed.
  g.strokeStyle = v.pal.dim;
  g.lineWidth = 2;
  for (let z = -(run.dist % 420); z < far; z += 420) {
    for (const lane of [-0.85, 2.85]) {
      const base = project(lane, z);
      const top = project(lane, z, 170);
      line(g, base.x, base.y, top.x, top.y);
      g.strokeRect(top.x - 6 * top.s, top.y - 8 * top.s, 12 * top.s, 8 * top.s);
    }
  }
}

function drawObstacle(g: CanvasRenderingContext2D, o: Obstacle, v: View) {
  const p = project(o.lane, o.z);
  const s = p.s;
  const w = LANE_W * 0.78 * s;
  const color = v.pal[o.kind];
  g.strokeStyle = color;
  g.fillStyle = v.pal.bg;
  g.lineWidth = Math.max(1.5, 3 * s);
  if (o.kind === "low") {
    const h = 62 * s;
    g.fillRect(p.x - w / 2, p.y - h, w, h);
    g.strokeRect(p.x - w / 2, p.y - h, w, h);
    for (let i = 1; i < 4; i++) line(g, p.x - w / 2 + (w * i) / 4, p.y - h, p.x - w / 2 + (w * (i - 0.5)) / 4, p.y);
  } else if (o.kind === "high") {
    const top = 150 * s;
    const bar = 88 * s;
    line(g, p.x - w / 2, p.y, p.x - w / 2, p.y - top);
    line(g, p.x + w / 2, p.y, p.x + w / 2, p.y - top);
    g.fillRect(p.x - w / 2, p.y - top, w, top - bar);
    g.strokeRect(p.x - w / 2, p.y - top, w, top - bar);
    line(g, p.x - w / 2, p.y - top, p.x + w / 2, p.y - bar);
    line(g, p.x + w / 2, p.y - top, p.x - w / 2, p.y - bar);
  } else {
    const h = 210 * s;
    const bw = LANE_W * 0.84 * s;
    g.fillRect(p.x - bw / 2, p.y - h, bw, h);
    g.strokeRect(p.x - bw / 2, p.y - h, bw, h);
    line(g, p.x - bw / 2, p.y - h, p.x + bw / 2, p.y);
    line(g, p.x + bw / 2, p.y - h, p.x - bw / 2, p.y);
  }
}

function drawCoin(g: CanvasRenderingContext2D, lane: number, z: number, h: number, v: View) {
  const p = project(lane, z, h + 28);
  const r = Math.max(2, 16 * p.s);
  g.strokeStyle = v.pal.coin;
  g.lineWidth = Math.max(1.5, 3 * p.s);
  g.beginPath();
  g.arc(p.x, p.y, r, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = v.pal.coin;
  g.fillRect(p.x - r * 0.25, p.y - r * 0.5, r * 0.5, r);
}

function drawPlayer(g: CanvasRenderingContext2D, run: Run, v: View) {
  const p = run.player;
  const px = Math.round(W / 2 + (p.x - 1) * LANE_W);
  const sliding = p.slide > 0 && p.h <= 0;
  const sx = 5;
  const sy = sliding ? 3 : 5;
  const w = v.sprite.width * sx;
  const h = v.sprite.height * sy;
  const bottom = Math.round(GROUND - p.h);

  g.fillStyle = "rgba(0,0,0,0.6)";
  g.strokeStyle = v.pal.dim;
  g.lineWidth = 2;
  const squash = 1 - Math.min(0.5, p.h / 300);
  g.beginPath();
  g.ellipse(px, GROUND + 4, 36 * squash, 9 * squash, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();

  g.imageSmoothingEnabled = false;
  if (!v.reduced && (v.cos.trail || p.surge > 0)) {
    for (let i = 1; i <= 3; i++) {
      const q = project(p.x, i * 90, p.h);
      const scale = 5 - i;
      g.globalAlpha = 0.35 / i;
      g.drawImage(v.sprite, Math.round(q.x - (v.sprite.width * scale) / 2), Math.round(q.y - v.sprite.height * scale), v.sprite.width * scale, v.sprite.height * scale);
    }
    g.globalAlpha = 1;
  }
  g.drawImage(v.sprite, px - w / 2, bottom - h, w, h);

  if (p.surge > 0) {
    g.strokeStyle = v.pal.fg;
    g.lineWidth = 3;
    g.globalAlpha = v.reduced ? 0.9 : 0.5 + 0.4 * Math.sin(v.time * 18);
    g.beginPath();
    g.ellipse(px, bottom - h / 2, w * 0.7, h * 0.62, 0, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  } else if (p.shield) {
    g.strokeStyle = v.pal.fg;
    g.lineWidth = 2;
    g.setLineDash([8, 6]);
    g.beginPath();
    g.ellipse(px, bottom - h / 2, w * 0.62, h * 0.58, 0, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
}

export function draw(g: CanvasRenderingContext2D, run: Run, v: View) {
  g.save();
  g.fillStyle = v.pal.bg;
  g.fillRect(0, 0, W, H);
  if (!v.reduced && v.shake > 0) g.translate((Math.random() - 0.5) * v.shake * 14, (Math.random() - 0.5) * v.shake * 14);

  skyline(g, v);
  track(g, run, v);

  type Item = { z: number; paint: () => void };
  const items: Item[] = [
    ...run.obstacles.map((o): Item => ({ z: o.z, paint: () => drawObstacle(g, o, v) })),
    ...run.coins.map((c): Item => ({ z: c.z, paint: () => drawCoin(g, c.lane, c.z, c.h, v) })),
  ];
  items.sort((a, b) => b.z - a.z);
  for (const item of items) if (item.z < 3300) item.paint();

  drawPlayer(g, run, v);

  if (!v.reduced && run.flash > 0) {
    g.fillStyle = `rgba(204,255,0,${run.flash * 0.22})`;
    g.fillRect(0, 0, W, H);
  }
  g.restore();
}

export const SURGE_SECONDS = SURGE_TIME;
