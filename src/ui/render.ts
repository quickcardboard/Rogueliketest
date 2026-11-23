import { ARCS, ELEMENT_INFO, FOG_N, PLOT_INFO, RINGS, SEGMENTS, WALL_R, WORLD_R } from '../core/data';
import type { Element, FeatureKind, GameState, Intel, PlotKey, Vec } from '../core/types';
import { arcStart, isVisible } from '../core/world';
import { wallMax } from '../core/state';

type Palette = Record<string, string>;
const TOKENS = [
  '--ground-1', '--ground-2', '--ground-3', '--fog', '--night', '--forest', '--forest-2', '--regrowth', '--ruins', '--survivors',
  '--nest', '--blight', '--strange', '--heart', '--wall', '--wall-hurt', '--house', '--keep', '--horde', '--horde-2', '--flier', '--shade',
  '--c-villager', '--c-militia', '--c-archer', '--c-scout', '--c-builder', '--accent', '--ink', '--plot', '--ring-line',
  '--el-ember', '--el-frost', '--el-mire', '--el-bloom',
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

function deco(id: number) {
  let s = id * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const SHORT: Record<PlotKey, string> = {
  palisade: 'Gate', granary: 'Granary', infirmary: 'Infirmary', workshop: 'Workshop', hearth: 'Hearth', barracks: 'Barracks', lodge: 'Lodge',
  towerNE: 'Tower', towerNW: 'Tower', towerSW: 'Tower', towerSE: 'Tower',
};
const ELEMENT_GLYPH: Record<Element, string> = { ember: '♨', frost: '❄', mire: '≈', bloom: '✿' };

export class MapView {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement | null = null;
  private fog = document.createElement('canvas');
  private fogImg: ImageData;
  private pal: Palette = readPalette();
  private seed = -1;
  private W = 0;
  private H = 0;
  private dpr = 1;
  /** Camera: world point at the centre of the screen, and zoom (1 = fit ~45 units). */
  cx = 0;
  cy = 0;
  zoom = 1;
  selected: Vec | null = null;
  /** Screen inset (CSS px) covered by HUD and toolbar, so "fit" frames the visible part. */
  insetTop = 0;
  insetBottom = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d')!;
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
    const W = Math.round(r.width * dpr);
    const H = Math.round(r.height * dpr);
    if (W !== this.W || H !== this.H) {
      this.W = W;
      this.H = H;
      this.dpr = dpr;
      this.canvas.width = W;
      this.canvas.height = H;
    }
  }

  /** Canvas pixels per world unit. */
  get k() {
    const usable = Math.min(this.W, this.H - (this.insetTop + this.insetBottom) * this.dpr);
    return (Math.max(200, usable) / 90) * this.zoom;
  }
  private get midY() {
    return (this.insetTop * this.dpr + (this.H - this.insetBottom * this.dpr)) / 2;
  }
  private sx(x: number) {
    return (x - this.cx) * this.k + this.W / 2;
  }
  private sy(y: number) {
    return (y - this.cy) * this.k + this.midY;
  }

  toWorld(clientX: number, clientY: number): Vec {
    const r = this.canvas.getBoundingClientRect();
    const px = (clientX - r.left) * this.dpr;
    const py = (clientY - r.top) * this.dpr;
    return { x: (px - this.W / 2) / this.k + this.cx, y: (py - this.midY) / this.k + this.cy };
  }

  pan(dxCss: number, dyCss: number) {
    this.cx -= (dxCss * this.dpr) / this.k;
    this.cy -= (dyCss * this.dpr) / this.k;
    this.clamp();
  }

  zoomAt(factor: number, clientX: number, clientY: number) {
    const before = this.toWorld(clientX, clientY);
    this.zoom = Math.max(0.45, Math.min(6, this.zoom * factor));
    const after = this.toWorld(clientX, clientY);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clamp();
  }

  home() {
    this.cx = 0;
    this.cy = 0;
    this.zoom = 1;
  }

  private clamp() {
    this.cx = Math.max(-WORLD_R, Math.min(WORLD_R, this.cx));
    this.cy = Math.max(-WORLD_R, Math.min(WORLD_R, this.cy));
  }

  /** Building plot under a screen point, if any. */
  plotAt(s: GameState, clientX: number, clientY: number): PlotKey | null {
    const p = this.toWorld(clientX, clientY);
    const reach = Math.max(2.2, 14 / this.k);
    let best: PlotKey | null = null;
    let bd = reach;
    for (const pl of s.plots) {
      const d = Math.hypot(pl.x - p.x, pl.y - p.y);
      if (d < bd) {
        bd = d;
        best = pl.key;
      }
    }
    return best;
  }

  private buildTerrain(seed: number) {
    const N = 400;
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
        const wx = x / 28;
        const wy = y / 28;
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

  draw(s: GameState, alpha: number, now: number) {
    this.resize();
    if (!this.terrain || this.seed !== s.seed) this.buildTerrain(s.seed);
    const g = this.g;
    const k = this.k;
    const P = this.pal;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = P['--fog']!;
    g.fillRect(0, 0, this.W, this.H);
    const o = { x: this.sx(-WORLD_R), y: this.sy(-WORLD_R) };
    const span = WORLD_R * 2 * k;
    g.save();
    g.beginPath();
    g.arc(this.sx(0), this.sy(0), WORLD_R * k, 0, Math.PI * 2);
    g.clip();
    g.drawImage(this.terrain!, o.x, o.y, span, span);
    g.restore();

    for (const [id, i] of Object.entries(s.intel)) this.drawFeature(i.kind, i, Number(id), i.uncertain ? 0.45 : 1, now);

    // Heart.
    const h = s.heart;
    const hv = isVisible(s, h);
    const hp = hv ? h : h.seen;
    if (hp) {
      const pulse = 1 + Math.sin(now / 300) * 0.12;
      g.globalAlpha = !hv && h.seen?.uncertain ? 0.45 : 1;
      const grd = g.createRadialGradient(this.sx(hp.x), this.sy(hp.y), 0, this.sx(hp.x), this.sy(hp.y), 9 * k * pulse);
      grd.addColorStop(0, P['--heart']!);
      grd.addColorStop(1, 'transparent');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(this.sx(hp.x), this.sy(hp.y), 9 * k * pulse, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P['--heart']!;
      g.beginPath();
      g.arc(this.sx(hp.x), this.sy(hp.y), 2.6 * k * pulse, 0, Math.PI * 2);
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
    if ('filter' in g) g.filter = `blur(${Math.max(1, Math.round((span / FOG_N) / 1.6))}px)`;
    g.drawImage(this.fog, o.x, o.y, span, span);
    if ('filter' in g) g.filter = 'none';

    this.drawRings(s);
    this.drawRoute(s);
    this.drawColony(s, now);

    // People.
    for (const c of s.colonists) {
      const x = this.sx(c.px + (c.x - c.px) * alpha);
      const y = this.sy(c.py + (c.y - c.py) * alpha);
      g.fillStyle = P[`--c-${c.role}`]!;
      g.globalAlpha = c.task === 'wounded' ? 0.5 : 1;
      g.beginPath();
      g.arc(x, y, Math.max(2, 0.8 * k), 0, Math.PI * 2);
      g.fill();
      if (c.carry > 0.5) {
        g.fillStyle = P['--ruins']!;
        g.beginPath();
        g.arc(x + 0.7 * k, y - 0.7 * k, Math.max(1.2, 0.4 * k), 0, Math.PI * 2);
        g.fill();
      }
    }
    g.globalAlpha = 1;

    // Horde, where it can be seen.
    for (const u of s.horde) {
      if (!isVisible(s, u)) continue;
      const x = this.sx(u.px + (u.x - u.px) * alpha);
      const y = this.sy(u.py + (u.y - u.py) * alpha);
      const r = (u.type === 'brute' ? 1.5 : 1) * Math.max(2.2, 0.95 * k);
      if (u.fx) {
        g.strokeStyle = u.fx & 4 ? P['--el-bloom']! : u.fx & 1 ? P['--el-ember']! : P['--el-frost']!;
        g.lineWidth = Math.max(1, 0.3 * k);
        g.beginPath();
        g.arc(x, y, r * 1.35, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = u.type === 'shade' ? P['--shade']! : u.type === 'flier' ? P['--flier']! : u.type === 'brute' ? P['--horde-2']! : P['--horde']!;
      g.beginPath();
      if (u.type === 'shade') {
        g.globalAlpha = 0.85;
        g.arc(x, y, r, 0, Math.PI * 2);
      } else if (u.type === 'flier') {
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
      g.globalAlpha = 1;
    }

    // Night.
    const hour = s.time % 24;
    let night = 0;
    if (hour >= 19 || hour < 7) night = (hour >= 19 ? Math.min(1, (hour - 19) / 2) : hour < 5 ? 1 : 1 - (hour - 5) / 2) * 0.45;
    if (night > 0) {
      g.fillStyle = P['--night']!;
      g.globalAlpha = night;
      g.fillRect(0, 0, this.W, this.H);
      g.globalAlpha = 1;
    }

    if (this.selected) {
      g.strokeStyle = P['--accent']!;
      g.lineWidth = 2 * this.dpr;
      g.beginPath();
      g.arc(this.sx(this.selected.x), this.sy(this.selected.y), Math.max(14 * this.dpr, 4 * k), 0, Math.PI * 2);
      g.stroke();
    }
  }

  private annulus(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
    const g = this.g;
    // World angles run counter-clockwise with north up; canvas angles run clockwise.
    g.beginPath();
    g.arc(cx, cy, r1, -a0, -a1, true);
    g.arc(cx, cy, r0, -a1, -a0, false);
    g.closePath();
  }

  private drawRings(s: GameState) {
    const g = this.g;
    const k = this.k;
    const P = this.pal;
    const cx = this.sx(0);
    const cy = this.sy(0);
    const arc = (Math.PI * 2) / ARCS;
    RINGS.forEach((ring, ri) => {
      for (let a = 0; a < ARCS; a++) {
        const el = s.ringIntel[ri]![a];
        const start = arcStart(s, ri, a);
        if (el) {
          g.fillStyle = P[ELEMENT_INFO[el].color]!;
          g.globalAlpha = 0.16;
          this.annulus(cx, cy, ring.inner * k, ring.outer * k, start, start + arc);
          g.fill();
          g.globalAlpha = 0.9;
          const mid = start + arc / 2;
          const rm = ((ring.inner + ring.outer) / 2) * k;
          g.font = `${Math.max(12, Math.min(28, 3.2 * k))}px system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(ELEMENT_GLYPH[el], cx + Math.cos(mid) * rm, cy - Math.sin(mid) * rm);
        }
        // Arc borders.
        g.globalAlpha = 0.35;
        g.strokeStyle = P['--ring-line']!;
        g.lineWidth = Math.max(1, 0.12 * k);
        g.beginPath();
        g.moveTo(cx + Math.cos(start) * ring.inner * k, cy - Math.sin(start) * ring.inner * k);
        g.lineTo(cx + Math.cos(start) * ring.outer * k, cy - Math.sin(start) * ring.outer * k);
        g.stroke();
      }
      g.globalAlpha = 0.4;
      g.strokeStyle = P['--ring-line']!;
      g.setLineDash([4 * this.dpr, 6 * this.dpr]);
      g.beginPath();
      g.arc(cx, cy, ring.outer * k, 0, Math.PI * 2);
      g.stroke();
      if (ri === 0) {
        g.beginPath();
        g.arc(cx, cy, ring.inner * k, 0, Math.PI * 2);
        g.stroke();
      }
      g.setLineDash([]);
      g.globalAlpha = 1;
    });
  }

  private drawRoute(s: GameState) {
    const wb = s.warband;
    if (!wb?.announced) return;
    const g = this.g;
    g.strokeStyle = this.pal['--horde']!;
    g.lineWidth = Math.max(2, 0.35 * this.k);
    g.setLineDash([6 * this.dpr, 6 * this.dpr]);
    g.globalAlpha = 0.8;
    g.beginPath();
    g.moveTo(this.sx(wb.sx), this.sy(wb.sy));
    const d = Math.hypot(wb.sx, wb.sy) || 1;
    g.lineTo(this.sx((wb.sx / d) * WALL_R), this.sy((wb.sy / d) * WALL_R));
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }

  private drawFeature(kind: FeatureKind, i: Intel, id: number, alpha: number, now: number) {
    const g = this.g;
    const k = this.k;
    const P = this.pal;
    const x = this.sx(i.x);
    const y = this.sy(i.y);
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
        g.fillStyle = P['--survivors']!;
        g.globalAlpha = alpha * (0.6 + Math.sin(now / 120 + id) * 0.4);
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
        for (let j = 0; j <= 18; j++) {
          const a = (j / 18) * Math.PI * 2 + now / 4000;
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

  private drawColony(s: GameState, now: number) {
    const g = this.g;
    const k = this.k;
    const P = this.pal;
    const cx = this.sx(0);
    const cy = this.sy(0);
    const st = s.settlement;
    // Houses.
    const rnd = deco(s.seed % 1000);
    g.fillStyle = P['--house']!;
    g.globalAlpha = 0.7;
    for (let j = 0; j < 12; j++) {
      const a = rnd() * Math.PI * 2;
      const d = 3 + rnd() * 7;
      const hx = Math.cos(a) * d;
      const hy = Math.sin(a) * d;
      if (s.plots.some((p) => Math.hypot(p.x - hx, p.y - hy) < 2.6)) continue;
      g.fillRect(this.sx(hx) - 0.7 * k, this.sy(hy) - 0.6 * k, 1.4 * k, 1.2 * k);
    }
    g.globalAlpha = 1;
    g.fillStyle = P['--keep']!;
    g.fillRect(cx - 1.8 * k, cy - 1.8 * k, 3.6 * k, 3.6 * k);
    // Wall.
    if (st.wallLevel > 0) {
      const seg = (Math.PI * 2) / SEGMENTS;
      const max = wallMax(s);
      for (let i = 0; i < SEGMENTS; i++) {
        const hp = st.wallHp[i]! / max;
        if (hp <= 0) continue;
        g.strokeStyle = hp < 0.5 ? P['--wall-hurt']! : P['--wall']!;
        g.lineWidth = (0.5 + st.wallLevel * 0.4) * k;
        g.beginPath();
        g.arc(cx, cy, WALL_R * k, -(i * seg + seg / 2) + 0.04, -(i * seg - seg / 2) - 0.04);
        g.stroke();
      }
    }
    // Plots.
    const queued = new Map<PlotKey, number>();
    s.projects.forEach((p, i) => {
      if (!queued.has(p.spec.plot)) queued.set(p.spec.plot, i);
    });
    const size = 1.7 * k;
    const label = k > 7;
    for (const p of s.plots) {
      const x = this.sx(p.x);
      const y = this.sy(p.y);
      const info = PLOT_INFO[p.key];
      const max = info.levels.length;
      const tower = p.key.startsWith('tower');
      if (p.level > 0 && p.key !== 'palisade') {
        g.fillStyle = tower ? P['--keep']! : P['--plot']!;
        g.fillRect(x - size, y - size, size * 2, size * 2);
        // Level pips.
        g.fillStyle = P['--accent']!;
        for (let l = 0; l < p.level; l++) g.fillRect(x - size + l * 0.8 * k + 0.2 * k, y + size - 0.6 * k, 0.55 * k, 0.4 * k);
      } else if (p.level < max) {
        g.strokeStyle = P['--plot']!;
        g.lineWidth = Math.max(1, 0.18 * k);
        g.setLineDash([3 * this.dpr, 3 * this.dpr]);
        g.strokeRect(x - size, y - size, size * 2, size * 2);
        g.setLineDash([]);
      }
      const qi = queued.get(p.key);
      if (qi !== undefined) {
        const proj = s.projects[qi]!;
        const done = qi === 0 ? 1 - Math.max(0, proj.workLeft) / proj.workTotal : 0;
        g.strokeStyle = P['--accent']!;
        g.lineWidth = Math.max(2, 0.3 * k);
        g.beginPath();
        g.arc(x, y, size * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.04, done));
        g.stroke();
        if (qi > 0) {
          g.fillStyle = P['--accent']!;
          g.font = `bold ${Math.max(10, 1.4 * k)}px system-ui, sans-serif`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(String(qi + 1), x + size * 1.5, y - size * 1.5);
        }
      } else if (p.level < max && Math.floor(now / 700) % 2 === 0 && p.level === 0) {
        g.fillStyle = P['--plot']!;
        g.font = `${Math.max(10, 1.6 * k)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('+', x, y);
      }
      if (label) {
        g.fillStyle = P['--ink']!;
        g.globalAlpha = 0.85;
        g.font = `${Math.max(10, 1.1 * k)}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'top';
        g.fillText(SHORT[p.key], x, y + size + 2);
        g.globalAlpha = 1;
      }
    }
  }
}
