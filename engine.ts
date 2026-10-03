// Rare Runner engine: pure, renderer-free game logic.
// Everything here is presentation/prototype logic. Randomness is browser
// randomness for spawn layout only; it never decides any RF outcome.

export const W = 960;
export const H = 640;
export const HORIZON = 200;
export const GROUND = 540;
export const FOCAL = 420;
export const LANE_W = 240;
export const SPAWN_Z = 2800;

export const GRAVITY = 2600;
export const JUMP_V = 860;
export const SLIDE_TIME = 0.62;
export const SURGE_TIME = 2.5;
export const SURGE_COOLDOWN = 18;

export type ObstacleKind = "low" | "high" | "block";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: number;
  z: number;
  hit: boolean;
}

export interface Coin {
  id: number;
  lane: number;
  z: number;
  h: number;
  taken: boolean;
}

export interface Player {
  lane: number;
  x: number;
  h: number;
  vy: number;
  slide: number;
  surge: number;
  cooldown: number;
  shield: boolean;
}

export interface Perk {
  magnet: boolean;
  floaty: number;
  shell: boolean;
  ramp: number;
  scoreMul: number;
}

export interface Family {
  name: string;
  passive: string;
  passiveText: string;
  ability: string;
  perk: Perk;
}

const BASE: Perk = { magnet: false, floaty: 1, shell: false, ramp: 1, scoreMul: 1 };

// Game-defined traits. These are derived from the Friend ID for this game only;
// they are NOT canonical Rare Friends family data.
export const FAMILIES: readonly Family[] = [
  { name: "Volt", passive: "Magnet", passiveText: "Collects coins from neighbouring lanes.", ability: "Arc Surge", perk: { ...BASE, magnet: true } },
  { name: "Gale", passive: "Featherfoot", passiveText: "Higher, floatier jumps.", ability: "Gale Dash", perk: { ...BASE, floaty: 1.3 } },
  { name: "Shell", passive: "Carapace", passiveText: "Absorbs the first hit of every run.", ability: "Shell Burst", perk: { ...BASE, shell: true } },
  { name: "Wake", passive: "Slipstream", passiveText: "Speed ramps up 25% more slowly.", ability: "Wake Rush", perk: { ...BASE, ramp: 0.75 } },
  { name: "Redline", passive: "Overclock", passiveText: "Distance score counts 15% more.", ability: "Redline", perk: { ...BASE, scoreMul: 1.15 } },
];

export function familyFor(friendId: bigint): Family {
  const index = Number(friendId % BigInt(FAMILIES.length));
  return FAMILIES[index] ?? FAMILIES[0]!;
}

export interface Run {
  t: number;
  dist: number;
  speed: number;
  player: Player;
  obstacles: Obstacle[];
  coins: Coin[];
  untilSpawn: number;
  nextId: number;
  collected: number;
  alive: boolean;
  flash: number;
}

export function createRun(perk: Perk): Run {
  return {
    t: 0,
    dist: 0,
    speed: 620,
    player: { lane: 1, x: 1, h: 0, vy: 0, slide: 0, surge: 0, cooldown: 0, shield: perk.shell },
    obstacles: [],
    coins: [],
    untilSpawn: 0,
    nextId: 1,
    collected: 0,
    alive: true,
    flash: 0,
  };
}

export const score = (run: Run, perk: Perk) => Math.floor((run.dist / 100) * perk.scoreMul);

export function moveLane(run: Run, dir: -1 | 1) {
  run.player.lane = Math.max(0, Math.min(2, run.player.lane + dir));
}

export function jump(run: Run): boolean {
  const p = run.player;
  if (p.h > 0.5) return false;
  p.vy = JUMP_V;
  p.slide = 0;
  return true;
}

export function slide(run: Run): boolean {
  const p = run.player;
  if (p.h > 0.5) {
    p.vy = Math.min(p.vy, -1500); // fast fall
    return false;
  }
  p.slide = SLIDE_TIME;
  return true;
}

export function surge(run: Run): boolean {
  const p = run.player;
  if (p.cooldown > 0 || p.surge > 0) return false;
  p.surge = SURGE_TIME;
  p.cooldown = SURGE_COOLDOWN;
  return true;
}

export interface StepResult {
  collected: number;
  hit: boolean;
  shieldBroke: boolean;
  smashed: boolean;
}

export function step(run: Run, dt: number, perk: Perk): StepResult {
  const result: StepResult = { collected: 0, hit: false, shieldBroke: false, smashed: false };
  const p = run.player;

  run.t += dt;
  run.speed = Math.min(1400, 620 + run.t * 7.5 * perk.ramp);
  const move = run.speed * (p.surge > 0 ? 1.35 : 1) * dt;
  run.dist += move;

  p.x += (p.lane - p.x) * Math.min(1, dt * 14);
  if (p.h > 0 || p.vy > 0) {
    p.vy -= (GRAVITY / perk.floaty) * dt;
    p.h += p.vy * dt;
    if (p.h <= 0) {
      p.h = 0;
      p.vy = 0;
    }
  }
  p.slide = Math.max(0, p.slide - dt);
  p.surge = Math.max(0, p.surge - dt);
  p.cooldown = Math.max(0, p.cooldown - dt);
  run.flash = Math.max(0, run.flash - dt * 2.5);

  for (const o of run.obstacles) o.z -= move;
  for (const c of run.coins) c.z -= move;

  for (const o of run.obstacles) {
    if (o.hit || o.z > 45 || o.z < -45) continue;
    if (Math.abs(p.x - o.lane) >= 0.55) continue;
    const collides = o.kind === "low" ? p.h < 55 : o.kind === "high" ? p.slide <= 0 : true;
    if (!collides) continue;
    o.hit = true;
    if (p.surge > 0) {
      result.smashed = true;
    } else if (p.shield) {
      p.shield = false;
      result.shieldBroke = true;
      run.flash = 1;
    } else {
      run.alive = false;
      result.hit = true;
      run.flash = 1;
      break;
    }
  }

  for (const c of run.coins) {
    if (c.taken || c.z > 55 || c.z < -55) continue;
    const reach = perk.magnet ? 1.15 : 0.55;
    if (Math.abs(p.x - c.lane) < reach && Math.abs(c.h - p.h) < 75) {
      c.taken = true;
      run.collected += 1;
      result.collected += 1;
    }
  }

  run.obstacles = run.obstacles.filter((o) => o.z > -140);
  run.coins = run.coins.filter((c) => !c.taken && c.z > -140);

  run.untilSpawn -= move;
  while (run.untilSpawn <= 0) {
    const gap = Math.max(720, 1100 - run.t * 4);
    spawn(run, SPAWN_Z - run.untilSpawn, gap);
    run.untilSpawn += gap;
  }
  return result;
}

const addObstacle = (run: Run, kind: ObstacleKind, lane: number, z: number) =>
  run.obstacles.push({ id: run.nextId++, kind, lane, z, hit: false });

const addCoin = (run: Run, lane: number, z: number, h = 0) =>
  run.coins.push({ id: run.nextId++, lane, z, h, taken: false });

function coinLine(run: Run, lane: number, z: number, n = 5, gap = 90) {
  for (let i = 0; i < n; i++) addCoin(run, lane, z + i * gap);
}

function coinArc(run: Run, lane: number, z: number, n = 7) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    addCoin(run, lane, z + (i - (n - 1) / 2) * 80, Math.sin(Math.PI * t) * 100);
  }
}

const pick = (n: number) => Math.floor(Math.random() * n);

function shuffled(): number[] {
  const lanes = [0, 1, 2];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [lanes[i], lanes[j]] = [lanes[j]!, lanes[i]!];
  }
  return lanes;
}

// Every pattern leaves a clear way through: jump the low walls, slide under the
// high bars, or take the open lane.
function spawn(run: Run, z: number, gap: number) {
  const roll = Math.random();
  const free = pick(3);
  if (roll < 0.25) {
    for (let l = 0; l < 3; l++) addObstacle(run, "low", l, z);
    coinArc(run, free, z);
  } else if (roll < 0.45) {
    for (let l = 0; l < 3; l++) addObstacle(run, "high", l, z);
    coinLine(run, free, z - 160, 5);
  } else if (roll < 0.7) {
    for (let l = 0; l < 3; l++) if (l !== free) addObstacle(run, "block", l, z);
    coinLine(run, free, z - 200, 6);
  } else if (roll < 0.9) {
    const [a, b, c] = shuffled() as [number, number, number];
    addObstacle(run, "block", a, z);
    addObstacle(run, "low", b, z);
    addObstacle(run, "high", c, z);
    coinArc(run, b, z);
  } else {
    const [a, b] = shuffled() as [number, number, number];
    coinLine(run, a, z, 6);
    coinLine(run, b, z + 120, 6);
  }
  if (Math.random() < 0.5) coinLine(run, pick(3), z + gap * 0.55, 4);
}
