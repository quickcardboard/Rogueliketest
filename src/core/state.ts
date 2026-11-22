import { KEEP_HP, SOURCE_MOVE_EVERY, SPECIAL_INFO, SQUAD_NAMES, WALL_HP_PER_LEVEL } from './data';
import { int, makeRng } from './rng';
import type { GameState, Role, SpecialId, Squad } from './types';
import { dirOfSector, generateWorld, revealArea, sectorOf } from './world';

export function addLog(s: GameState, text: string, tone?: 'good' | 'bad' | 'info') {
  s.log.push({ day: s.day, text, tone });
}

export function addSquad(s: GameState, role: Role, health: number): Squad {
  const id = s.nextId++;
  const q: Squad = {
    id,
    name: SQUAD_NAMES[(id - 1) % SQUAD_NAMES.length]!,
    role,
    health,
    wounded: 0,
    assignment: { type: 'guard' },
  };
  s.squads.push(q);
  return q;
}

export function grantSpecial(s: GameState, id: SpecialId) {
  if (s.specials.includes(id)) return;
  s.specials.push(id);
  addLog(s, `Found: ${SPECIAL_INFO[id].label}. ${SPECIAL_INFO[id].desc}`, 'good');
}

export function people(s: GameState): number {
  return s.squads.reduce((n, q) => n + q.health + q.wounded, 0);
}

export function newGame(seed: number): GameState {
  const rng = makeRng(seed);
  const world = generateWorld(rng);
  const s: GameState = {
    seed,
    rng,
    day: 1,
    supplies: 30,
    squads: [],
    nextId: 1,
    settlement: {
      walls: { N: { level: 0, hp: 0 }, E: { level: 0, hp: 0 }, S: { level: 0, hp: 0 }, W: { level: 0, hp: 0 } },
      towers: { N: false, E: false, S: false, W: false },
      inner: { granary: false, infirmary: false, workshop: false, hearth: false },
      equipment: 0,
      keepHp: KEEP_HP,
    },
    projects: [],
    tiles: world.tiles,
    intel: {},
    source: { ...world.source, strength: 14, nextMoveDay: SOURCE_MOVE_EVERY + 1 },
    specials: [],
    doctrine: { line: 'hold', protect: 'people' },
    threat: 0,
    threshold: 12 + int(rng, 0, 5),
    assaults: 0,
    battle: null,
    event: null,
    log: [],
    outcome: 'playing',
    outcomeText: '',
  };
  addSquad(s, 'militia', 5);
  addSquad(s, 'militia', 4);
  addSquad(s, 'archer', 4);
  addSquad(s, 'scout', 3);
  addSquad(s, 'builder', 4);
  // One wall section already stands, facing the worst of it.
  const facing = dirOfSector(sectorOf(s.source));
  s.settlement.walls[facing] = { level: 1, hp: WALL_HP_PER_LEVEL };
  revealArea(s, { x: 0, y: 0 }, 1);
  addLog(
    s,
    'The valley is changing. Somewhere out there, the heart of the blight is growing toward us. We hold here, and we look for it.',
    'info',
  );
  return s;
}
