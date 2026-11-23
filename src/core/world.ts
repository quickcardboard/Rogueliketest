import { ARCS, FOG_CELL, FOG_N, RINGS, ROLE_INFO, SEGMENTS, SEGMENT_NAMES, WALL_R, WORLD_R } from './data';
import { chance, int, next, pick, type RngState } from './rng';
import type { Element, Feature, FeatureKind, GameState, HordeType, Vec } from './types';
import { plotLevel } from './state';

export const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export const dist = (a: Vec, b: Vec = { x: 0, y: 0 }) => len(a.x - b.x, a.y - b.y);
/** Angle with north up: +x east, +y south (screen coordinates). */
export const angleOf = (p: Vec) => Math.atan2(-p.y, p.x);

export function segmentOf(p: Vec): number {
  const a = angleOf(p);
  return (Math.round(a / ((Math.PI * 2) / SEGMENTS)) + SEGMENTS) % SEGMENTS;
}
export const sectorName = (p: Vec) => SEGMENT_NAMES[segmentOf(p)]!;

export function randomHorde(r: RngState): HordeType {
  const x = next(r);
  return x < 0.5 ? 'swarmer' : x < 0.78 ? 'brute' : 'flier';
}

export function makeFeature(s: GameState, kind: FeatureKind, x: number, y: number): Feature {
  const r = s.rng;
  const f: Feature = { id: s.nextId++, kind, x, y, r: 4, amount: 0, hp: 0 };
  switch (kind) {
    case 'forest':
      f.r = 5 + next(r) * 5;
      f.amount = int(r, 25, 55);
      break;
    case 'regrowth':
      f.r = 5;
      f.amount = 10;
      break;
    case 'ruins':
      f.r = 3 + next(r) * 2;
      f.amount = int(r, 20, 40);
      break;
    case 'survivors':
      f.r = 2;
      f.amount = int(r, 2, 4);
      break;
    case 'nest':
      f.r = 3.5;
      f.amount = int(r, 1, 3);
      f.hp = f.amount * 6;
      f.hordeType = randomHorde(r);
      break;
    case 'blight':
      f.r = 5 + next(r) * 4;
      break;
    case 'strange':
      f.r = 2.5;
      break;
  }
  return f;
}

function polar(r: RngState, minR: number, maxR: number, angle?: number, spread = Math.PI * 2): Vec {
  const a = angle === undefined ? next(r) * Math.PI * 2 : angle + (next(r) - 0.5) * spread;
  const d = minR + next(r) * (maxR - minR);
  return { x: Math.cos(a) * d, y: -Math.sin(a) * d };
}

/** Places a feature somewhere not overlapping others. */
function place(s: GameState, kind: FeatureKind, minR: number, maxR: number, angle?: number, spread?: number): Feature | null {
  for (let tries = 0; tries < 30; tries++) {
    const p = polar(s.rng, minR, maxR, angle, spread);
    if (s.features.some((f) => dist(f, p) < f.r + 6)) continue;
    const f = makeFeature(s, kind, p.x, p.y);
    s.features.push(f);
    return f;
  }
  return null;
}

export function generateWorld(s: GameState) {
  const r = s.rng;
  const heartAngle = next(r) * Math.PI * 2;
  s.heart.x = Math.cos(heartAngle) * 88;
  s.heart.y = -Math.sin(heartAngle) * 88;
  // Close, safe forests to get started.
  for (let i = 0; i < 4; i++) place(s, 'forest', 16, 32);
  for (let i = 0; i < 12; i++) place(s, 'forest', 30, 95);
  for (let i = 0; i < 6; i++) place(s, 'ruins', 30, 92);
  for (let i = 0; i < 4; i++) place(s, 'survivors', 30, 90);
  for (let i = 0; i < 4; i++) place(s, 'strange', 35, 92);
  for (let i = 0; i < 3; i++) place(s, 'nest', 50, 90);
  // The heart's surroundings are already sick.
  for (let i = 0; i < 3; i++) place(s, 'blight', 70, 98, heartAngle, 0.5);
  for (let i = 0; i < 2; i++) place(s, 'nest', 62, 92, heartAngle, 0.6);
}

// ───────────── Fog & vision ─────────────

export function fogIndex(x: number, y: number): number {
  const cx = Math.floor((x + WORLD_R) / FOG_CELL);
  const cy = Math.floor((y + WORLD_R) / FOG_CELL);
  if (cx < 0 || cy < 0 || cx >= FOG_N || cy >= FOG_N) return -1;
  return cy * FOG_N + cx;
}

export function cellCenter(i: number): Vec {
  return { x: (i % FOG_N) * FOG_CELL - WORLD_R + FOG_CELL / 2, y: Math.floor(i / FOG_N) * FOG_CELL - WORLD_R + FOG_CELL / 2 };
}

export function isVisible(s: GameState, p: Vec): boolean {
  const i = fogIndex(p.x, p.y);
  return i >= 0 && s.fogSeen[i]! >= s.time - 0.25;
}

export function isNight(s: GameState): boolean {
  const h = s.time % 24;
  return h < 6 || h >= 20;
}

function sightOf(s: GameState, base: number): number {
  return base * (s.specials.includes('cartographer') ? 1.4 : 1) * (isNight(s) ? 0.6 : 1);
}

// ───────────── Rings ─────────────

/** Which ring a point lies in (0 = innermost), or -1. */
export function ringAt(p: Vec): number {
  const d = dist(p);
  return RINGS.findIndex((r) => d >= r.inner && d < r.outer);
}

const ARC = (Math.PI * 2) / ARCS;
const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

/** The ring-local arc under a world angle. */
export function arcAtAngle(s: GameState, k: number, angle: number): number {
  return Math.floor(norm(angle - s.rings[k]!.offset * ARC) / ARC) % ARCS;
}

/** World angle where a ring-local arc starts. */
export function arcStart(s: GameState, k: number, arc: number): number {
  return norm(arc * ARC + s.rings[k]!.offset * ARC);
}

export function elementAt(s: GameState, p: Vec): Element | null {
  const k = ringAt(p);
  if (k < 0) return null;
  return s.rings[k]!.arcs[arcAtAngle(s, k, angleOf(p))]!;
}

/** What the colony believes lies along a straight approach at this angle, ring by ring (outermost first). */
export function forecastRoute(s: GameState, angle: number, from = WORLD_R): { ring: number; element: Element | null }[] {
  const out: { ring: number; element: Element | null }[] = [];
  for (let k = RINGS.length - 1; k >= 0; k--) {
    if (RINGS[k]!.inner >= from) continue;
    out.push({ ring: k, element: s.ringIntel[k]![arcAtAngle(s, k, angle)] ?? null });
  }
  return out;
}

/** Midnight: each ring turns one arc. Sometimes a ring lurches and reverses. Returns log lines. */
export function turnRings(s: GameState): string[] {
  const lines: string[] = [];
  s.rings.forEach((ring, k) => {
    if (chance(s.rng, 0.12)) {
      ring.dir = ring.dir === 1 ? -1 : 1;
      const a = int(s.rng, 0, ARCS - 1);
      const b = (a + int(s.rng, 1, ARCS - 1)) % ARCS;
      [ring.arcs[a], ring.arcs[b]] = [ring.arcs[b]!, ring.arcs[a]!];
      s.ringIntel[k]![a] = null;
      s.ringIntel[k]![b] = null;
      lines.push(`The ${RINGS[k]!.name.toLowerCase()} groaned in the dark and turned against itself. Some of what we knew of it is wrong now.`);
    }
    ring.offset = (ring.offset + ring.dir + ARCS) % ARCS;
  });
  return lines;
}

/** Notes the element of any arc an eye can see. */
function seeRings(s: GameState, x: number, y: number, r: number) {
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = i === 8 ? { x, y } : { x: x + Math.cos(a) * r * 0.85, y: y + Math.sin(a) * r * 0.85 };
    const k = ringAt(p);
    if (k >= 0) s.ringIntel[k]![arcAtAngle(s, k, angleOf(p))] = s.rings[k]!.arcs[arcAtAngle(s, k, angleOf(p))]!;
  }
}

/** Reveals everything within sight of colonists, the colony and towers. */
export function updateVision(s: GameState) {
  const eyes: { x: number; y: number; r: number }[] = [{ x: 0, y: 0, r: sightOf(s, 22) }];
  for (const p of s.plots) if (p.key.startsWith('tower') && p.level > 0) eyes.push({ x: p.x, y: p.y, r: sightOf(s, 26 + p.level * 6) });
  const lodge = plotLevel(s, 'lodge');
  for (const c of s.colonists) if (c.task !== 'wounded') eyes.push({ x: c.x, y: c.y, r: sightOf(s, ROLE_INFO[c.role].sight * (c.role === 'scout' ? 1 + 0.3 * lodge : 1)) });
  for (const e of eyes) seeRings(s, e.x, e.y, e.r);
  if (lodge >= 2) for (const c of s.colonists) if (c.role === 'scout' && c.task !== 'wounded') seeRings(s, c.x, c.y, ROLE_INFO.scout.sight * 2.5);

  for (const e of eyes) {
    const span = Math.ceil(e.r / FOG_CELL);
    const cx = Math.floor((e.x + WORLD_R) / FOG_CELL);
    const cy = Math.floor((e.y + WORLD_R) / FOG_CELL);
    for (let dy = -span; dy <= span; dy++)
      for (let dx = -span; dx <= span; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= FOG_N || y >= FOG_N) continue;
        const c = cellCenter(y * FOG_N + x);
        if (len(c.x - e.x, c.y - e.y) > e.r) continue;
        s.fogSeen[y * FOG_N + x] = s.time;
        s.fogStale[y * FOG_N + x] = 0;
      }
  }

  // Update memories of what is visible now.
  for (const f of s.features) {
    if (!isVisible(s, f)) continue;
    s.intel[f.id] = { x: f.x, y: f.y, kind: f.kind, r: f.r, amount: f.amount, hordeType: f.hordeType, seenAt: s.time, uncertain: false };
  }
  for (const [id, i] of Object.entries(s.intel)) {
    if (!isVisible(s, i)) continue;
    const f = s.features.find((x) => x.id === Number(id));
    if (!f || dist(f, i) > 1) delete s.intel[Number(id)];
  }
  if (isVisible(s, s.heart)) s.heart.seen = { x: s.heart.x, y: s.heart.y, at: s.time, uncertain: false };
  else if (s.heart.seen && isVisible(s, s.heart.seen)) s.heart.seen.uncertain = true;
}

/** How much of the land within `radius` the colony has fresh knowledge of (0..1). */
export function freshness(s: GameState, radius: number): number {
  let n = 0;
  let fresh = 0;
  for (let i = 0; i < s.fogSeen.length; i++) {
    const c = cellCenter(i);
    if (len(c.x, c.y) > radius) continue;
    n++;
    if (s.fogSeen[i]! >= 0 && !s.fogStale[i] && s.time - s.fogSeen[i]! < 72) fresh++;
  }
  return n ? fresh / n : 0;
}

// ───────────── The land shifts ─────────────

function rumble(s: GameState, seg: number) {
  for (let i = 0; i < s.fogSeen.length; i++) {
    const c = cellCenter(i);
    if (len(c.x, c.y) > WALL_R + 12 && segmentOf(c) === seg && s.fogSeen[i]! < s.time - 0.25) s.fogStale[i] = 1;
  }
  for (const i of Object.values(s.intel)) if (segmentOf(i) === seg && dist(i) > WALL_R + 12 && !isVisible(s, i)) i.uncertain = true;
  if (s.heart.seen && segmentOf(s.heart.seen) === seg && !isVisible(s, s.heart.seen)) s.heart.seen.uncertain = true;
}

/** One shift: a sector of the wilds changes. Returns the sector index. */
export function shiftLand(s: GameState): number {
  const r = s.rng;
  const nearHeart = chance(r, 0.45);
  const seg = nearHeart ? segmentOf(s.heart) : int(r, 0, 7);
  const inSeg = s.features.filter((f) => segmentOf(f) === seg && dist(f) > 20);
  const nearH = (f: Vec) => dist(f, s.heart) < 30;
  const changes = 1 + (chance(r, 0.5) ? 1 : 0);
  for (let k = 0; k < changes; k++) {
    const f = inSeg.length ? pick(r, inSeg) : null;
    if (!f || chance(r, 0.3)) {
      // Something new appears.
      const a = (seg * Math.PI * 2) / 8;
      const p = polar(r, 30, 95, a, Math.PI / 4);
      const kind: FeatureKind = nearH(p) ? pick(r, ['nest', 'blight'] as FeatureKind[]) : pick(r, ['forest', 'forest', 'survivors', 'strange', 'ruins'] as FeatureKind[]);
      if (!s.features.some((g) => dist(g, p) < g.r + 5)) s.features.push(makeFeature(s, kind, p.x, p.y));
      continue;
    }
    switch (f.kind) {
      case 'forest':
        if (nearH(f)) Object.assign(f, { kind: 'blight', amount: 0 });
        else f.amount = Math.max(0, f.amount + int(r, -12, 8));
        break;
      case 'regrowth':
        if (nearH(f)) Object.assign(f, { kind: 'blight', amount: 0 });
        else f.amount = Math.min(30, f.amount + 5);
        break;
      case 'survivors': {
        // They move on, or are lost.
        if (chance(r, 0.6)) {
          f.x += (next(r) - 0.5) * 30;
          f.y += (next(r) - 0.5) * 30;
          if (dist(f) > WORLD_R - 4) s.features = s.features.filter((g) => g !== f);
        } else s.features = s.features.filter((g) => g !== f);
        break;
      }
      case 'nest':
        f.amount = Math.min(6, f.amount + 1);
        f.hp = f.amount * 6;
        break;
      case 'blight': {
        const p = { x: f.x + (next(r) - 0.5) * 20, y: f.y + (next(r) - 0.5) * 20 };
        if (dist(p) < WORLD_R - 4 && !s.features.some((g) => dist(g, p) < g.r + 3)) s.features.push(makeFeature(s, nearH(p) && chance(r, 0.4) ? 'nest' : 'blight', p.x, p.y));
        break;
      }
      case 'strange':
        if (chance(r, 0.4)) s.features = s.features.filter((g) => g !== f);
        break;
      case 'ruins':
        break;
    }
  }
  s.features = s.features.filter((f) => !(f.kind === 'forest' && f.amount <= 0));
  rumble(s, seg);
  return seg;
}

// ───────────── The heart ─────────────

/** The heart creeps toward the colony, leaving blight and nests behind. Returns true if it arrived. */
export function moveHeart(s: GameState, dt: number): boolean {
  const h = s.heart;
  const d = dist(h);
  if (h.fightTimer > 0) return false;
  // Slow at first, faster as it grows.
  const speed = (2.6 + s.time / 24 / 10) / 24;
  h.x -= (h.x / d) * speed * dt;
  h.y -= (h.y / d) * speed * dt;
  if (s.time >= h.nextBlight) {
    h.nextBlight = s.time + 14 + next(s.rng) * 10;
    if (!s.features.some((f) => f.kind === 'blight' && dist(f, h) < 6)) s.features.push(makeFeature(s, 'blight', h.x, h.y));
  }
  if (s.time >= h.nextNest) {
    h.nextNest = s.time + 30 + next(s.rng) * 24;
    const p = polar(s.rng, 6, 14);
    const q = { x: h.x + p.x, y: h.y + p.y };
    if (dist(q) > WALL_R + 15 && dist(q) < WORLD_R) s.features.push(makeFeature(s, 'nest', q.x, q.y));
  }
  return dist(h) <= WALL_R + 3;
}
