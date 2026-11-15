/* SaySave core logic: file classification, folder matching, voice-command parsing.
   Pure functions — no DOM — so it can be unit-tested in Node. */
(function (root) {
  'use strict';

  // ---------- Categories ----------
  // keywords: words in a file name / text that point to the category
  // folderWords: words in a folder NAME that mean "this folder is for that category"
  const CATEGORIES = [
    { id: 'taxes', name: 'Taxes', yearly: true,
      keywords: ['tax', 'taxes', 'w2', 'w-2', '1099', '1098', '1040', '1095', 'irs', 'k1', 'k-1', 'w9', 'w-9', 'turbotax', 'hrblock', 'refund', 'withholding', 'estimated tax', 'tax return', 'schedule c', 'property tax'],
      folderWords: ['tax', 'taxes', 'irs', 'tax docs', 'tax returns', 'tax documents'] },
    { id: 'receipts', name: 'Receipts', yearly: true,
      keywords: ['receipt', 'receipts', 'order', 'purchase', 'invoice', 'inv', 'amazon', 'walmart', 'target', 'costco', 'bestbuy', 'best buy', 'ebay', 'paid', 'order confirmation'],
      folderWords: ['receipt', 'receipts', 'purchases', 'invoices', 'expenses'] },
    { id: 'bills', name: 'Bills & Utilities', yearly: true,
      keywords: ['bill', 'bills', 'utility', 'utilities', 'electric', 'electricity', 'water', 'sewer', 'internet', 'phone bill', 'verizon', 'at&t', 'att', 'tmobile', 't-mobile', 'comcast', 'xfinity', 'spectrum', 'aep', 'duke energy', 'gas bill', 'trash'],
      folderWords: ['bill', 'bills', 'utility', 'utilities'] },
    { id: 'bank', name: 'Bank & Statements', yearly: true,
      keywords: ['statement', 'stmt', 'bank', 'checking', 'savings', 'chase', 'wells fargo', 'wellsfargo', 'citi', 'bofa', 'bank of america', 'capital one', 'credit card', 'discover', 'amex', '401k', '401(k)', 'ira', 'brokerage', 'fidelity', 'vanguard', 'schwab'],
      folderWords: ['bank', 'banking', 'statements', 'finance', 'finances', 'financial', 'money'] },
    { id: 'insurance', name: 'Insurance', yearly: false,
      keywords: ['insurance', 'policy', 'claim', 'premium', 'coverage', 'geico', 'progressive', 'state farm', 'statefarm', 'allstate', 'nationwide', 'eob', 'explanation of benefits', 'declarations'],
      folderWords: ['insurance', 'policies'] },
    { id: 'medical', name: 'Medical', yearly: false,
      keywords: ['medical', 'doctor', 'dr', 'hospital', 'clinic', 'lab', 'labs', 'lab results', 'prescription', 'rx', 'pharmacy', 'dental', 'dentist', 'orthodontist', 'vision', 'optometrist', 'health', 'vaccine', 'vaccination', 'immunization', 'mychart', 'pediatric', 'urgent care', 'x-ray', 'xray'],
      folderWords: ['medical', 'health', 'doctor', 'doctors', 'healthcare'] },
    { id: 'work', name: 'Work', yearly: false,
      keywords: ['paystub', 'pay stub', 'payslip', 'paycheck', 'offer letter', 'resume', 'cv', 'contract', 'timesheet', 'time sheet', 'employment', 'employer', 'benefits enrollment', 'performance review', 'onboarding'],
      folderWords: ['work', 'job', 'jobs', 'career', 'employment', 'business'] },
    { id: 'school', name: 'School', yearly: false,
      keywords: ['school', 'report card', 'transcript', 'homework', 'class', 'syllabus', 'tuition', 'enrollment', 'teacher', 'grades', 'diploma', 'college', 'university', 'permission slip', 'field trip'],
      folderWords: ['school', 'education', 'kids school', 'college', 'university'] },
    { id: 'home', name: 'Home', yearly: false,
      keywords: ['mortgage', 'lease', 'rent', 'rental', 'hoa', 'deed', 'house', 'apartment', 'property', 'warranty', 'appliance', 'repair', 'plumber', 'hvac', 'roof', 'home inspection', 'closing'],
      folderWords: ['home', 'house', 'housing', 'property', 'apartment'] },
    { id: 'car', name: 'Car', yearly: false,
      keywords: ['car', 'auto', 'vehicle', 'vin', 'dmv', 'bmv', 'registration', 'honda', 'toyota', 'ford', 'chevy', 'chevrolet', 'nissan', 'hyundai', 'kia', 'subaru', 'tesla', 'oil change', 'tire', 'tires', 'smog', 'emissions', 'car loan', 'auto loan'],
      folderWords: ['car', 'cars', 'auto', 'vehicle', 'vehicles'] },
    { id: 'id', name: 'ID & Legal', yearly: false,
      keywords: ['passport', 'license', 'drivers license', 'birth certificate', 'social security', 'marriage certificate', 'will', 'trust', 'legal', 'court', 'notary', 'notarized', 'power of attorney', 'id card', 'citizenship'],
      folderWords: ['id', 'ids', 'legal', 'identity', 'documents', 'important documents', 'personal documents'] },
    { id: 'photos', name: 'Photos & Scans', yearly: true,
      keywords: [],
      folderWords: ['photos', 'pictures', 'images', 'scans'] }
  ];

  const STOP = new Set(['the', 'a', 'an', 'my', 'this', 'that', 'to', 'in', 'into', 'on', 'of', 'for', 'and', 'please', 'it', 'file', 'doc', 'document', 'folder', 'save', 'put', 'place', 'pdf', 'copy', 'final', 'new', 'scan', 'scanned']);

  // ---------- Text helpers ----------
  function normalize(s) {
    return String(s || '').toLowerCase()
      .replace(/[_\.\-–—+]+/g, ' ')
      .replace(/[()\[\]{},;:!?"'`]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function splitExt(name) {
    const m = /^(.*?)(\.[a-z0-9]{1,6})?$/i.exec(name || '');
    return { base: m[1] || '', ext: m[2] || '' };
  }
  // Split camelCase and letter/number boundaries: "2025W2Acme" -> "2025 W2 Acme"
  function splitWords(s) {
    return String(s || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z]{3,})(\d)/g, '$1 $2')
      .replace(/(\d)([A-Za-z]{3,})/g, '$1 $2');
  }
  function tokens(s) {
    return normalize(splitWords(s)).split(' ').filter(Boolean);
  }
  function contentTokens(s) {
    return tokens(s).filter(t => !STOP.has(t));
  }

  function findYear(s) {
    const now = new Date().getFullYear();
    const m = String(s || '').match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);
    if (m) { const y = +m[1]; if (y >= 1950 && y <= now + 1) return y; }
    return null;
  }

  // Names that tell us nothing: scan_0012.pdf, IMG_4431.jpg, document(3).pdf
  function isMeaninglessName(name) {
    const base = normalize(splitExt(name).base);
    if (!base) return true;
    if (/^[\d\s]+$/.test(base)) return true;
    return /^(scan|scanned|img|image|document|doc|file|pxl|dsc|dcim|photo|picture|untitled|download|downloads|attachment|cam ?scanner|adobe scan|new doc|screenshot|screen shot)[\s\d]*$/.test(base);
  }

  // Keyword hit test (multi-word keywords matched as phrases)
  function keywordHits(text, list) {
    const t = ' ' + normalize(splitWords(text)) + ' ';
    let hits = 0; const found = [];
    for (const kw of list) {
      const k = ' ' + normalize(kw) + ' ';
      if (t.indexOf(k) !== -1) { hits += kw.indexOf(' ') !== -1 ? 2 : 1; found.push(kw); }
    }
    return { hits, found };
  }

  function classify(name, text, mimeType) {
    const source = (name || '') + ' ' + (text || '');
    let best = null;
    for (const c of CATEGORIES) {
      const { hits, found } = keywordHits(source, c.keywords);
      if (hits > 0 && (!best || hits > best.hits)) best = { category: c, hits, found };
    }
    if (!best && mimeType && /^image\//.test(mimeType)) {
      best = { category: CATEGORIES.find(c => c.id === 'photos'), hits: 1, found: ['image'] };
    }
    return best; // null = unknown
  }

  // ---------- Folder index ----------
  // folders: [{id, name, parentId}] ; rootId
  function buildIndex(folders, rootId) {
    const byId = new Map(folders.map(f => [f.id, f]));
    const children = new Map();
    for (const f of folders) {
      const p = f.parentId || rootId;
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(f);
    }
    function pathOf(id) {
      const parts = []; let cur = byId.get(id); let guard = 0;
      while (cur && guard++ < 50) { parts.unshift(cur.name); cur = byId.get(cur.parentId); }
      return parts;
    }
    const list = folders.map(f => ({ ...f, path: pathOf(f.id), depth: pathOf(f.id).length }));
    return { rootId, byId, children, list, pathOf,
      childNamed(parentId, name) {
        const n = normalize(name);
        return (children.get(parentId || rootId) || []).find(f => normalize(f.name) === n) || null;
      },
      findByPath(pathArr) {
        let parent = rootId, found = null;
        for (const seg of pathArr) { found = this.childNamed(parent, seg); if (!found) return null; parent = found.id; }
        return found;
      }
    };
  }

  // Score how well a folder fits
  function scoreFolder(folder, fileToks, category) {
    const nameN = normalize(folder.name);
    const fTok = tokens(folder.name).filter(t => !STOP.has(t));
    let score = 0;
    if (category) {
      for (const w of category.folderWords) {
        const wn = normalize(w);
        if (nameN === wn) score = Math.max(score, 10);
        else if ((' ' + nameN + ' ').indexOf(' ' + wn + ' ') !== -1) score = Math.max(score, 7);
      }
      if (normalize(category.name) === nameN) score = Math.max(score, 10);
    }
    // direct word overlap between file name and folder name (e.g. "Honda" folder)
    let overlap = 0;
    for (const t of fTok) if (t.length >= 3 && !/^\d+$/.test(t) && fileToks.includes(t)) overlap++;
    score += overlap * 6;
    // prefer shallower folders a little
    score -= Math.max(0, (folder.depth || 1) - 1) * 0.5;
    return score;
  }

  function cleanName(fileName, info) {
    const { base, ext } = splitExt(fileName);
    let words = splitWords(base).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    words = words.split(' ').map(w => {
      if (/^[a-z]{2,}$/.test(w) && w.length > 3) return w[0].toUpperCase() + w.slice(1);
      if (/^w2$/i.test(w)) return 'W-2';
      return w;
    }).join(' ');
    if (info && info.year && !words.includes(String(info.year))) words = info.year + ' ' + words;
    return (words || 'Document') + (ext || '');
  }

  /**
   * Decide where a file should go.
   * Returns { category, year, confidence:'high'|'medium'|'none', choices:[{folderId, path, score}],
   *           proposal:{ path:[...]} (when a new folder is needed), usedContent, suggestedName }
   */
  function suggest(index, file, opts) {
    opts = opts || {};
    const name = file.name || '';
    const meaningless = isMeaninglessName(name) && !classify(name, '', null);
    const text = file.text || '';
    const usedContent = meaningless && !!text;
    const basis = meaningless ? text : name + ' ' + text.slice(0, 1500);
    const cls = classify(meaningless ? '' : name, meaningless ? text : text.slice(0, 1500), file.mimeType);
    const category = cls ? cls.category : null;
    const year = findYear(name) || findYear(text.slice(0, 3000)) || (category && category.yearly ? (file.year || null) : null);
    const fileToks = contentTokens(basis);

    // learned rules first
    if (opts.rules && category) {
      const r = opts.rules[category.id];
      if (r) {
        const f = index.findByPath(r);
        if (f) {
          const choice = withYear(index, f, year, category);
          return result('high', [choice], null);
        }
      }
    }

    const scored = index.list
      .map(f => ({ folder: f, score: scoreFolder(f, fileToks, category) }))
      .filter(s => s.score >= 5)
      .sort((a, b) => b.score - a.score);

    if (scored.length) {
      const top = scored.slice(0, 3).map(s => ({ ...withYear(index, s.folder, year, category), score: s.score }));
      const conf = scored[0].score >= 9.5 && (!scored[1] || scored[0].score - scored[1].score >= 2) ? 'high' : 'medium';
      // if a year subfolder is missing for yearly category, propose it inside the matched folder
      let proposal = null;
      if (top[0].missingYear) proposal = { path: top[0].path.concat(String(year)), parentId: top[0].folderId, newSegments: [String(year)] };
      return result(conf, top, proposal);
    }

    // nothing fits → propose a new folder
    let segs;
    if (category) segs = category.yearly && year ? [category.name, String(year)] : [category.name];
    else {
      segs = ['Unsorted'];
    }
    // Reuse the part of the path that already exists
    let parentId = index.rootId; const existing = []; let i = 0;
    for (; i < segs.length; i++) { const f = index.childNamed(parentId, segs[i]); if (!f) break; existing.push(f.name); parentId = f.id; }
    const proposal = { path: segs, parentId, newSegments: segs.slice(i) };
    if (proposal.newSegments.length === 0) {
      const f = index.byId.get(parentId);
      return result('high', [{ folderId: f.id, path: index.pathOf(f.id) }], null);
    }
    return result('none', [], proposal);

    function result(confidence, choices, proposal) {
      return { category: category ? category.name : null, categoryId: category ? category.id : null,
        year, confidence, choices, proposal, usedContent, meaningless,
        suggestedName: (meaningless && category)
          ? category.name.replace(/&/g, 'and') + ' ' + new Date().toISOString().slice(0, 10) + splitExt(name).ext
          : cleanName(name, { year: category && category.yearly ? year : null }) };
    }
  }

  function withYear(index, folder, year, category) {
    if (category && category.yearly && year) {
      const sub = index.childNamed(folder.id, String(year));
      if (sub) return { folderId: sub.id, path: index.pathOf(sub.id) };
      // only propose a year subfolder if this folder is already organized by year
      const kids = index.children.get(folder.id) || [];
      const byYear = kids.some(k => /^(19|20)\d{2}$/.test(String(k.name).trim()));
      return { folderId: folder.id, path: index.pathOf(folder.id), missingYear: byYear };
    }
    return { folderId: folder.id, path: index.pathOf(folder.id) };
  }

  // ---------- Voice command parsing ----------
  function similarity(a, b) {
    const A = new Set(contentTokens(a)), B = new Set(contentTokens(b));
    if (!A.size || !B.size) return normalize(a) === normalize(b) ? 1 : 0;
    let inter = 0; for (const t of A) if (B.has(t) || [...B].some(x => stemEq(x, t))) inter++;
    return inter / Math.max(A.size, B.size);
  }
  function stemEq(a, b) {
    const s = w => w.replace(/(ies|es|s)$/, '');
    return s(a) === s(b);
  }

  /**
   * settings: { triggers:[string], shortcuts:[{phrase, path}], confirmWords, cancelWords }
   * returns {type:'auto'} | {type:'shortcut', shortcut} | {type:'folder', query} | {type:'confirm'} | {type:'cancel'} | {type:'unknown', guess}
   */
  function parseCommand(transcript, settings) {
    const t = normalize(transcript);
    if (!t) return { type: 'unknown' };
    const words = t.split(' ');
    const cw = (settings.confirmWords || ['yes', 'ok', 'okay', 'yep', 'yeah', 'sure', 'do it', 'save it', 'confirm']).map(normalize);
    const xw = (settings.cancelWords || ['cancel', 'no', 'stop', 'never mind', 'nevermind']).map(normalize);
    if (xw.includes(t) || (words.length <= 3 && xw.some(w => (' ' + t + ' ').includes(' ' + w + ' ')))) return { type: 'cancel' };
    if (cw.includes(t) || (words.length <= 3 && cw.some(w => (' ' + t + ' ').includes(' ' + w + ' ')))) return { type: 'confirm' };

    // shortcuts
    let bestSc = null, bestScore = 0;
    for (const sc of settings.shortcuts || []) {
      const p = normalize(sc.phrase);
      let s = (' ' + t + ' ').includes(' ' + p + ' ') ? 1 : similarity(sc.phrase, transcript);
      if (s > bestScore) { bestScore = s; bestSc = sc; }
    }
    if (bestSc && bestScore >= 0.67) return { type: 'shortcut', shortcut: bestSc };

    // auto-file triggers
    let bestTrig = 0, bestTrigPhrase = null;
    for (const tr of settings.triggers || []) {
      const s = (' ' + t + ' ').includes(' ' + normalize(tr) + ' ') ? 1 : similarity(tr, transcript);
      if (s > bestTrig) { bestTrig = s; bestTrigPhrase = tr; }
    }
    if (bestTrig >= 0.66) return { type: 'auto', trigger: bestTrigPhrase };

    // "save (this) to my tax folder" → folder search
    const m = t.match(/\b(?:save|put|file|move|store|send)\b.*?\b(?:to|in|into|under)\b\s+(.*)$/);
    if (m) {
      let q = m[1].replace(/\b(my|the|our|a)\b/g, ' ').replace(/\b(folder|directory)\b/g, ' ').replace(/\s+/g, ' ').trim();
      q = q.replace(/\bon (google )?drive\b/, '').replace(/\bin (google )?drive\b/, '').trim();
      if (q && !/^(google drive|drive|google)$/.test(q)) return { type: 'folder', query: q };
      if (q) return { type: 'auto' };
    }
    if (bestTrig >= 0.34 || bestScore >= 0.34) {
      return { type: 'unknown', guess: bestScore > bestTrig ? { type: 'shortcut', shortcut: bestSc } : { type: 'auto', trigger: bestTrigPhrase } };
    }
    return { type: 'unknown' };
  }

  // Find folders by spoken name: "tax" → Taxes, Tax Docs ...
  function searchFolders(index, query) {
    const q = contentTokens(query);
    if (!q.length) return [];
    return index.list.map(f => {
      const ft = contentTokens(f.name);
      let s = 0;
      for (const w of q) {
        if (ft.includes(w)) s += 3;
        else if (ft.some(x => stemEq(x, w))) s += 3;
        else if (ft.some(x => x.startsWith(w) || w.startsWith(x))) s += 1.5;
      }
      if (normalize(f.name) === q.join(' ')) s += 3;
      s -= (f.depth - 1) * 0.3;
      return { folderId: f.id, path: f.path, score: s };
    }).filter(x => x.score >= 1.5).sort((a, b) => b.score - a.score).slice(0, 5);
  }

  // Expand {year} / {month} in a shortcut path
  function expandPath(path, year) {
    const d = new Date();
    return String(path).split('/').map(s => s.trim()).filter(Boolean).map(seg =>
      seg.replace(/\{year\}/gi, String(year || d.getFullYear()))
         .replace(/\{month\}/gi, String(d.getMonth() + 1).padStart(2, '0')));
  }

  const api = { CATEGORIES, normalize, tokens, findYear, isMeaninglessName, classify, buildIndex,
    suggest, parseCommand, searchFolders, expandPath, cleanName, similarity, splitExt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaySaveLogic = api;
})(typeof self !== 'undefined' ? self : this);
