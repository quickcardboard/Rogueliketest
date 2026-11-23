import type { FeatureKind, HordeType, InnerBuilding, Labor, Role, SpecialId } from './types';

/** World radius in units. The colony is at the centre. */
export const WORLD_R = 100;
export const WALL_R = 9;
export const HOME_R = 6;
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
  build: { label: 'Build', desc: 'Work on construction.' },
  scout: { label: 'Scout', desc: 'Walk into the fog and keep the map fresh. Find survivors.' },
  guard: { label: 'Guard', desc: 'Stay on the walls, ready for an assault.' },
  hunt: { label: 'Hunt', desc: 'Muster and burn out known nests. Heals the land.' },
};

export const HORDE_INFO: Record<HordeType, { label: string; hp: number; dps: number; wallDps: number; speed: number; cost: number }> = {
  swarmer: { label: 'Swarmers', hp: 2, dps: 1.5, wallDps: 2, speed: 6, cost: 1 },
  brute: { label: 'Brutes', hp: 10, dps: 3.5, wallDps: 8, speed: 4.5, cost: 3 },
  flier: { label: 'Fliers', hp: 3, dps: 1.5, wallDps: 0, speed: 9, cost: 2 },
};

/** Damage multiplier of a role against a horde type. */
export const ROLE_VS: Record<Role, Record<HordeType, number>> = {
  villager: { swarmer: 1, brute: 0.6, flier: 0.6 },
  militia: { swarmer: 1, brute: 1.5, flier: 0.8 },
  archer: { swarmer: 1.1, brute: 0.6, flier: 1.7 },
  scout: { swarmer: 1, brute: 0.7, flier: 1 },
  builder: { swarmer: 1, brute: 0.6, flier: 0.6 },
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
  bell: { label: 'Bell of the First Wall', desc: '+1 intervention against every warband.' },
  seedVault: { label: 'Seed Vault', desc: '+4 supplies every day.' },
  hearthstone: { label: 'Hearthstone', desc: 'The wounded recover twice as fast.' },
  lantern: { label: 'Lantern of Dusk', desc: 'Warnings of the next warband are far more precise.' },
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
