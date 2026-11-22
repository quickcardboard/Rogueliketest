import {
  actPreview,
  advanceDay,
  assaultEstimate,
  assignSquad,
  battleStep,
  chooseEvent,
  projectCost,
  queueProject,
  sendExpedition,
  trainSquad,
} from '../src/core/game';
import { DIRS, RADIUS } from '../src/core/data';
import type { GameState, Pos, ProjectKind, Squad } from '../src/core/types';
import { allPositions, dirOfSector, dist, key, sectorOf } from '../src/core/world';

/** A simple heuristic player used for headless balance simulations. */
export function botTurn(s: GameState) {
  if (s.event) return chooseEvent(s, 0);
  if (s.battle) return battleStep(s, s.battle.round === 1 && s.battle.interventionsLeft > 0 ? 'bell' : undefined);

  const home = () => s.squads.filter((q) => q.assignment.type === 'guard' || q.assignment.type === 'work');
  const est = assaultEstimate(s);
  const danger = est.minDays <= 1;

  // Strike the heart if we know where it is and the odds are good.
  const src = Object.entries(s.intel).find(([, i]) => i.source && !i.uncertain);
  if (src) {
    const [x, y] = src[0].split(',').map(Number) as [number, number];
    const party = home().filter((q) => q.role !== 'builder' && q.health >= 2);
    const odds = actPreview(s, party, { x, y }).odds ?? 0;
    if (party.length && odds >= 0.5 && !danger) {
      sendExpedition(s, party.map((q) => q.id), { x, y }, 'act');
    }
  }

  // Scouts keep intel fresh, preferring uncertain/unknown tiles further out.
  for (const q of home().filter((q) => q.role === 'scout' && q.health > 0)) {
    const t = bestScoutTarget(s);
    if (t) sendExpedition(s, [q.id], t, 'scout');
  }

  // Train an archer if we have none.
  if (!s.squads.some((q) => q.role === 'archer')) {
    const m = home().find((q) => q.role === 'militia');
    if (m) trainSquad(s, m.id, 'archer');
  }

  // Build: wall facing the threat, then towers, equipment, buildings.
  const facing = est.dir ?? dirOfSector(sectorOf(s.source));
  const wants: ProjectKind[] = [
    { kind: 'wall', dir: facing },
    { kind: 'inner', building: 'infirmary' },
    { kind: 'tower', dir: facing },
    { kind: 'equipment' },
    { kind: 'inner', building: 'granary' },
    ...DIRS.map((dir) => ({ kind: 'wall', dir }) as ProjectKind),
  ];
  if (s.projects.length < 2) {
    for (const w of wants) {
      const c = projectCost(s, w);
      if (typeof c !== 'string' && s.supplies >= c.supplies + 12) {
        queueProject(s, w);
        break;
      }
    }
  }

  // Builders work if there's work, otherwise gather.
  for (const q of home().filter((q) => q.role === 'builder')) {
    if (s.projects.length) assignSquad(s, q.id, 'work');
    else gather(s, q);
  }

  // Fighters guard when danger is near; otherwise half of them gather or clear nearby nests.
  const fighters = home().filter((q) => q.role === 'militia' || q.role === 'archer');
  fighters.forEach((q, i) => {
    if (danger || i % 2 === 0) assignSquad(s, q.id, 'guard');
    else if (!clearNest(s, q)) gather(s, q);
  });

  advanceDay(s);
}

function bestScoutTarget(s: GameState): Pos | null {
  let best: Pos | null = null;
  let bestScore = -1;
  for (const p of allPositions()) {
    if (dist(p) < 2) continue;
    let score = 0;
    for (const q of allPositions()) {
      if (dist(p, q) > 2) continue;
      const i = s.intel[key(q)];
      score += !i ? 2 : i.uncertain ? 1 : 0;
    }
    if (dist(p) === RADIUS) score -= 2;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

function gather(s: GameState, q: Squad) {
  let best: Pos | null = null;
  let bestV = 0;
  for (const [k, i] of Object.entries(s.intel)) {
    if (i.kind !== 'forage' && i.kind !== 'regrowth' && i.kind !== 'ruins' && i.kind !== 'refugees') continue;
    const [x, y] = k.split(',').map(Number) as [number, number];
    const v = (i.kind === 'ruins' ? 12 : i.kind === 'refugees' ? 15 : i.amount) / (dist({ x, y }) <= 2 ? 1 : 2);
    if (v > bestV) {
      bestV = v;
      best = { x, y };
    }
  }
  if (best) sendExpedition(s, [q.id], best, 'act');
  else assignSquad(s, q.id, 'work');
}

function clearNest(s: GameState, q: Squad): boolean {
  for (const [k, i] of Object.entries(s.intel)) {
    if (i.kind !== 'nest' || i.uncertain) continue;
    const [x, y] = k.split(',').map(Number) as [number, number];
    const odds = actPreview(s, [q], { x, y }).odds ?? 0;
    if (odds >= 0.65) {
      sendExpedition(s, [q.id], { x, y }, 'act');
      return true;
    }
  }
  return false;
}
