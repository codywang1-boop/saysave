/* SaySave app UI */
(function () {
  'use strict';
  const L = window.SaySaveLogic, D = window.SaySaveDrive;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NATIVE = !!window.SaySaveAndroid;   // running inside the SaySave Android app
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

  // ---------- Settings & state ----------
  const DEFAULTS = {
    mode: NATIVE ? 'google' : 'demo', clientId: '298247101034-012g0354ohl99thg8mg9401sb33aag6u.apps.googleusercontent.com',
    triggers: ['Save to my Google Drive', 'Find the right place'],
    shortcuts: [{ phrase: 'tax folder', path: 'Taxes/{year}', skip: false }],
    confirmWords: 'yes, ok, okay, yeah, sure, do it, save it, confirm',
    cancelWords: 'cancel, no, stop, never mind',
    rename: true, autoCreate: false, autoListen: true, speak: false, readContent: true, autoSuggest: true, ocr: true, scanMode: 'doc', homePath: ''
  };
  let S = Object.assign({}, DEFAULTS, D.store('saysave.settings') || {});
  if (!S.clientId) S.clientId = DEFAULTS.clientId;
  const saveS = () => D.store('saysave.settings', S);
  let recent = D.store('saysave.recent') || [];
  let rules = D.store('saysave.rules') || {};
  let votes = D.store('saysave.votes') || {};
  let orgLog = D.store('saysave.orgLog') || null;
  const saveRecent = () => D.store('saysave.recent', recent.slice(0, 30));

  // one Google client, loaded at startup so the sign-in popup opens instantly on tap
  let gdrive = new D.GoogleDrive(S.clientId);
  if (S.clientId && !D.inPreview()) gdrive.init().catch(() => {});
  let drive = makeDrive();
  function makeDrive() {
    if (S.mode !== 'google') return new D.DemoDrive();
    if (gdrive.clientId !== S.clientId) { gdrive = new D.GoogleDrive(S.clientId); if (S.clientId && !D.inPreview()) gdrive.init().catch(() => {}); }
    return gdrive;
  }

  const cmdSettings = () => ({ triggers: S.triggers, shortcuts: S.shortcuts, confirmWords: list(S.confirmWords), cancelWords: list(S.cancelWords) });

  async function getIndex(force) { const ix = await drive.getIndex(force); return L.buildIndex(ix.folders, ix.rootId); }
  function warmToken() { if (!drive.isDemo && drive.client && !(drive.token && Date.now() < drive.expires)) drive.ensureToken().catch(() => {}); }

  // ---------- Speech ----------
  // Android app: use the phone's speech recognizer through the bridge, with the same interface as the browser's
  class NativeSR {
    start() {
      NativeSR.cur = this;
      window.__nativeSpeech = (type, text) => {
        const me = NativeSR.cur; if (!me) return;
        if (type === 'interim' || type === 'final') me.onresult && me.onresult({ results: [Object.assign([{ transcript: text }], { isFinal: type === 'final' })] });
        else if (type === 'error') me.onerror && me.onerror({ error: text });
        else if (type === 'end') { NativeSR.cur = null; me.onend && me.onend(); }
      };
      window.SaySaveAndroid.startSpeech();
    }
    abort() { if (NativeSR.cur === this) { NativeSR.cur = null; window.SaySaveAndroid.stopSpeech(); } }
    stop() { this.abort(); }
  }
  const SR = NATIVE ? NativeSR : (window.SpeechRecognition || window.webkitSpeechRecognition);
  let activeRec = null;
  function listen(h) {
    stopListening();
    if (!SR) { h.onError && h.onError('unsupported'); return; }
    const r = new SR(); activeRec = r;
    r.lang = navigator.language || 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let last = '', final = '';
    r.onresult = e => { let t = ''; for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) final = t; } last = t; h.onInterim && h.onInterim(t); };
    r.onerror = e => { h.onError && h.onError(e.error); };
    r.onend = () => { if (activeRec === r) activeRec = null; h.onEnd && h.onEnd(final || last); };
    try { r.start(); h.onStart && h.onStart(); } catch (e) { h.onError && h.onError('start-failed'); }
  }
  function stopListening() { if (activeRec) { const r = activeRec; activeRec = null; r.onend = null; try { r.abort(); } catch (e) {} } }
  function say(text) { if (!S.speak || !window.speechSynthesis) return; try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {} }
  const micErrorText = err => ({
    'not-allowed': 'Microphone is blocked here. Allow mic access, or type your command below.',
    'service-not-allowed': 'Microphone is blocked here. Type your command below.',
    'unsupported': 'Voice isn\'t supported in this browser. Type your command below.',
    'no-speech': 'I didn\'t hear anything. Tap the mic and try again.',
    'audio-capture': 'No microphone found. Type your command below.',
    'network': 'Voice needs an internet connection. Type your command below.'
  }[err] || 'Voice stopped. Tap the mic to try again, or type below.');

  // ---------- Icons ----------
  const ICON = {
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    folder: '<svg class="folder-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4.2l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" opacity=".85"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>',
    chevDown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>'
  };
  function fileBadge(name, type) {
    const ext = (L.splitExt(name).ext || '').slice(1).toUpperCase();
    let cls = 'other';
    if (/pdf/i.test(type) || ext === 'PDF') cls = '';
    else if (/^image\//.test(type) || /^(JPG|JPEG|PNG|HEIC|GIF|WEBP)$/.test(ext)) cls = 'img';
    else if (/(word|text|document|sheet)/i.test(type) || /^(DOC|DOCX|TXT|XLS|XLSX|CSV|RTF)$/.test(ext)) cls = 'doc';
    return `<div class="fileicon ${cls}">${esc((ext || 'FILE').slice(0, 4))}</div>`;
  }
  function pathHtml(path, newSegs) {
    const n = (newSegs || []).length, segs = path || [];
    let h = '<div class="path"><span class="seg">My Drive</span>';
    segs.forEach((s, i) => { h += `<span class="sep">›</span><span class="seg ${i >= segs.length - n ? 'new' : ''}">${esc(s)}</span>`; });
    return h + '</div>';
  }
  const pathText = p => ['My Drive'].concat(p || []).join(' › ');
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(t).toLocaleDateString();
  }

  // ---------- Layer helpers (sheet / modal / toast) ----------
  const layer = $('#layer');
  const layerStack = [];
  // Android back button: close the top sheet, else go back to the Save tab, else leave the app
  window.__saysaveBack = () => {
    if (layerStack.length) { layerStack[layerStack.length - 1](); return true; }
    if (tab !== 'home') { go('home'); return true; }
    return false;
  };
  function openLayer(html, opts) {
    opts = opts || {};
    const wrap = document.createElement('div');
    wrap.className = 'scrim' + (opts.center ? ' center' : '');
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${opts.center ? '' : '<div class="grabber"></div>'}${html}</div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap && opts.dismiss !== false) close(); });
    layer.appendChild(wrap);
    function close() { const i = layerStack.indexOf(close); if (i >= 0) layerStack.splice(i, 1); if (wrap.parentNode) wrap.remove(); opts.onClose && opts.onClose(); }
    layerStack.push(close);
    return { el: wrap.firstChild, close, wrap };
  }
  let toastTimer;
  function toast(html, actions, ms) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div'); t.className = 'toast';
    t.innerHTML = `<div class="grow">${html}</div>`;
    (actions || []).forEach(a => {
      if (a.href) { const el = document.createElement('a'); el.href = a.href; el.target = '_blank'; el.rel = 'noopener'; el.textContent = a.label; t.appendChild(el); }
      else { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = a.label; b.onclick = () => { t.remove(); a.onClick(); }; t.appendChild(b); }
    });
    document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), ms || 7000);
  }
  const errToast = e => toast('⚠️ ' + esc(e && e.message ? e.message : e), [], 8000);
  function ask(title, body, okLabel, onOk, cancelLabel) {
    const m = openLayer(`<h3>${esc(title)}</h3><p class="muted">${body}</p><div class="row end" style="margin-top:16px">
      <button class="btn ghost" data-a="no">${esc(cancelLabel || 'Cancel')}</button><button class="btn" data-a="ok">${esc(okLabel)}</button></div>`, { center: true });
    m.el.querySelector('[data-a=no]').onclick = m.close;
    m.el.querySelector('[data-a=ok]').onclick = () => { m.close(); onOk(); };
  }

  // ---------- Tabs ----------
  let tab = 'home';
  $$('.tab').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#modePill').onclick = () => go('setup');
  function go(t) { tab = t; $$('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); render(); window.scrollTo(0, 0); }
  function render() {
    const pill = $('#modePill');
    pill.textContent = drive.isDemo ? 'Demo Drive' : (drive.isConnected() ? 'Google Drive' : 'Google · not connected');
    pill.classList.toggle('demo', drive.isDemo || !drive.isConnected());
    ({ home: renderHome, commands: renderCommands, organize: renderOrganize, setup: renderSetup })[tab]();
  }

  // ================= HOME =================
  function renderHome() {
    const v = $('#view');
    const needConnect = !drive.isDemo && !drive.isConnected();
    v.innerHTML = `
      ${drive.isDemo ? `<div class="banner"><div>🧪</div><div class="grow"><b>Demo mode — practice only.</b> Files go to a pretend Drive, not your real one.<div style="margin-top:8px"><button class="btn sm" id="useGoogle">Connect my Google Drive</button></div></div></div>` : ''}
      ${needConnect ? `<div class="banner"><div>🔗</div><div class="grow"><b>Google Drive isn't connected yet.</b><div class="small muted">Tap Connect and choose your Google account. Just looking around? Try the practice Demo Drive.</div>
        <div class="row" style="margin-top:8px"><button class="btn sm" id="connectNow">Connect</button><button class="btn ghost sm" id="useDemo">Try Demo</button></div></div></div>` : ''}
      <section class="card hero">
        <button class="mic" id="heroMic" aria-label="Choose a file, then speak">${ICON.mic}</button>
        <h1>Scan or pick. Say where.</h1>
        <p>Say <b>“${esc(S.triggers[0] || 'Save to my Google Drive')}”</b> and SaySave finds the right folder.</p>
        <div class="row" style="margin-top:18px;align-items:stretch">
          <div class="grow" style="display:flex;flex-direction:column;gap:6px">
            <button class="btn" id="scanDoc" style="min-height:52px">📷 Scan document</button>
            <div class="small muted" style="text-align:left">Photograph paper pages. They're saved together as <b>one PDF</b>. Best for bills, forms, receipts.</div>
          </div>
          <div class="grow" style="display:flex;flex-direction:column;gap:6px">
            <button class="btn secondary" id="chooseFile" style="min-height:52px">📄 Choose file</button>
            <div class="small muted" style="text-align:left">Pick any file, or take a new <b>photo or video</b>. Saved <b>as-is</b> (JPG, MP4, PDF, Word…).</div>
          </div>
        </div>
        <div class="drop" id="drop">${NATIVE ? 'Tip: in Gmail, Files, Photos or any app, tap <b>Share → SaySave</b>.' : '…or drop files here. On Android, use <b>Share → SaySave</b> from any app.'}</div>
      </section>
      <h2>Recent filings</h2>
      <section class="card">${recent.length ? `<ul class="list">${recent.slice(0, 12).map((r, i) => `
        <li>${fileBadge(r.name, r.type || '')}<div class="grow"><div class="filename">${esc(r.name)}</div>
          <div class="muted small">${esc(pathText(r.path))} · ${ago(r.time)}${r.mode === 'demo' ? ' · demo' : ''}</div></div>
          ${r.link ? `<a class="btn ghost sm" href="${esc(r.link)}" target="_blank" rel="noopener">Open</a>` : ''}
          <button class="btn ghost sm" data-undo="${i}">Undo</button></li>`).join('')}</ul>`
        : '<div class="empty">Nothing filed yet. Your saved files will show up here with an Undo button.</div>'}</section>`;
    $$('[data-go]', v).forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.go); });
    const cn = $('#connectNow', v); if (cn) cn.onclick = connectGoogle;
    const ud = $('#useDemo', v); if (ud) ud.onclick = () => { S.mode = 'demo'; saveS(); drive = makeDrive(); render(); };
    const ug = $('#useGoogle', v); if (ug) ug.onclick = () => { S.mode = 'google'; saveS(); drive = makeDrive(); connectGoogle(); };
    $('#chooseFile', v).onclick = () => { warmToken(); $('#filePick').click(); };
    $('#scanDoc', v).onclick = () => { warmToken(); openScanner(); };
    $('#heroMic', v).onclick = () => { warmToken(); $('#filePick').click(); };
    const drop = $('#drop', v);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); enqueue(Array.from(e.dataTransfer.files)); };
    $$('[data-undo]', v).forEach(b => b.onclick = () => undoSave(+b.dataset.undo));
  }

  $('#filePick').onchange = e => { enqueue(Array.from(e.target.files)); e.target.value = ''; };

  async function undoSave(i) {
    const r = recent[i]; if (!r) return;
    if ((r.mode === 'demo') !== drive.isDemo) return errToast('Switch to ' + (r.mode === 'demo' ? 'Demo' : 'Google') + ' mode to undo this one.');
    try {
      await drive.trash(r.id);
      for (const fid of (r.created || []).slice().reverse()) { if (await drive.childCount(fid) === 0) await drive.trash(fid); }
      recent.splice(i, 1); saveRecent(); render();
      toast('↩️ Undone. ' + esc(r.name) + (drive.isDemo ? ' was removed.' : ' was moved to your Drive trash.'));
    } catch (e) { errToast(e); }
  }

  // ================= SAVE FLOW =================
  const queue = []; let busy = false;
  function enqueue(files) { files.filter(Boolean).forEach(f => queue.push(f)); next(); }
  function next() { if (busy || !queue.length) return; busy = true; openFileSheet(queue.shift()); }

  async function readText(file) {
    try {
      if (/^text\//.test(file.type) || /\.(txt|csv|md)$/i.test(file.name)) return (await file.text()).slice(0, 6000);
      if (/pdf/i.test(file.type) || /\.pdf$/i.test(file.name)) {
        if (!window.pdfjsLib) {
          await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let out = '';
        for (let p = 1; p <= Math.min(2, pdf.numPages); p++) { const c = await (await pdf.getPage(p)).getTextContent(); out += c.items.map(i => i.str).join(' ') + ' '; }
        return out.slice(0, 6000);
      }
    } catch (e) { /* unreadable – fall back to name only */ }
    return '';
  }

  function openFileSheet(file) {
    const st = { file, text: null, plan: null, msg: '', listening: false, saving: false };
    const sh = openLayer('<div id="fs"></div>', { onClose: () => { stopListening(); busy = false; setTimeout(next, 150); } });
    const box = $('#fs', sh.el);
    let textPromise = null;
    function getText() {
      if (!textPromise) textPromise = file.ocrText != null ? Promise.resolve(file.ocrText)
        : (S.readContent && L.isMeaninglessName(file.name)) ? readText(file) : Promise.resolve('');
      return textPromise;
    }
    getText();

    function draw() {
      const needConnect = !drive.isDemo && !drive.isConnected();
      box.innerHTML = `
        <div class="sheet-h"><h3>${st.plan ? 'Ready to save' : 'Where should it go?'}</h3><button class="x" data-a="close" aria-label="Close">✕</button></div>
        <div class="filechip">${fileBadge(file.name, file.type)}<div class="grow"><div class="filename">${esc(file.name)}</div>
          <div class="muted small">${fmtSize(file.size || 0)}${queue.length ? ` · ${queue.length} more waiting` : ''}</div></div></div>
        ${needConnect ? `<div class="banner" style="margin-top:14px"><div class="grow">Connect Google Drive to save this file.</div><button class="btn sm" data-a="connect">Connect</button></div>` : ''}
        <div id="planBox">${st.plan ? planHtml() : listenHtml()}</div>`;
      $('[data-a=close]', box).onclick = sh.close;
      const c = $('[data-a=connect]', box); if (c) c.onclick = async () => { await connectGoogle(); draw(); };
      st.plan ? bindPlan() : bindListen();
    }

    function listenHtml() {
      return `
        <div style="text-align:center;margin-top:14px">
          <button class="mic ${st.listening ? 'listening' : ''}" data-a="mic" aria-label="Speak a command">${ICON.mic}</button>
          <div class="transcript ${st.heard ? '' : 'hint'}" id="heard">${esc(st.heard || (st.listening ? 'Listening…' : 'Tap the mic and say a command'))}</div>
          ${st.msg ? `<div class="muted small" style="margin-bottom:6px">${st.msg}</div>` : ''}
          <div class="chips">
            <button class="chip primary" data-cmd="${esc(S.triggers[0] || 'Save to my Google Drive')}">${esc(S.triggers[0] || 'Save to my Google Drive')}</button>
            ${S.shortcuts.slice(0, 6).map(sc => `<button class="chip" data-cmd="${esc(sc.phrase)}">${esc(sc.phrase)}</button>`).join('')}
            <button class="chip" data-a="pick">Choose folder…</button>
          </div>
        </div>
        <form class="row" data-a="form" style="margin-top:16px"><input type="text" id="typed" placeholder="Or type: save this to my tax folder" autocomplete="off"><button class="btn sm" type="submit">Go</button></form>`;
    }
    function bindListen() {
      $('[data-a=mic]', box).onclick = () => { warmToken(); st.listening ? (stopListening(), st.listening = false, draw()) : startListening(); };
      $$('[data-cmd]', box).forEach(b => b.onclick = () => { warmToken(); handle(b.dataset.cmd); });
      $('[data-a=pick]', box).onclick = () => { warmToken(); pickFolder(); };
      $('[data-a=form]', box).onsubmit = e => { e.preventDefault(); warmToken(); const v = $('#typed', box).value.trim(); if (v) handle(v); };
    }
    function startListening(forConfirm) {
      st.listening = true; st.heard = ''; st.msg = ''; if (!forConfirm) draw(); else updateConfirmMic();
      listen({
        onInterim: t => { st.heard = t; const el = $('#heard', box); if (el) { el.textContent = t; el.classList.remove('hint'); } },
        onError: err => { st.listening = false; if (err === 'aborted') return; st.msg = esc(micErrorText(err)); forConfirm ? updateConfirmMic() : draw(); },
        onEnd: t => { st.listening = false; if (t) handle(t); else forConfirm ? updateConfirmMic() : draw(); }
      });
    }
    function updateConfirmMic() {
      const m = $('[data-a=cmic]', box); if (m) m.classList.toggle('listening', st.listening);
      const h = $('#heard', box); if (h) h.textContent = st.listening ? 'Listening… say “yes” or “cancel”' : (st.msg ? '' : 'Say “yes” to save or “cancel”');
      const e = $('#cmsg', box); if (e) e.innerHTML = st.msg || '';
    }

    async function handle(text) {
      st.heard = text;
      const cmd = L.parseCommand(text, cmdSettings());
      if (st.plan) {
        if (cmd.type === 'confirm') return doSave();
        if (cmd.type === 'cancel') { say('Cancelled'); return sh.close(); }
        st.plan = null; // a new command replaces the plan
      }
      if (cmd.type === 'cancel') { say('Cancelled'); return sh.close(); }
      if (cmd.type === 'confirm') { st.msg = 'Tell me where first — for example “' + esc(S.triggers[0]) + '”.'; return draw(); }
      if (!drive.isDemo && !drive.isConnected()) { st.msg = 'Connect Google Drive first.'; return draw(); }
      st.msg = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> Finding the right folder…'; draw();
      try {
        const index = await getIndex();
        const text2 = await getText();
        if (cmd.type === 'auto' && !st.similar) st.similar = await drive.findSimilar(L.keyWords(file.name)).catch(() => ({}));
        if (cmd.type === 'auto') st.plan = planAuto(index, text2);
        else if (cmd.type === 'shortcut') st.plan = planShortcut(index, cmd.shortcut, text2);
        else if (cmd.type === 'folder') st.plan = planFolder(index, cmd.query, text2);
        else {
          st.msg = cmd.guess
            ? `Did you mean <button class="chip primary" data-cmd="${esc(cmd.guess.type === 'shortcut' ? cmd.guess.shortcut.phrase : (cmd.guess.trigger || S.triggers[0]))}">${esc(cmd.guess.type === 'shortcut' ? cmd.guess.shortcut.phrase : (cmd.guess.trigger || S.triggers[0]))}</button>?`
            : `I didn't catch a command. Try “${esc(S.triggers[0])}” or “save this to my tax folder”.`;
          return draw();
        }
        st.msg = '';
        if (st.plan.kind === 'new' && st.plan.auto && S.autoCreate) return doSave();
        if (st.plan.skip) return doSave();
        draw();
        say(st.plan.kind === 'new' ? 'No matching folder. Create ' + st.plan.proposal.path.join(' ') + '?' : 'Save to ' + (st.plan.choices[st.plan.sel].path.slice(-1)[0] || 'My Drive') + '?');
        if (S.autoListen && SR) setTimeout(() => { if (st.plan && !st.saving && box.isConnected) startListening(true); }, S.speak ? 1800 : 300);
      } catch (e) { st.msg = '⚠️ ' + esc(e.message || e); draw(); }
    }

    function baseName(sugg) { return S.rename && sugg ? sugg : file.name; }
    function resolveNew(index, segs) {
      // apply "new folder location" for brand-new top-level folders
      const home = L.expandPath(S.homePath || '');
      let parentId = index.rootId, i = 0;
      const full = segs;
      for (; i < full.length; i++) { const f = index.childNamed(parentId, full[i]); if (!f) break; parentId = f.id; }
      if (i === 0 && home.length) {
        const all = home.concat(full); parentId = index.rootId; i = 0;
        for (; i < all.length; i++) { const f = index.childNamed(parentId, all[i]); if (!f) break; parentId = f.id; }
        return { path: all, parentId, newSegments: all.slice(i) };
      }
      return { path: full, parentId, newSegments: full.slice(i) };
    }
    function planAuto(index, text) {
      const s = L.suggest(index, { name: file.name, text, mimeType: file.type }, { rules, similar: st.similar });
      const reason = s.usedContent ? 'The file name was unclear, so I read the document.' :
        s.category ? `Looks like <b>${esc(s.category)}</b>${s.year && (L.CATEGORIES.find(c => c.id === s.categoryId) || {}).yearly ? ' from ' + s.year : ''}, based on the file name.` : 'I couldn\'t tell what this is from the name.';
      if (s.confidence === 'none') {
        const p = resolveNew(index, s.proposal.path);
        return { kind: 'new', auto: true, proposal: p, editPath: p.path.join('/'), name: baseName(s.suggestedName), reason, categoryId: s.categoryId, top: null };
      }
      const plan = { kind: 'existing', choices: s.choices, sel: 0, name: baseName(s.suggestedName), reason, categoryId: s.categoryId, top: s.choices[0], confidence: s.confidence };
      if (s.proposal && s.choices[0].missingYear) { plan.yearProposal = s.proposal; }
      return plan;
    }
    function planShortcut(index, sc, text) {
      const year = L.findYear(file.name) || L.findYear(text) || new Date().getFullYear();
      const segs = L.expandPath(sc.path, year);
      const f = index.findByPath(segs);
      const s = L.suggest(index, { name: file.name, text, mimeType: file.type }, {});
      const name = baseName(s.suggestedName);
      if (f) return { kind: 'existing', choices: [{ folderId: f.id, path: index.pathOf(f.id) }], sel: 0, name, reason: `Shortcut “${esc(sc.phrase)}”.`, skip: !!sc.skip };
      const p = resolveNew(index, segs);
      return { kind: 'new', proposal: p, editPath: p.path.join('/'), name, reason: `Shortcut “${esc(sc.phrase)}” — that folder doesn't exist yet.` };
    }
    function planFolder(index, query, text) {
      const hits = L.searchFolders(index, query);
      const s = L.suggest(index, { name: file.name, text, mimeType: file.type }, {});
      const name = baseName(s.suggestedName);
      if (hits.length) {
        // within the chosen folder, use a year subfolder when one matches
        const choices = hits.slice(0, 3).map(h => {
          const sub = s.year ? index.childNamed(h.folderId, String(s.year)) : null;
          return sub ? { folderId: sub.id, path: index.pathOf(sub.id) } : { folderId: h.folderId, path: h.path };
        });
        return { kind: 'existing', choices, sel: 0, name, reason: `You said “${esc(query)}”.` };
      }
      const title = query.replace(/\b\w/g, c => c.toUpperCase());
      const p = resolveNew(index, [title]);
      return { kind: 'new', proposal: p, editPath: p.path.join('/'), name, reason: `No folder called “${esc(query)}” yet.` };
    }

    function planHtml() {
      const p = st.plan;
      let where;
      if (p.kind === 'new') {
        where = `<div class="banner" style="margin:14px 0 4px"><div>📁</div><div><b>No matching folder found.</b> Create a new one? ${p.reason ? '<br><span class="muted small">' + p.reason + '</span>' : ''}</div></div>
          ${pathHtml(p.proposal.path, p.proposal.newSegments)}
          <label class="field">New folder (use / for subfolders)<input type="text" id="newPath" value="${esc(p.editPath)}"></label>`;
      } else {
        const c = p.choices;
        where = (p.suggested ? `<div style="margin:14px 0 2px;font-weight:700">${c.length > 1 ? 'Suggested folders' : 'Suggested folder'}</div>` : '') +
          `<div class="muted small" style="margin:${p.suggested ? '0' : '14px'} 0 8px">${p.reason || ''}${p.suggested ? ' Not right? Say another folder, or tap Change folder.' : ''}</div>` +
          (c.length > 1 ? c.map((x, i) => `<button class="choice ${i === p.sel ? 'sel' : ''}" data-sel="${i}"><input type="radio" ${i === p.sel ? 'checked' : ''} tabindex="-1">${pathHtml(x.path)}</button>`).join('')
            : pathHtml(c[0].path)) +
          (p.yearProposal ? `<button class="btn ghost sm" data-a="yearSub" style="margin-top:6px">+ Put it in a new “${esc(p.yearProposal.newSegments[0])}” subfolder</button>` : '');
      }
      return `${where}
        <label class="field">File name<input type="text" id="fname" value="${esc(p.name)}"></label>
        <div class="row" style="margin-top:16px">
          <button class="btn block" data-a="save">${p.kind === 'new' ? 'Create folder & Save' : 'Save'}</button>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn secondary grow" data-a="pick">Change folder</button>
          <button class="btn ghost" data-a="back">Back</button>
        </div>
        ${SR ? `<div class="row" style="margin-top:14px;justify-content:center;gap:12px"><button class="mic sm ${st.listening ? 'listening' : ''}" data-a="cmic" aria-label="Answer by voice">${ICON.mic}</button>
          <div class="muted small" id="heard">${st.listening ? 'Listening… say “yes” or “cancel”' : 'Say “yes” to save or “cancel”'}</div></div><div class="muted small" id="cmsg" style="text-align:center">${st.msg || ''}</div>` : ''}`;
    }
    function bindPlan() {
      const p = st.plan;
      $$('[data-sel]', box).forEach(b => b.onclick = () => { p.sel = +b.dataset.sel; draw(); });
      const np = $('#newPath', box);
      if (np) np.oninput = async () => {
        p.editPath = np.value;
        const index = await getIndex();
        p.proposal = resolveNew(index, L.expandPath(np.value));
        const ph = $('.path', box); if (ph) ph.outerHTML = pathHtml(p.proposal.path, p.proposal.newSegments);
      };
      $('#fname', box).oninput = e => { p.name = e.target.value; };
      $('[data-a=save]', box).onclick = () => { warmToken(); doSave(); };
      $('[data-a=pick]', box).onclick = () => pickFolder();
      $('[data-a=back]', box).onclick = () => { stopListening(); st.plan = null; st.heard = ''; draw(); };
      const ys = $('[data-a=yearSub]', box);
      if (ys) ys.onclick = () => { const yp = p.yearProposal; st.plan = { kind: 'new', proposal: { path: yp.path, parentId: yp.parentId, newSegments: yp.newSegments }, editPath: yp.path.join('/'), name: p.name, reason: '', categoryId: p.categoryId }; draw(); };
      const cm = $('[data-a=cmic]', box);
      if (cm) cm.onclick = () => { warmToken(); st.listening ? (stopListening(), st.listening = false, updateConfirmMic()) : startListening(true); };
    }

    function pickFolder() {
      stopListening(); st.listening = false;
      openPicker('Choose a folder', async (choice) => {
        const prevTop = st.plan && st.plan.top;
        const catId = st.plan && st.plan.categoryId;
        let name = st.plan ? st.plan.name : null;
        if (!name) { const index = await getIndex(); const s = L.suggest(index, { name: file.name, text: await getText(), mimeType: file.type }, {}); name = baseName(s.suggestedName); }
        st.plan = { kind: 'existing', choices: [choice], sel: 0, name, reason: 'You picked this folder.', categoryId: catId, top: prevTop, manual: true };
        draw();
      });
    }

    async function doSave() {
      if (st.saving) return; const p = st.plan; if (!p) return;
      stopListening(); st.listening = false; st.saving = true;
      const fname = (p.name || file.name).trim() || file.name;
      $('#planBox', box).innerHTML = `<div style="text-align:center;padding:30px 0"><div class="spinner" style="margin:0 auto 12px"></div><div class="muted">Saving to ${esc(drive.label)}…</div></div>`;
      try {
        let folderId, path, created = [];
        if (p.kind === 'new') {
          const index = await getIndex();
          const segs = L.expandPath(p.editPath || p.proposal.path.join('/'));
          const r = await ensurePath(index, segs);
          folderId = r.folderId; path = segs; created = r.created;
        } else {
          const c = p.choices[p.sel]; folderId = c.folderId; path = c.path;
        }
        const up = await drive.upload(file, fname, folderId);
        // learn from corrections
        if (p.categoryId && (p.manual || p.sel > 0) && p.top) learn(p.categoryId, path);
        recent.unshift({ id: up.id, name: fname, type: file.type, path, folderId, link: up.link || null, time: Date.now(), created, mode: drive.isDemo ? 'demo' : 'google' });
        saveRecent();
        toast(`✅ Saved to <b>${drive.isDemo ? 'Demo Drive › ' : ''}${esc(path.length ? path.slice(-2).join(' › ') : 'My Drive')}</b>${drive.isDemo ? ' <span class="muted">(practice only — not your real Drive)</span>' : ''}`, [
          ...(drive.folderLink(folderId) ? [{ label: 'Open', href: drive.folderLink(folderId) }] : []),
          { label: 'Undo', onClick: () => undoSave(recent.findIndex(r => r.id === up.id)) }
        ]);
        say('Saved to ' + (path.slice(-1)[0] || 'My Drive'));
        sh.close(); if (tab === 'home') render();
      } catch (e) { st.saving = false; st.msg = '⚠️ ' + esc(e.message || e); draw(); }
    }

    async function autoSuggest() {
      st.msg = '<span class="spinner" style="display:inline-block;vertical-align:middle"></span> Looking through your Drive for the right folder…'; draw();
      try {
        const index = await getIndex();
        const text = await getText();
        st.similar = await drive.findSimilar(L.keyWords(file.name)).catch(() => ({}));
        if (!box.isConnected || st.plan) return;
        st.plan = planAuto(index, text); st.plan.suggested = true; st.msg = '';
        draw();
        say(st.plan.kind === 'new' ? 'No matching folder. Create one?' : 'Save to ' + (st.plan.choices[0].path.slice(-1)[0] || 'My Drive') + '?');
        if (S.autoListen && SR) setTimeout(() => { if (st.plan && !st.saving && box.isConnected) startListening(true); }, S.speak ? 1800 : 300);
      } catch (e) { st.msg = '⚠️ ' + esc(e.message || e); draw(); if (S.autoListen && SR) startListening(); }
    }

    draw();
    if (S.autoSuggest && (drive.isDemo || drive.isConnected())) autoSuggest();
    else if (S.autoListen && SR) startListening();
  }

  // ================= SCANNER =================
  async function nativeScan() {
    let r;
    try { r = await D.nativeCall('scanDocument'); } catch (e) { return errToast(e); }
    if (r.cancelled) return;
    if (r.error) return errToast(r.error);
    const busyToast = () => toast('<span class="spinner" style="display:inline-block;vertical-align:middle"></span> Reading your scan…', [], 60000);
    busyToast();
    try {
      const pdfBlob = await (await fetch(r.pdf.url)).blob();
      let text = '';
      if (S.ocr && r.pages && r.pages.length) {
        try {
          const canvases = [];
          for (const pg of r.pages) {
            const bmp = await createImageBitmap(await (await fetch(pg.url)).blob());
            const sc = Math.min(1, 1700 / Math.max(bmp.width, bmp.height));
            const c = document.createElement('canvas'); c.width = bmp.width * sc; c.height = bmp.height * sc;
            c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); canvases.push(c);
          }
          text = await window.SaySaveScan.readText(canvases);
        } catch (e) { text = ''; }
      }
      $$('.toast').forEach(t => t.remove());
      const file = new File([pdfBlob], `Scan ${new Date().toISOString().slice(0, 10)}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
      file.ocrText = text;
      enqueue([file]);
    } catch (e) { $$('.toast').forEach(t => t.remove()); errToast(e); }
  }

  function openScanner() {
    if (NATIVE) return nativeScan();
    const SC = window.SaySaveScan;
    const pages = []; let busyScan = false;
    const cam = $('#camPick');
    const sh = openLayer('<div id="sc"></div>', { onClose: () => { cam.onchange = null; } });
    const box = $('#sc', sh.el);
    cam.onchange = async e => {
      const f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { const img = await SC.loadImage(f); pages.push({ img, rot: 0, mode: S.scanMode, thumb: null }); draw(); }
      catch (err) { errToast('Could not open that photo.'); }
    };
    function thumb(pg) {
      if (pg.thumb && pg.thumbKey === pg.rot + pg.mode) return pg.thumb;
      const c = SC.render(pg); const t = document.createElement('canvas');
      const s = 220 / Math.max(c.width, c.height); t.width = c.width * s; t.height = c.height * s;
      t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
      pg.thumb = t.toDataURL('image/jpeg', 0.7); pg.thumbKey = pg.rot + pg.mode; return pg.thumb;
    }
    function draw(status) {
      box.innerHTML = `
        <div class="sheet-h"><h3>Scan a document</h3><button class="x" data-a="close">✕</button></div>
        ${pages.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          ${pages.map((pg, i) => `<div style="position:relative;background:var(--bg);border-radius:12px;padding:6px;text-align:center">
            <img src="${thumb(pg)}" alt="Page ${i + 1}" style="max-width:100%;max-height:150px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.15)">
            <div class="small muted">Page ${i + 1}</div>
            <div class="row" style="justify-content:center;gap:4px">
              <button class="btn ghost sm" data-rot="${i}" aria-label="Rotate page ${i + 1}">↻</button>
              ${i > 0 ? `<button class="btn ghost sm" data-up="${i}" aria-label="Move page ${i + 1} earlier">←</button>` : ''}
              <button class="btn ghost sm" data-del="${i}" aria-label="Remove page ${i + 1}" style="color:var(--danger)">✕</button>
            </div></div>`).join('')}
          <button class="choice" data-a="add" style="justify-content:center;flex-direction:column;min-height:150px;margin:0"><span style="font-size:28px">＋</span><span class="small">Add page</span></button>
        </div>
        <div class="row" style="margin-top:14px;gap:6px">${[['doc', 'Document'], ['gray', 'Gray'], ['color', 'Color']].map(([m, l]) =>
          `<button class="chip ${pages[0].mode === m ? 'primary' : ''}" data-mode="${m}">${l}</button>`).join('')}</div>
        ${status ? `<div class="row" style="margin-top:16px"><div class="spinner"></div><div class="small">${status}</div></div>` :
          `<button class="btn block" data-a="done" style="margin-top:16px">Done — save ${pages.length} page${pages.length > 1 ? 's' : ''} as PDF</button>`}`
        : `<div class="empty" style="padding:30px 10px">
            <div style="font-size:44px">📷</div>
            <p>Lay the page on a flat, well-lit surface and take a photo.<br>You can add more pages after. All pages are saved together as <b>one PDF</b>.</p>
            <p class="small muted">Want to keep a regular photo or a video instead? Close this and use <b>Choose a file</b>.</p>
            <button class="btn block" data-a="add">Open camera</button>
            <button class="btn ghost block" data-a="gallery" style="margin-top:6px">Use a photo I already took</button>
          </div>`}`;
      $('[data-a=close]', box).onclick = sh.close;
      $$('[data-a=add]', box).forEach(b => b.onclick = () => { cam.setAttribute('capture', 'environment'); cam.click(); });
      const gal = $('[data-a=gallery]', box); if (gal) gal.onclick = () => { cam.removeAttribute('capture'); cam.click(); };
      $$('[data-rot]', box).forEach(b => b.onclick = () => { pages[+b.dataset.rot].rot += 90; draw(); });
      $$('[data-del]', box).forEach(b => b.onclick = () => { pages.splice(+b.dataset.del, 1); draw(); });
      $$('[data-up]', box).forEach(b => b.onclick = () => { const i = +b.dataset.up; [pages[i - 1], pages[i]] = [pages[i], pages[i - 1]]; draw(); });
      $$('[data-mode]', box).forEach(b => b.onclick = () => { S.scanMode = b.dataset.mode; saveS(); pages.forEach(p => p.mode = b.dataset.mode); draw(); });
      const done = $('[data-a=done]', box); if (done) done.onclick = finish;
    }
    async function finish() {
      if (busyScan) return; busyScan = true;
      try {
        draw('Making your PDF…');
        const canvases = pages.map(p => SC.render(p));
        const pdf = await SC.buildPdf(canvases);
        let text = '';
        if (S.ocr) {
          try {
            text = await SC.readText(canvases, (st, pr) => {
              const label = /load|initializ/i.test(st) ? 'Getting the text reader ready (first time only)…' : 'Reading the text… ' + Math.round(pr * 100) + '%';
              const el = $('.spinner + .small', box); if (el) el.textContent = label;
            });
          } catch (e) { text = ''; }
        }
        const d = new Date(); const stamp = d.toISOString().slice(0, 10);
        const file = new File([pdf], `Scan ${stamp}.pdf`, { type: 'application/pdf', lastModified: Date.now() });
        file.ocrText = text;
        sh.close();
        enqueue([file]);
      } catch (e) { busyScan = false; errToast(e); draw(); }
    }
    draw();
    cam.setAttribute('capture', 'environment'); cam.click();   // go straight to the camera
  }

  async function ensurePath(index, segs) {
    let parentId = index.rootId; const created = [];
    for (const seg of segs) {
      const ex = index.childNamed(parentId, seg);
      if (ex) { parentId = ex.id; continue; }
      const f = await drive.createFolder(seg, parentId);
      created.push(f.id); parentId = f.id;
      index = await getIndex();
    }
    return { folderId: parentId, created };
  }

  function learn(catId, path) {
    const key = path.join('/');
    votes[catId] = votes[catId] || {}; votes[catId][key] = (votes[catId][key] || 0) + 1;
    if (votes[catId][key] >= 2) { rules[catId] = path; D.store('saysave.rules', rules); toast('🧠 Got it — I\'ll file ' + esc(catName(catId)) + ' in ' + esc(pathText(path)) + ' from now on.'); }
    D.store('saysave.votes', votes);
  }
  const catName = id => (L.CATEGORIES.find(c => c.id === id) || { name: id }).name;

  // ---------- Folder picker ----------
  async function openPicker(title, onPick) {
    const m = openLayer(`<div class="sheet-h"><h3>${esc(title)}</h3><button class="x" data-a="close">✕</button></div>
      <input type="search" id="fq" placeholder="Search folders">
      <div class="tree" id="tree" style="margin-top:10px;max-height:46vh;overflow:auto"><div class="empty"><div class="spinner" style="margin:0 auto"></div></div></div>
      <div id="newRow" class="row hidden" style="margin-top:10px"><input type="text" id="newName" placeholder="New folder name"><button class="btn sm" data-a="mk">Create</button></div>
      <div class="row" style="margin-top:12px"><button class="btn secondary" data-a="new">+ New folder</button><button class="btn grow" data-a="use">Use this folder</button></div>`, { center: false });
    const el = m.el; let index, sel = null; const open = new Set();
    $('[data-a=close]', el).onclick = m.close;
    try { index = await getIndex(); sel = index.rootId; } catch (e) { m.close(); return errToast(e); }
    function nodes(parentId, depth) {
      const kids = (index.children.get(parentId) || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return kids.map(k => {
        const has = (index.children.get(k.id) || []).length;
        return `<button class="node ${sel === k.id ? 'sel' : ''}" data-id="${k.id}" style="padding-left:${10 + depth * 18}px">
          <span data-tog="${has ? k.id : ''}" style="width:16px;display:inline-flex;color:var(--ink-3)">${has ? (open.has(k.id) ? ICON.chevDown : ICON.chev) : ''}</span>${ICON.folder}<span>${esc(k.name)}</span></button>` +
          (open.has(k.id) ? nodes(k.id, depth + 1) : '');
      }).join('');
    }
    function draw() {
      const q = $('#fq', el).value.trim();
      const t = $('#tree', el);
      if (q) {
        const hits = L.searchFolders(index, q);
        t.innerHTML = hits.length ? hits.map(h => `<button class="node ${sel === h.folderId ? 'sel' : ''}" data-id="${h.folderId}">${ICON.folder}<span>${esc(pathText(h.path))}</span></button>`).join('') : '<div class="empty">No folders match.</div>';
      } else {
        t.innerHTML = `<button class="node ${sel === index.rootId ? 'sel' : ''}" data-id="${index.rootId}">${ICON.folder}<b>My Drive</b></button>` + nodes(index.rootId, 1);
      }
      $$('[data-id]', t).forEach(b => b.onclick = e => {
        const tg = e.target.closest('[data-tog]');
        if (tg && tg.dataset.tog) { open.has(tg.dataset.tog) ? open.delete(tg.dataset.tog) : open.add(tg.dataset.tog); }
        else sel = b.dataset.id;
        draw();
      });
    }
    $('#fq', el).oninput = draw;
    $('[data-a=new]', el).onclick = () => { $('#newRow', el).classList.remove('hidden'); $('#newName', el).focus(); };
    $('[data-a=mk]', el).onclick = async () => {
      const n = $('#newName', el).value.trim(); if (!n) return;
      const parentPath = sel === index.rootId ? 'My Drive' : pathText(index.pathOf(sel));
      ask('Create folder?', `Create <b>${esc(n)}</b> inside <b>${esc(parentPath)}</b>?`, 'Create', async () => {
        try { warmToken(); const f = await drive.createFolder(n, sel); index = await getIndex(true); open.add(sel); sel = f.id; $('#newName', el).value = ''; $('#newRow', el).classList.add('hidden'); draw(); }
        catch (e) { errToast(e); }
      });
    };
    $('[data-a=use]', el).onclick = () => { const path = sel === index.rootId ? [] : index.pathOf(sel); m.close(); onPick({ folderId: sel, path }); };
    draw();
  }

  // ================= COMMANDS =================
  function renderCommands() {
    const v = $('#view');
    v.innerHTML = `
      <h2>Auto-file phrase</h2>
      <section class="card">
        <p class="muted" style="margin-top:0">Say any of these and SaySave picks the best folder from the file's name. The first one is the main button.</p>
        <div id="trig">${S.triggers.map((t, i) => `<div class="row" style="margin-top:8px"><input type="text" data-trig="${i}" value="${esc(t)}">${S.triggers.length > 1 ? `<button class="btn ghost sm" data-deltrig="${i}" aria-label="Remove">✕</button>` : ''}</div>`).join('')}</div>
        <button class="btn ghost sm" id="addTrig" style="margin-top:8px">+ Add another phrase</button>
      </section>

      <h2>Folder shortcuts</h2>
      <section class="card">
        <p class="muted" style="margin-top:0">Your own words for a specific folder. Use <code>{year}</code> or <code>{month}</code> to file by date, e.g. <code>Taxes/{year}</code>.</p>
        <div id="scs">${S.shortcuts.length ? S.shortcuts.map((sc, i) => `
          <div class="card flat" style="padding:12px;margin:10px 0 0">
            <label class="field" style="margin-top:0">When I say<input type="text" data-scp="${i}" value="${esc(sc.phrase)}" placeholder="tax folder"></label>
            <label class="field">Save to<div class="row"><input type="text" data-scf="${i}" value="${esc(sc.path)}" placeholder="Taxes/{year}"><button class="btn secondary sm" data-scpick="${i}" style="margin-top:6px">Choose</button></div></label>
            <div class="toggle" style="border:0;padding-bottom:0"><span class="small">Save right away (skip the confirm step)</span>
              <label class="switch"><input type="checkbox" data-scs="${i}" ${sc.skip ? 'checked' : ''}><span></span></label></div>
            <button class="btn danger sm" data-scdel="${i}">Delete shortcut</button>
          </div>`).join('') : '<div class="empty">No shortcuts yet.</div>'}</div>
        <button class="btn secondary sm" id="addSc" style="margin-top:12px">+ Add shortcut</button>
      </section>

      <h2>Yes / cancel words</h2>
      <section class="card">
        <label class="field" style="margin-top:0">Words that mean “save it”<input type="text" id="cw" value="${esc(S.confirmWords)}"></label>
        <label class="field">Words that mean “cancel”<input type="text" id="xw" value="${esc(S.cancelWords)}"></label>
      </section>

      <h2>Try a command</h2>
      <section class="card">
        <div class="row">${SR ? `<button class="mic sm" id="tmic" aria-label="Speak">${ICON.mic}</button>` : ''}
          <form class="grow row" id="tform"><input type="text" id="tin" placeholder="e.g. save this to my tax folder"><button class="btn sm">Test</button></form></div>
        <div id="tout" class="muted small" style="margin-top:10px"></div>
      </section>`;
    $$('[data-trig]', v).forEach(i => i.oninput = () => { S.triggers[+i.dataset.trig] = i.value; S.triggers = S.triggers.map(s => s); saveS(); });
    $$('[data-trig]', v).forEach(i => i.onblur = () => { S.triggers = S.triggers.filter(s => s.trim()); if (!S.triggers.length) S.triggers = [DEFAULTS.triggers[0]]; saveS(); });
    $$('[data-deltrig]', v).forEach(b => b.onclick = () => { S.triggers.splice(+b.dataset.deltrig, 1); saveS(); renderCommands(); });
    $('#addTrig', v).onclick = () => { S.triggers.push(''); saveS(); renderCommands(); $$('[data-trig]').slice(-1)[0].focus(); };
    $$('[data-scp]', v).forEach(i => i.oninput = () => { S.shortcuts[+i.dataset.scp].phrase = i.value; saveS(); });
    $$('[data-scf]', v).forEach(i => i.oninput = () => { S.shortcuts[+i.dataset.scf].path = i.value; saveS(); });
    $$('[data-scs]', v).forEach(i => i.onchange = () => { S.shortcuts[+i.dataset.scs].skip = i.checked; saveS(); });
    $$('[data-scdel]', v).forEach(b => b.onclick = () => { S.shortcuts.splice(+b.dataset.scdel, 1); saveS(); renderCommands(); });
    $$('[data-scpick]', v).forEach(b => b.onclick = () => { warmToken(); openPicker('Shortcut folder', c => { S.shortcuts[+b.dataset.scpick].path = c.path.join('/'); saveS(); renderCommands(); }); });
    $('#addSc', v).onclick = () => { S.shortcuts.push({ phrase: '', path: '', skip: false }); saveS(); renderCommands(); $$('[data-scp]').slice(-1)[0].focus(); };
    $('#cw', v).oninput = e => { S.confirmWords = e.target.value; saveS(); };
    $('#xw', v).oninput = e => { S.cancelWords = e.target.value; saveS(); };
    const test = async t => {
      $('#tin', v).value = t;
      const c = L.parseCommand(t, cmdSettings()); let out;
      if (c.type === 'auto') out = '✅ Auto-file: SaySave will choose the best folder from the file name.';
      else if (c.type === 'shortcut') out = `✅ Shortcut “${esc(c.shortcut.phrase)}” → ${esc(pathText(L.expandPath(c.shortcut.path)))}`;
      else if (c.type === 'folder') {
        let hits = []; try { hits = L.searchFolders(await getIndex(), c.query); } catch (e) {}
        out = hits.length ? `✅ Folder search “${esc(c.query)}” → ${esc(pathText(hits[0].path))}` : `📁 Folder search “${esc(c.query)}” → no folder yet; SaySave will offer to create one.`;
      }
      else if (c.type === 'confirm') out = '👍 Means “yes, save it” (used on the confirm step).';
      else if (c.type === 'cancel') out = '✋ Means “cancel”.';
      else out = '❓ Not recognized.' + (c.guess ? ' Closest: ' + esc(c.guess.type === 'shortcut' ? c.guess.shortcut.phrase : c.guess.trigger) : '');
      $('#tout', v).innerHTML = out;
    };
    $('#tform', v).onsubmit = e => { e.preventDefault(); const t = $('#tin', v).value.trim(); if (t) test(t); };
    const tm = $('#tmic', v);
    if (tm) tm.onclick = () => { tm.classList.add('listening'); listen({ onInterim: t => $('#tin', v).value = t, onError: e => { tm.classList.remove('listening'); if (e !== 'aborted') $('#tout', v).textContent = micErrorText(e); }, onEnd: t => { tm.classList.remove('listening'); if (t) test(t); } }); };
  }

  // ================= ORGANIZE =================
  let orgPlan = null, orgScope = 'root';
  function renderOrganize() {
    const v = $('#view');
    const needConnect = !drive.isDemo && !drive.isConnected();
    v.innerHTML = `
      <section class="card">
        <h3>Organize my Google Drive <span class="tag brand">Optional</span></h3>
        <p class="muted">SaySave looks at your file names, suggests folders, and shows every move before anything happens. <b>It only moves files — it never deletes, renames, or changes sharing.</b> Shared files are skipped. You can undo the whole thing.</p>
        ${needConnect ? `<div class="banner"><div class="grow">Connect Google Drive first.</div><button class="btn sm" id="oc">Connect</button></div>` : `
        <label class="field">What to organize<select id="scope">
          <option value="root" ${orgScope === 'root' ? 'selected' : ''}>Loose files in My Drive (not in any folder)</option>
          <option value="all" ${orgScope === 'all' ? 'selected' : ''}>All files I own (up to 1,000)</option></select></label>
        <button class="btn block" id="scan" style="margin-top:14px">${orgPlan ? 'Scan again' : 'Scan my Drive'}</button>`}
      </section>
      ${orgLog && (orgLog.mode === 'demo') === drive.isDemo ? `<section class="card"><div class="row"><div class="grow"><b>Last organization</b><div class="muted small">${orgLog.moves.length} files moved · ${ago(orgLog.time)}</div></div><button class="btn secondary sm" id="undoOrg">Undo all</button></div></section>` : ''}
      <div id="orgOut"></div>
      ${drive.isDemo ? '<h2>Your demo Drive</h2><section class="card" id="demoTree"></section>' : ''}`;
    const oc = $('#oc', v); if (oc) oc.onclick = connectGoogle;
    const sc = $('#scope', v); if (sc) sc.onchange = () => { orgScope = sc.value; };
    const sb = $('#scan', v); if (sb) sb.onclick = () => { warmToken(); scan(); };
    const uo = $('#undoOrg', v); if (uo) uo.onclick = () => ask('Undo organization?', `Move ${orgLog.moves.length} files back to where they were, and remove any empty folders SaySave created.`, 'Undo all', undoOrganize);
    if (orgPlan) drawPlan();
    if (drive.isDemo) drawDemoTree();
  }

  async function drawDemoTree() {
    const el = $('#demoTree'); if (!el) return;
    const index = await getIndex();
    const line = (id, depth) => (index.children.get(id) || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(f =>
      `<div class="node" style="padding-left:${10 + depth * 18}px">${ICON.folder}<span>${esc(f.name)}</span><span class="count">${drive.filesIn(f.id).length} file${drive.filesIn(f.id).length === 1 ? '' : 's'}</span></div>` + line(f.id, depth + 1)).join('');
    const loose = drive.filesIn('root');
    el.innerHTML = `<div class="tree">${line('root', 0)}</div>
      <div class="muted small" style="margin-top:10px">${loose.length} loose files in My Drive: ${loose.slice(0, 8).map(f => esc(f.name)).join(', ')}${loose.length > 8 ? '…' : ''}</div>
      <button class="btn ghost sm" id="resetDemo" style="margin-top:8px">Reset demo Drive</button>`;
    $('#resetDemo', el).onclick = () => ask('Reset demo Drive?', 'Puts the sample folders and loose files back.', 'Reset', () => { drive.reset(); orgPlan = null; orgLog = null; D.store('saysave.orgLog', null); recent = recent.filter(r => r.mode !== 'demo'); saveRecent(); render(); });
  }

  async function scan() {
    const out = $('#orgOut');
    out.innerHTML = '<section class="card"><div class="row"><div class="spinner"></div><div>Scanning your files…</div></div></section>';
    try {
      const index = await getIndex(true);
      const files = await drive.listFiles(orgScope);
      const items = [];
      for (const f of files) {
        const s = L.suggest(index, { name: f.name, mimeType: f.mimeType }, { rules });
        let target;
        if (s.confidence !== 'none' && s.choices[0]) {
          target = s.choices[0].missingYear && s.proposal ? { path: s.proposal.path, isNew: true } : { path: s.choices[0].path, folderId: s.choices[0].folderId, isNew: false };
        } else {
          const segs = s.proposal.path; const ex = index.findByPath(segs);
          target = ex ? { path: segs, folderId: ex.id, isNew: false } : { path: segs, isNew: true };
        }
        // skip files already inside the target
        const parents = f.parents || [];
        if (target.folderId && parents.some(pid => pid === target.folderId || index.pathOf(pid).join('/').startsWith(target.path.join('/') + '/'))) continue;
        items.push({ id: f.id, name: f.name, mimeType: f.mimeType, from: parents, target, on: !!s.category, category: s.category });
      }
      orgPlan = { items, scope: orgScope };
      drawPlan();
    } catch (e) { out.innerHTML = ''; errToast(e); }
  }

  function drawPlan() {
    const out = $('#orgOut'); if (!out || !orgPlan) return;
    const items = orgPlan.items;
    if (!items.length) { out.innerHTML = '<section class="card"><div class="empty">🎉 Nothing to organize — everything is already in a good place.</div></section>'; return; }
    const groups = new Map();
    items.forEach((it, i) => { const k = it.target.path.join('/'); if (!groups.has(k)) groups.set(k, { target: it.target, idx: [] }); groups.get(k).idx.push(i); });
    const sorted = [...groups.values()].sort((a, b) => (a.target.path[0] === 'Unsorted') - (b.target.path[0] === 'Unsorted') || a.target.path.join('/').localeCompare(b.target.path.join('/')));
    const on = items.filter(i => i.on);
    const newFolders = new Set(on.filter(i => i.target.isNew).map(i => i.target.path.join('/')));
    out.innerHTML = `
      <h2>Suggested plan</h2>
      <section class="card">
        <div class="banner info" style="margin-bottom:6px"><div>📋</div><div><b>${on.length} of ${items.length} files</b> selected to move into <b>${new Set(on.map(i => i.target.path.join('/'))).size} folders</b>${newFolders.size ? ` (<b>${newFolders.size} new</b>)` : ''}. Uncheck anything you want to leave alone.</div></div>
        ${sorted.map(g => `
          <div class="group-h">${ICON.folder}<span class="grow">${esc(pathText(g.target.path))}</span>${g.target.isNew ? '<span class="tag warn">new folder</span>' : ''}${g.target.path[0] === 'Unsorted' ? '<span class="tag warn">not sure</span>' : ''}</div>
          ${g.idx.map(i => { const it = items[i]; return `<div class="move"><input type="checkbox" data-on="${i}" ${it.on ? 'checked' : ''} aria-label="Move ${esc(it.name)}">
            <div class="grow"><div class="filename">${esc(it.name)}</div><div class="to">${it.category ? esc(it.category) : 'Couldn\'t tell from the name'}</div></div>
            <button class="btn ghost sm" data-chg="${i}">Change</button></div>`; }).join('')}`).join('')}
        <div id="applyBox"><button class="btn block accent" id="apply" style="margin-top:16px" ${on.length ? '' : 'disabled'}>Move ${on.length} files</button>
        <p class="muted small" style="text-align:center;margin-bottom:0">Nothing is deleted. You can undo everything afterwards.</p></div>
      </section>`;
    $$('[data-on]', out).forEach(c => c.onchange = () => { items[+c.dataset.on].on = c.checked; drawPlan(); });
    $$('[data-chg]', out).forEach(b => b.onclick = () => openPicker('Move “' + items[+b.dataset.chg].name + '” to', c => {
      const it = items[+b.dataset.chg]; it.target = { path: c.path, folderId: c.folderId, isNew: false }; it.on = true; drawPlan(); }));
    $('#apply', out).onclick = () => {
      warmToken();
      ask('Move files?', `Move <b>${on.length} files</b>${newFolders.size ? ` and create <b>${newFolders.size} new folder${newFolders.size > 1 ? 's' : ''}</b> (${[...newFolders].map(esc).join(', ')})` : ''}?`, 'Move files', applyPlan);
    };
  }

  async function applyPlan() {
    const items = orgPlan.items.filter(i => i.on);
    const box = $('#applyBox');
    box.innerHTML = `<div class="progress"><div id="pbar"></div></div><div class="muted small" id="ptext">Starting…</div>`;
    const log = { mode: drive.isDemo ? 'demo' : 'google', moves: [], created: [], time: Date.now() };
    const memo = new Map();
    try {
      let index = await getIndex(true);
      let n = 0;
      for (const it of items) {
        let toId = it.target.folderId;
        if (!toId) {
          const key = it.target.path.join('/');
          if (memo.has(key)) toId = memo.get(key);
          else { const r = await ensurePath(index, it.target.path); toId = r.folderId; log.created.push(...r.created); memo.set(key, toId); index = await getIndex(); }
        }
        await drive.move(it.id, toId, it.from);
        log.moves.push({ id: it.id, name: it.name, from: it.from, to: toId });
        n++;
        $('#pbar').style.width = Math.round(n / items.length * 100) + '%';
        $('#ptext').textContent = `Moved ${n} of ${items.length}: ${it.name}`;
      }
      orgLog = log; D.store('saysave.orgLog', log); orgPlan = null;
      toast(`✅ Organized ${n} files.`, [{ label: 'Undo', onClick: undoOrganize }], 10000);
      render();
    } catch (e) {
      if (log.moves.length) { orgLog = log; D.store('saysave.orgLog', log); }
      errToast(e); render();
    }
  }

  async function undoOrganize() {
    const log = orgLog; if (!log) return;
    try {
      for (const m of log.moves.slice().reverse()) await drive.move(m.id, m.from[0] || (await drive.getIndex()).rootId, [m.to]);
      for (const fid of log.created.slice().reverse()) { try { if (await drive.childCount(fid) === 0) await drive.trash(fid); } catch (e) {} }
      orgLog = null; D.store('saysave.orgLog', null);
      if (drive.getIndex) await drive.getIndex(true);
      toast('↩️ Everything is back where it was.'); render();
    } catch (e) { errToast(e); }
  }

  // ================= SETTINGS =================
  async function connectGoogle() {
    if (D.inPreview()) return errToast(D.PREVIEW_MSG);
    if (S.mode !== 'google') { S.mode = 'google'; saveS(); drive = makeDrive(); }
    if (!S.clientId && !NATIVE) { go('setup'); return errToast('Paste your Google OAuth Client ID first.'); }
    try { if (!drive.client) await drive.init(); await drive.connect(); toast('✅ Connected to Google Drive as ' + esc(drive.account())); render(); }
    catch (e) {
      const m = String(e && e.message || e);
      if (/access_denied|not.*(verified|test)|403|blocked|developer/i.test(m)) toast('⚠️ Google didn\'t allow this account yet. SaySave is in testing, so only invited accounts can connect. You can still try everything in <b>Demo Drive</b>.', [{ label: 'Use Demo', onClick: () => { S.mode = 'demo'; saveS(); drive = makeDrive(); render(); } }], 12000);
      else errToast(e);
      render();
    }
  }

  function renderSetup() {
    const v = $('#view');
    const origin = location.origin && location.origin !== 'null' ? location.origin : 'https://YOUR-NAME.github.io';
    const ruleKeys = Object.keys(rules);
    v.innerHTML = `
      <h2>Where to save</h2>
      <section class="card">
        <button class="choice ${S.mode === 'demo' ? 'sel' : ''}" data-mode="demo"><input type="radio" ${S.mode === 'demo' ? 'checked' : ''} tabindex="-1"><div><b>Demo Drive</b><div class="muted small">Try SaySave with a pretend Drive in this browser.</div></div></button>
        <button class="choice ${S.mode === 'google' ? 'sel' : ''}" data-mode="google"><input type="radio" ${S.mode === 'google' ? 'checked' : ''} tabindex="-1"><div><b>My Google Drive</b><div class="muted small">Save to your real Drive.</div></div></button>
        ${S.mode === 'google' ? `
          <div class="row" style="margin-top:12px">
            ${D.inPreview() ? `<div class="banner" style="margin:0"><div>ℹ️</div><div>${esc(D.PREVIEW_MSG)}</div></div>` : drive.isConnected() ? `<div class="grow small">✅ Connected as <b>${esc(drive.account())}</b></div><button class="btn ghost sm" id="disc">Disconnect</button>` : `<button class="btn block" id="conn">Connect Google Drive</button>`}
          </div>
          <p class="muted small" style="margin:10px 0 0">Google will ask you to choose your account and tap <b>Allow</b>. SaySave only saves and moves files you tell it to.</p>
          <details style="margin-top:14px;${NATIVE ? 'display:none' : ''}"><summary class="small" style="cursor:pointer;font-weight:650;color:var(--ink-3)">Advanced (developer settings)</summary>
          <label class="field" style="margin-top:8px">Google OAuth Client ID<input type="text" id="cid" value="${esc(S.clientId)}" placeholder="1234-abc.apps.googleusercontent.com"></label>
            <p class="small" style="margin-bottom:0"><b>How to make your own Client ID</b></p>
            <ol class="steps small">
              <li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a> and create a project named <b>SaySave</b>.</li>
              <li>APIs &amp; Services → Library → enable <b>Google Drive API</b>.</li>
              <li>OAuth consent screen → External → fill in the app name and your email. Leave it in <b>Testing</b> and add your own Gmail (and any testers) as <b>Test users</b>.</li>
              <li>Credentials → Create credentials → <b>OAuth client ID</b> → Application type <b>Web application</b>.</li>
              <li>Under <b>Authorized JavaScript origins</b>, add <code>${esc(origin)}</code></li>
              <li>Copy the Client ID and paste it above, then tap Connect.</li>
            </ol>
            <p class="muted small">While the app is in Testing, only the test users you add can sign in. That's perfect for trying it out.</p>
          </details>` : ''}
      </section>

      <h2>Behavior</h2>
      <section class="card">
        ${[['rename', 'Suggest clean file names', 'e.g. scan_0012.pdf → Insurance 2025-11-15.pdf'],
           ['autoSuggest', 'Suggest a folder as soon as a file arrives', 'SaySave checks your Drive and proposes a path right away'],
           ['ocr', 'Read the words on scanned pages', 'Helps pick the folder and name. Downloads a text reader (~10 MB) the first time'],
           ['readContent', 'Read the document when the name is unclear', 'Reads PDFs/text on your phone only'],
           ['autoListen', 'Start listening automatically', 'Mic turns on when a file arrives'],
           ['speak', 'Speak confirmations out loud', '“Saved to Taxes”'],
           ['autoCreate', 'Create new folders without asking', 'Off = always ask before creating a folder']].map(([k, t, d]) => `
          <div class="toggle"><div><div style="font-weight:600">${t}</div><div class="muted small">${d}</div></div>
            <label class="switch"><input type="checkbox" data-opt="${k}" ${S[k] ? 'checked' : ''}><span></span></label></div>`).join('')}
        <label class="field">Put brand-new top-level folders inside (optional)<div class="row"><input type="text" id="home" value="${esc(S.homePath)}" placeholder="My Drive (leave empty)"><button class="btn secondary sm" id="homePick" style="margin-top:6px">Choose</button></div></label>
      </section>

      <h2>Learned rules</h2>
      <section class="card">${ruleKeys.length ? `<ul class="list">${ruleKeys.map(k => `<li><div class="grow"><b>${esc(catName(k))}</b><div class="muted small">→ ${esc(pathText(rules[k]))}</div></div><button class="btn ghost sm" data-rdel="${esc(k)}">Forget</button></li>`).join('')}</ul>`
        : '<div class="empty">When you move a type of file to a different folder twice, SaySave remembers it here.</div>'}</section>

      ${NATIVE ? '' : `<h2>Install on your phone</h2>
      <section class="card small">
        <p style="margin-top:0"><b>Android (Chrome):</b> open SaySave → ⋮ menu → <b>Install app</b>. Then in any app, tap <b>Share → SaySave</b>.</p>
        <p style="margin-bottom:0"><b>iPhone (Safari):</b> Share → <b>Add to Home Screen</b>. iPhone doesn't let web apps appear in the Share menu, so open SaySave and tap <b>Choose a file</b>, which can pick from Files, Photos, and iCloud.</p>
      </section>`}

      <h2>Privacy</h2>
      <section class="card small muted">Files go straight from your phone to your own Google Drive. SaySave has no server, and your documents are never sent anywhere else. Settings stay on this device.</section>`;
    $$('[data-mode]', v).forEach(b => b.onclick = () => {
      if (S.mode === b.dataset.mode) return;
      S.mode = b.dataset.mode; saveS(); drive = makeDrive(); orgPlan = null;
      render();
    });
    const cid = $('#cid', v);
    if (cid) cid.onchange = () => { S.clientId = cid.value.trim(); saveS(); drive = makeDrive(); render(); };
    const conn = $('#conn', v); if (conn) conn.onclick = connectGoogle;
    const disc = $('#disc', v); if (disc) disc.onclick = () => { drive.disconnect(); render(); };
    const sw = $('#switchAcct', v); if (sw) sw.onclick = async () => {
      try { await drive.connect(true); orgPlan = null; toast('✅ Now using ' + esc(drive.account())); render(); } catch (e) { errToast(e); }
    };
    $$('[data-opt]', v).forEach(c => c.onchange = () => { S[c.dataset.opt] = c.checked; saveS(); });
    $('#home', v).oninput = e => { S.homePath = e.target.value.trim(); saveS(); };
    $('#homePick', v).onclick = () => { warmToken(); openPicker('New folders go inside', c => { S.homePath = c.path.join('/'); saveS(); renderSetup(); }); };
    $$('[data-rdel]', v).forEach(b => b.onclick = () => { delete rules[b.dataset.rdel]; delete votes[b.dataset.rdel]; D.store('saysave.rules', rules); D.store('saysave.votes', votes); renderSetup(); });
  }

  // ---------- Shared files (Android share sheet via service worker) ----------
  function readInbox() {
    return new Promise(res => {
      try {
        const rq = indexedDB.open('saysave', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('inbox', { autoIncrement: true });
        rq.onsuccess = () => {
          const db = rq.result; const tx = db.transaction('inbox', 'readwrite'); const os = tx.objectStore('inbox');
          const all = os.getAll(); all.onsuccess = () => { os.clear(); res(all.result || []); };
          all.onerror = () => res([]);
        };
        rq.onerror = () => res([]);
      } catch (e) { res([]); }
    });
  }
  async function checkShared() {
    if (!/[?&]shared=1/.test(location.search)) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    const recs = await readInbox();
    const files = recs.map(r => r.file instanceof Blob ? new File([r.file], r.name || 'shared-file', { type: r.type || r.file.type }) : null).filter(Boolean);
    if (files.length) enqueue(files);
    else toast('Nothing was shared — try sharing the file again.');
  }

  if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    // when a new version takes over, reload once so the new screens appear
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }

  // Android Share menu → files arrive here
  window.SaySaveReceive = async (items) => {
    const out = [];
    for (const it of items || []) {
      try { const b = await (await fetch(it.url)).blob(); out.push(new File([b], it.name || 'shared-file', { type: it.type || b.type })); } catch (e) {}
    }
    if (out.length) enqueue(out); else toast('Could not open the shared file.');
  };

  render();
  checkShared();
  // Android: connect to Google Drive with the phone's account automatically (one "Allow" the first time only)
  if (NATIVE && S.mode === 'google') {
    if (!drive.isConnected()) setTimeout(() => connectGoogle(), 400);
    else drive.ensureToken().catch(() => {});
  }
})();
