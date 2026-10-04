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

const fmtW = w => (w >= 1000 ? (w / 1000).toFixed(1).replace('.', ',').replace(',0', '') + ' кВт' : w + ' Вт');
const LNPE = y => [T('L', -20, y, 'L'), T('N', 0, y, 'N'), T('PE', 20, y, 'PE')];

function socket(ip) {
  return {
    name: ip ? 'Розетка IP44' : 'Розетка', group: 'Свет и розетки', load: true,
    init: { props: { w: 0 } }, // что включено в розетку
    box: () => [-30, -32, 60, 64],
    terms: () => LNPE(42),
    conn: () => [],
    draw: (d, h, s) => `<circle class="face${s.live ? ' live' : ''}" cx="0" cy="-6" r="22"/>
      <rect class="earth" x="-4" y="-27" width="8" height="5" rx="1"/><rect class="earth" x="-4" y="10" width="8" height="5" rx="1"/>
      <circle class="hole" cx="-9" cy="-6" r="3.4"/><circle class="hole" cx="9" cy="-6" r="3.4"/>
      ${ip ? '<path class="lid" d="M-24 -18 A26 26 0 0 1 24 -18"/><text class="t-xs ipt" x="0" y="-36">IP44</text>' : ''}
      ${s.live ? '<text class="t-xs live-t" x="0" y="-14">220</text>' : ''}
      <rect class="strip" x="-30" y="22" width="60" height="10" rx="2"/>`
  };
}

function appliance(name, w, icon) {
  return {
    name, group: 'Техника', load: true,
    init: { props: { w } },
    box: () => [-35, -36, 70, 72],
    terms: () => LNPE(46),
    conn: () => [],
    draw: (d, h, s) => `<rect class="body${s.on ? ' run' : ''}" x="-35" y="-36" width="70" height="62" rx="6"/>
      <g class="ico${s.on ? ' on' : ''}">${icon}</g>
      <text class="t-xs" x="0" y="20">${fmtW(d.props.w)}</text>
      <rect class="strip" x="-35" y="26" width="70" height="10" rx="2"/>`
  };
}

// модуль на DIN-рейку с фазой на входе и выходе и нулём для питания: реле напряжения, таймер, Wi-Fi реле
function module1(name, title, icon, switchable) {
  return {
    name, group: 'Щит и питание',
    init: { state: { on: true } },
    box: () => [-20, -45, 40, 90],
    terms: () => [T('L', -10, -55, 'x', 'L'), T('N', 10, -55, 'N', 'N'), T('out', -10, 55, 'x', '')],
    conn: d => (d.state.on ? [['L', 'out']] : []),
    draw: d => `<rect class="body" x="-20" y="-45" width="40" height="90" rx="3"/>
      <text class="t-xs" x="0" y="-22">${title}</text>
      <g class="ico">${icon}</g>
      <text class="t-xs st${d.state.on ? ' on' : ''}" x="0" y="37">${d.state.on ? 'ВКЛ' : 'ОТКЛ'}</text>`,
    toggle: switchable ? d => { d.state.on = !d.state.on; return true; } : undefined
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

  src3: {
    name: 'Ввод 380 В', group: 'Щит и питание',
    box: () => [-80, -30, 160, 60],
    terms: () => [T('L1', -60, 40, 'L1'), T('L2', -30, 40, 'L2'), T('L3', 0, 40, 'L3'), T('N', 30, 40, 'N'), T('PE', 60, 40, 'PE')],
    conn: () => [],
    draw: () => `<rect class="body" x="-80" y="-30" width="160" height="60" rx="6"/>
      <path class="bolt" d="M-52 -20 L-62 0 H-54 L-59 16 L-44 -6 H-52 L-46 -20Z"/>
      <text class="t-m" x="14" y="-3">ВВОД 3Ф</text><text class="t-s" x="14" y="11">~380/220 В</text>`
  },

  brk: {
    name: 'Автомат 1P', group: 'Щит и питание', breaker: true,
    poles: [['1', '2']],
    init: { state: { on: true }, props: { ch: 'C', a: 16 } },
    box: () => [-18, -45, 36, 90],
    terms: () => [T('1', 0, -55, 'x', ''), T('2', 0, 55, 'x', '')],
    conn: d => (d.state.on ? [['1', '2']].filter(g => g[0] !== d.state.cut) : []),
    draw: d => {
      const on = d.state.on;
      return `<rect class="body" x="-18" y="-45" width="36" height="90" rx="3"/>
      <text class="t-s" x="0" y="-31">${esc(d.props.ch)}${esc(d.props.a)}</text>
      <rect class="slot" x="-9" y="-22" width="18" height="44" rx="3"/>
      <rect class="lever${on ? ' on' : ''}" x="-7" y="${on ? -20 : 2}" width="14" height="18" rx="2"/>
      <text class="t-xs st${on ? ' on' : ''}" x="0" y="37">${on ? 'ВКЛ' : 'ОТКЛ'}</text>
      ${d.state.trip ? '<circle class="trip" cx="10" cy="-38" r="4"/>' : ''}`;
    },
    toggle: (d, x, y) => {
      if (!inRect(x, y, -16, -28, 32, 56)) return false;
      if (d.state.trip) { d.state.trip = false; d.state.on = true; } else d.state.on = !d.state.on;
      return true;
    }
  },

  brk3: {
    name: 'Автомат 3P', group: 'Щит и питание', breaker: true,
    poles: [['1', '2'], ['3', '4'], ['5', '6']],
    init: { state: { on: true }, props: { ch: 'C', a: 25 } },
    box: () => [-54, -45, 108, 90],
    terms: () => [T('1', -36, -55, 'x', ''), T('3', 0, -55, 'x', ''), T('5', 36, -55, 'x', ''), T('2', -36, 55, 'x', ''), T('4', 0, 55, 'x', ''), T('6', 36, 55, 'x', '')],
    conn: d => (d.state.on ? [['1', '2'], ['3', '4'], ['5', '6']].filter(g => g[0] !== d.state.cut) : []),
    draw: d => {
      const on = d.state.on;
      return `<rect class="body" x="-54" y="-45" width="108" height="90" rx="3"/>
      <path class="mod" d="M-18 -45 V45 M18 -45 V45"/>
      <text class="t-s" x="0" y="-31">${esc(d.props.ch)}${esc(d.props.a)}</text>
      ${[-36, 0, 36].map(x => `<rect class="slot" x="${x - 9}" y="-22" width="18" height="44" rx="3"/>`).join('')}
      <rect class="lever${on ? ' on' : ''}" x="-43" y="${on ? -20 : 2}" width="86" height="18" rx="2"/>
      <text class="t-xs st${on ? ' on' : ''}" x="0" y="37">${on ? 'ВКЛ' : 'ОТКЛ'}</text>
      ${d.state.trip ? '<circle class="trip" cx="46" cy="-38" r="4"/>' : ''}`;
    },
    toggle: (d, x, y) => {
      if (!inRect(x, y, -50, -28, 100, 56)) return false;
      if (d.state.trip) { d.state.trip = false; d.state.on = true; } else d.state.on = !d.state.on;
      return true;
    }
  },

  // УЗО 2P: срабатывает, если ток ушёл мимо его нуля (через PE или ноль другой группы)
  rcd: {
    name: 'УЗО 2P', group: 'Щит и питание', rcd: true,
    init: { state: { on: true }, props: { ma: 30, a: 40 } },
    box: () => [-36, -45, 72, 90],
    terms: () => [T('1', -20, -55, 'x', 'L'), T('N', 20, -55, 'N', 'N'), T('2', -20, 55, 'x', ''), T('N2', 20, 55, 'N', '')],
    conn: d => (d.state.on ? [!d.state.cutL && ['1', '2'], !d.state.cutN && ['N', 'N2']].filter(Boolean) : []),
    draw: d => {
      const on = d.state.on;
      return `<rect class="body" x="-36" y="-45" width="72" height="90" rx="3"/>
      <path class="mod" d="M0 -45 V45"/>
      <text class="t-xs" x="0" y="-25">УЗО ${esc(d.props.a)}А ${esc(d.props.ma)}мА</text>
      <rect class="slot" x="-29" y="-16" width="58" height="36" rx="3"/>
      <rect class="lever${on ? ' on' : ''}" x="-26" y="${on ? -14 : 4}" width="52" height="14" rx="2"/>
      <circle class="tbtn" cx="26" cy="31" r="5"/><text class="t-xs" x="26" y="34">T</text>
      <text class="t-xs st${on ? ' on' : ''}" x="-8" y="37">${on ? 'ВКЛ' : 'ОТКЛ'}</text>
      ${d.state.trip ? '<circle class="trip" cx="28" cy="-38" r="4"/>' : ''}`;
    },
    toggle: (d, x, y) => {
      if (!inRect(x, y, -32, -20, 64, 44)) return false;
      if (d.state.trip) { d.state.trip = false; d.state.on = true; } else d.state.on = !d.state.on;
      return true;
    }
  },

  rn: module1('Реле напряжения', 'РН', '<rect class="disp" x="-14" y="-12" width="28" height="16" rx="2"/><text class="t-xs disp-t" x="0" y="-1">220</text>', false),
  tmr: module1('Таймер', 'ТАЙМЕР', '<circle cx="0" cy="-2" r="11"/><path d="M0 -9 V-2 L5 2"/>', true),
  wifi: module1('Wi-Fi реле', 'Wi-Fi', '<path d="M-11 -6 a16 16 0 0 1 22 0 M-7 -1 a10 10 0 0 1 14 0 M-3 4 a4 4 0 0 1 6 0"/><circle cx="0" cy="8" r="1.6"/>', true),

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
    name: 'Лампа', group: 'Свет и розетки', load: true,
    init: { props: { w: 100 } },
    box: () => [-30, -32, 60, 64],
    terms: () => [T('L', -20, 42, 'L'), T('N', 0, 42, 'N'), T('PE', 20, 42, 'PE')],
    conn: () => [],
    draw: (d, h, s) => `${s.lit ? '<circle class="glow" cx="0" cy="-6" r="38"/>' : ''}
      <circle class="bulb${s.lit ? ' lit' : ''}" cx="0" cy="-6" r="22"/>
      <path class="bx" d="M-15.5 -21.5 L15.5 9.5 M15.5 -21.5 L-15.5 9.5"/>
      <rect class="strip" x="-30" y="22" width="60" height="10" rx="2"/>`
  },

  sock: socket(false),
  sockIP: socket(true),

  // техника: мощность в props.w пригодится для расчёта перегрузки автоматов
  hob: appliance('Варочная панель', 7000, '<rect x="-20" y="-28" width="40" height="34" rx="3"/><circle cx="-9" cy="-19" r="5"/><circle cx="9" cy="-19" r="5"/><circle cx="-9" cy="-3" r="5"/><circle cx="9" cy="-3" r="5"/>'),
  oven: appliance('Духовой шкаф', 3500, '<rect x="-20" y="-28" width="40" height="34" rx="3"/><path d="M-20 -20 H20"/><rect x="-13" y="-15" width="26" height="16" rx="2"/><circle cx="-11" cy="-24" r="1.4"/><circle cx="0" cy="-24" r="1.4"/><circle cx="11" cy="-24" r="1.4"/>'),
  mw: appliance('СВЧ', 1200, '<rect x="-22" y="-25" width="44" height="28" rx="3"/><rect x="-17" y="-20" width="25" height="18" rx="2"/><path d="M13 -19 v4 M13 -10 v4"/>'),
  washer: appliance('Стиральная машина', 2200, '<rect x="-18" y="-29" width="36" height="36" rx="3"/><path d="M-18 -21 H18"/><circle cx="0" cy="-5" r="10"/><circle cx="0" cy="-5" r="5"/>'),
  dryer: appliance('Сушильная машина', 2500, '<rect x="-18" y="-29" width="36" height="36" rx="3"/><path d="M-18 -21 H18"/><circle cx="0" cy="-5" r="10"/><path d="M-6 -5 q3 -5 6 0 t6 0"/>'),
  dish: appliance('ПММ', 2000, '<rect x="-18" y="-29" width="36" height="36" rx="3"/><path d="M-18 -21 H18"/><circle cx="-6" cy="-6" r="6"/><circle cx="7" cy="-6" r="6"/>'),
  fridge: appliance('Холодильник', 300, '<rect x="-14" y="-30" width="28" height="38" rx="3"/><path d="M-14 -16 H14 M-8 -26 v6 M-8 -11 v9"/>'),
  boiler: appliance('Водонагреватель', 2000, '<rect x="-14" y="-30" width="28" height="38" rx="10"/><path d="M0 -21 c-6 8 -6 12 0 12 c6 0 6 -4 0 -12Z"/>'),
  ac: appliance('Кондиционер', 1500, '<rect x="-24" y="-26" width="48" height="20" rx="4"/><path d="M-18 -11 H18 M-12 -2 l-3 6 M0 -2 v7 M12 -2 l3 6"/>'),
  hood: appliance('Вытяжка', 200, '<path d="M-6 -30 h12 v10 l14 12 h-40 l14 -12 Z"/><path d="M-12 -2 v5 M0 -2 v5 M12 -2 v5"/>'),
  floor: appliance('Тёплый пол', 1500, '<path d="M-20 -27 H14 a4 4 0 0 1 0 8 H-14 a4 4 0 0 0 0 8 H14 a4 4 0 0 1 0 8 H-20"/>'),
  pump: appliance('Насос', 750, '<circle cx="0" cy="-11" r="16"/><path d="M-8 -25 L16 -11 L-8 3"/>'),
  heat: appliance('Прогрев труб', 300, '<path d="M-24 -20 H24 M-24 -2 H24"/><path d="M-20 -11 q4 -6 8 0 t8 0 t8 0 t8 0 t8 0"/>'),
  fan: appliance('Вентиляция', 100, '<circle cx="0" cy="-11" r="17"/><path d="M0 -11 c-2 -8 4 -12 8 -9 c-2 4 -4 7 -8 9 Z M0 -11 c8 -2 12 4 9 8 c-4 -2 -7 -4 -9 -8 Z M0 -11 c-6 6 -13 2 -12 -3 c4 0 8 0 12 3 Z"/>'),

  // скрутка: точка, где сходятся концы проводов; рисуется самой клеммой (node), корпуса нет
  twist: {
    name: 'Скрутка', group: 'Монтаж', node: true, hidden: true, noLabel: true, noRotate: true,
    box: () => [-6, -6, 12, 12],
    terms: () => [T('p', 0, 0, 'x', '')],
    conn: () => [],
    draw: () => ''
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

const GROUPS = ['Щит и питание', 'Выключатели', 'Свет и розетки', 'Техника', 'Монтаж'];
