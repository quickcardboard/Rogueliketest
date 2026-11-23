import type { Element, FeatureKind, GiftId, HordeType, InnerBuilding, Labor, PlotKey, Pool, Role, SpecialId } from './types';

/** World radius in units. The colony is at the centre. */
export const WORLD_R = 100;
export const WALL_R = 13;
export const HOME_R = 9;
/** Fixed simulation step, in hours. */
export const DT = 0.05;
export const DAWN = 6;
export const DUSK = 20;
export const FOG_N = 50;
export const FOG_CELL = (WORLD_R * 2) / FOG_N;
export const SEGMENTS = 8;
export const SEGMENT_NAMES = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

export const ROLE_INFO: Record<Role, { label: string; desc: string; hp: number; speed: number; sight: number; dps: number; range: number; work: number; carry: number; color: string }> = {
  villager: { label: 'Villagers', desc: 'Untrained. Gather and build; weak in a fight.', hp: 2, speed: 7, sight: 9, dps: 0.8, range: 2, work: 1, carry: 5, color: '--c-villager' },
  militia: { label: 'Militia', desc: 'Front-line fighters. Hunt nests, hold breaches.', hp: 4, speed: 7, sight: 9, dps: 3, range: 2.5, work: 0.7, carry: 4, color: '--c-militia' },
  archer: { label: 'Archers', desc: 'Shoot from the walls. Strong against fliers.', hp: 2, speed: 7, sight: 11, dps: 2.4, range: 16, work: 0.7, carry: 4, color: '--c-archer' },
  scout: { label: 'Scouts', desc: 'Fast, see far, avoid danger. Keep the map fresh.', hp: 2, speed: 11, sight: 16, dps: 1, range: 2, work: 0.7, carry: 4, color: '--c-scout' },
  builder: { label: 'Builders', desc: 'Build fast and carry more.', hp: 2, speed: 7, sight: 9, dps: 0.8, range: 2, work: 2, carry: 8, color: '--c-builder' },
};

export const LABOR_INFO: Record<Labor, { label: string; desc: string }> = {
  gather: { label: 'Gather', desc: 'Forage forests and salvage ruins for supplies.' },
  build: { label: 'Build', desc: 'Work on construction and mend the walls.' },
  scout: { label: 'Scout', desc: 'Walk into the fog, keep the map fresh, find survivors.' },
  drill: { label: 'Drill', desc: 'Train at home and grow into veterans. Defend when the horde comes.' },
};

export const POOL_OF: Record<Role, Pool> = { villager: 'economy', builder: 'economy', militia: 'military', archer: 'military', scout: 'military' };

export const HORDE_INFO: Record<HordeType, { label: string; hp: number; dps: number; wallDps: number; speed: number; cost: number }> = {
  swarmer: { label: 'Swarmers', hp: 2, dps: 1.5, wallDps: 2, speed: 6, cost: 1 },
  brute: { label: 'Brutes', hp: 10, dps: 3.5, wallDps: 8, speed: 4.5, cost: 3 },
  flier: { label: 'Fliers', hp: 3, dps: 1.5, wallDps: 0, speed: 9, cost: 2 },
  shade: { label: 'Night stalkers', hp: 3, dps: 2, wallDps: 0, speed: 8.5, cost: 2 },
};

/** Damage multiplier of a role against a horde type. */
export const ROLE_VS: Record<Role, Record<HordeType, number>> = {
  villager: { swarmer: 1, brute: 0.6, flier: 0.6, shade: 0.7 },
  militia: { swarmer: 1, brute: 1.5, flier: 0.8, shade: 1.2 },
  archer: { swarmer: 1.1, brute: 0.6, flier: 1.7, shade: 1 },
  scout: { swarmer: 1, brute: 0.7, flier: 1, shade: 1.3 },
  builder: { swarmer: 1, brute: 0.6, flier: 0.6, shade: 0.7 },
};

export const FEATURE_INFO: Record<FeatureKind, { label: string }> = {
  forest: { label: 'Forest' },
  regrowth: { label: 'Regrowth' },
  ruins: { label: 'Ruins' },
  survivors: { label: 'Survivors' },
  nest: { label: 'Horde nest' },
  blight: { label: 'Blight' },
  strange: { label: 'Strange site' },
};

export const INNER_INFO: Record<InnerBuilding, { label: string; desc: string }> = {
  granary: { label: 'Granary', desc: 'Everyone eats a third less.' },
  infirmary: { label: 'Infirmary', desc: 'The wounded recover in half the time.' },
  workshop: { label: 'Workshop', desc: 'Equipment upgrades cost half.' },
  hearth: { label: 'Hearth', desc: 'A light in the dark. Wanderers find their way to you.' },
};

export const SPECIAL_INFO: Record<SpecialId, { label: string; desc: string }> = {
  cartographer: { label: 'Old Cartographer', desc: 'Everyone sees 40% further.' },
  tinderbox: { label: 'Tinderbox', desc: 'Fire the stores twice per assault, and it costs nothing.' },
  seedVault: { label: 'Seed Vault', desc: '+6 supplies every day.' },
  hearthstone: { label: 'Hearthstone', desc: 'The wounded recover twice as fast.' },
  lantern: { label: 'Lantern of Dusk', desc: 'Warnings of the next warband are far more precise.' },
  ironroot: { label: 'Ironroot Saplings', desc: 'The palisade is 40% sturdier.' },
  greenThumb: { label: 'Green Thumb', desc: 'Gatherers work 30% faster.' },
  warbanner: { label: 'Faded Warbanner', desc: 'Militia, archers and scouts fight 20% harder.' },
};

export const GIFT_INFO: Record<GiftId, { label: string; desc: string }> = {
  cache: { label: 'A Forgotten Cache', desc: '+30 supplies now.' },
  newcomers: { label: 'Newcomers', desc: 'Two villagers join the colony.' },
  veteran: { label: 'A Veteran', desc: 'A seasoned militia fighter joins.' },
  pathfinder: { label: 'A Pathfinder', desc: 'A scout who knows the valley joins.' },
  masons: { label: 'Willing Hands', desc: 'Every wall section is mended, and current construction jumps ahead.' },
  forge: { label: 'Old Steel', desc: 'Equipment improves by one level.' },
};

export const COSTS = {
  wall: (lvl: number) => ({ supplies: 30 * (lvl + 1), work: 30 * (lvl + 1) }),
  tower: (n: number) => ({ supplies: 20 + 10 * n, work: 20 }),
  inner: { supplies: 30, work: 30 },
  equipment: (lvl: number, workshop: boolean) => ({ supplies: Math.ceil((25 * (lvl + 1)) / (workshop ? 2 : 1)), work: 16 }),
  train: { supplies: 6, hours: 12 },
};

export const MAX_WALL = 3;
export const MAX_TOWERS = 4;
export const MAX_EQUIPMENT = 3;
export const WALL_HP = 25;
export const KEEP_HP = 40;
export const UPKEEP_PER_DAY = 1;
export const WOUND_HOURS = 48;

export const NAMES = [
  'Ada', 'Bram', 'Cole', 'Dara', 'Esk', 'Fen', 'Gwen', 'Hal', 'Isla', 'Jory', 'Kit', 'Lark', 'Mabe', 'Nell',
  'Orin', 'Pell', 'Quin', 'Rhea', 'Sol', 'Tam', 'Una', 'Vey', 'Wren', 'Yew', 'Zara', 'Alder', 'Briar', 'Corin',
  'Del', 'Elm', 'Faye', 'Garr', 'Hollis', 'Ives', 'June', 'Kell', 'Linn', 'Moss', 'Nim', 'Oak', 'Pim', 'Rook',
];

// ───────────── Rings ─────────────

export const ARCS = 6;
/** Inner and outer radius of each ring, innermost first. */
export const RINGS: { inner: number; outer: number; name: string }[] = [
  { inner: 18, outer: 36, name: 'Inner ring' },
  { inner: 36, outer: 58, name: 'Middle ring' },
  { inner: 58, outer: 80, name: 'Outer ring' },
];

export const ELEMENT_INFO: Record<Element, { label: string; effect: string; color: string }> = {
  ember: { label: 'Ember', effect: 'Burns swarmers; enrages brutes and fliers.', color: '--el-ember' },
  frost: { label: 'Frost', effect: 'Slows everything that crosses it for the rest of the march.', color: '--el-frost' },
  mire: { label: 'Mire', effect: 'Bogs down walkers while they wade through. Fliers pass over.', color: '--el-mire' },
  bloom: { label: 'Bloom', effect: 'Swells whatever crosses it: half again as tough.', color: '--el-bloom' },
};

// ───────────── Building plots ─────────────

export interface PlotInfo {
  label: string;
  /** What each level does, starting with level 1. */
  levels: string[];
  cost: { supplies: number; work: number }[];
  angle: number;
  r: number;
}

const deg = (d: number) => (d * Math.PI) / 180;
const tower = (angle: number): PlotInfo => ({
  label: 'Watchtower',
  levels: ['Shoots the horde and keeps nearby land in sight.', 'Heavier bows, longer reach.'],
  cost: [{ supplies: 30, work: 25 }, { supplies: 60, work: 40 }],
  angle,
  r: WALL_R,
});

export const PLOT_INFO: Record<PlotKey, PlotInfo> = {
  palisade: { label: 'Palisade', levels: ['A ring of stakes. Holds back walkers; fliers pass over.', 'Timber walls, twice as sturdy.', 'Stone footings, three times as sturdy.'], cost: [{ supplies: 0, work: 0 }, { supplies: 70, work: 60 }, { supplies: 120, work: 90 }], angle: deg(270), r: WALL_R },
  granary: { label: 'Granary', levels: ['Everyone eats a quarter less.', 'Everyone eats almost half less.'], cost: [{ supplies: 35, work: 30 }, { supplies: 70, work: 45 }], angle: deg(30), r: 7 },
  infirmary: { label: 'Infirmary', levels: ['The wounded heal twice as fast; more survive.', 'Three times as fast; most survive.'], cost: [{ supplies: 40, work: 30 }, { supplies: 70, work: 40 }], angle: deg(150), r: 7 },
  workshop: { label: 'Workshop', levels: ['Arms and tools: +20% fighting power.', '+40% fighting power.', '+60% fighting power.'], cost: [{ supplies: 40, work: 30 }, { supplies: 70, work: 40 }, { supplies: 110, work: 60 }], angle: deg(270), r: 6.5 },
  hearth: { label: 'Hearth', levels: ['A light in the dark. Wanderers find their way to you.', 'A great fire. Wanderers come often.'], cost: [{ supplies: 40, work: 30 }, { supplies: 80, work: 50 }], angle: deg(90), r: 4 },
  barracks: { label: 'Barracks', levels: ['Soldiers drill twice as fast.', 'Three times as fast; soldiers are hardier.'], cost: [{ supplies: 45, work: 35 }, { supplies: 90, work: 50 }], angle: deg(210), r: 9.5 },
  lodge: { label: 'Scouts’ Lodge', levels: ['Scouts see 30% further and travel faster.', 'Scouts see 60% further and read the rings from afar.'], cost: [{ supplies: 35, work: 30 }, { supplies: 70, work: 40 }], angle: deg(330), r: 9.5 },
  towerNE: tower(deg(45)),
  towerNW: tower(deg(135)),
  towerSW: tower(deg(225)),
  towerSE: tower(deg(315)),
};
