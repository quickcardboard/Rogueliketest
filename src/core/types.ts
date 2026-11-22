import type { RngState } from './rng';

export type Role = 'militia' | 'archer' | 'scout' | 'builder';
export type Dir = 'N' | 'E' | 'S' | 'W';
export type Sector = 'E' | 'NE' | 'N' | 'NW' | 'W' | 'SW' | 'S' | 'SE';
export type HordeType = 'swarmer' | 'brute' | 'flier';
export type TileKind =
  | 'empty'
  | 'forage'
  | 'ruins'
  | 'refugees'
  | 'nest'
  | 'blight'
  | 'strange'
  | 'regrowth';

export interface Pos {
  x: number;
  y: number;
}

/** Ground truth for a tile in the wilds. Coordinates are relative to the colony (0,0). */
export interface Tile extends Pos {
  kind: TileKind;
  /** Forage/regrowth: supplies left. Nest: size. Refugees: people. */
  amount: number;
  hordeType?: HordeType;
}

/** What the player believes about a tile. */
export interface Intel {
  kind: TileKind;
  amount: number;
  hordeType?: HordeType;
  /** Day this intel was gathered. */
  day: number;
  /** Set when the land shifted in this tile's sector after the intel was gathered. */
  uncertain: boolean;
  /** The source was seen on this tile when it was scouted. */
  source: boolean;
}

export type Mission = 'scout' | 'act';

export type Assignment =
  | { type: 'guard' }
  | { type: 'work' }
  | { type: 'train'; role: Role; daysLeft: number }
  | { type: 'expedition'; target: Pos; mission: Mission; daysLeft: number; party: number };

export interface Squad {
  id: number;
  name: string;
  role: Role;
  /** Able-bodied people (max 5 together with wounded). */
  health: number;
  wounded: number;
  assignment: Assignment;
}

export type InnerBuilding = 'granary' | 'infirmary' | 'workshop' | 'hearth';

export type ProjectKind =
  | { kind: 'wall'; dir: Dir }
  | { kind: 'tower'; dir: Dir }
  | { kind: 'inner'; building: InnerBuilding }
  | { kind: 'equipment' };

export interface Project {
  id: number;
  spec: ProjectKind;
  workLeft: number;
}

export interface Settlement {
  walls: Record<Dir, { level: number; hp: number }>;
  towers: Record<Dir, boolean>;
  inner: Record<InnerBuilding, boolean>;
  equipment: number;
  keepHp: number;
}

export type SpecialId = 'cartographer' | 'bell' | 'seedVault' | 'hearthstone' | 'lantern';

export interface Source extends Pos {
  strength: number;
  nextMoveDay: number;
}

export type Doctrine = {
  line: 'hold' | 'fallback';
  protect: 'people' | 'stores';
};

export type Intervention = 'bell' | 'fire' | 'retreat';

export interface Battle {
  dir: Dir;
  round: number;
  maxRounds: number;
  horde: Record<HordeType, number>;
  interventionsLeft: number;
  log: string[];
  done: boolean;
  /** Totals for the aftermath summary. */
  killed: number;
  lost: number;
  wounded: number;
  suppliesLost: number;
}

export interface EventOption {
  label: string;
  /** Short preview of costs/odds shown to the player. */
  hint: string;
}

export interface PendingEvent {
  id: string;
  title: string;
  text: string;
  options: EventOption[];
}

export type Outcome = 'playing' | 'won' | 'lost';

export interface GameState {
  seed: number;
  rng: RngState;
  day: number;
  supplies: number;
  squads: Squad[];
  nextId: number;
  settlement: Settlement;
  projects: Project[];
  tiles: Record<string, Tile>;
  intel: Record<string, Intel>;
  source: Source;
  specials: SpecialId[];
  doctrine: Doctrine;
  threat: number;
  threshold: number;
  assaults: number;
  battle: Battle | null;
  event: PendingEvent | null;
  log: { day: number; text: string; tone?: 'good' | 'bad' | 'info' }[];
  outcome: Outcome;
  outcomeText: string;
}
