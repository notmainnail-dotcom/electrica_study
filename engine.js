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

// точки провода: клемма A, изгибы, клемма B (null, если клеммы уже нет)
function wirePts(sc, w) {
  const da = sc.devices.find(d => d.id === w.a.d), db = sc.devices.find(d => d.id === w.b.d);
  if (!da || !db) return null;
  const ta = termsOf(da).find(t => t.id === w.a.t), tb = termsOf(db).find(t => t.id === w.b.t);
  if (!ta || !tb) return null;
  return [termPos(da, ta), ...(w.pts || []), termPos(db, tb)];
}

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
  for (const w of sc.wires) union(tkey(w.a.d, w.a.t), tkey(w.b.d, w.b.t));
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

// расчёт при поданном питании
function simulate(sc) {
  const find = nets(sc);
  const L = new Set(), N = new Set(), PE = new Set();
  for (const d of sc.devices) if (d.type === 'src') {
    L.add(find(tkey(d.id, 'L'))); N.add(find(tkey(d.id, 'N'))); PE.add(find(tkey(d.id, 'PE')));
  }
  const short = [...L].some(r => N.has(r) || PE.has(r));
  const cls = k => { const r = find(k); return r == null ? null : L.has(r) ? 'L' : N.has(r) ? 'N' : PE.has(r) ? 'PE' : null; };
  const lit = new Set(), live = new Set();
  let hot = 0;
  for (const d of sc.devices) {
    for (const t of termsOf(d)) if (cls(tkey(d.id, t.id)) === 'L') hot++;
    if (d.type !== 'lamp' && d.type !== 'sock') continue;
    const a = cls(tkey(d.id, 'L')), b = cls(tkey(d.id, 'N'));
    const zero = c => c === 'N' || c === 'PE';
    if ((a === 'L' && zero(b)) || (b === 'L' && zero(a))) (d.type === 'lamp' ? lit : live).add(d.id);
  }
  return { short, cls, lit, live, hot };
}

// при КЗ выбивает ближайший к месту замыкания автомат:
// из тех, чьё отключение убирает КЗ, берём тот, после которого под напряжением остаётся больше всего схемы
function findTrip(sc) {
  let best = null, bestHot = -1;
  for (const d of sc.devices) {
    if (d.type !== 'brk' || !d.state.on) continue;
    d.state.on = false;
    const s = simulate(sc);
    d.state.on = true;
    if (!s.short && s.hot > bestHot) { best = d; bestHot = s.hot; }
  }
  return best;
}
