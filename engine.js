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

// точка внутри коробки или щитка (pad — запас за край)
function boxContains(b, x, y, pad = 0) {
  const p = PARTS[b.type];
  if (p.shape === 'rect') { const [bx, by, bw, bh] = p.box(b); return x >= b.x + bx - pad && x <= b.x + bx + bw + pad && y >= b.y + by - pad && y <= b.y + by + bh + pad; }
  return Math.hypot(x - b.x, y - b.y) < p.r(b) + pad;
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

// узлы схемы: объединение клемм через провода и замкнутые контакты.
// closed = все выключатели и автоматы «замкнуты»: так видно, какой потенциал на проводнике при работе.
// off = устройства без питания (реле, таймеры, датчики): их контакты в положении «нет питания» (connOff)
function nets(sc, closed, off) {
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
  // sc._fault — скрытая неисправность в режиме «Найди неисправность» (не сохраняется): { wire } или { dev }
  const fault = closed ? null : sc._fault;
  for (const d of sc.devices) {
    const p = PARTS[d.type];
    const groups = fault && fault.dev === d.id ? [] : closed && p.closed ? p.closed(d) : off && off.has(d.id) ? (p.connOff ? p.connOff(d) : []) : p.conn(d);
    for (const g of groups) for (let i = 1; i < g.length; i++) union(tkey(d.id, g[0]), tkey(d.id, g[i]));
  }
  for (const w of sc.wires) if (!isFree(w.a) && !isFree(w.b) && !(fault && fault.wire === w.id)) union(tkey(w.a.d, w.a.t), tkey(w.b.d, w.b.t));
  // прибор, включённый вилкой в розетку: его L, N, PE соединены с клеммами розетки
  for (const d of sc.devices) {
    if (!d.props || !d.props.plug || !sc.devices.some(o => o.id === d.props.plug)) continue;
    for (const t of ['L', 'N', 'PE']) union(tkey(d.id, t), tkey(d.props.plug, t));
  }
  // гребёнки: клеммы под зубьями одной фазы соединены
  for (const c of sc.devices) {
    const p = PARTS[c.type];
    if (!p.comb) continue;
    const groups = Array.from({ length: p.comb }, () => []);
    for (const t of combTeeth(sc, c)) if (!t.cut) groups[t.i % p.comb].push(...t.keys);
    for (const g of groups) for (let i = 1; i < g.length; i++) union(g[0], g[i]);
  }
  return find;
}

// зубья гребёнки: где стоят и в какие клеммы попали (допуск 5 — у УЗО и реле клеммы чуть смещены от середины модуля)
function combTeeth(sc, c) {
  const p = PARTS[c.type], cut = c.props.cut || [], out = [];
  for (let i = 0; i < c.props.n; i++) {
    const x = c.x + p.toothX(c, i), y = c.y, keys = [];
    for (const d of sc.devices) {
      if (d === c || PARTS[d.type].comb) continue;
      for (const t of termsOf(d)) { const [tx, ty] = termPos(d, t); if (Math.abs(tx - x) < 5 && Math.abs(ty - y) < 5) keys.push(tkey(d.id, t.id)); }
    }
    out.push({ i, x, y, keys, cut: cut.includes(i) });
  }
  return out;
}

// какие типы клемм (L, N, PE) есть в узле каждой клеммы — для выбора цвета нового провода
function netKinds(sc) {
  const find = nets(sc, true), kinds = new Map();
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

// напряжение в сети (задаётся на вводе, по умолчанию 220)
const netU = sc => sc.devices.find(d => d.type === 'src' || d.type === 'src3')?.props.u ?? 220;

// есть ли питание у реле, таймера, датчика: напряжение между L и N (с учётом перекоса при обрыве нуля);
// реле напряжения включается только в пределах уставок, остальным хватает 150 В
function supplyOk(sc, s, d) {
  const u = s.uAcross(tkey(d.id, 'L'), tkey(d.id, 'N'));
  if (u == null) return false;
  if (d.type === 'rn') return u >= d.props.umin && u <= d.props.umax;
  return u >= 150;
}

// расчёт при поданном питании (closed — см. nets).
// Устройства с питанием (supply) сначала считаются выключенными; включаем те, к которым пришли фаза и ноль,
// и пересчитываем, пока картина не перестанет меняться — как при подаче напряжения в жизни.
function simulate(sc, closed) {
  const sup = closed ? [] : sc.devices.filter(d => PARTS[d.type].supply);
  let off = new Set(sup.map(d => d.id)), res = simulateOnce(sc, closed, off);
  // реле напряжения, которое включилось и тут же увидело плохое напряжение (перекос после подключения нагрузки),
  // остаётся отключённым — иначе расчёт «дребезжит» (в жизни реле ждёт задержку и снова отключается)
  const latched = new Set();
  for (let i = 0; i <= sup.length + 1; i++) {
    const next = new Set();
    for (const d of sup) {
      if (latched.has(d.id) || !supplyOk(sc, res, d)) {
        next.add(d.id);
        if (d.type === 'rn' && !off.has(d.id)) latched.add(d.id);
      }
    }
    if (next.size === off.size && [...next].every(id => off.has(id))) break;
    off = next;
    res = simulateOnce(sc, closed, off);
  }
  res.off = off;
  return res;
}

function simulateOnce(sc, closed, off) {
  const find = nets(sc, closed, off);
  const marks = new Map(); // узел → какие потенциалы в него пришли
  const mark = (k, c) => { const r = find(k); if (r == null) return; if (!marks.has(r)) marks.set(r, new Set()); marks.get(r).add(c); };
  for (const d of sc.devices) {
    if (d.type === 'src') mark(tkey(d.id, 'L'), 'L1');
    if (d.type === 'src3') PHASES.forEach(p => mark(tkey(d.id, p), p));
    if (d.type === 'src' || d.type === 'src3') {
      if (!d.props.nbreak) mark(tkey(d.id, 'N'), 'N'); // обрыв нуля на вводе: ноль от подстанции не пришёл
      mark(tkey(d.id, 'PE'), 'PE');
    }
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
  const dead = d => d.state.burnt || (!closed && sc._fault && sc._fault.dev === d.id);
  for (const d of sc.devices) {
    for (const t of termsOf(d)) if (isHot(cls(tkey(d.id, t.id)))) hot++;
    if (PARTS[d.type].load) loads.set(d.id, loadStatus(cls(tkey(d.id, 'L')), cls(tkey(d.id, 'N'))));
  }

  // Обрыв нуля: нагрузки разных фаз, чьи нули сходятся в узле без нуля, оказываются последовательно между фазами.
  // Напряжение «плавающей» нейтрали: Vn = Σ(Y·E) / ΣY, где Y = P/U² — проводимость нагрузки, E — вектор фазы.
  // На нагрузке |E − Vn|: на слабо нагруженной фазе выходит до 380 В, на сильно нагруженной — мало.
  const E = netU(sc), A = 2 * Math.PI / 3;
  const PH = { L1: [E, 0], L2: [E * Math.cos(-A), E * Math.sin(-A)], L3: [E * Math.cos(A), E * Math.sin(A)] };
  const groups = new Map();
  for (const d of sc.devices) {
    if (!PARTS[d.type].load) continue;
    const kL = tkey(d.id, 'L'), kN = tkey(d.id, 'N'), a = cls(kL), b = cls(kN);
    const [ph, other] = isHot(a) && b == null ? [a, kN] : isHot(b) && a == null ? [b, kL] : [null];
    if (!ph) continue;
    const r = find(other);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push({ d, ph });
  }
  const vn = new Map();
  for (const [r, list] of groups) {
    let x = 0, y = 0, sum = 0;
    for (const { d, ph } of list) { if (dead(d)) continue; const g = loadW(d) / (VOLT * VOLT); x += g * PH[ph][0]; y += g * PH[ph][1]; sum += g; }
    if (!sum) continue;
    const V = [x / sum, y / sum];
    vn.set(r, V);
    for (const { d, ph } of list) {
      const u = Math.round(Math.hypot(PH[ph][0] - V[0], PH[ph][1] - V[1]));
      if (u > 5) loads.set(d.id, { st: 'float', ph, u });
    }
  }
  // сгоревшая техника и скрытая неисправность прибора: напряжение есть, а не работает
  for (const d of sc.devices) if (PARTS[d.type].load && dead(d)) loads.set(d.id, { st: d.state.burnt ? 'burnt' : 'dead' });

  // вектор потенциала узла и напряжение между двумя точками (для мультиметра, реле и т. п.)
  const vOf = k => { const c = cls(k); if (isHot(c)) return PH[c]; if (c === 'N' || c === 'PE') return [0, 0]; return vn.get(find(k)) || null; };
  const uAcross = (k1, k2) => { const a = vOf(k1), b = vOf(k2); return a && b ? Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])) : null; };
  const marksOf = k => marks.get(find(k)) || new Set();
  return { short, cls, loads, hot, marksOf, uAcross };
}

// ток по каждому проводу, А: убираем провод — нагрузки, которые от этого перестали работать, питались через него
function wireCurrents(sc, base) {
  const res = new Map();
  const ok = [...base.loads].filter(([, r]) => r.st === 'ok').map(([id]) => sc.devices.find(d => d.id === id));
  if (!ok.length) return res;
  for (const w of sc.wires) {
    if (isFree(w.a) || isFree(w.b)) continue;
    const s = simulate({ devices: sc.devices, wires: sc.wires.filter(x => x !== w) });
    let I = 0;
    for (const l of ok) if (s.loads.get(l.id).st !== 'ok') I += loadW(l) / VOLT;
    if (I > 0) res.set(w.id, I);
  }
  return res;
}

// мощность нагрузки, Вт (у старых схем props.w может не быть — берём значение по умолчанию)
const loadW = d => d.props.w ?? PARTS[d.type].init?.props?.w ?? 0;
const VOLT = 220;

// ток через каждый включённый автомат, А (по самому нагруженному полюсу).
// Полюс по очереди разрываем: нагрузки, которые от этого обесточились, питаются через него.
function breakerCurrents(sc, base) {
  const res = new Map();
  const ok = [...base.loads].filter(([, r]) => r.st === 'ok').map(([id]) => sc.devices.find(d => d.id === id));
  if (!ok.length) return res;
  for (const d of sc.devices) {
    const p = PARTS[d.type];
    if (!p.breaker || !d.state.on) continue;
    let max = 0;
    for (const pole of p.poles) {
      d.state.cut = pole[0];
      const s = simulate(sc);
      delete d.state.cut;
      let I = 0;
      for (const l of ok) if (s.loads.get(l.id).st !== 'ok') I += loadW(l) / VOLT;
      max = Math.max(max, I);
    }
    res.set(d.id, max);
  }
  return res;
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
