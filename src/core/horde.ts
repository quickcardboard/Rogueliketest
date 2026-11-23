import { assaultNear, hurt, moveTo } from './agents';
import { DT, HORDE_INFO, SEGMENT_NAMES, WALL_R, WORLD_R } from './data';
import { chance, int, next } from './rng';
import { addLog } from './state';
import type { Colonist, Feature, GameState, HordeType, HordeUnit, Vec } from './types';
import { dist, isVisible, segmentOf, sectorName } from './world';

const TYPES: HordeType[] = ['swarmer', 'brute', 'flier'];

function spawnUnit(s: GameState, type: HordeType, x: number, y: number, mode: HordeUnit['mode'], nest: number): HordeUnit {
  const u: HordeUnit = { id: s.nextId++, type, hp: HORDE_INFO[type].hp, x, y, px: x, py: y, mode, nest, tx: x, ty: y };
  s.horde.push(u);
  return u;
}

/** Threat gathered per hour from nests, the heart and time. */
export function threatRate(s: GameState): { rate: number; main: Vec; weights: Record<HordeType, number> } {
  const day = s.time / 24;
  let rate = 4 + day * 0.3;
  const weights: Record<HordeType, number> = { swarmer: 2, brute: 0.4, flier: 0.4 };
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

export function stepHorde(s: GameState) {
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
    s.warband = { units: types.length, start: s.time, dir: segmentOf(stage), killed: 0, lost: 0, stolen: 0, interventions: s.specials.includes('bell') ? 2 : 1, marching: false, gatherUntil: s.time + 8 + next(s.rng) * 6, announced: false };
  }

  const wb = s.warband;
  if (wb && !wb.marching && s.time >= wb.gatherUntil) {
    wb.marching = true;
    for (const u of s.horde) if (u.mode === 'gather') u.mode = 'march';
  }

  // Announce warbands the colony can see.
  if (wb && !wb.announced && s.horde.some((u) => u.mode !== 'roam' && isVisible(s, u))) {
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
      case 'march': {
        // Field workers in the way get attacked.
        const prey = nearestColonist(s, u, dist(u) > WALL_R + 2 ? 6 : 14, false);
        if (prey) {
          if (moveTo(u, prey.x, prey.y, info.speed) || dist(u, prey) < 1.5) hurt(s, prey, info.dps * DT);
          if (dist(prey) > WALL_R + 1 || dist(u) < WALL_R) break;
        }
        const d = dist(u);
        if (d > WALL_R + 1.2) {
          moveTo(u, (u.x / d) * (WALL_R + 1), (u.y / d) * (WALL_R + 1), info.speed);
          if (dist(u) <= WALL_R + 1.3) {
            const seg = segmentOf(u);
            if (u.type !== 'flier' && s.settlement.wallLevel > 0 && s.settlement.wallHp[seg]! > 0) u.mode = 'siege';
            else {
              u.x = (u.x / d) * (WALL_R - 0.5);
              u.y = (u.y / d) * (WALL_R - 0.5);
            }
          }
        } else if (d > 1.5) {
          moveTo(u, 0, 0, info.speed);
        } else {
          // At the heart of the colony: wreck and steal.
          s.settlement.keepHp = Math.max(0, s.settlement.keepHp - info.dps * 0.6 * DT);
          const steal = Math.min(s.supplies, info.dps * 0.8 * DT);
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
        const fallback = s.directives.stance === 'shelter' ? 1.2 : 1;
        s.settlement.wallHp[seg] = Math.max(0, hp - info.wallDps * fallback * DT);
        if (s.settlement.wallHp[seg] === 0) addLog(s, `The ${SEGMENT_NAMES[seg]} wall is breached!`, 'bad');
        // Defenders right behind the wall get hit too.
        const prey = nearestColonist(s, u, 2.5, false);
        if (prey) hurt(s, prey, info.dps * 0.4 * DT);
        break;
      }
    }
  }

  // Remove the dead.
  const dead = s.horde.filter((u) => u.hp <= 0 && u.mode !== 'roam').length;
  s.horde = s.horde.filter((u) => u.hp > 0);
  if (wb) wb.killed += dead;

  // The warband is broken when none of it remains.
  if (wb && !s.horde.some((u) => u.mode !== 'roam')) {
    s.assaults++;
    addLog(s, `The warband is broken. ${wb.killed} of them fell; we lost ${wb.lost}${wb.stolen >= 1 ? ` and ${Math.round(wb.stolen)} supplies` : ''}.`, wb.lost > 2 ? 'bad' : 'good');
    s.warband = null;
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
