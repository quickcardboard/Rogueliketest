import { assaultNear, hurt, moveTo } from './agents';
import { DT, HORDE_INFO, SEGMENT_NAMES, WALL_R, WORLD_R } from './data';
import { chance, int, next } from './rng';
import { addLog } from './state';
import type { Colonist, Feature, GameState, HordeType, HordeUnit, Vec } from './types';
import { angleOf, arcAtAngle, dist, elementAt, isNight, isVisible, ringAt, segmentOf, sectorName } from './world';

const TYPES: HordeType[] = ['swarmer', 'brute', 'flier'];

function spawnUnit(s: GameState, type: HordeType, x: number, y: number, mode: HordeUnit['mode'], nest: number): HordeUnit {
  const u: HordeUnit = { id: s.nextId++, type, hp: HORDE_INFO[type].hp, x, y, px: x, py: y, mode, nest, tx: x, ty: y, fx: 0, ring: -1 };
  s.horde.push(u);
  return u;
}

/** Threat gathered per hour from nests, the heart and time. */
export function threatRate(s: GameState): { rate: number; main: Vec; weights: Record<HordeType, number> } {
  const day = s.time / 24;
  let rate = 4 + day * 0.3;
  const weights: Record<HordeType, number> = { swarmer: 2, brute: 0.4, flier: 0.4, shade: 0 };
  let main: Vec = s.heart;
  let best = (1 - dist(s.heart) / WORLD_R) * 8;
  rate += best;
  for (const f of s.features) {
    if (f.kind !== 'nest') continue;
    const c = f.amount * (dist(f) < 50 ? 1.6 : 0.9);
    rate += c;
    weights[f.hordeType ?? 'swarmer'] += c;
    if (c > best) {
      best = c;
      main = f;
    }
  }
  return { rate: rate / 24, main, weights };
}

function compose(s: GameState, budget: number, weights: Record<HordeType, number>): HordeType[] {
  const out: HordeType[] = [];
  const total = weights.swarmer + weights.brute + weights.flier;
  let left = budget;
  while (left >= 1 && out.length < 90) {
    let x = next(s.rng) * total;
    let t: HordeType = 'swarmer';
    for (const ht of TYPES) {
      x -= weights[ht];
      if (x <= 0) {
        t = ht;
        break;
      }
    }
    if (HORDE_INFO[t].cost > left) t = 'swarmer';
    out.push(t);
    left -= HORDE_INFO[t].cost;
  }
  return out;
}

function nearestColonist(s: GameState, p: Vec, range: number, outsideOnly: boolean): Colonist | null {
  let best: Colonist | null = null;
  let bd = range;
  for (const c of s.colonists) {
    if (c.hp <= 0 || c.task === 'wounded') continue;
    if (outsideOnly && dist(c) < WALL_R + 1) continue;
    const d = dist(c, p);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/** Part of a warband (as opposed to nest guards and night stalkers). */
export const isWarband = (u: HordeUnit) => u.mode === 'gather' || u.mode === 'march' || u.mode === 'siege';

/** A warband unit entering a ring takes on its element. */
function enterRing(s: GameState, u: HordeUnit, k: number) {
  u.ring = k;
  const e = s.rings[k]!.arcs[arcAtAngle(s, k, angleOf(u))]!;
  switch (e) {
    case 'ember':
      if (u.type === 'swarmer') u.hp -= 1.2;
      else u.fx |= 1;
      break;
    case 'frost':
      u.fx |= 2;
      break;
    case 'bloom':
      u.hp *= 1.5;
      u.fx |= 4;
      break;
    case 'mire':
      break;
  }
}

function speedMul(s: GameState, u: HordeUnit): number {
  let m = 1;
  if (u.fx & 2) m *= 0.6;
  if (u.fx & 1) m *= 1.15;
  if (u.type !== 'flier' && u.mode === 'march' && elementAt(s, u) === 'mire') m *= 0.45;
  return m;
}
const dpsMul = (u: HordeUnit) => (u.fx & 1 ? 1.35 : 1);

/** Night stalkers come out after dark and hunt anyone outside the walls. They fade at dawn. */
function stepNight(s: GameState) {
  const night = isNight(s);
  if (!night) {
    for (const u of s.horde) if (u.mode === 'stalk') u.hp = 0;
    return;
  }
  const day = s.time / 24;
  const have = s.horde.filter((u) => u.mode === 'stalk').length;
  if (have < 3 + day / 2 && chance(s.rng, (0.6 + day * 0.08) * DT)) {
    const a = next(s.rng) * Math.PI * 2;
    const d = 30 + next(s.rng) * 55;
    const u = spawnUnit(s, 'shade', Math.cos(a) * d, Math.sin(a) * d, 'stalk', -2);
    u.tx = u.x;
    u.ty = u.y;
  }
}

export function stepHorde(s: GameState) {
  stepNight(s);
  const { rate, main, weights } = threatRate(s);
  if (!s.warband) s.threat += rate * DT;

  // A warband forms when threat reaches the threshold.
  if (!s.warband && s.threat >= s.threshold) {
    const toward = { x: -main.x / (dist(main) || 1), y: -main.y / (dist(main) || 1) };
    const stage = { x: main.x + toward.x * 8, y: main.y + toward.y * 8 };
    const types = compose(s, s.threshold * 1.1, weights);
    for (const t of types) {
      const u = spawnUnit(s, t, stage.x + (next(s.rng) - 0.5) * 8, stage.y + (next(s.rng) - 0.5) * 8, 'gather', -1);
      u.tx = stage.x + (next(s.rng) - 0.5) * 10;
      u.ty = stage.y + (next(s.rng) - 0.5) * 10;
    }
    s.warband = { units: types.length, sx: stage.x, sy: stage.y, start: s.time, dir: segmentOf(stage), killed: 0, lost: 0, stolen: 0, interventions: s.specials.includes('tinderbox') ? 2 : 1, marching: false, gatherUntil: s.time + 8 + next(s.rng) * 6, announced: false };
  }

  const wb = s.warband;
  if (wb && !wb.marching && s.time >= wb.gatherUntil) {
    wb.marching = true;
    for (const u of s.horde) if (u.mode === 'gather') u.mode = 'march';
  }

  // Announce warbands the colony can see.
  if (wb && !wb.announced && s.horde.some((u) => isWarband(u) && isVisible(s, u))) {
    wb.announced = true;
    const where = SEGMENT_NAMES[wb.dir]!;
    const msg = wb.marching ? `A warband of ${wb.units} is marching on the colony from the ${where}!` : `A warband of ${wb.units} is gathering in the ${where}.`;
    addLog(s, msg, 'bad');
    s.alert = msg;
  }

  // Nests keep a few roaming guards.
  for (const f of s.features) {
    if (f.kind !== 'nest') continue;
    const have = s.horde.filter((u) => u.mode === 'roam' && u.nest === f.id).length;
    if (have < Math.min(3, f.amount) && chance(s.rng, 0.15 * DT)) spawnUnit(s, f.hordeType ?? 'swarmer', f.x, f.y, 'roam', f.id);
  }

  const nests = new Map<number, Feature>();
  for (const f of s.features) if (f.kind === 'nest') nests.set(f.id, f);

  for (const u of s.horde) {
    u.px = u.x;
    u.py = u.y;
    if (u.hp <= 0) continue;
    const info = HORDE_INFO[u.type];
    switch (u.mode) {
      case 'roam': {
        const nest = nests.get(u.nest);
        if (!nest) {
          u.hp = 0;
          break;
        }
        const prey = nearestColonist(s, u, 7, true);
        if (prey && dist(prey, nest) < nest.r + 18) {
          if (moveTo(u, prey.x, prey.y, info.speed) || dist(u, prey) < 1.5) hurt(s, prey, info.dps * DT);
        } else if (moveTo(u, u.tx, u.ty, info.speed * 0.4)) {
          const a = next(s.rng) * Math.PI * 2;
          const r = nest.r + next(s.rng) * 10;
          u.tx = nest.x + Math.cos(a) * r;
          u.ty = nest.y + Math.sin(a) * r;
        }
        break;
      }
      case 'gather':
        moveTo(u, u.tx, u.ty, info.speed * 0.3);
        break;
      case 'stalk': {
        const prey = nearestColonist(s, u, 30, true);
        if (prey) {
          if (moveTo(u, prey.x, prey.y, info.speed) || dist(u, prey) < 1.5) hurt(s, prey, info.dps * DT);
        } else if (moveTo(u, u.tx, u.ty, info.speed * 0.5) || dist(u) < WALL_R + 6) {
          const a = next(s.rng) * Math.PI * 2;
          const d = 25 + next(s.rng) * 60;
          u.tx = Math.cos(a) * d;
          u.ty = Math.sin(a) * d;
        }
        break;
      }
      case 'march': {
        const k = ringAt(u);
        if (k >= 0 && k !== u.ring) enterRing(s, u, k);
        if (u.hp <= 0) break;
        const speed = info.speed * speedMul(s, u);
        const dps = info.dps * dpsMul(u);
        // Field workers in the way get attacked.
        const prey = nearestColonist(s, u, dist(u) > WALL_R + 2 ? 6 : 14, false);
        if (prey) {
          if (moveTo(u, prey.x, prey.y, speed) || dist(u, prey) < 1.5) hurt(s, prey, dps * DT);
          if (dist(prey) > WALL_R + 1 || dist(u) < WALL_R) break;
        }
        const d = dist(u);
        if (d > WALL_R + 1.2) {
          moveTo(u, (u.x / d) * (WALL_R + 1), (u.y / d) * (WALL_R + 1), speed);
          if (dist(u) <= WALL_R + 1.3) {
            const seg = segmentOf(u);
            if (u.type !== 'flier' && s.settlement.wallLevel > 0 && s.settlement.wallHp[seg]! > 0) u.mode = 'siege';
            else {
              u.x = (u.x / d) * (WALL_R - 0.5);
              u.y = (u.y / d) * (WALL_R - 0.5);
            }
          }
        } else if (d > 1.5) {
          moveTo(u, 0, 0, speed);
        } else {
          // At the heart of the colony: wreck and steal.
          s.settlement.keepHp = Math.max(0, s.settlement.keepHp - dps * 0.6 * DT);
          const steal = Math.min(s.supplies, dps * 0.8 * DT);
          s.supplies -= steal;
          if (wb) wb.stolen += steal;
        }
        break;
      }
      case 'siege': {
        const seg = segmentOf(u);
        const hp = s.settlement.wallHp[seg]!;
        if (hp <= 0) {
          u.mode = 'march';
          const d = dist(u);
          u.x = (u.x / d) * (WALL_R - 0.5);
          u.y = (u.y / d) * (WALL_R - 0.5);
          break;
        }
        s.settlement.wallHp[seg] = Math.max(0, hp - info.wallDps * dpsMul(u) * DT);
        if (s.settlement.wallHp[seg] === 0) addLog(s, `The ${SEGMENT_NAMES[seg]} wall is breached!`, 'bad');
        // Defenders right behind the wall get hit too.
        const prey = nearestColonist(s, u, 2.5, false);
        if (prey) hurt(s, prey, info.dps * dpsMul(u) * 0.4 * DT);
        break;
      }
    }
  }

  // Remove the dead.
  const dead = s.horde.filter((u) => u.hp <= 0 && isWarband(u)).length;
  s.horde = s.horde.filter((u) => u.hp > 0);
  if (wb) wb.killed += dead;

  // The warband is broken when none of it remains.
  if (wb && !s.horde.some(isWarband)) {
    s.assaults++;
    addLog(s, `The warband is broken. ${wb.killed} of them fell; we lost ${wb.lost}${wb.stolen >= 1 ? ` and ${Math.round(wb.stolen)} supplies` : ''}.`, wb.lost > 2 ? 'bad' : 'good');
    s.warband = null;
    if (s.bell) {
      s.bell = false;
      s.dirtyLabor = true;
      addLog(s, 'The bell falls silent. Everyone goes back to work.');
    }
    s.threat = 0;
    s.threshold = 34 + s.assaults * 9 + int(s.rng, 0, 10);
  }
}

/** Expected direction of the next or current assault, if known to the colony. */
export function assaultDirection(s: GameState): string | null {
  const near = assaultNear(s);
  if (near) return sectorName(near);
  if (s.warband?.announced) return SEGMENT_NAMES[s.warband.dir]!;
  return null;
}
