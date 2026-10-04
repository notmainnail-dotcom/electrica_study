// Библиотека устройств «Электролабы».
// У каждого устройства: рамка (box), клеммы (terms), внутренние соединения (conn) в зависимости
// от положения клавиш, рисунок (draw) в своих координатах до поворота и реакция на нажатие (toggle).
// Координаты кратны 10, чтобы клеммы попадали в сетку.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// id, x, y, тип клеммы (L, N, PE или x — любая), подпись, сдвиг подписи по x
const T = (id, x, y, kind = 'x', label = id, dx = 0) => ({ id, x, y, kind, label, dx });
const inRect = (x, y, rx, ry, w, h) => x >= rx && x <= rx + w && y >= ry && y <= ry + h;
// класс «горячего» участка: на клемме фаза
const hc = (h, id) => (h && h[id] ? ' hot' : '');

const blade = (x1, y1, x2, y2, cls) => `<path class="ct${cls}" d="M${x1} ${y1} L${x2} ${y2}"/>`;

function wago(n) {
  const xs = Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * 20);
  const half = n * 10 + 4;
  return {
    name: `Wago на ${n}`, group: 'Монтаж',
    box: () => [-half, -14, half * 2, 28],
    terms: () => xs.map((x, i) => T('p' + (i + 1), x, 24, 'x', '')),
    conn: () => [xs.map((_, i) => 'p' + (i + 1))],
    draw: () => `<rect class="wbody" x="${-half}" y="-14" width="${half * 2}" height="28" rx="4"/>
      <path class="plate" d="M${-half + 6} 5 H${half - 6}"/>
      ${xs.map(x => `<rect class="wlever" x="${x - 7}" y="-11" width="14" height="10" rx="2"/><circle class="hole" cx="${x}" cy="7" r="3"/>`).join('')}`
  };
}

function bus(kind) {
  const xs = [-50, -30, -10, 10, 30, 50];
  return {
    name: kind === 'N' ? 'Шина N' : 'Шина PE', group: 'Щит и питание',
    box: () => [-62, -8, 124, 16],
    terms: () => xs.map((x, i) => T('p' + (i + 1), x, -20, kind, '')),
    conn: () => [xs.map((_, i) => 'p' + (i + 1))],
    draw: () => `<rect class="bus" x="-62" y="-8" width="124" height="16" rx="2" style="fill:${kind === 'N' ? 'var(--w-blue)' : 'url(#pe-stripes)'}"/>
      <text class="t-xs bus-t" x="-56" y="4" text-anchor="start">${kind}</text>
      ${xs.map(x => `<circle class="screw" cx="${x}" cy="0" r="3.5"/>`).join('')}`
  };
}

const PARTS = {
  src: {
    name: 'Ввод 220 В', group: 'Щит и питание',
    box: () => [-60, -30, 120, 60],
    terms: () => [T('L', -40, 40, 'L'), T('N', 0, 40, 'N'), T('PE', 40, 40, 'PE')],
    conn: () => [],
    draw: () => `<rect class="body" x="-60" y="-30" width="120" height="60" rx="6"/>
      <path class="bolt" d="M-36 -20 L-46 0 H-38 L-43 16 L-28 -6 H-36 L-30 -20Z"/>
      <text class="t-m" x="12" y="-3">ВВОД</text><text class="t-s" x="12" y="11">~220 В</text>`
  },

  brk: {
    name: 'Автомат 1P', group: 'Щит и питание',
    init: { state: { on: true }, props: { ch: 'C', a: 16 } },
    box: () => [-18, -45, 36, 90],
    terms: () => [T('1', 0, -55, 'x', ''), T('2', 0, 55, 'x', '')],
    conn: d => (d.state.on ? [['1', '2']] : []),
    draw: d => {
      const on = d.state.on;
      return `<rect class="body" x="-18" y="-45" width="36" height="90" rx="3"/>
      <text class="t-s" x="0" y="-31">${esc(d.props.ch)}${esc(d.props.a)}</text>
      <rect class="slot" x="-9" y="-22" width="18" height="44" rx="3"/>
      <rect class="lever" x="-7" y="${on ? -20 : 2}" width="14" height="18" rx="2"/>
      <text class="t-xs" x="0" y="37">${on ? 'I' : 'O'}</text>
      ${d.state.trip ? '<circle class="trip" cx="10" cy="-38" r="4"/>' : ''}`;
    },
    toggle: (d, x, y) => {
      if (!inRect(x, y, -16, -28, 32, 56)) return false;
      if (d.state.trip) { d.state.trip = false; d.state.on = true; } else d.state.on = !d.state.on;
      return true;
    }
  },

  busN: bus('N'),
  busPE: bus('PE'),

  sw1: {
    name: 'Выключатель', group: 'Выключатели',
    init: { state: { on: false } },
    box: () => [-35, -35, 70, 70],
    terms: () => [T('L', 0, -45, 'x', 'L', 9), T('1', 0, 45, 'x', '1', 9)],
    conn: d => (d.state.on ? [['L', '1']] : []),
    draw: (d, h) => {
      const on = d.state.on;
      return `<rect class="body" x="-35" y="-35" width="70" height="70" rx="9"/>
      <rect class="key${on ? ' on' : ''}" x="-27" y="-27" width="54" height="54" rx="6"/>
      <path class="ct${hc(h, 'L')}" d="M0 -35 V-12"/>
      ${on ? blade(0, -12, 0, 12, hc(h, 'L')) : blade(0, -12, 14, 8, hc(h, 'L'))}
      <path class="ct${hc(h, '1')}" d="M0 12 V35"/>
      <circle class="pv" cx="0" cy="-12" r="3"/><circle class="cp" cx="0" cy="12" r="2.5"/>`;
    },
    toggle: d => { d.state.on = !d.state.on; return true; }
  },

  sw2: {
    name: 'Двухклавишный', group: 'Выключатели',
    init: { state: { k1: false, k2: false } },
    box: () => [-45, -35, 90, 70],
    terms: () => [T('L', 0, -45, 'x', 'L', 9), T('1', -20, 45, 'x', '1', 9), T('2', 20, 45, 'x', '2', 9)],
    conn: d => [d.state.k1 && ['L', '1'], d.state.k2 && ['L', '2']].filter(Boolean),
    draw: (d, h) => {
      const { k1, k2 } = d.state, hl = hc(h, 'L');
      const one = (x, on, id) => `${on ? blade(x, -12, x, 12, hl) : blade(x, -12, x + 13, 8, hl)}
        <path class="ct${hc(h, id)}" d="M${x} 12 V35"/><circle class="pv" cx="${x}" cy="-12" r="3"/><circle class="cp" cx="${x}" cy="12" r="2.5"/>`;
      return `<rect class="body" x="-45" y="-35" width="90" height="70" rx="9"/>
      <rect class="key${k1 ? ' on' : ''}" x="-39" y="-27" width="37" height="54" rx="6"/>
      <rect class="key${k2 ? ' on' : ''}" x="2" y="-27" width="37" height="54" rx="6"/>
      <path class="ct${hl}" d="M0 -35 V-12 M-20 -12 H20"/>
      ${one(-20, k1, '1')}${one(20, k2, '2')}`;
    },
    toggle: (d, x) => { if (x < 0) d.state.k1 = !d.state.k1; else d.state.k2 = !d.state.k2; return true; }
  },

  swp: {
    name: 'Проходной', group: 'Выключатели',
    init: { state: { pos: 0 } },
    box: () => [-35, -35, 70, 70],
    terms: () => [T('L', 0, -45, 'x', 'L', 9), T('1', -20, 45, 'x', '1', 9), T('2', 20, 45, 'x', '2', 9)],
    conn: d => [['L', d.state.pos ? '2' : '1']],
    draw: (d, h) => {
      const p = d.state.pos, hl = hc(h, 'L');
      return `<rect class="body" x="-35" y="-35" width="70" height="70" rx="9"/>
      <rect class="key${p ? ' on' : ''}" x="-27" y="-27" width="54" height="54" rx="6"/>
      <path class="ct${hl}" d="M0 -35 V-10"/>
      ${blade(0, -10, p ? 20 : -20, 12, hl)}
      <path class="ct${hc(h, '1')}" d="M-20 12 V35"/><path class="ct${hc(h, '2')}" d="M20 12 V35"/>
      <circle class="pv" cx="0" cy="-10" r="3"/><circle class="cp" cx="-20" cy="12" r="2.5"/><circle class="cp" cx="20" cy="12" r="2.5"/>`;
    },
    toggle: d => { d.state.pos = d.state.pos ? 0 : 1; return true; }
  },

  swx: {
    name: 'Перекрёстный', group: 'Выключатели',
    init: { state: { x: false } },
    box: () => [-35, -35, 70, 70],
    terms: () => [T('1', -20, -45, 'x', '1', 9), T('2', 20, -45, 'x', '2', 9), T('3', -20, 45, 'x', '3', 9), T('4', 20, 45, 'x', '4', 9)],
    conn: d => (d.state.x ? [['1', '4'], ['2', '3']] : [['1', '3'], ['2', '4']]),
    draw: (d, h) => {
      const x = d.state.x;
      return `<rect class="body" x="-35" y="-35" width="70" height="70" rx="9"/>
      <rect class="key${x ? ' on' : ''}" x="-27" y="-27" width="54" height="54" rx="6"/>
      <path class="ct${hc(h, '1')}" d="M-20 -35 V-12"/><path class="ct${hc(h, '2')}" d="M20 -35 V-12"/>
      ${blade(-20, -12, x ? 20 : -20, 12, hc(h, '1'))}${blade(20, -12, x ? -20 : 20, 12, hc(h, '2'))}
      <path class="ct${hc(h, '3')}" d="M-20 12 V35"/><path class="ct${hc(h, '4')}" d="M20 12 V35"/>
      <circle class="pv" cx="-20" cy="-12" r="3"/><circle class="pv" cx="20" cy="-12" r="3"/>
      <circle class="cp" cx="-20" cy="12" r="2.5"/><circle class="cp" cx="20" cy="12" r="2.5"/>`;
    },
    toggle: d => { d.state.x = !d.state.x; return true; }
  },

  lamp: {
    name: 'Лампа', group: 'Нагрузка',
    box: () => [-30, -32, 60, 64],
    terms: () => [T('L', -20, 42, 'L'), T('N', 0, 42, 'N'), T('PE', 20, 42, 'PE')],
    conn: () => [],
    draw: (d, h, s) => `${s.lit ? '<circle class="glow" cx="0" cy="-6" r="38"/>' : ''}
      <circle class="bulb${s.lit ? ' lit' : ''}" cx="0" cy="-6" r="22"/>
      <path class="bx" d="M-15.5 -21.5 L15.5 9.5 M15.5 -21.5 L-15.5 9.5"/>
      <rect class="strip" x="-30" y="22" width="60" height="10" rx="2"/>`
  },

  sock: {
    name: 'Розетка', group: 'Нагрузка',
    box: () => [-30, -32, 60, 64],
    terms: () => [T('L', -20, 42, 'L'), T('N', 0, 42, 'N'), T('PE', 20, 42, 'PE')],
    conn: () => [],
    draw: (d, h, s) => `<circle class="face${s.live ? ' live' : ''}" cx="0" cy="-6" r="22"/>
      <rect class="earth" x="-4" y="-27" width="8" height="5" rx="1"/><rect class="earth" x="-4" y="10" width="8" height="5" rx="1"/>
      <circle class="hole" cx="-9" cy="-6" r="3.4"/><circle class="hole" cx="9" cy="-6" r="3.4"/>
      ${s.live ? '<text class="t-xs live-t" x="0" y="-14">220</text>' : ''}
      <rect class="strip" x="-30" y="22" width="60" height="10" rx="2"/>`
  },

  jbox: {
    name: 'Коробка', group: 'Монтаж', isBox: true, noLabel: true, noRotate: true,
    init: { props: { size: 'M' } },
    r: d => ({ S: 60, M: 90, L: 130 })[d.props.size] || 90,
    box: d => { const r = PARTS.jbox.r(d); return [-r, -r, r * 2, r * 2]; },
    terms: () => [],
    conn: () => [],
    draw: d => {
      const r = PARTS.jbox.r(d);
      return `<circle class="jbox" r="${r}"/><circle class="jbox-in" r="${r - 7}"/>
      <text class="t-s jl" x="0" y="${-r + 22}">${esc(d.props.label || 'Коробка')}</text>`;
    }
  },

  wago2: wago(2),
  wago3: wago(3),
  wago5: wago(5),

  text: {
    name: 'Подпись', group: 'Монтаж', noLabel: true, noRotate: true,
    init: { props: { label: 'Подпись' } },
    box: d => { const w = Math.max(40, (d.props.label || '').length * 9 + 16); return [-w / 2, -13, w, 26]; },
    terms: () => [],
    conn: () => [],
    draw: d => `<text class="t-l" x="0" y="5">${esc(d.props.label)}</text>`
  }
};

const GROUPS = ['Щит и питание', 'Выключатели', 'Нагрузка', 'Монтаж'];
