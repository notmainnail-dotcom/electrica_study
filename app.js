'use strict';
// «Электролаба»: список схем, редактор, подача питания.

const KEY = 'elab_v1';
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const WIRE_COLORS = [['brown', 'Коричневый'], ['black', 'Чёрный'], ['white', 'Белый'], ['grey', 'Серый'], ['red', 'Красный'], ['blue', 'Голубой'], ['pe', 'Жёлто-зелёный']];
const SECTIONS = ['1.5', '2.5', '4', '6', '10'];
const RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63];

// ---------- хранение ----------
let db = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.schemes)) return Object.assign({ theme: 'auto', lastColor: 'brown', lastSec: '2.5' }, d);
  } catch (e) { /* пусто или повреждено */ }
  return { v: 1, schemes: [], theme: 'auto', lastColor: 'brown', lastSec: '2.5' };
}
let saveTimer = 0;
function saveNow() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast('Не удалось сохранить: память браузера заполнена'); }
}
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
function touch() { if (cur) cur.updated = Date.now(); save(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

function applyTheme() {
  if (db.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', db.theme);
}
applyTheme();

// ---------- общее: всплывашка и окна ----------
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function openModal(html, mount) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m) closeModal(); };
  if (mount) mount(m.firstElementChild);
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function ask({ title, text = '', value = null, ok = 'OK', danger = false }) {
  return new Promise(res => {
    openModal(`<h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ''}
      ${value !== null ? `<input id="ask-in" class="inp" value="${esc(value)}" maxlength="60">` : ''}
      <div class="row-btns"><button class="btn" data-a="no">Отмена</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(ok)}</button></div>`, sh => {
      const inp = sh.querySelector('#ask-in');
      if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') done(true); }; }
      const done = yes => { const v = inp ? inp.value.trim() : true; closeModal(); res(yes ? v : null); };
      sh.querySelector('[data-a=ok]').onclick = () => done(true);
      sh.querySelector('[data-a=no]').onclick = () => done(false);
    });
  });
}

function actions(title, items) {
  openModal(`<h3>${esc(title)}</h3><div class="act-list">${items.map((it, i) => `<button class="btn act ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>`, sh => {
    sh.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { closeModal(); items[+b.dataset.i].fn(); }; });
  });
}

// ---------- список схем ----------
function showList() {
  if (cur) { cur.view = { ...view }; saveNow(); }
  cur = null; power = false;
  $('#scr-ed').hidden = true; $('#scr-list').hidden = false;
  renderList();
}

function renderList() {
  const el = $('#list');
  if (!db.schemes.length) {
    el.innerHTML = `<div class="empty"><div class="empty-ic">⚡</div><p><b>Здесь будут твои схемы.</b></p>
      <p class="muted">Нажми «Новая схема», расставь устройства и соедини клеммы проводами. Потом подай питание и пощёлкай выключателями.</p></div>`;
    return;
  }
  const fmt = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  el.innerHTML = [...db.schemes].sort((a, b) => b.updated - a.updated).map(s => `
    <div class="card" data-id="${s.id}">
      <div class="c-main"><div class="c-name">${esc(s.name)}</div>
      <div class="c-meta">${s.devices.length} устр. · ${s.wires.length} пров. · ${fmt(s.updated)}</div></div>
      <button class="c-more" data-more="${s.id}" aria-label="Действия">⋯</button>
    </div>`).join('');
}

$('#list').onclick = e => {
  const more = e.target.closest('[data-more]');
  if (more) { schemeMenu(more.dataset.more); return; }
  const card = e.target.closest('.card');
  if (card) openScheme(card.dataset.id);
};

function newDevice(type, x, y) {
  const p = PARTS[type];
  const init = p.init || {};
  return { id: uid(), type, x, y, rot: 0, state: JSON.parse(JSON.stringify(init.state || {})), props: JSON.parse(JSON.stringify(init.props || {})) };
}

$('#btn-new').onclick = async () => {
  const name = await ask({ title: 'Новая схема', value: `Схема ${db.schemes.length + 1}`, ok: 'Создать' });
  if (!name) return;
  const s = { id: uid(), name, created: Date.now(), updated: Date.now(), devices: [newDevice('src', 0, -150)], wires: [], view: null };
  db.schemes.push(s); saveNow();
  openScheme(s.id);
};

function schemeMenu(id) {
  const s = db.schemes.find(x => x.id === id);
  actions(s.name, [
    { label: 'Переименовать', fn: async () => { const n = await ask({ title: 'Название схемы', value: s.name, ok: 'Сохранить' }); if (n) { s.name = n; saveNow(); renderList(); } } },
    { label: 'Сделать копию', fn: () => { const c = JSON.parse(JSON.stringify(s)); c.id = uid(); c.name = s.name + ' (копия)'; c.updated = Date.now(); db.schemes.push(c); saveNow(); renderList(); } },
    { label: 'Удалить', danger: true, fn: async () => { if (await ask({ title: 'Удалить схему?', text: `«${s.name}» пропадёт без возврата.`, ok: 'Удалить', danger: true }) !== null) { db.schemes = db.schemes.filter(x => x !== s); saveNow(); renderList(); } } }
  ]);
}

// ---------- настройки и резервная копия ----------
$('#btn-settings').onclick = () => {
  const themes = [['auto', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']];
  openModal(`<h3>Настройки</h3>
    <div class="p-lbl">Тема</div>
    <div class="chips">${themes.map(([v, n]) => `<button class="chip ${db.theme === v ? 'on' : ''}" data-theme="${v}">${n}</button>`).join('')}</div>
    <div class="p-lbl">Резервная копия</div>
    <p class="muted">Схемы хранятся только на этом устройстве. Скопируй текст копии и сохрани в заметках или отправь себе. Чтобы восстановить, вставь текст в поле ниже.</p>
    <div class="row-btns"><button class="btn primary" id="bk-copy">Скопировать копию</button></div>
    <textarea id="bk-text" class="inp" rows="4" placeholder="Вставь сюда текст копии"></textarea>
    <div class="row-btns"><button class="btn" id="bk-load">Восстановить из текста</button><button class="btn" data-close>Закрыть</button></div>`, sh => {
    sh.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => {
      db.theme = b.dataset.theme; applyTheme(); saveNow();
      sh.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
    });
    sh.querySelector('[data-close]').onclick = closeModal;
    sh.querySelector('#bk-copy').onclick = async () => {
      const txt = JSON.stringify({ app: 'elab', v: 1, schemes: db.schemes });
      try { await navigator.clipboard.writeText(txt); toast('Копия в буфере обмена'); } catch (e) {
        const ta = sh.querySelector('#bk-text'); ta.value = txt; ta.select(); toast('Выдели текст в поле и скопируй вручную');
      }
    };
    sh.querySelector('#bk-load').onclick = async () => {
      let data;
      try { data = JSON.parse(sh.querySelector('#bk-text').value); } catch (e) { toast('Это не похоже на копию Электролабы'); return; }
      if (!data || data.app !== 'elab' || !Array.isArray(data.schemes)) { toast('Это не похоже на копию Электролабы'); return; }
      if (await ask({ title: 'Заменить все схемы?', text: `В копии схем: ${data.schemes.length}. Текущие схемы будут заменены.`, ok: 'Заменить', danger: true }) === null) return;
      db.schemes = data.schemes; saveNow(); renderList(); toast('Схемы восстановлены');
    };
  });
};

// ---------- редактор ----------
const cv = $('#cv'), world = $('#world'), wrap = $('#cv-wrap');
let cur = null;               // открытая схема
let view = { x: 0, y: 0, k: 1 }; // левый верхний угол в мировых координатах и масштаб
let sel = null;               // { kind: 'dev' | 'wire', id }
let pending = null;           // первая клемма провода, выбранная тапом: { d, t }
let rubber = null;            // провод, который тянут пальцем: { from: {d,t}, x, y }
let power = false;
let sim = null;
let hist = [], fut = [];

const devById = id => cur.devices.find(d => d.id === id);
const wireById = id => cur.wires.find(w => w.id === id);

function openScheme(id) {
  cur = db.schemes.find(s => s.id === id);
  hist = []; fut = []; sel = null; pending = null; rubber = null; power = false;
  $('#scr-list').hidden = true; $('#scr-ed').hidden = false;
  $('#ed-name').textContent = cur.name;
  requestAnimationFrame(() => {
    if (cur.view) view = { ...cur.view }; else fit();
    render(); renderPanel();
  });
}

$('#btn-back').onclick = showList;
$('#ed-name').onclick = async () => {
  const n = await ask({ title: 'Название схемы', value: cur.name, ok: 'Сохранить' });
  if (n) { cur.name = n; $('#ed-name').textContent = n; touch(); }
};

// история для отмены
function snapshot() {
  hist.push(JSON.stringify({ devices: cur.devices, wires: cur.wires }));
  if (hist.length > 100) hist.shift();
  fut = [];
}
function restore(json) {
  const s = JSON.parse(json);
  cur.devices = s.devices; cur.wires = s.wires;
  if (sel && !(sel.kind === 'dev' ? devById(sel.id) : wireById(sel.id))) sel = null;
  pending = null;
  touch(); evaluatePower(); render(); renderPanel();
}
function undo() { if (!hist.length) return; fut.push(JSON.stringify({ devices: cur.devices, wires: cur.wires })); restore(hist.pop()); }
function redo() { if (!fut.length) return; hist.push(JSON.stringify({ devices: cur.devices, wires: cur.wires })); restore(fut.pop()); }
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;

// ---------- питание ----------
$('#btn-power').onclick = () => {
  power = !power;
  if (power) evaluatePower();
  render();
  if (power && cur.devices.some(d => d.type === 'src')) toast('Питание подано. Нажимай на выключатели');
  else if (power) toast('На схеме нет ввода 220 В');
};

// при КЗ выбивает автомат; если автомата нет — снимаем питание целиком
function evaluatePower() {
  if (!power) return;
  for (let guard = 0; guard < 30; guard++) {
    const s = simulate(cur);
    if (!s.short) return;
    const b = findTrip(cur);
    if (b) {
      b.state.on = false; b.state.trip = true; touch();
      toast(`Короткое замыкание! Выбило автомат ${b.props.ch}${b.props.a}${b.props.label ? ' «' + b.props.label + '»' : ''}`);
    } else {
      power = false;
      toast('Короткое замыкание до автоматов: питание снято. Проверь схему');
      return;
    }
  }
}

// ---------- рисование ----------
function devSvg(d) {
  const p = PARTS[d.type];
  const h = {};
  if (sim) for (const t of p.terms(d)) h[t.id] = sim.cls(tkey(d.id, t.id)) === 'L';
  const s = { lit: !!(sim && sim.lit.has(d.id)), live: !!(sim && sim.live.has(d.id)) };
  return `<g transform="translate(${d.x} ${d.y}) rotate(${(d.rot || 0) * 90})">${p.draw(d, h, s)}</g>`;
}

// ближайшая точка рамки к клемме (там начинается вывод), shrink — отступ внутрь для подписи
function edgePoint(d, t, shrink = 0) {
  const [x, y, w, h] = PARTS[d.type].box(d);
  return [clamp(t.x, x + shrink, x + w - shrink), clamp(t.y, y + shrink, y + h - shrink)];
}

function termsSvg(d) {
  let out = '';
  for (const t of termsOf(d)) {
    const [wx, wy] = termPos(d, t);
    const [ex, ey] = edgePoint(d, t);
    const [lx, ly] = rotP(ex, ey, d.rot);
    const hot = sim && sim.cls(tkey(d.id, t.id)) === 'L';
    const pend = (pending && pending.d === d.id && pending.t === t.id) || (rubber && rubber.from.d === d.id && rubber.from.t === t.id);
    out += `<line class="lead" x1="${d.x + lx}" y1="${d.y + ly}" x2="${wx}" y2="${wy}"/>`;
    if (pend) out += `<circle class="pend-ring" cx="${wx}" cy="${wy}" r="11"/>`;
    out += `<circle class="term k-${t.kind}${hot ? ' hot' : ''}" cx="${wx}" cy="${wy}" r="4.5"/>`;
    if (t.label) {
      const [ix, iy] = edgePoint(d, t, 7);
      const [rx, ry] = rotP(ix + t.dx, iy, d.rot);
      out += `<text class="t-term" x="${d.x + rx}" y="${d.y + ry + 3}">${esc(t.label)}</text>`;
    }
  }
  return out;
}

function labelSvg(d) {
  const p = PARTS[d.type];
  if (p.noLabel || !d.props.label) return '';
  const b = worldBox(d, true);
  return `<text class="dlbl" x="${(b[0] + b[2]) / 2}" y="${b[3] + 16}">${esc(d.props.label)}</text>`;
}

function wireSvg(w) {
  const P = wirePts(cur, w);
  if (!P) return '';
  const path = 'M' + P.map(p => p.join(' ')).join(' L');
  const hot = sim && sim.cls(tkey(w.a.d, w.a.t)) === 'L';
  let s = '';
  if (sel && sel.kind === 'wire' && sel.id === w.id) s += `<path class="w-sel" d="${path}"/>`;
  if (hot) s += `<path class="w-hot" d="${path}"/>`;
  s += `<path class="w-case" d="${path}"/>`;
  if (w.color === 'pe') s += `<path class="w-core" style="stroke:var(--w-yellow)" d="${path}"/><path class="w-core w-stripe" style="stroke:var(--w-green)" d="${path}"/>`;
  else s += `<path class="w-core" style="stroke:var(--w-${w.color})" d="${path}"/>`;
  return s;
}

function selSvg() {
  if (!sel) return '';
  if (sel.kind === 'dev') {
    const d = devById(sel.id);
    if (!d) return '';
    const [x1, y1, x2, y2] = worldBox(d);
    return `<rect class="sel-box" x="${x1 - 6}" y="${y1 - 6}" width="${x2 - x1 + 12}" height="${y2 - y1 + 12}" rx="6"/>`;
  }
  const w = wireById(sel.id);
  const P = w && wirePts(cur, w);
  if (!P) return '';
  const r = 1 / view.k;
  let s = '';
  for (let i = 0; i < P.length - 1; i++) {
    const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
    s += `<circle class="h-mid" cx="${mx}" cy="${my}" r="${5 * r}" style="stroke-width:${1.5 * r}"/>`;
  }
  for (let i = 1; i < P.length - 1; i++) s += `<circle class="h-bend" cx="${P[i][0]}" cy="${P[i][1]}" r="${6 * r}" style="stroke-width:${1.5 * r}"/>`;
  return s;
}

function render() {
  if (!cur) return;
  sim = power ? simulate(cur) : null;
  const out = [];
  for (const d of cur.devices) if (PARTS[d.type].isBox) out.push(devSvg(d));
  for (const w of cur.wires) out.push(wireSvg(w));
  for (const d of cur.devices) if (!PARTS[d.type].isBox) out.push(devSvg(d));
  for (const d of cur.devices) out.push(termsSvg(d));
  for (const d of cur.devices) out.push(labelSvg(d));
  out.push(selSvg());
  if (rubber) {
    const fd = devById(rubber.from.d), ft = fd && termsOf(fd).find(t => t.id === rubber.from.t);
    if (ft) { const [x, y] = termPos(fd, ft); out.push(`<line class="rubber" x1="${x}" y1="${y}" x2="${rubber.x}" y2="${rubber.y}"/>`); }
  }
  world.innerHTML = out.join('');
  world.setAttribute('transform', `translate(${-view.x * view.k} ${-view.y * view.k}) scale(${view.k})`);

  const g = GRID * 2 * view.k, G = g * 5;
  const ox = -view.x * view.k, oy = -view.y * view.k;
  wrap.style.backgroundSize = `${G}px ${G}px, ${G}px ${G}px, ${g}px ${g}px, ${g}px ${g}px`;
  wrap.style.backgroundPosition = `${ox}px ${oy}px`;

  $('#btn-undo').disabled = !hist.length;
  $('#btn-redo').disabled = !fut.length;
  const pb = $('#btn-power');
  pb.classList.toggle('on', power);
  pb.textContent = power ? '⚡ ВКЛ' : '⚡ ВЫКЛ';
  wrap.classList.toggle('powered', power);
  renderHint();
}

function renderHint() {
  let h = '';
  if (pending || rubber) h = 'Теперь нажми на вторую клемму. Отмена: тап по пустому месту';
  else if (sel && sel.kind === 'wire') h = 'Тяни кружок на проводе, чтобы изогнуть. Тап по точке изгиба убирает её';
  else if (cur.devices.length <= 1 && !cur.wires.length) h = 'Добавь устройства кнопкой «Устройство». Провод: нажми на клемму, потом на вторую';
  else if (power) h = 'Под напряжением: нажимай на выключатели и автоматы';
  const el = $('#hint');
  el.textContent = h; el.hidden = !h;
}

// ---------- панель свойств ----------
function renderPanel() {
  const el = $('#panel');
  if (!sel) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if (sel.kind === 'wire') {
    const w = wireById(sel.id);
    el.innerHTML = `<div class="p-head"><b>Провод</b>
      ${w.pts && w.pts.length ? '<button class="ib" data-act="straight" title="Выпрямить" aria-label="Выпрямить">⟋</button>' : ''}
      <button class="ib danger" data-act="del" title="Удалить" aria-label="Удалить">🗑</button><button class="ib" data-act="close" aria-label="Закрыть">✕</button></div>
      <div class="chips">${WIRE_COLORS.map(([c, n]) => `<button class="sw sw-${c} ${w.color === c ? 'on' : ''}" data-color="${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
      <div class="chips">${SECTIONS.map(s => `<button class="chip ${w.sec === s ? 'on' : ''}" data-sec="${s}">${s.replace('.', ',')}</button>`).join('')}<span class="muted unit">мм²</span></div>`;
    return;
  }
  const d = devById(sel.id), p = PARTS[d.type];
  let extra = '';
  if (d.type === 'brk') {
    extra = `<div class="chips">${['B', 'C'].map(c => `<button class="chip ${d.props.ch === c ? 'on' : ''}" data-ch="${c}">${c}</button>`).join('')}
      <span class="sep"></span>${RATINGS.map(a => `<button class="chip ${d.props.a === a ? 'on' : ''}" data-a="${a}">${a}</button>`).join('')}<span class="muted unit">А</span></div>`;
  }
  if (d.type === 'jbox') {
    extra = `<div class="chips">${[['S', 'Малая'], ['M', 'Средняя'], ['L', 'Большая']].map(([v, n]) => `<button class="chip ${d.props.size === v ? 'on' : ''}" data-size="${v}">${n}</button>`).join('')}</div>`;
  }
  el.innerHTML = `<div class="p-head"><b>${esc(p.name)}</b>
      ${p.noRotate ? '' : '<button class="ib" data-act="rot" title="Повернуть (R)" aria-label="Повернуть">⟳</button>'}
      <button class="ib" data-act="dup" title="Копия" aria-label="Копия">⧉</button>
      <button class="ib danger" data-act="del" title="Удалить" aria-label="Удалить">🗑</button><button class="ib" data-act="close" aria-label="Закрыть">✕</button></div>
    <input class="inp" id="p-label" value="${esc(d.props.label || '')}" placeholder="${d.type === 'text' ? 'Текст' : 'Подпись, например «Кухня»'}" maxlength="40">
    ${extra}`;
  const inp = el.querySelector('#p-label');
  inp.onfocus = () => snapshot();
  inp.oninput = () => { d.props.label = inp.value; touch(); render(); };
}

$('#panel').onclick = e => {
  const b = e.target.closest('button');
  if (!b || !sel) return;
  const act = b.dataset.act;
  if (act === 'close') { sel = null; render(); renderPanel(); return; }
  if (act === 'del') { deleteSel(); return; }
  if (sel.kind === 'wire') {
    const w = wireById(sel.id);
    if (b.dataset.color) { snapshot(); w.color = b.dataset.color; db.lastColor = w.color; }
    else if (b.dataset.sec) { snapshot(); w.sec = b.dataset.sec; db.lastSec = w.sec; }
    else if (act === 'straight') { snapshot(); w.pts = []; }
    else return;
  } else {
    const d = devById(sel.id);
    if (act === 'rot') { snapshot(); d.rot = ((d.rot || 0) + 1) % 4; }
    else if (act === 'dup') {
      snapshot();
      const c = JSON.parse(JSON.stringify(d)); c.id = uid(); c.x += 40; c.y += 40;
      if (c.type === 'brk') c.state = { on: true };
      cur.devices.push(c); sel = { kind: 'dev', id: c.id };
    }
    else if (b.dataset.ch) { snapshot(); d.props.ch = b.dataset.ch; }
    else if (b.dataset.a) { snapshot(); d.props.a = +b.dataset.a; }
    else if (b.dataset.size) { snapshot(); d.props.size = b.dataset.size; }
    else return;
  }
  touch(); evaluatePower(); render(); renderPanel();
};

function deleteSel() {
  if (!sel) return;
  snapshot();
  if (sel.kind === 'wire') cur.wires = cur.wires.filter(w => w.id !== sel.id);
  else {
    cur.devices = cur.devices.filter(d => d.id !== sel.id);
    cur.wires = cur.wires.filter(w => w.a.d !== sel.id && w.b.d !== sel.id);
  }
  sel = null;
  touch(); evaluatePower(); render(); renderPanel();
}

// ---------- палитра устройств ----------
function miniSvg(type) {
  const d = newDevice(type, 0, 0);
  if (type === 'jbox') d.props.size = 'S';
  const p = PARTS[type];
  const [x, y, w, h] = p.box(d);
  let x1 = x, y1 = y, x2 = x + w, y2 = y + h;
  let terms = '';
  for (const t of p.terms(d)) {
    x1 = Math.min(x1, t.x); y1 = Math.min(y1, t.y); x2 = Math.max(x2, t.x); y2 = Math.max(y2, t.y);
    const [ex, ey] = edgePoint(d, t);
    terms += `<line class="lead" x1="${ex}" y1="${ey}" x2="${t.x}" y2="${t.y}"/><circle class="term k-${t.kind}" cx="${t.x}" cy="${t.y}" r="4.5"/>`;
  }
  const pad = 8;
  return `<svg class="mini" viewBox="${x1 - pad} ${y1 - pad} ${x2 - x1 + pad * 2} ${y2 - y1 + pad * 2}">${p.draw(d, {}, {})}${terms}</svg>`;
}

$('#btn-add').onclick = () => {
  openModal(`<h3>Добавить устройство</h3>${GROUPS.map(g => `<div class="p-lbl">${g}</div><div class="pal">${
    Object.keys(PARTS).filter(k => PARTS[k].group === g).map(k => `<button class="pal-it" data-type="${k}">${miniSvg(k)}<span>${esc(PARTS[k].name)}</span></button>`).join('')
  }</div>`).join('')}`, sh => {
    sh.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { closeModal(); addDevice(b.dataset.type); });
  });
};

function addDevice(type) {
  const r = cv.getBoundingClientRect();
  const cx = snap(view.x + r.width / 2 / view.k), cy = snap(view.y + r.height / 2 / view.k);
  const d = newDevice(type, cx, cy);
  // ищем свободное место по спирали вокруг центра экрана, чтобы не ставить поверх другого устройства
  if (!PARTS[type].isBox) {
    const busy = (x, y) => {
      d.x = x; d.y = y;
      const [a1, b1, a2, b2] = worldBox(d, true);
      return cur.devices.some(o => !PARTS[o.type].isBox && (([c1, e1, c2, e2]) => a1 < c2 + 20 && a2 > c1 - 20 && b1 < e2 + 20 && b2 > e1 - 20)(worldBox(o, true)));
    };
    let found = false;
    for (let ring = 0; ring < 12 && !found; ring++) {
      for (let i = -ring; i <= ring && !found; i++) for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        if (!busy(cx + dx * 40, cy + dy * 40)) { found = true; break; }
      }
    }
    if (!found) { d.x = cx; d.y = cy; }
  }
  snapshot();
  cur.devices.push(d);
  sel = { kind: 'dev', id: d.id }; pending = null;
  touch(); evaluatePower(); render(); renderPanel();
}

// ---------- провода ----------
function guessColor(a, b) {
  const kinds = netKinds(cur);
  const all = new Set([...kinds(tkey(a.d, a.t)), ...kinds(tkey(b.d, b.t))]);
  if (all.has('PE')) return 'pe';
  if (all.has('N')) return 'blue';
  if (all.has('L')) return 'brown';
  return db.lastColor;
}
function guessSec(a, b) {
  const types = [devById(a.d).type, devById(b.d).type];
  if (types.includes('sock')) return '2.5';
  if (types.some(t => ['lamp', 'sw1', 'sw2', 'swp', 'swx'].includes(t))) return '1.5';
  return db.lastSec;
}

function makeWire(a, b) {
  if (a.d === b.d && a.t === b.t) return;
  const same = w => (w.a.d === a.d && w.a.t === a.t && w.b.d === b.d && w.b.t === b.t) || (w.a.d === b.d && w.a.t === b.t && w.b.d === a.d && w.b.t === a.t);
  if (cur.wires.some(same)) { toast('Эти клеммы уже соединены'); return; }
  snapshot();
  const w = { id: uid(), a, b, color: guessColor(a, b), sec: guessSec(a, b), pts: [] };
  cur.wires.push(w);
  sel = { kind: 'wire', id: w.id };
  touch(); evaluatePower();
}

// ---------- попадание пальцем ----------
function distSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function hitTest(x, y) {
  const k = view.k;
  // ручки выбранного провода
  if (sel && sel.kind === 'wire') {
    const w = wireById(sel.id), P = w && wirePts(cur, w);
    if (P) {
      for (let i = 1; i < P.length - 1; i++) if (Math.hypot(P[i][0] - x, P[i][1] - y) < 16 / k) return { kind: 'bend', w, i: i - 1 };
      for (let i = 0; i < P.length - 1; i++) {
        const mx = (P[i][0] + P[i + 1][0]) / 2, my = (P[i][1] + P[i + 1][1]) / 2;
        if (Math.hypot(mx - x, my - y) < 14 / k) return { kind: 'mid', w, i };
      }
    }
  }
  // клеммы
  let best = null, bd = Math.max(16 / k, 9);
  for (const d of cur.devices) for (const t of termsOf(d)) {
    const [tx, ty] = termPos(d, t), dd = Math.hypot(tx - x, ty - y);
    if (dd < bd) { bd = dd; best = { kind: 'term', d, t }; }
  }
  if (best) return best;
  // устройства (сверху вниз), кроме коробок
  for (let i = cur.devices.length - 1; i >= 0; i--) {
    const d = cur.devices[i], p = PARTS[d.type];
    if (p.isBox) continue;
    const [lx, ly] = toLocal(d, x, y), [bx, by, bw, bh] = p.box(d), pad = 4 / k;
    if (lx >= bx - pad && lx <= bx + bw + pad && ly >= by - pad && ly <= by + bh + pad) return { kind: 'dev', d, lx, ly };
  }
  // провода
  for (let i = cur.wires.length - 1; i >= 0; i--) {
    const w = cur.wires[i], P = wirePts(cur, w);
    if (!P) continue;
    for (let j = 0; j < P.length - 1; j++) if (distSeg(x, y, P[j], P[j + 1]) < 9 / k) return { kind: 'wire', w };
  }
  // коробки: только за обод и надпись, чтобы внутри можно было двигать поле
  for (let i = cur.devices.length - 1; i >= 0; i--) {
    const d = cur.devices[i];
    if (!PARTS[d.type].isBox) continue;
    const r = PARTS.jbox.r(d), dist = Math.hypot(x - d.x, y - d.y);
    if (Math.abs(dist - r) < 12 / k || (Math.abs(x - d.x) < 40 && y > d.y - r && y < d.y - r + 30)) return { kind: 'dev', d, lx: 0, ly: 0 };
  }
  return null;
}

// ---------- жесты ----------
const ptrs = new Map();
let gest = null;

function canvasXY(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function toWorld(px, py) { return [view.x + px / view.k, view.y + py / view.k]; }

cv.addEventListener('pointerdown', e => {
  if (!cur) return;
  cv.setPointerCapture(e.pointerId);
  const [px, py] = canvasXY(e);
  ptrs.set(e.pointerId, [px, py]);
  if (ptrs.size === 2) {
    // два пальца: масштаб и сдвиг; начатое действие отменяем
    if (gest && gest.type === 'move' && gest.moved) { /* перенос оставляем как есть */ }
    rubber = null;
    const [a, b] = [...ptrs.values()];
    gest = { type: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], v0: { ...view } };
    render();
    return;
  }
  if (ptrs.size > 2) return;
  const [wx, wy] = toWorld(px, py);
  gest = { type: 'tap', hit: hitTest(wx, wy), sx: px, sy: py, wx, wy, v0: { ...view }, moved: false };
});

cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !gest) return;
  const [px, py] = canvasXY(e);
  ptrs.set(e.pointerId, [px, py]);
  if (gest.type === 'pinch') {
    if (ptrs.size < 2) return;
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const v0 = gest.v0, k = clamp(v0.k * d / gest.d0, 0.25, 4);
    const wx = v0.x + gest.m0[0] / v0.k, wy = v0.y + gest.m0[1] / v0.k;
    view = { x: wx - m[0] / k, y: wy - m[1] / k, k };
    render();
    return;
  }
  const [wx, wy] = toWorld(px, py);
  if (!gest.moved) {
    if (Math.hypot(px - gest.sx, py - gest.sy) < 6) return;
    gest.moved = true;
    startDrag(gest);
  }
  dragMove(gest, px, py, wx, wy);
});

function startDrag(g) {
  const h = g.hit;
  if (h && h.kind === 'term') { g.type = 'wire'; pending = null; rubber = { from: { d: h.d.id, t: h.t.id }, x: g.wx, y: g.wy }; return; }
  if (h && h.kind === 'dev') {
    g.type = 'move'; snapshot();
    const d = h.d;
    g.items = [{ d, x: d.x, y: d.y }];
    g.bends = [];
    if (PARTS[d.type].isBox) {
      // коробка тащит за собой всё, что внутри
      const r = PARTS.jbox.r(d);
      for (const o of cur.devices) if (o !== d && !PARTS[o.type].isBox && Math.hypot(o.x - d.x, o.y - d.y) < r) g.items.push({ d: o, x: o.x, y: o.y });
      for (const w of cur.wires) (w.pts || []).forEach(p => { if (Math.hypot(p[0] - d.x, p[1] - d.y) < r) g.bends.push({ p, x: p[0], y: p[1] }); });
    }
    return;
  }
  if (h && (h.kind === 'bend' || h.kind === 'mid')) {
    g.type = 'bend'; snapshot();
    const w = h.w;
    w.pts = w.pts || [];
    if (h.kind === 'mid') { w.pts.splice(h.i, 0, [snap(g.wx), snap(g.wy)]); g.bi = h.i; } else g.bi = h.i;
    g.w = w;
    return;
  }
  g.type = 'pan';
}

function dragMove(g, px, py, wx, wy) {
  if (g.type === 'pan') {
    view.x = g.v0.x - (px - g.sx) / view.k;
    view.y = g.v0.y - (py - g.sy) / view.k;
  } else if (g.type === 'move') {
    const dx = snap(wx - g.wx), dy = snap(wy - g.wy);
    for (const it of g.items) { it.d.x = it.x + dx; it.d.y = it.y + dy; }
    for (const b of g.bends) { b.p[0] = b.x + dx; b.p[1] = b.y + dy; }
  } else if (g.type === 'bend') {
    g.w.pts[g.bi] = [snap(wx), snap(wy)];
  } else if (g.type === 'wire') {
    rubber.x = wx; rubber.y = wy;
  }
  render();
}

function endPointer(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (!gest) return;
  if (gest.type === 'pinch') {
    if (ptrs.size === 0) { gest = null; saveView(); }
    else gest = { type: 'none' };
    return;
  }
  if (gest.type === 'none') { if (!ptrs.size) gest = null; return; }
  const g = gest; gest = null;
  if (e.type === 'pointercancel') { rubber = null; render(); return; }
  if (!g.moved) { tap(g.hit); return; }
  if (g.type === 'wire') {
    const [px, py] = canvasXY(e), [wx, wy] = toWorld(px, py);
    const h = hitTest(wx, wy);
    const from = rubber.from;
    rubber = null;
    if (h && h.kind === 'term') makeWire(from, { d: h.d.id, t: h.t.id });
    render(); renderPanel();
    return;
  }
  if (g.type === 'move' || g.type === 'bend') touch();
  if (g.type === 'pan') saveView();
  render();
  if (g.type === 'bend') renderPanel();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

function saveView() { if (cur) { cur.view = { ...view }; save(); } }

function tap(h) {
  if (!h) { sel = null; pending = null; render(); renderPanel(); return; }
  if (h.kind === 'term') {
    const t = { d: h.d.id, t: h.t.id };
    if (pending && !(pending.d === t.d && pending.t === t.t)) { const from = pending; pending = null; makeWire(from, t); }
    else if (pending) pending = null;
    else { pending = t; sel = null; }
    render(); renderPanel();
    return;
  }
  pending = null;
  if (h.kind === 'bend') {
    snapshot(); h.w.pts.splice(h.i, 1); touch();
    render(); renderPanel(); return;
  }
  if (h.kind === 'mid' || h.kind === 'wire') { sel = { kind: 'wire', id: h.w.id }; render(); renderPanel(); return; }
  if (h.kind === 'dev') {
    const d = h.d, p = PARTS[d.type];
    if (p.toggle && p.toggle(d, h.lx, h.ly)) { touch(); evaluatePower(); }
    sel = { kind: 'dev', id: d.id };
    render(); renderPanel();
  }
}

// колесо мыши: масштаб вокруг курсора
cv.addEventListener('wheel', e => {
  if (!cur) return;
  e.preventDefault();
  const [px, py] = canvasXY(e);
  zoomAt(px, py, Math.pow(1.0015, -e.deltaY));
}, { passive: false });

function zoomAt(px, py, f) {
  const k = clamp(view.k * f, 0.25, 4);
  const wx = view.x + px / view.k, wy = view.y + py / view.k;
  view = { x: wx - px / k, y: wy - py / k, k };
  render(); saveView();
}
const zoomCenter = f => { const r = cv.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); };
$('#btn-zin').onclick = () => zoomCenter(1.25);
$('#btn-zout').onclick = () => zoomCenter(0.8);

// вписать всю схему в экран
function fit() {
  const r = cv.getBoundingClientRect();
  if (!cur.devices.length) { view = { x: -r.width / 2, y: -r.height / 2, k: 1 }; return; }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const d of cur.devices) { const b = worldBox(d, true); x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]); x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3] + 20); }
  for (const w of cur.wires) for (const p of w.pts || []) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
  const m = 40, k = clamp(Math.min((r.width - m * 2) / (x2 - x1), (r.height - m * 2) / (y2 - y1)), 0.25, 1.4);
  view = { x: (x1 + x2) / 2 - r.width / 2 / k, y: (y1 + y2) / 2 - r.height / 2 / k, k };
}
$('#btn-fit').onclick = () => { fit(); render(); saveView(); };

window.addEventListener('resize', () => { if (cur) render(); });

// клавиатура на компьютере
document.addEventListener('keydown', e => {
  if (!cur || !$('#modal').hidden) return;
  if (e.target.closest('input, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (e.code === 'KeyR' && sel && sel.kind === 'dev' && !PARTS[devById(sel.id).type].noRotate) { snapshot(); const d = devById(sel.id); d.rot = ((d.rot || 0) + 1) % 4; touch(); render(); }
  else if (e.key === 'Escape') { sel = null; pending = null; rubber = null; render(); renderPanel(); }
});

renderList();

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
