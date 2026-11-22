import { DIRS, RADIUS, SECTORS } from './data';
import { chance, int, next, pick, type RngState } from './rng';
import type { Dir, GameState, HordeType, Pos, Sector, Tile, TileKind } from './types';

export const key = (p: Pos) => `${p.x},${p.y}`;

/** Chebyshev distance from the colony (or between two positions). */
export function dist(a: Pos, b: Pos = { x: 0, y: 0 }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Screen coordinates: +x is east, +y is south. */
export function sectorOf(p: Pos, from: Pos = { x: 0, y: 0 }): Sector {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  if (dx === 0 && dy === 0) return 'N';
  const a = Math.atan2(-dy, dx);
  const idx = (Math.round(a / (Math.PI / 4)) + 8) % 8;
  return SECTORS[idx]!;
}

/** The wall direction an approach from this sector hits. */
export function dirOfSector(s: Sector): Dir {
  switch (s) {
    case 'N':
    case 'NW':
      return 'N';
    case 'E':
    case 'NE':
      return 'E';
    case 'S':
    case 'SE':
      return 'S';
    case 'W':
    case 'SW':
      return 'W';
  }
}

export function allPositions(): Pos[] {
  const out: Pos[] = [];
  for (let y = -RADIUS; y <= RADIUS; y++)
    for (let x = -RADIUS; x <= RADIUS; x++) if (x !== 0 || y !== 0) out.push({ x, y });
  return out;
}

export function neighbours(p: Pos): Pos[] {
  const out: Pos[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const q = { x: p.x + dx, y: p.y + dy };
      if (dist(q) <= RADIUS && dist(q) > 0) out.push(q);
    }
  return out;
}

function randomHorde(r: RngState): HordeType {
  const x = next(r);
  return x < 0.5 ? 'swarmer' : x < 0.78 ? 'brute' : 'flier';
}

function makeTile(r: RngState, p: Pos, kind: TileKind): Tile {
  const t: Tile = { x: p.x, y: p.y, kind, amount: 0 };
  switch (kind) {
    case 'forage':
      t.amount = int(r, 6, 14);
      break;
    case 'regrowth':
      t.amount = 6;
      break;
    case 'refugees':
      t.amount = int(r, 2, 4);
      break;
    case 'nest':
      t.amount = int(r, 1, 2);
      t.hordeType = randomHorde(r);
      break;
  }
  return t;
}

export function generateWorld(r: RngState): { tiles: Record<string, Tile>; source: Pos } {
  const tiles: Record<string, Tile> = {};
  const edge = allPositions().filter((p) => dist(p) === RADIUS);
  const source = pick(r, edge);

  for (const p of allPositions()) {
    const d = dist(p);
    const ds = dist(p, source);
    let kind: TileKind = 'empty';
    const x = next(r);
    if (ds === 0) kind = 'blight';
    else if (ds === 1 && chance(r, 0.6)) kind = chance(r, 0.5) ? 'blight' : 'nest';
    else if (d === 1) kind = x < 0.35 ? 'forage' : 'empty';
    else if (x < 0.25) kind = 'forage';
    else if (x < 0.33) kind = 'ruins';
    else if (x < 0.38) kind = 'refugees';
    else if (x < 0.43) kind = 'strange';
    else if (x < 0.47 && d >= 3) kind = 'nest';
    tiles[key(p)] = makeTile(r, p, kind);
  }
  return { tiles, source };
}

/** Marks player intel in the given sector as uncertain and logs a rumble. */
function rumble(s: GameState, sector: Sector) {
  for (const [k, info] of Object.entries(s.intel)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    if (sectorOf({ x, y }) === sector && info.day < s.day) info.uncertain = true;
  }
}

/**
 * The land moves. Each shift mutates a small cluster of tiles; every shift
 * makes the player's intel in that sector uncertain (event-driven decay).
 */
export function shiftLand(s: GameState): Sector[] {
  const r = s.rng;
  const shifted = new Set<Sector>();
  const count = 1 + (chance(r, 0.5) ? 1 : 0) + (dist(s.source) <= 2 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    // Shifts cluster around the source as it nears.
    const nearSource = chance(r, 0.4);
    const candidates = allPositions().filter((p) => !nearSource || dist(p, s.source) <= 2);
    const p = pick(r, candidates);
    const t = s.tiles[key(p)]!;
    const nearHeart = dist(p, s.source) <= 2;
    mutate(r, s, t, nearHeart);
    if (chance(r, 0.5)) {
      const q = pick(r, neighbours(p));
      mutate(r, s, s.tiles[key(q)]!, dist(q, s.source) <= 2);
    }
    shifted.add(sectorOf(p));
  }
  for (const sec of shifted) rumble(s, sec);
  return [...shifted];
}

function mutate(r: RngState, s: GameState, t: Tile, nearHeart: boolean) {
  if (t.x === s.source.x && t.y === s.source.y) return;
  const replace = (kind: TileKind) => Object.assign(t, makeTile(r, t, kind), { hordeType: kind === 'nest' ? randomHorde(r) : undefined });
  switch (t.kind) {
    case 'empty':
      if (nearHeart) replace(chance(r, 0.5) ? 'nest' : 'blight');
      else replace(pick(r, ['forage', 'forage', 'refugees', 'strange', 'empty'] as TileKind[]));
      break;
    case 'forage':
      if (nearHeart) replace('blight');
      else if (chance(r, 0.5)) replace('empty');
      else t.amount = Math.max(1, t.amount + int(r, -3, 3));
      break;
    case 'regrowth':
      if (nearHeart && chance(r, 0.5)) replace('blight');
      else t.amount = Math.min(10, t.amount + 2);
      break;
    case 'refugees': {
      // They move on: maybe elsewhere, maybe lost.
      const dest = neighbours(t).map((q) => s.tiles[key(q)]!).find((q) => q.kind === 'empty');
      if (dest && chance(r, 0.6)) Object.assign(dest, { kind: 'refugees', amount: t.amount });
      replace('empty');
      break;
    }
    case 'nest':
      t.amount = Math.min(6, t.amount + 1);
      break;
    case 'blight':
      if (!nearHeart && chance(r, 0.4)) replace('empty');
      else {
        const q = pick(r, neighbours(t));
        const qt = s.tiles[key(q)]!;
        if (qt.kind === 'empty' || qt.kind === 'forage') Object.assign(qt, makeTile(r, q, 'blight'));
      }
      break;
    case 'strange':
      if (chance(r, 0.3)) replace('empty');
      break;
    case 'ruins':
      break;
  }
}

/** The source grows toward the colony, leaving blight and nests behind. Returns true if it moved. */
export function moveSource(s: GameState): boolean {
  if (s.day < s.source.nextMoveDay) return false;
  const r = s.rng;
  const old = { x: s.source.x, y: s.source.y };
  // Step one tile toward the colony along the major axis, sometimes diagonally.
  const ax = Math.abs(old.x);
  const ay = Math.abs(old.y);
  if (ax >= ay || chance(r, 0.5)) s.source.x -= Math.sign(old.x);
  if (ay >= ax || chance(r, 0.5)) s.source.y -= Math.sign(old.y);
  s.source.nextMoveDay = s.day + int(r, 4, 6);
  const oldTile = s.tiles[key(old)];
  if (oldTile) Object.assign(oldTile, { kind: 'blight', amount: 0, hordeType: undefined });
  if (dist(s.source) > 0) {
    const here = s.tiles[key(s.source)]!;
    Object.assign(here, { kind: 'blight', amount: 0, hordeType: undefined });
    for (const q of neighbours(s.source)) {
      const qt = s.tiles[key(q)]!;
      if (qt.kind === 'empty' && chance(r, 0.3)) Object.assign(qt, makeTile(r, q, 'nest'));
    }
  }
  rumble(s, sectorOf(old));
  if (dist(s.source) > 0) rumble(s, sectorOf(s.source));
  return true;
}

/** Records current ground truth of a tile as fresh intel. */
export function reveal(s: GameState, p: Pos) {
  const t = s.tiles[key(p)];
  if (!t) return;
  s.intel[key(p)] = {
    kind: t.kind,
    amount: t.amount,
    hordeType: t.hordeType,
    day: s.day,
    uncertain: false,
    source: t.x === s.source.x && t.y === s.source.y,
  };
}

export function revealArea(s: GameState, center: Pos, radius: number) {
  for (const p of allPositions()) if (dist(p, center) <= radius) reveal(s, p);
}

/** Watchtowers keep intel fresh on the nearest tiles in their direction. */
export function towerWatch(s: GameState) {
  for (const d of DIRS) {
    if (!s.settlement.towers[d]) continue;
    for (const p of allPositions()) if (dist(p) <= 1 && dirOfSector(sectorOf(p)) === d) reveal(s, p);
  }
}
