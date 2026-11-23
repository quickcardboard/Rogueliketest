import { chooseEvent, intervene, orderStrike, projectCost, queueProject, queueTraining, setLabor, step, strikeOdds } from '../src/core/sim';
import type { GameState, ProjectSpec } from '../src/core/types';

/** A simple player for headless balance runs: makes decisions every 6 hours. */
export function botDecide(s: GameState) {
  if (s.event) return chooseEvent(s, 0);
  if (s.warband?.marching && s.warband.interventions > 0 && s.horde.some((u) => u.mode === 'siege')) intervene(s, 'bell');

  const wants: ProjectSpec[] = [
    { kind: 'inner', building: 'granary' },
    { kind: 'wall' },
    { kind: 'tower' },
    { kind: 'equipment' },
    { kind: 'inner', building: 'infirmary' },
    { kind: 'inner', building: 'hearth' },
    { kind: 'wall' },
    { kind: 'equipment' },
  ];
  if (s.projects.length < 1) {
    for (const w of wants) {
      const c = projectCost(s, w);
      if (typeof c !== 'string' && s.supplies >= c.supplies + 25) {
        queueProject(s, w);
        break;
      }
    }
  }
  if (s.supplies > 40 && s.training.length === 0) queueTraining(s, s.colonists.filter((c) => c.role === 'militia').length <= s.colonists.filter((c) => c.role === 'archer').length ? 'militia' : 'archer');

  const low = s.supplies < 20;
  setLabor(s, 'gather', low ? 55 : 35);
  setLabor(s, 'build', s.projects.length ? 20 : 5);
  setLabor(s, 'scout', 15);
  setLabor(s, 'guard', s.warband ? 30 : 15);
  setLabor(s, 'hunt', 15);

  const seen = s.heart.seen;
  if (seen && !seen.uncertain && s.time - seen.at < 24 && strikeOdds(s) >= 0.55 && !s.warband) orderStrike(s);
}

export function playOut(s: GameState, maxDays = 60) {
  while (s.outcome === 'playing' && s.time < maxDays * 24) {
    if (s.steps % 120 === 0 || s.event) botDecide(s);
    s.alert = null;
    step(s);
  }
  return s;
}
