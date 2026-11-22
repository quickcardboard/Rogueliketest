import type { Dir, HordeType, InnerBuilding, Role, Sector, SpecialId, TileKind } from './types';

export const RADIUS = 4;
export const MAX_SQUAD = 5;
export const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
export const SECTORS: Sector[] = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];

export const ROLE_INFO: Record<Role, { label: string; desc: string; power: number; work: number }> = {
  militia: { label: 'Militia', desc: 'Steady defenders. Strong against brutes.', power: 1.0, work: 1 },
  archer: { label: 'Archers', desc: 'Deadly from towers. Strong against fliers, weak against brutes.', power: 1.1, work: 1 },
  scout: { label: 'Scouts', desc: 'See further, travel safely, poor fighters.', power: 0.6, work: 1 },
  builder: { label: 'Builders', desc: 'Double work; gather more supplies.', power: 0.6, work: 2 },
};

/** Damage multiplier of a role against a horde type. */
export const ROLE_VS: Record<Role, Record<HordeType, number>> = {
  militia: { swarmer: 1.0, brute: 1.5, flier: 0.8 },
  archer: { swarmer: 1.2, brute: 0.6, flier: 1.6 },
  scout: { swarmer: 1.0, brute: 0.7, flier: 1.0 },
  builder: { swarmer: 1.0, brute: 0.8, flier: 0.7 },
};

export const HORDE_INFO: Record<HordeType, { label: string; hp: number; atk: number; cost: number; desc: string }> = {
  swarmer: { label: 'Swarmers', hp: 1, atk: 1, cost: 1, desc: 'Many and weak. Walls hold them.' },
  brute: { label: 'Brutes', hp: 4, atk: 3, cost: 3, desc: 'Smash walls. Militia counter them.' },
  flier: { label: 'Fliers', hp: 2, atk: 1, cost: 2, desc: 'Ignore walls. Archers counter them.' },
};

export const TILE_INFO: Record<TileKind, { label: string; glyph: string; act: string | null }> = {
  empty: { label: 'Quiet land', glyph: '·', act: null },
  forage: { label: 'Forage', glyph: '♣', act: 'Gather' },
  regrowth: { label: 'Regrowth', glyph: '✿', act: 'Gather' },
  ruins: { label: 'Ruins', glyph: '▲', act: 'Salvage' },
  refugees: { label: 'Survivors', glyph: '☺', act: 'Rescue' },
  nest: { label: 'Horde nest', glyph: '✹', act: 'Clear' },
  blight: { label: 'Blight', glyph: '≈', act: 'Search' },
  strange: { label: 'Strange site', glyph: '?', act: 'Investigate' },
};

export const INNER_INFO: Record<InnerBuilding, { label: string; desc: string }> = {
  granary: { label: 'Granary', desc: 'Squads eat a third less.' },
  infirmary: { label: 'Infirmary', desc: 'Wounded recover every day; more casualties survive.' },
  workshop: { label: 'Workshop', desc: 'Equipment upgrades cost half.' },
  hearth: { label: 'Hearth', desc: 'A light in the dark. Wanderers find their way to you.' },
};

export const SPECIAL_INFO: Record<SpecialId, { label: string; desc: string }> = {
  cartographer: { label: 'Old Cartographer', desc: 'Scouting reveals one tile further.' },
  bell: { label: 'Bell of the First Wall', desc: '+1 intervention in every battle.' },
  seedVault: { label: 'Seed Vault', desc: '+2 supplies every day.' },
  hearthstone: { label: 'Hearthstone', desc: 'Wounded recover twice as fast.' },
  lantern: { label: 'Lantern of Dusk', desc: 'Assault warnings are far more precise.' },
};

export const COSTS = {
  wall: (lvl: number) => ({ supplies: 8 * (lvl + 1), work: 5 * (lvl + 1) }),
  tower: { supplies: 10, work: 8 },
  inner: { supplies: 15, work: 10 },
  equipment: (lvl: number, workshop: boolean) => ({
    supplies: Math.ceil((12 * (lvl + 1)) / (workshop ? 2 : 1)),
    work: 6,
  }),
  train: { supplies: 5, days: 2 },
};

export const WALL_HP_PER_LEVEL = 10;
export const MAX_WALL = 3;
export const MAX_EQUIPMENT = 3;
export const KEEP_HP = 30;
export const SOURCE_MOVE_EVERY = 5;

export const SQUAD_NAMES = [
  'Ashford', 'Bramble', 'Cinder', 'Dell', 'Ember', 'Fallow', 'Gale', 'Hollow',
  'Ivy', 'Juniper', 'Kestrel', 'Larch', 'Moss', 'Nettle', 'Oriel', 'Pine',
  'Quill', 'Rowan', 'Sedge', 'Thistle', 'Umber', 'Vale', 'Willow', 'Yarrow',
];
