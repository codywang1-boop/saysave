/* SaySave document scanner: camera photos → cleaned-up pages → PDF (+ text via OCR). No server. */
(function (root) {
  'use strict';

  const MAX_SIDE = 1700;           // long side of each page in pixels (keeps PDFs small)
  const JPEG_Q = 0.82;

  async function loadImage(file) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
      return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
  }

  // Draw a page with rotation + filter. mode: 'doc' (clean black & white-ish) | 'gray' | 'color'
  function render(page) {
    const img = page.img, rot = ((page.rot % 360) + 360) % 360;
    const w0 = img.width, h0 = img.height;
    const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
    const c = document.createElement('canvas');
    const swap = rot === 90 || rot === 270;
    c.width = swap ? h : w; c.height = swap ? w : h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    if (page.mode !== 'color') enhance(g, c.width, c.height, page.mode);
    return c;
  }

  // Grayscale + stretch contrast so paper becomes white and ink becomes dark
  function enhance(g, w, h, mode) {
    const d = g.getImageData(0, 0, w, h), p = d.data, n = w * h;
    const hist = new Uint32Array(256), gray = new Uint8ClampedArray(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) { const v = (p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114) | 0; gray[j] = v; hist[v]++; }
    const pct = q => { let acc = 0; const t = n * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
    const lo = pct(0.03), hi = Math.max(lo + 30, pct(mode === 'doc' ? 0.6 : 0.97));
    const span = hi - lo;
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      let v = (gray[j] - lo) / span; v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (mode === 'doc') v = Math.pow(v, 1.6);       // darken text, keep paper white
      const o = v * 255; p[i] = p[i + 1] = p[i + 2] = o;
    }
    g.putImageData(d, 0, 0);
  }

  function canvasToJpeg(c) {
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', JPEG_Q));
  }

  // Minimal PDF writer: one JPEG per page, page width = US Letter width (612pt)
  async function buildPdf(canvases) {
    const enc = new TextEncoder();
    const parts = []; let len = 0; const offsets = [];
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const N = canvases.length;
    // objects: 1 catalog, 2 pages, then per page: page, image, contents
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const obj = (id, body) => { offsets[id] = len; push(`${id} 0 obj\n`); body(); push('\nendobj\n'); };
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    const kids = []; for (let i = 0; i < N; i++) kids.push(`${3 + i * 3} 0 R`);
    obj(2, () => push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${N} >>`));
    for (let i = 0; i < N; i++) {
      const c = canvases[i];
      const jpg = new Uint8Array(await (await canvasToJpeg(c)).arrayBuffer());
      const pw = 612, ph = Math.round(612 * c.height / c.width);
      const pid = 3 + i * 3, iid = pid + 1, cid = pid + 2;
      obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
      obj(iid, () => { push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); push(jpg); push('\nendstream'); });
      const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
      obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    }
    const total = 3 + N * 3;
    const xref = len;
    let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let id = 1; id < total; id++) x += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  // OCR (reads the words on the first pages) — Tesseract.js, loaded only when needed
  let tessLoading = null;
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve();
    if (!tessLoading) tessLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = res; s.onerror = () => { tessLoading = null; rej(new Error('Could not load the text reader.')); };
      document.head.appendChild(s);
    });
    return tessLoading;
  }
  async function readText(canvases, onProgress) {
    await loadTesseract();
    const worker = await root.Tesseract.createWorker('eng', 1, {
      logger: m => { if (onProgress && m.status) onProgress(m.status, m.progress || 0); }
    });
    let text = '';
    try {
      for (const c of canvases.slice(0, 2)) { const r = await worker.recognize(c); text += r.data.text + '\n'; }
    } finally { await worker.terminate(); }
    return text.replace(/\s+/g, ' ').trim();
  }

  root.SaySaveScan = { loadImage, render, buildPdf, readText };
})(this);
