import { atHome, colonistAttacks, goHome, isFighter, setTask, startLabor, stepColonist } from './agents';
import {
  COSTS,
  DAWN,
  DT,
  DUSK,
  INNER_INFO,
  MAX_EQUIPMENT,
  MAX_TOWERS,
  MAX_WALL,
  ROLE_INFO,
  SEGMENT_NAMES,
  UPKEEP_PER_DAY,
  WALL_HP,
  WALL_R,
} from './data';
import { maybeDailyEvent, resolveEvent } from './events';
import { assaultDirection, stepHorde, threatRate } from './horde';
import { chance, int, next, pick } from './rng';
import { addLog, colonistPower, dayOf, spawnColonist } from './state';
import type { Colonist, Directives, GameState, Labor, ProjectSpec, Role } from './types';
import { angleOf, dist, freshness, isNight, moveHeart, sectorName, shiftLand, updateVision } from './world';

export { newGame, dayOf, clock } from './state';

const LABORS: Labor[] = ['gather', 'build', 'scout', 'guard', 'hunt'];

/** How well suited a role is to a kind of labor. */
const FIT: Record<Role, Record<Labor, number>> = {
  villager: { gather: 2, build: 2, scout: 0.2, guard: 0.6, hunt: 0.1 },
  militia: { gather: 0.5, build: 0.5, scout: 0.3, guard: 2.5, hunt: 3 },
  archer: { gather: 0.5, build: 0.5, scout: 0.3, guard: 3, hunt: 2 },
  scout: { gather: 1, build: 0.5, scout: 4, guard: 0.5, hunt: 0.5 },
  builder: { gather: 2, build: 4, scout: 0.3, guard: 0.3, hunt: 0.1 },
};

export function population(s: GameState): number {
  return s.colonists.length;
}

export function canAct(s: GameState) {
  return s.outcome === 'playing';
}

const interruptible = (c: Colonist) =>
  c.task === 'idle' || c.task === 'guard' || c.task === 'build' || (c.task === 'hunt' && c.phase === 'muster');

/** Distributes colonists over labor according to the sliders, preferring suitable roles. */
export function allocateLabor(s: GameState) {
  const pool = s.colonists.filter((c) => c.task !== 'wounded' && c.task !== 'train' && c.task !== 'strike');
  const total = LABORS.reduce((n, l) => n + s.labor[l], 0) || 1;
  // Quotas with largest-remainder rounding.
  const raw = LABORS.map((l) => (s.labor[l] / total) * pool.length);
  const quota: Record<Labor, number> = { gather: 0, build: 0, scout: 0, guard: 0, hunt: 0 };
  LABORS.forEach((l, i) => (quota[l] = Math.floor(raw[i]!)));
  let left = pool.length - LABORS.reduce((n, l) => n + quota[l], 0);
  [...LABORS].sort((a, b) => (raw[LABORS.indexOf(b)]! % 1) - (raw[LABORS.indexOf(a)]! % 1)).forEach((l) => {
    if (left > 0 && s.labor[l] > 0) {
      quota[l]++;
      left--;
    }
  });

  // People out in the field keep their job until they return.
  const movable: Colonist[] = [];
  for (const c of pool) {
    if (!interruptible(c) && c.labor) quota[c.labor]--;
    else movable.push(c);
  }
  const pairs: { c: Colonist; l: Labor; v: number }[] = [];
  for (const c of movable) for (const l of LABORS) pairs.push({ c, l, v: FIT[c.role][l] + (c.labor === l ? 0.6 : 0) });
  pairs.sort((a, b) => b.v - a.v || a.c.id - b.c.id);
  const done = new Set<number>();
  for (const { c, l } of pairs) {
    if (done.has(c.id) || quota[l] <= 0) continue;
    done.add(c.id);
    quota[l]--;
    assign(s, c, l);
  }
  // Anyone left over keeps what they had, or gathers.
  for (const c of movable) if (!done.has(c.id)) assign(s, c, c.labor ?? 'gather');
}

function assign(s: GameState, c: Colonist, l: Labor) {
  if (c.labor === l && c.task !== 'idle') return;
  c.labor = l;
  if (atHome(c) || c.task === 'idle') {
    setTask(c, 'idle');
    startLabor(s, c);
  }
}

function dispatchHunters(s: GameState) {
  const musters = s.colonists.filter((c) => c.task === 'hunt' && c.phase === 'muster' && atHome(c));
  if (musters.length < 2) return;
  if (isNight(s) && s.directives.curfew) return;
  let best: number | null = null;
  let bestD = Infinity;
  for (const [id, i] of Object.entries(s.intel)) {
    if (i.kind !== 'nest') continue;
    const d = dist(i) * (i.uncertain ? 1.5 : 1);
    if (d < bestD) {
      bestD = d;
      best = Number(id);
    }
  }
  if (best === null) return;
  const nest = s.intel[best]!;
  const power = musters.reduce((n, c) => n + colonistPower(s, c), 0);
  if (power < nest.amount * 2.2) return;
  for (const c of musters) setTask(c, 'hunt', 'out', nest.x, nest.y, best);
  addLog(s, `${musters.length} hunters set out for the ${sectorName(nest)} nest.`);
}

function startTraining(s: GameState) {
  const active = s.colonists.filter((c) => c.task === 'train').length;
  if (!s.training.length || active >= 2) return;
  const c = s.colonists.find((x) => x.role === 'villager' && interruptible(x) && atHome(x));
  if (!c) return;
  const role = s.training.shift()!;
  setTask(c, 'train');
  c.trainRole = role;
  c.timer = COSTS.train.hours;
  c.labor = null;
}

function completeProjects(s: GameState) {
  const p = s.projects[0];
  if (!p || p.workLeft > 0) return;
  s.projects.shift();
  const st = s.settlement;
  switch (p.spec.kind) {
    case 'wall':
      st.wallLevel++;
      st.wallHp = st.wallHp.map(() => st.wallLevel * WALL_HP);
      addLog(s, `The palisade now stands at level ${st.wallLevel}.`, 'good');
      break;
    case 'tower': {
      // Raise it facing the worst of it.
      const known = s.heart.seen ?? Object.values(s.intel).find((i) => i.kind === 'nest') ?? { x: 1, y: 0 };
      let a = angleOf(known);
      for (let k = 0; k < 8 && st.towers.some((t) => Math.abs(((t - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.5); k++) a += Math.PI / 4;
      st.towers.push(a);
      addLog(s, `A watchtower rises on the ${sectorName({ x: Math.cos(a), y: -Math.sin(a) })} wall.`, 'good');
      break;
    }
    case 'inner':
      st.inner[p.spec.building] = true;
      addLog(s, `The ${INNER_INFO[p.spec.building].label} is finished.`, 'good');
      break;
    case 'equipment':
      st.equipment++;
      addLog(s, `New arms and tools: equipment level ${st.equipment}.`, 'good');
      break;
  }
}

function resolveStrike(s: GameState) {
  const party = s.colonists.filter((c) => c.task === 'strike' && c.phase === 'fight');
  const odds = strikeOdds(s, party);
  if (party.length && chance(s.rng, odds)) {
    s.outcome = 'won';
    s.outcomeText = `On day ${dayOf(s.time)}, ${party.length} of ours reached the heart and broke it. Across the valley the blight begins to fade, and the siege is over.`;
    addLog(s, s.outcomeText, 'good');
    return;
  }
  // Repulsed.
  const n = Math.ceil(party.length / 2);
  for (let i = 0; i < n; i++) {
    const c = pick(s.rng, party.filter((p) => p.hp > 0));
    if (!c) break;
    c.hp = 0;
    s.stats.died++;
  }
  // Everyone still on the strike turns back, including stragglers.
  for (const c of s.colonists) if (c.task === 'strike' && c.hp > 0) goHome(c);
  s.heart.strength += 3;
  addLog(s, `The heart threw back the strike force. ${n} did not come home.`, 'bad');
  s.alert = 'The strike on the heart failed.';
}

/** Advances the simulation by one fixed step. */
export function step(s: GameState) {
  if (s.outcome !== 'playing' || s.event) return;
  const prevHour = s.time;
  s.time += DT;
  s.steps++;
  const crossed = (h: number) => Math.floor((prevHour - h) / 24) !== Math.floor((s.time - h) / 24);

  if (s.dirtyLabor) {
    s.dirtyLabor = false;
    allocateLabor(s);
  }

  // Upkeep.
  const eat = s.colonists.length * (UPKEEP_PER_DAY / 24) * DT * (s.settlement.inner.granary ? 0.67 : 1);
  s.supplies += (s.specials.includes('seedVault') ? 4 / 24 : 0) * DT - eat;
  if (s.supplies < 0) {
    s.supplies = 0;
    s.hunger += DT;
    if (s.hunger >= 12) {
      s.hunger = 0;
      const c = pick(s.rng, s.colonists);
      if (c) {
        c.hp = 0;
        s.stats.died++;
        addLog(s, `There was not enough food. ${c.name} did not wake.`, 'bad');
      }
    }
  } else s.hunger = 0;

  for (const c of s.colonists) stepColonist(s, c);
  stepHorde(s);
  colonistAttacks(s, s.time < s.bellUntil);
  s.colonists = s.colonists.filter((c) => c.hp > 0);
  completeProjects(s);

  if (s.steps % 4 === 0) updateVision(s);

  // Every half hour: idle people pick up their labor again.
  if (s.steps % 10 === 0) {
    for (const c of s.colonists) if (c.task === 'idle' && c.labor && atHome(c)) startLabor(s, c);
    for (const c of s.colonists) if (c.task === 'idle' && !c.labor) s.dirtyLabor = true;
  }
  // Every hour.
  if (s.steps % 20 === 0) {
    dispatchHunters(s);
    startTraining(s);
    s.heart.strength += 0.6 / 24;
  }

  if (crossed(DUSK) && s.directives.curfew) {
    for (const c of s.colonists) if ((c.task === 'gather' || c.task === 'scout') && c.phase !== 'work') goHome(c);
  }
  if (crossed(DAWN)) {
    addLog(s, `Day ${dayOf(s.time)} dawns.`);
    if (chance(s.rng, s.settlement.inner.hearth ? 0.35 : 0.06)) {
      const n = int(s.rng, 1, 3);
      for (let i = 0; i < n; i++) spawnColonist(s, 'villager', (next(s.rng) - 0.5) * 4, (next(s.rng) - 0.5) * 4);
      s.stats.born += n;
      s.dirtyLabor = true;
      addLog(s, `${n} wanderer${n > 1 ? 's' : ''} followed the light of the hearth to us.`, 'good');
    }
    maybeDailyEvent(s);
  }

  if (s.time >= s.nextShift) {
    s.nextShift = s.time + 5 + next(s.rng) * 12;
    const seg = shiftLand(s);
    addLog(s, `The land shifts to the ${SEGMENT_NAMES[seg]}.`);
  }

  if (s.heart.fightTimer > 0) {
    s.heart.fightTimer -= DT;
    if (s.heart.fightTimer <= 0) resolveStrike(s);
  }
  if (moveHeart(s, DT)) {
    s.outcome = 'lost';
    s.outcomeText = `On day ${dayOf(s.time)} the heart of the blight reached the walls. The light of the hearth went out.`;
  }
  if (s.settlement.keepHp <= 0) {
    s.outcome = 'lost';
    s.outcomeText = `On day ${dayOf(s.time)} the keep fell. The valley keeps its silence.`;
  } else if (s.colonists.length === 0) {
    s.outcome = 'lost';
    s.outcomeText = `By day ${dayOf(s.time)} no one was left to tend the hearth.`;
  }
}

// ───────────── Player decisions ─────────────

export function setLabor(s: GameState, l: Labor, value: number) {
  s.labor[l] = Math.max(0, Math.min(100, Math.round(value)));
  s.dirtyLabor = true;
}

export function setDirective<K extends keyof Directives>(s: GameState, k: K, v: Directives[K]) {
  s.directives[k] = v;
}

export function projectCost(s: GameState, spec: ProjectSpec): { supplies: number; work: number } | string {
  const queued = (k: ProjectSpec['kind']) => s.projects.filter((p) => p.spec.kind === k).length;
  const st = s.settlement;
  switch (spec.kind) {
    case 'wall': {
      const lvl = st.wallLevel + queued('wall');
      return lvl >= MAX_WALL ? 'The palisade is as tall as it gets.' : COSTS.wall(lvl);
    }
    case 'tower': {
      const n = st.towers.length + queued('tower');
      return n >= MAX_TOWERS ? 'There are towers on every side already.' : COSTS.tower(n);
    }
    case 'inner':
      if (st.inner[spec.building] || s.projects.some((p) => p.spec.kind === 'inner' && p.spec.building === spec.building)) return 'Already built.';
      return COSTS.inner;
    case 'equipment': {
      const lvl = st.equipment + queued('equipment');
      return lvl >= MAX_EQUIPMENT ? 'Equipment is at its best.' : COSTS.equipment(lvl, st.inner.workshop);
    }
  }
}

export function queueProject(s: GameState, spec: ProjectSpec): string | null {
  const c = projectCost(s, spec);
  if (typeof c === 'string') return c;
  if (s.supplies < c.supplies) return `Needs ${c.supplies} supplies.`;
  s.supplies -= c.supplies;
  s.projects.push({ id: s.nextId++, spec, workLeft: c.work, workTotal: c.work });
  s.dirtyLabor = true;
  return null;
}

export function cancelProject(s: GameState, id: number): string | null {
  const p = s.projects.find((x) => x.id === id);
  if (!p) return 'No such project.';
  s.projects = s.projects.filter((x) => x !== p);
  const c = projectCost(s, p.spec);
  if (typeof c !== 'string') s.supplies += Math.floor(c.supplies / 2);
  return null;
}

export function queueTraining(s: GameState, role: Role): string | null {
  if (role === 'villager') return 'Choose a trade to train.';
  const waiting = s.training.length;
  const villagers = s.colonists.filter((c) => c.role === 'villager' && c.task !== 'train').length;
  if (villagers - waiting <= 0) return 'No untrained villagers left to train.';
  if (s.supplies < COSTS.train.supplies) return `Needs ${COSTS.train.supplies} supplies.`;
  s.supplies -= COSTS.train.supplies;
  s.training.push(role);
  return null;
}

export function cancelTraining(s: GameState, index: number) {
  if (index < 0 || index >= s.training.length) return;
  s.training.splice(index, 1);
  s.supplies += COSTS.train.supplies;
}

export function strikeParty(s: GameState): Colonist[] {
  return s.colonists.filter((c) => isFighter(c) && c.task !== 'wounded' && c.task !== 'train');
}

export function strikeOdds(s: GameState, party: Colonist[] = strikeParty(s)): number {
  const power = party.reduce((n, c) => n + colonistPower(s, c), 0);
  return power / (power + s.heart.strength * 1.6);
}

export function orderStrike(s: GameState): string | null {
  if (!s.heart.seen) return 'Nobody knows where the heart is yet.';
  if (s.colonists.some((c) => c.task === 'strike')) return 'A strike force is already out.';
  const party = strikeParty(s);
  if (!party.length) return 'There are no militia or archers to send.';
  for (const c of party) {
    c.labor = null;
    setTask(c, 'strike', 'out', s.heart.seen.x, s.heart.seen.y);
  }
  addLog(s, `${party.length} fighters march on the heart, last seen in the ${sectorName(s.heart.seen)}. The walls are thinner without them.`, 'info');
  s.dirtyLabor = true;
  return null;
}

export function recallStrike(s: GameState) {
  for (const c of s.colonists) if (c.task === 'strike' && c.phase !== 'fight') goHome(c);
  s.dirtyLabor = true;
}

export function intervene(s: GameState, kind: 'bell' | 'fire'): string | null {
  const wb = s.warband;
  if (!wb || !wb.marching) return 'There is no assault to answer.';
  if (wb.interventions <= 0) return 'No interventions left for this assault.';
  if (kind === 'bell') {
    for (const c of s.colonists) if ((c.task === 'gather' || c.task === 'scout' || (c.task === 'hunt' && c.phase !== 'fight')) && dist(c) > WALL_R) goHome(c);
    s.bellUntil = s.time + 3;
    addLog(s, 'The bell rings out. Everyone in the fields runs for the walls, and the defenders take heart.', 'info');
  } else {
    if (s.supplies < 15) return 'Needs 15 supplies to burn.';
    s.supplies -= 15;
    let hit = 0;
    for (const u of s.horde) if (u.mode !== 'roam' && dist(u) < WALL_R + 10) {
      u.hp -= 3;
      hit++;
    }
    addLog(s, `The outer stores go up in flames. ${hit} of the horde are caught in the fire.`, 'info');
  }
  wb.interventions--;
  return null;
}

export function chooseEvent(s: GameState, option: number) {
  resolveEvent(s, option);
  s.dirtyLabor = true;
}

// ───────────── What the colony believes ─────────────

export interface Forecast {
  text: string;
  detail: string;
  urgent: boolean;
}

export function forecast(s: GameState): Forecast {
  const wb = s.warband;
  if (wb) {
    const dir = assaultDirection(s);
    if (wb.marching && dir) return { text: `Warband attacking from the ${dir}`, detail: `${s.horde.filter((u) => u.mode !== 'roam').length} remain`, urgent: true };
    if (wb.announced) return { text: `Warband gathering in the ${SEGMENT_NAMES[wb.dir]}`, detail: wb.marching ? 'It is on the move.' : 'It will march soon.', urgent: true };
  }
  const { rate } = threatRate(s);
  const hours = wb ? 6 : Math.max(0, (s.threshold - s.threat) / rate) + 14;
  const fresh = freshness(s, 60);
  let u = 0.15 + 0.75 * (1 - fresh);
  if (s.specials.includes('lantern')) u /= 2;
  const lo = Math.max(0, (hours * (1 - u)) / 24);
  const hi = (hours * (1 + u)) / 24;
  const fmt = (d: number) => (d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${d.toFixed(d < 3 ? 1 : 0)}d`);
  return {
    text: lo < 0.3 ? 'Next assault: any time now' : `Next assault in ${fmt(lo)}–${fmt(hi)}`,
    detail: `${Math.round(fresh * 100)}% of nearby land freshly scouted`,
    urgent: lo < 0.5,
  };
}

export function roleCounts(s: GameState): Record<Role, number> {
  const out: Record<Role, number> = { villager: 0, militia: 0, archer: 0, scout: 0, builder: 0 };
  for (const c of s.colonists) out[c.task === 'train' && c.trainRole ? c.role : c.role]++;
  return out;
}

export function laborCounts(s: GameState): Record<Labor, number> {
  const out: Record<Labor, number> = { gather: 0, build: 0, scout: 0, guard: 0, hunt: 0 };
  for (const c of s.colonists) if (c.labor) out[c.labor]++;
  return out;
}

export { ROLE_INFO };
