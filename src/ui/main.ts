import { COSTS, DT, FEATURE_INFO, GIFT_INFO, INNER_INFO, MAX_EQUIPMENT, MAX_TOWERS, MAX_WALL, ROLE_INFO, SPECIAL_INFO, WALL_R } from '../core/data';
import {
  cancelProject,
  cancelTraining,
  chooseBoon,
  chooseEvent,
  clock,
  dayOf,
  fireStores,
  forecast,
  jobCounts,
  newGame,
  orderStrike,
  projectCost,
  queueProject,
  queueTraining,
  recallStrike,
  roleCounts,
  setBell,
  setDirective,
  setSplit,
  step,
  strikeOdds,
  strikeParty,
} from '../core/sim';
import type { GameState, GiftId, InnerBuilding, ProjectSpec, Role, SpecialId, Vec } from '../core/types';
import { dist, sectorName } from '../core/world';
import { wallMax } from '../core/state';
import { MapView } from './render';

const SAVE_KEY = 'holdfast-sim-v2';
const HELP_KEY = 'holdfast-sim-help';
/** Real seconds per in-game day at 1×. */
const SECONDS_PER_DAY = 40;

type Tab = 'orders' | 'build' | 'people' | 'log';
let s: GameState = load() ?? newGame(randomSeed());
let speed = 1;
let paused = true;
let tab: Tab = 'orders';
let showHelp = false;
let confirmStrike = false;
let toast = '';
let toastTimer = 0;
let selectedInfo: { at: Vec; html: string } | null = null;
let dragging = false;
let lastPanel = '';
let lastHud = '';

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}
function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const g = raw ? (JSON.parse(raw) as GameState) : null;
    return g && g.colonists && g.fogSeen ? g : null;
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
  <header class="hud wrap" id="hud"></header>
  <main class="layout wrap">
    <section class="map-col">
      <div class="map-wrap">
        <canvas id="map" aria-label="Map of the valley"></canvas>
        <div class="map-info" id="map-info" hidden></div>
      </div>
      <div class="controls">
        <button id="pause" class="primary" aria-label="Play or pause">▶</button>
        <div class="speeds" role="group" aria-label="Speed">
          <button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button>
        </div>
        <div class="forecast" id="forecast"></div>
      </div>
      <div class="legend">
        <span><i class="dot" style="background:var(--c-villager)"></i>Villager</span>
        <span><i class="dot" style="background:var(--c-militia)"></i>Militia</span>
        <span><i class="dot" style="background:var(--c-archer)"></i>Archer</span>
        <span><i class="dot" style="background:var(--c-scout)"></i>Scout</span>
        <span><i class="dot" style="background:var(--c-builder)"></i>Builder</span>
        <span><i class="tri" style="color:var(--horde)">▲</i>Horde</span>
        <span><i class="dot" style="background:var(--heart)"></i>Heart</span>
      </div>
    </section>
    <section class="side">
      <nav class="tabs" role="tablist">
        <button data-tab="orders">Orders</button><button data-tab="build">Build</button><button data-tab="people">People</button><button data-tab="log">Log</button>
      </nav>
      <div id="panel" class="panel-body"></div>
    </section>
  </main>
  <div id="modal"></div>
  <div id="toast" class="toast" role="status" hidden></div>`;

const view = new MapView(document.getElementById('map') as HTMLCanvasElement);
const $ = (id: string) => document.getElementById(id)!;

// ───────────── Panels ─────────────

const pct = (x: number) => `${Math.round(x * 100)}%`;

function hudHtml() {
  const pop = s.colonists.length;
  const night = s.time % 24 >= 20 || s.time % 24 < 6;
  const food = pop * (s.settlement.inner.granary ? 0.67 : 1);
  return `
    <div class="brand">Holdfast</div>
    <div class="stat"><span class="k">Day ${dayOf(s.time)}</span><span class="v">${clock(s.time)} ${night ? '☾' : '☀'}</span></div>
    <div class="stat"><span class="k">Supplies</span><span class="v">${Math.floor(s.supplies)} <small>−${food.toFixed(0)}/day</small></span></div>
    <div class="stat"><span class="k">People</span><span class="v">${pop}</span></div>
    <div class="stat"><span class="k">Keep</span><span class="v ${s.settlement.keepHp < 20 ? 'bad' : ''}">${Math.ceil(s.settlement.keepHp)}</span></div>
    <div class="spacer"></div>
    <button class="small" data-act="help" aria-label="How to play">?</button>`;
}

function splitSlider(which: 'scout' | 'build', left: string, right: string, nLeft: number, nRight: number, extra: string) {
  return `<div class="split ${s.bell ? 'paused' : ''}">
    ${s.bell ? '<p class="hint info">On hold while the bell rings. Everyone is on the walls.</p>' : ''}
    <div class="ends"><span><b>${nLeft}</b> ${left}</span><span>${right} <b>${nRight}</b></span></div>
    <input type="range" id="split-${which}" min="0" max="100" step="5" value="${s.split[which]}" data-split="${which}" aria-label="${left} or ${right}">
    ${extra}
  </div>`;
}

function ordersPanel() {
  const j = jobCounts(s);
  const rc = roleCounts(s);
  const wb = s.warband;
  const striking = s.colonists.filter((c) => c.task === 'strike');
  const party = strikeParty(s);
  const odds = strikeOdds(s, party);
  const seen = s.heart.seen;
  let heart = '';
  if (striking.length) {
    heart = `<p>${striking.length} fighters are out on the strike${s.heart.fightTimer > 0 ? ', fighting the heart now' : ''}.</p>
      <button data-act="recall">Call them back</button>`;
  } else if (!seen) {
    heart = '<p class="hint">Nobody has seen the heart yet. Scouts will find it in time; the blight gathers around it.</p>';
  } else {
    const age = s.time - seen.at;
    heart = `<p>Last seen in the <b>${sectorName(seen)}</b>, ${Math.round(dist(seen))} paces out, ${age < 1 ? 'in sight now' : `${Math.round(age)}h ago`}${seen.uncertain ? ' <span class="bad">(the land has shifted; it may have moved)</span>' : ''}.</p>
      <p class="hint">Strength ${Math.round(s.heart.strength)}. Burning out nests weakens it.</p>
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
  const fireFree = s.specials.includes('tinderbox');
  return `
    <div class="card bell ${s.bell ? 'ringing' : ''} ${wb?.marching ? 'urgent' : ''}">
      <h3>${wb?.marching ? 'Under attack' : 'The bell'}</h3>
      ${
        s.bell
          ? `<p>The bell is ringing. <b>Everyone</b> is on the walls; no work is being done.</p>
             <button data-act="bell" data-v="0">Silence the bell</button>`
          : `<p class="hint">Ring it and everyone drops their work to garrison the walls. Villagers fight far worse than soldiers. It falls silent when the warband is broken.</p>
             <button class="${wb?.marching ? 'danger' : ''}" data-act="bell" data-v="1">Ring the bell</button>`
      }
      ${
        wb?.marching
          ? `<div class="row"><button data-act="fire" ${wb.interventions && (fireFree || s.supplies >= 15) ? '' : 'disabled'}>Fire the stores</button><span class="hint grow">${fireFree ? 'Free with the Tinderbox' : 'Burn 15 supplies'} to scorch the horde at the walls. ${wb.interventions} left.</span></div>`
          : ''
      }
    </div>
    <div class="card"><h3>Military · ${rc.militia + rc.archer + rc.scout}</h3>
      <p class="hint">Militia, archers and scouts. Scouts go first into the fog; everyone else holds the walls.</p>
      ${splitSlider('scout', 'guarding', 'scouting', j.guard, j.scout, `
        <div class="row"><span class="grow">When it is quiet, guards</span>
          <button class="small ${s.directives.hunt ? 'on' : ''}" data-act="hunt" data-v="1">Hunt nests</button>
          <button class="small ${!s.directives.hunt ? 'on' : ''}" data-act="hunt" data-v="0">Stay home</button></div>`)}
    </div>
    <div class="card"><h3>Economy · ${rc.villager + rc.builder}</h3>
      <p class="hint">Villagers and builders. Builders go first to construction; with nothing to build they mend walls or gather.</p>
      ${splitSlider('build', 'gathering', 'building', j.gather, j.build, '')}
      <div class="row"><span class="grow">At nightfall, workers</span>
        <button class="small ${s.directives.curfew ? 'on' : ''}" data-act="curfew" data-v="1">Come home</button>
        <button class="small ${!s.directives.curfew ? 'on' : ''}" data-act="curfew" data-v="0">Work on</button></div>
    </div>
    ${away ? `<p class="hint">Also: ${away}.</p>` : ''}
    <div class="card"><h3>The heart</h3>${heart}</div>`;
}

function buildOption(spec: ProjectSpec, label: string, desc: string) {
  const c = projectCost(s, spec);
  const btn =
    typeof c === 'string'
      ? `<span class="hint">${c}</span>`
      : `<button class="small" data-act="build" data-spec='${JSON.stringify(spec)}' ${s.supplies < c.supplies ? 'disabled' : ''}>Build · ${c.supplies}</button>`;
  return `<div class="row opt"><span class="grow"><b>${label}</b><br><span class="hint">${desc}</span></span>${btn}</div>`;
}

function projectName(p: ProjectSpec) {
  switch (p.kind) {
    case 'wall':
      return 'Palisade';
    case 'tower':
      return 'Watchtower';
    case 'equipment':
      return 'Arms & tools';
    case 'inner':
      return INNER_INFO[p.building].label;
  }
}

function buildPanel() {
  const st = s.settlement;
  const builders = jobCounts(s).build;
  const q = s.projects.length
    ? s.projects
        .map(
          (p, i) => `<div class="row"><span class="grow">${projectName(p.spec)}${i === 0 ? '' : ' <span class="hint">(queued)</span>'}
            <span class="bar"><span style="width:${pct(1 - Math.max(0, p.workLeft) / p.workTotal)}"></span></span></span>
            <button class="small" data-act="cancel" data-id="${p.id}" aria-label="Cancel">✕</button></div>`,
        )
        .join('') + (builders ? '' : '<p class="hint bad">Nobody is building. Move the Economy slider toward building in Orders.</p>')
    : '<p class="hint">Nothing under construction. Builders mend the walls when idle.</p>';
  const damaged = st.wallHp.filter((h) => h < wallMax(s) - 0.5).length;
  return `
    <div class="card"><h3>Under construction</h3>${q}</div>
    <div class="card"><h3>Defenses</h3>
      ${buildOption({ kind: 'wall' }, `Palisade${st.wallLevel < MAX_WALL ? ` level ${st.wallLevel + 1}` : ''}`, `Now level ${st.wallLevel}${damaged ? `, ${damaged} section${damaged > 1 ? 's' : ''} damaged` : ''}. Holds back swarmers and brutes; fliers pass over.`)}
      ${buildOption({ kind: 'tower' }, `Watchtower (${st.towers.length}/${MAX_TOWERS})`, 'Raised facing the worst threat. Shoots, and keeps nearby land in sight.')}
      ${buildOption({ kind: 'equipment' }, `Arms & tools (${st.equipment}/${MAX_EQUIPMENT})`, '+20% fighting power for everyone.')}
    </div>
    <div class="card"><h3>Buildings</h3>
      ${(Object.keys(INNER_INFO) as InnerBuilding[])
        .map((b) =>
          st.inner[b]
            ? `<div class="row opt"><span class="grow"><b>${INNER_INFO[b].label}</b><br><span class="hint">${INNER_INFO[b].desc}</span></span><span class="good">Built</span></div>`
            : buildOption({ kind: 'inner', building: b }, INNER_INFO[b].label, INNER_INFO[b].desc),
        )
        .join('')}
    </div>
    <p class="hint">Where things go is up to the builders.</p>`;
}

function peoplePanel() {
  const rc = roleCounts(s);
  const wounded = s.colonists.filter((c) => c.task === 'wounded').length;
  const training = s.colonists.filter((c) => c.task === 'train');
  const roles: Role[] = ['militia', 'archer', 'scout', 'builder'];
  return `
    <div class="card"><h3>The colony · ${s.colonists.length}</h3>
      <div class="roles">${(['villager', ...roles] as Role[]).map((r) => `<div><i class="dot" style="background:var(${ROLE_INFO[r].color})"></i><b>${rc[r]}</b> ${ROLE_INFO[r].label}</div>`).join('')}</div>
      <p class="hint">${wounded ? `${wounded} wounded, recovering. ` : ''}Everyone eats one supply a day.</p>
    </div>
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
              .map((r, i) => `<button class="tag" data-act="untrain" data-i="${i}" title="Cancel">${ROLE_INFO[r].label} waiting ✕</button>`)
              .join('')}</div>`
          : ''
      }
    </div>
    <div class="card"><h3>Specials</h3>${
      s.specials.length ? s.specials.map((x) => `<p><b>${SPECIAL_INFO[x].label}</b><br><span class="hint">${SPECIAL_INFO[x].desc}</span></p>`).join('') : '<p class="hint">None yet. Ruins and strange sites may hold them.</p>'
    }</div>
    <div class="card"><h3>Run</h3><div class="row"><span class="grow hint">Seed ${s.seed} · ${s.stats.died} lost · ${s.stats.born} found or arrived</span><button class="small" data-act="new">New run</button></div></div>`;
}

function logPanel() {
  return `<div class="card log">${s.log
    .slice(-150)
    .reverse()
    .map((l) => `<div class="${l.tone ?? ''}"><span class="d">D${dayOf(l.t)} ${clock(l.t)}</span>${l.text}</div>`)
    .join('')}</div>`;
}

function modalHtml(): string {
  if (s.outcome !== 'playing')
    return `<div class="modal-bg"><div class="modal"><h3>${s.outcome === 'won' ? 'The siege is broken' : 'The light goes out'}</h3><p>${s.outcomeText}</p>
      <p class="hint">Seed ${s.seed} · ${dayOf(s.time)} days · ${s.assaults} assaults weathered · ${s.stats.died} lost.</p>
      <div class="opts"><button class="primary" data-act="new">Begin again</button></div></div></div>`;
  if (s.boon)
    return `<div class="modal-bg"><div class="modal"><h3>Day ${dayOf(s.time)} draws to a close</h3>
      <p class="hint">Choose one blessing for the colony.</p>
      <div class="opts boons">${s.boon
        .map((b, i) => {
          const info = b.kind === 'relic' ? SPECIAL_INFO[b.id as SpecialId] : GIFT_INFO[b.id as GiftId];
          return `<button data-act="boon" data-i="${i}"><span class="kind">${b.kind === 'relic' ? 'Relic · lasts the whole run' : 'Gift · now'}</span><b>${info.label}</b><span class="hint">${info.desc}</span></button>`;
        })
        .join('')}</div></div></div>`;
  if (s.event)
    return `<div class="modal-bg"><div class="modal"><h3>${s.event.title}</h3><p>${s.event.text}</p>
      <div class="opts">${s.event.options.map((o, i) => `<button data-act="event" data-i="${i}">${o.label}<br><span class="hint">${o.hint}</span></button>`).join('')}</div></div></div>`;
  if (s.alert)
    return `<div class="modal-bg"><div class="modal"><h3>Alarm</h3><p>${s.alert}</p><p class="hint">Paused. Check your orders, then carry on.</p>
      <div class="opts"><button class="primary" data-act="alert-ok">Carry on</button></div></div></div>`;
  if (showHelp)
    return `<div class="modal-bg"><div class="modal help"><h3>Holdfast</h3>
      <p>The valley is changing. A heart of blight is growing toward your colony from somewhere in the fog. Find it and break it before it arrives.</p>
      <ul>
        <li>Your people run their own lives. Two sliders set the balance: the <b>military</b> guards or scouts, the <b>economy</b> gathers or builds.</li>
        <li>Ring the <b>bell</b> and everyone drops their work to defend the walls.</li>
        <li><b>Scouts</b> push back the fog. What you saw fades when the land shifts, so keep looking.</li>
        <li><b>Warbands</b> gather near nests, then march. Only people at home defend the walls.</li>
        <li>When it is quiet, guards <b>hunt nests</b>, which heals the land and weakens the heart.</li>
        <li>Each evening, choose a <b>relic or gift</b>.</li>
        <li>Queue construction and training. When the heart is found, choose your moment to <b>strike</b>.</li>
        <li>Pause any time. The game pauses itself when something needs you. Tap the map to inspect.</li>
      </ul>
      <div class="opts"><button class="primary" data-act="help-close">Begin</button></div></div></div>`;
  return '';
}

function renderPanels(force = false) {
  const hud = hudHtml();
  if (hud !== lastHud) {
    $('hud').innerHTML = hud;
    lastHud = hud;
  }
  const f = forecast(s);
  $('forecast').innerHTML = `<b class="${f.urgent ? 'bad' : ''}">${f.text}</b><span class="hint">${f.detail}</span>`;
  $('pause').textContent = paused ? '▶' : '❚❚';
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) => b.classList.toggle('on', !paused && Number(b.dataset.speed) === speed));
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (!dragging) {
    const html = tab === 'orders' ? ordersPanel() : tab === 'build' ? buildPanel() : tab === 'people' ? peoplePanel() : logPanel();
    if (force || html !== lastPanel) {
      $('panel').innerHTML = html;
      lastPanel = html;
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
  const info = $('map-info');
  info.hidden = !selectedInfo;
  if (selectedInfo) info.innerHTML = selectedInfo.html;
}

function flash(msg: string | null | void) {
  if (!msg) return;
  toast = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast = '';
    renderPanels();
  }, 2200);
}

// ───────────── Map taps ─────────────

function describeAt(p: Vec) {
  let best: { d: number; html: string; at: Vec } | null = null;
  const consider = (at: Vec, r: number, html: string) => {
    const d = dist(at, p) - r;
    if (d < 6 && (!best || d < best.d)) best = { d, html, at };
  };
  for (const i of Object.values(s.intel)) {
    const age = s.time - i.seenAt;
    const amount =
      i.kind === 'nest' ? `size ${i.amount}` : i.kind === 'survivors' ? `${i.amount} people` : i.kind === 'forest' || i.kind === 'regrowth' || i.kind === 'ruins' ? `${Math.floor(i.amount)} supplies` : '';
    consider(
      i,
      i.r,
      `<b>${FEATURE_INFO[i.kind].label}</b> · ${sectorName(i)}${amount ? ` · ${amount}` : ''}<br><span class="hint">${age < 1 ? 'In sight now' : `Seen ${Math.round(age)}h ago`}${
        i.uncertain ? ' · <span class="bad">the land has shifted since</span>' : ''
      }</span>`,
    );
  }
  if (s.heart.seen) consider(s.heart.seen, 4, `<b>The heart of the blight</b><br><span class="hint">Strength ${Math.round(s.heart.strength)}${s.heart.seen.uncertain ? ' · may have moved' : ''}</span>`);
  consider({ x: 0, y: 0 }, WALL_R, `<b>The colony</b><br><span class="hint">Palisade level ${s.settlement.wallLevel}, ${s.settlement.towers.length} tower${s.settlement.towers.length === 1 ? '' : 's'}</span>`);
  const b = best as { html: string; at: Vec } | null;
  selectedInfo = b ? { at: b.at, html: b.html } : null;
  view.selected = b ? b.at : null;
  renderPanels();
}

($('map') as HTMLCanvasElement).addEventListener('click', (e) => describeAt(view.toWorld(e.clientX, e.clientY)));

// ───────────── Input ─────────────

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab],[data-speed],#pause');
  if (!el) return;
  if (el.id === 'pause') {
    paused = !paused;
    return renderPanels();
  }
  if (el.dataset.tab) {
    tab = el.dataset.tab as Tab;
    confirmStrike = false;
    return renderPanels(true);
  }
  if (el.dataset.speed) {
    speed = Number(el.dataset.speed);
    paused = false;
    return renderPanels();
  }
  const d = el.dataset;
  switch (d.act) {
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
      selectedInfo = null;
      view.selected = null;
      break;
    case 'event':
      chooseEvent(s, Number(d.i));
      break;
    case 'alert-ok':
      s.alert = null;
      paused = false;
      break;
    case 'curfew':
      setDirective(s, 'curfew', d.v === '1');
      break;
    case 'hunt':
      setDirective(s, 'hunt', d.v === '1');
      break;
    case 'boon':
      chooseBoon(s, Number(d.i));
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
    case 'bell':
      setBell(s, d.v === '1');
      break;
    case 'fire':
      flash(fireStores(s));
      break;
    case 'build':
      flash(queueProject(s, JSON.parse(d.spec!) as ProjectSpec));
      break;
    case 'cancel':
      flash(cancelProject(s, Number(d.id)));
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
  renderPanels(true);
});

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.split) setSplit(s, el.dataset.split as 'scout' | 'build', Number(el.value));
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
  if (t.tagName === 'INPUT' || t.tagName === 'BUTTON') return;
  if (e.key === ' ') {
    e.preventDefault();
    paused = !paused;
    renderPanels();
  } else if (e.key === '1' || e.key === '2' || e.key === '3') {
    speed = [1, 2, 4][Number(e.key) - 1]!;
    paused = false;
    renderPanels();
  }
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => view.refreshTheme());
new MutationObserver(() => view.refreshTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ───────────── Loop ─────────────

let acc = 0;
let last = performance.now();
let lastPanelAt = 0;
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
  if (now - lastPanelAt > 250) {
    lastPanelAt = now;
    renderPanels();
  }
  if (now - lastSave > 5000) {
    lastSave = now;
    save();
  }
  requestAnimationFrame(frame);
}

// Keep the run across live updates of the published page.
type Hot = { snapshot?: (fn: () => unknown) => void; ready?: (fn: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => s);
const start = (data: unknown) => {
  if (data && typeof data === 'object' && 'fogSeen' in (data as object)) s = data as GameState;
  try {
    showHelp = !localStorage.getItem(HELP_KEY);
  } catch {
    showHelp = true;
  }
  renderPanels(true);
  requestAnimationFrame(frame);
};
if (hot?.ready) hot.ready(start);
else start(hot?.data);
