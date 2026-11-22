import {
  actPreview,
  advanceDay,
  assaultEstimate,
  assignSquad,
  battleStep,
  cancelProject,
  chooseEvent,
  expeditionDays,
  income,
  mergeSquads,
  newGame,
  people,
  projectCost,
  queueProject,
  recall,
  sendExpedition,
  setDoctrine,
  trainSquad,
  upkeep,
} from '../core/game';
import {
  DIRS,
  HORDE_INFO,
  INNER_INFO,
  MAX_EQUIPMENT,
  MAX_SQUAD,
  MAX_WALL,
  RADIUS,
  ROLE_INFO,
  SPECIAL_INFO,
  TILE_INFO,
} from '../core/data';
import type { GameState, InnerBuilding, Intervention, Pos, ProjectKind, Role, Squad } from '../core/types';
import { dist, key, sectorOf } from '../core/world';

const SAVE_KEY = 'holdfast-save-v1';
const HELP_KEY = 'holdfast-help-seen';
const app = document.getElementById('app')!;

let s: GameState = load() ?? newGame(randomSeed());
let selected: Pos | null = null;
const chosen = new Set<number>();
let mergeFrom: number | null = null;
let toast = '';

function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}

function load(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

function act(err: string | null | void) {
  if (err) {
    toast = err;
    setTimeout(() => {
      toast = '';
      render();
    }, 1800);
  }
  // Drop selections that are no longer valid.
  for (const id of [...chosen]) {
    const q = s.squads.find((x) => x.id === id);
    if (!q || !isHome(q)) chosen.delete(id);
  }
  save();
  render();
}

const isHome = (q: Squad) => q.assignment.type === 'guard' || q.assignment.type === 'work';

// ───────────────────────── Rendering ─────────────────────────

function pips(q: Squad) {
  const e = MAX_SQUAD - q.health - q.wounded;
  return `<span class="pips"><span class="pip-h">${'●'.repeat(q.health)}</span><span class="pip-w">${'●'.repeat(q.wounded)}</span><span class="pip-e">${'○'.repeat(Math.max(0, e))}</span></span>`;
}

function status(q: Squad): string {
  const a = q.assignment;
  switch (a.type) {
    case 'guard':
      return 'On guard';
    case 'work':
      return 'Working';
    case 'train':
      return `Training as ${ROLE_INFO[a.role].label} (${a.daysLeft}d)`;
    case 'expedition':
      return `${a.mission === 'scout' ? 'Scouting' : 'Expedition'} ${sectorOf(a.target)} · back in ${a.daysLeft}d`;
  }
}

type Tab = 'wilds' | 'colony' | 'squads' | 'log';
let tab: Tab = 'wilds';
let showHelp = false;

function topBar() {
  const est = assaultEstimate(s);
  const heart = Object.entries(s.intel).find(([, i]) => i.source);
  const net = income(s) - upkeep(s);
  const busy = !!(s.battle || s.event || s.outcome !== 'playing');
  return `
  <header class="top wrap">
    <div class="top-row">
      <div class="brand">Holdfast</div>
      <div class="stat"><span class="k">Day</span><span class="v">${s.day}</span></div>
      <div class="stat"><span class="k">Supplies</span><span class="v">${s.supplies} <small>${net >= 0 ? '+' : ''}${net}/d</small></span></div>
      <div class="stat"><span class="k">People</span><span class="v">${people(s)}</span></div>
      <div class="stat"><span class="k">Keep</span><span class="v">${s.settlement.keepHp}</span></div>
      <div class="spacer"></div>
      <button class="small" data-a="help" aria-label="How to play">?</button>
      <button class="small desk" data-a="new">New run</button>
      <button class="primary desk" data-a="next" ${busy ? 'disabled' : ''}>Next day ⏎</button>
    </div>
    <div class="forecast">
      <span>Assault: <b>${est.minDays === 0 ? 'any day now' : `${est.minDays}–${est.maxDays} days`}</b>${est.dir ? ` from the <b>${est.dir}</b>` : ', direction unknown'}</span>
      <span>Heart: <b>${heart ? `${sectorOf(parsePos(heart[0]))}, ${heart[1].uncertain ? 'may have moved' : 'fresh'}` : 'not found'}</b> · strength ${Math.round(s.source.strength)}</span>
    </div>
    ${est.signs.length ? `<div class="signs">${est.signs.map((x) => `◆ ${x}`).join(' ')}</div>` : ''}
  </header>`;
}

function parsePos(k: string): Pos {
  const [x, y] = k.split(',').map(Number) as [number, number];
  return { x, y };
}

function buildBtn(spec: ProjectKind, label: string) {
  const c = projectCost(s, spec);
  if (typeof c === 'string') return `<button class="small" disabled title="${c}">${label}</button>`;
  return `<button class="small" data-a="build" data-spec='${JSON.stringify(spec)}' ${s.supplies < c.supplies ? 'disabled' : ''} title="${c.work} work">${label} · ${c.supplies}</button>`;
}

function settlementPanel() {
  const st = s.settlement;
  const walls = DIRS.map((d) => {
    const w = st.walls[d];
    return `<div class="row"><b style="width:18px">${d}</b>
      <span class="grow">${w.level ? `Wall ${w.level} <span class="hint">${w.hp}/${w.level * 10}</span>` : '<span class="muted">open</span>'}${st.towers[d] ? ' · Tower' : ''}</span>
      ${buildBtn({ kind: 'wall', dir: d }, w.level >= MAX_WALL ? 'Max' : 'Wall+')}
      ${st.towers[d] ? '' : buildBtn({ kind: 'tower', dir: d }, 'Tower')}
    </div>`;
  }).join('');
  const inner = (Object.keys(INNER_INFO) as InnerBuilding[])
    .map((b) => `<div class="row"><span class="grow">${INNER_INFO[b].label}<br><span class="hint">${INNER_INFO[b].desc}</span></span>${
      st.inner[b] ? '<span class="good">Built ✓</span>' : buildBtn({ kind: 'inner', building: b }, 'Build')
    }</div>`)
    .join('');
  const workers = s.squads.filter((q) => q.assignment.type === 'work').length;
  const projects = s.projects.length
    ? s.projects.map((p) => `<div class="row"><span class="grow">${projectLabel(p.spec)} <span class="hint">${p.workLeft} work left</span></span><button class="small" data-a="cancel" data-id="${p.id}" aria-label="Cancel">✕</button></div>`).join('') +
      (workers ? '' : '<div class="hint bad">No squad is set to Work, so nothing gets built.</div>')
    : '<div class="hint">Nothing under construction. Queue a project, then set squads to Work.</div>';
  return `
  <div class="panel"><h2>Walls &amp; towers</h2>${walls}
    <div class="hint">Assaults hit one side. Towers keep nearby land scouted and help archers.</div></div>
  <div class="panel"><h2>Buildings</h2>
    <div class="row"><span class="grow">Equipment ${st.equipment}/${MAX_EQUIPMENT}<br><span class="hint">+20% fighting power per level</span></span>${buildBtn({ kind: 'equipment' }, 'Upgrade')}</div>
    ${inner}
  </div>
  <div class="panel"><h2>Construction</h2>${projects}</div>
  <div class="panel"><h2>Doctrine</h2>
    <div class="row"><button class="small ${s.doctrine.line === 'hold' ? 'on' : ''}" data-a="doc" data-k="line" data-v="hold">Hold the line</button>
      <button class="small ${s.doctrine.line === 'fallback' ? 'on' : ''}" data-a="doc" data-k="line" data-v="fallback">Fall back</button></div>
    <div class="hint">Hold: stronger, more casualties. Fall back: safer, but walls suffer.</div>
    <div class="row"><button class="small ${s.doctrine.protect === 'people' ? 'on' : ''}" data-a="doc" data-k="protect" data-v="people">Protect people</button>
      <button class="small ${s.doctrine.protect === 'stores' ? 'on' : ''}" data-a="doc" data-k="protect" data-v="stores">Protect stores</button></div>
  </div>
  <div class="panel"><h2>Specials</h2>${
    s.specials.length ? s.specials.map((x) => `<div class="row"><span><b>${SPECIAL_INFO[x].label}</b><br><span class="hint">${SPECIAL_INFO[x].desc}</span></span></div>`).join('') : '<div class="hint">None yet. Ruins and strange sites may hold them.</div>'
  }</div>
  <div class="panel mobile-only"><h2>Run</h2><div class="row"><span class="grow hint">Seed ${s.seed}</span><button class="small" data-a="new">Start a new run</button></div></div>`;
}

function projectLabel(p: ProjectKind) {
  switch (p.kind) {
    case 'wall':
      return `Wall ${p.dir}`;
    case 'tower':
      return `Tower ${p.dir}`;
    case 'inner':
      return INNER_INFO[p.building].label;
    case 'equipment':
      return 'Equipment';
  }
}

function grid() {
  const parties = new Map<string, number>();
  for (const q of s.squads) if (q.assignment.type === 'expedition') {
    const k = key(q.assignment.target);
    parties.set(k, (parties.get(k) ?? 0) + 1);
  }
  let cells = '';
  for (let y = -RADIUS; y <= RADIUS; y++)
    for (let x = -RADIUS; x <= RADIUS; x++) {
      if (x === 0 && y === 0) {
        cells += `<div class="cell colony" title="The colony">⌂</div>`;
        continue;
      }
      const k = key({ x, y });
      const i = s.intel[k];
      const sel = selected && selected.x === x && selected.y === y ? 'sel' : '';
      const party = parties.get(k) ? `<span class="party">⚑${parties.get(k)}</span>` : '';
      if (!i) {
        cells += `<div class="cell unknown ${sel}" data-a="tile" data-x="${x}" data-y="${y}" role="button" tabindex="0" aria-label="Unknown land">${party}?</div>`;
        continue;
      }
      const amt = i.kind === 'nest' || i.kind === 'forage' || i.kind === 'regrowth' || i.kind === 'refugees' ? `<span class="amt">${i.amount}</span>` : '';
      const glyph = i.source ? '<span class="g heart">♥</span>' : `<span class="g">${TILE_INFO[i.kind].glyph}</span>`;
      cells += `<div class="cell k-${i.kind} ${i.uncertain ? 'uncertain' : ''} ${sel}" data-a="tile" data-x="${x}" data-y="${y}" role="button" tabindex="0" aria-label="${TILE_INFO[i.kind].label}">${glyph}${amt}${party}</div>`;
    }
  const legend = (Object.keys(TILE_INFO) as (keyof typeof TILE_INFO)[])
    .map((k) => `<span><span class="k-${k}">${TILE_INFO[k].glyph}</span> ${TILE_INFO[k].label}</span>`)
    .join('');
  return `<div class="panel"><h2>The wilds</h2>
    <div class="wilds">${cells}</div>
    <div class="legend">${legend}<span><span class="heart">♥</span> The heart</span><span>~ land shifted since seen</span><span class="info">⚑ party</span></div>
  </div>`;
}

function today() {
  const lines = s.log.filter((l) => l.day === s.day);
  if (!lines.length) return '';
  return `<div class="panel mobile-only"><h2>Day ${s.day}</h2><div class="today">${lines
    .map((l) => `<div class="${l.tone ?? ''}">${l.text}</div>`)
    .join('')}</div></div>`;
}

function chronicle() {
  return `<div class="panel"><h2>Chronicle</h2><div class="log">${s.log
    .slice(-120)
    .reverse()
    .map((l) => `<div class="${l.tone ?? ''}"><span class="d">D${l.day}</span>${l.text}</div>`)
    .join('')}</div></div>`;
}

function tilePanel() {
  if (!selected) return `<div class="panel"><h2>Selected land</h2><div class="hint">Tap a tile to see what you know about it and send a party there.</div></div>`;
  const i = s.intel[key(selected)];
  const party = s.squads.filter((q) => chosen.has(q.id));
  const prev = actPreview(s, party, selected);
  const days = expeditionDays(selected);
  const avail = s.squads.filter((q) => isHome(q) && q.health > 0);
  return `<div class="panel"><h2>${sectorOf(selected)} · ${dist(selected)} away · ${days} day${days > 1 ? 's' : ''} out and back</h2>
    ${
      i
        ? `<div><b class="k-${i.kind}">${i.source ? 'The heart of the blight' : TILE_INFO[i.kind].label}</b>${i.hordeType ? ` · ${HORDE_INFO[i.hordeType].label}` : ''}</div>
           <div class="hint">Seen on day ${i.day}${i.uncertain ? ' · <span class="bad">the land has shifted since</span>' : ''}</div>`
        : '<div class="muted">Never seen.</div>'
    }
    <div class="hint" style="margin-top:4px">${prev.note}</div>
    <div class="hint" style="margin-top:8px">Choose the party:</div>
    <div class="party-pick">${
      avail.length
        ? avail.map((q) => `<button class="small ${chosen.has(q.id) ? 'on' : ''}" data-a="choose" data-id="${q.id}">${chosen.has(q.id) ? '✓ ' : ''}${q.name} · ${ROLE_INFO[q.role].label} ${q.health}</button>`).join('')
        : '<span class="hint">Every squad is away or training.</span>'
    }</div>
    <div class="actions">
      <button data-a="send" data-m="scout" ${party.length ? '' : 'disabled'}>Scout</button>
      <button class="primary" data-a="send" data-m="act" ${party.length ? '' : 'disabled'}>${prev.label}${prev.odds !== null && party.length ? ` · ${Math.round(prev.odds * 100)}%` : ''}</button>
    </div>
    <div class="hint" style="margin-top:6px">Squads away from home do not defend the colony.</div>
  </div>`;
}

function squadsPanel() {
  const rows = s.squads
    .map((q) => {
      const home = isHome(q);
      const roles = (Object.keys(ROLE_INFO) as Role[]).filter((r) => r !== q.role);
      return `<div class="squad ${chosen.has(q.id) ? 'chosen' : ''}">
        <div class="row"><b class="grow">${q.name} <span class="muted">${ROLE_INFO[q.role].label}</span></b>${pips(q)}</div>
        <div class="hint">${status(q)}</div>
        ${
          home
            ? `<div class="row">
                <button class="small ${q.assignment.type === 'guard' ? 'on' : ''}" data-a="assign" data-t="guard" data-id="${q.id}">Guard</button>
                <button class="small ${q.assignment.type === 'work' ? 'on' : ''}" data-a="assign" data-t="work" data-id="${q.id}">Work</button>
                <select id="train-${q.id}" data-a="train" data-id="${q.id}" aria-label="Train ${q.name}"><option value="">Train…</option>${roles.map((r) => `<option value="${r}">${ROLE_INFO[r].label}</option>`).join('')}</select>
                <button class="small ${mergeFrom === q.id ? 'on' : ''}" data-a="merge" data-id="${q.id}">${mergeFrom === null ? 'Merge' : mergeFrom === q.id ? 'Cancel merge' : 'Merge into this'}</button>
              </div>`
            : q.assignment.type === 'train'
              ? `<div class="row"><button class="small" data-a="recall" data-id="${q.id}">Stop training</button></div>`
              : ''
        }
      </div>`;
    })
    .join('');
  const roleHelp = (Object.keys(ROLE_INFO) as Role[]).map((r) => `<div><b>${ROLE_INFO[r].label}</b> <span class="hint">${ROLE_INFO[r].desc}</span></div>`).join('');
  return `<div class="panel"><h2>Squads · ${s.squads.length}</h2>
    <div class="hint" style="margin-bottom:8px"><span class="pip-h">●</span> fit · <span class="pip-w">●</span> wounded. Each squad eats daily. Training costs 5 supplies and takes 2 days.</div>${rows}</div>
    <div class="panel"><h2>Roles</h2>${roleHelp}</div>`;
}

function helpModal() {
  return `<div class="modal-bg"><div class="modal help"><h3>Holdfast</h3>
    <p>The valley is changing. A heart of blight is growing toward your colony from somewhere in the wilds. Find it and break it before it arrives.</p>
    <ul>
      <li><b>Wilds:</b> tap a tile, pick squads, then <b>Scout</b> to see the area or act on it: gather, salvage, rescue, clear nests, strike the heart.</li>
      <li><b>Intel goes stale.</b> When the land shifts in a direction, what you knew there is marked ~ and may be wrong.</li>
      <li><b>Colony:</b> queue walls, towers and buildings, then set squads to <b>Work</b>.</li>
      <li><b>Assaults</b> come every few days. Fresh scouting narrows the warning. Only squads at home fight.</li>
      <li>Clearing nests heals the land and weakens the heart.</li>
      <li>Press <b>Next day</b> when your orders are set.</li>
    </ul>
    <div class="opts"><button class="primary" data-a="help-close">Begin</button></div></div></div>`;
}

function modal() {
  if (s.outcome !== 'playing') {
    return `<div class="modal-bg"><div class="modal"><h3>${s.outcome === 'won' ? 'The siege is broken' : 'The light goes out'}</h3>
      <p>${s.outcomeText}</p><p class="hint">Seed ${s.seed} · ${s.day} days · ${s.assaults} assaults weathered.</p>
      <div class="opts"><button class="primary" data-a="new">Begin again</button></div></div></div>`;
  }
  if (s.battle) {
    const b = s.battle;
    const ivs: [Intervention, string, string][] = [
      ['bell', 'Ring the bell', 'Defenders fight with +60% strength this round'],
      ['fire', 'Fire the stores', 'Burn up to 8 supplies to strike the horde'],
      ['retreat', 'Sound the retreat', 'End the battle now; lose supplies and wall'],
    ];
    const horde = (Object.keys(b.horde) as (keyof typeof b.horde)[]).filter((t) => b.horde[t] > 0).map((t) => `${b.horde[t]} ${HORDE_INFO[t].label.toLowerCase()}`).join(', ');
    return `<div class="modal-bg"><div class="modal"><h3>Assault from the ${b.dir}</h3>
      <div class="hint">Remaining: ${horde || 'none'} · Interventions left: ${b.interventionsLeft}</div>
      <div class="blog">${b.log.map((l) => `<div>${l}</div>`).join('')}</div>
      <div class="opts">${
        b.done
          ? `<button class="primary" data-a="battle">Dawn</button>`
          : `<button class="primary" data-a="battle">Let the colony fight →</button>
             ${ivs.map(([id, label, hint]) => `<button data-a="battle" data-iv="${id}" ${b.interventionsLeft ? '' : 'disabled'}>${label}<br><span class="hint">${hint}</span></button>`).join('')}`
      }</div></div></div>`;
  }
  if (s.event) {
    const e = s.event;
    return `<div class="modal-bg"><div class="modal"><h3>${e.title}</h3><p>${e.text}</p>
      <div class="opts">${e.options.map((o, idx) => `<button data-a="event" data-i="${idx}">${o.label}<br><span class="hint">${o.hint}</span></button>`).join('')}</div></div></div>`;
  }
  if (showHelp) return helpModal();
  return '';
}

function bottomBar() {
  const busy = !!(s.battle || s.event || s.outcome !== 'playing');
  const t = (id: Tab, label: string) => `<button class="tab ${tab === id ? 'on' : ''}" data-a="tab" data-t="${id}">${label}</button>`;
  return `<nav class="bottom">${t('wilds', 'Wilds')}${t('colony', 'Colony')}${t('squads', 'Squads')}${t('log', 'Log')}
    <button class="primary" data-a="next" ${busy ? 'disabled' : ''}>Next day</button></nav>`;
}

function render() {
  const scrollY = window.scrollY;
  app.innerHTML = `${topBar()}
    <main class="layout wrap" data-tab="${tab}">
      <section class="col col-colony">${settlementPanel()}</section>
      <section class="col col-wilds">${today()}${grid()}${tilePanel()}</section>
      <section class="col col-squads">${squadsPanel()}</section>
      <section class="col col-log">${chronicle()}</section>
    </main>
    ${bottomBar()}
    ${modal()}
    ${toast ? `<div class="toast" role="status">${toast}</div>` : ''}`;
  window.scrollTo(0, scrollY);
}

// ───────────────────────── Input ─────────────────────────

app.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || el.tagName === 'SELECT') return;
  const d = el.dataset;
  const id = Number(d.id);
  switch (d.a) {
    case 'next':
      return act(advanceDay(s));
    case 'new':
      s = newGame(randomSeed());
      selected = null;
      chosen.clear();
      mergeFrom = null;
      return act();
    case 'tile':
      selected = { x: Number(d.x), y: Number(d.y) };
      return render();
    case 'tab':
      tab = d.t as Tab;
      render();
      return window.scrollTo(0, 0);
    case 'help':
      showHelp = true;
      return render();
    case 'help-close':
      showHelp = false;
      try {
        localStorage.setItem(HELP_KEY, '1');
      } catch {
        /* ignore */
      }
      return render();
    case 'choose':
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      return render();
    case 'assign':
      return act(assignSquad(s, id, d.t as 'guard' | 'work'));
    case 'merge':
      if (mergeFrom === null) mergeFrom = id;
      else if (mergeFrom === id) mergeFrom = null;
      else {
        const err = mergeSquads(s, id, mergeFrom);
        mergeFrom = null;
        return act(err);
      }
      return render();
    case 'recall':
      return act(recall(s, id));
    case 'send': {
      if (!selected) return;
      const err = sendExpedition(s, [...chosen], selected, d.m as 'scout' | 'act');
      if (!err) chosen.clear();
      return act(err);
    }
    case 'build':
      return act(queueProject(s, JSON.parse(d.spec!) as ProjectKind));
    case 'cancel':
      return act(cancelProject(s, id));
    case 'doc':
      return act(setDoctrine(s, { [d.k!]: d.v } as Partial<GameState['doctrine']>));
    case 'battle':
      battleStep(s, d.iv as Intervention | undefined);
      return act();
    case 'event':
      chooseEvent(s, Number(d.i));
      return act();
  }
});

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.a === 'train' && el.value) act(trainSquad(s, Number(el.dataset.id), el.value as Role));
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const tgt = ev.target as HTMLElement;
  if (tgt.tagName === 'SELECT' || tgt.tagName === 'BUTTON') return;
  if (tgt.dataset?.a === 'tile') {
    ev.preventDefault();
    tgt.click();
    return;
  }
  ev.preventDefault();
  if (s.battle) {
    battleStep(s);
    act();
  } else if (!s.event && s.outcome === 'playing') act(advanceDay(s));
});

try {
  showHelp = !localStorage.getItem(HELP_KEY);
} catch {
  showHelp = true;
}

// Keep the run across live updates of the published page.
type Hot = { snapshot?: (fn: () => unknown) => void; ready?: (fn: (d: unknown) => void) => void; data?: unknown };
const hot = (window as unknown as { claude?: { hot?: Hot } }).claude?.hot;
hot?.snapshot?.(() => s);
const start = (data: unknown) => {
  if (data && typeof data === 'object' && 'squads' in (data as object)) {
    s = data as GameState;
    showHelp = false;
  }
  render();
};
if (hot?.ready) hot.ready(start);
else start(hot?.data);
