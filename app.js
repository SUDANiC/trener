/* Trener – aplikacja do prowadzenia podopiecznych (PWA, dane tylko na telefonie) */
'use strict';
const KEY = 'trener-data-v1';
const $app = document.getElementById('app');
let DB = null;
let ui = { search: '', tab: {}, sheet: {}, reviewClient: '', restSec: 90 };
let rest = null; // {end, int}

// ------------------------------------------------------------------ dane
function load() {
  try { const s = localStorage.getItem(KEY); DB = s ? JSON.parse(s) : null; } catch (e) { DB = null; }
  try { const u = localStorage.getItem(KEY + '-ui'); if (u) Object.assign(ui, JSON.parse(u), { search: '' }); } catch (e) {}
}
let saveT = null;
function save(now) {
  clearTimeout(saveT);
  if (DB) DB.savedAt = new Date().toISOString();
  const f = () => {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); Drive.schedule(); }
    catch (e) { toast('Brak miejsca w pamięci – zrób eksport kopii!'); }
  };
  now ? f() : (saveT = setTimeout(f, 250));
}
function saveUi() { try { localStorage.setItem(KEY + '-ui', JSON.stringify({ restSec: ui.restSec, tab: ui.tab })); } catch (e) {} }
const nid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const client = id => DB.clients.find(c => c.id === id);
const plan = (c, id) => c.plans.find(p => p.id === id);
function fmtNum(n) { return n == null || n === '' ? '' : String(+(+n).toFixed(2)).replace('.', ','); }
function setText(s) {
  if (!s) return '';
  const parts = [];
  if (s.kg != null && s.kg !== '') parts.push(fmtNum(s.kg) + ' kg');
  if (s.reps != null && s.reps !== '') parts.push((parts.length ? '× ' : '') + fmtNum(s.reps));
  if (s.sec) parts.push((parts.length ? '· ' : '') + s.sec + ' s');
  let t = parts.join(' ');
  if ((s.text || s.note) && s.raw) t = t ? `${t} <span class="muted">(${esc(s.raw)})</span>` : esc(s.raw);
  if (!t && s.raw) t = esc(s.raw);
  return t;
}
function setPlain(s) { return setText(s).replace(/<[^>]+>/g, ''); }
function colorFor(name) { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 55% 42%)`; }
function initials(n) { return n.split(/[\s+]+/).filter(w => /[A-Za-zĄ-ż]/.test(w[0])).slice(0, 2).map(w => w[0].toUpperCase()).join(''); }
function fmtDate(iso) { if (!iso) return ''; const d = new Date(iso); return d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); }
function sessTitle(s, c) {
  if (s.members && s.members.length > 1) return 'Trening wspólny · ' + s.members.join(' + ');
  const p = plan(c, s.planId);
  return (p ? p.name : 'Trening') + (s.member ? ' · ' + s.member : '');
}
function sessWhen(s, c) {
  if (s.date) return fmtDate(s.date);
  const same = c.sessions.filter(x => x.planId === s.planId && !x.date);
  const n = same.indexOf(s) + 1;
  return `Import · sesja ${n}${s.label ? ' · ' + esc(s.label) : ''}`;
}
function sortedSessions(c) { // najnowsze najpierw
  const app = c.sessions.filter(s => s.date).sort((a, b) => b.date.localeCompare(a.date));
  const imp = c.sessions.filter(s => !s.date).sort((a, b) => (b.order || 0) - (a.order || 0));
  return app.concat(imp);
}
function ambCount(c) { let n = 0; for (const s of c.sessions) for (const e of s.entries) for (const x of e.sets) if (x.amb && !x.dup) n++; return n; }
function totalAmb() { return DB ? DB.clients.reduce((a, c) => a + ambCount(c), 0) : 0; }
function exById(c, id) { for (const p of c.plans) for (const e of p.exercises) if (e.id === id) return e; for (const e of (c.extraEx || [])) if (e.id === id) return e; return null; }
function exName(c, id) { const e = exById(c, id); return e ? e.name : '?'; }
function cleanSet(x) { return !x.note && !x.text && (x.kg != null || x.reps != null || !!x.sec); }
function lastFor(c, ex, skipSid, member, any) { // ostatnie wykonanie ćwiczenia dla osoby; domyślnie pomija zamiany/dopiski z Excela
  const n = norm(ex.name);
  for (const s of sortedSessions(c)) {
    if (s.id === skipSid || s.live) continue;
    for (const en of s.entries) {
      const m = en.member ?? s.member ?? null;
      if (member && m && m !== member) continue;
      if (en.exId === ex.id || norm(exName(c, en.exId)) === n) {
        if (any ? en.sets.some(x => x.kg != null || x.reps != null || x.sec || x.raw) : en.sets.some(cleanSet)) return { s, en };
      }
    }
  }
  return null;
}
function prevSets(l) { return l ? l.en.sets.filter(cleanSet) : []; }
// rodzaje zapisu ćwiczenia
const MODES = { kgr: ['kg × powt.', ['kg', 'reps']], r: ['powtórzenia', ['reps']], t: ['czas', ['sec']], kgt: ['kg × czas', ['kg', 'sec']] };
const FLABEL = { kg: 'kg', reps: 'Powt', sec: 'Czas (s)' };
function exMode(c, ex, en) {
  if (en && en.mode) return en.mode;
  if (ex && ex.mode) return ex.mode;
  if (ex && c) { const l = lastFor(c, ex, null, null, true); if (l) { const st = l.en.sets.filter(x => x.kg != null || x.reps != null || x.sec); if (st.length && st.every(x => x.sec && x.reps == null)) return st.some(x => x.kg != null) ? 'kgt' : 't'; } }
  return 'kgr';
}
function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l'); }
function ssLabelsFor(ids) { // superserie: kolejne ćwiczenia z tym samym ss → A1, A2…
  const out = ids.map(() => null); let letter = 0;
  for (let i = 0; i < ids.length;) {
    let j = i; while (ids[i] && j + 1 < ids.length && ids[j + 1] === ids[i]) j++;
    if (j > i) { const L = String.fromCharCode(65 + letter++ % 26); for (let k = i; k <= j; k++) out[k] = L + (k - i + 1); }
    i = j + 1;
  }
  return out;
}
// menedżer kolejności i superserii: items [{label, sub, ss}] → onSave(order, ssIds)
function reorderModal(title, items, onSave) {
  let list = items.map((it, i) => ({ ...it, i }));
  let link = list.map((it, i) => !!(it.ss && list[i + 1] && list[i + 1].ss === it.ss));
  const draw = m => {
    let g = 0, cur = null; const grp = list.map((_, i) => { if (i > 0 && link[i - 1]) return cur; cur = link[i] ? 'g' + (++g) : null; return cur; });
    const labels = ssLabelsFor(grp);
    m.innerHTML = `<h3>${esc(title)}</h3><div class="small muted" style="margin-bottom:8px">Strzałkami zmieniasz kolejność. 🔗 łączy ćwiczenie z następnym w superserię.</div>
    ${list.map((it, i) => `<div class="row" style="padding:8px 0;${i ? 'border-top:1px solid var(--line)' : ''}${grp[i] ? ';border-left:3px solid #c084fc;padding-left:8px' : ''}">
      <div class="grow"><div style="font-weight:600">${labels[i] ? `<span style="color:#c084fc">${labels[i]}</span> ` : ''}${esc(it.label)}</div>${it.sub ? `<div class="tiny muted">${esc(it.sub)}</div>` : ''}</div>
      <button class="ib" data-mv="${i}:-1" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button><button class="ib" data-mv="${i}:1" ${i === list.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
      ${i < list.length - 1 ? `<button class="ib" data-ln="${i}" style="${link[i] ? 'background:rgba(192,132,252,.25)' : ''}">🔗</button>` : '<span style="width:40px"></span>'}</div>`).join('')}
    <div style="height:12px"></div><div class="row"><button class="btn grow" data-x>Anuluj</button><button class="btn p grow" data-y>Zapisz</button></div>`;
    m.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number), j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; const lo = Math.min(i, j); link[lo] = false; if (lo > 0) link[lo - 1] = false; if (lo + 1 < link.length) link[lo + 1] = false; draw(m); });
    m.querySelectorAll('[data-ln]').forEach(b => b.onclick = () => { const i = +b.dataset.ln; link[i] = !link[i]; draw(m); });
    m.querySelector('[data-x]').onclick = () => m.parentNode.remove();
    m.querySelector('[data-y]').onclick = () => { m.parentNode.remove(); const suf = nid().slice(-5); onSave(list.map(it => it.i), grp.map(g2 => g2 ? g2 + '-' + suf : null)); };
  };
  modal('', m => draw(m));
}
// biblioteka ćwiczeń
const EXDB_IMG = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/';
let EXDB = null, REPDB = null;
const REPDB_BASE = 'https://exercise-dataset.com/';
async function loadRepdb() { // ilustracje RepDB: dane pobierane od autora, polskie nazwy z pliku aplikacji
  if (REPDB) return REPDB;
  const url = REPDB_BASE + 'exercises.json';
  let r = null;
  try { const cache = await caches.open('trener-repdb'); r = await cache.match(url); if (!r) { const net = await fetch(url); if (!net.ok) throw new Error(net.status); await cache.put(url, net.clone()); r = net; } }
  catch (e) { r = await fetch(url); if (!r.ok) throw new Error('Ilustracje niedostępne'); }
  const [data, pl] = await Promise.all([r.json(), fetch('repdb-pl.json').then(x => x.json())]);
  REPDB = data.exercises.map(e => {
    const fl = (e.images && e.images.flat) || {}, im = fl.peak || fl.main || fl.start, im2 = fl.start && fl.peak ? fl.start : null;
    const id = e.id, hold = /hold|hang|plank|sit$|pose|stretch|savasana|stand$|stance|lever|planche|flag|bridge-hold/.test(id);
    const carry = /carry|walk$|farmers/.test(id);
    const md = e.category === 'stretching' || e.category === 'cardio' || hold ? (hold && !e.is_bodyweight ? 'kgt' : 't') : carry ? 'kgt' : e.is_bodyweight ? 'r' : 'kgr';
    const mu = k => (e[k] || []).map(m => pl.muscles[m] || m.replace(/_/g, ' '));
    return { n: pl.names[id] || e.name_en, en: e.name_en, c: pl.body[e.body_part] || '', cat: pl.cat[e.category] || e.category, m: mu('primary_muscles'), m2: mu('secondary_muscles'), l: pl.lvl[e.difficulty] || '', img: im ? REPDB_BASE + im : null, img2: im2 ? REPDB_BASE + im2 : null, md, tips: e.tips_en || [], steps: e.instructions_en || [] };
  });
  return REPDB;
}
async function loadExdb() {
  if (EXDB) return EXDB;
  const r = await fetch('exdb-pl.json'); if (!r.ok) throw new Error('Baza niedostępna');
  EXDB = (await r.json()).ex; return EXDB;
}
function libraryPick(onPick) {
  let cat = 'Twoje', q = '';
  const own = () => { const out = [], seen = new Set();
    for (const cl of DB.clients) for (const ex of cl.plans.flatMap(p => p.exercises).concat(cl.extraEx || [])) { const k = norm(ex.name); if (seen.has(k)) continue; seen.add(k); out.push({ name: ex.name, cat: 'Twoje', mode: ex.mode || exMode(cl, ex) }); }
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pl')); };
  const pl = () => EXLIB.map(([c, n, m]) => ({ name: n, cat: c, mode: m }));
  const db = () => (EXDB || []).map(e => ({ name: e.n, cat: e.c, mode: e.md, img: e.img && e.img[0], img2: e.img && e.img[1], sub: [e.eq, e.m.join(', ')].filter(Boolean).join(' · '), extra: e.en + ' ' + e.m.concat(e.m2).join(' ') + ' ' + e.eq, main: e.en + ' ' + e.m.join(' ') + ' ' + e.eq, ex: e }));
  const DBTAB = '📷 Zdjęcia (876)', ILTAB = '🎨 Ilustracje (708)';
  const il = () => (REPDB || []).map(e => ({ name: e.n, cat: e.c, mode: e.md, imgUrl: e.img, sub: [e.c, e.m.join(', ')].filter(Boolean).join(' · '), extra: e.en + ' ' + e.m.concat(e.m2).join(' ') + ' ' + e.cat, main: e.en + ' ' + e.m.join(' ') + ' ' + e.c, rep: e }));
  modal(`<h3>Biblioteka ćwiczeń</h3><input class="search" id="lq" placeholder="Szukaj: nazwa, mięsień, sprzęt (np. pośladki, hantle)…" style="margin-bottom:8px">
    <div class="tabs" id="lcat"></div><div id="lres"></div>`, (m, close) => {
    const res = m.querySelector('#lres'), qi = m.querySelector('#lq'), cats = m.querySelector('#lcat');
    const drawCats = () => { cats.innerHTML = ['Twoje', 'Wszystkie', ILTAB, DBTAB].concat(EXLIB_CATS).map(k => `<button class="tab ${k === cat ? 'on' : ''}" data-c="${esc(k)}">${esc(k)}</button>`).join('');
      cats.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { cat = b.dataset.c; drawCats(); draw(); }); };
    const draw = async () => {
      if (!REPDB && cat !== 'Twoje' && cat !== DBTAB) { res.innerHTML = '<div class="empty">Ładuję ilustracje…</div>'; try { await loadRepdb(); } catch (e) { if (cat === ILTAB) { res.innerHTML = '<div class="empty">Ilustracje potrzebują internetu przy pierwszym otwarciu</div>'; return; } } }
      if (!EXDB && (cat === DBTAB || cat === 'Wszystkie' || EXLIB_MAP[cat])) { try { await loadExdb(); } catch (e) { if (cat === DBTAB) { res.innerHTML = '<div class="empty">Nie udało się wczytać bazy</div>'; return; } } }
      const ilNames = new Set(il().map(x => fold(x.name)));
      const dbU = () => db().filter(x => !ilNames.has(fold(x.name)));   // zdjęcia tylko dla ćwiczeń bez ilustracji
      let src;
      if (cat === ILTAB) src = il();
      else if (cat === DBTAB) src = db();
      else if (cat === 'Twoje') src = own();
      else if (cat === 'Wszystkie') src = own().concat(il(), pl(), dbU());
      else src = il().filter(x => x.rep && (x.rep.c === cat || (EXLIB_MAP[cat] || []).some(mm => x.rep.m.join(' ').includes(mm.split(' ')[0])))).concat(pl().filter(x => x.cat === cat), dbU().filter(x => x.ex && EXLIB_MAP[cat] && EXLIB_MAP[cat].some(mm => x.ex.m.includes(mm))));
      const toks = fold(q).split(/\s+/).filter(Boolean);
      const seen = new Set();
      const rank = x => { const main = fold(x.name) + ' ' + fold(x.main || ''); return toks.every(t => main.includes(t)) ? 0 : 1; };
      const hits = src.filter(x => { const f = fold(x.name); if (seen.has(f)) return false; seen.add(f); const hay = f + ' ' + fold(x.extra || ''); return toks.every(t => hay.includes(t)); })
        .map((x, i) => [x, i]).sort((A, B) => rank(A[0]) - rank(B[0]) || A[1] - B[1]).map(([x]) => x).slice(0, 150);
      const canAdd = q.trim() && !hits.some(h => fold(h.name) === fold(q.trim()));
      res.innerHTML = (canAdd ? `<div class="list-i" data-new="1"><div class="grow"><b>＋ Nowe: „${esc(q.trim())}”</b></div></div>` : '') +
        hits.map((x, i) => `<div class="list-i" data-i="${i}">${x.imgUrl || x.img ? `<img src="${x.imgUrl || EXDB_IMG + x.img}" loading="lazy" style="width:52px;height:52px;object-fit:cover;border-radius:10px;background:#dbeefa;flex:none">` : ''}<div class="grow"><div>${esc(x.name)}</div><div class="tiny muted">${esc(x.sub || (x.cat !== 'Twoje' ? x.cat : 'z Twoich planów'))}${x.mode ? ' · ' + MODES[x.mode][0] : ''}</div></div>${x.ex || x.rep ? `<button class="ib" data-inf="${i}">ℹ️</button>` : ''}</div>`).join('') || '<div class="empty">Brak wyników</div>';
      res.insertAdjacentHTML('beforeend', `<div class="tiny muted" style="text-align:center;padding:14px 0 4px">Ilustracje: Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a> · zdjęcia: free-exercise-db</div>`);
      res.querySelectorAll('[data-i]').forEach(el => el.onclick = e => { if (e.target.closest('[data-inf]')) return; close(); onPick(hits[+el.dataset.i]); });
      res.querySelectorAll('[data-inf]').forEach(b => b.onclick = () => { const x = hits[+b.dataset.inf];
        if (x.rep) { const e = x.rep;
          return modal(`<h3>${esc(e.n)}</h3><div class="tiny muted" style="margin-bottom:8px">${esc(e.en)}</div>
          <div class="row" style="gap:6px">${[e.img2, e.img].filter(Boolean).map(u => `<img src="${u}" style="width:${e.img2 ? 50 : 100}%;border-radius:12px;background:#dbeefa">`).join('')}</div>
          <p class="small"><b>Mięśnie:</b> ${esc(e.m.join(', '))}${e.m2.length ? `<br><span class="muted">pomocniczo: ${esc(e.m2.join(', '))}</span>` : ''}<br><b>Partia:</b> ${esc(e.c)} · <b>Poziom:</b> ${esc(e.l)} · <b>Zapis:</b> ${MODES[e.md][0]}</p>
          <div class="tiny muted" style="margin-bottom:10px">Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a></div>
          <div class="row"><button class="btn grow" data-x>Wróć</button><button class="btn p grow" data-y>Wybierz</button></div>`, (mm, cl2) => {
          mm.querySelector('[data-x]').onclick = cl2; mm.querySelector('[data-y]').onclick = () => { cl2(); close(); onPick(x); }; }); }
        const e = x.ex;
        modal(`<h3>${esc(e.n)}</h3><div class="tiny muted" style="margin-bottom:8px">${esc(e.en)}</div>
          <div class="row" style="gap:6px">${e.img.map(im => `<img src="${EXDB_IMG + im}" style="width:50%;border-radius:10px;background:#fff">`).join('')}</div>
          <p class="small"><b>Mięśnie:</b> ${esc(e.m.join(', '))}${e.m2.length ? `<br><span class="muted">pomocniczo: ${esc(e.m2.join(', '))}</span>` : ''}<br><b>Sprzęt:</b> ${esc(e.eq)} · <b>Poziom:</b> ${esc(e.l)} · <b>Zapis:</b> ${MODES[e.md][0]}</p>
          <div class="row"><button class="btn grow" data-x>Wróć</button><button class="btn p grow" data-y>Wybierz</button></div>`, (mm, cl2) => {
          mm.querySelector('[data-x]').onclick = cl2; mm.querySelector('[data-y]').onclick = () => { cl2(); close(); onPick(x); }; }); });
      const nw = res.querySelector('[data-new]'); if (nw) nw.onclick = () => { close(); onPick({ name: q.trim(), mode: null }); };
    };
    qi.oninput = () => { q = qi.value; if (q && cat === 'Twoje' && !own().some(x => fold(x.name).includes(fold(q)))) { cat = 'Wszystkie'; drawCats(); } draw(); };
    drawCats(); draw(); setTimeout(() => qi.focus(), 50);
  });
}
let LIBIDX = null;
function libIndex() { // nazwa (fold) → {mode, img}
  if (LIBIDX && LIBIDX._r === !!REPDB && LIBIDX._e === !!EXDB) return LIBIDX;
  const m = new Map();
  for (const [, n, md] of EXLIB) m.set(fold(n), { mode: md });
  for (const e of (EXDB || [])) if (!m.has(fold(e.n)) || !m.get(fold(e.n)).img) m.set(fold(e.n), { mode: (m.get(fold(e.n)) || {}).mode || e.md, img: e.img && e.img[0] ? EXDB_IMG + e.img[0] : null });
  for (const e of (REPDB || [])) m.set(fold(e.n), { mode: e.md, img: e.img });
  LIBIDX = { map: m, _r: !!REPDB, _e: !!EXDB };
  return LIBIDX;
}
function libInfo(name) { return libIndex().map.get(fold(name)) || null; }
function exIcon(name, size = 38) {
  const i = libInfo(name);
  return i && i.img ? `<img src="${i.img}" loading="lazy" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background:#dbeefa">` : '🏋️';
}
let libLoading = null;
function ensureLib(then) { // doczytaj bazy w tle i odśwież widok
  if (REPDB && EXDB) return;
  if (!libLoading) libLoading = Promise.allSettled([loadRepdb(), loadExdb()]).then(() => { LIBIDX = null; });
  libLoading.then(() => then && then());
}
// kategorie polskiej listy ↔ mięśnie w bazie ze zdjęciami
const EXLIB_MAP = { Nogi: ['czworogłowe uda', 'dwugłowe uda', 'łydki', 'przywodziciele', 'odwodziciele'], Pośladki: ['pośladki', 'dwugłowe uda'], Plecy: ['najszersze grzbietu', 'środek pleców', 'dolny odcinek pleców', 'czworoboczne'], Klatka: ['klatka'], Barki: ['barki'], Ramiona: ['biceps', 'triceps', 'przedramiona'], Core: ['brzuch'], Kondycja: [], Mobilność: [] };
const STYPES = { w: ['W', 'Rozgrzewkowa', 'var(--warn)'], f: ['F', 'Do upadku', 'var(--bad)'], d: ['D', 'Drop set', '#c084fc'] };
function setLabel(sets, si) { const x = sets[si]; if (x.type && STYPES[x.type]) return STYPES[x.type][0]; return String(sets.slice(0, si + 1).filter(y => y.type !== 'w').length); }
function setLabelHtml(sets, si) { const t = sets[si].type; return `<span style="color:${t && STYPES[t] ? STYPES[t][2] : 'inherit'}">${setLabel(sets, si)}</span>`; }
function bestKg(en) { let m = null; for (const x of en.sets) if (x.type !== 'w' && typeof x.kg === 'number' && (m == null || x.kg > m)) m = x.kg; return m; }
function allExerciseNames() {
  const set = new Map();
  for (const c of DB.clients) for (const p of c.plans) for (const e of p.exercises) { const k = norm(e.name); if (!set.has(k)) set.set(k, e.name); }
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'pl'));
}

// ------------------------------------------------------------------ UI pomocnicze
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 2200); }
function go(h) { location.hash = h; }
function topBar(title, { back, right = '' } = {}) {
  return `<div class="top">${back ? `<button class="ib" data-act="back" aria-label="Wstecz">‹</button>` : ''}<h1>${title}</h1>${right}</div>`;
}
function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  onMount && onMount(bg.querySelector('.modal'), () => bg.remove());
  return bg;
}
function menu(items) {
  modal(items.map((it, i) => `<button class="menu-i ${it.danger ? 'hl' : ''}" data-i="${i}">${it.icon || ''} ${esc(it.label)}</button>`).join(''), (m, close) => {
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { close(); items[+b.dataset.i].fn(); });
  });
}
function confirmBox(text, fn, yes = 'Usuń') {
  modal(`<h3>${esc(text)}</h3><div class="row"><button class="btn grow" data-x>Anuluj</button><button class="btn p grow" data-y>${esc(yes)}</button></div>`, (m, close) => {
    m.querySelector('[data-x]').onclick = close; m.querySelector('[data-y]').onclick = () => { close(); fn(); };
  });
}
function prompt2(title, fields, fn) { // fields: [{k,label,v,type,list}]
  const dl = fields.some(f => f.list) ? `<datalist id="exlist">${allExerciseNames().map(n => `<option value="${esc(n)}">`).join('')}</datalist>` : '';
  modal(`<h3>${esc(title)}</h3>${fields.map(f => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'select' ? `<select class="inp" data-k="${f.k}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(f.v) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : f.type === 'area' ? `<textarea class="inp" data-k="${f.k}">${esc(f.v || '')}</textarea>` : `${f.list ? '<div class="row">' : ''}<input class="inp" data-k="${f.k}" value="${esc(f.v ?? '')}" ${f.list ? 'list="exlist"' : ''} ${f.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(f.ph || '')}">${f.list ? `<button class="btn" data-lib="${f.k}" style="flex:none">📚</button></div>` : ''}`}</label>`).join('')}${dl}<div class="row"><button class="btn grow" data-x>Anuluj</button><button class="btn p grow" data-y>Zapisz</button></div>`, (m, close) => {
    const first = m.querySelector('[data-k]'); setTimeout(() => first && first.focus(), 50);
    m.querySelectorAll('[data-lib]').forEach(b => b.onclick = () => libraryPick(x => { m.querySelector(`[data-k="${b.dataset.lib}"]`).value = x.name; const md = m.querySelector('[data-k="mode"]'); if (md && x.mode) md.value = x.mode; }));
    m.querySelector('[data-x]').onclick = close;
    m.querySelector('[data-y]').onclick = () => { const o = {}; m.querySelectorAll('[data-k]').forEach(i => o[i.dataset.k] = i.value.trim()); close(); fn(o); };
  });
}
function parseNum(v) { if (v == null) return null; v = String(v).replace(',', '.').trim(); if (v === '') return null; const n = parseFloat(v); return isNaN(n) ? null : n; }

// ------------------------------------------------------------------ router
window.addEventListener('hashchange', render);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act="back"]'); if (b) { history.length > 1 ? history.back() : go('#/'); }
});
function render() {
  if (!DB) return renderWelcome();
  const h = (location.hash || '#/').slice(1).split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  if (!h.length) return renderHome();
  if (h[0] === 'review') return renderReview();
  if (h[0] === 'settings') return renderSettings();
  if (h[0] === 'unify') return renderUnify();
  if (h[0] === 'c') {
    const c = client(h[1]); if (!c) return go('#/');
    if (h.length === 2) return renderClient(c);
    if (h[2] === 'p' && h[4] === 'edit') return renderPlanEdit(c, h[3]);
    if (h[2] === 'p') return renderPlan(c, h[3]);
    if (h[2] === 'w') return renderWorkout(c, h[3]);
    if (h[2] === 's') return renderSession(c, h[3]);
    if (h[2] === 'e') return renderExercise(c, h[3]);
  }
  go('#/');
}

// ------------------------------------------------------------------ powitanie / import
function renderWelcome() {
  $app.innerHTML = `${topBar('Trener')}<main>
  <div class="card"><h2 style="margin-top:0">Witaj 👋</h2>
  <p class="muted">Dane podopiecznych są przechowywane <b>wyłącznie na tym telefonie</b>. Wczytaj plik <b>podopieczni-dane.json</b> przygotowany z Twoich Exceli albo zacznij od zera.</p>
  <button class="btn p w" id="imp">📂 Wczytaj plik z danymi</button><div style="height:10px"></div>
  <button class="btn w" id="gd">☁️ Pobierz dane z Dysku Google</button><div style="height:10px"></div>
  <button class="btn w" id="fresh">Zacznij od zera</button></div></main>`;
  document.getElementById('gd').onclick = () => Drive.connect();
  document.getElementById('imp').onclick = pickImport;
  document.getElementById('fresh').onclick = () => { DB = { app: 'trener', version: 1, clients: [] }; save(true); render(); };
}
function pickImport() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
  i.onchange = () => {
    const f = i.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.clients) throw new Error('to nie jest plik aplikacji Trener');
        const apply = mode => {
          if (mode === 'replace' || !DB) DB = d;
          else { // scal: dodaj brakujących podopiecznych
            const have = new Set(DB.clients.map(c => c.id));
            let n = 0; for (const c of d.clients) if (!have.has(c.id)) { DB.clients.push(c); n++; }
            toast(`Dodano ${n} podopiecznych`);
          }
          save(true); go('#/'); render();
        };
        if (DB && DB.clients.length) {
          menu([{ label: 'Zaktualizuj dane z Excela (zachowaj treningi z aplikacji)', icon: '🔄', fn: () => { const n = mergeImport(d); save(true); go('#/'); render(); toast(`Zaktualizowano ${n} podopiecznych`); } },
                { label: 'Zastąp wszystkie dane plikiem', icon: '♻️', fn: () => confirmBox('Na pewno zastąpić obecne dane?', () => apply('replace'), 'Zastąp') },
                { label: 'Dodaj tylko nowych podopiecznych', icon: '➕', fn: () => apply('merge') }]);
        } else apply('replace');
      } catch (e) { toast('Nie udało się wczytać: ' + e.message); }
    };
    r.readAsText(f);
  };
  i.click();
}
// aktualizacja importu: nowe plany i historia z Excela + zachowane treningi/plany z aplikacji i zatwierdzenia
function mergeImport(N) {
  let n = 0;
  const isImpPlan = (c, p) => p.imp || /^[0-9a-f]{10}$/.test(p.id) || c.sessions.some(s => s.source === 'import' && s.planId === p.id);
  for (const nc of N.clients) {
    const oc = DB.clients.find(c => c.id === nc.id) || DB.clients.find(c => norm(c.name) === norm(nc.name));
    if (!oc) { DB.clients.push(nc); n++; continue; }
    n++;
    const oldName = id => exName(oc, id);
    // zatwierdzone wcześniej wpisy (bez „?”) – przenosimy decyzje
    const decided = new Map();
    for (const s of oc.sessions) if (s.source === 'import') for (const en of s.entries) for (const x of en.sets) if (x.raw && !x.amb) decided.set(norm(oldName(en.exId)) + '|' + x.raw, x);
    const keepPlans = oc.plans.filter(p => !isImpPlan(oc, p));
    const appSess = oc.sessions.filter(s => s.source !== 'import');
    const newPlans = nc.plans.concat(keepPlans);
    const extra = (nc.extraEx || []).slice();
    const findEx = (name, preferPlan) => {
      const k = norm(name);
      if (preferPlan) { const e = preferPlan.exercises.find(e => norm(e.name) === k); if (e) return e; }
      for (const p of newPlans) for (const e of p.exercises) if (norm(e.name) === k) return e;
      return extra.find(e => norm(e.name) === k) || (oc.extraEx || []).find(e => norm(e.name) === k);
    };
    const mapPlan = (pid, member) => {
      const op = oc.plans.find(p => p.id === pid);
      if (!op) return pid;
      if (keepPlans.includes(op)) return pid;
      const same = nc.plans.filter(p => (p.member || null) === (op.member || member || null));
      let best = same.find(p => norm(p.name) === norm(op.name) && !p.archived), bs = 0;
      if (!best) for (const p of same) { const sc = op.exercises.filter(e => p.exercises.some(x => norm(x.name) === norm(e.name))).length; if (sc > bs) { bs = sc; best = p; } }
      return best ? best.id : pid;
    };
    for (const s of appSess) {
      const np = plan({ plans: newPlans }, mapPlan(s.planId, s.member));
      for (const en of s.entries) {
        for (const f of ['exId', 'swapFor']) {
          if (!en[f]) continue;
          const nm = oldName(en[f]); if (nm === '?') continue;
          let e = findEx(nm, np);
          if (!e) { e = { id: nid(), name: nm, target: null }; extra.push(e); }
          en[f] = e.id;
        }
      }
      if (s.planIds) for (const m in s.planIds) s.planIds[m] = mapPlan(s.planIds[m], m);
      s.planId = mapPlan(s.planId, s.member);
    }
    // zatwierdzenia „Do sprawdzenia”
    const tmp = { plans: nc.plans, extraEx: nc.extraEx || [] };
    for (const s of nc.sessions) for (const en of s.entries) for (const x of en.sets) if (x.amb) {
      const o = decided.get(norm(exName(tmp, en.exId)) + '|' + x.raw);
      if (o) { x.kg = o.kg; x.reps = o.reps; x.sec = o.sec; delete x.amb; delete x.why; }
    }
    oc.plans = newPlans; oc.sessions = nc.sessions.concat(appSess);
    oc.extraEx = (oc.extraEx || []).filter(e => !extra.some(x => x.id === e.id)).concat(extra);
    oc.sheets = nc.sheets; oc.docs = nc.docs;
    if (!oc.warmup || !oc.warmup.length) oc.warmup = nc.warmup;
    if (!oc.members || !oc.members.length) oc.members = nc.members;
  }
  DB.importedAt = N.importedAt;
  return n;
}
function exportData() {
  DB.exportedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(DB)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `podopieczni-kopia-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  DB.lastBackup = DB.exportedAt; save();
  toast('Kopia zapisana w Pobranych');
}

// ------------------------------------------------------------------ lista podopiecznych
function lastActivity(c) {
  const s = sortedSessions(c)[0];
  if (!s) return 'brak treningów';
  return s.date ? 'ostatnio ' + fmtDate(s.date) : `${c.sessions.length} sesji z importu`;
}
function renderHome() {
  const amb = totalAmb();
  const q = norm(ui.search);
  const list = DB.clients.filter(c => !c.archived && (!q || norm(c.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const arch = DB.clients.filter(c => c.archived);
  $app.innerHTML = `${topBar('Podopieczni', { right: `${Drive.icon()}<button class="ib" onclick="go('#/review')" aria-label="Do sprawdzenia">⚠️${amb ? `<span class="dot">${amb}</span>` : ''}</button><button class="ib" onclick="go('#/settings')" aria-label="Ustawienia">⚙️</button>` })}
  <main><input class="search" id="q" placeholder="Szukaj podopiecznego…" value="${esc(ui.search)}">
  ${list.map(c => { const a = ambCount(c); return `<button class="card row" style="width:100%;text-align:left" onclick="go('#/c/${c.id}')">
    <div class="av" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</div>
    <div class="grow"><div style="font-weight:700" class="ell">${esc(c.name)}</div>
    <div class="small muted ell">${c.plans.length} ${c.plans.length === 1 ? 'plan' : 'planów'} · ${lastActivity(c)}</div></div>
    ${a ? `<span class="chip warn">${a}</span>` : ''}<span class="muted">›</span></button>`; }).join('') || `<div class="empty">Brak podopiecznych</div>`}
  ${arch.length ? `<details class="card"><summary>Archiwum (${arch.length})</summary>${arch.map(c => `<div class="list-i" onclick="go('#/c/${c.id}')"><div class="grow">${esc(c.name)}</div><span class="muted">›</span></div>`).join('')}</details>` : ''}
  ${backupNag()}
  </main><button class="fab" id="add" aria-label="Dodaj">＋</button>`;
  const qi = document.getElementById('q');
  qi.oninput = () => { ui.search = qi.value; const pos = qi.selectionStart; renderHome(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); };
  document.getElementById('add').onclick = () => prompt2('Nowy podopieczny', [{ k: 'name', label: 'Imię i nazwisko' }], o => {
    if (!o.name) return; const c = { id: nid(), name: o.name, members: [], archived: false, warmup: [], notes: [], docs: [], plans: [], sessions: [], sheets: [] };
    DB.clients.push(c); save(); go('#/c/' + c.id);
  });
}
function backupNag() {
  if (Drive.connected) return '';
  const last = DB.lastBackup ? new Date(DB.lastBackup) : null;
  const days = last ? (Date.now() - last) / 864e5 : 999;
  if (days < 7) return '';
  return `<div class="card small"><b>💾 Kopia zapasowa</b><div class="muted" style="margin:4px 0 8px">${last ? `Ostatnia kopia ${Math.floor(days)} dni temu.` : 'Nie masz jeszcze kopii.'} Dane są tylko na tym telefonie – zrób kopię co tydzień.</div><button class="btn sm p" onclick="exportData()">Zrób kopię teraz</button></div>`;
}

// ------------------------------------------------------------------ podopieczny
const CTABS = [['plany', 'Plany'], ['historia', 'Historia'], ['rozgrzewka', 'Rozgrzewka'], ['notatki', 'Notatki'], ['arkusz', 'Arkusz']];
function renderClient(c) {
  const t = ui.tab[c.id] || 'plany';
  const a = ambCount(c);
  let body = '';
  if (t === 'plany') body = clientPlans(c);
  if (t === 'historia') body = clientHistory(c);
  if (t === 'rozgrzewka') body = clientWarmup(c);
  if (t === 'notatki') body = clientNotes(c);
  if (t === 'arkusz') body = clientSheet(c);
  const stats = `<div class="row" style="margin-bottom:12px"><div class="stat"><b>${c.plans.length}</b><span class="tiny muted">plany</span></div><div class="stat"><b>${c.sessions.length}</b><span class="tiny muted">treningi</span></div><div class="stat" ${a ? `onclick="ui.reviewClient='${c.id}';go('#/review')"` : ''}><b class="${a ? 'hl' : ''}">${a}</b><span class="tiny muted">do sprawdzenia</span></div></div>`;
  $app.innerHTML = `${topBar(esc(c.name), { back: 1, right: `<button class="ib" id="cm">⋯</button>` })}<main>
  ${c.members && c.members.length ? `<div style="margin-bottom:10px">${c.members.map(m => `<span class="chip blue">${esc(m)}</span>`).join(' ')}</div>` : ''}
  ${stats}
  <div class="tabs">${CTABS.map(([k, l]) => `<button class="tab ${k === t ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  ${body}</main>${t === 'plany' ? `<button class="fab" id="np" aria-label="Nowy plan">＋</button>` : ''}`;
  $app.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ui.tab[c.id] = b.dataset.t; saveUi(); renderClient(c); });
  const np = document.getElementById('np'); if (np) np.onclick = () => newPlan(c);
  document.getElementById('cm').onclick = () => menu([
    { label: 'Zmień nazwę', icon: '✏️', fn: () => prompt2('Nazwa', [{ k: 'n', label: 'Imię i nazwisko', v: c.name }, { k: 'm', label: 'Osoby w grupie (po przecinku)', v: (c.members || []).join(', ') }], o => { if (o.n) c.name = o.n; c.members = o.m ? o.m.split(',').map(s => s.trim()).filter(Boolean) : []; save(); renderClient(c); }) },
    { label: c.archived ? 'Przywróć z archiwum' : 'Przenieś do archiwum', icon: '🗄️', fn: () => { c.archived = !c.archived; save(); renderClient(c); } },
    { label: 'Usuń podopiecznego', icon: '🗑️', danger: 1, fn: () => confirmBox(`Usunąć ${c.name} razem z historią?`, () => { DB.clients = DB.clients.filter(x => x !== c); save(); go('#/'); }) },
  ]);
  bindClientTab(c, t);
}
function planPreview(c, p) {
  const names = p.exercises.map(e => e.name).join(', ');
  const n = c.sessions.filter(s => s.planId === p.id).length;
  return `<div class="card"><div class="row" onclick="go('#/c/${c.id}/p/${p.id}')"><div class="grow"><div style="font-weight:700">${esc(p.name)} ${p.member ? `<span class="chip blue">${esc(p.member)}</span>` : ''}</div>
  <div class="small muted" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(names)}</div>
  <div class="tiny muted" style="margin-top:4px">${p.exercises.length} ćw. · ${n} treningów</div></div><span class="muted">›</span></div>
  <button class="btn p w" style="margin-top:10px" onclick="startWorkout('${c.id}','${p.id}')">▶ Rozpocznij trening</button></div>`;
}
function clientPlans(c) {
  if (!c.plans.length) return `<div class="empty">Brak planów. Dodaj pierwszy przyciskiem ＋</div>`;
  const active = c.plans.filter(p => !p.archived), old = c.plans.filter(p => p.archived);
  const grp = (c.members || []).length >= 2 && active.length ? `<button class="btn p w" style="margin-bottom:12px" onclick="startWorkout('${c.id}','${active[0].id}')">👥 Trening wspólny (${c.members.map(esc).join(' + ')})</button>` : '';
  return grp + active.map(p => planPreview(c, p)).join('') +
    (old.length ? `<details class="card"><summary>Starsze plany (${old.length})</summary>${old.map(p => `<div class="list-i" onclick="go('#/c/${c.id}/p/${p.id}')"><div class="grow">${esc(p.name)}</div><span class="muted">›</span></div>`).join('')}</details>` : '');
}
function newPlan(c) {
  prompt2('Nowy plan', [{ k: 'n', label: 'Nazwa planu', v: `Trening ${String.fromCharCode(65 + c.plans.length % 26)}` }, ...(c.members && c.members.length ? [{ k: 'm', label: `Osoba (${c.members.join(' / ')}) – opcjonalnie` }] : [])], o => {
    const p = { id: nid(), name: o.n || 'Nowy plan', member: o.m || null, exercises: [] };
    c.plans.unshift(p); save(); go(`#/c/${c.id}/p/${p.id}/edit`);
  });
}
function sessionSummary(c, s) {
  return s.entries.slice(0, 6).map(en => {
    const best = en.sets.filter(x => x.kg != null || x.reps != null || x.sec || x.raw);
    return `<div class="small ell">${en.member && s.members ? `<b style="color:${memberColor(c, en.member)}">${esc(en.member[0])}</b> ` : ''}<span class="muted">${best.length}×</span> ${esc(exName(c, en.exId))} ${best[0] ? `<span class="muted">· ${setPlain(best[0])}</span>` : ''}</div>`;
  }).join('') + (s.entries.length > 6 ? `<div class="tiny muted">+${s.entries.length - 6} więcej</div>` : '');
}
function clientHistory(c) {
  const ss = sortedSessions(c);
  if (!ss.length) return `<div class="empty">Brak zapisanych treningów</div>`;
  return ss.map(s => { const a = s.entries.reduce((n, e) => n + e.sets.filter(x => x.amb && !x.dup).length, 0);
    return `<div class="card" onclick="go('#/c/${c.id}/s/${s.id}')"><div class="row"><div class="grow"><div style="font-weight:700">${esc(sessTitle(s, c))}</div><div class="tiny muted">${sessWhen(s, c)}</div></div>${a ? `<span class="chip warn">${a} ?</span>` : ''}</div><div style="margin-top:6px">${sessionSummary(c, s)}</div></div>`; }).join('');
}
function clientWarmup(c) {
  return `<div class="card">${c.warmup.map((w, i) => `<div class="list-i"><div class="grow"><div>${esc(w.name)}</div>${w.dose ? `<div class="tiny muted">${esc(w.dose)}</div>` : ''}</div>${w.link ? `<a href="${esc(w.link)}" target="_blank" rel="noopener">▶</a>` : ''}<button class="ib" data-wi="${i}">⋯</button></div>`).join('') || '<div class="muted small">Brak ćwiczeń rozgrzewki</div>'}</div>
  <button class="btn w" id="aw">＋ Dodaj ćwiczenie rozgrzewki</button>`;
}
function clientNotes(c) {
  const notes = (c.notes || []).map(n => typeof n === 'string' ? n : n.text).join('\n\n');
  return `<label class="field"><span>Notatki trenera</span><textarea class="inp" id="nt" style="min-height:160px">${esc(c.myNotes != null ? c.myNotes : notes)}</textarea></label>
  ${(c.docs || []).map(d => `<details class="card"><summary>📄 ${esc(d.title)}</summary><div class="doc" style="margin-top:8px">${esc(d.text)}</div></details>`).join('')}`;
}
function clientSheet(c) {
  if (!c.sheets || !c.sheets.length) return `<div class="empty">Brak oryginalnego arkusza</div>`;
  const si = Math.min(ui.sheet[c.id] || 0, c.sheets.length - 1);
  const sh = c.sheets[si];
  let maxC = 0; for (const [, cs] of sh.rows) for (const [col] of cs) maxC = Math.max(maxC, col);
  const colName = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  let html = `<table class="raw"><tr><th></th>${Array.from({ length: maxC }, (_, i) => `<th>${colName(i + 1)}</th>`).join('')}</tr>`;
  for (const [r, cs] of sh.rows) {
    const m = new Map(cs);
    html += `<tr><td class="rn">${r}</td>${Array.from({ length: maxC }, (_, i) => `<td title="${esc(m.get(i + 1) || '')}">${esc(m.get(i + 1) || '')}</td>`).join('')}</tr>`;
  }
  html += '</table>';
  return `<div class="small muted" style="margin-bottom:8px">Podgląd oryginału z Excela (tylko do odczytu) – tu sprawdzisz wszystko, czego import nie rozpoznał.</div>
  ${c.sheets.length > 1 ? `<div class="tabs">${c.sheets.map((s, i) => `<button class="tab ${i === si ? 'on' : ''}" data-sh="${i}">${esc(s.file.split('/').pop().replace('.xlsx', ''))} · ${esc(s.name)}</button>`).join('')}</div>` : ''}
  <div class="sheet-wrap">${html}</div>`;
}
function bindClientTab(c, t) {
  if (t === 'rozgrzewka') {
    document.getElementById('aw').onclick = () => prompt2('Rozgrzewka', [{ k: 'name', label: 'Ćwiczenie' }, { k: 'dose', label: 'Dawka (np. 2×12)' }, { k: 'link', label: 'Link do filmu (opcjonalnie)' }], o => { if (o.name) { c.warmup.push(o); save(); renderClient(c); } });
    $app.querySelectorAll('[data-wi]').forEach(b => b.onclick = () => { const i = +b.dataset.wi, w = c.warmup[i];
      menu([{ label: 'Edytuj', icon: '✏️', fn: () => prompt2('Rozgrzewka', [{ k: 'name', label: 'Ćwiczenie', v: w.name }, { k: 'dose', label: 'Dawka', v: w.dose }, { k: 'link', label: 'Link', v: w.link }], o => { Object.assign(w, o); save(); renderClient(c); }) },
            { label: 'W górę', icon: '⬆️', fn: () => { if (i > 0) { c.warmup.splice(i - 1, 0, c.warmup.splice(i, 1)[0]); save(); renderClient(c); } } },
            { label: 'Usuń', icon: '🗑️', danger: 1, fn: () => { c.warmup.splice(i, 1); save(); renderClient(c); } }]); });
  }
  if (t === 'notatki') { const n = document.getElementById('nt'); n.oninput = () => { c.myNotes = n.value; save(); }; }
  if (t === 'arkusz') $app.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { ui.sheet[c.id] = +b.dataset.sh; renderClient(c); });
}

// ------------------------------------------------------------------ plan
function targetText(t) { if (!t) return ''; if (t.sets && t.reps) return `${t.sets} × ${t.reps}`; if (t.sets) return `${t.sets} serie`; return t.reps || t.raw || ''; }
function renderPlan(c, pid) {
  const p = plan(c, pid); if (!p) return go('#/c/' + c.id);
  ensureLib(() => { if (location.hash.endsWith('/p/' + pid)) { const y = scrollY; renderPlan(c, pid); scrollTo(0, y); } });
  const n = c.sessions.filter(s => s.planId === p.id).length;
  $app.innerHTML = `${topBar(esc(p.name), { back: 1, right: `<button class="ib" id="pm">⋯</button>` })}<main>
  <div class="small muted" style="margin-bottom:10px">${esc(c.name)}${p.member ? ' · ' + esc(p.member) : ''} · ${p.exercises.length} ćwiczeń · ${n} treningów</div>
  <button class="btn p w" onclick="startWorkout('${c.id}','${p.id}')">▶ Rozpocznij trening</button>
  <div class="sec">Ćwiczenia</div>
  ${(() => { const L = ssLabelsFor(p.exercises.map(e => e.ss)); return p.exercises.map((e, i) => { const l = lastFor(c, e); const sets = l ? l.en.sets.filter(x => x.kg != null || x.reps != null || x.sec || x.raw) : [];
    return `<div class="card" ${L[i] ? 'style="border-left:4px solid #c084fc"' : ''} onclick="go('#/c/${c.id}/e/${e.id}')"><div class="ex-h"><div class="ex-ic" style="position:relative">${exIcon(e.name)}${L[i] ? `<b style="position:absolute;top:-6px;left:-6px;font-size:11px;background:#c084fc;color:#111;border-radius:8px;padding:0 4px">${L[i]}</b>` : ''}</div><div class="grow"><div class="ex-n">${esc(e.name)}</div>
    <div class="tiny muted">${targetText(e.target) ? 'Cel: ' + esc(targetText(e.target)) : 'bez zakresu'}${e.note ? ' · ' + esc(e.note) : ''}</div></div>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶</a>` : ''}</div>
    ${sets.length ? `<div class="small"><span class="muted">Ostatnio:</span> ${sets.map(setText).join('<span class="muted"> · </span>')}</div>` : '<div class="small muted">Brak historii</div>'}</div>`; }).join(''); })() || '<div class="empty">Plan jest pusty – dodaj ćwiczenia w edycji</div>'}
  <button class="btn w" onclick="go('#/c/${c.id}/p/${p.id}/edit')">✏️ Edytuj plan</button></main>`;
  document.getElementById('pm').onclick = () => menu([
    { label: 'Edytuj plan', icon: '✏️', fn: () => go(`#/c/${c.id}/p/${p.id}/edit`) },
    { label: 'Duplikuj (nowy blok)', icon: '📄', fn: () => { const np = JSON.parse(JSON.stringify(p)); np.id = nid(); np.name = p.name + ' (kopia)'; np.archived = false; np.exercises.forEach(e => e.id = nid()); c.plans.unshift(np); save(); go(`#/c/${c.id}/p/${np.id}/edit`); } },
    { label: p.archived ? 'Przywróć do aktywnych' : 'Przenieś do starszych planów', icon: '🗄️', fn: () => { p.archived = !p.archived; save(); renderPlan(c, pid); } },
    { label: 'Usuń plan', icon: '🗑️', danger: 1, fn: () => confirmBox(n ? `Plan ma ${n} treningów w historii. Usunąć plan i jego historię?` : 'Usunąć plan?', () => { c.plans = c.plans.filter(x => x !== p); c.sessions = c.sessions.filter(s => s.planId !== p.id); save(); go('#/c/' + c.id); }) },
  ]);
}
function renderPlanEdit(c, pid) {
  const p = plan(c, pid); if (!p) return go('#/c/' + c.id);
  const L = ssLabelsFor(p.exercises.map(e => e.ss));
  $app.innerHTML = `${topBar('Edycja planu', { back: 1, right: `<button class="btn sm p" data-act="back">Gotowe</button>` })}<main>
  <label class="field"><span>Nazwa planu</span><input class="inp" id="pn" value="${esc(p.name)}"></label>
  ${c.members && c.members.length ? `<label class="field"><span>Osoba</span><select class="inp" id="pmb"><option value="">wszyscy</option>${c.members.map(m => `<option ${p.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>` : ''}
  <div class="row" style="margin:18px 2px 8px"><div class="sec grow" style="margin:0">Ćwiczenia</div><button class="btn sm" id="ord">↕️ Kolejność i superserie</button></div>
  ${p.exercises.map((e, i) => `<div class="card" ${L[i] ? 'style="border-left:4px solid #c084fc"' : ''}><div class="row"><div class="grow"><div style="font-weight:700">${L[i] ? `<span style="color:#c084fc">${L[i]}</span>` : i + 1 + '.'} ${esc(e.name)}</div><div class="tiny muted">${esc(targetText(e.target) || 'bez zakresu')} · ${MODES[exMode(c, e)][0]}${e.note ? ' · 📌 ' + esc(e.note) : ''}</div></div>
  <button class="ib" data-sw="${i}" title="Zamień na inne">🔄</button><button class="ib" data-ed="${i}">✏️</button><button class="ib" data-del="${i}">🗑️</button></div></div>`).join('')}
  <button class="btn p w" id="ae">＋ Dodaj ćwiczenie</button></main>`;
  document.getElementById('pn').oninput = e => { p.name = e.target.value; save(); };
  const mb = document.getElementById('pmb'); if (mb) mb.onchange = () => { p.member = mb.value || null; save(); };
  const exForm = (e, fn) => prompt2(e ? 'Ćwiczenie' : 'Nowe ćwiczenie', [
    { k: 'name', label: 'Nazwa', v: e && e.name, list: 1 },
    { k: 'mode', label: 'Rodzaj zapisu', type: 'select', options: Object.entries(MODES).map(([k, [l]]) => [k, l]), v: e ? exMode(c, e) : 'kgr' },
    { k: 'sets', label: 'Liczba serii', v: e && e.target && e.target.sets, type: 'num', ph: '3' },
    { k: 'reps', label: 'Zakres powtórzeń / czas', v: e && e.target && e.target.reps, ph: '8-12, 30-60s, max' },
    { k: 'note', label: 'Notatka / wskazówka (widoczna na treningu)', v: e && e.note, ph: 'np. czerwona guma, pauza 2s na dole' },
    { k: 'link', label: 'Link do filmu', v: e && e.link }], fn);
  document.getElementById('ae').onclick = () => exForm(null, o => { if (!o.name) return; p.exercises.push({ id: nid(), name: o.name, mode: o.mode, target: { sets: parseInt(o.sets) || null, reps: o.reps, raw: '' }, note: o.note, link: o.link }); save(); renderPlanEdit(c, pid); });
  $app.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const e = p.exercises[+b.dataset.ed]; exForm(e, o => { if (o.name) e.name = o.name; e.mode = o.mode; e.target = { sets: parseInt(o.sets) || null, reps: o.reps, raw: '' }; e.note = o.note; e.link = o.link; save(); renderPlanEdit(c, pid); }); });
  $app.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { const i = +b.dataset.sw, old = p.exercises[i];
    libraryPick(x => {
      if (norm(x.name) === norm(old.name)) return;
      const ne = { id: nid(), name: x.name, mode: x.mode || undefined, target: old.target, note: old.note, link: undefined, ss: old.ss };
      (c.extraEx = c.extraEx || []).push(old); // stara wersja zostaje w historii
      p.exercises.splice(i, 1, ne); save(); toast(`„${old.name}” → „${x.name}”`); renderPlanEdit(c, pid);
    });
  });
  $app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const i = +b.dataset.del; confirmBox(`Usunąć „${p.exercises[i].name}” z planu?`, () => { p.exercises.splice(i, 1); save(); renderPlanEdit(c, pid); }); });
  document.getElementById('ord').onclick = () => reorderModal('Kolejność i superserie', p.exercises.map(e => ({ label: e.name, sub: targetText(e.target), ss: e.ss })), (order, ss) => {
    p.exercises = order.map((i, k) => Object.assign(p.exercises[i], { ss: ss[k] || undefined })); save(); renderPlanEdit(c, pid);
  });
}

// ------------------------------------------------------------------ trening (logowanie)
const MCOL = ['#3d8bfd', '#e879f9', '#22c55e', '#f59e0b'];
function memberColor(c, m) { const i = (c.members || []).indexOf(m); return MCOL[(i < 0 ? 0 : i) % MCOL.length]; }
function memberChip(c, m) { return m ? `<span class="chip" style="border-color:${memberColor(c, m)};color:${memberColor(c, m)}">${esc(m)}</span>` : ''; }
function buildEntries(c, p, member) {
  return p.exercises.map(e => {
    const l = lastFor(c, e, null, member);
    const all = prevSets(l), warm = all.filter(x => x.type === 'w'), prev = all.filter(x => x.type !== 'w');
    const n = (e.target && e.target.sets) || (prev.length ? Math.min(prev.length, 6) : 3);
    const mk = (pv, type) => { const o = { kg: pv.kg ?? null, reps: pv.reps ?? null, sec: pv.sec ?? null, done: false, ph: true }; if (type) o.type = type; return o; };
    return { exId: e.id, member: member || null, ss: e.ss ? e.ss + '@' + (member || '') : null, mode: e.mode || null, sets: warm.map(w => mk(w, 'w')).concat(Array.from({ length: n }, (_, i) => { const pv = prev[i] || prev[prev.length - 1] || {}; return mk(pv, pv.type && pv.type !== 'w' ? pv.type : null); })) };
  });
}
function startWorkout(cid, pid) {
  const c = client(cid), p = plan(c, pid);
  const open = c.sessions.find(s => s.live);
  if (open) { toast('Kontynuujesz rozpoczęty trening'); return go(`#/c/${c.id}/w/${open.id}`); }
  const mem = c.members || [];
  if (mem.length >= 2) return groupStart(c, p);
  const s = { id: nid(), planId: p.id, member: p.member || null, date: new Date().toISOString(), start: Date.now(), live: true, source: 'app', entries: buildEntries(c, p, p.member || null) };
  c.sessions.push(s); save(true); go(`#/c/${c.id}/w/${s.id}`);
}
function groupStart(c, p) {
  const plans = c.plans.filter(x => !x.archived);
  const pick = m => { // domyślny plan dla osoby
    if (!p.member || p.member === m) return p.id;
    const same = plans.find(x => x.member === m && norm(x.name) === norm(p.name));
    if (same) return same.id;
    const mine = plans.filter(x => x.member === m);
    return mine.length ? mine[0].id : p.id;
  };
  const opts = m => `<option value="">— nie ćwiczy —</option>` + plans.map(x => `<option value="${x.id}" ${pick(m) === x.id ? 'selected' : ''}>${esc(x.name)}${x.member ? ' · ' + esc(x.member) : ''}</option>`).join('');
  modal(`<h3>Trening wspólny</h3><p class="small muted">Wybierz plan dla każdej osoby – mogą robić ten sam albo inny.</p>
    ${c.members.map(m => `<label class="field"><span>${memberChip(c, m)}</span><select class="inp" data-m="${esc(m)}">${opts(m)}</select></label>`).join('')}
    <div class="row"><button class="btn grow" data-x>Anuluj</button><button class="btn p grow" data-y>▶ Start</button></div>`, (mo, close) => {
    mo.querySelector('[data-x]').onclick = close;
    mo.querySelector('[data-y]').onclick = () => {
      const chosen = [...mo.querySelectorAll('[data-m]')].map(sel => [sel.dataset.m, sel.value]).filter(([, v]) => v);
      if (!chosen.length) return toast('Wybierz plan dla co najmniej jednej osoby');
      close();
      const s = { id: nid(), planId: chosen[0][1], members: chosen.map(([m]) => m), planIds: Object.fromEntries(chosen), member: chosen.length === 1 ? chosen[0][0] : null, date: new Date().toISOString(), start: Date.now(), live: true, source: 'app', entries: [] };
      // przeplatanie: ćw. 1 osoby A, ćw. 1 osoby B, ćw. 2 osoby A…
      const lists = chosen.map(([m, pid]) => buildEntries(c, plan(c, pid), m));
      const max = Math.max(...lists.map(l => l.length));
      for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) s.entries.push(l[i]);
      c.sessions.push(s); save(true); go(`#/c/${c.id}/w/${s.id}`);
    };
  });
}
function entryMember(s, en) { return en.member ?? s.member ?? null; }
function renderWorkout(c, sid) {
  const s = c.sessions.find(x => x.id === sid); if (!s) return go('#/c/' + c.id);
  const p = plan(c, s.planId);
  const group = s.members && s.members.length > 1;
  ui.wview = ui.wview || {};
  const view = group ? (ui.wview[s.id] || 'all') : 'all';
  const prevOf = (en, i) => { const ex = exById(c, en.exId) || { id: en.exId, name: '' }; const ps = prevSets(lastFor(c, ex, s.id, entryMember(s, en))); const w = en.sets[i].type === 'w'; const ord = en.sets.slice(0, i).filter(y => (y.type === 'w') === w).length; const x = ps.filter(y => (y.type === 'w') === w)[ord]; return x ? setPlain(x) : '–'; };
  const subHint = en => { // ostatnio była zamiana / dopisek – pokaż jako informację
    const ex = exById(c, en.exId); if (!ex) return '';
    const a = lastFor(c, ex, s.id, entryMember(s, en), true), cl = lastFor(c, ex, s.id, entryMember(s, en));
    if (!a || (cl && cl.s === a.s)) return '';
    const t = a.en.sets.filter(x => !cleanSet(x) && x.raw).map(x => x.raw);
    return t.length ? `<div class="tiny" style="color:var(--warn);margin:-2px 0 6px">↔ Ostatnio zamiast tego: ${esc(t.join(', '))}</div>` : '';
  };
  const swapLbl = en => en.swapFor ? `<div class="tiny muted">zamiast: ${esc(exName(c, en.swapFor))}</div>` : '';
  const progress = m => { let d = 0, t = 0; for (const en of s.entries) if (entryMember(s, en) === m) for (const x of en.sets) { t++; if (x.done) d++; } return `${d}/${t}`; };
  const lastNote = en => { const ex = exById(c, en.exId); if (!ex) return null; const n = norm(ex.name);
    for (const ss of sortedSessions(c)) { if (ss.id === s.id || ss.live) continue; for (const e2 of ss.entries) { const m2 = e2.member ?? ss.member ?? null, me = entryMember(s, en); if (me && m2 && m2 !== me) continue; if ((e2.exId === ex.id || norm(exName(c, e2.exId)) === n) && e2.note) return e2.note; } }
    return null; };
  const table = (en, ei, withName) => {
    const m = entryMember(s, en), ex = exById(c, en.exId), mode = exMode(c, ex, en), fields = MODES[mode][1];
    const ln = lastNote(en);
    const val = (x, f) => x.ph ? '' : fmtNum(x[f]);
    const ph = (x, f) => x.ph ? fmtNum(x[f] ?? (f === 'sec' ? null : null)) : '';
    return `<div style="${group ? `border-left:3px solid ${memberColor(c, m)};padding-left:8px;margin-top:10px` : ''}">
    ${group ? `<div class="row" style="margin-bottom:4px">${memberChip(c, m)}${withName ? `<span class="small ex-n">${esc(exName(c, en.exId))}</span>` : ''}<div class="grow"></div><button class="ib" data-exm="${ei}" style="width:32px;height:32px">⋯</button></div>` : ''}
    ${swapLbl(en)}${subHint(en)}
    ${ln && ln !== en.note ? `<div class="tiny" style="color:#8fb8ff;margin:-2px 0 6px">📝 Ostatnio: ${esc(ln)}</div>` : ''}
    ${en.note != null ? `<div class="row" style="margin-bottom:8px"><input class="inp small" data-note="${ei}" placeholder="Notatka, np. czerwona guma do podciągania" value="${esc(en.note)}" style="min-height:36px"><button class="btn sm" data-pin="${ei}" title="Zapisz w planie" style="flex:none">📌</button></div>` : ''}
    <table class="sets"><tr><th>Seria</th><th>Poprzednio</th>${fields.map(f => `<th>${FLABEL[f]}</th>`).join('')}<th>✓</th></tr>
    ${en.sets.map((x, si) => `<tr class="${x.done ? 'done' : ''}"><td><button class="snb" data-st="${ei}:${si}">${setLabelHtml(en.sets, si)}</button></td><td class="prev">${esc(prevOf(en, si))}</td>
    ${fields.map(f => `<td><input class="num" inputmode="decimal" data-e="${ei}" data-s="${si}" data-f="${f}" value="${val(x, f)}" placeholder="${ph(x, f)}" ${fields.length === 1 ? 'style="width:120px"' : ''}></td>`).join('')}
    <td><button class="ck ${x.done ? 'on' : ''}" data-ck="${ei}:${si}">✓</button></td></tr>`).join('')}</table>
    <div class="row" style="margin-top:8px"><button class="btn sm grow" data-add="${ei}">＋ Dodaj serię${group ? ' · ' + esc(m) : ''}</button>${en.note == null ? `<button class="btn sm" data-nt="${ei}">📝 Notatka</button>` : ''}</div></div>`;
  };
  // karty: w trybie „Razem” to samo ćwiczenie obu osób w jednej karcie
  const idx = s.entries.map((en, ei) => ei).filter(ei => view === 'all' || entryMember(s, s.entries[ei]) === view);
  const cards = [];
  for (const ei of idx) {
    const en = s.entries[ei], k = norm(exName(c, en.exId));
    const prevCard = cards[cards.length - 1];
    if (group && view === 'all' && prevCard && prevCard.key === k && !prevCard.items.some(j => entryMember(s, s.entries[j]) === entryMember(s, en))) prevCard.items.push(ei);
    else cards.push({ key: k, items: [ei] });
  }
  const ssl = {}; // etykiety A1/A2 osobno dla każdej osoby
  for (const mm of (group ? s.members : [s.member || null])) { const ids = s.entries.map((e, i) => [e, i]).filter(([e]) => entryMember(s, e) === mm); const L = ssLabelsFor(ids.map(([e]) => e.ss)); ids.forEach(([, i], k) => ssl[i] = L[k]); }
  const cardHtml = cd => {
    const en0 = s.entries[cd.items[0]], ex = exById(c, en0.exId) || { name: '?' };
    const sameEx = cd.items.length > 1, lab = ssl[cd.items[0]];
    return `<div class="card" ${lab ? 'style="border-left:4px solid #c084fc"' : ''}><div class="ex-h"><div class="ex-ic" style="position:relative">${exIcon(ex.name)}${lab ? `<b style="position:absolute;top:-6px;left:-6px;font-size:11px;background:#c084fc;color:#111;border-radius:8px;padding:0 4px">${lab}</b>` : ''}</div><div class="grow"><div class="ex-n">${esc(ex.name)}</div><div class="tiny muted">${esc(targetText(ex.target))}${ex.note ? ' · ' + esc(ex.note) : ''}${sameEx ? ' · razem' : ''}</div></div>${group ? '' : `<button class="ib" data-exm="${cd.items[0]}">⋯</button>`}</div>
    ${cd.items.map(ei => table(s.entries[ei], ei, false)).join('')}</div>`;
  };
  const title = group ? 'Trening wspólny' : (p ? p.name : 'Trening');
  $app.innerHTML = `${topBar(esc(title), { back: 1, right: `<button class="btn sm ok" id="fin">${s.live ? 'Zakończ' : 'Zapisz'}</button>` })}
  ${group ? `<div class="tabs" style="position:sticky;top:56px;z-index:15;background:var(--bg);padding:8px 12px">${[['all', 'Razem']].concat(s.members.map(m => [m, m])).map(([k, l]) => `<button class="tab ${view === k ? 'on' : ''}" data-wv="${esc(k)}">${esc(l)}${k !== 'all' ? ` <span class="tiny" style="opacity:.7">${progress(k)}</span>` : ''}</button>`).join('')}</div>` : ''}
  <main>
  <div class="row small muted" style="margin-bottom:10px"><div class="grow">${esc(c.name)}${!group && s.member ? ' · ' + esc(s.member) : ''}${group ? ' · ' + s.members.map(m => esc(m) + ': ' + esc((plan(c, s.planIds[m]) || {}).name || '')).join(', ') : ''}</div>${s.live ? `<span>⏱ <span class="timer" id="el" style="font-size:15px">0:00</span></span>` : ''}</div>
  ${cards.map(cardHtml).join('')}
  <div class="row"><button class="btn grow" id="aex">＋ Dodaj ćwiczenie</button><button class="btn" id="ord">↕️ Kolejność</button></div>
  ${s.live ? `<div style="height:10px"></div><button class="btn w danger" id="discard">Odrzuć trening</button>` : ''}
  </main>${restBar()}`;
  const rerender = () => { const sy = window.scrollY; renderWorkout(c, sid); window.scrollTo(0, sy); };
  if (s.live) { const el = document.getElementById('el'); const tick = () => { if (!document.body.contains(el)) return clearInterval(ti); const m = Math.floor((Date.now() - s.start) / 1000); el.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }; tick(); var ti = setInterval(tick, 1000); }
  $app.querySelectorAll('[data-wv]').forEach(b => b.onclick = () => { ui.wview[s.id] = b.dataset.wv; renderWorkout(c, sid); });
  $app.querySelectorAll('input.num').forEach(inp => {
    inp.oninput = () => { const x = s.entries[+inp.dataset.e].sets[+inp.dataset.s];
      if (x.ph) { x.ph = false; inp.closest('tr').querySelectorAll('input.num').forEach(o => { if (o !== inp && !o.value && o.placeholder) o.value = o.placeholder; o.placeholder = ''; }); }
      x[inp.dataset.f] = parseNum(inp.value); delete x.amb; delete x.note; delete x.text; x.raw = null; save(); };
  });
  $app.querySelectorAll('[data-note]').forEach(inp => inp.oninput = () => { s.entries[+inp.dataset.note].note = inp.value; save(); });
  $app.querySelectorAll('[data-nt]').forEach(b => b.onclick = () => { s.entries[+b.dataset.nt].note = ''; rerender(); const i = $app.querySelector(`[data-note="${b.dataset.nt}"]`); if (i) i.focus(); });
  $app.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => { const en = s.entries[+b.dataset.pin], ex = exById(c, en.exId); if (!ex) return; ex.note = en.note || ''; save(); toast(en.note ? 'Notatka zapisana w planie 📌' : 'Usunięto notatkę z planu'); rerender(); });
  $app.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => {
    const [ei, si] = b.dataset.ck.split(':').map(Number); const x = s.entries[ei].sets[si];
    if (x.ph) { x.ph = false; }
    x.done = !x.done; save();
    if (x.done && navigator.vibrate) navigator.vibrate(30);
    const en = s.entries[ei]; let nxt = null;
    for (let k = ei + 1; k < s.entries.length; k++) if (entryMember(s, s.entries[k]) === entryMember(s, en)) { nxt = s.entries[k]; break; }
    const inSuper = en.ss && nxt && nxt.ss === en.ss;
    if (x.done && s.live && !inSuper) startRest();
    if (x.done && inSuper) toast('Superseria → ' + exName(c, nxt.exId));
    rerender();
  });
  $app.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
    const [ei, si] = b.dataset.st.split(':').map(Number), en = s.entries[ei], x = en.sets[si];
    const setT = t => { if (t) x.type = t; else delete x.type; save(); rerender(); };
    menu([{ label: 'Seria rozgrzewkowa', icon: '🟠 W', fn: () => setT('w') },
          { label: 'Seria robocza', icon: '🔢', fn: () => setT(null) },
          { label: 'Do upadku', icon: '🔴 F', fn: () => setT('f') },
          { label: 'Drop set', icon: '🟣 D', fn: () => setT('d') },
          { label: `Usuń serię ${setLabel(en.sets, si)}`, icon: '🗑️', danger: 1, fn: () => { en.sets.splice(si, 1); save(); rerender(); } }]);
  });
  $app.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const en = s.entries[+b.dataset.add]; const last = en.sets[en.sets.length - 1] || {}; en.sets.push({ kg: last.kg ?? null, reps: last.reps ?? null, done: false, ph: true }); save(); rerender(); });
  $app.querySelectorAll('[data-exm]').forEach(b => b.onclick = () => { const ei = +b.dataset.exm, en = s.entries[ei];
    menu([{ label: 'Zamień ćwiczenie (tylko dziś)', icon: '↔️', fn: () => prompt2('Zamień na', [{ k: 'name', label: 'Ćwiczenie zastępcze', list: 1, ph: 'np. Rzuty piłką lekarską w bok' }], o => {
            if (!o.name) return;
            const orig = en.swapFor || en.exId;
            if (norm(o.name) === norm(exName(c, orig))) { en.exId = orig; delete en.swapFor; }
            else {
              let ex = null; for (const pl of c.plans) for (const e of pl.exercises) if (!ex && norm(e.name) === norm(o.name)) ex = e;
              for (const e of (c.extraEx || [])) if (!ex && norm(e.name) === norm(o.name)) ex = e;
              if (!ex) { ex = { id: nid(), name: o.name, target: null }; (c.extraEx = c.extraEx || []).push(ex); }
              en.swapFor = orig; en.exId = ex.id;
            }
            const prev = prevSets(lastFor(c, exById(c, en.exId), s.id, entryMember(s, en)));
            en.sets = Array.from({ length: Math.max(en.sets.length, 1) }, (_, i) => { const pv = prev[i] || prev[prev.length - 1] || {}; return { kg: pv.kg ?? null, reps: pv.reps ?? null, sec: pv.sec ?? null, done: false, ph: true }; });
            save(); rerender(); }) },
          { label: 'Notatka do ćwiczenia', icon: '📝', fn: () => { en.note = en.note || ''; save(); rerender(); } },
          { label: 'Rodzaj zapisu: ' + MODES[exMode(c, exById(c, en.exId), en)][0], icon: '⚖️', fn: () => menu(Object.entries(MODES).map(([k, [l]]) => ({ label: l, icon: k === exMode(c, exById(c, en.exId), en) ? '✅' : '▫️', fn: () => { en.mode = k; const ex = exById(c, en.exId); if (ex) ex.mode = k; save(); rerender(); } }))) },
          (() => { let nx = -1; for (let k = ei + 1; k < s.entries.length; k++) if (entryMember(s, s.entries[k]) === entryMember(s, en)) { nx = k; break; }
            if (nx < 0) return null; const linked = en.ss && s.entries[nx].ss === en.ss;
            return { label: linked ? 'Rozłącz superserię z następnym' : 'Superseria z: ' + exName(c, s.entries[nx].exId), icon: '🔗', fn: () => { if (linked) { s.entries[nx].ss = s.entries[nx + 1] && s.entries[nx + 1].ss === s.entries[nx].ss ? s.entries[nx].ss : null; const old = en.ss; for (let k = nx; k < s.entries.length && s.entries[k].ss === old; k++) s.entries[k].ss = old + 'b'; } else { const id = en.ss || s.entries[nx].ss || 'g' + nid(); en.ss = id; s.entries[nx].ss = id; } save(); rerender(); } }; })(),
          { label: 'Usuń ostatnią serię', icon: '➖', fn: () => { en.sets.pop(); save(); rerender(); } },
          { label: 'Historia ćwiczenia', icon: '📈', fn: () => go(`#/c/${c.id}/e/${en.exId}`) },
          { label: 'Usuń z tego treningu', icon: '🗑️', danger: 1, fn: () => { s.entries.splice(ei, 1); save(); rerender(); } }].filter(Boolean)); });
  document.getElementById('aex').onclick = () => {
    const fields = [{ k: 'name', label: 'Nazwa', list: 1 }, { k: 'mode', label: 'Rodzaj zapisu', type: 'select', options: Object.entries(MODES).map(([k, [l]]) => [k, l]), v: 'kgr' }];
    if (group) fields.push({ k: 'who', label: 'Dla kogo', type: 'select', options: [['all', 'Obie osoby']].concat(s.members.map(m => [m, m])), v: view });
    fields.push({ k: 'plan', label: 'Dodać też do planu?', type: 'select', options: [['tak', 'Tak'], ['nie', 'Nie, tylko dziś']], v: 'tak' });
    prompt2('Dodaj ćwiczenie', fields, o => {
      if (!o.name) return;
      const who = group ? (o.who === 'all' ? s.members : [o.who]) : [s.member || null];
      for (const m of who) {
        const pl = plan(c, group ? s.planIds[m] : s.planId);
        let ex = pl && pl.exercises.find(e => norm(e.name) === norm(o.name));
        if (!ex) { ex = { id: nid(), name: o.name, target: null, mode: o.mode }; if (pl && o.plan === 'tak') pl.exercises.push(ex); else (c.extraEx = c.extraEx || []).push(ex); }
        const prev = prevSets(lastFor(c, ex, s.id, m));
        s.entries.push({ exId: ex.id, member: m, mode: o.mode, sets: Array.from({ length: Math.max(prev.length, 3) }, (_, i) => { const pv = prev[i] || {}; return { kg: pv.kg ?? null, reps: pv.reps ?? null, done: false, ph: true }; }) });
      }
      save(); rerender();
    });
  };
  document.getElementById('ord').onclick = () => reorderModal('Kolejność i superserie', s.entries.map(en => ({ label: exName(c, en.exId), sub: (group ? entryMember(s, en) + ' · ' : '') + en.sets.length + ' serie', ss: en.ss })), (order, ss) => {
    s.entries = order.map((i, k) => Object.assign(s.entries[i], { ss: ss[k] })); save(); rerender();
  });
  document.getElementById('fin').onclick = () => {
    for (const en of s.entries) en.sets = en.sets.filter(x => !(x.ph && !x.done) && (x.kg != null || x.reps != null || x.sec != null || x.done));
    for (const en of s.entries) for (const x of en.sets) delete x.ph;
    s.entries = s.entries.filter(en => en.sets.length || en.note);
    if (s.live) { s.dur = Math.round((Date.now() - s.start) / 60000); delete s.live; }
    stopRest(); save(true); ui.justDone = s.id; location.replace(`#/c/${c.id}/s/${s.id}`);
  };
  const d = document.getElementById('discard'); if (d) d.onclick = () => confirmBox('Odrzucić ten trening?', () => { c.sessions = c.sessions.filter(x => x !== s); stopRest(); save(true); go('#/c/' + c.id); }, 'Odrzuć');
  bindRest();
}
function restBar() {
  if (!rest) return '';
  return `<div class="sb"><div class="grow"><div class="tiny muted">Przerwa</div><div class="timer" id="rt">0:00</div></div><button class="btn sm" data-rs="-15">−15</button><button class="btn sm" data-rs="15">+15</button><button class="btn sm p" data-rs="0">Pomiń</button></div>`;
}
function startRest() { stopRest(); rest = { end: Date.now() + ui.restSec * 1000 }; }
function stopRest() { if (rest && rest.int) clearInterval(rest.int); rest = null; const b = document.querySelector('.sb'); if (b) b.remove(); }
function bindRest() {
  if (!rest) return;
  const tick = () => { const el = document.getElementById('rt'); if (!el || !rest) return; const left = Math.round((rest.end - Date.now()) / 1000);
    if (left <= 0) { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); stopRest(); return; }
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; };
  tick(); rest.int = setInterval(tick, 500);
  document.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { const v = +b.dataset.rs; if (!v) return stopRest(); rest.end += v * 1000; tick(); });
}

// ------------------------------------------------------------------ podgląd sesji
function renderSession(c, sid) {
  const s = c.sessions.find(x => x.id === sid); if (!s) return go('#/c/' + c.id);
  if (s.live) return go(`#/c/${c.id}/w/${s.id}`);
  const done = ui.justDone === s.id;
  let nSets = 0, vol = 0; for (const en of s.entries) for (const x of en.sets) if (x.type !== 'w') { nSets++; if (typeof x.kg === 'number' && typeof x.reps === 'number') vol += x.kg * x.reps; }
  $app.innerHTML = `${topBar(esc(sessTitle(s, c)), { back: done ? 0 : 1, right: `<button class="ib" id="sm">⋯</button>` })}<main>
  ${done ? `<div class="card" style="border-color:var(--ok)"><div style="font-weight:800;font-size:18px">Trening zapisany 💪</div>
    <div class="row" style="margin:10px 0"><div class="stat"><b>${s.dur || 0} min</b><span class="tiny muted">czas</span></div><div class="stat"><b>${nSets}</b><span class="tiny muted">serie robocze</span></div><div class="stat"><b>${fmtNum(Math.round(vol))} kg</b><span class="tiny muted">objętość</span></div></div>
    <button class="btn ok w" id="rep" style="margin-bottom:8px">📤 Wyślij raport podopiecznemu</button>
    <div class="row"><button class="btn p grow" id="toc">👤 ${esc(c.name.split(' ')[0])}</button><button class="btn grow" id="toh">🏠 Ekran główny</button></div></div>` : ''}
  <div class="small muted" style="margin-bottom:10px">${sessWhen(s, c)}${s.dur ? ` · ${s.dur} min` : ''}</div>
  ${s.entries.map((en, ei) => `<div class="card"><div class="ex-h"><div class="ex-ic">🏋️</div><div class="grow"><div class="ex-n">${esc(exName(c, en.exId))}</div>${en.swapFor ? `<div class="tiny muted">zamiast: ${esc(exName(c, en.swapFor))}</div>` : ''}</div>${s.members && en.member ? memberChip(c, en.member) : ''}</div>
  ${en.sets.map((x, si) => `<div class="row small" style="padding:4px 0"><span class="sn muted">${setLabelHtml(en.sets, si)}</span><div class="grow">${setText(x) || '<span class="muted">–</span>'}</div>${x.amb ? `<button class="chip warn" data-fix="${ei}:${si}">? sprawdź</button>` : `<button class="ib" data-fix="${ei}:${si}" style="width:32px;height:32px;font-size:14px">✏️</button>`}</div>`).join('')}
  ${en.note ? `<div class="tiny muted">📝 ${esc(en.note)}</div>` : ''}</div>`).join('') || '<div class="empty">Pusty trening</div>'}
  </main>`;
  $app.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { const [ei, si] = b.dataset.fix.split(':').map(Number); const en = s.entries[ei], x = en.sets[si]; editSet(x, () => { for (const y of en.sets) if (y !== x && y.dup && y.raw === x.raw) { y.kg = x.kg; y.reps = x.reps; y.sec = x.sec; delete y.amb; delete y.why; } save(); renderSession(c, sid); }); });
  if (done) {
    document.getElementById('rep').onclick = () => Report.menuFor(c, s);
    document.getElementById('toc').onclick = () => { ui.justDone = null; location.replace('#/c/' + c.id); };
    document.getElementById('toh').onclick = () => { ui.justDone = null; location.replace('#/'); };
  }
  document.getElementById('sm').onclick = () => menu([
    { label: 'Raport PDF / obrazek', icon: '📤', fn: () => Report.menuFor(c, s) },
    { label: 'Edytuj serie', icon: '✏️', fn: () => go(`#/c/${c.id}/w/${s.id}`) },
    { label: 'Ustaw datę', icon: '📅', fn: () => prompt2('Data treningu', [{ k: 'd', label: 'Data (RRRR-MM-DD)', v: (s.date || new Date().toISOString()).slice(0, 10) }], o => { if (/^\d{4}-\d{2}-\d{2}$/.test(o.d)) { s.date = new Date(o.d + 'T12:00:00').toISOString(); save(); renderSession(c, sid); } else toast('Zły format daty'); }) },
    { label: 'Usuń trening', icon: '🗑️', danger: 1, fn: () => confirmBox('Usunąć ten trening?', () => { c.sessions = c.sessions.filter(x => x !== s); save(); history.back(); }) },
  ]);
}
function editSet(x, done) {
  prompt2('Seria', [{ k: 'kg', label: 'Ciężar (kg)', v: fmtNum(x.kg), type: 'num' }, { k: 'reps', label: 'Powtórzenia', v: fmtNum(x.reps), type: 'num' }, { k: 'sec', label: 'Czas (s)', v: x.sec || '', type: 'num' }], o => {
    x.kg = parseNum(o.kg); x.reps = parseNum(o.reps); x.sec = parseNum(o.sec); delete x.amb; delete x.why; delete x.text; delete x.note; save(); done();
  });
  const m = document.querySelector('.modal'); if (m && x.raw) m.insertAdjacentHTML('afterbegin', `<div class="small muted" style="margin-bottom:8px">Wpis z Excela: <span class="raw-t">${esc(x.raw)}</span></div>`);
}

// ------------------------------------------------------------------ historia ćwiczenia
function renderExercise(c, exId) {
  const ex = exById(c, exId); if (!ex) return history.back();
  const n = norm(ex.name);
  const rows = [];
  for (const s of sortedSessions(c)) for (const en of s.entries) if (en.exId === ex.id || norm(exName(c, en.exId)) === n) rows.push({ s, en });
  const pts = rows.slice().reverse().map(r => bestKg(r.en)).filter(v => v != null);
  let chart = '';
  if (pts.length >= 2) {
    const W = 320, H = 110, mn = Math.min(...pts), mx = Math.max(...pts), rg = mx - mn || 1;
    const xy = pts.map((v, i) => [10 + i * (W - 20) / (pts.length - 1), H - 12 - (v - mn) / rg * (H - 30)]);
    chart = `<div class="card"><div class="small muted">Najcięższa seria (kg) · ${pts.length} treningów</div><svg class="spark" viewBox="0 0 ${W} ${H}"><polyline fill="none" stroke="#3d8bfd" stroke-width="2.5" points="${xy.map(p => p.join(',')).join(' ')}"/>${xy.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#3d8bfd"/>`).join('')}<text x="4" y="12" fill="#8b93a3" font-size="11">${fmtNum(mx)} kg</text><text x="4" y="${H - 1}" fill="#8b93a3" font-size="11">${fmtNum(mn)} kg</text></svg></div>`;
  }
  $app.innerHTML = `${topBar(esc(ex.name), { back: 1 })}<main>${chart}
  ${rows.map(r => `<div class="card" onclick="go('#/c/${c.id}/s/${r.s.id}')"><div class="tiny muted">${sessWhen(r.s, c)} · ${esc(sessTitle(r.s, c))}</div><div class="small" style="margin-top:4px">${r.en.sets.map(setText).join('<span class="muted"> · </span>')}</div></div>`).join('') || '<div class="empty">Brak historii</div>'}</main>`;
}

// ------------------------------------------------------------------ do sprawdzenia
function renderReview() {
  const groups = [];
  for (const c of DB.clients) {
    if (ui.reviewClient && c.id !== ui.reviewClient) continue;
    const byEx = new Map();
    for (const s of c.sessions) for (const en of s.entries) en.sets.forEach(x => { if (x.amb && !x.dup) { const k = en.exId; if (!byEx.has(k)) byEx.set(k, []); byEx.get(k).push({ s, x, en }); } });
    for (const [exId, items] of byEx) groups.push({ c, exId, items });
  }
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const clientsWith = DB.clients.filter(c => ambCount(c));
  $app.innerHTML = `${topBar('Do sprawdzenia', { back: 1 })}<main>
  <div class="small muted" style="margin-bottom:10px">Wpisy z Excela bez „kg” – np. „12x20”. Odgadłem, która liczba to ciężar, a która powtórzenia. Zatwierdź ✓, odwróć ⇄ albo popraw ✏️.</div>
  <select class="inp" id="rc" style="margin-bottom:12px"><option value="">Wszyscy (${totalAmb()})</option>${clientsWith.map(c => `<option value="${c.id}" ${ui.reviewClient === c.id ? 'selected' : ''}>${esc(c.name)} (${ambCount(c)})</option>`).join('')}</select>
  ${total ? '' : '<div class="empty">🎉 Wszystko sprawdzone</div>'}
  ${groups.slice(0, 40).map((g, gi) => `<div class="card"><div class="row"><div class="grow"><div class="ex-n">${esc(exName(g.c, g.exId))}</div><div class="tiny muted">${esc(g.c.name)} · ${g.items.length} wpisów</div></div></div>
    <div class="row" style="margin:8px 0"><button class="btn sm ok grow" data-ga="${gi}:ok">✓ Wszystkie OK</button><button class="btn sm grow" data-ga="${gi}:swap">⇄ Odwróć wszystkie</button></div>
    ${g.items.slice(0, 30).map((it, ii) => `<div class="rev-e"><span class="raw-t">${esc(it.x.raw)}</span><div class="grow small"><span class="guess">${fmtNum(it.x.reps)} powt × ${fmtNum(it.x.kg)} kg</span>${it.x.why && it.x.why.startsWith('na') ? '' : ''}</div>
    <button class="ib" data-it="${gi}:${ii}:ok" style="color:var(--ok)">✓</button><button class="ib" data-it="${gi}:${ii}:swap">⇄</button><button class="ib" data-it="${gi}:${ii}:ed">✏️</button></div>`).join('')}
    ${g.items.length > 30 ? `<div class="tiny muted">+${g.items.length - 30} kolejnych (pokażą się po zatwierdzeniu)</div>` : ''}</div>`).join('')}
  ${groups.length > 40 ? `<div class="tiny muted">Pokazano 40 ćwiczeń z ${groups.length}</div>` : ''}</main>`;
  document.getElementById('rc').onchange = e => { ui.reviewClient = e.target.value; renderReview(); };
  const swap1 = x => { const k = x.kg; x.kg = x.reps; x.reps = k; };
  const sibs = it => it.en.sets.filter(y => y.dup && y.amb && y.raw === it.x.raw);
  const swap = (x, it) => { swap1(x); if (it) for (const y of sibs(it)) { swap1(y); delete y.amb; delete y.why; } };
  const okSibs = it => { for (const y of sibs(it)) { delete y.amb; delete y.why; } };
  const re = () => { save(); const sy = window.scrollY; renderReview(); window.scrollTo(0, sy); };
  $app.querySelectorAll('[data-ga]').forEach(b => b.onclick = () => { const [gi, a] = b.dataset.ga.split(':'); for (const it of groups[+gi].items) { if (a === 'swap') swap(it.x, it); else okSibs(it); delete it.x.amb; delete it.x.why; } re(); });
  $app.querySelectorAll('[data-it]').forEach(b => b.onclick = () => { const [gi, ii, a] = b.dataset.it.split(':'); const it = groups[+gi].items[+ii];
    if (a === 'ed') return editSet(it.x, () => { for (const y of sibs(it)) { y.kg = it.x.kg; y.reps = it.x.reps; y.sec = it.x.sec; delete y.amb; delete y.why; } re(); });
    if (a === 'swap') swap(it.x, it); else okSibs(it); delete it.x.amb; delete it.x.why; re(); });
}

// ------------------------------------------------------------------ ujednolicenie nazw ćwiczeń z biblioteką
let NAMEMAP = null;
async function renderUnify() {
  $app.innerHTML = `${topBar('Nazwy z biblioteki', { back: 1 })}<main><div class="empty">Ładuję bazę ćwiczeń…</div></main>`;
  if (!NAMEMAP) { try { NAMEMAP = await (await fetch('name-map.json')).json(); } catch (e) { NAMEMAP = {}; } }
  await Promise.allSettled([loadRepdb(), loadExdb()]); LIBIDX = null;
  const uses = new Map(); // fold(stara nazwa) → {name, n, clients:Set}
  for (const c of DB.clients) for (const ex of c.plans.flatMap(p => p.exercises.map(e => [e, p])).concat((c.extraEx || []).map(e => [e, null]))) {
    const [e, p] = ex, k = fold(e.name.trim()); const m = NAMEMAP[k];
    if (!m || norm(m.to) === norm(e.name)) continue;
    if (!uses.has(k)) uses.set(k, { name: e.name.trim(), n: 0, clients: new Set(), m });
    const u = uses.get(k); if (p) u.n++; u.clients.add(c.name.split(' ')[0]);
  }
  const all = [...uses.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl'));
  const sure = all.filter(([, u]) => u.m.ok), doubt = all.filter(([, u]) => !u.m.ok);
  const row = ([k, u], checked) => { const opts = [u.m.to].concat(u.m.alts || []);
    return `<div class="list-i" style="align-items:flex-start"><input type="checkbox" data-k="${esc(k)}" ${checked ? 'checked' : ''} style="width:22px;height:22px;margin-top:8px;flex:none">
    <div class="grow"><div class="small muted">${esc(u.name)} <span class="tiny">· ${[...u.clients].slice(0, 3).map(esc).join(', ')}${u.clients.size > 3 ? '…' : ''}</span></div>
    <div class="row" style="margin-top:4px">${exIcon(u.m.to, 32)}<select class="inp small" data-sel="${esc(k)}" style="min-height:36px;padding:4px 8px">${opts.map(o => `<option>${esc(o)}</option>`).join('')}<option value="__lib">📚 Wybierz z biblioteki…</option></select></div></div></div>`; };
  $app.innerHTML = `${topBar('Nazwy z biblioteki', { back: 1 })}<main>
  <div class="small muted" style="margin-bottom:10px">Zamieniam nazwy ćwiczeń w planach na nazwy z biblioteki (z ilustracjami). Historia i wyniki zostają – zmienia się tylko nazwa. Zaznaczone ✓ zostaną zmienione.</div>
  ${all.length ? '' : '<div class="empty">🎉 Wszystkie nazwy są już ujednolicone</div>'}
  ${sure.length ? `<div class="sec">Pewne dopasowania (${sure.length})</div><div class="card">${sure.map(r => row(r, true)).join('')}</div>` : ''}
  ${doubt.length ? `<div class="sec">Do Twojej decyzji (${doubt.length})</div><div class="small muted" style="margin:-4px 2px 8px">Sprawdź propozycję, wybierz inną z listy albo z biblioteki i zaznacz ✓.</div><div class="card">${doubt.map(r => row(r, false)).join('')}</div>` : ''}
  ${all.length ? `<button class="btn p w" id="apply">Zamień zaznaczone</button>` : ''}</main>`;
  $app.querySelectorAll('[data-sel]').forEach(sel => sel.onchange = () => {
    const k = sel.dataset.sel, cb = $app.querySelector(`input[data-k="${CSS.escape(k)}"]`);
    if (sel.value === '__lib') { libraryPick(x => { const o = document.createElement('option'); o.textContent = x.name; sel.insertBefore(o, sel.firstChild); sel.value = x.name; cb.checked = true; }); sel.value = sel.options[0].value; return; }
    cb.checked = true; const ic = sel.previousElementSibling; if (ic) ic.outerHTML = exIcon(sel.value, 32);
  });
  const ap = document.getElementById('apply'); if (ap) ap.onclick = () => {
    const pick = new Map(); $app.querySelectorAll('input[data-k]:checked').forEach(cb => pick.set(cb.dataset.k, $app.querySelector(`[data-sel="${CSS.escape(cb.dataset.k)}"]`).value));
    let n = 0;
    for (const c of DB.clients) for (const e of c.plans.flatMap(p => p.exercises).concat(c.extraEx || [])) {
      const to = pick.get(fold(e.name.trim())); if (!to) continue;
      e.was = e.was || e.name; e.name = to; n++;  // rodzaj zapisu zostaje wg historii
    }
    save(true); toast(`Zmieniono ${n} pozycji w planach`); renderUnify();
  };
}

// ------------------------------------------------------------------ ustawienia
function renderSettings() {
  let size = 0; try { size = (localStorage.getItem(KEY) || '').length; } catch (e) {}
  $app.innerHTML = `${topBar('Ustawienia', { back: 1 })}<main>
  <div class="card"><b>🏷️ Nazwy ćwiczeń z biblioteki</b><p class="small muted">Zamień nazwy w planach podopiecznych na nazwy z biblioteki (z ilustracjami). Niepewne dopasowania zatwierdzasz sam.</p><button class="btn p w" onclick="go('#/unify')">Przejrzyj propozycje</button></div>
  ${Drive.settingsCard()}
  <div class="card"><b>💾 Kopia zapasowa</b><p class="small muted">Ręczna kopia niezależna od Dysku. Eksport zapisuje plik .json w Pobranych – wyślij go sobie na maila/Dysk.${DB.lastBackup ? ' Ostatnia kopia: ' + fmtDate(DB.lastBackup) + '.' : ''}</p>
  <button class="btn p w" onclick="exportData()">Eksportuj kopię (.json)</button><div style="height:8px"></div>
  <button class="btn w" onclick="pickImport()">Wczytaj plik z danymi / kopię</button></div>
  <div class="card"><b>⏱ Przerwa między seriami</b><div class="row" style="margin-top:8px">${[60, 90, 120, 180].map(v => `<button class="btn sm grow ${ui.restSec === v ? 'p' : ''}" data-rest="${v}">${v}s</button>`).join('')}</div></div>
  <div class="card small muted">Źródła bazy ćwiczeń: ilustracje – Exercise data by <a href="https://repdb.co" target="_blank" rel="noopener">RepDB (repdb.co)</a>; zdjęcia – free-exercise-db (domena publiczna).</div>
  <div class="card small muted">Podopiecznych: ${DB.clients.length} · rozmiar danych: ${(size / 1024).toFixed(0)} KB${DB.importedAt ? ' · import z Excela: ' + fmtDate(DB.importedAt) : ''}</div>
  <div id="inst"></div>
  <button class="btn w danger" id="wipe">Usuń wszystkie dane z telefonu</button></main>`;
  Drive.bindCard();
  $app.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { ui.restSec = +b.dataset.rest; saveUi(); renderSettings(); });
  document.getElementById('wipe').onclick = () => confirmBox('Usunąć WSZYSTKIE dane? Zrób najpierw kopię!', () => { localStorage.removeItem(KEY); DB = null; render(); }, 'Usuń wszystko');
  if (deferredInstall) { const i = document.getElementById('inst'); i.innerHTML = `<button class="btn p w" style="margin-bottom:10px">📲 Zainstaluj aplikację</button>`; i.firstChild.onclick = () => { deferredInstall.prompt(); deferredInstall = null; }; }
}

// ------------------------------------------------------------------ start
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
Drive.handleRedirect();
load();
render();
Drive.init();
