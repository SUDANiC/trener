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
function ambCount(c) { let n = 0; for (const s of c.sessions) for (const e of s.entries) for (const x of e.sets) if (x.amb) n++; return n; }
function totalAmb() { return DB ? DB.clients.reduce((a, c) => a + ambCount(c), 0) : 0; }
function exById(c, id) { for (const p of c.plans) for (const e of p.exercises) if (e.id === id) return e; for (const e of (c.extraEx || [])) if (e.id === id) return e; return null; }
function exName(c, id) { const e = exById(c, id); return e ? e.name : '?'; }
function lastFor(c, ex, skipSid) { // ostatnie wykonanie ćwiczenia (po id, potem po nazwie)
  const n = norm(ex.name);
  for (const s of sortedSessions(c)) {
    if (s.id === skipSid) continue;
    for (const en of s.entries) {
      if (en.exId === ex.id || norm(exName(c, en.exId)) === n) {
        if (en.sets.some(x => x.kg != null || x.reps != null || x.sec || x.raw)) return { s, en };
      }
    }
  }
  return null;
}
function bestKg(en) { let m = null; for (const x of en.sets) if (typeof x.kg === 'number' && (m == null || x.kg > m)) m = x.kg; return m; }
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
  modal(`<h3>${esc(title)}</h3>${fields.map(f => `<label class="field"><span>${esc(f.label)}</span>${f.type === 'area' ? `<textarea class="inp" data-k="${f.k}">${esc(f.v || '')}</textarea>` : `<input class="inp" data-k="${f.k}" value="${esc(f.v ?? '')}" ${f.list ? 'list="exlist"' : ''} ${f.type === 'num' ? 'inputmode="decimal"' : ''} placeholder="${esc(f.ph || '')}">`}</label>`).join('')}${dl}<div class="row"><button class="btn grow" data-x>Anuluj</button><button class="btn p grow" data-y>Zapisz</button></div>`, (m, close) => {
    const first = m.querySelector('[data-k]'); setTimeout(() => first && first.focus(), 50);
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
          menu([{ label: 'Zastąp wszystkie dane plikiem', icon: '♻️', fn: () => confirmBox('Na pewno zastąpić obecne dane?', () => apply('replace'), 'Zastąp') },
                { label: 'Dodaj tylko nowych podopiecznych', icon: '➕', fn: () => apply('merge') }]);
        } else apply('replace');
      } catch (e) { toast('Nie udało się wczytać: ' + e.message); }
    };
    r.readAsText(f);
  };
  i.click();
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
  return active.map(p => planPreview(c, p)).join('') +
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
    return `<div class="small ell"><span class="muted">${best.length}×</span> ${esc(exName(c, en.exId))} ${best[0] ? `<span class="muted">· ${setPlain(best[0])}</span>` : ''}</div>`;
  }).join('') + (s.entries.length > 6 ? `<div class="tiny muted">+${s.entries.length - 6} więcej</div>` : '');
}
function clientHistory(c) {
  const ss = sortedSessions(c);
  if (!ss.length) return `<div class="empty">Brak zapisanych treningów</div>`;
  return ss.map(s => { const a = s.entries.reduce((n, e) => n + e.sets.filter(x => x.amb).length, 0);
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
  const n = c.sessions.filter(s => s.planId === p.id).length;
  $app.innerHTML = `${topBar(esc(p.name), { back: 1, right: `<button class="ib" id="pm">⋯</button>` })}<main>
  <div class="small muted" style="margin-bottom:10px">${esc(c.name)}${p.member ? ' · ' + esc(p.member) : ''} · ${p.exercises.length} ćwiczeń · ${n} treningów</div>
  <button class="btn p w" onclick="startWorkout('${c.id}','${p.id}')">▶ Rozpocznij trening</button>
  <div class="sec">Ćwiczenia</div>
  ${p.exercises.map(e => { const l = lastFor(c, e); const sets = l ? l.en.sets.filter(x => x.kg != null || x.reps != null || x.sec || x.raw) : [];
    return `<div class="card" onclick="go('#/c/${c.id}/e/${e.id}')"><div class="ex-h"><div class="ex-ic">🏋️</div><div class="grow"><div class="ex-n">${esc(e.name)}</div>
    <div class="tiny muted">${targetText(e.target) ? 'Cel: ' + esc(targetText(e.target)) : 'bez zakresu'}${e.note ? ' · ' + esc(e.note) : ''}</div></div>${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">▶</a>` : ''}</div>
    ${sets.length ? `<div class="small"><span class="muted">Ostatnio:</span> ${sets.map(setText).join('<span class="muted"> · </span>')}</div>` : '<div class="small muted">Brak historii</div>'}</div>`; }).join('') || '<div class="empty">Plan jest pusty – dodaj ćwiczenia w edycji</div>'}
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
  $app.innerHTML = `${topBar('Edycja planu', { back: 1, right: `<button class="btn sm p" data-act="back">Gotowe</button>` })}<main>
  <label class="field"><span>Nazwa planu</span><input class="inp" id="pn" value="${esc(p.name)}"></label>
  ${c.members && c.members.length ? `<label class="field"><span>Osoba</span><select class="inp" id="pmb"><option value="">wszyscy</option>${c.members.map(m => `<option ${p.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>` : ''}
  <div class="sec">Ćwiczenia</div>
  ${p.exercises.map((e, i) => `<div class="card"><div class="row"><div class="grow"><div style="font-weight:700">${i + 1}. ${esc(e.name)}</div><div class="tiny muted">${esc(targetText(e.target) || 'bez zakresu')}${e.note ? ' · ' + esc(e.note) : ''}</div></div>
  <button class="ib" data-up="${i}">⬆️</button><button class="ib" data-ed="${i}">✏️</button><button class="ib" data-del="${i}">🗑️</button></div></div>`).join('')}
  <button class="btn p w" id="ae">＋ Dodaj ćwiczenie</button></main>`;
  document.getElementById('pn').oninput = e => { p.name = e.target.value; save(); };
  const mb = document.getElementById('pmb'); if (mb) mb.onchange = () => { p.member = mb.value || null; save(); };
  const exForm = (e, fn) => prompt2(e ? 'Ćwiczenie' : 'Nowe ćwiczenie', [
    { k: 'name', label: 'Nazwa', v: e && e.name, list: 1 },
    { k: 'sets', label: 'Liczba serii', v: e && e.target && e.target.sets, type: 'num', ph: '3' },
    { k: 'reps', label: 'Zakres powtórzeń / czas', v: e && e.target && e.target.reps, ph: '8-12, 30-60s, max' },
    { k: 'note', label: 'Wskazówka', v: e && e.note, ph: 'np. pauza 2s na dole' },
    { k: 'link', label: 'Link do filmu', v: e && e.link }], fn);
  document.getElementById('ae').onclick = () => exForm(null, o => { if (!o.name) return; p.exercises.push({ id: nid(), name: o.name, target: { sets: parseInt(o.sets) || null, reps: o.reps, raw: '' }, note: o.note, link: o.link }); save(); renderPlanEdit(c, pid); });
  $app.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => { const e = p.exercises[+b.dataset.ed]; exForm(e, o => { if (o.name) e.name = o.name; e.target = { sets: parseInt(o.sets) || null, reps: o.reps, raw: '' }; e.note = o.note; e.link = o.link; save(); renderPlanEdit(c, pid); }); });
  $app.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { p.exercises.splice(i - 1, 0, p.exercises.splice(i, 1)[0]); save(); renderPlanEdit(c, pid); } });
  $app.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const i = +b.dataset.del; confirmBox(`Usunąć „${p.exercises[i].name}” z planu?`, () => { p.exercises.splice(i, 1); save(); renderPlanEdit(c, pid); }); });
}

// ------------------------------------------------------------------ trening (logowanie)
function startWorkout(cid, pid) {
  const c = client(cid), p = plan(c, pid);
  const open = c.sessions.find(s => s.live);
  if (open) { toast('Kontynuujesz rozpoczęty trening'); return go(`#/c/${c.id}/w/${open.id}`); }
  const s = { id: nid(), planId: p.id, member: p.member || null, date: new Date().toISOString(), start: Date.now(), live: true, source: 'app', entries: [] };
  for (const e of p.exercises) {
    const l = lastFor(c, e);
    const n = (e.target && e.target.sets) || (l ? Math.min(Math.max(l.en.sets.length, 1), 6) : 3);
    const prev = l ? l.en.sets : [];
    s.entries.push({ exId: e.id, sets: Array.from({ length: n }, (_, i) => { const pv = prev[i] || prev[prev.length - 1] || {}; return { kg: pv.kg ?? null, reps: pv.reps ?? null, sec: pv.sec ?? null, done: false, ph: true }; }) });
  }
  c.sessions.push(s); save(true); go(`#/c/${c.id}/w/${s.id}`);
}
function renderWorkout(c, sid) {
  const s = c.sessions.find(x => x.id === sid); if (!s) return go('#/c/' + c.id);
  const p = plan(c, s.planId);
  const prevOf = (en, i) => { const ex = exById(c, en.exId) || { id: en.exId, name: '' }; const l = lastFor(c, ex, s.id); const x = l && (l.en.sets[i]); return x ? setPlain(x) : '–'; };
  $app.innerHTML = `${topBar(esc(p ? p.name : 'Trening'), { back: 1, right: `<button class="btn sm ok" id="fin">${s.live ? 'Zakończ' : 'Zapisz'}</button>` })}<main>
  <div class="row small muted" style="margin-bottom:10px"><div class="grow">${esc(c.name)}${s.member ? ' · ' + esc(s.member) : ''}</div>${s.live ? `<span>⏱ <span class="timer" id="el" style="font-size:15px">0:00</span></span>` : ''}</div>
  ${s.entries.map((en, ei) => { const ex = exById(c, en.exId) || { name: '?' }; return `<div class="card"><div class="ex-h"><div class="ex-ic">🏋️</div><div class="grow"><div class="ex-n">${esc(ex.name)}</div><div class="tiny muted">${esc(targetText(ex.target))}${ex.note ? ' · ' + esc(ex.note) : ''}</div></div><button class="ib" data-exm="${ei}">⋯</button></div>
  ${en.note != null ? `<input class="inp small" data-note="${ei}" placeholder="Notatka do ćwiczenia" value="${esc(en.note)}" style="min-height:36px;margin-bottom:8px">` : ''}
  <table class="sets"><tr><th>Seria</th><th>Poprzednio</th><th>kg</th><th>Powt</th><th>✓</th></tr>
  ${en.sets.map((x, si) => `<tr class="${x.done ? 'done' : ''}"><td class="sn">${si + 1}</td><td class="prev">${esc(prevOf(en, si))}</td>
  <td><input class="num" inputmode="decimal" data-e="${ei}" data-s="${si}" data-f="kg" value="${x.ph ? '' : fmtNum(x.kg)}" placeholder="${x.ph ? fmtNum(x.kg) : ''}"></td>
  <td><input class="num" inputmode="decimal" data-e="${ei}" data-s="${si}" data-f="reps" value="${x.ph ? '' : fmtNum(x.reps)}" placeholder="${x.ph ? (x.sec ? x.sec + 's' : fmtNum(x.reps)) : ''}"></td>
  <td><button class="ck ${x.done ? 'on' : ''}" data-ck="${ei}:${si}">✓</button></td></tr>`).join('')}</table>
  <button class="btn sm w" style="margin-top:8px" data-add="${ei}">＋ Dodaj serię</button></div>`; }).join('')}
  <button class="btn w" id="aex">＋ Dodaj ćwiczenie</button>
  ${s.live ? `<div style="height:10px"></div><button class="btn w danger" id="discard">Odrzuć trening</button>` : ''}
  </main>${restBar()}`;
  if (s.live) { const el = document.getElementById('el'); const tick = () => { if (!document.body.contains(el)) return clearInterval(ti); const m = Math.floor((Date.now() - s.start) / 1000); el.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }; tick(); var ti = setInterval(tick, 1000); }
  $app.querySelectorAll('input.num').forEach(inp => {
    inp.oninput = () => { const x = s.entries[+inp.dataset.e].sets[+inp.dataset.s];
      if (x.ph) { x.ph = false; inp.closest('tr').querySelectorAll('input.num').forEach(o => { if (o !== inp && !o.value && o.placeholder && !/s$/.test(o.placeholder)) o.value = o.placeholder; o.placeholder = ''; }); }
      x[inp.dataset.f] = parseNum(inp.value); if (inp.dataset.f === 'reps') x.sec = x.sec && !inp.value ? x.sec : (inp.value ? null : x.sec); delete x.amb; x.raw = null; save(); };
  });
  $app.querySelectorAll('[data-note]').forEach(inp => inp.oninput = () => { s.entries[+inp.dataset.note].note = inp.value; save(); });
  $app.querySelectorAll('[data-ck]').forEach(b => b.onclick = () => {
    const [ei, si] = b.dataset.ck.split(':').map(Number); const x = s.entries[ei].sets[si];
    if (x.ph) { x.ph = false; } // zatwierdzenie podpowiedzi z poprzedniego treningu
    x.done = !x.done; save();
    if (x.done && navigator.vibrate) navigator.vibrate(30);
    if (x.done && s.live) startRest();
    const sy = window.scrollY; renderWorkout(c, sid); window.scrollTo(0, sy);
  });
  $app.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const en = s.entries[+b.dataset.add]; const last = en.sets[en.sets.length - 1] || {}; en.sets.push({ kg: last.kg ?? null, reps: last.reps ?? null, done: false, ph: true }); save(); const sy = window.scrollY; renderWorkout(c, sid); window.scrollTo(0, sy); });
  $app.querySelectorAll('[data-exm]').forEach(b => b.onclick = () => { const ei = +b.dataset.exm, en = s.entries[ei];
    menu([{ label: 'Notatka do ćwiczenia', icon: '📝', fn: () => { en.note = en.note || ''; save(); renderWorkout(c, sid); } },
          { label: 'Usuń ostatnią serię', icon: '➖', fn: () => { en.sets.pop(); save(); renderWorkout(c, sid); } },
          { label: 'Historia ćwiczenia', icon: '📈', fn: () => go(`#/c/${c.id}/e/${en.exId}`) },
          { label: 'Usuń z tego treningu', icon: '🗑️', danger: 1, fn: () => { s.entries.splice(ei, 1); save(); renderWorkout(c, sid); } }]); });
  document.getElementById('aex').onclick = () => prompt2('Dodaj ćwiczenie', [{ k: 'name', label: 'Nazwa', list: 1 }, { k: 'plan', label: 'Dodać też do planu? (tak/nie)', v: 'tak' }], o => {
    if (!o.name) return; let ex = p && p.exercises.find(e => norm(e.name) === norm(o.name));
    if (!ex) { ex = { id: nid(), name: o.name, target: null }; if (p && /^t/i.test(o.plan)) p.exercises.push(ex); else (c.extraEx = c.extraEx || []).push(ex); }
    s.entries.push({ exId: ex.id, sets: [{ kg: null, reps: null, done: false }, { kg: null, reps: null, done: false }, { kg: null, reps: null, done: false }] }); save(); renderWorkout(c, sid); });
  document.getElementById('fin').onclick = () => {
    // niewypełnione podpowiedzi bez ✓ usuwamy, zatwierdzone zostają
    for (const en of s.entries) en.sets = en.sets.filter(x => !(x.ph && !x.done) && (x.kg != null || x.reps != null || x.sec != null || x.done));
    for (const en of s.entries) for (const x of en.sets) delete x.ph;
    s.entries = s.entries.filter(en => en.sets.length || en.note);
    if (s.live) { s.dur = Math.round((Date.now() - s.start) / 60000); delete s.live; }
    stopRest(); save(true); toast('Trening zapisany 💪'); go(`#/c/${c.id}/s/${s.id}`);
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
  $app.innerHTML = `${topBar(esc(sessTitle(s, c)), { back: 1, right: `<button class="ib" id="sm">⋯</button>` })}<main>
  <div class="small muted" style="margin-bottom:10px">${sessWhen(s, c)}${s.dur ? ` · ${s.dur} min` : ''}</div>
  ${s.entries.map((en, ei) => `<div class="card"><div class="ex-h"><div class="ex-ic">🏋️</div><div class="grow ex-n">${esc(exName(c, en.exId))}</div></div>
  ${en.sets.map((x, si) => `<div class="row small" style="padding:4px 0"><span class="sn muted">${si + 1}</span><div class="grow">${setText(x) || '<span class="muted">–</span>'}</div>${x.amb ? `<button class="chip warn" data-fix="${ei}:${si}">? sprawdź</button>` : `<button class="ib" data-fix="${ei}:${si}" style="width:32px;height:32px;font-size:14px">✏️</button>`}</div>`).join('')}
  ${en.note ? `<div class="tiny muted">📝 ${esc(en.note)}</div>` : ''}</div>`).join('') || '<div class="empty">Pusty trening</div>'}
  </main>`;
  $app.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { const [ei, si] = b.dataset.fix.split(':').map(Number); editSet(s.entries[ei].sets[si], () => renderSession(c, sid)); });
  document.getElementById('sm').onclick = () => menu([
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
    for (const s of c.sessions) for (const en of s.entries) en.sets.forEach(x => { if (x.amb) { const k = en.exId; if (!byEx.has(k)) byEx.set(k, []); byEx.get(k).push({ s, x }); } });
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
  const swap = x => { const k = x.kg; x.kg = x.reps; x.reps = k; };
  const re = () => { save(); const sy = window.scrollY; renderReview(); window.scrollTo(0, sy); };
  $app.querySelectorAll('[data-ga]').forEach(b => b.onclick = () => { const [gi, a] = b.dataset.ga.split(':'); for (const it of groups[+gi].items) { if (a === 'swap') swap(it.x); delete it.x.amb; delete it.x.why; } re(); });
  $app.querySelectorAll('[data-it]').forEach(b => b.onclick = () => { const [gi, ii, a] = b.dataset.it.split(':'); const it = groups[+gi].items[+ii];
    if (a === 'ed') return editSet(it.x, re);
    if (a === 'swap') swap(it.x); delete it.x.amb; delete it.x.why; re(); });
}

// ------------------------------------------------------------------ ustawienia
function renderSettings() {
  let size = 0; try { size = (localStorage.getItem(KEY) || '').length; } catch (e) {}
  $app.innerHTML = `${topBar('Ustawienia', { back: 1 })}<main>
  ${Drive.settingsCard()}
  <div class="card"><b>💾 Kopia zapasowa</b><p class="small muted">Ręczna kopia niezależna od Dysku. Eksport zapisuje plik .json w Pobranych – wyślij go sobie na maila/Dysk.${DB.lastBackup ? ' Ostatnia kopia: ' + fmtDate(DB.lastBackup) + '.' : ''}</p>
  <button class="btn p w" onclick="exportData()">Eksportuj kopię (.json)</button><div style="height:8px"></div>
  <button class="btn w" onclick="pickImport()">Wczytaj plik z danymi / kopię</button></div>
  <div class="card"><b>⏱ Przerwa między seriami</b><div class="row" style="margin-top:8px">${[60, 90, 120, 180].map(v => `<button class="btn sm grow ${ui.restSec === v ? 'p' : ''}" data-rest="${v}">${v}s</button>`).join('')}</div></div>
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
