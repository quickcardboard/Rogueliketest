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
  GIFT_INFO,
  POOL_OF,
  ROLE_INFO,
  SEGMENT_NAMES,
  SPECIAL_INFO,
  UPKEEP_PER_DAY,
  WALL_R,
} from './data';
import { maybeDailyEvent, resolveEvent } from './events';
import { assaultDirection, stepHorde, threatRate } from './horde';
import { chance, int, next, pick } from './rng';
import { addLog, colonistPower, dayOf, grantSpecial, spawnColonist, wallMax } from './state';
import type { Boon, Colonist, Directives, GameState, GiftId, Labor, Pool, ProjectSpec, Role, SpecialId } from './types';
import { angleOf, dist, freshness, isNight, moveHeart, sectorName, shiftLand, updateVision } from './world';

export { newGame, dayOf, clock } from './state';

const interruptible = (c: Colonist) => c.task === 'idle' || c.task === 'guard' || c.task === 'build';

/** Who can be given a job right now. */
const available = (c: Colonist) => c.task !== 'wounded' && c.task !== 'train' && c.task !== 'strike' && c.task !== 'hunt';

/** Preference order when choosing who scouts / who builds. */
const SCOUT_PREF: Record<Role, number> = { scout: 3, archer: 2, militia: 1, villager: 0, builder: 0 };
const BUILD_PREF: Record<Role, number> = { builder: 3, villager: 1, scout: 0, archer: 0, militia: 0 };

/**
 * Two pools, one split each. Soldiers guard or scout; workers gather or build.
 * People out in the field keep their job until they return.
 */
export function allocateLabor(s: GameState) {
  split(s, 'military', 'scout', 'guard', s.split.scout / 100, SCOUT_PREF);
  split(s, 'economy', 'build', 'gather', s.split.build / 100, BUILD_PREF);
}

function split(s: GameState, pool: Pool, a: Labor, b: Labor, share: number, pref: Record<Role, number>) {
  const members = s.colonists.filter((c) => POOL_OF[c.role] === pool && available(c));
  let wantA = Math.round(members.length * share);
  // Busy people count toward their current job.
  const movable: Colonist[] = [];
  for (const c of members) {
    if (!interruptible(c) && (c.labor === a || c.labor === b)) {
      if (c.labor === a) wantA--;
    } else movable.push(c);
  }
  movable.sort((x, y) => pref[y.role] - pref[x.role] + (y.labor === a ? 0.5 : 0) - (x.labor === a ? 0.5 : 0) || x.id - y.id);
  movable.forEach((c, i) => assign(s, c, i < wantA ? a : b));
}

function assign(s: GameState, c: Colonist, l: Labor) {
  if (c.labor === l && c.task !== 'idle') return;
  c.labor = l;
  if (atHome(c) || c.task === 'idle') {
    setTask(c, 'idle');
    startLabor(s, c);
  }
}

/** With the hunt directive on and no assault near, guards sally out to burn the nearest known nest. */
function dispatchHunters(s: GameState) {
  if (!s.directives.hunt || s.warband || s.bell) return;
  if (s.threat > s.threshold * 0.75) return;
  if (isNight(s) && s.directives.curfew) return;
  const guards = s.colonists.filter((c) => c.task === 'guard' && atHome(c) && isFighter(c));
  if (guards.length < 2) return;
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
  // Send the strongest few needed; the rest keep the walls.
  guards.sort((x, y) => colonistPower(s, y) - colonistPower(s, x));
  const party: Colonist[] = [];
  let power = 0;
  for (const c of guards) {
    if (power >= nest.amount * 2.6) break;
    party.push(c);
    power += colonistPower(s, c);
  }
  if (power < nest.amount * 2.2 || party.length < 2) return;
  for (const c of party) setTask(c, 'hunt', 'out', nest.x, nest.y, best);
  addLog(s, `${party.length} guards set out to burn the ${sectorName(nest)} nest.`);
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
      st.wallHp = st.wallHp.map(() => wallMax(s));
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
  if (s.outcome !== 'playing' || s.event || s.boon) return;
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
  s.supplies += (s.specials.includes('seedVault') ? 6 / 24 : 0) * DT - eat;
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
  colonistAttacks(s);
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
    s.heart.strength += 0.9 / 24;
  }

  if (crossed(DUSK)) {
    if (s.directives.curfew) for (const c of s.colonists) if ((c.task === 'gather' || c.task === 'scout') && c.phase !== 'work') goHome(c);
    // The end of the day brings a choice.
    s.boon = rollBoons(s);
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

/** Sets the share of soldiers who scout, or of workers who build (0–100). */
export function setSplit(s: GameState, which: 'scout' | 'build', value: number) {
  s.split[which] = Math.max(0, Math.min(100, Math.round(value)));
  s.dirtyLabor = true;
}

/** Rings or silences the bell. While it rings, everyone garrisons the walls. */
export function setBell(s: GameState, on: boolean) {
  if (s.bell === on) return;
  s.bell = on;
  s.dirtyLabor = true;
  if (on) {
    for (const c of s.colonists) if ((c.task === 'gather' || c.task === 'scout' || (c.task === 'hunt' && c.phase !== 'fight')) && dist(c) > WALL_R) goHome(c);
    addLog(s, 'The bell rings out. Everyone drops their work and runs for the walls.', 'info');
  } else addLog(s, 'The bell falls silent. Everyone goes back to work.');
}

// ───────────── End of day ─────────────

function rollBoons(s: GameState): Boon[] {
  const relics = (Object.keys(SPECIAL_INFO) as SpecialId[]).filter((x) => !s.specials.includes(x));
  const gifts = (Object.keys(GIFT_INFO) as GiftId[]).filter((g) => g !== 'forge' || s.settlement.equipment < MAX_EQUIPMENT);
  const out: Boon[] = [];
  if (relics.length) out.push({ kind: 'relic', id: pick(s.rng, relics) });
  while (out.length < 3 && gifts.length) {
    const g = gifts.splice(int(s.rng, 0, gifts.length - 1), 1)[0]!;
    out.push({ kind: 'gift', id: g });
  }
  return out;
}

export function chooseBoon(s: GameState, i: number) {
  const b = s.boon?.[i];
  s.boon = null;
  if (!b) return;
  if (b.kind === 'relic') return grantSpecial(s, b.id as SpecialId, 'You chose a relic: ');
  const g = b.id as GiftId;
  switch (g) {
    case 'cache':
      s.supplies += 30;
      break;
    case 'newcomers':
      for (let k = 0; k < 2; k++) spawnColonist(s, 'villager', (next(s.rng) - 0.5) * 4, (next(s.rng) - 0.5) * 4);
      s.stats.born += 2;
      break;
    case 'veteran':
      spawnColonist(s, 'militia');
      s.stats.born++;
      break;
    case 'pathfinder':
      spawnColonist(s, 'scout');
      s.stats.born++;
      break;
    case 'masons':
      s.settlement.wallHp = s.settlement.wallHp.map(() => wallMax(s));
      if (s.projects[0]) s.projects[0].workLeft -= 20;
      break;
    case 'forge':
      s.settlement.equipment = Math.min(MAX_EQUIPMENT, s.settlement.equipment + 1);
      break;
  }
  addLog(s, `${GIFT_INFO[g].label}: ${GIFT_INFO[g].desc}`, 'good');
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

/** Fire the outer stores: burn supplies to scorch the horde at the walls. */
export function fireStores(s: GameState): string | null {
  const wb = s.warband;
  if (!wb || !wb.marching) return 'There is no assault to answer.';
  if (wb.interventions <= 0) return 'The stores have already burned this assault.';
  const free = s.specials.includes('tinderbox');
  if (!free && s.supplies < 15) return 'Needs 15 supplies to burn.';
  if (!free) s.supplies -= 15;
  let hit = 0;
  for (const u of s.horde)
    if (u.mode !== 'roam' && dist(u) < WALL_R + 10) {
      u.hp -= 3;
      hit++;
    }
  addLog(s, `The outer stores go up in flames. ${hit} of the horde are caught in the fire.`, 'info');
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

/** What people are doing right now. */
export function jobCounts(s: GameState) {
  const out = { gather: 0, build: 0, scout: 0, guard: 0, hunt: 0, strike: 0, wounded: 0, train: 0, military: 0, economy: 0 };
  for (const c of s.colonists) {
    if (c.task === 'hunt') out.hunt++;
    else if (c.task === 'strike') out.strike++;
    else if (c.task === 'wounded') out.wounded++;
    else if (c.task === 'train') out.train++;
    else if (c.labor) out[c.labor]++;
    if (c.task !== 'train') out[POOL_OF[c.role]]++;
  }
  return out;
}

export { ROLE_INFO };
