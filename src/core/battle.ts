import { HORDE_INFO, ROLE_INFO, ROLE_VS } from './data';
import { chance, dither, next, pick } from './rng';
import type { Battle, Dir, GameState, HordeType, Intervention, Squad } from './types';

const HORDE_TYPES: HordeType[] = ['swarmer', 'brute', 'flier'];
/** Tuning: fraction of full defender power applied per round, and casualty rate per point of attack. */
const DEF_SCALE = 0.4;
const CASUALTY_RATE = 0.22;

const ROUND_NAMES = ['Dusk', 'Nightfall', 'Deep night', 'Before dawn', 'Dawn'];

export function hordeTotal(h: Record<HordeType, number>): number {
  return h.swarmer + h.brute + h.flier;
}

export function guards(s: GameState): Squad[] {
  return s.squads.filter((q) => q.assignment.type !== 'expedition' && q.health > 0);
}

export function equipMult(s: GameState): number {
  return 1 + 0.2 * s.settlement.equipment;
}

/** Builds the horde from a strength budget, weighted by the nests that fed it. */
export function composeHorde(
  s: GameState,
  budget: number,
  weights: Record<HordeType, number>,
): Record<HordeType, number> {
  const horde: Record<HordeType, number> = { swarmer: 0, brute: 0, flier: 0 };
  const total = weights.swarmer + weights.brute + weights.flier || 1;
  let left = budget;
  let guard = 0;
  while (left >= 1 && guard++ < 500) {
    let x = next(s.rng) * total;
    let t: HordeType = 'swarmer';
    for (const ht of HORDE_TYPES) {
      x -= weights[ht];
      if (x <= 0) {
        t = ht;
        break;
      }
    }
    const cost = HORDE_INFO[t].cost;
    if (cost > left) t = 'swarmer';
    horde[t]++;
    left -= HORDE_INFO[t].cost;
  }
  return horde;
}

export function startBattle(s: GameState, dir: Dir, horde: Record<HordeType, number>): Battle {
  const b: Battle = {
    dir,
    round: 0,
    maxRounds: 4,
    horde,
    interventionsLeft: 1 + (s.specials.includes('bell') ? 1 : 0),
    log: [],
    done: false,
    killed: 0,
    lost: 0,
    wounded: 0,
    suppliesLost: 0,
  };
  b.log.push(
    `The horde comes from the ${dir}: ${HORDE_TYPES.filter((t) => horde[t] > 0)
      .map((t) => `${horde[t]} ${HORDE_INFO[t].label.toLowerCase()}`)
      .join(', ')}.`,
  );
  return b;
}

/** Applies casualties to guard squads, weighted by squad health. */
function casualties(s: GameState, b: Battle, n: number) {
  for (let i = 0; i < n; i++) {
    const pool = guards(s);
    if (pool.length === 0) return;
    const q = pick(s.rng, pool.flatMap((g) => Array<Squad>(g.health).fill(g)));
    q.health--;
    const survive = s.settlement.inner.infirmary ? 0.6 : 0.4;
    if (chance(s.rng, survive)) {
      q.wounded++;
      b.wounded++;
    } else b.lost++;
  }
}

/**
 * Resolves one round of the battle. An optional intervention is applied this round.
 * The simulation is deterministic given the game's RNG state.
 */
export function battleRound(s: GameState, intervention?: Intervention) {
  const b = s.battle;
  if (!b || b.done) return;
  const r = s.rng;
  const name = ROUND_NAMES[b.round] ?? `Round ${b.round + 1}`;
  const wall = s.settlement.walls[b.dir];
  const hold = s.doctrine.line === 'hold';
  const protectPeople = s.doctrine.protect === 'people';

  let powerMult = equipMult(s) * (hold ? 1.15 : 0.9);
  let bonusDamage = 0;

  if (intervention && b.interventionsLeft > 0) {
    b.interventionsLeft--;
    if (intervention === 'bell') {
      powerMult *= 1.6;
      b.log.push(`${name}: The bell rings out. Everyone who can hold a spear stands to.`);
    } else if (intervention === 'fire') {
      const cost = Math.min(8, s.supplies);
      s.supplies -= cost;
      b.suppliesLost += cost;
      bonusDamage = 6 + cost;
      b.log.push(`${name}: You fire the outer stores. The night burns bright.`);
    } else if (intervention === 'retreat') {
      const loss = Math.floor(s.supplies * 0.4);
      s.supplies -= loss;
      b.suppliesLost += loss;
      wall.hp = Math.floor(wall.hp / 2);
      s.threat += hordeTotal(b.horde) * 0.7;
      b.log.push(`${name}: The retreat sounds. Everyone falls back to the keep and the horde ransacks the ${b.dir} district (${loss} supplies lost).`);
      b.done = true;
      return;
    }
  }

  // 1. Defenders strike.
  const def = guards(s);
  const dmg: Record<HordeType, number> = { swarmer: 0, brute: 0, flier: 0 };
  const total = hordeTotal(b.horde);
  for (const q of def) {
    let p = q.health * ROLE_INFO[q.role].power * powerMult * DEF_SCALE;
    if (q.role === 'archer' && s.settlement.towers[b.dir]) p *= 1.5;
    if (wall.hp > 0 && q.role !== 'builder') p *= 1.1;
    for (const t of HORDE_TYPES) if (total > 0) dmg[t] += (p * b.horde[t] * ROLE_VS[q.role][t]) / total;
  }
  if (bonusDamage > 0 && total > 0) for (const t of HORDE_TYPES) dmg[t] += (bonusDamage * b.horde[t]) / total;
  let killedNow = 0;
  for (const t of HORDE_TYPES) {
    const k = Math.min(b.horde[t], dither(r, (dmg[t] / HORDE_INFO[t].hp) * (0.8 + next(r) * 0.4)));
    b.horde[t] -= k;
    killedNow += k;
  }
  b.killed += killedNow;

  // 2. The horde strikes back.
  const melee = b.horde.swarmer * HORDE_INFO.swarmer.atk + b.horde.brute * HORDE_INFO.brute.atk;
  const air = b.horde.flier * HORDE_INFO.flier.atk;
  let through = air;
  if (wall.hp > 0) {
    const wallDmg = b.horde.swarmer * 0.5 + b.horde.brute * 3;
    wall.hp = Math.max(0, wall.hp - Math.round(wallDmg * (hold ? 1 : 1.5)));
    through += melee * 0.25;
  } else through += melee;

  let lostNow = 0;
  if (def.length > 0) {
    const expected = through * CASUALTY_RATE * (hold ? 1.2 : 0.65) * (protectPeople ? 0.75 : 1.2);
    const before = b.lost + b.wounded;
    casualties(s, b, dither(r, expected * (0.7 + next(r) * 0.6)));
    lostNow = b.lost + b.wounded - before;
  } else {
    s.settlement.keepHp = Math.max(0, s.settlement.keepHp - Math.round(through * 0.6));
  }
  const breached = wall.hp === 0 || air > 0;
  if (breached && through > 0) {
    const loss = Math.min(s.supplies, dither(r, through * 0.35 * (protectPeople ? 1.4 : 0.6)));
    s.supplies -= loss;
    b.suppliesLost += loss;
  }

  const remaining = hordeTotal(b.horde);
  b.log.push(
    `${name}: ${killedNow} of the horde fall. ${lostNow ? `${lostNow} defenders struck down. ` : ''}` +
      `${wall.level > 0 ? (wall.hp > 0 ? `The ${b.dir} wall holds (${wall.hp}).` : `The ${b.dir} wall is breached!`) : 'No wall stands here.'}` +
      ` ${remaining} remain.`,
  );

  b.round++;
  if (remaining === 0) {
    b.log.push('The last of them fall. Silence returns to the fields.');
    b.done = true;
  } else if (b.round >= b.maxRounds) {
    b.log.push(`Dawn breaks. The surviving ${remaining} melt back into the wilds. They will return.`);
    s.threat += remaining * 0.5;
    b.done = true;
  } else if (s.settlement.keepHp <= 0) {
    b.done = true;
  }
  if (b.done) b.log.push(`Aftermath: ${b.killed} slain, ${b.lost} of ours lost, ${b.wounded} wounded, ${b.suppliesLost} supplies lost.`);
}

/** Random flavor for the dawn after a battle. */
export function dawnLine(s: GameState): string {
  return pick(s.rng, [
    'Someone plants flowers where the wall was mended.',
    'Children count the arrows they can reuse.',
    'An old song is sung for the ones who did not wake.',
    'The bread tastes of smoke, but there is bread.',
  ]);
}
