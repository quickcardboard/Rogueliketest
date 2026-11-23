import { ARCS, COSTS, DT, ELEMENT_INFO, FEATURE_INFO, GIFT_INFO, PLOT_INFO, RINGS, ROLE_INFO, SPECIAL_INFO } from '../core/data';
import {
  cancelProject,
  cancelTraining,
  chooseBoon,
  chooseEvent,
  clock,
  dayOf,
  fireStores,
  forecast,
  hurryProject,
  jobCounts,
  newGame,
  orderStrike,
  projectCost,
  queueProject,
  queueTraining,
  recallStrike,
  roleCounts,
  routeFrom,
  setBell,
  setDirective,
  setSplit,
  step,
  strikeOdds,
  strikeParty,
} from '../core/sim';
import { plotLevel, veterancy } from '../core/state';
import type { Element, GameState, GiftId, PlotKey, Role, SpecialId, Vec } from '../core/types';
import { dist, sectorName } from '../core/world';
import { MapView } from './render';

const SAVE_KEY = 'holdfast-sim-v3';
const HELP_KEY = 'holdfast-sim-help-v3';
/** Real seconds per in-game day at 1×. */
const SECONDS_PER_DAY = 40;

type Sheet = 'orders' | 'build' | 'people' | 'rings' | 'log' | `plot:${PlotKey}` | null;
let s: GameState = load() ?? newGame(randomSeed());
let speed = 1;
let paused = true;
let sheet: Sheet = null;
let showHelp = false;
let confirmStrike = false;
let toast = '';
let toastTimer = 0;
let info: { at: Vec; html: string } | null = null;
let dragging = false;
let lastSheet = '';
let lastHud = '';

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}
function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const g = raw ? (JSON.parse(raw) as GameState) : null;
    return g && g.plots && g.rings ? g : null;
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* play on without saving */
  }
}

// ───────────── Shell ─────────────

const app = document.getElementById('app')!;
app.innerHTML = `
  <canvas id="map" aria-label="Map of the valley. Drag to move, pinch or scroll to zoom, tap to inspect."></canvas>
  <header class="hud" id="hud"></header>
  <div class="map-tools">
    <button data-zoom="in" aria-label="Zoom in">+</button>
    <button data-zoom="out" aria-label="Zoom out">−</button>
    <button data-zoom="home" aria-label="Centre on the colony">⌂</button>
  </div>
  <div class="inspect" id="info" hidden></div>
  <section class="sheet" id="sheet" hidden></section>
  <nav class="toolbar" id="toolbar">
    <button data-sheet="orders"><span class="ic">⚑</span>Orders</button>
    <button data-sheet="build"><span class="ic">⌂</span>Build</button>
    <button data-sheet="people"><span class="ic">☺</span>People</button>
    <button data-sheet="rings"><span class="ic">◎</span>Rings</button>
    <button data-sheet="log"><span class="ic">☰</span>Log</button>
    <button id="bell" class="bell-btn" data-act="bell-toggle" aria-label="Ring the bell"><span class="ic"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2a1.5 1.5 0 0 1 1.5 1.5v.6A6.5 6.5 0 0 1 18.5 10.5v4l2 2.5v1H3.5v-1l2-2.5v-4A6.5 6.5 0 0 1 10.5 4.1v-.6A1.5 1.5 0 0 1 12 2zm-2.5 17h5a2.5 2.5 0 0 1-5 0z"/></svg></span>Bell</button>
  </nav>
  <div id="modal"></div>
  <div id="toast" class="toast" role="status" hidden></div>`;

const canvas = document.getElementById('map') as HTMLCanvasElement;
const view = new MapView(canvas);
const $ = (id: string) => document.getElementById(id)!;

// ───────────── Content ─────────────

const pct = (x: number) => `${Math.round(x * 100)}%`;

function hudHtml() {
  const pop = s.colonists.length;
  const night = s.time % 24 >= 20 || s.time % 24 < 6;
  const food = pop * [1, 0.75, 0.55][plotLevel(s, 'granary')]!;
  const f = forecast(s);
  return `
    <div class="hud-row">
      <div class="chip"><span class="k">Day ${dayOf(s.time)}</span><b>${clock(s.time)} ${night ? '☾' : '☀'}</b></div>
      <div class="chip"><span class="k">Supplies</span><b>${Math.floor(s.supplies)}</b><small>−${food.toFixed(0)}/d</small></div>
      <div class="chip"><span class="k">People</span><b>${pop}</b></div>
      <div class="chip"><span class="k">Keep</span><b class="${s.settlement.keepHp < 20 ? 'bad' : ''}">${Math.ceil(s.settlement.keepHp)}</b></div>
      <div class="grow"></div>
      <div class="speeds">
        <button id="pause" class="primary" aria-label="${paused ? 'Play' : 'Pause'}">${paused ? '▶' : '❚❚'}</button>
        ${[1, 2, 4].map((n) => `<button data-speed="${n}" class="${!paused && speed === n ? 'on' : ''}">${n}×</button>`).join('')}
        <button data-act="help" aria-label="How to play">?</button>
      </div>
    </div>
    <div class="forecast ${f.urgent ? 'urgent' : ''}">${f.text}<span>${f.detail}</span></div>`;
}

/** A two-sided slider: the filled (left) side is the left job's share. */
function splitSlider(which: 'scout' | 'build', left: string, right: string, nLeft: number, nRight: number) {
  const leftShare = 100 - s.split[which];
  return `<div class="split ${s.bell ? 'paused' : ''}">
    ${s.bell ? '<p class="hint info">On hold while the bell rings.</p>' : ''}
    <div class="ends"><span><b>${nLeft}</b> ${left} · ${leftShare}%</span><span>${100 - leftShare}% · ${right} <b>${nRight}</b></span></div>
    <input type="range" id="split-${which}" min="0" max="100" step="5" value="${leftShare}" data-split="${which}" aria-label="${left} versus ${right}">
  </div>`;
}

function ordersSheet() {
  const j = jobCounts(s);
  const rc = roleCounts(s);
  const wb = s.warband;
  const striking = s.colonists.filter((c) => c.task === 'strike');
  const party = strikeParty(s);
  const odds = strikeOdds(s, party);
  const seen = s.heart.seen;
  let heart: string;
  if (striking.length) {
    heart = `<p>${striking.length} fighters are out on the strike${s.heart.fightTimer > 0 ? ', fighting the heart now' : ''}.</p><button data-act="recall">Call them back</button>`;
  } else if (!seen) {
    heart = '<p class="hint">Nobody has seen the heart yet. It lies beyond the rings, where the blight is thickest.</p>';
  } else {
    const age = s.time - seen.at;
    heart = `<p>Last seen in the <b>${sectorName(seen)}</b>, ${Math.round(dist(seen))} paces out, ${age < 1 ? 'in sight now' : `${Math.round(age)}h ago`}${seen.uncertain ? ' <span class="bad">(it may have moved)</span>' : ''}. Strength ${Math.round(s.heart.strength)}.</p>
      ${
        confirmStrike
          ? `<div class="confirm"><p>Send all <b>${party.length}</b> militia and archers? The walls will be thin while they are gone.</p>
             <div class="row"><button class="danger" data-act="strike-go">March · ${pct(odds)} chance</button><button data-act="strike-cancel">Not yet</button></div></div>`
          : `<button class="danger" data-act="strike" ${party.length ? '' : 'disabled'}>Strike the heart · ${pct(odds)}</button>`
      }`;
  }
  const away = [j.hunt ? `${j.hunt} hunting a nest` : '', j.strike ? `${j.strike} on the strike` : '', j.wounded ? `${j.wounded} wounded` : '', j.train ? `${j.train} training` : '']
    .filter(Boolean)
    .join(' · ');
  return `
    ${
      wb?.marching
        ? `<div class="card urgent"><h3>Under attack</h3>
           <div class="row"><button data-act="fire" ${wb.interventions && (s.specials.includes('tinderbox') || s.supplies >= 15) ? '' : 'disabled'}>Fire the stores</button>
           <span class="hint grow">${s.specials.includes('tinderbox') ? 'Free with the Tinderbox' : 'Burn 15 supplies'} to scorch the horde at the walls. ${wb.interventions} left.</span></div></div>`
        : ''
    }
    <div class="card"><h3>Military · ${rc.militia + rc.archer + rc.scout}</h3>
      <p class="hint">Militia, archers and scouts. Drilling soldiers grow into veterans and still defend when the horde comes. Scouts go out first.</p>
      ${splitSlider('scout', 'drilling', 'scouting', j.drill, j.scout)}
      <div class="row"><span class="grow">When it is quiet, soldiers</span>
        <button class="small ${s.directives.hunt ? 'on' : ''}" data-act="hunt" data-v="1">Hunt nests</button>
        <button class="small ${!s.directives.hunt ? 'on' : ''}" data-act="hunt" data-v="0">Stay home</button></div>
    </div>
    <div class="card"><h3>Economy · ${rc.villager + rc.builder}</h3>
      <p class="hint">Villagers and builders. Builders go to construction first; with nothing to build they mend walls or gather.</p>
      ${splitSlider('build', 'gathering', 'building', j.gather, j.build)}
    </div>
    <div class="card"><h3>After dark</h3>
      <div class="row"><span class="grow">At nightfall, everyone</span>
        <button class="small ${s.directives.curfew ? 'on' : ''}" data-act="curfew" data-v="1">Comes home</button>
        <button class="small ${!s.directives.curfew ? 'on' : ''}" data-act="curfew" data-v="0">Works on</button></div>
      <p class="hint">Night stalkers hunt anyone outside the walls after dark. Working on brings in more, at a price.</p>
    </div>
    ${away ? `<p class="hint pad">Also: ${away}.</p>` : ''}
    <div class="card"><h3>The heart</h3>${heart}</div>`;
}

function plotRow(key: PlotKey) {
  const info = PLOT_INFO[key];
  const lvl = plotLevel(s, key);
  const c = projectCost(s, { plot: key });
  const status = typeof c === 'string' ? '<span class="good">Complete</span>' : `<button class="small" data-act="build" data-plot="${key}" ${s.supplies < c.supplies ? 'disabled' : ''}>Lv ${c.level} · ${c.supplies}</button>`;
  return `<div class="row opt"><span class="grow"><b>${info.label}</b> <span class="hint">${lvl}/${info.levels.length}</span><br><span class="hint">${typeof c === 'string' ? info.levels[lvl - 1] : info.levels[c.level - 1]}</span></span>${status}</div>`;
}

function queueHtml() {
  if (!s.projects.length) return '<p class="hint">Nothing queued. Tap a plot on the map, or pick one below.</p>';
  const builders = jobCounts(s).build;
  return (
    s.projects
      .map((p, i) => {
        const info = PLOT_INFO[p.spec.plot];
        const lvl = plotLevel(s, p.spec.plot) + s.projects.slice(0, i).filter((q) => q.spec.plot === p.spec.plot).length + 1;
        return `<div class="row q"><span class="n">${i + 1}</span><span class="grow">${info.label} · level ${lvl}
          ${i === 0 ? `<span class="bar"><span style="width:${pct(1 - Math.max(0, p.workLeft) / p.workTotal)}"></span></span>` : ''}</span>
          ${i > 0 ? `<button class="small" data-act="hurry" data-id="${p.id}" aria-label="Move earlier">↑</button>` : ''}
          <button class="small" data-act="cancel" data-id="${p.id}" aria-label="Cancel">✕</button></div>`;
      })
      .join('') + (builders ? '' : '<p class="hint bad">Nobody is building. Slide the economy toward building in Orders.</p>')
  );
}

function buildSheet() {
  const keys = Object.keys(PLOT_INFO) as PlotKey[];
  return `<div class="card"><h3>Construction order</h3>${queueHtml()}</div>
    <div class="card"><h3>Plots</h3><p class="hint">Half the cost is refunded if you cancel.</p>${keys.map(plotRow).join('')}</div>`;
}

function plotSheet(key: PlotKey) {
  const info = PLOT_INFO[key];
  const lvl = plotLevel(s, key);
  const c = projectCost(s, { plot: key });
  const queuedAt = s.projects.findIndex((p) => p.spec.plot === key);
  return `<div class="card"><h3>${info.label}</h3>
    <ol class="levels">${info.levels.map((l, i) => `<li class="${i < lvl ? 'done' : ''}">${l}</li>`).join('')}</ol>
    ${queuedAt >= 0 ? `<p class="info">In the construction order at place ${queuedAt + 1}.</p>` : ''}
    ${
      typeof c === 'string'
        ? '<p class="good">Fully built.</p>'
        : `<div class="row"><button class="primary" data-act="build" data-plot="${key}" ${s.supplies < c.supplies ? 'disabled' : ''}>Queue level ${c.level} · ${c.supplies} supplies</button><span class="hint">${c.work} work</span></div>`
    }</div>
    <div class="card"><h3>Construction order</h3>${queueHtml()}</div>`;
}

function peopleSheet() {
  const rc = roleCounts(s);
  const training = s.colonists.filter((c) => c.task === 'train');
  const vets = s.colonists.filter((c) => veterancy(c) > 0).length;
  const roles: Role[] = ['militia', 'archer', 'scout', 'builder'];
  return `
    <div class="card"><h3>The colony · ${s.colonists.length}</h3>
      <div class="roles">${(['villager', ...roles] as Role[]).map((r) => `<div><i class="dot" style="background:var(${ROLE_INFO[r].color})"></i><b>${rc[r]}</b> ${ROLE_INFO[r].label}</div>`).join('')}</div>
      <p class="hint">${vets ? `${vets} veterans. ` : ''}Everyone eats one supply a day.</p></div>
    <div class="card"><h3>Train villagers</h3>
      <p class="hint">${COSTS.train.supplies} supplies and half a day each. ${rc.villager} untrained villagers.</p>
      ${roles
        .map(
          (r) =>
            `<div class="row opt"><span class="grow"><b>${ROLE_INFO[r].label}</b><br><span class="hint">${ROLE_INFO[r].desc}</span></span><button class="small" data-act="train" data-role="${r}" ${s.supplies >= COSTS.train.supplies ? '' : 'disabled'}>Train</button></div>`,
        )
        .join('')}
      ${
        s.training.length || training.length
          ? `<div class="queue">${training.map((c) => `<span class="tag">${c.name} → ${ROLE_INFO[c.trainRole ?? c.role].label} (${Math.ceil(c.timer)}h)</span>`).join('')}${s.training
              .map((r, i) => `<button class="tag" data-act="untrain" data-i="${i}">${ROLE_INFO[r].label} waiting ✕</button>`)
              .join('')}</div>`
          : ''
      }</div>
    <div class="card"><h3>Relics</h3>${
      s.specials.length ? s.specials.map((x) => `<p><b>${SPECIAL_INFO[x].label}</b><br><span class="hint">${SPECIAL_INFO[x].desc}</span></p>`).join('') : '<p class="hint">None yet. Each evening offers one.</p>'
    }</div>
    <div class="card"><div class="row"><span class="grow hint">Seed ${s.seed} · ${s.stats.died} lost · ${s.stats.born} arrived</span><button class="small" data-act="new">New run</button></div></div>`;
}

const chip = (e: Element | null) => (e ? `<span class="el el-${e}">${ELEMENT_INFO[e].label}</span>` : '<span class="el unknown">?</span>');

function ringsSheet() {
  const wb = s.warband;
  let route = '<p class="hint">No warband has been seen. Tap a nest on the map to see what lies between it and us.</p>';
  if (wb?.announced) {
    const r = routeFrom(s, { x: wb.sx, y: wb.sy });
    route = `<p>The warband ${wb.marching ? 'marching' : 'gathering'} in the <b>${sectorName({ x: wb.sx, y: wb.sy })}</b> will cross:</p>
      <div class="route">${r.map((x) => `<div><span class="hint">${RINGS[x.ring]!.name}</span>${chip(x.element)}</div>`).join('')}</div>
      ${wb.marching ? '' : '<p class="hint">If it waits past midnight, the rings will have turned.</p>'}`;
  }
  const known = s.ringIntel.map((r) => r.filter(Boolean).length);
  return `<div class="card"><h3>The rings</h3>
      <p class="hint">Three rings circle the colony. Each turns one step at midnight, in the dark. Warbands march straight in and take on the element of every arc they cross.</p>
      ${RINGS.map((r, i) => `<div class="row"><span class="grow">${r.name}</span><span class="hint">${known[i]}/${ARCS} arcs known · turns ${s.rings[i]!.dir === 1 ? '↺' : '↻'}</span></div>`).join('')}
    </div>
    <div class="card"><h3>Next warband</h3>${route}</div>
    <div class="card"><h3>Elements</h3>${(Object.keys(ELEMENT_INFO) as Element[]).map((e) => `<div class="row opt">${chip(e)}<span class="hint grow">${ELEMENT_INFO[e].effect}</span></div>`).join('')}</div>`;
}

function logSheet() {
  return `<div class="card log">${s.log
    .slice(-150)
    .reverse()
    .map((l) => `<div class="${l.tone ?? ''}"><span class="d">D${dayOf(l.t)} ${clock(l.t)}</span>${l.text}</div>`)
    .join('')}</div>`;
}

function sheetHtml(): string {
  if (!sheet) return '';
  const title: Record<string, string> = { orders: 'Orders', build: 'Build', people: 'People', rings: 'Rings', log: 'Chronicle' };
  const body =
    sheet === 'orders' ? ordersSheet() : sheet === 'build' ? buildSheet() : sheet === 'people' ? peopleSheet() : sheet === 'rings' ? ringsSheet() : sheet === 'log' ? logSheet() : plotSheet(sheet.slice(5) as PlotKey);
  return `<div class="sheet-head"><h2>${sheet.startsWith('plot:') ? 'Building plot' : title[sheet]}</h2><button class="small" data-act="close" aria-label="Close">✕</button></div><div class="sheet-body">${body}</div>`;
}

function modalHtml(): string {
  if (s.outcome !== 'playing')
    return `<div class="modal-bg"><div class="modal"><h3>${s.outcome === 'won' ? 'The siege is broken' : 'The light goes out'}</h3><p>${s.outcomeText}</p>
      <p class="hint">Seed ${s.seed} · ${dayOf(s.time)} days · ${s.assaults} assaults weathered · ${s.stats.died} lost.</p>
      <div class="opts"><button class="primary" data-act="new">Begin again</button></div></div></div>`;
  if (s.boon)
    return `<div class="modal-bg"><div class="modal"><h3>Day ${dayOf(s.time)} draws to a close</h3><p class="hint">Choose one blessing for the colony.</p>
      <div class="opts boons">${s.boon
        .map((b, i) => {
          const inf = b.kind === 'relic' ? SPECIAL_INFO[b.id as SpecialId] : GIFT_INFO[b.id as GiftId];
          return `<button data-act="boon" data-i="${i}"><span class="kind">${b.kind === 'relic' ? 'Relic · lasts the whole run' : 'Gift · now'}</span><b>${inf.label}</b><span class="hint">${inf.desc}</span></button>`;
        })
        .join('')}</div></div></div>`;
  if (s.event)
    return `<div class="modal-bg"><div class="modal"><h3>${s.event.title}</h3><p>${s.event.text}</p>
      <div class="opts">${s.event.options.map((o, i) => `<button data-act="event" data-i="${i}">${o.label}<br><span class="hint">${o.hint}</span></button>`).join('')}</div></div></div>`;
  if (s.alert)
    return `<div class="modal-bg"><div class="modal"><h3>Alarm</h3><p>${s.alert}</p><p class="hint">Paused. The Rings menu shows what it will cross.</p>
      <div class="opts"><button class="primary" data-act="alert-ok">Carry on</button><button data-act="alert-rings">Show the rings</button></div></div></div>`;
  if (showHelp)
    return `<div class="modal-bg"><div class="modal help"><h3>Holdfast</h3>
      <p>A heart of blight is growing beyond the rings that circle your valley. Find it and break it before it reaches you.</p>
      <ul>
        <li>Drag to move the map, pinch or scroll to zoom. Tap anything to inspect it.</li>
        <li>Tap a <b>dashed plot</b> in the colony to queue a building. You choose the order; builders do the rest.</li>
        <li><b>Orders</b> holds two sliders: soldiers drill or scout; workers gather or build.</li>
        <li>The <b>rings</b> turn at midnight. Warbands take on the element of every arc they cross. Scout the rings and the nests to see what is coming.</li>
        <li>After dark, <b>night stalkers</b> hunt anyone outside the walls.</li>
        <li>Ring the <b>bell</b> and everyone takes the walls. Each evening, choose a relic or gift.</li>
      </ul>
      <div class="opts"><button class="primary" data-act="help-close">Begin</button></div></div></div>`;
  return '';
}

function render(force = false) {
  const hud = hudHtml();
  if (hud !== lastHud) {
    $('hud').innerHTML = hud;
    lastHud = hud;
  }
  const bell = $('bell');
  bell.classList.toggle('ringing', s.bell);
  bell.classList.toggle('alarm', !!s.warband?.marching && !s.bell);
  bell.querySelector('.ic')!.nextSibling!.textContent = s.bell ? 'Ringing' : 'Bell';
  document.querySelectorAll<HTMLButtonElement>('[data-sheet]').forEach((b) => b.classList.toggle('on', sheet === b.dataset.sheet));
  if (!dragging) {
    const html = sheetHtml();
    if (force || html !== lastSheet) {
      const el = $('sheet');
      const body = el.querySelector('.sheet-body');
      const scroll = body ? body.scrollTop : 0;
      el.innerHTML = html;
      el.hidden = !sheet;
      const nb = el.querySelector('.sheet-body');
      if (nb && lastSheet.slice(0, 60) === html.slice(0, 60)) nb.scrollTop = scroll;
      lastSheet = html;
    }
  }
  const m = modalHtml();
  if ($('modal').dataset.html !== m) {
    $('modal').innerHTML = m;
    $('modal').dataset.html = m;
  }
  const t = $('toast');
  t.hidden = !toast;
  t.textContent = toast;
  const inf = $('info');
  inf.hidden = !info;
  if (info) inf.innerHTML = info.html;
  view.insetTop = $('hud').getBoundingClientRect().height;
  view.insetBottom = $('toolbar').getBoundingClientRect().height + (sheet ? Math.min($('sheet').getBoundingClientRect().height, window.innerHeight * 0.5) : 0);
}

function flash(msg: string | null | void) {
  if (!msg) return;
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = '';
    render();
  }, 2200);
}

function openSheet(next: Sheet) {
  sheet = sheet === next ? null : next;
  confirmStrike = false;
  info = null;
  view.selected = null;
  render(true);
}

// ───────────── Map interaction ─────────────

function inspect(clientX: number, clientY: number) {
  const plot = view.plotAt(s, clientX, clientY);
  if (plot) {
    const pl = s.plots.find((p) => p.key === plot)!;
    view.selected = pl;
    info = null;
    sheet = `plot:${plot}`;
    return render(true);
  }
  const p = view.toWorld(clientX, clientY);
  let best: { d: number; html: string; at: Vec } | null = null;
  const consider = (at: Vec, r: number, html: string) => {
    const d = dist(at, p) - r;
    if (d < Math.max(5, 20 / view.k) && (!best || d < best.d)) best = { d, html, at };
  };
  for (const i of Object.values(s.intel)) {
    const age = s.time - i.seenAt;
    const amount = i.kind === 'nest' ? `size ${i.amount}` : i.kind === 'survivors' ? `${i.amount} people` : i.kind === 'forest' || i.kind === 'regrowth' || i.kind === 'ruins' ? `${Math.floor(i.amount)} supplies` : '';
    let extra = '';
    if (i.kind === 'nest') {
      const r = routeFrom(s, i);
      extra = `<div class="route small">${r.length ? `Its warbands would cross: ${r.map((x) => chip(x.element)).join(' ')}` : 'It is inside the rings.'}</div>`;
    }
    consider(i, i.r, `<b>${FEATURE_INFO[i.kind].label}</b> · ${sectorName(i)}${amount ? ` · ${amount}` : ''}<br><span class="hint">${age < 1 ? 'In sight now' : `Seen ${Math.round(age)}h ago`}${i.uncertain ? ' · <span class="bad">the land has shifted since</span>' : ''}</span>${extra}`);
  }
  if (s.heart.seen) consider(s.heart.seen, 4, `<b>The heart of the blight</b><br><span class="hint">Strength ${Math.round(s.heart.strength)}${s.heart.seen.uncertain ? ' · may have moved' : ''}</span>`);
  const b = best as { html: string; at: Vec } | null;
  info = b ? { at: b.at, html: b.html } : null;
  view.selected = b ? b.at : null;
  render();
}

const pointers = new Map<number, { x: number; y: number }>();
let downAt = { x: 0, y: 0, t: 0 };
let moved = 0;
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    moved = 0;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }
});
canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    view.pan(cur.x - prev.x, cur.y - prev.y);
    moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (pinch > 0) view.zoomAt(d / pinch, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
    pinch = d;
    moved += 100;
  }
});
const up = (e: PointerEvent) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && moved < 8 && performance.now() - downAt.t < 500) inspect(e.clientX, e.clientY);
  if (pointers.size < 2) pinch = 0;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    view.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  },
  { passive: false },
);

// ───────────── Controls ─────────────

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-sheet],[data-speed],[data-zoom],#pause');
  if (!el) return;
  if (el.id === 'pause') {
    paused = !paused;
    return render();
  }
  if (el.dataset.sheet) return openSheet(el.dataset.sheet as Sheet);
  if (el.dataset.speed) {
    speed = Number(el.dataset.speed);
    paused = false;
    return render();
  }
  if (el.dataset.zoom) {
    const r = canvas.getBoundingClientRect();
    if (el.dataset.zoom === 'home') view.home();
    else view.zoomAt(el.dataset.zoom === 'in' ? 1.4 : 1 / 1.4, r.left + r.width / 2, r.top + r.height / 2);
    return;
  }
  const d = el.dataset;
  switch (d.act) {
    case 'close':
      sheet = null;
      view.selected = null;
      break;
    case 'help':
      showHelp = true;
      break;
    case 'help-close':
      showHelp = false;
      try {
        localStorage.setItem(HELP_KEY, '1');
      } catch {
        /* ignore */
      }
      break;
    case 'new':
      s = newGame(randomSeed());
      paused = true;
      sheet = null;
      info = null;
      view.selected = null;
      view.home();
      break;
    case 'event':
      chooseEvent(s, Number(d.i));
      break;
    case 'boon':
      chooseBoon(s, Number(d.i));
      break;
    case 'alert-ok':
      s.alert = null;
      paused = false;
      break;
    case 'alert-rings':
      s.alert = null;
      sheet = 'rings';
      if (s.warband) {
        view.cx = s.warband.sx / 2;
        view.cy = s.warband.sy / 2;
      }
      break;
    case 'curfew':
      setDirective(s, 'curfew', d.v === '1');
      break;
    case 'hunt':
      setDirective(s, 'hunt', d.v === '1');
      break;
    case 'strike':
      confirmStrike = true;
      break;
    case 'strike-cancel':
      confirmStrike = false;
      break;
    case 'strike-go':
      confirmStrike = false;
      flash(orderStrike(s));
      break;
    case 'recall':
      recallStrike(s);
      break;
    case 'bell-toggle':
      setBell(s, !s.bell);
      break;
    case 'fire':
      flash(fireStores(s));
      break;
    case 'build':
      flash(queueProject(s, { plot: d.plot as PlotKey }));
      break;
    case 'cancel':
      flash(cancelProject(s, Number(d.id)));
      break;
    case 'hurry':
      hurryProject(s, Number(d.id));
      break;
    case 'train':
      flash(queueTraining(s, d.role as Role));
      break;
    case 'untrain':
      cancelTraining(s, Number(d.i));
      break;
    default:
      return;
  }
  save();
  render(true);
});

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (!el.dataset.split) return;
  const which = el.dataset.split as 'scout' | 'build';
  setSplit(s, which, 100 - Number(el.value));
  const ends = el.previousElementSibling as HTMLElement | null;
  if (ends) {
    const spans = ends.querySelectorAll('span');
    const left = 100 - s.split[which];
    spans[0]!.innerHTML = spans[0]!.innerHTML.replace(/· \d+%/, `· ${left}%`);
    spans[1]!.innerHTML = spans[1]!.innerHTML.replace(/^\d+%/, `${100 - left}%`);
  }
});
document.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).matches?.('input[type=range]')) dragging = true;
});
const endDrag = () => {
  if (dragging) {
    dragging = false;
    save();
  }
};
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
document.addEventListener('change', endDrag);

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT') return;
  if (e.key === ' ') {
    e.preventDefault();
    paused = !paused;
    render();
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    speed = [1, 2, 4][Number(e.key) - 1]!;
    paused = false;
    render();
  } else if (e.key === 'Escape') {
    sheet = null;
    info = null;
    view.selected = null;
    render(true);
  }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => view.refreshTheme());
new MutationObserver(() => view.refreshTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ───────────── Loop ─────────────

let acc = 0;
let last = performance.now();
let lastUi = 0;
let lastSave = 0;

function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const blocked = !!(s.event || s.boon || s.alert || s.outcome !== 'playing' || showHelp);
  if (!paused && !blocked) {
    acc += (dt * speed * 24) / SECONDS_PER_DAY;
    let n = 0;
    while (acc >= DT && n < 200) {
      step(s);
      acc -= DT;
      n++;
      if (s.event || s.boon || s.alert || s.outcome !== 'playing') {
        acc = 0;
        break;
      }
    }
  }
  view.draw(s, paused || blocked ? 1 : Math.min(1, acc / DT), now);
  if (now - lastUi > 250) {
    lastUi = now;
    render();
  }
  if (now - lastSave > 5000) {
    lastSave = now;
    save();
  }
  requestAnimationFrame(frame);
}

type Hot = { snapshot?: (fn: () => unknown) => void; ready?: (fn: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => s);
const start = (data: unknown) => {
  if (data && typeof data === 'object' && 'plots' in (data as object)) s = data as GameState;
  try {
    showHelp = !localStorage.getItem(HELP_KEY);
  } catch {
    showHelp = true;
  }
  render(true);
  requestAnimationFrame(frame);
};
if (hot?.ready) hot.ready(start);
else start(hot?.data);
