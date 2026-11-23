import { FOG_N, KEEP_HP, NAMES, ROLE_INFO, SEGMENTS, SPECIAL_INFO, WALL_HP } from './data';
import { int, makeRng, pick } from './rng';
import type { Colonist, GameState, Role, SpecialId } from './types';
import { generateWorld, updateVision } from './world';

export function dayOf(t: number) {
  return Math.floor(t / 24) + 1;
}

export function clock(t: number) {
  const h = Math.floor(t % 24);
  const m = Math.floor(((t % 1) * 60) / 15) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addLog(s: GameState, text: string, tone?: 'good' | 'bad' | 'info') {
  s.log.push({ t: s.time, text, tone });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

export function spawnColonist(s: GameState, role: Role, x = 0, y = 0): Colonist {
  const id = s.nextId++;
  const c: Colonist = {
    id,
    name: NAMES[id % NAMES.length]!,
    role,
    hp: ROLE_INFO[role].hp,
    x,
    y,
    px: x,
    py: y,
    labor: null,
    task: 'idle',
    phase: '',
    tx: x,
    ty: y,
    target: -1,
    carry: 0,
    timer: 0,
  };
  s.colonists.push(c);
  return c;
}

/** Fighting power of one colonist, used for nests and the heart. */
export function colonistPower(s: GameState, c: Colonist): number {
  return ROLE_INFO[c.role].dps * (1 + 0.2 * s.settlement.equipment);
}

export function grantSpecial(s: GameState, id: SpecialId, prefix = 'Found: ') {
  if (s.specials.includes(id)) return;
  s.specials.push(id);
  addLog(s, `${prefix}${SPECIAL_INFO[id].label}. ${SPECIAL_INFO[id].desc}`, 'good');
}

export function grantRandomSpecial(s: GameState, prefix?: string): boolean {
  const left = (Object.keys(SPECIAL_INFO) as SpecialId[]).filter((x) => !s.specials.includes(x));
  if (!left.length) return false;
  grantSpecial(s, pick(s.rng, left), prefix);
  return true;
}

export function newGame(seed: number): GameState {
  const s: GameState = {
    seed,
    rng: makeRng(seed),
    time: 6,
    steps: 0,
    supplies: 40,
    colonists: [],
    horde: [],
    features: [],
    intel: {},
    fogSeen: new Array(FOG_N * FOG_N).fill(-1),
    fogStale: new Array(FOG_N * FOG_N).fill(0),
    heart: { x: 0, y: 0, strength: 20, seen: null, nextBlight: 20, nextNest: 40, fightTimer: 0 },
    nextId: 1,
    settlement: {
      wallLevel: 1,
      wallHp: new Array(SEGMENTS).fill(WALL_HP),
      towers: [],
      inner: { granary: false, infirmary: false, workshop: false, hearth: false },
      equipment: 0,
      keepHp: KEEP_HP,
    },
    projects: [],
    training: [],
    labor: { gather: 40, build: 15, scout: 15, guard: 20, hunt: 10 },
    directives: { curfew: true, stance: 'walls' },
    specials: [],
    threat: 0,
    threshold: 0,
    warband: null,
    assaults: 0,
    nextShift: 10,
    event: null,
    alert: null,
    log: [],
    outcome: 'playing',
    outcomeText: '',
    stats: { born: 0, died: 0, gathered: 0 },
    hunger: 0,
    bellUntil: 0,
    dirtyLabor: true,
  };
  s.threshold = 34 + int(s.rng, 0, 8);
  generateWorld(s);
  const start: Role[] = ['villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'villager', 'militia', 'militia', 'militia', 'archer', 'archer', 'scout', 'scout', 'builder'];
  for (const r of start) spawnColonist(s, r);
  for (const c of s.colonists) {
    c.x = c.px = Math.cos(c.id) * 3;
    c.y = c.py = Math.sin(c.id) * 3;
  }
  updateVision(s);
  addLog(s, 'The valley is changing. Somewhere out there, the heart of the blight is growing toward us. We hold here, and we look for it.', 'info');
  return s;
}
