import { DT, HOME_R, SEGMENTS, WALL_HP, ROLE_INFO, ROLE_VS, WALL_R, WORLD_R, WOUND_HOURS } from './data';
import { triggerStrangeEvent } from './events';
import { chance, next } from './rng';
import { addLog, colonistPower, grantRandomSpecial, spawnColonist } from './state';
import type { Colonist, Feature, GameState, HordeUnit, Vec } from './types';
import { angleOf, dist, fogIndex, isNight, len, sectorName } from './world';

export function mostDamagedSegment(s: GameState): number {
  const max = s.settlement.wallLevel * WALL_HP;
  let best = -1;
  let low = max;
  s.settlement.wallHp.forEach((hp, i) => {
    if (hp < low) {
      low = hp;
      best = i;
    }
  });
  return best;
}

export const isFighter = (c: Colonist) => c.role === 'militia' || c.role === 'archer';
export const atHome = (c: Colonist) => dist(c) <= WALL_R - 0.5;

/** Moves toward (tx,ty); returns true on arrival. */
export function moveTo(c: { x: number; y: number }, tx: number, ty: number, speed: number): boolean {
  const dx = tx - c.x;
  const dy = ty - c.y;
  const d = len(dx, dy);
  const stepLen = speed * DT;
  if (d <= stepLen) {
    c.x = tx;
    c.y = ty;
    return true;
  }
  c.x += (dx / d) * stepLen;
  c.y += (dy / d) * stepLen;
  return false;
}

/** A spot inside the colony, stable per colonist. */
function homeSpot(c: Colonist): Vec {
  const a = (c.id * 2.399) % (Math.PI * 2);
  const r = 1.5 + ((c.id * 7) % 10) / 10 * (HOME_R - 2);
  return { x: Math.cos(a) * r, y: -Math.sin(a) * r };
}

/** A spot on the wall at angle a, spread per colonist. */
function wallSpot(c: Colonist, a: number, inset: number): Vec {
  const jitter = (((c.id * 37) % 21) - 10) / 10 * 0.5;
  const r = WALL_R - inset;
  return { x: Math.cos(a + jitter) * r, y: -Math.sin(a + jitter) * r };
}

export function setTask(c: Colonist, task: Colonist['task'], phase = '', tx = 0, ty = 0, target = -1) {
  c.task = task;
  c.phase = phase;
  c.tx = tx;
  c.ty = ty;
  c.target = target;
  c.timer = 0;
}

export function goHome(c: Colonist) {
  const h = homeSpot(c);
  setTask(c, 'home', 'walk', h.x, h.y);
}

function speedOf(s: GameState, c: Colonist): number {
  return ROLE_INFO[c.role].speed * (c.carry > 0 ? 0.85 : 1) * (isNight(s) ? 0.8 : 1);
}

function feature(s: GameState, id: number): Feature | undefined {
  return s.features.find((f) => f.id === id);
}

/** Damage a colonist; returns true if they fell. */
export function hurt(s: GameState, c: Colonist, dmg: number): boolean {
  c.hp -= dmg;
  if (c.hp > 0) return false;
  const survive = s.settlement.inner.infirmary ? 0.6 : 0.4;
  if (chance(s.rng, survive)) {
    c.hp = 1;
    setTask(c, 'wounded', 'walk');
    c.labor = null;
    c.timer = WOUND_HOURS;
    c.carry = 0;
  } else {
    c.hp = 0;
    s.stats.died++;
    if (s.warband) s.warband.lost++;
    addLog(s, `${c.name} (${ROLE_INFO[c.role].label.toLowerCase().replace(/s$/, '')}) was killed ${dist(c) > WALL_R ? `in the ${sectorName(c)} wilds` : 'defending the colony'}.`, 'bad');
  }
  return true;
}

function nearestHorde(s: GameState, p: Vec, range: number, pred?: (u: HordeUnit) => boolean): HordeUnit | null {
  let best: HordeUnit | null = null;
  let bd = range;
  for (const u of s.horde) {
    if (u.hp <= 0 || (pred && !pred(u))) continue;
    const d = dist(u, p);
    if (d <= bd) {
      bd = d;
      best = u;
    }
  }
  return best;
}

/** True when a warband is close enough that the colony takes up defensive positions. */
export function assaultNear(s: GameState): Vec | null {
  if (!s.warband?.marching) return null;
  let best: HordeUnit | null = null;
  for (const u of s.horde) if (u.mode !== 'roam' && u.hp > 0 && (!best || dist(u) < dist(best))) best = u;
  return best && dist(best) < 45 ? best : null;
}

// ───────────── Task selection ─────────────

function pickGatherTarget(s: GameState, c: Colonist): number {
  let best = -1;
  let bestV = 0;
  for (const [id, i] of Object.entries(s.intel)) {
    if ((i.kind !== 'forest' && i.kind !== 'regrowth' && i.kind !== 'ruins') || i.amount <= 0) continue;
    if (dangerAt(s, i)) continue;
    const d = dist(i, c);
    const v = (Math.min(i.amount, 20) + (i.kind === 'ruins' ? 6 : 0)) / (8 + d) * (i.uncertain ? 0.6 : 1);
    if (v > bestV) {
      bestV = v;
      best = Number(id);
    }
  }
  return best;
}

/** Known nests and blight are dangerous to non-fighters. */
function dangerAt(s: GameState, p: Vec): boolean {
  for (const i of Object.values(s.intel)) {
    if (i.kind === 'nest' && dist(i, p) < i.r + 12) return true;
    if (i.kind === 'blight' && dist(i, p) < i.r + 2) return true;
  }
  return !!(s.heart.seen && dist(s.heart.seen, p) < 16);
}

function pickScoutTarget(s: GameState, c: Colonist): Vec & { target: number } {
  // Survivors and strange sites first.
  for (const [id, i] of Object.entries(s.intel)) {
    if ((i.kind === 'survivors' || i.kind === 'strange') && !s.colonists.some((o) => o !== c && o.target === Number(id) && o.task === 'scout')) {
      return { x: i.x, y: i.y, target: Number(id) };
    }
  }
  // Otherwise, the stalest land.
  let best: Vec = { x: 0, y: 0 };
  let bestV = -1;
  for (let k = 0; k < 40; k++) {
    const a = next(s.rng) * Math.PI * 2;
    const d = 25 + next(s.rng) * (WORLD_R - 30);
    const p = { x: Math.cos(a) * d, y: -Math.sin(a) * d };
    const idx = fogIndex(p.x, p.y);
    const seen = s.fogSeen[idx]!;
    const age = seen < 0 ? 200 : s.fogStale[idx] ? 100 + (s.time - seen) : s.time - seen;
    const v = age / (20 + d * 0.5) * (dangerAt(s, p) ? 0.5 : 1);
    if (v > bestV) {
      bestV = v;
      best = p;
    }
  }
  return { ...best, target: -1 };
}

/** Starts a colonist on their labor. */
export function startLabor(s: GameState, c: Colonist) {
  const night = isNight(s) && s.directives.curfew;
  switch (c.labor) {
    case 'guard': {
      const a = ((c.id * 1.7) % (Math.PI * 2));
      const w = wallSpot(c, a, 0.8);
      return setTask(c, 'guard', '', w.x, w.y);
    }
    case 'build': {
      if (s.projects.length) return setTask(c, 'build', '', (next(s.rng) - 0.5) * 6, (next(s.rng) - 0.5) * 6);
      const seg = mostDamagedSegment(s);
      if (seg >= 0) {
        const a = (seg * Math.PI * 2) / SEGMENTS;
        return setTask(c, 'build', '', Math.cos(a) * (WALL_R - 1.5), -Math.sin(a) * (WALL_R - 1.5));
      }
      // Nothing to build: gather instead.
      return startGather(s, c, night);
    }
    case 'gather':
      return startGather(s, c, night);
    case 'scout': {
      if (night) return;
      const t = pickScoutTarget(s, c);
      return setTask(c, 'scout', 'out', t.x, t.y, t.target);
    }
    case 'hunt':
      return setTask(c, 'hunt', 'muster');
  }
}

function startGather(s: GameState, c: Colonist, night: boolean) {
  if (night) return;
  const t = pickGatherTarget(s, c);
  if (t < 0) return;
  const i = s.intel[t]!;
  setTask(c, 'gather', 'out', i.x, i.y, t);
}

// ───────────── Per-step behaviour ─────────────

export function stepColonist(s: GameState, c: Colonist) {
  c.px = c.x;
  c.py = c.y;
  const spd = speedOf(s, c);
  const assault = assaultNear(s);

  // Non-fighters in the field run home when they see the horde.
  if (dist(c) > WALL_R && c.task !== 'wounded' && c.task !== 'strike' && !(c.task === 'hunt' && c.phase !== 'muster') && c.task !== 'home') {
    const threat = nearestHorde(s, c, ROLE_INFO[c.role].sight * 0.8);
    if (threat) {
      goHome(c);
      c.phase = 'flee';
    }
  }

  switch (c.task) {
    case 'wounded': {
      if (c.phase === 'walk') {
        const h = homeSpot(c);
        if (moveTo(c, h.x, h.y, spd * 0.6)) c.phase = 'rest';
        return;
      }
      const rate = (s.settlement.inner.infirmary ? 2 : 1) * (s.specials.includes('hearthstone') ? 2 : 1);
      c.timer -= DT * rate;
      if (c.timer <= 0) {
        c.hp = ROLE_INFO[c.role].hp;
        setTask(c, 'idle');
      }
      return;
    }
    case 'train':
      c.timer -= DT;
      moveTo(c, 0, 0, spd);
      if (c.timer <= 0) {
        c.role = c.trainRole ?? c.role;
        c.hp = ROLE_INFO[c.role].hp;
        c.labor = null;
        setTask(c, 'idle');
        addLog(s, `${c.name} finished training as one of the ${ROLE_INFO[c.role].label.toLowerCase()}.`);
      }
      return;
    case 'home': {
      if (moveTo(c, c.tx, c.ty, spd)) {
        if (c.carry > 0) deposit(s, c);
        setTask(c, 'idle');
      }
      return;
    }
    case 'idle':
    case 'guard':
    case 'build': {
      if (assault) return defend(s, c, assault);
      if (c.task === 'idle') {
        const h = homeSpot(c);
        moveTo(c, h.x, h.y, spd * 0.5);
        return;
      }
      if (c.task === 'build') {
        const repair = mostDamagedSegment(s);
        if (!s.projects.length && repair < 0) return setTask(c, 'idle');
        if (moveTo(c, c.tx, c.ty, spd)) {
          const work = ROLE_INFO[c.role].work * DT;
          if (s.projects.length) s.projects[0]!.workLeft -= work;
          else s.settlement.wallHp[repair] = Math.min(s.settlement.wallLevel * WALL_HP, s.settlement.wallHp[repair]! + work * 3);
        }
        return;
      }
      moveTo(c, c.tx, c.ty, spd);
      return;
    }
    case 'gather':
      return gather(s, c, spd);
    case 'scout':
      return scout(s, c, spd);
    case 'hunt':
      if (c.phase === 'muster') {
        if (assault) return defend(s, c, assault);
        const w = wallSpot(c, (c.id * 1.3) % (Math.PI * 2), 1);
        moveTo(c, w.x, w.y, spd);
        return;
      }
      return hunt(s, c, spd);
    case 'strike':
      return strike(s, c, spd);
  }
}

function defend(s: GameState, c: Colonist, enemy: Vec) {
  // Anything that got inside the walls is dealt with first.
  if (c.role !== 'archer' && (isFighter(c) || s.directives.stance === 'walls' || c.task === 'guard')) {
    const inside = nearestHorde(s, c, 30, (u) => dist(u) < WALL_R - 0.2);
    if (inside) {
      moveTo(c, inside.x, inside.y, ROLE_INFO[c.role].speed);
      return;
    }
  }
  const a = angleOf(enemy);
  if (!isFighter(c) && s.directives.stance === 'shelter' && c.task !== 'guard') {
    moveTo(c, 0, 0, ROLE_INFO[c.role].speed);
    return;
  }
  const w = wallSpot(c, a, c.role === 'archer' ? 0.6 : 1.6);
  moveTo(c, w.x, w.y, ROLE_INFO[c.role].speed);
}

function deposit(s: GameState, c: Colonist) {
  s.supplies += c.carry;
  s.stats.gathered += c.carry;
  c.carry = 0;
}

function gather(s: GameState, c: Colonist, spd: number) {
  const f = feature(s, c.target);
  if (c.phase === 'out') {
    if (moveTo(c, c.tx, c.ty, spd) || (f && dist(c, f) < f.r * 0.6)) {
      if (!f || f.amount <= 0 || (f.kind !== 'forest' && f.kind !== 'regrowth' && f.kind !== 'ruins')) {
        delete s.intel[c.target];
        return goHome(c);
      }
      c.phase = 'work';
    }
    return;
  }
  if (c.phase === 'work') {
    if (!f) return goHome(c);
    const rate = (c.role === 'builder' ? 2.2 : 1.5) * DT;
    const take = Math.min(rate, f.amount, ROLE_INFO[c.role].carry - c.carry);
    f.amount -= take;
    c.carry += take;
    if (isNight(s) && s.directives.curfew) return goHome(c);
    if (c.carry >= ROLE_INFO[c.role].carry - 1e-6 || f.amount <= 0) {
      if (f.amount <= 0) exhaust(s, f);
      goHome(c);
    }
  }
}

function exhaust(s: GameState, f: Feature) {
  if (f.kind === 'ruins') {
    addLog(s, `The ${sectorName(f)} ruins have been picked clean.`);
    if (chance(s.rng, 0.4)) grantRandomSpecial(s, `Among the last of the ${sectorName(f)} ruins: `);
    s.features = s.features.filter((g) => g !== f);
  } else if (f.kind === 'forest') {
    s.features = s.features.filter((g) => g !== f);
  }
  delete s.intel[f.id];
}

function scout(s: GameState, c: Colonist, spd: number) {
  if (c.phase === 'out') {
    // Divert to survivors or strange sites spotted on the way.
    if (c.target < 0) {
      for (const [id, i] of Object.entries(s.intel)) {
        if ((i.kind === 'survivors' || i.kind === 'strange') && dist(i, c) < ROLE_INFO[c.role].sight) {
          c.target = Number(id);
          c.tx = i.x;
          c.ty = i.y;
          break;
        }
      }
    }
    if (moveTo(c, c.tx, c.ty, spd)) {
      const f = c.target >= 0 ? feature(s, c.target) : undefined;
      if (f && dist(f, c) < f.r + 3) {
        if (f.kind === 'survivors') {
          for (let k = 0; k < f.amount; k++) {
            const n = spawnColonist(s, 'villager', f.x + (next(s.rng) - 0.5) * 3, f.y + (next(s.rng) - 0.5) * 3);
            goHome(n);
          }
          addLog(s, `${c.name} found ${f.amount} survivors in the ${sectorName(f)} and is bringing them home.`, 'good');
          s.stats.born += f.amount;
          s.features = s.features.filter((g) => g !== f);
          delete s.intel[f.id];
        } else if (f.kind === 'strange') {
          s.features = s.features.filter((g) => g !== f);
          delete s.intel[f.id];
          triggerStrangeEvent(s, c);
        }
      } else if (c.target >= 0) delete s.intel[c.target];
      goHome(c);
    }
  }
}

function hunt(s: GameState, c: Colonist, spd: number) {
  const f = feature(s, c.target);
  if (c.phase === 'out') {
    if (!f || f.kind !== 'nest') {
      delete s.intel[c.target];
      return goHome(c);
    }
    if (moveTo(c, f.x, f.y, spd) || dist(c, f) < f.r + 1.5) c.phase = 'fight';
    return;
  }
  if (c.phase === 'fight') {
    if (!f || f.kind !== 'nest') return goHome(c);
    moveTo(c, f.x + Math.cos(c.id) * (f.r + 1), f.y + Math.sin(c.id) * (f.r + 1), spd);
    f.hp -= colonistPower(s, c) * 0.5 * DT;
    // The nest fights back.
    if (chance(s.rng, f.amount * 0.12 * DT)) hurt(s, c, 1);
    if (f.hp <= 0) {
      Object.assign(f, { kind: 'regrowth', amount: 8, hp: 0, hordeType: undefined, r: 5 });
      s.horde = s.horde.filter((u) => !(u.mode === 'roam' && u.nest === f.id));
      s.heart.strength = Math.max(10, s.heart.strength - 1.5);
      s.threat = Math.max(0, s.threat - 6);
      addLog(s, `Hunters burned out the ${sectorName(f)} nest. Green shoots push through the ash, and the heart weakens.`, 'good');
      for (const o of s.colonists) if (o.task === 'hunt' && o.target === f.id) goHome(o);
    }
  }
}

function strike(s: GameState, c: Colonist, spd: number) {
  const h = s.heart;
  if (c.phase === 'out') {
    const sees = dist(h, c) < ROLE_INFO[c.role].sight + 6;
    if (sees) {
      c.tx = h.x;
      c.ty = h.y;
    }
    if (moveTo(c, c.tx, c.ty, spd)) {
      if (dist(h, c) < 6) {
        c.phase = 'fight';
        if (h.fightTimer <= 0) {
          h.fightTimer = 3;
          addLog(s, 'The strike force has reached the heart. The fight begins.', 'info');
        }
      } else {
        c.phase = 'search';
        c.timer = 8;
      }
    }
    return;
  }
  if (c.phase === 'search') {
    c.timer -= DT;
    if (dist(h, c) < ROLE_INFO[c.role].sight + 6) {
      c.phase = 'out';
      c.tx = h.x;
      c.ty = h.y;
      return;
    }
    if (moveTo(c, c.tx, c.ty, spd)) {
      c.tx = c.x + (next(s.rng) - 0.5) * 24;
      c.ty = c.y + (next(s.rng) - 0.5) * 24;
    }
    if (c.timer <= 0) {
      if (s.colonists.every((o) => o.task !== 'strike' || o.phase === 'search')) addLog(s, 'The strike force could not find the heart where it was last seen, and turns for home.', 'bad');
      goHome(c);
    }
    return;
  }
  if (c.phase === 'fight') moveTo(c, h.x + Math.cos(c.id) * 3, h.y + Math.sin(c.id) * 3, spd);
}

// ───────────── Combat ─────────────

export function colonistAttacks(s: GameState, bell: boolean) {
  for (const c of s.colonists) {
    if (c.hp <= 0 || c.task === 'wounded' || c.task === 'train') continue;
    const info = ROLE_INFO[c.role];
    const onWall = dist(c) < WALL_R + 1;
    const range = c.role === 'archer' && onWall ? info.range : Math.min(info.range, 4);
    // Non-fighters in the field don't pick fights.
    if (!onWall && !isFighter(c) && c.task !== 'hunt' && c.task !== 'strike') continue;
    const u = nearestHorde(s, c, range);
    if (!u) continue;
    const dmg = info.dps * ROLE_VS[c.role][u.type] * (1 + 0.2 * s.settlement.equipment) * (bell ? 1.5 : 1) * (onWall ? 1.15 : 1) * DT;
    u.hp -= dmg;
  }
  for (const a of s.settlement.towers) {
    const p = { x: Math.cos(a) * WALL_R, y: -Math.sin(a) * WALL_R };
    const u = nearestHorde(s, p, 22);
    if (u) u.hp -= 2.5 * DT;
  }
}
