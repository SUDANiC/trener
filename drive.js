/* Trener – automatyczna synchronizacja z Dyskiem Google (uprawnienie drive.file) */
'use strict';
const Drive = (() => {
  const CLIENT_ID = '608016152088-99h4go8mvpadmq8amaouerl2hmoing8p.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
  const SKEY = 'trener-drive';
  const FILE = 'trener-dane.json';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UP = 'https://www.googleapis.com/upload/drive/v3/files';
  const KEEP_BACKUPS = 30;

  let st = {};
  try { st = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { st = {}; }
  let state = st.connected ? 'pending' : 'off';
  let lastError = '';
  let timer = null, busy = false, again = false;

  const persist = () => { try { localStorage.setItem(SKEY, JSON.stringify(st)); } catch (e) {} };
  const tokenOk = () => !!(st.token && st.exp > Date.now() + 60000);
  const dirty = () => !!DB && (DB.savedAt || '') !== (st.synced || '');
  const authErr = () => Object.assign(new Error('Wymagane ponowne zalogowanie'), { auth: true });

  function setState(s) {
    state = s;
    const el = document.getElementById('cloud');
    if (el) el.outerHTML = icon();
    const card = document.getElementById('drive-card');
    if (card) card.outerHTML = settingsCard();
    bindCard();
  }

  // ---------------------------------------------------------- logowanie (przekierowanie – pewne w PWA)
  function authRedirect(action) {
    const s = Math.random().toString(36).slice(2) + Date.now().toString(36);
    st.oauthState = s; st.pendingAction = action || 'sync'; st.returnHash = location.hash || '#/'; persist();
    const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: s });
    if (st.email) p.set('login_hint', st.email);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
  }
  function handleRedirect() {
    const h = location.hash;
    if (!/(access_token|error)=/.test(h)) return false;
    const p = new URLSearchParams(h.slice(1));
    const back = st.returnHash || '#/';
    if (p.get('state') && p.get('state') === st.oauthState) {
      if (p.get('error')) {
        lastError = p.get('error') === 'access_denied' ? 'Odmówiono dostępu (dodaj swój Gmail jako użytkownika testowego)' : 'Błąd logowania: ' + p.get('error');
        st.pendingAction = null;
      } else {
        st.token = p.get('access_token');
        st.exp = Date.now() + (parseInt(p.get('expires_in'), 10) || 3600) * 1000;
      }
    }
    st.oauthState = null; persist();
    history.replaceState(null, '', location.pathname + back);
    return true;
  }
  function getToken(interactive, action) {
    if (tokenOk()) return Promise.resolve(st.token);
    if (!interactive) return Promise.reject(authErr());
    authRedirect(action);
    return new Promise(() => {}); // strona przechodzi do Google
  }

  // ---------------------------------------------------------- API Dysku
  async function api(url, opts, t) {
    opts = opts || {};
    const r = await fetch(url, Object.assign({}, opts, { headers: Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + t }) }));
    if (r.status === 401) { st.token = null; persist(); throw authErr(); }
    if (!r.ok) throw new Error('Dysk ' + r.status + ': ' + (await r.text()).slice(0, 140));
    return r;
  }
  async function folderId(t) {
    if (st.folderId) {
      try { const j = await (await api(`${API}/${st.folderId}?fields=id,trashed`, {}, t)).json(); if (!j.trashed) return st.folderId; }
      catch (e) { if (e.auth) throw e; }
    }
    const q = encodeURIComponent("name='Trener' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    const j = await (await api(`${API}?q=${q}&fields=files(id)&spaces=drive`, {}, t)).json();
    if (j.files && j.files.length) st.folderId = j.files[0].id;
    else {
      const r = await api(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Trener', mimeType: 'application/vnd.google-apps.folder' }) }, t);
      st.folderId = (await r.json()).id;
    }
    persist();
    return st.folderId;
  }
  async function findMain(t, folder) {
    const q = encodeURIComponent(`name='${FILE}' and '${folder}' in parents and trashed=false`);
    const j = await (await api(`${API}?q=${q}&fields=files(id,modifiedTime,appProperties)&orderBy=modifiedTime desc`, {}, t)).json();
    return (j.files && j.files[0]) || null;
  }
  async function upload(t, folder, name, content, fileId, props) {
    const meta = fileId ? { appProperties: props } : { name, parents: [folder], mimeType: 'application/json', appProperties: props };
    const b = 'trener' + Math.random().toString(36).slice(2);
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`;
    const url = fileId ? `${UP}/${fileId}?uploadType=multipart&fields=id,modifiedTime` : `${UP}?uploadType=multipart&fields=id,modifiedTime`;
    return (await api(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body }, t)).json();
  }
  async function download(t, id) { return (await api(`${API}/${id}?alt=media`, {}, t)).json(); }
  async function pruneBackups(t, folder) {
    const q = encodeURIComponent(`name contains 'kopia-' and '${folder}' in parents and trashed=false`);
    const j = await (await api(`${API}?q=${q}&fields=files(id,name)&orderBy=name desc&pageSize=200`, {}, t)).json();
    for (const f of (j.files || []).slice(KEEP_BACKUPS)) await api(`${API}/${f.id}`, { method: 'DELETE' }, t).catch(() => {});
  }
  async function fetchEmail(t) {
    try { const j = await (await api('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', {}, t)).json(); st.email = j.user && j.user.emailAddress; persist(); } catch (e) {}
  }

  // ---------------------------------------------------------- synchronizacja
  function writeLocal() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {} }
  function adopt(remote) {
    DB = remote; st.synced = DB.savedAt || ''; persist(); writeLocal();
  }
  async function push(interactive, force) {
    if (!st.connected || !DB) return;
    if (busy) { again = true; return; }
    if (!navigator.onLine) { setState('pending'); return; }
    busy = true; setState('syncing');
    try {
      const t = await getToken(interactive, 'sync');
      const folder = await folderId(t);
      if (!st.fileId) { const f = await findMain(t, folder); st.fileId = f ? f.id : null; }
      if (st.fileId && !force) {
        const m = await (await api(`${API}/${st.fileId}?fields=appProperties,trashed`, {}, t)).json();
        const rs = m.appProperties && m.appProperties.savedAt;
        if (m.trashed) st.fileId = null;
        else if (rs && st.synced && rs > st.synced && rs !== DB.savedAt) { busy = false; return conflict(rs); }
      }
      const sa = DB.savedAt || new Date().toISOString();
      if (!DB.savedAt) DB.savedAt = sa;
      const content = JSON.stringify(DB);
      const res = await upload(t, folder, FILE, content, st.fileId, { savedAt: sa });
      st.fileId = res.id; st.synced = sa; st.lastSync = new Date().toISOString();
      const day = st.lastSync.slice(0, 10);
      if (st.backupDay !== day) {
        await upload(t, folder, `kopia-${day}.json`, content, null, { kind: 'backup' });
        st.backupDay = day; pruneBackups(t, folder).catch(() => {});
      }
      if (!st.email) fetchEmail(t);
      DB.lastBackup = st.lastSync; writeLocal(); persist();
      lastError = '';
      setState(dirty() ? 'pending' : 'ok');
    } catch (e) {
      lastError = e.auth ? '' : e.message;
      setState(e.auth ? 'auth' : 'error');
    }
    busy = false;
    if (again) { again = false; push(false); }
  }
  async function checkRemote() {
    if (!st.connected || !navigator.onLine || !tokenOk()) return;
    try {
      setState('syncing');
      const t = st.token, folder = await folderId(t), f = await findMain(t, folder);
      if (!f) return push(false, true);
      st.fileId = f.id; persist();
      const rs = (f.appProperties && f.appProperties.savedAt) || '';
      if (!DB || (rs > (DB.savedAt || '') && !dirty())) {
        adopt(await download(t, f.id)); setState('ok'); render(); toast('Pobrano najnowsze dane z Dysku');
      } else if (dirty() && rs && st.synced && rs > st.synced && rs !== DB.savedAt) {
        conflict(rs);
      } else if (dirty()) push(false);
      else setState('ok');
    } catch (e) { lastError = e.auth ? '' : e.message; setState(e.auth ? 'auth' : 'error'); }
  }
  function conflict(remoteSavedAt) {
    lastError = 'Konflikt danych'; setState('error');
    modal(`<h3>Dane zmieniły się w dwóch miejscach</h3><p class="small muted">Na Dysku jest wersja z ${esc(new Date(remoteSavedAt).toLocaleString('pl-PL'))} (z innego urządzenia), a na tym telefonie też są nowe zmiany. Którą wersję zachować?</p>
      <button class="btn p w" data-c="pull">⬇️ Pobierz z Dysku (zastąp telefon)</button><div style="height:8px"></div>
      <button class="btn w" data-c="push">⬆️ Wyślij z telefonu (zastąp Dysk)</button><div style="height:8px"></div>
      <button class="btn w" data-c="later">Zdecyduję później</button>`, (m, close) => {
      m.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
        close();
        if (b.dataset.c === 'push') return push(true, true);
        if (b.dataset.c === 'pull') {
          try { const t = await getToken(true, 'sync'); adopt(await download(t, st.fileId)); lastError = ''; setState('ok'); render(); toast('Pobrano dane z Dysku'); }
          catch (e) { lastError = e.message; setState('error'); }
        }
      });
    });
  }
  async function finishConnect() {
    st.pendingAction = null; st.connected = true; persist();
    setState('syncing');
    try {
      const t = await getToken(false);
      fetchEmail(t);
      const folder = await folderId(t), f = await findMain(t, folder);
      const localHasData = DB && DB.clients && DB.clients.length;
      if (f && !localHasData) { st.fileId = f.id; adopt(await download(t, f.id)); setState('ok'); render(); toast('Połączono – dane pobrane z Dysku'); return; }
      if (f && localHasData) {
        st.fileId = f.id; persist(); setState('pending');
        modal(`<h3>Na Dysku są już dane</h3><p class="small muted">Ostatnia zmiana: ${esc(new Date(f.modifiedTime).toLocaleString('pl-PL'))}. Co zrobić?</p>
          <button class="btn p w" data-c="pull">⬇️ Pobierz z Dysku (zastąp telefon)</button><div style="height:8px"></div>
          <button class="btn w" data-c="push">⬆️ Wyślij dane z telefonu (zastąp Dysk)</button>`, (m, close) => {
          m.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
            close();
            if (b.dataset.c === 'push') return push(false, true);
            try { adopt(await download(t, f.id)); setState('ok'); render(); toast('Dane pobrane z Dysku'); } catch (e) { lastError = e.message; setState('error'); }
          });
        });
        return;
      }
      if (!DB) { DB = { app: 'trener', version: 1, clients: [] }; DB.savedAt = new Date().toISOString(); writeLocal(); render(); }
      await push(false, true);
      toast('Połączono z Dyskiem Google ☁️');
    } catch (e) { lastError = e.auth ? '' : e.message; setState(e.auth ? 'auth' : 'error'); }
  }

  // ---------------------------------------------------------- publiczne
  function connect() { if (tokenOk()) return finishConnect(); getToken(true, 'connect'); }
  function syncNow() { push(true); }
  function disconnect() {
    if (st.token) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(st.token), { method: 'POST' }).catch(() => {});
    st = {}; persist(); lastError = ''; setState('off');
  }
  function schedule() {
    if (!st.connected) return;
    if (state !== 'syncing') setState(tokenOk() ? 'pending' : 'auth');
    clearTimeout(timer);
    timer = setTimeout(() => push(false), 4000);
  }
  function init() {
    if (!st.connected && st.pendingAction !== 'connect') return;
    if (st.pendingAction === 'connect') { if (tokenOk()) finishConnect(); else { st.pendingAction = null; persist(); setState(lastError ? 'error' : 'off'); if (lastError) toast(lastError); } return; }
    st.pendingAction = null; persist();
    if (tokenOk()) checkRemote();
    else setState(lastError ? 'error' : 'auth');
  }
  window.addEventListener('online', () => { if (st.connected && dirty()) push(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && st.connected && dirty() && tokenOk()) { clearTimeout(timer); push(false); }
    if (document.visibilityState === 'visible' && st.connected && tokenOk() && !busy) checkRemote();
  });

  function icon() {
    if (!st.connected) return '';
    const map = { ok: ['☁️', 'var(--ok)', 'Zsynchronizowano'], pending: ['☁️', 'var(--warn)', 'Czeka na wysłanie'], syncing: ['🔄', 'var(--accent)', 'Synchronizuję…'], error: ['☁️', 'var(--bad)', 'Błąd synchronizacji'], auth: ['☁️', 'var(--bad)', 'Zaloguj ponownie'], off: ['☁️', 'var(--muted)', ''] };
    const [ic, col, label] = map[state] || map.off;
    const act = state === 'auth' ? 'Drive.syncNow()' : "go('#/settings')";
    return `<button class="ib" id="cloud" onclick="${act}" aria-label="${label}" title="${label}">${ic}<span class="cdot" style="background:${col}"></span></button>`;
  }
  function statusText() {
    if (state === 'ok') return `✅ Zsynchronizowano${st.lastSync ? ' · ' + new Date(st.lastSync).toLocaleString('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`;
    if (state === 'pending') return navigator.onLine ? '⏳ Zmiany czekają na wysłanie' : '📴 Brak internetu – wyślę, gdy wróci zasięg';
    if (state === 'syncing') return '🔄 Synchronizuję…';
    if (state === 'auth') return '🔑 Sesja Google wygasła – kliknij „Synchronizuj teraz”';
    if (state === 'error') return '⚠️ ' + esc(lastError || 'Błąd synchronizacji');
    return '';
  }
  function settingsCard() {
    if (!st.connected) {
      return `<div class="card" id="drive-card"><b>☁️ Dysk Google</b><p class="small muted">Po połączeniu każda zmiana zapisuje się automatycznie w folderze <b>Trener</b> na Twoim Dysku, a codziennie powstaje kopia z datą (ostatnie ${KEEP_BACKUPS} dni). Aplikacja widzi tylko pliki, które sama utworzyła.</p>
      ${lastError ? `<p class="small hl">${esc(lastError)}</p>` : ''}<button class="btn p w" data-drive="connect">Połącz z Dyskiem Google</button></div>`;
    }
    return `<div class="card" id="drive-card"><b>☁️ Dysk Google</b>${st.email ? `<div class="tiny muted">${esc(st.email)}</div>` : ''}
    <p class="small" style="margin:8px 0">${statusText()}</p>
    <div class="row"><button class="btn sm p grow" data-drive="sync">Synchronizuj teraz</button><button class="btn sm grow" data-drive="off">Odłącz</button></div></div>`;
  }
  function bindCard() {
    document.querySelectorAll('[data-drive]').forEach(b => b.onclick = () => {
      const a = b.dataset.drive;
      if (a === 'connect') connect();
      if (a === 'sync') syncNow();
      if (a === 'off') confirmBox('Odłączyć Dysk Google? Dane na telefonie i na Dysku zostaną, ale przestaną się synchronizować.', disconnect, 'Odłącz');
    });
  }
  return { handleRedirect, init, connect, syncNow, schedule, icon, settingsCard, bindCard, get connected() { return !!st.connected; } };
})();
