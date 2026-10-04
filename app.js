'use strict';
// «Электролаба»: список схем, редактор, подача питания.

const KEY = 'elab_v1';
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const GRID = 10;
const snap = v => Math.round(v / GRID) * GRID;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const WIRE_COLORS = [['white', 'Белый'], ['brown', 'Коричневый'], ['black', 'Чёрный'], ['grey', 'Серый'], ['red', 'Красный'], ['blue', 'Голубой'], ['pe', 'Жёлто-зелёный']];
const SECTIONS = ['1.5', '2.5', '4', '6', '10'];
const WIRE_W = { '1.5': 2.4, '2.5': 3.6, '4': 5, '6': 6.4, '10': 8.6 };
const fmtA = i => i.toFixed(1).replace('.', ',') + ' А';
const RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63];
const ICON_DEL = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

// ---------- хранение ----------
let db = load();
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.schemes)) {
      // фаза по умолчанию стала белой (раньше коричневой)
      if (!d.whitePhase) { if (d.lastColor === 'brown') d.lastColor = 'white'; d.whitePhase = true; }
      return Object.assign({ theme: 'auto', lastColor: 'white', lastSec: '2.5' }, d);
    }
  } catch (e) { /* пусто или повреждено */ }
  return { v: 1, schemes: [], theme: 'auto', lastColor: 'white', lastSec: '2.5' };
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
let issues = [], issuesSig = '', showIssues = false; // проверка по ПУЭ
let meter = null;             // мультиметр: { a, b } — точки щупов (клемма {d,t} или конец провода {w,side})

const devById = id => cur.devices.find(d => d.id === id);
const wireById = id => cur.wires.find(w => w.id === id);

function openScheme(id) {
  cur = db.schemes.find(s => s.id === id);
  // у старых схем могут не быть новых настроек устройств — дописываем значения по умолчанию
  for (const d of cur.devices) {
    const init = PARTS[d.type]?.init || {};
    for (const [k, v] of Object.entries(init.props || {})) if (d.props[k] === undefined) d.props[k] = JSON.parse(JSON.stringify(v));
    for (const [k, v] of Object.entries(init.state || {})) if (d.state[k] === undefined) d.state[k] = v;
  }
  hist = []; fut = []; sel = null; pending = null; rubber = null; power = false;
  showIssues = false; meter = null; issuesSig = '';
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
  if (power && !cur.devices.some(d => d.type === 'src' || d.type === 'src3')) toast('На схеме нет ввода: добавь «Ввод 220 В» или «Ввод 380 В»');
};

// при КЗ выбивает автомат; если автомата нет — снимаем питание целиком
function evaluatePower() {
  if (!power) return;
  for (let guard = 0; guard < 30; guard++) {
    const s = simulate(cur);
    if (!s.short) {
      // перегрузка: больше 1,45 номинала автомат отключается (тепловой расцепитель)
      const I = breakerCurrents(cur, s);
      // если перегружено несколько, первым отключается самый перегруженный
      const over = cur.devices.filter(d => I.get(d.id) > d.props.a * 1.45).sort((a, b) => I.get(b.id) / b.props.a - I.get(a.id) / a.props.a)[0];
      if (over) {
        over.state.on = false; over.state.trip = true; touch();
        const k = I.get(over.id) / over.props.a, mag = over.props.ch === 'B' ? 5 : 10;
        const name = `${over.props.ch}${over.props.a}${over.props.label ? ' «' + over.props.label + '»' : ''}`;
        toast(k >= mag
          ? `${fmtA(I.get(over.id))} — это ${Math.round(k)} номиналов. Автомат ${name} отключился мгновенно (электромагнитный расцепитель)`
          : `Перегрузка: ${fmtA(I.get(over.id))} при номинале ${over.props.a} А. Автомат ${name} отключился (тепловой расцепитель — в жизни за секунды или минуты)`);
        continue;
      }
      const r = findLeak(cur);
      if (!r) return;
      r.state.on = false; r.state.trip = true; touch();
      toast(`Сработало УЗО ${r.props.ma} мА${r.props.label ? ' «' + r.props.label + '»' : ''}: ток ушёл мимо его нуля — через PE или ноль другой группы`);
      continue;
    }
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
  if (sim) for (const t of p.terms(d)) h[t.id] = isHot(sim.cls(tkey(d.id, t.id)));
  if (sim && p.comb) for (const t of combTeeth(cur, d)) h[t.i] = t.keys.some(k => isHot(sim.cls(k)));
  const ok = !!(sim && sim.loads.get(d.id)?.st === 'ok');
  const s = { lit: ok && !!PARTS[d.type].light, live: ok && d.type.startsWith('sock'), on: ok };
  if (sim && d.type === 'rn') {
    // реле показывает напряжение, только если к нему пришли и фаза, и ноль
    const n = sim.cls(tkey(d.id, 'N'));
    s.u = isHot(sim.cls(tkey(d.id, 'L'))) && (n === 'N' || n === 'PE') ? netU(cur) : null;
  }
  return `<g transform="translate(${d.x} ${d.y}) rotate(${(d.rot || 0) * 90})">${p.draw(d, h, s)}</g>`;
}

const samePend = (e) => pending && (isFree(pending) ? pending.w === e.w && pending.side === e.side : pending.d === e.d && pending.t === e.t);

// ближайшая точка рамки к клемме (там начинается вывод), shrink — отступ внутрь для подписи
function edgePoint(d, t, shrink = 0) {
  const [x, y, w, h] = PARTS[d.type].box(d);
  return [clamp(t.x, x + shrink, x + w - shrink), clamp(t.y, y + shrink, y + h - shrink)];
}

function termsSvg(d) {
  let out = '';
  if (d.props.plug) return ''; // прибор на вилке: клеммы не показываем, он подключён шнуром
  if (PARTS[d.type].node) {
    // скрутка: медная точка на месте соединения
    const [wx, wy] = termPos(d, termsOf(d)[0]);
    const hot = sim && isHot(sim.cls(tkey(d.id, 'p')));
    if (samePend({ d: d.id, t: 'p' })) out += `<circle class="pend-ring" cx="${wx}" cy="${wy}" r="11"/>`;
    return out + `<circle class="node${hot ? ' hot' : ''}" cx="${wx}" cy="${wy}" r="5"/>`;
  }
  for (const t of termsOf(d)) {
    const [wx, wy] = termPos(d, t);
    const [ex, ey] = edgePoint(d, t);
    const [lx, ly] = rotP(ex, ey, d.rot);
    const hot = sim && isHot(sim.cls(tkey(d.id, t.id)));
    const pend = samePend({ d: d.id, t: t.id }) || (rubber && rubber.from.d === d.id && rubber.from.t === t.id);
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

// что с лампой или розеткой при поданном питании
function loadText(d) {
  if (sim && sim.amps.has(d.id)) {
    // ток через автомат и запас до номинала
    const I = sim.amps.get(d.id), k = I / d.props.a;
    if (I < 0.05) return null;
    return { cls: k > 1.13 ? 'bad' : k > 1 ? 'warn' : 'off', t: fmtA(I) + (k > 1.13 ? ' · перегруз, выбьет со временем' : k > 1 ? ' · на пределе' : '') };
  }
  const r = sim && sim.loads.get(d.id);
  if (!r) return null;
  const three = cur.devices.some(o => o.type === 'src3');
  const ph = three && r.ph ? ' · ' + r.ph : '';
  const sw = d.type.startsWith('sock') ? socketW(d) : 0, sockW = sw ? ' · ' + fmtW(sw) : '';
  if (r.st === 'ok') return { cls: 'ok', t: (PARTS[d.type].light ? 'горит' : d.type.startsWith('sock') ? '220 В' + sockW : 'работает') + ph };
  if (r.st === '380') return { cls: 'bad', t: '380 В! Между фазами' };
  if (r.st === 'nozero') return { cls: 'warn', t: 'нет нуля' + ph };
  return { cls: 'off', t: 'нет фазы' };
}

// прибор отпустили на розетку — включаем вилку и ставим прибор рядом
function tryPlug(d) {
  const [a1, b1, a2, b2] = worldBox(d);
  const so = cur.devices.find(s => s.type.startsWith('sock') && (([c1, e1, c2, e2]) => a1 < c2 && a2 > c1 && b1 < e2 && b2 > e1)(worldBox(s)));
  if (!so) return;
  const busy = cur.devices.find(o => o !== d && o.props.plug === so.id);
  if (busy) { toast(`Розетка занята: в ней ${PARTS[busy.type].name}`); d.x += 120; return; }
  d.props.plug = so.id;
  d.x = so.x + 110; d.y = so.y - 4;
  toast(`${PARTS[d.type].name}: вилка в розетке`);
  evaluatePower();
}

// шнур от прибора до розетки и вилка в розетке
function cordsSvg() {
  let s = '';
  for (const d of cur.devices) {
    const so = d.props.plug && devById(d.props.plug);
    if (!so) continue;
    const [fx, fy] = rotP(0, -6, so.rot); const face = [so.x + fx, so.y + fy];
    // шнур выходит из ближайшего к розетке бока прибора
    const sides = [[-35, -5], [35, -5], [0, -36], [0, 26]].map(([x, y]) => { const [rx, ry] = rotP(x, y, d.rot); return [d.x + rx, d.y + ry]; });
    const a = sides.reduce((m, p) => (Math.hypot(p[0] - face[0], p[1] - face[1]) < Math.hypot(m[0] - face[0], m[1] - face[1]) ? p : m));
    // шнур заходит в вилку сбоку — с той стороны, где прибор, и провисает дугой
    const dir = a[0] >= face[0] ? 1 : -1, end = [face[0] + dir * 14, face[1]];
    const sag = Math.min(50, Math.hypot(a[0] - end[0], a[1] - end[1]) / 4) + 12;
    const path = `M${a[0]} ${a[1]} C${a[0] + (a[0] === d.x ? 0 : -dir * 20)} ${a[1] + sag} ${end[0] + dir * 30} ${end[1] + sag} ${end[0]} ${end[1]}`;
    const hot = sim && sim.loads.get(d.id)?.st === 'ok';
    s += `<path class="cord-case" d="${path}"/><path class="cord${hot ? ' on' : ''}" d="${path}"/>
      <g transform="translate(${face[0]} ${face[1]})"><rect class="plug" x="-12" y="-12" width="24" height="24" rx="8"/><rect class="plug-g" x="${dir > 0 ? 9 : -17}" y="-4" width="8" height="8" rx="2"/></g>`;
  }
  return s;
}

// всё, что включено в розетку: своя «нагрузка без прибора» + приборы на вилке
const socketW = s => loadW(s) + cur.devices.filter(d => d.props.plug === s.id).reduce((a, d) => a + loadW(d), 0);

function labelSvg(d) {
  const p = PARTS[d.type];
  const b = worldBox(d, !d.props.plug), cx = (b[0] + b[2]) / 2;
  let y = b[3] + 16, out = '';
  // подпись: у техники и датчиков всегда название, плюс своя подпись пользователя
  const text = p.showName ? p.name + (d.props.label ? ' · ' + d.props.label : '') : !p.noLabel ? d.props.label : '';
  if (text) { out += `<text class="dlbl" x="${cx}" y="${y}">${esc(text)}</text>`; y += 18; }
  const lt = loadText(d);
  if (lt) {
    const w = lt.t.length * 6.4 + 16;
    out += `<g class="badge b-${lt.cls}"><rect x="${cx - w / 2}" y="${y - 12}" width="${w}" height="17" rx="8.5"/><text x="${cx}" y="${y}">${esc(lt.t)}</text></g>`;
  }
  return out;
}

function wireSvg(w) {
  const P = wirePts(cur, w);
  if (!P) return '';
  const path = 'M' + P.map(p => p.join(' ')).join(' L');
  const k = wireKey(w);
  const hot = sim && k && isHot(sim.cls(k));
  // толщина по сечению: 1,5 тонкий … 10 толстый
  const cw = WIRE_W[w.sec] || 3.6;
  let s = '';
  if (sel && sel.kind === 'wire' && sel.id === w.id) s += `<path class="w-sel" style="stroke-width:${cw + 10}" d="${path}"/>`;
  if (hot) s += `<path class="w-hot" style="stroke-width:${cw + 8}" d="${path}"/>`;
  s += `<path class="w-case" style="stroke-width:${cw + 2.2}" d="${path}"/>`;
  if (w.color === 'pe') s += `<path class="w-core" style="stroke:var(--w-yellow);stroke-width:${cw}" d="${path}"/><path class="w-core w-stripe" style="stroke:var(--w-green);stroke-width:${cw}" d="${path}"/>`;
  else s += `<path class="w-core" style="stroke:var(--w-${w.color});stroke-width:${cw}" d="${path}"/>`;
  // свободный конец: зачищенная жила
  for (const side of ['a', 'b']) {
    if (!isFree(w[side])) continue;
    const [x, y] = side === 'a' ? P[0] : P[P.length - 1];
    if (samePend({ w: w.id, side })) s += `<circle class="pend-ring" cx="${x}" cy="${y}" r="11"/>`;
    s += `<circle class="tip${hot ? ' hot' : ''}" cx="${x}" cy="${y}" r="4"/>`;
  }
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
  if (sim) sim.amps = breakerCurrents(cur, sim);
  const out = [];
  for (const d of cur.devices) if (PARTS[d.type].isBox) out.push(devSvg(d));
  for (const w of cur.wires) out.push(wireSvg(w));
  for (const d of cur.devices) if (!PARTS[d.type].isBox) out.push(devSvg(d));
  out.push(cordsSvg());
  for (const d of cur.devices) out.push(termsSvg(d));
  for (const d of cur.devices) out.push(labelSvg(d));
  out.push(selSvg());
  if (rubber) {
    const fd = devById(rubber.from.d), ft = fd && termsOf(fd).find(t => t.id === rubber.from.t);
    if (ft) { const [x, y] = termPos(fd, ft); out.push(`<line class="rubber" x1="${x}" y1="${y}" x2="${rubber.x}" y2="${rubber.y}"/>`); }
  }
  updateIssues();
  if (showIssues) out.push(marksSvg());
  if (meter) out.push(probesSvg());
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
  pb.textContent = power ? '⚡ Снять' : '⚡ Подать';
  pb.title = power ? 'Снять питание' : 'Подать питание';
  const errs = issues.filter(i => i.lvl === 'err').length, warns = issues.length - errs;
  const cb = $('#btn-check');
  cb.textContent = issues.length ? `⚠ ${issues.length}` : '✓';
  cb.className = 'tb chk' + (errs ? ' err' : warns ? ' warn' : '') + (showIssues ? ' on' : '');
  cb.title = issues.length ? `Проверка по ПУЭ: ошибок ${errs}, замечаний ${warns}` : 'Проверка по ПУЭ: замечаний нет';
  $('#btn-meter').classList.toggle('on', !!meter);
  renderHint();
  renderMeter();
  if (showIssues) renderIssues();
}

// ---------- проверка по ПУЭ ----------
// пересчитываем, только когда изменилось что-то кроме положения устройств на поле
function updateIssues() {
  const sig = JSON.stringify([power, cur.devices.map(d => [d.id, d.type, d.state, d.props, PARTS[d.type].isBox || d.type === 'twist' || d.type.startsWith('wago') ? [d.x, d.y] : 0]),
    cur.wires.map(w => [w.a, w.b, w.color, w.sec])]);
  if (sig === issuesSig) return;
  issuesSig = sig;
  issues = checkScheme(cur, power);
}

function targetPoint(t) {
  if (t.kind === 'dev') { const d = devById(t.id); if (!d) return null; const b = worldBox(d); return [(b[0] + b[2]) / 2, b[1]]; }
  const w = wireById(t.id), P = w && wirePts(cur, w);
  if (!P) return null;
  const i = Math.floor((P.length - 1) / 2);
  return [(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2];
}

function marksSvg() {
  const r = 1 / view.k, seen = new Set();
  let s = '';
  for (const is of issues) for (const t of is.targets) {
    const key = t.kind + t.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = targetPoint(t);
    if (p) s += `<g class="mark m-${is.lvl}" transform="translate(${p[0]} ${p[1]}) scale(${r})"><circle r="10"/><text y="5" font-size="14">!</text></g>`;
  }
  return s;
}

function renderIssues() {
  const el = $('#issues');
  el.innerHTML = `<div class="p-head"><b>Проверка по ПУЭ</b><button class="ib" data-act="close" aria-label="Закрыть">✕</button></div>
    ${issues.length ? `<div class="iss-list">${issues.map((is, i) => `<button class="iss ${is.lvl}" data-i="${i}">
      <span class="iss-dot">!</span><span class="iss-t">${esc(is.text)}${is.pue ? `<br><span class="iss-p">ПУЭ ${esc(is.pue)}</span>` : ''}</span></button>`).join('')}</div>`
    : '<p class="muted">Ошибок не нашёл. Проверяю: фазу в выключателе, автомат и сечение провода, ток по проводам, цвета жил, N и PE, землю у розеток и техники, УЗО на розетках, соединения в коробках, свободные концы.</p>'}
    ${power ? '' : '<p class="p-note">Ток по проводам проверяется, когда питание подано.</p>'}`;
}

$('#btn-check').onclick = () => {
  showIssues = !showIssues;
  if (showIssues) { sel = null; pending = null; }
  $('#issues').hidden = !showIssues;
  render(); renderPanel();
};

$('#issues').onclick = e => {
  if (e.target.closest('[data-act=close]')) { showIssues = false; $('#issues').hidden = true; render(); return; }
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const is = issues[+b.dataset.i], t = is && is.targets[0];
  if (!t) return;
  // показываем место ошибки в центре экрана
  const p = targetPoint(t), r = cv.getBoundingClientRect();
  if (p) { view.x = p[0] - r.width / 2 / view.k; view.y = p[1] - r.height / 3 / view.k; saveView(); }
  sel = { kind: t.kind, id: t.id };
  render();
};

// ---------- мультиметр ----------
$('#btn-meter').onclick = () => {
  meter = meter ? null : { a: null, b: null };
  pending = null; rubber = null;
  render();
};

const ptPos = pt => (pt.w ? endPos(cur, wireById(pt.w)[pt.side]) : termPos(devById(pt.d), termsOf(devById(pt.d)).find(t => t.id === pt.t)));
const ptKey = pt => (pt.w ? wireKey(wireById(pt.w)) : tkey(pt.d, pt.t));
const ptValid = pt => (pt.w ? !!wireById(pt.w) : !!devById(pt.d));

function probesSvg() {
  const r = 1 / view.k;
  let s = '';
  for (const [pt, c, t] of [[meter.a, 'red', 'V'], [meter.b, 'black', 'COM']]) {
    if (!pt || !ptValid(pt)) continue;
    const [x, y] = ptPos(pt);
    s += `<g class="probe ${c}" transform="translate(${x} ${y}) scale(${r})"><circle r="11"/><text y="3">${t}</text></g>`;
  }
  return s;
}

// что покажет прибор
function meterReading() {
  const { a, b } = meter;
  if (!a || !b || !ptValid(a) || !ptValid(b)) return null;
  const ka = ptKey(a), kb = ptKey(b);
  if (power) {
    const s = simulate(cur), ca = ka && s.cls(ka), cb = kb && s.cls(kb);
    const zero = c => c === 'N' || c === 'PE';
    if (isHot(ca) && isHot(cb)) return ca === cb ? { v: '0 В', t: `Одна и та же фаза ${ca}` } : { v: '380 В', t: `Между фазами ${ca} и ${cb}` };
    if ((isHot(ca) && zero(cb)) || (isHot(cb) && zero(ca))) return { v: '220 В', t: `Фаза ${isHot(ca) ? ca : cb} и ${zero(ca) ? ca : cb}` };
    if (isHot(ca) || isHot(cb)) return { v: '0 В', t: 'Один щуп на фазе, второй ни к чему не подключён' };
    return { v: '0 В', t: 'Напряжения нет' };
  }
  // без питания реле и таймеры обесточены: их контакты в положении «нет питания»
  const find = nets(cur, false, new Set(cur.devices.filter(d => PARTS[d.type].supply).map(d => d.id)));
  const same = ka && kb && find(ka) === find(kb);
  return same ? { v: '0,0 Ом', t: 'Звонится: точки соединены' } : { v: 'OL', t: 'Обрыв: точки не соединены' };
}

function renderMeter() {
  const el = $('#meter');
  el.hidden = !meter;
  if (!meter) return;
  $('#hint').hidden = true;
  const r = meterReading();
  const mode = power ? '~V  напряжение' : 'Ω  прозвонка (питание снято)';
  const lcd = r ? r.v : '- - -';
  const sub = r ? r.t : !meter.a ? 'Нажми на первую точку (красный щуп)' : 'Теперь на вторую точку (чёрный щуп)';
  el.innerHTML = `<div class="m-sub" style="margin:0 0 6px">${mode}</div><div class="m-lcd">${esc(lcd)}</div><div class="m-sub">${esc(sub)}</div>`;
}

function renderHint() {
  let h = '', st = '';
  if (power) {
    const kind = t => (PARTS[t].light ? 'lamp' : t.startsWith('sock') ? 'sock' : 'app');
    const loads = [...sim.loads.entries()].map(([id, r]) => [kind(devById(id).type), r.st]);
    const cnt = (k) => { const all = loads.filter(l => l[0] === k); return all.length ? `${all.filter(l => l[1] === 'ok').length} из ${all.length}` : null; };
    const lamps = cnt('lamp'), socks = cnt('sock'), apps = cnt('app');
    st = ['Под напряжением', lamps && 'свет: ' + lamps, socks && 'розетки: ' + socks, apps && 'техника: ' + apps].filter(Boolean).join(' · ');
  }
  if (pending && isFree(pending)) h = 'Нажми на клемму, чтобы подключить конец, или на другой конец, чтобы скрутить';
  else if (pending || rubber) h = 'Нажми на вторую клемму или внутри коробки. Отмена: тап по пустому месту';
  else if (sel && sel.kind === 'wire') h = 'Тяни кружок на проводе, чтобы изогнуть. Тап по точке изгиба убирает её';
  else if (cur.devices.length <= 1 && !cur.wires.length) h = 'Добавь устройства кнопкой «Устройство». Провод: нажми на клемму, потом на вторую';
  else if (!power && cur.wires.length) h = 'Питание снято. Нажми «⚡ Подать» сверху';
  const el = $('#hint');
  el.textContent = st || h; el.hidden = !(st || h);
  el.classList.toggle('live', !!st);
}

// ---------- панель свойств ----------
function renderPanel() {
  const el = $('#panel');
  if (!sel || showIssues) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  if (sel.kind === 'wire') {
    const w = wireById(sel.id);
    let amps = '';
    if (power) {
      const s = simulate(cur), I = s.short ? 0 : (wireCurrents(cur, s).get(w.id) || 0), lim = IDOP[w.sec];
      amps = `<span class="muted" style="font-weight:600;${I > lim ? 'color:var(--hot)' : ''}">${fmtA(I)} из ${lim} А</span>`;
    }
    el.innerHTML = `<div class="p-head"><b>Провод</b>${amps}
      ${w.pts && w.pts.length ? '<button class="ib" data-act="straight" title="Выпрямить" aria-label="Выпрямить">⟋</button>' : ''}
      <button class="ib danger" data-act="del" title="Удалить" aria-label="Удалить">${ICON_DEL}</button><button class="ib" data-act="close" aria-label="Закрыть">✕</button></div>
      <div class="chips">${WIRE_COLORS.map(([c, n]) => `<button class="sw sw-${c} ${w.color === c ? 'on' : ''}" data-color="${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
      <div class="chips">${SECTIONS.map(s => `<button class="chip ${w.sec === s ? 'on' : ''}" data-sec="${s}">${s.replace('.', ',')}</button>`).join('')}<span class="muted unit">мм²</span></div>`;
    return;
  }
  const d = devById(sel.id), p = PARTS[d.type];
  let extra = '';
  if (p.breaker) {
    extra = `<div class="chips">${['B', 'C'].map(c => `<button class="chip ${d.props.ch === c ? 'on' : ''}" data-ch="${c}">${c}</button>`).join('')}
      <span class="sep"></span>${RATINGS.map(a => `<button class="chip ${d.props.a === a ? 'on' : ''}" data-a="${a}">${a}</button>`).join('')}<span class="muted unit">А</span></div>`;
  }
  if (p.rcd) {
    extra = `<div class="chips">${[10, 30, 100, 300].map(m => `<button class="chip ${d.props.ma === m ? 'on' : ''}" data-ma="${m}">${m}</button>`).join('')}<span class="muted unit">мА</span>
      <span class="sep"></span>${[25, 40, 63].map(a => `<button class="chip ${d.props.a === a ? 'on' : ''}" data-a="${a}">${a}</button>`).join('')}<span class="muted unit">А</span></div>`;
  }
  if (p.load && d.type !== 'floor') {
    extra = `<label class="row-in"><span class="muted">${d.type.startsWith('sock') ? 'Нагрузка без прибора (чайник и т. п.), Вт' : 'Мощность, Вт'}</span><input class="inp" id="p-w" type="number" inputmode="numeric" min="0" step="100" value="${loadW(d)}"></label>`;
    if (d.type.startsWith('sock')) {
      const pl = cur.devices.filter(o => o.props.plug === d.id);
      extra += `<div class="p-note">${pl.length ? 'Включено: ' + pl.map(o => `${PARTS[o.type].name} (${fmtW(loadW(o))})`).join(', ') : 'Чтобы включить прибор в розетку, перетащи его на розетку.'}</div>`;
    }
  }
  if (p.pluggable) {
    extra += d.props.plug && devById(d.props.plug)
      ? '<div class="p-btns"><button class="btn" data-act="unplug">🔌 Вынуть из розетки</button></div>'
      : '<div class="p-note">Перетащи прибор на розетку — он включится вилкой.</div>';
  }
  if (d.type === 'floor') {
    if (d.props.area == null) { d.props.area = Math.round(loadW(d) / 150 * 10) / 10; d.props.wpm = 150; }
    extra = `<label class="row-in"><span class="muted">Уложено, м²</span><input class="inp" id="p-area" type="number" inputmode="decimal" min="0" step="0.5" value="${d.props.area}"></label>
      <div class="chips"><span class="muted unit">Вт/м²</span>${[150, 220].map(v => `<button class="chip ${d.props.wpm === v ? 'on' : ''}" data-wpm="${v}">${v}</button>`).join('')}
      <input class="inp chip-in" id="p-wpm" type="number" inputmode="numeric" min="0" step="10" value="${d.props.wpm}" title="Своё значение, Вт/м²"></div>
      <div class="p-note"><b id="p-total">Итого ${fmtW(loadW(d))}</b>. ИК-плёнка обычно 150 или 220 Вт/м², маты под плитку 150–160. Смотри маркировку.</div>`;
  }
  if (d.type === 'shield') {
    extra = `<div class="chips"><span class="muted unit">Рядов</span>${[1, 2, 3, 4].map(v => `<button class="chip ${d.props.rows === v ? 'on' : ''}" data-rows="${v}">${v}</button>`).join('')}</div>
      <div class="chips"><span class="muted unit">Модулей в ряду</span>${[12, 18, 24].map(v => `<button class="chip ${d.props.mods === v ? 'on' : ''}" data-mods="${v}">${v}</button>`).join('')}</div>
      <div class="p-note">Поставь автомат внутрь щитка — он встанет на рейку. Тащи щиток — всё внутри поедет вместе с ним.</div>`;
  }
  if (d.type === 'rn') {
    extra = `<div class="chips"><span class="muted unit">Отключать ниже</span><input class="inp chip-in" data-prop="umin" type="number" inputmode="numeric" step="5" value="${d.props.umin}"><span class="muted unit">В, выше</span><input class="inp chip-in" data-prop="umax" type="number" inputmode="numeric" step="5" value="${d.props.umax}"><span class="muted unit">В</span></div>
      <div class="chips"><span class="muted unit">Задержка включения</span><input class="inp chip-in" data-prop="delay" type="number" inputmode="numeric" step="5" value="${d.props.delay}"><span class="muted unit">с</span></div>
      <div class="p-note">Реле работает, только когда на вход пришли фаза и ноль. Чтобы проверить уставки, поменяй напряжение в сети на вводе. Задержку в лабе не ждём: реле включается сразу, как напряжение вернулось в пределы.</div>`;
  }
  if (d.type === 'src' || d.type === 'src3') {
    const u = d.props.u ?? 220;
    extra = `<div class="chips"><span class="muted unit">Напряжение в сети</span>${[160, 190, 220, 250, 280].map(v => `<button class="chip ${u === v ? 'on' : ''}" data-u="${v}">${v}</button>`).join('')}<input class="inp chip-in" data-prop="u" type="number" inputmode="numeric" step="5" value="${u}"><span class="muted unit">В</span></div>
      <div class="p-note">Меняй, чтобы проверить реле напряжения: просадка или скачок в сети.</div>`;
  }
  if (p.comb) {
    const cut = d.props.cut || [];
    extra = `<div class="chips"><span class="muted unit">Зубьев</span><button class="chip" data-n="${Math.max(1, d.props.n - 1)}" aria-label="Короче">−</button><b class="unit">${d.props.n}</b><button class="chip" data-n="${Math.min(36, d.props.n + 1)}" aria-label="Длиннее">+</button>
      <span class="sep"></span>${[6, 12, 18, 24].map(v => `<button class="chip ${d.props.n === v ? 'on' : ''}" data-n="${v}">${v}</button>`).join('')}</div>
      <div class="p-note">Положи гребёнку в щиток над автоматами — она встанет на верхние клеммы. Нажми на зуб ниже, чтобы отломать его (например, над нулём УЗО).</div>
      <div class="chips teeth">${Array.from({ length: d.props.n }, (_, i) => `<button class="chip ${cut.includes(i) ? 'cut' : 'on'}" data-tooth="${i}" title="${p.comb === 3 ? 'L' + (i % 3 + 1) : ''}">${p.comb === 3 ? 'L' + (i % 3 + 1) : i + 1}</button>`).join('')}</div>`;
  }
  if (d.type === 'jbox') {
    extra = `<div class="chips">${[['S', 'Малая'], ['M', 'Средняя'], ['L', 'Большая']].map(([v, n]) => `<button class="chip ${d.props.size === v ? 'on' : ''}" data-size="${v}">${n}</button>`).join('')}</div>`;
  }
  el.innerHTML = `<div class="p-head"><b>${esc(p.name)}</b>
      ${p.noRotate ? '' : '<button class="ib" data-act="rot" title="Повернуть (R)" aria-label="Повернуть">⟳</button>'}
      <button class="ib" data-act="dup" title="Копия" aria-label="Копия">⧉</button>
      <button class="ib danger" data-act="del" title="Удалить" aria-label="Удалить">${ICON_DEL}</button><button class="ib" data-act="close" aria-label="Закрыть">✕</button></div>
    <input class="inp" id="p-label" value="${esc(d.props.label || '')}" placeholder="${d.type === 'text' ? 'Текст' : 'Подпись, например «Кухня»'}" maxlength="40">
    ${extra}`;
  const inp = el.querySelector('#p-label');
  inp.onfocus = () => snapshot();
  inp.oninput = () => { d.props.label = inp.value; touch(); render(); };
  // тёплый пол: мощность = площадь × Вт/м²
  for (const [id, key] of [['#p-area', 'area'], ['#p-wpm', 'wpm']]) {
    const i = el.querySelector(id);
    if (!i) continue;
    i.onfocus = () => snapshot();
    i.oninput = () => {
      d.props[key] = Math.max(0, +i.value || 0); d.props.w = Math.round(d.props.area * d.props.wpm);
      el.querySelector('#p-total').textContent = `Итого ${fmtW(d.props.w)}`;
      touch(); render(); evalSoon();
    };
  }
  const pw = el.querySelector('#p-w');
  if (pw) {
    pw.onfocus = () => snapshot();
    pw.oninput = () => { d.props.w = Math.max(0, Math.round(+pw.value || 0)); touch(); render(); evalSoon(); };
  }
  // числовые настройки (уставки реле, напряжение в сети)
  el.querySelectorAll('[data-prop]').forEach(i => {
    i.onfocus = () => snapshot();
    i.oninput = () => { if (i.value === '') return; d.props[i.dataset.prop] = +i.value; touch(); render(); evalSoon(); };
  });
}

// пересчёт срабатываний, когда пользователь перестал печатать (а не после выхода из поля)
let evalTimer = 0;
function evalSoon() { clearTimeout(evalTimer); evalTimer = setTimeout(() => { evaluatePower(); render(); }, 400); }

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
    else if (act === 'unplug') { snapshot(); delete d.props.plug; d.y += 60; }
    else if (act === 'dup') {
      snapshot();
      const c = JSON.parse(JSON.stringify(d)); c.id = uid(); c.x += 40; c.y += 40; delete c.props.plug;
      if (PARTS[c.type].breaker || PARTS[c.type].rcd) c.state = { on: true };
      cur.devices.push(c); sel = { kind: 'dev', id: c.id };
    }
    else if (b.dataset.ch) { snapshot(); d.props.ch = b.dataset.ch; }
    else if (b.dataset.a) { snapshot(); d.props.a = +b.dataset.a; }
    else if (b.dataset.ma) { snapshot(); d.props.ma = +b.dataset.ma; }
    else if (b.dataset.wpm) { snapshot(); d.props.wpm = +b.dataset.wpm; d.props.w = Math.round(d.props.area * d.props.wpm); }
    else if (b.dataset.u) { snapshot(); d.props.u = +b.dataset.u; }
    else if (b.dataset.n) { snapshot(); d.props.n = +b.dataset.n; d.props.cut = (d.props.cut || []).filter(i => i < d.props.n); snapToRail(d); }
    else if (b.dataset.tooth) {
      snapshot();
      const i = +b.dataset.tooth, cut = d.props.cut || (d.props.cut = []), at = cut.indexOf(i);
      if (at >= 0) cut.splice(at, 1); else cut.push(i);
    }
    else if (b.dataset.rows) { snapshot(); d.props.rows = +b.dataset.rows; }
    else if (b.dataset.mods) { snapshot(); d.props.mods = +b.dataset.mods; }
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
    for (const d of cur.devices) if (d.props.plug === sel.id) delete d.props.plug; // удалили розетку — вилки выпали
  }
  tidyTwists();
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
    Object.keys(PARTS).filter(k => PARTS[k].group === g && !PARTS[k].hidden).map(k => `<button class="pal-it" data-type="${k}">${miniSvg(k)}<span>${esc(PARTS[k].name)}</span></button>`).join('')
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
// цвет по тому, что уже есть в узле: PE жёлто-зелёный, N голубой, фаза L1 белый (как в кабеле 3×: белый, синий, жёлто-зелёный), L2 чёрный, L3 серый
function guessColor(...ends) {
  const kinds = netKinds(cur), all = new Set();
  for (const e of ends) if (!isFree(e)) kinds(tkey(e.d, e.t)).forEach(k => all.add(k));
  if (all.has('PE')) return 'pe';
  if (all.has('N')) return 'blue';
  if (all.has('L2')) return 'black';
  if (all.has('L3')) return 'grey';
  if (all.has('L1') || all.has('L')) return 'white';
  return db.lastColor;
}
function guessSec(...ends) {
  const devs = ends.filter(e => !isFree(e)).map(e => devById(e.d)), types = devs.map(d => d.type);
  const w = Math.max(0, ...devs.map(d => d.props.w || 0));
  if (w >= 5000) return '6';
  if (w >= 3500) return '4';
  if (w > 0 || types.some(t => t.startsWith('sock'))) return '2.5';
  if (types.some(t => ['lamp', 'sw1', 'sw2', 'swp', 'swx'].includes(t))) return '1.5';
  return db.lastSec;
}

// b может быть свободным концом { x, y } — провод заведён в коробку
function makeWire(a, b) {
  if (!isFree(b) && a.d === b.d && a.t === b.t) return;
  const eq = (p, q) => !isFree(p) && !isFree(q) && p.d === q.d && p.t === q.t;
  if (!isFree(b) && cur.wires.some(w => (eq(w.a, a) && eq(w.b, b)) || (eq(w.a, b) && eq(w.b, a)))) { toast('Эти клеммы уже соединены'); return; }
  snapshot();
  const w = { id: uid(), a, b, color: guessColor(a, b), sec: guessSec(a, b), pts: [] };
  cur.wires.push(w);
  sel = { kind: 'wire', id: w.id };
  touch(); evaluatePower();
}

// подключить свободный конец провода к клемме
function attachEnd(ref, term) {
  const w = wireById(ref.w);
  if (!w) return;
  const other = w[ref.side === 'a' ? 'b' : 'a'];
  if (!isFree(other) && other.d === term.d && other.t === term.t) { toast('Второй конец уже на этой клемме'); return; }
  snapshot();
  w[ref.side] = { d: term.d, t: term.t };
  sel = { kind: 'wire', id: w.id };
  touch(); evaluatePower();
}

// два свободных конца скручиваем: в точке второго конца появляется скрутка, оба конца на ней
function makeTwist(r1, r2) {
  if (r1.w === r2.w) { toast('Нельзя скрутить два конца одного провода'); return; }
  const w1 = wireById(r1.w), w2 = wireById(r2.w), e2 = w2[r2.side];
  snapshot();
  const tw = newDevice('twist', e2.x, e2.y);
  cur.devices.push(tw);
  w1[r1.side] = { d: tw.id, t: 'p' };
  w2[r2.side] = { d: tw.id, t: 'p' };
  sel = null;
  touch(); evaluatePower();
}

// скрутка без проводов исчезает; с одним проводом — распадается, у провода снова свободный конец
function tidyTwists() {
  for (const d of cur.devices.filter(o => PARTS[o.type].node)) {
    const ends = cur.wires.flatMap(w => ['a', 'b'].filter(s => w[s].d === d.id).map(s => [w, s]));
    if (ends.length > 1) continue;
    for (const [w, s] of ends) w[s] = { x: d.x, y: d.y };
    cur.devices = cur.devices.filter(o => o !== d);
  }
}

// автомат или модуль, поставленный в щиток, встаёт на ближайшую DIN-рейку по сетке модулей
function snapToRail(d) {
  const sh = cur.devices.find(b => b.type === 'shield' && boxContains(b, d.x, d.y));
  if (!sh) return;
  const [W] = shieldSize(sh), [bx] = PARTS[d.type].box(d);
  // гребёнка ложится на верхние клеммы (на 55 выше середины рейки)
  const off = PARTS[d.type].comb ? -55 : 0;
  const ry = shieldRails(sh).reduce((a, b) => (Math.abs(sh.y + b + off - d.y) < Math.abs(sh.y + a + off - d.y) ? b : a));
  const left = sh.x - W / 2 + 30, n = Math.max(0, Math.round((d.x + bx - left) / MOD));
  d.rot = 0;
  d.x = left + n * MOD - bx;
  d.y = sh.y + ry + off;
}

// коробка, внутри которой точка (для свободных концов)
function boxAt(x, y) {
  for (let i = cur.devices.length - 1; i >= 0; i--) {
    const d = cur.devices[i];
    if (PARTS[d.type].isBox && boxContains(d, x, y, -4)) return d;
  }
  return null;
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
  for (const d of cur.devices) if (!d.props.plug) for (const t of termsOf(d)) {
    const [tx, ty] = termPos(d, t), dd = Math.hypot(tx - x, ty - y);
    if (dd < bd) { bd = dd; best = { kind: 'term', d, t }; }
  }
  if (best) {
    // палец не точно на клемме, а на корпусе маленького устройства с переключением (скрутка) — это нажатие на корпус
    if (bd > 7) for (const d of cur.devices) {
      const p = PARTS[d.type];
      if ((!p.toggle && !p.comb) || p.isBox) continue;
      const [lx, ly] = toLocal(d, x, y), [bx, by, bw, bh] = p.box(d);
      if (lx >= bx && lx <= bx + bw && ly >= by && ly <= by + bh) return { kind: 'dev', d, lx, ly };
    }
    return best;
  }
  // свободные концы проводов
  for (const w of cur.wires) for (const side of ['a', 'b']) {
    const e = w[side];
    if (isFree(e) && Math.hypot(e.x - x, e.y - y) < Math.max(16 / k, 9)) return { kind: 'end', w, side };
  }
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
  // коробки: за любое место внутри (и чуть за обод)
  for (let i = cur.devices.length - 1; i >= 0; i--) {
    const d = cur.devices[i];
    if (!PARTS[d.type].isBox) continue;
    if (boxContains(d, x, y, 10 / k)) return { kind: 'dev', d, lx: 0, ly: 0 };
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
  if (meter && h && (h.kind === 'term' || h.kind === 'end')) { g.type = 'pan'; return; }
  if (h && h.kind === 'term' && PARTS[h.d.type].node) { g.type = 'move'; snapshot(); g.items = [{ d: h.d, x: h.d.x, y: h.d.y }]; g.bends = []; pending = null; return; }
  if (h && h.kind === 'term') { g.type = 'wire'; pending = null; rubber = { from: { d: h.d.id, t: h.t.id }, x: g.wx, y: g.wy }; return; }
  if (h && h.kind === 'end') { g.type = 'end'; pending = null; snapshot(); g.e = h.w[h.side]; g.ref = { w: h.w.id, side: h.side }; return; }
  if (h && h.kind === 'dev') {
    g.type = 'move'; snapshot();
    const d = h.d;
    g.items = [{ d, x: d.x, y: d.y }];
    g.bends = [];
    if (PARTS[d.type].isBox) {
      // коробка тащит за собой всё, что внутри: устройства, изгибы и свободные концы проводов
      const inside = (x, y) => boxContains(d, x, y);
      for (const o of cur.devices) if (o !== d && !PARTS[o.type].isBox && inside(o.x, o.y)) g.items.push({ d: o, x: o.x, y: o.y });
      for (const w of cur.wires) {
        (w.pts || []).forEach(p => { if (inside(p[0], p[1])) g.bends.push({ p, i0: 0, i1: 1, x: p[0], y: p[1] }); });
        for (const e of [w.a, w.b]) if (isFree(e) && inside(e.x, e.y)) g.bends.push({ p: e, i0: 'x', i1: 'y', x: e.x, y: e.y });
      }
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
    for (const b of g.bends) { b.p[b.i0] = b.x + dx; b.p[b.i1] = b.y + dy; }
  } else if (g.type === 'bend') {
    g.w.pts[g.bi] = [snap(wx), snap(wy)];
  } else if (g.type === 'end') {
    g.e.x = snap(wx); g.e.y = snap(wy);
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
  if (!g.moved) { tap(g.hit, g.wx, g.wy); return; }
  if (g.type === 'wire') {
    const [px, py] = canvasXY(e), [wx, wy] = toWorld(px, py);
    const h = hitTest(wx, wy);
    const from = rubber.from;
    rubber = null;
    if (h && h.kind === 'term') makeWire(from, { d: h.d.id, t: h.t.id });
    else if (h && h.kind === 'end') attachEnd({ w: h.w.id, side: h.side }, from);
    else if (boxAt(wx, wy)) makeWire(from, { x: snap(wx), y: snap(wy) });
    render(); renderPanel();
    return;
  }
  if (g.type === 'end') {
    // отпустили конец на клемме — подключаем
    const [px, py] = canvasXY(e), [wx, wy] = toWorld(px, py);
    let best = null, bd = Math.max(16 / view.k, 9);
    for (const d of cur.devices) for (const t of termsOf(d)) {
      const [tx, ty] = termPos(d, t), dd = Math.hypot(tx - wx, ty - wy);
      if (dd < bd) { bd = dd; best = { d: d.id, t: t.id }; }
    }
    // или на другом свободном конце — скручиваем
    const other = !best && cur.wires.flatMap(w => ['a', 'b'].map(side => ({ w, side })))
      .find(({ w, side }) => !(w.id === g.ref.w && side === g.ref.side) && isFree(w[side]) && Math.hypot(w[side].x - wx, w[side].y - wy) < Math.max(16 / view.k, 9));
    if (best) attachEnd(g.ref, best);
    else if (other) makeTwist(g.ref, { w: other.w.id, side: other.side });
    else touch();
    render(); renderPanel();
    return;
  }
  if (g.type === 'move' && g.items.length === 1 && (PARTS[g.items[0].d.type].din || PARTS[g.items[0].d.type].comb)) snapToRail(g.items[0].d);
  if (g.type === 'move' && g.items.length === 1 && PARTS[g.items[0].d.type].pluggable) tryPlug(g.items[0].d);
  if (g.type === 'move' || g.type === 'bend') touch();
  if (g.type === 'pan') saveView();
  render();
  if (g.type === 'bend') renderPanel();
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);

function saveView() { if (cur) { cur.view = { ...view }; save(); } }

function tap(h, wx, wy) {
  // мультиметр: тапы по клеммам и концам ставят щупы, по выключателям — переключают как обычно
  if (meter && h && (h.kind === 'term' || h.kind === 'end')) {
    const pt = h.kind === 'term' ? { d: h.d.id, t: h.t.id } : { w: h.w.id, side: h.side };
    if (!meter.a || meter.b) meter = { a: pt, b: null }; else meter.b = pt;
    render(); return;
  }
  if (meter && !h) { sel = null; render(); renderPanel(); return; }
  if (!h) {
    // провод от клеммы можно оставить концом внутри коробки
    if (pending && !isFree(pending) && boxAt(wx, wy)) { const from = pending; pending = null; makeWire(from, { x: snap(wx), y: snap(wy) }); }
    else { sel = null; pending = null; }
    render(); renderPanel(); return;
  }
  if (h.kind === 'term') {
    const t = { d: h.d.id, t: h.t.id };
    if (pending && isFree(pending)) { const ref = pending; pending = null; attachEnd(ref, t); }
    else if (pending && !(pending.d === t.d && pending.t === t.t)) { const from = pending; pending = null; makeWire(from, t); }
    else if (pending) pending = null;
    else { pending = t; sel = null; }
    render(); renderPanel();
    return;
  }
  if (h.kind === 'end') {
    const ref = { w: h.w.id, side: h.side };
    if (pending && !isFree(pending)) { const t = pending; pending = null; attachEnd(ref, t); }
    else if (samePend(ref)) pending = null;
    else if (pending) { const r1 = pending; pending = null; makeTwist(r1, ref); }
    else { pending = ref; sel = null; }
    render(); renderPanel();
    return;
  }
  // провод от клеммы заводим внутрь коробки — конец остаётся свободным
  if (pending && !isFree(pending) && h.kind === 'dev' && PARTS[h.d.type].isBox && boxAt(wx, wy)) {
    const from = pending; pending = null;
    makeWire(from, { x: snap(wx), y: snap(wy) });
    render(); renderPanel(); return;
  }
  pending = null;
  if (h.kind === 'bend') {
    snapshot(); h.w.pts.splice(h.i, 1); touch();
    render(); renderPanel(); return;
  }
  if (h.kind === 'mid' || h.kind === 'wire') { sel = { kind: 'wire', id: h.w.id }; render(); renderPanel(); return; }
  if (h.kind === 'dev') {
    const d = h.d, p = PARTS[d.type];
    if (p.toggle && p.toggle(d, h.lx, h.ly)) {
      touch(); evaluatePower();
      if (!power && d.type !== 'twist') toast('Питание снято. Чтобы проверить, нажми «⚡ Подать» сверху');
    }
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
