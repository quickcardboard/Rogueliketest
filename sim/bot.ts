import { chooseBoon, chooseEvent, fireStores, orderStrike, projectCost, queueProject, queueTraining, setBell, setSplit, step, strikeOdds } from '../src/core/sim';
import type { GameState, PlotKey } from '../src/core/types';

/** The "just build everything" player: queues plots in a fixed order, never touches much else. */
export function botDecide(s: GameState) {
  if (s.event) return chooseEvent(s, 0);
  if (s.boon) {
    const i = s.boon.findIndex((b) => b.kind === 'relic');
    return chooseBoon(s, i >= 0 ? i : 0);
  }
  const wb = s.warband;
  if (wb?.marching && s.horde.some((u) => u.mode === 'siege')) {
    setBell(s, true);
    if (wb.interventions > 0) fireStores(s);
  }
  const order: PlotKey[] = ['granary', 'workshop', 'towerNE', 'palisade', 'infirmary', 'barracks', 'towerSW', 'hearth', 'workshop', 'towerNW', 'towerSE', 'palisade', 'lodge', 'granary', 'workshop', 'barracks'];
  if (s.projects.length < 2) {
    for (const plot of order) {
      const c = projectCost(s, { plot });
      if (typeof c !== 'string' && s.supplies >= c.supplies + 20) {
        queueProject(s, { plot });
        break;
      }
    }
  }
  if (s.supplies > 40 && s.training.length === 0) {
    const m = s.colonists.filter((c) => c.role === 'militia').length;
    const a = s.colonists.filter((c) => c.role === 'archer').length;
    queueTraining(s, m <= a ? 'militia' : 'archer');
  }
  setSplit(s, 'scout', wb ? 10 : 35);
  setSplit(s, 'build', s.projects.length ? 45 : 10);
  const seen = s.heart.seen;
  if (seen && !seen.uncertain && s.time - seen.at < 24 && strikeOdds(s) >= 0.55 && !wb) orderStrike(s);
}

export function playOut(s: GameState, maxDays = 60) {
  while (s.outcome === 'playing' && s.time < maxDays * 24) {
    if (s.steps % 120 === 0 || s.event || s.boon) botDecide(s);
    s.alert = null;
    step(s);
  }
  return s;
}
