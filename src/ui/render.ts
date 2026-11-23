import { FOG_N, SEGMENTS, WALL_HP, WALL_R, WORLD_R } from '../core/data';
import type { FeatureKind, GameState, Intel, Vec } from '../core/types';
import { isVisible } from '../core/world';

type Palette = Record<string, string>;
const TOKENS = [
  '--ground-1', '--ground-2', '--ground-3', '--fog', '--night', '--forest', '--forest-2', '--regrowth', '--ruins', '--survivors',
  '--nest', '--blight', '--strange', '--heart', '--wall', '--wall-hurt', '--house', '--keep', '--horde', '--horde-2', '--flier',
  '--c-villager', '--c-militia', '--c-archer', '--c-scout', '--c-builder', '--accent', '--ink',
];

function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const p: Palette = {};
  for (const t of TOKENS) p[t] = cs.getPropertyValue(t).trim() || '#888';
  return p;
}

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Small deterministic RNG for stable decorations. */
function deco(id: number) {
  let s = id * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private fog = document.createElement('canvas');
  private fogImg: ImageData;
  private pal: Palette = readPalette();
  private seed = -1;
  private size = 0;
  private dpr = 1;
  selected: Vec | null = null;
  /** Half-width of the visible world, eased toward what has been explored. */
  private viewR = 45;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fog.width = FOG_N;
    this.fog.height = FOG_N;
    this.fogImg = this.fog.getContext('2d')!.createImageData(FOG_N, FOG_N);
  }

  refreshTheme() {
    this.pal = readPalette();
    this.terrain = null;
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(r.width);
    if (size !== this.size || dpr !== this.dpr) {
      this.size = size;
      this.dpr = dpr;
      this.canvas.width = size * dpr;
      this.canvas.height = size * dpr;
    }
  }

  private buildTerrain(seed: number) {
    const N = 320;
    const c = document.createElement('canvas');
    c.width = N;
    c.height = N;
    const g = c.getContext('2d')!;
    const img = g.createImageData(N, N);
    const c1 = hexToRgb(this.pal['--ground-1']!);
    const c2 = hexToRgb(this.pal['--ground-2']!);
    const c3 = hexToRgb(this.pal['--ground-3']!);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const wx = x / 22;
        const wy = y / 22;
        const n = noise(wx, wy, seed) * 0.55 + noise(wx * 2.3, wy * 2.3, seed + 7) * 0.3 + noise(wx * 6, wy * 6, seed + 13) * 0.15;
        const t = Math.max(0, Math.min(1, (n - 0.25) / 0.5));
        const [a, b, k] = t < 0.5 ? [c1, c2, t * 2] : [c2, c3, (t - 0.5) * 2];
        const i = (y * N + x) * 4;
        img.data[i] = a[0] + (b[0] - a[0]) * k;
        img.data[i + 1] = a[1] + (b[1] - a[1]) * k;
        img.data[i + 2] = a[2] + (b[2] - a[2]) * k;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    this.terrain = c;
    this.seed = seed;
  }

  /** World units → canvas pixels. */
  private get k() {
    return (this.size * this.dpr) / (this.viewR * 2);
  }
  private sx(x: number) {
    return (x + this.viewR) * this.k;
  }

  toWorld(clientX: number, clientY: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.viewR * 2 - this.viewR, y: ((clientY - r.top) / r.height) * this.viewR * 2 - this.viewR };
  }

  /** Fit the camera to the explored land (and the heart, once seen). */
  private updateCamera(s: GameState) {
    let far = 30;
    for (let i = 0; i < s.fogSeen.length; i++) {
      if (s.fogSeen[i]! < 0) continue;
      const x = (i % FOG_N) * (200 / FOG_N) - WORLD_R;
      const y = Math.floor(i / FOG_N) * (200 / FOG_N) - WORLD_R;
      far = Math.max(far, Math.abs(x), Math.abs(y));
    }
    if (s.heart.seen) far = Math.max(far, Math.abs(s.heart.seen.x), Math.abs(s.heart.seen.y));
    const target = Math.min(WORLD_R, far + 10);
    this.viewR += (target - this.viewR) * 0.05;
  }

  draw(s: GameState, alpha: number, now: number) {
    this.resize();
    if (!this.terrain || this.seed !== s.seed) {
      this.buildTerrain(s.seed);
      this.viewR = 45;
    }
    this.updateCamera(s);
    const full = this.size * this.dpr;
    const W = (WORLD_R * 2) * this.k;
    const o = this.sx(-WORLD_R);
    const g = this.ctx;
    const k = this.k;
    const P = this.pal;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = P['--fog']!;
    g.fillRect(0, 0, full, full);
    g.drawImage(this.terrain!, o, o, W, W);

    // Remembered features.
    const drawn = new Set<number>();
    for (const [id, i] of Object.entries(s.intel)) {
      drawn.add(Number(id));
      this.drawFeature(i.kind, i, Number(id), i.uncertain ? 0.45 : 1, now, i);
    }

    // The heart, where it was last seen.
    const h = s.heart;
    const hv = isVisible(s, h);
    const hp = hv ? h : h.seen;
    if (hp) {
      const pulse = 1 + Math.sin(now / 300) * 0.12;
      const unc = !hv && h.seen?.uncertain;
      g.globalAlpha = unc ? 0.45 : 1;
      const grd = g.createRadialGradient(this.sx(hp.x), this.sx(hp.y), 0, this.sx(hp.x), this.sx(hp.y), 9 * k * pulse);
      grd.addColorStop(0, P['--heart']!);
      grd.addColorStop(1, 'transparent');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(this.sx(hp.x), this.sx(hp.y), 9 * k * pulse, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P['--heart']!;
      g.beginPath();
      g.arc(this.sx(hp.x), this.sx(hp.y), 2.6 * k * pulse, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }

    // Fog.
    const d = this.fogImg.data;
    const [fr, fg, fb] = hexToRgb(P['--fog']!);
    for (let i = 0; i < FOG_N * FOG_N; i++) {
      const seen = s.fogSeen[i]!;
      let a = 0.9;
      if (seen >= s.time - 0.3) a = 0;
      else if (seen >= 0) a = s.fogStale[i] ? 0.66 : 0.38;
      d[i * 4] = fr;
      d[i * 4 + 1] = fg;
      d[i * 4 + 2] = fb;
      d[i * 4 + 3] = a * 255;
    }
    this.fog.getContext('2d')!.putImageData(this.fogImg, 0, 0);
    // Soft edges where the browser supports canvas filters.
    if ('filter' in g) g.filter = `blur(${Math.round(W / FOG_N / 1.6)}px)`;
    g.drawImage(this.fog, o, o, W, W);
    if ('filter' in g) g.filter = 'none';

    this.drawColony(s);

    // People.
    for (const c of s.colonists) {
      const x = c.px + (c.x - c.px) * alpha;
      const y = c.py + (c.y - c.py) * alpha;
      g.fillStyle = P[`--c-${c.role}`]!;
      g.globalAlpha = c.task === 'wounded' ? 0.5 : 1;
      g.beginPath();
      g.arc(this.sx(x), this.sx(y), Math.max(1.6, 0.9 * k), 0, Math.PI * 2);
      g.fill();
      if (c.carry > 0.5) {
        g.fillStyle = P['--ruins']!;
        g.beginPath();
        g.arc(this.sx(x) + 0.7 * k, this.sx(y) - 0.7 * k, Math.max(1, 0.45 * k), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // The horde, where it can be seen.
    for (const u of s.horde) {
      if (!isVisible(s, u)) continue;
      const x = this.sx(u.px + (u.x - u.px) * alpha);
      const y = this.sx(u.py + (u.y - u.py) * alpha);
      const r = (u.type === 'brute' ? 1.5 : 1) * Math.max(1.8, 1 * k);
      g.fillStyle = u.type === 'flier' ? P['--flier']! : u.type === 'brute' ? P['--horde-2']! : P['--horde']!;
      g.beginPath();
      if (u.type === 'flier') {
        g.moveTo(x - r, y - r * 0.4);
        g.lineTo(x, y + r * 0.6);
        g.lineTo(x + r, y - r * 0.4);
        g.lineTo(x, y);
      } else {
        g.moveTo(x, y - r);
        g.lineTo(x + r, y + r * 0.8);
        g.lineTo(x - r, y + r * 0.8);
      }
      g.closePath();
      g.fill();
    }

    // Night.
    const hour = s.time % 24;
    let night = 0;
    if (hour >= 19 || hour < 7) {
      const t = hour >= 19 ? Math.min(1, (hour - 19) / 2) : hour < 5 ? 1 : 1 - (hour - 5) / 2;
      night = t * 0.42;
    }
    if (night > 0) {
      g.fillStyle = P['--night']!;
      g.globalAlpha = night;
      g.fillRect(0, 0, full, full);
      g.globalAlpha = 1;
    }

    if (this.selected) {
      g.strokeStyle = P['--accent']!;
      g.lineWidth = 2 * this.dpr;
      g.beginPath();
      g.arc(this.sx(this.selected.x), this.sx(this.selected.y), 8 * k, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private drawFeature(kind: FeatureKind, p: Intel, id: number, alpha: number, now: number, i: Intel) {
    const g = this.ctx;
    const k = this.k;
    const P = this.pal;
    const x = this.sx(p.x);
    const y = this.sx(p.y);
    const rnd = deco(id);
    g.globalAlpha = alpha;
    switch (kind) {
      case 'forest':
      case 'regrowth': {
        const n = kind === 'forest' ? 7 + Math.floor(i.r) : 6;
        for (let j = 0; j < n; j++) {
          const a = rnd() * Math.PI * 2;
          const d = Math.sqrt(rnd()) * i.r;
          const rr = (1.3 + rnd() * 1.3) * k;
          g.fillStyle = kind === 'forest' ? (j % 3 ? P['--forest']! : P['--forest-2']!) : P['--regrowth']!;
          g.beginPath();
          g.arc(x + Math.cos(a) * d * k, y + Math.sin(a) * d * k, rr, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'ruins':
        g.fillStyle = P['--ruins']!;
        for (let j = 0; j < 4; j++) {
          const w = (1.5 + rnd() * 2) * k;
          g.fillRect(x + (rnd() - 0.5) * i.r * 2 * k, y + (rnd() - 0.5) * i.r * 2 * k, w, w * (0.5 + rnd()));
        }
        break;
      case 'survivors': {
        const flick = 0.6 + Math.sin(now / 120 + id) * 0.4;
        g.fillStyle = P['--survivors']!;
        g.globalAlpha = alpha * flick;
        g.beginPath();
        g.arc(x, y, 2.4 * k, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = alpha;
        for (let j = 0; j < i.amount; j++) {
          g.beginPath();
          g.arc(x + Math.cos(j * 2) * 2.2 * k, y + Math.sin(j * 2) * 2.2 * k, 0.8 * k, 0, Math.PI * 2);
          g.fill();
        }
        break;
      }
      case 'nest': {
        const r = (i.r + i.amount * 0.4) * k;
        g.fillStyle = P['--nest']!;
        g.beginPath();
        const spikes = 9;
        for (let j = 0; j <= spikes * 2; j++) {
          const a = (j / (spikes * 2)) * Math.PI * 2 + now / 4000;
          const rr = j % 2 ? r * 0.55 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
        break;
      }
      case 'blight': {
        const grd = g.createRadialGradient(x, y, 0, x, y, i.r * k);
        grd.addColorStop(0, P['--blight']!);
        grd.addColorStop(1, 'transparent');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, i.r * k, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'strange':
        g.strokeStyle = P['--strange']!;
        g.lineWidth = 0.6 * k;
        g.beginPath();
        g.arc(x, y, 2.2 * k, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = P['--strange']!;
        g.beginPath();
        g.arc(x, y, 0.8 * k, 0, Math.PI * 2);
        g.fill();
        break;
    }
    g.globalAlpha = 1;
  }

  private drawColony(s: GameState) {
    const g = this.ctx;
    const k = this.k;
    const P = this.pal;
    const cx = this.sx(0);
    const st = s.settlement;
    // Houses.
    const rnd = deco(s.seed % 1000);
    g.fillStyle = P['--house']!;
    for (let j = 0; j < 14; j++) {
      const a = rnd() * Math.PI * 2;
      const d = 2.5 + rnd() * 4.5;
      g.fillRect(cx + Math.cos(a) * d * k - 0.8 * k, cx + Math.sin(a) * d * k - 0.8 * k, 1.6 * k, 1.4 * k);
    }
    g.fillStyle = P['--keep']!;
    g.fillRect(cx - 1.6 * k, cx - 1.6 * k, 3.2 * k, 3.2 * k);
    // Wall segments.
    if (st.wallLevel > 0) {
      const seg = (Math.PI * 2) / SEGMENTS;
      for (let i = 0; i < SEGMENTS; i++) {
        const hp = st.wallHp[i]! / (st.wallLevel * WALL_HP);
        g.strokeStyle = hp <= 0 ? 'transparent' : hp < 0.5 ? P['--wall-hurt']! : P['--wall']!;
        g.lineWidth = (0.6 + st.wallLevel * 0.45) * k;
        g.beginPath();
        // Segment i centred on angle i*seg (north-up, counter-clockwise); canvas angles run clockwise.
        g.arc(cx, cx, WALL_R * k, -(i * seg + seg / 2) + 0.03, -(i * seg - seg / 2) - 0.03);
        g.stroke();
      }
    }
    // Towers.
    g.fillStyle = P['--keep']!;
    for (const a of st.towers) {
      const x = cx + Math.cos(a) * WALL_R * k;
      const y = cx - Math.sin(a) * WALL_R * k;
      g.fillRect(x - 1.3 * k, y - 1.3 * k, 2.6 * k, 2.6 * k);
    }
  }
}
