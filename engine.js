// Геометрия и расчёт схемы: что с чем соединено, куда пришла фаза, что горит, есть ли КЗ.
// Модель упрощённая: клеммы объединяются в «узлы» через провода и замкнутые контакты.
// Точный расчёт токов не нужен: хватает знать, в каком узле фаза, ноль и земля.

function rotP(x, y, r) {
  r = (((r || 0) % 4) + 4) % 4;
  for (let i = 0; i < r; i++) [x, y] = [-y, x];
  return [x, y];
}
const termsOf = d => PARTS[d.type].terms(d);
const tkey = (dId, tId) => dId + ':' + tId;
const termPos = (d, t) => { const [x, y] = rotP(t.x, t.y, d.rot); return [d.x + x, d.y + y]; };
const toLocal = (d, wx, wy) => rotP(wx - d.x, wy - d.y, 4 - (d.rot || 0));

// рамка устройства в мировых координатах: [x1, y1, x2, y2]; withTerms — вместе с клеммами
function worldBox(d, withTerms) {
  const [x, y, w, h] = PARTS[d.type].box(d);
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
  if (withTerms) for (const t of termsOf(d)) pts.push([t.x, t.y]);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [a, b] of pts) {
    const [px, py] = rotP(a, b, d.rot);
    x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py);
  }
  return [x1 + d.x, y1 + d.y, x2 + d.x, y2 + d.y];
}

// конец провода: на клемме { d, t } или свободный (лежит в коробке) { x, y }
const isFree = e => e.d == null;
function endPos(sc, e) {
  if (isFree(e)) return [e.x, e.y];
  const d = sc.devices.find(o => o.id === e.d);
  const t = d && termsOf(d).find(q => q.id === e.t);
  return t ? termPos(d, t) : null;
}
// клемма, через которую провод связан со схемой (null, если оба конца свободны)
const wireKey = w => (!isFree(w.a) ? tkey(w.a.d, w.a.t) : !isFree(w.b) ? tkey(w.b.d, w.b.t) : null);

// точки провода: конец A, изгибы, конец B (null, если клеммы уже нет)
function wirePts(sc, w) {
  const a = endPos(sc, w.a), b = endPos(sc, w.b);
  return a && b ? [a, ...(w.pts || []), b] : null;
}

// фазы: L однофазного ввода считаем L1
const PHASES = ['L1', 'L2', 'L3'];
const isHot = c => !!c && c[0] === 'L';

// узлы схемы: объединение клемм через провода и замкнутые контакты
function nets(sc) {
  const parent = new Map();
  const add = k => { if (!parent.has(k)) parent.set(k, k); };
  const find = k => {
    if (!parent.has(k)) return null;
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(k) !== r) { const n = parent.get(k); parent.set(k, r); k = n; }
    return r;
  };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra && rb && ra !== rb) parent.set(ra, rb); };
  for (const d of sc.devices) for (const t of termsOf(d)) add(tkey(d.id, t.id));
  for (const d of sc.devices) for (const g of PARTS[d.type].conn(d)) for (let i = 1; i < g.length; i++) union(tkey(d.id, g[0]), tkey(d.id, g[i]));
  for (const w of sc.wires) if (!isFree(w.a) && !isFree(w.b)) union(tkey(w.a.d, w.a.t), tkey(w.b.d, w.b.t));
  return find;
}

// какие типы клемм (L, N, PE) есть в узле каждой клеммы — для выбора цвета нового провода
function netKinds(sc) {
  const find = nets(sc), kinds = new Map();
  for (const d of sc.devices) for (const t of termsOf(d)) {
    if (t.kind === 'x') continue;
    const r = find(tkey(d.id, t.id));
    if (!kinds.has(r)) kinds.set(r, new Set());
    kinds.get(r).add(t.kind);
  }
  return k => kinds.get(find(k)) || new Set();
}

// что получает нагрузка (лампа, розетка) по классам её клемм L и N
// ok — фаза и ноль; nophase — фазы нет; nozero — нет нуля; 380 — две разные фазы
function loadStatus(a, b) {
  const ha = isHot(a), hb = isHot(b);
  if (ha && hb) return a === b ? { st: 'nozero', ph: a } : { st: '380' };
  if (!ha && !hb) return { st: 'nophase' };
  const ph = ha ? a : b, other = ha ? b : a;
  return { st: other === 'N' || other === 'PE' ? 'ok' : 'nozero', ph };
}

// расчёт при поданном питании
function simulate(sc) {
  const find = nets(sc);
  const marks = new Map(); // узел → какие потенциалы в него пришли
  const mark = (k, c) => { const r = find(k); if (r == null) return; if (!marks.has(r)) marks.set(r, new Set()); marks.get(r).add(c); };
  for (const d of sc.devices) {
    if (d.type === 'src') mark(tkey(d.id, 'L'), 'L1');
    if (d.type === 'src3') PHASES.forEach(p => mark(tkey(d.id, p), p));
    if (d.type === 'src' || d.type === 'src3') { mark(tkey(d.id, 'N'), 'N'); mark(tkey(d.id, 'PE'), 'PE'); }
  }
  // КЗ: фаза встретилась с другой фазой, нулём или землёй
  let short = false;
  for (const s of marks.values()) {
    const ph = PHASES.filter(p => s.has(p)).length;
    if (ph > 1 || (ph === 1 && (s.has('N') || s.has('PE')))) short = true;
  }
  const cls = k => {
    const s = marks.get(find(k));
    if (!s) return null;
    return PHASES.find(p => s.has(p)) || (s.has('N') ? 'N' : 'PE');
  };
  const loads = new Map();
  let hot = 0;
  for (const d of sc.devices) {
    for (const t of termsOf(d)) if (isHot(cls(tkey(d.id, t.id)))) hot++;
    if (PARTS[d.type].load) loads.set(d.id, loadStatus(cls(tkey(d.id, 'L')), cls(tkey(d.id, 'N'))));
  }
  return { short, cls, loads, hot };
}

// утечка мимо УЗО: ток нагрузки идёт через фазный полюс УЗО, а возвращается не через его N (или наоборот).
// Проверяем по очереди: разрываем у УЗО только L, потом только N, и смотрим, какие нагрузки это задело.
function findLeak(sc) {
  const base = simulate(sc);
  for (const d of sc.devices) {
    if (!PARTS[d.type].rcd || !d.state.on) continue;
    d.state.cutL = true; const sL = simulate(sc); delete d.state.cutL;
    d.state.cutN = true; const sN = simulate(sc); delete d.state.cutN;
    for (const [id, r] of base.loads) {
      if (r.st !== 'ok') continue;
      const viaL = sL.loads.get(id).st !== 'ok', viaN = sN.loads.get(id).st !== 'ok';
      if (viaL !== viaN) return d;
    }
  }
  return null;
}

// при КЗ выбивает ближайший к месту замыкания автомат:
// из тех, чьё отключение убирает КЗ, берём тот, после которого под напряжением остаётся больше всего схемы
function findTrip(sc) {
  let best = null, bestHot = -1;
  for (const d of sc.devices) {
    if (!PARTS[d.type].breaker || !d.state.on) continue;
    d.state.on = false;
    const s = simulate(sc);
    d.state.on = true;
    if (!s.short && s.hot > bestHot) { best = d; bestHot = s.hot; }
  }
  return best;
}
