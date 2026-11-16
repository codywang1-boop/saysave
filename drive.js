/* SaySave storage adapters.
   DemoDrive  – a pretend Google Drive kept in this browser, so the app can be tried with no setup.
   GoogleDrive – the real Google Drive REST API v3, signed in with Google Identity Services. */
(function (root) {
  'use strict';
  const FOLDER = 'application/vnd.google-apps.folder';

  function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }
  function uid() { return Math.random().toString(36).slice(2, 10); }

  // ---------------- Demo ----------------
  function seedDemo() {
    const f = (id, name, parentId) => ({ id, name, parentId });
    const y = new Date().getFullYear();
    return {
      folders: [
        f('taxes', 'Taxes', 'root'), f('t1', String(y - 1), 'taxes'), f('t2', String(y), 'taxes'),
        f('bills', 'Bills', 'root'), f('med', 'Medical', 'root'), f('work', 'Work', 'root'),
        f('photos', 'Photos', 'root'), f('kids', 'Kids School', 'root')
      ],
      files: [
        ['W2_' + (y - 1) + '_Acme.pdf', 'application/pdf'], ['Chase_Statement_Jan_' + y + '.pdf', 'application/pdf'],
        ['Verizon_Bill_Feb.pdf', 'application/pdf'], ['IMG_2231.jpg', 'image/jpeg'], ['Dentist_visit_summary.pdf', 'application/pdf'],
        ['Passport_scan.pdf', 'application/pdf'], ['Honda_oil_change.pdf', 'application/pdf'], ['report_card_spring.pdf', 'application/pdf'],
        ['1099-INT_' + y + '.pdf', 'application/pdf'], ['Lease_Agreement_' + y + '.pdf', 'application/pdf'],
        ['Geico_policy_renewal.pdf', 'application/pdf'], ['scan_0007.pdf', 'application/pdf'], ['notes.txt', 'text/plain']
      ].map(([name, mimeType]) => ({ id: uid(), name, mimeType, parentId: 'root', size: 120000 }))
    };
  }

  class DemoDrive {
    constructor() { this.isDemo = true; this.label = 'Demo Drive'; this.data = store('saysave.demo') || seedDemo(); this.save(); }
    save() { store('saysave.demo', this.data); }
    reset() { this.data = seedDemo(); this.save(); }
    async init() { return true; }
    isConnected() { return true; }
    account() { return 'Demo (stored only in this browser)'; }
    async getIndex() { return { rootId: 'root', folders: this.data.folders.map(x => ({ ...x })) }; }
    async createFolder(name, parentId) {
      const f = { id: uid(), name, parentId: parentId || 'root' }; this.data.folders.push(f); this.save(); return f;
    }
    async upload(file, name, folderId) {
      const f = { id: uid(), name, mimeType: file.type || 'application/octet-stream', parentId: folderId, size: file.size || 0 };
      this.data.files.push(f); this.save(); return { id: f.id, link: null };
    }
    async trash(id) {
      this.data.files = this.data.files.filter(f => f.id !== id);
      this.data.folders = this.data.folders.filter(f => f.id !== id); this.save();
    }
    async listFiles(scope) {
      return this.data.files.filter(f => scope === 'all' || f.parentId === 'root')
        .map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, parents: [f.parentId] }));
    }
    async move(id, toId) { const f = this.data.files.find(x => x.id === id); if (f) { f.parentId = toId; this.save(); } }
    async childCount(folderId) {
      return this.data.files.filter(f => f.parentId === folderId).length + this.data.folders.filter(f => f.parentId === folderId).length;
    }
    filesIn(folderId) { return this.data.files.filter(f => f.parentId === folderId); }
    async findSimilar(words) {
      const out = {}; if (!words || !words.length) return out;
      for (const f of this.data.files) { const n = f.name.toLowerCase(); if (f.parentId !== 'root' && words.some(w => n.includes(w))) out[f.parentId] = (out[f.parentId] || 0) + 1; }
      return out;
    }
    folderLink() { return null; }
  }

  // ---------------- Android bridge ----------------
  const NATIVE = !!root.SaySaveAndroid;
  const nativeWaits = {};
  root.__nativeCb = (id, result) => { const w = nativeWaits[id]; if (w) { delete nativeWaits[id]; w(result || {}); } };
  function nativeCall(method, ...args) {
    return new Promise(res => { const id = 'n' + Date.now() + Math.random().toString(36).slice(2, 6); nativeWaits[id] = res; root.SaySaveAndroid[method](id, ...args); });
  }

  // ---------------- Google ----------------
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'https://www.googleapis.com/auth/drive';

  const inPreview = () => /claudeusercontent\.com$|claude\.ai$/.test(location.hostname);
  const PREVIEW_MSG = 'Google sign-in is blocked inside the Claude preview. Open SaySave from its own web address (your GitHub Pages link) to connect Google Drive.';
  function loadGoogle() {
    return new Promise((res, rej) => {
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      if (inPreview()) return rej(new Error(PREVIEW_MSG));
      const old = document.querySelector('script[data-gsi]'); if (old) old.remove();
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.dataset.gsi = '1';
      s.onload = () => (window.google && google.accounts) ? res() : rej(new Error('Google sign-in did not load. Check your internet connection and try again.'));
      s.onerror = () => { s.remove(); rej(new Error('Google sign-in could not load. Check your internet connection and try again.')); };
      document.head.appendChild(s);
    });
  }

  class GoogleDrive {
    constructor(clientId) {
      this.isDemo = false; this.label = 'Google Drive'; this.clientId = clientId;
      this.token = null; this.expires = 0; this.user = store('saysave.gUser'); this.rootId = null; this.cache = null;
      // reuse a still-valid token after the app is reopened (Google tokens last about 1 hour)
      const t = store('saysave.gToken');
      if (t && t.expires > Date.now() + 60000 && this.user) { this.token = t.token; this.expires = t.expires; }
    }
    async init() {
      if (NATIVE) { this.native = true; this.client = { native: true }; return true; }   // phone's own Google sign-in
      if (!this.clientId) throw new Error('Add your Google OAuth Client ID in Settings first.');
      await loadGoogle();
      this.client = google.accounts.oauth2.initTokenClient({ client_id: this.clientId, scope: SCOPE, callback: () => {} });
      return true;
    }
    isConnected() { return !!this.user; }
    account() { return this.user ? this.user.name : 'Not connected'; }
    requestToken(prompt) {
      if (this.native) {
        const mode = prompt === 'select_account' ? 'switch' : prompt === 'none' ? 'silent' : 'interactive';
        return nativeCall('getToken', mode).then(r => {
          if (!r.token) throw new Error(r.error || 'Google sign-in was cancelled.');
          this.token = r.token; this.expires = Date.now() + 50 * 60 * 1000;
          store('saysave.gToken', { token: this.token, expires: this.expires });
          return this.token;
        });
      }
      return new Promise((res, rej) => {
        this.client.callback = (r) => {
          if (r.error) return rej(new Error(r.error_description || r.error));
          this.token = r.access_token; this.expires = Date.now() + (r.expires_in - 60) * 1000;
          store('saysave.gToken', { token: this.token, expires: this.expires });
          res(this.token);
        };
        this.client.error_callback = (e) => rej(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in failed.'));
        const opts = { prompt };
        // remember who signed in, so Google skips the "Choose an account" screen next time
        if (prompt !== 'select_account' && this.user && this.user.email) opts.hint = this.user.email;
        this.client.requestAccessToken(opts);
      });
    }
    // first time: consent screen; switching: account chooser
    async connect(switchAccount) {
      if (!this.client) await this.init();
      await this.requestToken(switchAccount ? 'select_account' : (this.user ? '' : 'consent'));
      this.cache = null; this.rootId = null;
      const about = await this.api('/about?fields=user(displayName,emailAddress)');
      this.user = { name: about.user.displayName, email: about.user.emailAddress }; store('saysave.gUser', this.user);
      if (this.native) try { root.SaySaveAndroid.rememberAccount(this.user.email); } catch (e) {}
      return this.user;
    }
    disconnect() {
      if (this.native) { try { root.SaySaveAndroid.signOut(); } catch (e) {} }
      else try { if (this.token) google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) {}
      this.token = null; this.user = null; this.cache = null; store('saysave.gUser', null); store('saysave.gToken', null);
    }
    async ensureToken() {
      if (!this.client) await this.init();
      if (this.token && Date.now() < this.expires) return this.token;
      let t = null;
      // already signed in before? ask Google silently for your account — no account list
      if ((this.user && this.user.email) || this.native) { try { t = await this.requestToken('none'); } catch (e) { t = null; } }
      if (!t) t = await this.requestToken('');
      if (this.user && !this.user.email) {  // older sign-ins: learn the email once so the chooser is skipped next time
        try { const a = await this.api('/about?fields=user(displayName,emailAddress)'); this.user = { name: a.user.displayName, email: a.user.emailAddress }; store('saysave.gUser', this.user); } catch (e) {}
      }
      return t;
    }
    async api(path, opts, isUpload) {
      opts = opts || {};
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await this.ensureToken();
        const r = await fetch((isUpload ? UPLOAD : API) + path, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
        if (r.status === 401 && attempt === 0) { this.token = null; store('saysave.gToken', null); continue; }
        if (!r.ok) {
          let msg = r.status + ' ' + r.statusText;
          try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch (e) {}
          throw new Error('Google Drive: ' + msg);
        }
        if (opts.raw) return r;
        return r.status === 204 ? null : r.json();
      }
    }
    async getIndex(force) {
      if (this.cache && !force) return this.cache;
      if (!this.rootId) this.rootId = (await this.api('/files/root?fields=id')).id;
      const folders = []; let pageToken = '';
      const q = encodeURIComponent(`mimeType='${FOLDER}' and trashed=false and 'me' in owners`);
      do {
        const j = await this.api(`/files?q=${q}&fields=nextPageToken,files(id,name,parents)&pageSize=1000&spaces=drive${pageToken ? '&pageToken=' + pageToken : ''}`);
        for (const f of j.files) folders.push({ id: f.id, name: f.name, parentId: (f.parents && f.parents[0]) || this.rootId });
        pageToken = j.nextPageToken || '';
      } while (pageToken && folders.length < 5000);
      this.cache = { rootId: this.rootId, folders };
      return this.cache;
    }
    async createFolder(name, parentId) {
      const j = await this.api('/files?fields=id,name,parents', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId || this.rootId] }) });
      const f = { id: j.id, name: j.name, parentId: parentId || this.rootId };
      if (this.cache) this.cache.folders.push(f);
      return f;
    }
    async upload(file, name, folderId) {
      const meta = { name, parents: [folderId] };
      const type = file.type || 'application/octet-stream';
      if (file.size <= 5 * 1024 * 1024) {
        const b = 'saysave' + Date.now();
        const body = new Blob([
          `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`,
          file, `\r\n--${b}--`]);
        const j = await this.api('/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body }, true);
        return { id: j.id, link: j.webViewLink };
      }
      // big files: resumable upload
      const r = await this.api('/files?uploadType=resumable&fields=id,webViewLink', { method: 'POST', raw: true,
        headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(file.size) },
        body: JSON.stringify(meta) }, true);
      const loc = r.headers.get('Location');
      if (!loc) throw new Error('Google Drive did not return an upload address.');
      const put = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
      if (!put.ok) throw new Error('Upload failed (' + put.status + ')');
      const j = await put.json();
      return { id: j.id, link: j.webViewLink };
    }
    async trash(id) {
      await this.api('/files/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      if (this.cache) this.cache.folders = this.cache.folders.filter(f => f.id !== id);
    }
    async listFiles(scope) {
      if (!this.rootId) this.rootId = (await this.api('/files/root?fields=id')).id;
      const parts = [`mimeType!='${FOLDER}'`, 'trashed=false', "'me' in owners"];
      if (scope !== 'all') parts.push(`'${this.rootId}' in parents`);
      const q = encodeURIComponent(parts.join(' and '));
      const out = []; let pageToken = '';
      do {
        const j = await this.api(`/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,parents,shared)&pageSize=500${pageToken ? '&pageToken=' + pageToken : ''}`);
        for (const f of j.files) if (!f.shared) out.push(f);
        pageToken = j.nextPageToken || '';
      } while (pageToken && out.length < 1000);
      return out;
    }
    async move(id, toId, fromIds) {
      const rm = (fromIds || []).join(',');
      await this.api(`/files/${id}?addParents=${toId}${rm ? '&removeParents=' + rm : ''}&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    }
    async childCount(folderId) {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
      const j = await this.api(`/files?q=${q}&fields=files(id)&pageSize=2`);
      return j.files.length;
    }
    // Where do files with similar names already live? Returns {folderId: count}
    async findSimilar(words) {
      const out = {}; if (!words || !words.length) return out;
      const terms = words.map(w => `name contains '${w.replace(/['\\]/g, '')}'`).join(' or ');
      const q = encodeURIComponent(`(${terms}) and mimeType!='${FOLDER}' and trashed=false`);
      const j = await this.api(`/files?q=${q}&fields=files(parents)&pageSize=50&spaces=drive`);
      for (const f of j.files || []) for (const p of (f.parents || [])) out[p] = (out[p] || 0) + 1;
      return out;
    }
    folderLink(id) { return 'https://drive.google.com/drive/folders/' + id; }
  }

  root.SaySaveDrive = { DemoDrive, GoogleDrive, store, inPreview, PREVIEW_MSG, NATIVE, nativeCall };
})(this);
