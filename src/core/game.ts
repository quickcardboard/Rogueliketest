import { battleRound, composeHorde, dawnLine, equipMult, startBattle } from './battle';
import {
  COSTS,
  DIRS,
  INNER_INFO,
  MAX_EQUIPMENT,
  MAX_SQUAD,
  MAX_WALL,
  RADIUS,
  ROLE_INFO,
  WALL_HP_PER_LEVEL,
} from './data';
import { maybeDailyEvent, resolveEvent, strangeEvent } from './events';
import { chance, dither, int, pick } from './rng';
import { addLog, addSquad, grantSpecial, people } from './state';
import type {
  Dir,
  GameState,
  HordeType,
  Intervention,
  Mission,
  Pos,
  ProjectKind,
  Role,
  SpecialId,
  Squad,
} from './types';
import {
  allPositions,
  dirOfSector,
  dist,
  key,
  moveSource,
  revealArea,
  reveal,
  sectorOf,
  shiftLand,
  towerWatch,
} from './world';

export { newGame, people } from './state';

// ───────────────────────── Helpers ─────────────────────────

export function canAct(s: GameState): boolean {
  return s.outcome === 'playing' && !s.battle && !s.event;
}

export function squadById(s: GameState, id: number): Squad | undefined {
  return s.squads.find((q) => q.id === id);
}

export function expeditionDays(p: Pos): number {
  return dist(p) <= 2 ? 1 : 2;
}

export function upkeep(s: GameState): number {
  // Each squad eats; the granary stretches the stores.
  return Math.ceil(s.squads.length * (s.settlement.inner.granary ? 0.5 : 0.75));
}

export function income(s: GameState): number {
  return s.specials.includes('seedVault') ? 2 : 0;
}

/** Fighting power of a party away from the walls (no tower/wall bonus). */
export function partyPower(s: GameState, squads: Squad[]): number {
  return squads.reduce((p, q) => p + q.health * ROLE_INFO[q.role].power, 0) * equipMult(s);
}

/** Odds of a party succeeding at acting on a target, as the player believes it to be. */
export function actPreview(s: GameState, squads: Squad[], target: Pos): { label: string; odds: number | null; note: string } {
  const intel = s.intel[key(target)];
  const power = partyPower(s, squads);
  if (intel?.source) {
    const odds = power / (power + s.source.strength);
    return {
      label: 'Strike the heart',
      odds,
      note: `The heart's strength is ${Math.round(s.source.strength)}. Failure is costly.${intel.uncertain ? ' The land has shifted since it was seen there.' : ''}`,
    };
  }
  if (!intel) return { label: 'Explore', odds: null, note: 'Unknown land.' };
  switch (intel.kind) {
    case 'nest': {
      const str = intel.amount * 2.5;
      return { label: 'Clear the nest', odds: power / (power + str), note: `Nest size ${intel.amount}.` };
    }
    case 'forage':
    case 'regrowth':
      return { label: 'Gather', odds: null, note: `About ${intel.amount} supplies here.` };
    case 'ruins':
      return { label: 'Salvage', odds: null, note: 'Supplies, maybe something more.' };
    case 'refugees':
      return { label: 'Rescue', odds: null, note: `${intel.amount} survivors.` };
    case 'strange':
      return { label: 'Investigate', odds: null, note: 'Something unusual.' };
    case 'blight':
      return { label: 'Search', odds: null, note: 'Dangerous. Rarely worth it.' };
    default:
      return { label: 'Explore', odds: null, note: 'Quiet land.' };
  }
}

// ───────────────────────── Player actions ─────────────────────────
// Each returns an error string, or null on success.

export function assignSquad(s: GameState, id: number, type: 'guard' | 'work'): string | null {
  if (!canAct(s)) return 'Not now.';
  const q = squadById(s, id);
  if (!q) return 'No such squad.';
  if (q.assignment.type === 'expedition') return 'That squad is away.';
  if (q.assignment.type === 'train') return 'That squad is training.';
  q.assignment = { type };
  return null;
}

export function trainSquad(s: GameState, id: number, role: Role): string | null {
  if (!canAct(s)) return 'Not now.';
  const q = squadById(s, id);
  if (!q) return 'No such squad.';
  if (q.assignment.type === 'expedition' || q.assignment.type === 'train') return 'That squad is busy.';
  if (q.role === role) return 'Already trained in that role.';
  if (s.supplies < COSTS.train.supplies) return 'Not enough supplies.';
  s.supplies -= COSTS.train.supplies;
  q.assignment = { type: 'train', role, daysLeft: COSTS.train.days };
  return null;
}

export function mergeSquads(s: GameState, intoId: number, fromId: number): string | null {
  if (!canAct(s)) return 'Not now.';
  const a = squadById(s, intoId);
  const b = squadById(s, fromId);
  if (!a || !b || a === b) return 'Choose two squads.';
  if ([a, b].some((q) => q.assignment.type === 'expedition' || q.assignment.type === 'train')) return 'Both squads must be home and idle.';
  if (a.health + a.wounded + b.health + b.wounded > MAX_SQUAD) return `A squad holds at most ${MAX_SQUAD}.`;
  a.health += b.health;
  a.wounded += b.wounded;
  s.squads = s.squads.filter((q) => q !== b);
  addLog(s, `${b.name} joins ${a.name}.`);
  return null;
}

export function sendExpedition(s: GameState, ids: number[], target: Pos, mission: Mission): string | null {
  if (!canAct(s)) return 'Not now.';
  if (dist(target) === 0 || dist(target) > RADIUS) return 'Invalid target.';
  const squads = ids.map((id) => squadById(s, id)).filter((q): q is Squad => !!q);
  if (!squads.length) return 'Choose at least one squad.';
  if (squads.some((q) => q.assignment.type === 'expedition' || q.assignment.type === 'train')) return 'A chosen squad is busy.';
  if (squads.some((q) => q.health === 0)) return 'A chosen squad has no one fit to travel.';
  const party = s.nextId++;
  const days = expeditionDays(target);
  for (const q of squads) q.assignment = { type: 'expedition', target: { ...target }, mission, daysLeft: days, party };
  return null;
}

export function recall(s: GameState, id: number): string | null {
  // Squads cannot be recalled once on the road; training can be abandoned.
  if (!canAct(s)) return 'Not now.';
  const q = squadById(s, id);
  if (!q || q.assignment.type !== 'train') return 'Only training can be abandoned.';
  q.assignment = { type: 'guard' };
  return null;
}

export function projectCost(s: GameState, spec: ProjectKind): { supplies: number; work: number } | string {
  const queued = (pred: (p: ProjectKind) => boolean) => s.projects.filter((p) => pred(p.spec)).length;
  switch (spec.kind) {
    case 'wall': {
      const lvl = s.settlement.walls[spec.dir].level + queued((p) => p.kind === 'wall' && p.dir === spec.dir);
      if (lvl >= MAX_WALL) return 'Wall is at its highest.';
      return COSTS.wall(lvl);
    }
    case 'tower':
      if (s.settlement.towers[spec.dir] || queued((p) => p.kind === 'tower' && p.dir === spec.dir)) return 'Already built.';
      return COSTS.tower;
    case 'inner':
      if (s.settlement.inner[spec.building] || queued((p) => p.kind === 'inner' && p.building === spec.building)) return 'Already built.';
      return COSTS.inner;
    case 'equipment': {
      const lvl = s.settlement.equipment + queued((p) => p.kind === 'equipment');
      if (lvl >= MAX_EQUIPMENT) return 'Equipment is at its best.';
      return COSTS.equipment(lvl, s.settlement.inner.workshop);
    }
  }
}

export function queueProject(s: GameState, spec: ProjectKind): string | null {
  if (!canAct(s)) return 'Not now.';
  const cost = projectCost(s, spec);
  if (typeof cost === 'string') return cost;
  if (s.supplies < cost.supplies) return 'Not enough supplies.';
  s.supplies -= cost.supplies;
  s.projects.push({ id: s.nextId++, spec, workLeft: cost.work });
  return null;
}

export function cancelProject(s: GameState, id: number): string | null {
  if (!canAct(s)) return 'Not now.';
  const p = s.projects.find((x) => x.id === id);
  if (!p) return 'No such project.';
  const cost = projectCost({ ...s, projects: s.projects.filter((x) => x !== p) }, p.spec);
  if (typeof cost !== 'string') s.supplies += Math.floor(cost.supplies / 2);
  s.projects = s.projects.filter((x) => x !== p);
  return null;
}

export function setDoctrine(s: GameState, d: Partial<GameState['doctrine']>): string | null {
  if (s.battle) return 'Doctrine is set before the battle.';
  Object.assign(s.doctrine, d);
  return null;
}

export function chooseEvent(s: GameState, option: number) {
  if (!s.event) return;
  resolveEvent(s, option);
  checkOutcome(s);
}

export function battleStep(s: GameState, intervention?: Intervention) {
  if (!s.battle) return;
  if (s.battle.done) {
    // Acknowledge the aftermath.
    s.battle = null;
    s.squads = s.squads.filter((q) => q.health + q.wounded > 0);
    addLog(s, dawnLine(s), 'info');
    checkOutcome(s);
    return;
  }
  battleRound(s, intervention);
  if (s.battle.done) {
    const b = s.battle;
    addLog(s, `Assault from the ${b.dir}: ${b.killed} slain, ${b.lost} lost, ${b.wounded} wounded.`, b.lost > 2 ? 'bad' : 'good');
  }
  checkOutcome(s);
}

// ───────────────────────── Day advance ─────────────────────────

function resolveParty(s: GameState, members: Squad[]) {
  const a = members[0]!.assignment;
  if (a.type !== 'expedition') return;
  const target = a.target;
  const t = s.tiles[key(target)]!;
  const names = members.map((q) => q.name).join(' & ');
  const hasScout = members.some((q) => q.role === 'scout');
  const hurt = (n: number) => {
    for (let i = 0; i < n; i++) {
      const pool = members.filter((q) => q.health > 0);
      if (!pool.length) return;
      const q = pick(s.rng, pool);
      q.health--;
      if (chance(s.rng, 0.4)) q.wounded++;
    }
  };
  const isSource = target.x === s.source.x && target.y === s.source.y;

  if (a.mission === 'scout') {
    const radius = (hasScout ? 2 : 1) + (s.specials.includes('cartographer') ? 1 : 0);
    revealArea(s, target, radius);
    if ((t.kind === 'nest' || t.kind === 'blight' || isSource) && !hasScout && chance(s.rng, 0.3)) {
      hurt(1);
      addLog(s, `${names} were attacked while scouting.`, 'bad');
    }
    if (dist(s.source, target) <= radius) addLog(s, `${names} found the heart of the blight to the ${sectorOf(s.source)}.`, 'info');
    else trailHint(s, target, radius, names);
    addLog(s, `${names} return from scouting to the ${sectorOf(target)}.`);
    return;
  }

  reveal(s, target);
  const power = partyPower(s, members);

  if (isSource) {
    const odds = power / (power + s.source.strength);
    if (chance(s.rng, odds)) {
      s.outcome = 'won';
      s.outcomeText = `${names} reached the heart and broke it. Across the valley, the blight begins to fade. On day ${s.day}, the siege is over.`;
      addLog(s, s.outcomeText, 'good');
    } else {
      hurt(Math.ceil(members.reduce((n, q) => n + q.health, 0) / 2));
      s.source.strength += 2;
      addLog(s, `${names} struck at the heart and were thrown back.`, 'bad');
    }
    return;
  }

  switch (t.kind) {
    case 'forage':
    case 'regrowth': {
      const cap = members.reduce((n, q) => n + q.health * (q.role === 'builder' ? 3 : 2), 0);
      const got = Math.min(cap, t.amount);
      s.supplies += got;
      t.amount -= got;
      if (t.kind === 'forage' && t.amount <= 0) Object.assign(t, { kind: 'empty', amount: 0 });
      addLog(s, `${names} gathered ${got} supplies.`, got > 0 ? 'good' : undefined);
      break;
    }
    case 'ruins': {
      const got = int(s.rng, 8, 18);
      s.supplies += got;
      addLog(s, `${names} salvaged ${got} supplies from the ruins.`, 'good');
      const left = (['cartographer', 'bell', 'seedVault', 'hearthstone', 'lantern'] as SpecialId[]).filter((x) => !s.specials.includes(x));
      if (left.length && chance(s.rng, 0.35)) grantSpecial(s, pick(s.rng, left));
      Object.assign(t, { kind: 'empty', amount: 0 });
      break;
    }
    case 'refugees': {
      const q = addSquad(s, 'militia', t.amount);
      addLog(s, `${names} brought ${t.amount} survivors home. They form squad ${q.name}.`, 'good');
      Object.assign(t, { kind: 'empty', amount: 0 });
      break;
    }
    case 'nest': {
      const str = t.amount * 2.5;
      if (chance(s.rng, power / (power + str))) {
        s.threat = Math.max(0, s.threat - t.amount * 1.5);
        s.supplies += t.amount * 2;
        s.source.strength = Math.max(6, s.source.strength - 1);
        addLog(s, `${names} burned out a nest. Green shoots already push through the ash, and the heart weakens.`, 'good');
        Object.assign(t, { kind: 'regrowth', amount: 4, hordeType: undefined });
      } else {
        hurt(int(s.rng, 1, 2));
        addLog(s, `${names} could not clear the nest and withdrew, bleeding.`, 'bad');
      }
      break;
    }
    case 'blight':
      if (chance(s.rng, hasScout ? 0.15 : 0.35)) {
        hurt(1);
        addLog(s, `The blight bit ${names}.`, 'bad');
      } else addLog(s, `${names} found only grey, dead earth.`);
      trailHint(s, target, 0, names);
      break;
    case 'strange':
      addLog(s, `${names} found something strange.`, 'info');
      Object.assign(t, { kind: 'empty', amount: 0 });
      strangeEvent(s);
      break;
    case 'empty':
      addLog(s, `${names} found quiet land, nothing more.`);
      break;
  }
  reveal(s, target);
}

/** Blight points toward the heart: if any blight was seen, report its direction. */
function trailHint(s: GameState, center: Pos, radius: number, names: string) {
  const sawBlight = allPositions().some((p) => dist(p, center) <= radius && s.tiles[key(p)]!.kind === 'blight');
  if (sawBlight) addLog(s, `${names} saw blight trails leading ${sectorOf(s.source, center)} of the ${sectorOf(center)} wilds.`, 'info');
}

function threatSources(s: GameState): { rate: number; weights: Record<HordeType, number>; main: Pos | null } {
  const weights: Record<HordeType, number> = { swarmer: 1, brute: 0.2, flier: 0.2 };
  let rate = 0.6 + 0.06 * s.day;
  let main: Pos | null = null;
  let best = 0;
  for (const t of Object.values(s.tiles)) {
    if (t.kind !== 'nest') continue;
    const c = t.amount * (dist(t) <= 2 ? 0.5 : 0.25);
    rate += c;
    weights[t.hordeType ?? 'swarmer'] += c;
    if (c > best) {
      best = c;
      main = t;
    }
  }
  const sc = (RADIUS + 1 - dist(s.source)) * 0.4;
  rate += sc;
  if (sc >= best) main = s.source;
  return { rate, weights, main };
}

export interface AssaultEstimate {
  minDays: number;
  maxDays: number;
  dir: Dir | null;
  signs: string[];
  freshness: number;
}

/** What the colony believes about the next assault. Precision depends on fresh intel. */
export function assaultEstimate(s: GameState): AssaultEstimate {
  const { rate, main } = threatSources(s);
  const near = allPositions().filter((p) => dist(p) <= 3);
  const fresh = near.filter((p) => {
    const i = s.intel[key(p)];
    return i && !i.uncertain;
  }).length;
  const freshness = fresh / near.length;
  let u = 0.1 + 0.6 * (1 - freshness);
  if (s.specials.includes('lantern')) u /= 2;
  const est = Math.max(0, (s.threshold - s.threat) / rate);
  const signs: string[] = [];
  let dir: Dir | null = null;
  if (main) {
    const i = s.intel[key(main)];
    if (i && !i.uncertain) dir = dirOfSector(sectorOf(main));
  }
  const ratio = s.threat / s.threshold;
  if (freshness > 0.3) {
    if (ratio > 0.8) signs.push(`Silence in the forests${dir ? ` to the ${dir}` : ''}. Birds have left.`);
    else if (ratio > 0.5) signs.push(`Tracks circle the fields${dir ? ` from the ${dir}` : ''}.`);
  }
  for (const t of Object.values(s.tiles)) {
    const i = s.intel[key(t)];
    if (t.kind === 'nest' && i && !i.uncertain && i.kind === 'nest' && i.amount >= 4) {
      signs.push(`A swollen nest to the ${sectorOf(t)}.`);
      break;
    }
  }
  return {
    minDays: Math.max(0, Math.floor(est * (1 - u))),
    maxDays: Math.ceil(est * (1 + u)) + 1,
    dir,
    signs,
    freshness,
  };
}

export function advanceDay(s: GameState): string | null {
  if (!canAct(s)) return 'Resolve what is in front of you first.';
  s.day++;

  // Upkeep.
  s.supplies += income(s) - upkeep(s);
  if (s.supplies < 0) {
    s.supplies = 0;
    const pool = s.squads.filter((q) => q.health > 0);
    if (pool.length) {
      const q = pick(s.rng, pool);
      q.health--;
      addLog(s, `There was not enough food. Someone in ${q.name} did not wake.`, 'bad');
    }
  }

  // Work.
  let work = s.squads
    .filter((q) => q.assignment.type === 'work')
    .reduce((n, q) => n + q.health * ROLE_INFO[q.role].work, 0);
  while (work > 0 && s.projects.length) {
    const p = s.projects[0]!;
    const used = Math.min(work, p.workLeft);
    p.workLeft -= used;
    work -= used;
    if (p.workLeft <= 0) {
      s.projects.shift();
      completeProject(s, p.spec);
    }
  }
  // Leftover work mends the walls.
  for (const d of DIRS) {
    const w = s.settlement.walls[d];
    const fix = Math.min(work, w.level * WALL_HP_PER_LEVEL - w.hp);
    if (fix > 0) {
      w.hp += fix;
      work -= fix;
    }
  }

  // Training.
  for (const q of s.squads) {
    if (q.assignment.type !== 'train') continue;
    q.assignment.daysLeft--;
    if (q.assignment.daysLeft <= 0) {
      q.role = q.assignment.role;
      q.assignment = { type: 'guard' };
      addLog(s, `${q.name} finished training as ${ROLE_INFO[q.role].label}.`);
    }
  }

  // Expeditions.
  const returning = new Map<number, Squad[]>();
  for (const q of s.squads) {
    if (q.assignment.type !== 'expedition') continue;
    q.assignment.daysLeft--;
    if (q.assignment.daysLeft <= 0) {
      const list = returning.get(q.assignment.party) ?? [];
      list.push(q);
      returning.set(q.assignment.party, list);
    }
  }
  for (const members of returning.values()) {
    resolveParty(s, members);
    for (const q of members) q.assignment = { type: 'guard' };
    if (s.outcome !== 'playing') return null;
  }

  // Healing.
  for (const q of s.squads) {
    const tries = s.specials.includes('hearthstone') ? 2 : 1;
    for (let i = 0; i < tries && q.wounded > 0; i++)
      if (s.settlement.inner.infirmary || chance(s.rng, 0.35)) {
        q.wounded--;
        q.health++;
      }
  }
  s.squads = s.squads.filter((q) => q.health + q.wounded > 0);

  // Wanderers.
  if (chance(s.rng, s.settlement.inner.hearth ? 0.12 : 0.03)) {
    const q = addSquad(s, 'militia', int(s.rng, 2, 3));
    addLog(s, `Wanderers followed the light of the hearth. They form squad ${q.name}.`, 'good');
  }

  // The land moves.
  for (const t of Object.values(s.tiles)) if (t.kind === 'regrowth') t.amount = Math.min(8, t.amount + 1);
  const shifted = shiftLand(s);
  if (shifted.length) addLog(s, `The land shifts to the ${shifted.join(', ')}.`);
  s.source.strength += 0.5;
  if (moveSource(s)) addLog(s, 'A deep tremor rolls through the valley. The heart has moved closer.', 'bad');
  if (dist(s.source) === 0) {
    s.outcome = 'lost';
    s.outcomeText = `On day ${s.day} the heart of the blight reached the colony. The light of the hearth went out.`;
    return null;
  }
  towerWatch(s);

  // Threat.
  const { rate, weights, main } = threatSources(s);
  s.threat += rate;
  if (s.threat >= s.threshold) {
    const dir = main ? dirOfSector(sectorOf(main)) : pick(s.rng, DIRS);
    const horde = composeHorde(s, dither(s.rng, s.threat * 1.3), weights);
    s.battle = startBattle(s, dir, horde);
    s.assaults++;
    s.threat = 0;
    s.threshold = 12 + s.assaults * 2 + int(s.rng, 0, 6);
    addLog(s, `At dusk, the horde comes from the ${dir}.`, 'bad');
  } else maybeDailyEvent(s);

  checkOutcome(s);
  return null;
}

function completeProject(s: GameState, spec: ProjectKind) {
  switch (spec.kind) {
    case 'wall': {
      const w = s.settlement.walls[spec.dir];
      w.level++;
      w.hp = w.level * WALL_HP_PER_LEVEL;
      addLog(s, `The ${spec.dir} wall now stands at level ${w.level}.`, 'good');
      break;
    }
    case 'tower':
      s.settlement.towers[spec.dir] = true;
      addLog(s, `A watchtower rises on the ${spec.dir} side.`, 'good');
      break;
    case 'inner':
      s.settlement.inner[spec.building] = true;
      addLog(s, `The ${INNER_INFO[spec.building].label} is finished.`, 'good');
      break;
    case 'equipment':
      s.settlement.equipment++;
      addLog(s, `New arms and tools: equipment level ${s.settlement.equipment}.`, 'good');
      break;
  }
}

export function checkOutcome(s: GameState) {
  if (s.outcome !== 'playing') return;
  if (s.settlement.keepHp <= 0) {
    s.outcome = 'lost';
    s.outcomeText = `On day ${s.day} the keep fell. The valley keeps its silence.`;
  } else if (people(s) === 0) {
    s.outcome = 'lost';
    s.outcomeText = `By day ${s.day} no one was left to tend the hearth.`;
  }
}

