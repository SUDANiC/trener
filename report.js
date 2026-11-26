/* Raport z treningu: czytelne podsumowanie jako PDF lub obrazek do wysłania podopiecznemu */
'use strict';
const Report = (() => {
  const W = 1240, H = 1754, M = 90; // A4 przy ~150 dpi
  const C = { bg: '#ffffff', ink: '#111827', muted: '#6b7280', line: '#e5e7eb', accent: '#2563eb', soft: '#eff6ff', warn: '#d97706', bad: '#dc2626', drop: '#9333ea' };
  const F = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  function wrap(ctx, text, maxW) {
    const words = String(text || '').split(/\s+/), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function setLine(x, mode) {
    const kg = x.kg != null ? fmtNum(x.kg) + ' kg' : '', reps = x.reps != null ? fmtNum(x.reps) + ' powt.' : '', sec = x.sec ? x.sec + ' s' : '';
    const parts = mode === 't' ? [sec || reps, kg] : mode === 'kgt' ? [kg, sec || reps] : mode === 'r' ? [reps, kg, sec] : [kg, reps, sec];
    const t = parts.filter(Boolean).join(' × ');
    return t || x.raw || '–';
  }

  // układ: lista bloków do narysowania; każdy blok zna swoją wysokość
  function layout(c, s) {
    const ctx = document.createElement('canvas').getContext('2d');
    const blocks = [];
    const p = plan(c, s.planId);
    const title = s.members && s.members.length > 1 ? 'Trening wspólny' : (p ? p.name : 'Trening');
    const when = s.date ? new Date(s.date).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
    let nSets = 0, vol = 0, reps = 0;
    for (const en of s.entries) for (const x of en.sets) if (x.type !== 'w') { nSets++; if (typeof x.reps === 'number') reps += x.reps; if (typeof x.kg === 'number' && typeof x.reps === 'number') vol += x.kg * x.reps; }
    blocks.push({ h: 250, draw: (g, y) => {
      g.fillStyle = C.accent; g.fillRect(0, y, W, 10);
      g.fillStyle = C.muted; g.font = F(600, 26); g.fillText('RAPORT Z TRENINGU', M, y + 70);
      g.fillStyle = C.ink; g.font = F(800, 56); g.fillText(c.name, M, y + 140);
      g.font = F(500, 30); g.fillStyle = C.muted;
      g.fillText(`${title}${s.members && s.members.length > 1 ? ' · ' + s.members.join(' + ') : (s.member ? ' · ' + s.member : '')}`, M, y + 190);
      g.fillText(when.charAt(0).toUpperCase() + when.slice(1), M, y + 232);
    } });
    const stats = [[s.dur ? s.dur + ' min' : '–', 'czas'], [String(s.entries.length), 'ćwiczenia'], [String(nSets), 'serie robocze'], [vol ? fmtNum(Math.round(vol)) + ' kg' : String(reps), vol ? 'objętość' : 'powtórzenia']];
    blocks.push({ h: 170, draw: (g, y) => {
      const bw = (W - 2 * M - 3 * 24) / 4;
      stats.forEach(([v, l], i) => {
        const x = M + i * (bw + 24);
        g.fillStyle = C.soft; roundRect(g, x, y + 20, bw, 120, 18); g.fill();
        g.fillStyle = C.accent; g.font = F(800, 40); g.textAlign = 'center'; g.fillText(v, x + bw / 2, y + 82);
        g.fillStyle = C.muted; g.font = F(500, 24); g.fillText(l, x + bw / 2, y + 120); g.textAlign = 'left';
      });
    } });
    const labels = ssLabelsFor(s.entries.map(en => en.ss));
    s.entries.forEach((en, ei) => {
      const ex = exById(c, en.exId) || { name: '?' };
      const mode = exMode(c, ex, en);
      ctx.font = F(700, 36);
      const nameLines = wrap(ctx, (labels[ei] ? labels[ei] + '  ' : '') + ex.name, W - 2 * M - 40);
      ctx.font = F(400, 26);
      const notes = [];
      if (en.swapFor) notes.push('zamiast: ' + exName(c, en.swapFor));
      if (en.note) notes.push('📝 ' + en.note);
      const noteLines = notes.flatMap(n => wrap(ctx, n, W - 2 * M - 40));
      const rows = en.sets.length;
      const h = 40 + nameLines.length * 46 + noteLines.length * 36 + rows * 52 + 34;
      blocks.push({ h, draw: (g, y) => {
        g.strokeStyle = C.line; g.lineWidth = 2; roundRect(g, M, y + 10, W - 2 * M, h - 20, 20); g.stroke();
        let yy = y + 64;
        if (labels[ei]) { g.fillStyle = C.drop; g.fillRect(M, y + 10, 8, h - 20); }
        g.fillStyle = C.ink; g.font = F(700, 36);
        for (const l of nameLines) { g.fillText(l, M + 30, yy); yy += 46; }
        if (en.member && s.members && s.members.length > 1) { g.fillStyle = C.accent; g.font = F(700, 24); g.textAlign = 'right'; g.fillText(en.member, W - M - 30, y + 60); g.textAlign = 'left'; }
        g.font = F(400, 26); g.fillStyle = C.muted;
        for (const l of noteLines) { g.fillText(l, M + 30, yy - 6); yy += 36; }
        en.sets.forEach((x, si) => {
          const lab = setLabel(en.sets, si), t = x.type;
          g.fillStyle = t === 'w' ? '#fef3c7' : t === 'f' ? '#fee2e2' : t === 'd' ? '#f3e8ff' : '#f3f4f6';
          roundRect(g, M + 30, yy - 30, 56, 40, 10); g.fill();
          g.fillStyle = t === 'w' ? C.warn : t === 'f' ? C.bad : t === 'd' ? C.drop : C.ink;
          g.font = F(800, 24); g.textAlign = 'center'; g.fillText(lab, M + 58, yy - 2); g.textAlign = 'left';
          g.fillStyle = C.ink; g.font = F(500, 30); g.fillText(setLine(x, mode), M + 110, yy);
          if (t && STYPES[t]) { g.fillStyle = C.muted; g.font = F(400, 22); g.textAlign = 'right'; g.fillText(STYPES[t][1].toLowerCase(), W - M - 30, yy - 2); g.textAlign = 'left'; }
          yy += 52;
        });
      } });
    });
    return blocks;
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function pages(c, s) {
    const blocks = layout(c, s), out = [];
    let cv = null, g = null, y = 0, n = 0;
    const footer = () => { g.fillStyle = C.muted; g.font = F(400, 20); g.fillText(`Trener · ${c.name}`, M, H - 50); g.textAlign = 'right'; g.fillText(`str. ${n}`, W - M, H - 50); g.textAlign = 'left'; };
    const newPage = () => { if (cv) footer(); cv = document.createElement('canvas'); cv.width = W; cv.height = H; g = cv.getContext('2d'); g.fillStyle = C.bg; g.fillRect(0, 0, W, H); y = n ? 60 : 0; n++; out.push(cv); };
    newPage();
    for (const b of blocks) { if (y + b.h > H - 100 && y > 200) newPage(); b.draw(g, y); y += b.h; }
    footer();
    return out;
  }

  // ---- minimalny PDF z obrazami JPEG (strony A4)
  function pdfFromCanvases(canvases) {
    const enc = new TextEncoder(), parts = [], offsets = [];
    let len = 0;
    const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
    const jpg = cv => { const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
    const nPages = canvases.length, kids = [];
    for (let i = 0; i < nPages; i++) kids.push(`${3 + i * 3} 0 R`);
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const obj = (id, body, stream) => { offsets[id] = len; push(`${id} 0 obj\n${body}\n`); if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); } push('endobj\n'); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`);
    canvases.forEach((cv, i) => {
      const pid = 3 + i * 3, iid = pid + 1, cid = pid + 2, img = jpg(cv);
      const content = enc.encode('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
      obj(pid, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`);
      obj(iid, `<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>`, img);
      obj(cid, `<< /Length ${content.length} >>`, content);
    });
    const total = 2 + nPages * 3, xref = len;
    let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
  }
  function stitch(canvases) { // jeden długi obrazek do komunikatorów
    const out = document.createElement('canvas'); out.width = W;
    const hs = canvases.map((cv, i) => i === canvases.length - 1 ? lastUsed(cv) : cv.height);
    out.height = hs.reduce((a, b) => a + b, 0);
    const g = out.getContext('2d'); let y = 0;
    canvases.forEach((cv, i) => { g.drawImage(cv, 0, 0, W, hs[i], 0, y, W, hs[i]); y += hs[i]; });
    return out;
  }
  function lastUsed(cv) { // przytnij pustą końcówkę ostatniej strony
    const g = cv.getContext('2d'), d = g.getImageData(0, 0, W, H - 120).data;
    for (let y = H - 121; y > 0; y -= 4) { for (let x = 0; x < W; x += 8) { const i = (y * W + x) * 4; if (d[i] < 245 || d[i + 1] < 245) return Math.min(H, y + 60); } }
    return H;
  }
  async function deliver(blob, name, title) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    toast('Raport zapisany w Pobranych');
  }
  function fileBase(c, s) { const d = (s.date || new Date().toISOString()).slice(0, 10); return `trening-${c.name.split(/\s+/)[0].toLowerCase()}-${d}`.replace(/[^a-z0-9ąćęłńóśźż\-]/gi, ''); }
  async function share(c, s, kind) {
    const cvs = pages(c, s);
    if (kind === 'png') { const img = stitch(cvs); const blob = await new Promise(r => img.toBlob(r, 'image/png')); return deliver(blob, fileBase(c, s) + '.png', 'Raport z treningu'); }
    return deliver(pdfFromCanvases(cvs), fileBase(c, s) + '.pdf', 'Raport z treningu');
  }
  function preview(c, s) { const img = stitch(pages(c, s)); return img.toDataURL('image/jpeg', 0.8); }
  function menuFor(c, s) {
    menu([{ label: 'Wyślij jako PDF', icon: '📄', fn: () => share(c, s, 'pdf') },
          { label: 'Wyślij jako obrazek (WhatsApp/Messenger)', icon: '🖼️', fn: () => share(c, s, 'png') },
          { label: 'Podgląd raportu', icon: '👁️', fn: () => modal(`<img src="${preview(c, s)}" style="width:100%;border-radius:12px"><div style="height:10px"></div><button class="btn p w" data-x>Zamknij</button>`, (m, close) => m.querySelector('[data-x]').onclick = close) }]);
  }
  return { share, menuFor, pages, pdfFromCanvases };
})();
