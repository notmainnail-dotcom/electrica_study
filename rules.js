// Проверка схемы по ПУЭ. Правила сформулированы своими словами, у каждого — номер пункта.
// Почти все проверки «статические»: считаем, что все выключатели и автоматы замкнуты (simulate(sc, true)),
// и смотрим, какой потенциал окажется на каждом проводнике при работе.

// допустимый длительный ток, А: ПУЭ табл. 1.3.6, медь, трёхжильный кабель в воздухе (как ВВГ 3×)
const IDOP = { '1.5': 19, '2.5': 25, '4': 35, '6': 42, '10': 55 };
const maxBreakerFor = sec => [...RATINGS].reverse().find(a => a <= IDOP[sec]);
const SWITCH_TYPES = ['sw1', 'sw2', 'swp', 'swx'];
const plural = (n, one, few, many) => n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many;

function checkScheme(sc, powered) {
  const out = [];
  const add = (lvl, pue, text, targets = []) => out.push({ lvl, pue, text, targets });
  const st = simulate(sc, true);
  const name = d => (d.props.label ? `«${d.props.label}»` : PARTS[d.type].name.toLowerCase());
  const brkName = d => `${d.props.ch}${d.props.a}${d.props.label ? ' «' + d.props.label + '»' : ''}`;
  // N и PE в одном узле — это одна ошибка (ниже), цвета и землю там не проверяем, чтобы не плодить следствия
  const merged = k => { const m = st.marksOf(k); return m.has('N') && m.has('PE'); };
  const wcls = w => { const k = wireKey(w); return !k ? null : merged(k) ? 'NPE' : st.cls(k); };
  const wired = new Set();
  for (const w of sc.wires) for (const e of [w.a, w.b]) if (!isFree(e)) wired.add(e.d);
  const dev = id => sc.devices.find(d => d.id === id);

  if (st.short) add('err', '', 'При каком-то положении выключателей будет короткое замыкание: фаза встречается с нулём, землёй или другой фазой');

  // ноль или земля на контактах выключателей и автоматов
  for (const d of sc.devices) {
    const p = PARTS[d.type];
    if (!p.closed) continue;
    const cl = termsOf(d).filter(t => t.kind === 'x').map(t => st.cls(tkey(d.id, t.id)));
    if (cl.includes('PE')) add('err', '7.1.21', `В цепи PE не должно быть выключателей и автоматов, а PE проходит через ${name(d)}`, [{ kind: 'dev', id: d.id }]);
    else if (cl.includes('N') && !cl.some(isHot)) {
      if (SWITCH_TYPES.includes(d.type)) add('err', '6.6.28', `Выключатель${d.props.label ? ' «' + d.props.label + '»' : ''} разрывает ноль, а должен разрывать фазу. Когда он выключен, на лампе остаётся фаза`, [{ kind: 'dev', id: d.id }]);
      else if (p.breaker) add('err', '3.1.18', `Автомат ${brkName(d)} стоит на нуле. Когда он отключится, фаза на линии останется`, [{ kind: 'dev', id: d.id }]);
      else add('err', '', `${PARTS[d.type].name} ${d.props.label ? '«' + d.props.label + '» ' : ''}коммутирует ноль вместо фазы`, [{ kind: 'dev', id: d.id }]);
    }
  }

  // N и PE соединены после ввода
  const bad = sc.wires.filter(w => { const k = wireKey(w); return k && merged(k); });
  if (bad.length) {
    // провода, без которых N и PE разделяются; из них показываем перемычку «клемма N — клемма PE», если она есть
    const bridges = bad.filter(w => {
      const s = simulate({ devices: sc.devices, wires: sc.wires.filter(x => x !== w) }, true);
      return !sc.wires.some(x => x !== w && wireKey(x) && (m => m.has('N') && m.has('PE'))(s.marksOf(wireKey(x))));
    });
    const kindOf = e => { if (isFree(e)) return null; const d = dev(e.d); return d && termsOf(d).find(t => t.id === e.t)?.kind; };
    const direct = bridges.filter(w => [kindOf(w.a), kindOf(w.b)].sort().join() === 'N,PE');
    add('err', '1.7.135', 'Ноль (N) и земля (PE) соединены между собой. После ввода это разные проводники, объединять их нельзя', (direct.length ? direct : bridges).map(w => ({ kind: 'wire', id: w.id })));
  }

  // цвета жил
  const notPE = [], peMisuse = [], notBlue = [], blueHot = [];
  for (const w of sc.wires) {
    const c = wcls(w);
    if (!c || c === 'NPE') continue;
    if (c === 'PE' && w.color !== 'pe') notPE.push(w);
    else if (w.color === 'pe' && c !== 'PE') peMisuse.push(w);
    else if (c === 'N' && w.color !== 'blue') notBlue.push(w);
    else if (w.color === 'blue' && isHot(c)) blueHot.push(w);
  }
  const wt = ws => ws.map(w => ({ kind: 'wire', id: w.id }));
  const nw = ws => `${ws.length} ${plural(ws.length, 'провод', 'провода', 'проводов')}`;
  if (notPE.length) add('err', '1.1.29', `Земля (PE) идёт не жёлто-зелёным проводом: ${nw(notPE)}`, wt(notPE));
  if (peMisuse.length) add('err', '1.1.29', `Жёлто-зелёный провод только для земли (PE), а здесь фаза или ноль: ${nw(peMisuse)}`, wt(peMisuse));
  if (blueHot.length) add('err', '2.1.31', `Голубой провод только для нуля, а здесь фаза: ${nw(blueHot)}`, wt(blueHot));
  if (notBlue.length) add('warn', '1.1.29', `Ноль (N) идёт не голубым проводом: ${nw(notBlue)}`, wt(notBlue));

  // автомат и сечение провода: автомат должен отключаться раньше, чем провод перегреется
  const prot = new Map(); // провод → [автомат, полюс] с наименьшим номиналом
  for (const d of sc.devices) {
    const p = PARTS[d.type];
    if (!p.breaker) continue;
    for (const pole of p.poles) {
      d.state.cut = pole[0];
      const s = simulate(sc, true);
      delete d.state.cut;
      for (const w of sc.wires) {
        const k = wireKey(w);
        if (!k || !isHot(st.cls(k)) || isHot(s.cls(k))) continue;
        const was = prot.get(w.id);
        if (!was || was.props.a > d.props.a) prot.set(w.id, d);
      }
    }
  }
  const byBrk = new Map();
  for (const [wid, d] of prot) {
    const w = sc.wires.find(x => x.id === wid);
    if (d.props.a > IDOP[w.sec]) { if (!byBrk.has(d)) byBrk.set(d, []); byBrk.get(d).push(w); }
  }
  for (const [d, ws] of byBrk) {
    const sec = ws.map(w => w.sec).sort((a, b) => IDOP[a] - IDOP[b])[0];
    add('err', '3.1.11', `Автомат ${brkName(d)} стоит на проводе ${sec.replace('.', ',')} мм², а такой провод держит только ${IDOP[sec]} А. Нужен автомат не больше ${maxBreakerFor(sec)} А или провод толще`,
      [{ kind: 'dev', id: d.id }, ...wt(ws)]);
  }

  // ток по проводу больше допустимого (только под напряжением)
  if (powered) {
    const real = simulate(sc);
    const hotBySec = new Map(); // сечение → { провода, наибольший ток }
    if (!real.short) for (const [wid, I] of wireCurrents(sc, real)) {
      const w = sc.wires.find(x => x.id === wid);
      if (I <= IDOP[w.sec]) continue;
      const g = hotBySec.get(w.sec) || { ws: [], I: 0 };
      g.ws.push(w); g.I = Math.max(g.I, I);
      hotBySec.set(w.sec, g);
    }
    for (const [sec, g] of hotBySec) add('err', 'табл. 1.3.6', `Провод ${sec.replace('.', ',')} мм² перегружен: идёт ${fmtA(g.I)}, а он держит ${IDOP[sec]} А. Будет греться. На этом пути ${nw(g.ws)}`, wt(g.ws));
  }

  // нагрузки: 380, земля, УЗО
  const rcdCover = new Map(); // УЗО до 30 мА → нагрузки, которые питаются через него
  for (const d of sc.devices) {
    if (!PARTS[d.type].rcd || d.props.ma > 30) continue;
    d.state.cutL = true;
    const s = simulate(sc, true);
    delete d.state.cutL;
    for (const [id, r] of st.loads) if (r.st === 'ok' && s.loads.get(id).st !== 'ok') rcdCover.set(id, d);
  }
  const noRcd = [], noRcdOut = [], noPE = [];
  for (const d of sc.devices) {
    if (!PARTS[d.type].load || !wired.has(d.id)) continue;
    const r = st.loads.get(d.id);
    if (r.st === '380') add('err', '', `${PARTS[d.type].name} ${d.props.label ? '«' + d.props.label + '» ' : ''}подключен(а) между двумя фазами — на нём 380 В`, [{ kind: 'dev', id: d.id }]);
    if (r.st !== 'ok') continue;
    if (!st.marksOf(tkey(d.id, 'PE')).has('PE')) noPE.push(d);
    if (d.type === 'sockIP' && !rcdCover.has(d.id)) noRcdOut.push(d);
    else if (d.type === 'sock' && !rcdCover.has(d.id)) noRcd.push(d);
  }
  const dt = ds => ds.map(d => ({ kind: 'dev', id: d.id }));
  const noPEsock = noPE.filter(d => d.type.startsWith('sock')), noPEother = noPE.filter(d => !d.type.startsWith('sock'));
  if (noPEsock.length) add('err', '7.1.36', `Розетки без земли: PE не подключён (${noPEsock.length} шт.)`, dt(noPEsock));
  if (noPEother.length) add('warn', '7.1.68', `Корпус не заземлён, PE не подключён: ${noPEother.map(name).join(', ')}`, dt(noPEother));
  if (noRcdOut.length) add('err', '7.1.82', `Уличные розетки обязательно через УЗО до 30 мА (${noRcdOut.length} шт.)`, dt(noRcdOut));
  if (noRcd.length) add('warn', '7.1.79', `Розеточные группы — через УЗО до 30 мА. Без УЗО: ${noRcd.length} шт.`, dt(noRcd));

  // реле, таймеры, датчики: без фазы и нуля на входе не включатся
  const real = simulate(sc);
  for (const d of sc.devices) {
    if (!PARTS[d.type].supply || !wired.has(d.id)) continue;
    const l = real.cls(tkey(d.id, 'L')), n = real.cls(tkey(d.id, 'N')), zero = n === 'N' || n === 'PE';
    const nm = PARTS[d.type].name + (d.props.label ? ' «' + d.props.label + '»' : '');
    if (isHot(l) && !zero) add('err', '', `${nm} не включится: на клемму N не пришёл ноль. Ему нужно питание — фаза и ноль`, [{ kind: 'dev', id: d.id }]);
    else if (!isHot(st.cls(tkey(d.id, 'L'))) && zero) add('err', '', `${nm} не включится: на клемму L не приходит фаза`, [{ kind: 'dev', id: d.id }]);
  }

  // УЗО друг за другом: верхнее должно быть минимум в 3 раза грубее
  for (const a of sc.devices) {
    if (!PARTS[a.type].rcd) continue;
    a.state.cutL = true;
    const s = simulate(sc, true);
    delete a.state.cutL;
    for (const b of sc.devices) {
      if (b === a || !PARTS[b.type].rcd) continue;
      const k = tkey(b.id, '1');
      if (isHot(st.cls(k)) && !isHot(s.cls(k)) && a.props.ma < b.props.ma * 3)
        add('warn', '7.1.73', `УЗО ${a.props.ma} мА стоит перед УЗО ${b.props.ma} мА: при утечке могут выбить оба. Верхнее должно быть хотя бы в 3 раза грубее (например, 100 мА перед 30 мА)`, dt([a, b]));
    }
  }

  // соединения вне коробки и свободные концы
  const inBox = d => sc.devices.some(b => PARTS[b.type].isBox && boxContains(b, d.x, d.y));
  const outside = sc.devices.filter(d => (d.type === 'twist' || d.type.startsWith('wago')) && wired.has(d.id) && !inBox(d));
  if (outside.length) add('warn', '2.1.26', `Скрутки и Wago должны быть в коробке. Вне коробки: ${outside.length} шт.`, dt(outside));
  const hotEnds = [], looseEnds = [];
  for (const w of sc.wires) if (isFree(w.a) || isFree(w.b)) (isHot(wcls(w)) ? hotEnds : looseEnds).push(w);
  if (hotEnds.length) add('err', '2.1.25', `Оголённая жила под фазой: конец не подключён и не заизолирован (${hotEnds.length} шт.)`, wt(hotEnds));
  if (looseEnds.length) add('warn', '', `Провод никуда не подключён одним концом (${looseEnds.length} шт.)`, wt(looseEnds));

  return out.sort((a, b) => (a.lvl === b.lvl ? 0 : a.lvl === 'err' ? -1 : 1));
}
