import type { RngState } from './rng';

export type Role = 'villager' | 'militia' | 'archer' | 'scout' | 'builder';
export type Labor = 'gather' | 'build' | 'scout' | 'guard' | 'hunt';
export type HordeType = 'swarmer' | 'brute' | 'flier';
export type FeatureKind = 'forest' | 'regrowth' | 'ruins' | 'survivors' | 'nest' | 'blight' | 'strange';
export type TaskKind = 'idle' | 'gather' | 'build' | 'scout' | 'guard' | 'hunt' | 'strike' | 'home' | 'train' | 'wounded';
export type InnerBuilding = 'granary' | 'infirmary' | 'workshop' | 'hearth';
export type SpecialId = 'cartographer' | 'bell' | 'seedVault' | 'hearthstone' | 'lantern';

export interface Vec {
  x: number;
  y: number;
}

/** Ground truth about something in the wilds. World units; the colony sits at (0,0). */
export interface Feature extends Vec {
  id: number;
  kind: FeatureKind;
  r: number;
  /** Forest/regrowth/ruins: supplies left. Nest: size. Survivors: people. */
  amount: number;
  /** Nest health while being hunted. */
  hp: number;
  hordeType?: HordeType;
}

/** What the colony remembers about a feature. */
export interface Intel extends Vec {
  kind: FeatureKind;
  r: number;
  amount: number;
  hordeType?: HordeType;
  seenAt: number;
  /** The land shifted in this sector after it was seen. */
  uncertain: boolean;
}

export interface Heart extends Vec {
  strength: number;
  /** Last place the colony saw it, or null. */
  seen: (Vec & { at: number; uncertain: boolean }) | null;
  nextBlight: number;
  nextNest: number;
  /** While a strike force is fighting it. */
  fightTimer: number;
}

export interface Colonist extends Vec {
  id: number;
  name: string;
  role: Role;
  hp: number;
  /** Previous position, for smooth rendering between steps. */
  px: number;
  py: number;
  labor: Labor | null;
  task: TaskKind;
  phase: string;
  tx: number;
  ty: number;
  target: number;
  carry: number;
  timer: number;
  trainRole?: Role;
}

export interface HordeUnit extends Vec {
  id: number;
  type: HordeType;
  hp: number;
  px: number;
  py: number;
  /** roam: guards a nest. gather: warband forming. march/siege: assault. */
  mode: 'roam' | 'gather' | 'march' | 'siege';
  nest: number;
  tx: number;
  ty: number;
}

export type ProjectSpec =
  | { kind: 'wall' }
  | { kind: 'tower' }
  | { kind: 'inner'; building: InnerBuilding }
  | { kind: 'equipment' };

export interface Project {
  id: number;
  spec: ProjectSpec;
  workLeft: number;
  workTotal: number;
}

export interface Settlement {
  wallLevel: number;
  /** Hit points of the 8 wall segments (E, NE, N, NW, W, SW, S, SE). */
  wallHp: number[];
  /** Angles (radians) of watchtowers on the wall. */
  towers: number[];
  inner: Record<InnerBuilding, boolean>;
  equipment: number;
  keepHp: number;
}

export interface Directives {
  /** At dusk, everyone comes home; or they keep working through the night. */
  curfew: boolean;
  /** Everyone at home mans the walls during an assault, or the untrained shelter in the keep. */
  stance: 'walls' | 'shelter';
}

export interface Warband {
  units: number;
  start: number;
  dir: number;
  killed: number;
  lost: number;
  stolen: number;
  interventions: number;
  marching: boolean;
  gatherUntil: number;
  announced: boolean;
}

export interface EventOption {
  label: string;
  hint: string;
}

export interface PendingEvent {
  id: string;
  title: string;
  text: string;
  options: EventOption[];
}

export interface LogEntry {
  t: number;
  text: string;
  tone?: 'good' | 'bad' | 'info';
}

export type Outcome = 'playing' | 'won' | 'lost';

export interface GameState {
  seed: number;
  rng: RngState;
  /** Hours since the start; day 1 starts at hour 0, dawn at 6. */
  time: number;
  steps: number;
  supplies: number;
  colonists: Colonist[];
  horde: HordeUnit[];
  features: Feature[];
  intel: Record<number, Intel>;
  /** Per fog cell: hour last seen (-1 never). */
  fogSeen: number[];
  /** Per fog cell: 1 when the land shifted there since it was last seen. */
  fogStale: number[];
  heart: Heart;
  nextId: number;
  settlement: Settlement;
  projects: Project[];
  training: Role[];
  labor: Record<Labor, number>;
  directives: Directives;
  specials: SpecialId[];
  threat: number;
  threshold: number;
  warband: Warband | null;
  assaults: number;
  nextShift: number;
  event: PendingEvent | null;
  /** Set when something happened the player should look at; the UI pauses. */
  alert: string | null;
  log: LogEntry[];
  outcome: Outcome;
  outcomeText: string;
  stats: { born: number; died: number; gathered: number };
  /** Hours the stores have been empty. */
  hunger: number;
  bellUntil: number;
  /** Set when sliders change so labor is reassigned on the next step. */
  dirtyLabor: boolean;
}
