/* Report composer: draggable/resizable map elements on printable pages; PDF / PNG / JPG export */
(function () {
  const G = WP.geo, S = WP.state;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = WP.esc;
  const MM = 96 / 25.4;
  const SIZES = { A4: [297, 210], A3: [420, 297], Letter: [279.4, 215.9] };
  const R = WP.report = { pages: [], size: 'A4', orient: 'landscape', sel: null, scale: 1, seq: 1 };

  const pageMM = () => { const [a, b] = SIZES[R.size]; return R.orient === 'landscape' ? [a, b] : [b, a]; };
  const pagePx = () => pageMM().map(v => Math.round(v * MM));

  /* ---------- page & element DOM ---------- */
  function newPage() { const p = { id: 'p' + (R.seq++), els: [] }; R.pages.push(p); return p; }
  function layoutStage() {
    const stage = $('#report-stage'), [pw, ph] = pagePx();
    const avail = Math.max(300, stage.clientWidth - 48);
    R.scale = Math.min(1, avail / pw);
    $$('#report-stage .page-holder').forEach(h => {
      h.style.width = pw * R.scale + 'px'; h.style.height = ph * R.scale + 'px';
      const pg = h.querySelector('.rpage'); pg.style.width = pw + 'px'; pg.style.height = ph + 'px'; pg.style.transform = `scale(${R.scale})`;
    });
  }
  function renderPages() {
    const stage = $('#report-stage'); stage.innerHTML = '';
    R.pages.forEach((p, i) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="page-label">Page ${i + 1} of ${R.pages.length} · ${R.size} ${R.orient}</div><div class="page-holder"><div class="rpage" data-page="${p.id}"></div></div>`;
      stage.appendChild(wrap);
      const pg = wrap.querySelector('.rpage');
      pg.addEventListener('pointerdown', e => { if (e.target === pg) select(null); R.activePage = p; });
      p.els.forEach(m => pg.appendChild(buildEl(m)));
    });
    layoutStage();
  }
  function pageEl(p) { return document.querySelector(`.rpage[data-page="${p.id}"]`); }
  function place(el, m) { el.style.left = m.x + 'px'; el.style.top = m.y + 'px'; el.style.width = m.w + 'px'; el.style.height = m.h + 'px'; el.style.zIndex = m.z || 1; }
  function applyStyle(el, m) {
    const s = m.style;
    el.style.fontSize = s.fs + 'px'; el.style.fontWeight = s.fw; el.style.color = s.color; el.style.textAlign = s.align;
    el.style.background = s.transparent ? 'transparent' : s.bg;
    el.classList.toggle('b-thin', s.border === 'thin'); el.classList.toggle('b-shadow', s.border === 'shadow');
    if (m.type === 'title') el.style.fontFamily = 'var(--font-display)';
  }
  function buildEl(m) {
    const el = document.createElement('div');
    el.className = 'rel'; el.dataset.id = m.id; el.dataset.type = m.type;
    el.innerHTML = `<div class="body" style="width:100%;height:100%"></div><div class="rh"></div>`;
    place(el, m); applyStyle(el, m); fillBody(el, m);
    el.addEventListener('pointerdown', () => select(m.id));
    el.addEventListener('dblclick', () => {
      const t = el.querySelector('.txt'); if (!t) return;
      t.contentEditable = 'true'; t.focus();
      t.onblur = () => { t.contentEditable = 'false'; m.text = t.innerText; };
    });
    return el;
  }
  function findModel(id) { for (const p of R.pages) { const m = p.els.find(e => e.id === id); if (m) return { m, p }; } return {}; }

  /* ---------- content ---------- */
  function fillBody(el, m) {
    const b = el.querySelector('.body');
    switch (m.type) {
      case 'title': case 'text': case 'footer':
        b.innerHTML = `<div class="txt">${esc(m.text)}</div>`; break;
      case 'image': case 'map': case 'chart': case 'locator':
        b.innerHTML = m.src ? `<img src="${m.src}" alt="">` : `<div class="txt" style="display:grid;place-items:center;color:#8a958f">${m.type === 'map' ? 'Rendering map…' : m.type === 'chart' ? 'Not enough data for this chart yet' : 'Loading…'}</div>`;
        break;
      case 'legend': b.innerHTML = `<div class="lg" style="padding:8px 10px">${WP.legendHTML(WP.legendModel()) || '<i>Compute an index to show a legend.</i>'}</div>`; break;
      case 'north': b.innerHTML = northSVG(); break;
      case 'scalebar': b.innerHTML = scaleSVG(m); break;
      case 'stats': b.innerHTML = statsTable(); break;
      case 'villages': b.innerHTML = villageTable(m); break;
    }
  }
  const northSVG = () => `<svg viewBox="0 0 40 60" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><path d="M20 2 L33 42 L20 34 Z" fill="#1d2420"/><path d="M20 2 L7 42 L20 34 Z" fill="#9aa59f"/><text x="20" y="57" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-weight="700" font-size="13" fill="#1d2420">N</text></svg>`;
  function linkedMap(m) { const { p } = findModel(m.id); return p && p.els.find(e => e.type === 'map' && e.groundMpp); }
  function scaleSVG(m) {
    const mp = linkedMap(m);
    if (!mp) return '<div class="txt" style="color:#8a958f;font-size:11px">Add a map to this page</div>';
    const sb = WP.niceScale(mp.groundMpp, m.w - 30);
    const w = sb.px, h = m.h;
    return `<svg width="100%" height="100%" viewBox="0 0 ${m.w} ${h}"><g transform="translate(8,${h / 2})"><rect x="0" y="0" width="${w / 2}" height="7" fill="#1d2420"/><rect x="${w / 2}" y="0" width="${w / 2}" height="7" fill="#fff" stroke="#1d2420"/><rect x="0" y="0" width="${w}" height="7" fill="none" stroke="#1d2420"/>
      <text x="0" y="-4" font-family="IBM Plex Mono, monospace" font-size="10" fill="#1d2420">0</text><text x="${w}" y="-4" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="10" fill="#1d2420">${sb.label}</text></g></svg>`;
  }
  function statsTable() {
    const st = S.stats, res = WP.activeResult();
    if (!st || !res) return '<div class="txt" style="color:#8a958f">Compute an index to fill this table.</div>';
    const idx = st.key === 'change' ? WP.INDICES[res.baseIndex] : WP.INDICES[res.index];
    const u = idx.unit || '', dp = u === '°C' ? 1 : 3;
    const rows = [['Area', S.aoi.name], ['Scene', st.key === 'change' ? `${S.results.A.scene.date} → ${S.results.B.scene.date}` : WP.sceneLabel(res.scene)], ['Index', (st.key === 'change' ? 'Change in ' : '') + idx.name],
      ['Mean', G.fmt(st.mean, dp) + ' ' + u], ['Median', G.fmt(st.median, dp)], ['Std dev', G.fmt(st.std, dp)], ['Range', `${G.fmt(st.min, 2)} to ${G.fmt(st.max, 2)}`],
      ['Clear area', st.clearPct.toFixed(1) + ' %']].concat(Number.isFinite(st.stressPct) ? [['Stressed area', `${st.stressPct.toFixed(1)} % (${G.fmtInt(st.stressKm2)} km²)`]] : [])
      .concat(Number.isFinite(st.lossPct) ? [['Area losing greenness', st.lossPct.toFixed(1) + ' %']] : []).concat([['Pixel size', Math.round(res.grid.resM) + ' m']]);
    return `<div style="padding:6px 8px"><div style="font-weight:600;margin-bottom:4px">Summary statistics</div><table>${rows.map(r => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}</table></div>`;
  }
  function villageTable(m) {
    const z = S.zonal.villages;
    if (!z) return '<div class="txt" style="color:#8a958f">Compute an index to list villages.</div>';
    const hasStress = z.rows.some(r => Number.isFinite(r.stressPct));
    const rows = z.rows.filter(r => Number.isFinite(r.mean) && r.clearPct > 30).sort((a, b) => hasStress ? b.stressPct - a.stressPct : a.mean - b.mean).slice(0, m.n || 12);
    return `<div style="padding:6px 8px"><div style="font-weight:600;margin-bottom:4px">${hasStress ? 'Villages with the most stressed area' : 'Villages with the lowest mean'}</div><table><tr><th>Village</th><th>Taluka</th><th style="text-align:right">Mean</th>${hasStress ? '<th style="text-align:right">Stress %</th>' : ''}</tr>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.taluka)}</td><td class="n">${G.fmt(r.mean, 3)}</td>${hasStress ? `<td class="n">${r.stressPct.toFixed(0)}</td>` : ''}</tr>`).join('')}</table></div>`;
  }
  function summaryText() {
    const st = S.stats, res = WP.activeResult();
    if (!st || !res) return `Area of interest: ${S.aoi ? S.aoi.name : 'Washim district'}, Maharashtra. Compute an index on the Map tab to generate the assessment text.`;
    const idx = st.key === 'change' ? WP.INDICES[res.baseIndex] : WP.INDICES[res.index];
    if (st.key === 'change') return `Between ${S.results.A.scene.date} and ${S.results.B.scene.date}, mean ${idx.name} over ${S.aoi.name} changed by ${G.fmt(st.mean, 3)}. ${Number.isFinite(st.lossPct) ? st.lossPct.toFixed(1) + '% of the clear area lost greenness (change below −0.03).' : ''} ${st.clearPct.toFixed(0)}% of the area was cloud-free in both scenes.`;
    let t = `On ${res.scene.date}, mean ${idx.name} over ${S.aoi.name} was ${G.fmt(st.mean, idx.unit === '°C' ? 1 : 3)}${idx.unit ? ' ' + idx.unit : ''} (median ${G.fmt(st.median, 3)}), from ${WP.sceneLabel(res.scene)} imagery at ${Math.round(res.grid.resM)} m.`;
    if (Number.isFinite(st.stressPct)) t += ` ${st.stressPct.toFixed(1)}% of the clear area (${G.fmtInt(st.stressKm2)} km²) falls in the stress classes.`;
    const tz = S.zonal.talukas;
    if (tz && tz.rows.length > 1) { const s = tz.rows.filter(r => Number.isFinite(r.mean)).sort((a, b) => a.mean - b.mean); if (s.length > 1) t += ` ${s[0].name} taluka has the lowest mean (${G.fmt(s[0].mean, 3)}) and ${s[s.length - 1].name} the highest (${G.fmt(s[s.length - 1].mean, 3)}).`; }
    t += ` ${st.clearPct.toFixed(0)}% of the area was cloud-free.`;
    return t;
  }
  function tsText() {
    const T = WP.ts; if (!T || !T.ok || !T.ok.length) return '';
    const idx = WP.INDICES[T.index];
    return `${idx.name} time series for ${T.aoi.name}, ${T.rows[0].date} to ${T.rows[T.rows.length - 1].date}: ${T.ok.length} cloud-free dates. Series mean ${G.fmt(T.mean, 3)}, trend ${T.slope >= 0 ? '+' : ''}${G.fmt(T.slope, 4)} per year. Latest value ${G.fmt(T.latest.mean, 3)} on ${T.latest.date}${T.latest.vciClass ? ' (' + T.latest.vciClass.label.toLowerCase() + ', VCI ' + T.latest.vci.toFixed(0) + ')' : ''}. ${Number.isFinite(T.drought) && T.latest.vciClass ? T.drought + ' of ' + T.ok.length + ' dates had VCI below 40.' : ''}`;
  }

  R.pending = new Set();
  function refreshContent(m) { const pr = refreshContentInner(m); R.pending.add(pr); pr.catch(() => {}).finally(() => R.pending.delete(pr)); return pr; }
  async function refreshContentInner(m) {
    const el = document.querySelector(`.rel[data-id="${m.id}"]`);
    if (m.type === 'map') {
      if (el) fillBody(el, Object.assign({}, m, { src: null }));
      try {
        const k = 2, r = await WP.renderMap({ w: Math.round(m.w * k), h: Math.round(m.h * k), extent: m.extent || 'view', scale: 2 });
        m.src = r.canvas.toDataURL('image/jpeg', 0.92); m.groundMpp = r.groundMpp * k;
      } catch (e) { WP.toast('Map render failed: ' + e.message, true); }
      const { p } = findModel(m.id);
      if (p) p.els.filter(e => e.type === 'scalebar').forEach(sb => { const se = document.querySelector(`.rel[data-id="${sb.id}"]`); if (se) fillBody(se, sb); });
    } else if (m.type === 'chart') {
      m.src = WP.chartImage(m.chart || 'hist', Math.round(m.w), Math.round(m.h));
    } else if (m.type === 'locator') {
      m.src = locatorImage(Math.round(m.w * 2), Math.round(m.h * 2));
    } else if (m.type === 'text' && m.auto) { m.text = m.auto === 'ts' ? tsText() : summaryText(); }
    const cur = document.querySelector(`.rel[data-id="${m.id}"]`); // DOM may have been rebuilt meanwhile
    if (cur) fillBody(cur, m);
  }
  function locatorImage(w, h) {
    const fc = S.data.region_districts; const bb = G.bbox({ type: 'GeometryCollection', geometries: fc.features.map(f => f.geometry) });
    const [x0, y0] = G.toMerc(bb[0], bb[1]), [x1, y1] = G.toMerc(bb[2], bb[3]);
    const mpp = Math.max((x1 - x0) / (w * 0.92), (y1 - y0) / (h * 0.92));
    const ox = (x0 + x1) / 2 - w / 2 * mpp, oy = (y0 + y1) / 2 + h / 2 * mpp;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d');
    c.fillStyle = '#f4f6f4'; c.fillRect(0, 0, w, h);
    const P = (lo, la) => { const [x, y] = G.toMerc(lo, la); return [(x - ox) / mpp, (oy - y) / mpp]; };
    const path = g => { c.beginPath(); G.polygons(g).forEach(p => p.forEach(r => { r.forEach(([lo, la], i) => { const [x, y] = P(lo, la); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); })); };
    fc.features.forEach(f => { path(f.geometry); const w_ = f.properties.district === 'Washim'; c.fillStyle = w_ ? '#D9A441' : '#dfe4e0'; c.fill(); c.strokeStyle = '#8a958f'; c.lineWidth = 1.2; c.stroke(); });
    if (S.aoi && S.aoi.level !== 'district') { path(S.aoi.geom); c.strokeStyle = '#1e7a34'; c.lineWidth = 3; c.stroke(); }
    c.font = `600 ${Math.max(9, Math.round(h / 24))}px "IBM Plex Sans", sans-serif`; c.fillStyle = '#1d2420'; c.textAlign = 'center';
    fc.features.forEach(f => { const ct = G.centroid(f.geometry), [x, y] = P(ct[0], ct[1]); c.fillStyle = f.properties.district === 'Washim' ? '#1d2420' : '#6b7771'; c.fillText(f.properties.district, x, y); });
    c.textAlign = 'left'; c.font = `500 ${Math.round(h / 18)}px "IBM Plex Sans", sans-serif`; c.fillStyle = '#56645c'; c.fillText('Vidarbha & Marathwada, Maharashtra', 8, h - 8);
    c.strokeStyle = '#8a958f'; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2);
    return cv.toDataURL('image/png');
  }

  /* ---------- add / select / edit ---------- */
  const DEF = {
    title: { w: 0.62, h: 0.06, style: { fs: 26, fw: 700, color: '#1d2420', align: 'left', border: 'none', transparent: true } },
    text: { w: 0.3, h: 0.14, style: { fs: 11.5, fw: 400, color: '#2d3833', align: 'left', border: 'none', transparent: true } },
    footer: { w: 0.94, h: 0.035, style: { fs: 9, fw: 400, color: '#6b7771', align: 'left', border: 'none', transparent: true } },
    map: { w: 0.62, h: 0.72, style: { border: 'thin', bg: '#ffffff' } },
    legend: { w: 0.28, h: 0.2, style: { fs: 11, fw: 400, color: '#1d2420', border: 'shadow', bg: '#ffffff' } },
    north: { w: 0.04, h: 0.08, style: { transparent: true, border: 'none' } },
    scalebar: { w: 0.2, h: 0.05, style: { bg: '#ffffff', border: 'none', transparent: false } },
    locator: { w: 0.16, h: 0.2, style: { border: 'thin', bg: '#ffffff' } },
    stats: { w: 0.28, h: 0.26, style: { fs: 10.5, fw: 400, color: '#1d2420', border: 'shadow', bg: '#ffffff' } },
    chart: { w: 0.3, h: 0.22, style: { border: 'shadow', bg: '#ffffff' } },
    villages: { w: 0.3, h: 0.34, style: { fs: 10, fw: 400, color: '#1d2420', border: 'shadow', bg: '#ffffff' } },
    image: { w: 0.12, h: 0.1, style: { border: 'none', transparent: true } }
  };
  function add(type, opts = {}, page) {
    page = page || R.activePage || R.pages[0];
    const [pw, ph] = pagePx(), d = DEF[type];
    const style = Object.assign({ fs: 12, fw: 400, color: '#1d2420', bg: '#ffffff', align: 'left', border: 'none', transparent: false }, d.style, opts.style || {});
    const m = Object.assign({ id: 'e' + (R.seq++), type, x: pw * 0.03, y: ph * 0.03, w: d.w * pw, h: d.h * ph, z: page.els.length + 1, style }, opts);
    m.style = style;
    if (opts.fx != null) { m.x = opts.fx * pw; m.y = opts.fy * ph; m.w = opts.fw * pw; m.h = opts.fh * ph; }
    if (type === 'title' && m.text == null) m.text = S.results && WP.activeResult() ? `Washim District · ${WP.legendModel().title}` : 'Washim District · Vegetation & Drought';
    if (type === 'footer' && m.text == null) m.text = `Data: Copernicus Sentinel-2 (ESA) / USGS Landsat Collection 2, accessed via STAC · Boundaries: village polygons with LGD codes · Projection: WGS 84 / Pseudo-Mercator · Prepared ${new Date().toISOString().slice(0, 10)} with the Washim NDVI Drought Portal`;
    if (type === 'text' && m.text == null) { m.auto = m.auto || 'summary'; m.text = m.auto === 'ts' ? tsText() : summaryText(); }
    page.els.push(m);
    const pg = pageEl(page); if (pg) pg.appendChild(buildEl(m));
    if (['map', 'chart', 'locator'].includes(type)) refreshContent(m);
    return m;
  }
  R.add = add;
  function select(id) {
    R.sel = id;
    $$('.rel').forEach(e => e.classList.toggle('sel', e.dataset.id === id));
    const { m } = id ? findModel(id) : {};
    $('#rp-noprops').hidden = !!m; $('#rp-propbody').hidden = !m;
    if (!m) return;
    const txt = ['title', 'text', 'footer', 'legend', 'stats', 'villages'].includes(m.type);
    $('#rp-p-font').hidden = !txt;
    $('#rp-fs').value = m.style.fs; $('#rp-fw').value = m.style.fw; $('#rp-color').value = m.style.color || '#1d2420'; $('#rp-bg').value = m.style.bg || '#ffffff';
    $('#rp-align').value = m.style.align || 'left'; $('#rp-border').value = m.style.border || 'none'; $('#rp-transparent').checked = !!m.style.transparent;
    $('#rp-p-chart').hidden = m.type !== 'chart'; $('#rp-p-map').hidden = m.type !== 'map';
    if (m.type === 'chart') $('#rp-chartsrc').value = m.chart || 'hist';
    if (m.type === 'map') $('#rp-mapext').value = m.extent || 'view';
  }
  function editSel(fn) {
    const { m } = findModel(R.sel); if (!m) return;
    fn(m);
    const el = document.querySelector(`.rel[data-id="${m.id}"]`); if (el) { applyStyle(el, m); place(el, m); }
  }

  /* ---------- auto layout ---------- */
  R.autoLayout = function () {
    R._last = pagePx(); R.pages = []; const p = newPage(); R.activePage = p; renderPages();
    const land = R.orient === 'landscape';
    if (land) {
      add('title', { fx: 0.03, fy: 0.03, fw: 0.62, fh: 0.055 });
      add('text', { fx: 0.03, fy: 0.085, fw: 0.62, fh: 0.035, text: subtitle(), style: { fs: 11, color: '#56645c' } });
      add('map', { fx: 0.03, fy: 0.13, fw: 0.62, fh: 0.8, extent: 'aoi' });
      add('north', { fx: 0.6, fy: 0.145, fw: 0.035, fh: 0.075 });
      add('scalebar', { fx: 0.04, fy: 0.87, fw: 0.2, fh: 0.045 });
      add('locator', { fx: 0.515, fy: 0.745, fw: 0.125, fh: 0.175 });
      add('legend', { fx: 0.67, fy: 0.13, fw: 0.3, fh: 0.24 });
      add('stats', { fx: 0.67, fy: 0.385, fw: 0.3, fh: 0.25 });
      add('chart', { fx: 0.67, fy: 0.645, fw: 0.3, fh: 0.2, chart: S.stats && S.stats.classAreas ? 'class' : 'hist' });
      add('text', { fx: 0.67, fy: 0.85, fw: 0.3, fh: 0.08, auto: 'summary', style: { fs: 8.5 } });
      add('footer', { fx: 0.03, fy: 0.945, fw: 0.94, fh: 0.035 });
    } else {
      add('title', { fx: 0.05, fy: 0.03, fw: 0.9, fh: 0.04 });
      add('text', { fx: 0.05, fy: 0.07, fw: 0.9, fh: 0.025, text: subtitle(), style: { fs: 11, color: '#56645c' } });
      add('map', { fx: 0.05, fy: 0.1, fw: 0.9, fh: 0.5, extent: 'aoi' });
      add('north', { fx: 0.885, fy: 0.11, fw: 0.05, fh: 0.05 });
      add('scalebar', { fx: 0.06, fy: 0.555, fw: 0.28, fh: 0.035 });
      add('locator', { fx: 0.77, fy: 0.47, fw: 0.17, fh: 0.12 });
      add('legend', { fx: 0.05, fy: 0.615, fw: 0.42, fh: 0.15 });
      add('stats', { fx: 0.53, fy: 0.615, fw: 0.42, fh: 0.17 });
      add('chart', { fx: 0.05, fy: 0.78, fw: 0.42, fh: 0.15, chart: S.stats && S.stats.classAreas ? 'class' : 'hist' });
      add('text', { fx: 0.53, fy: 0.79, fw: 0.42, fh: 0.14, auto: 'summary', style: { fs: 10 } });
      add('footer', { fx: 0.05, fy: 0.955, fw: 0.9, fh: 0.03 });
    }
    if (S.zonal.villages || (WP.ts && WP.ts.ok && WP.ts.ok.length)) {
      const p2 = newPage(); renderPages(); R.activePage = p2;
      add('title', { fx: 0.03, fy: 0.03, fw: 0.9, fh: 0.055, text: 'Village, taluka and seasonal detail' }, p2);
      if (WP.ts && WP.ts.ok && WP.ts.ok.length) {
        add('chart', { fx: 0.03, fy: 0.1, fw: 0.62, fh: 0.36, chart: 'ts' }, p2);
        add('chart', { fx: 0.03, fy: 0.48, fw: 0.305, fh: 0.3, chart: 'vci' }, p2);
        add('chart', { fx: 0.345, fy: 0.48, fw: 0.305, fh: 0.3, chart: 'anom' }, p2);
        add('text', { fx: 0.03, fy: 0.8, fw: 0.62, fh: 0.12, auto: 'ts', style: { fs: 11 } }, p2);
      } else {
        add('chart', { fx: 0.03, fy: 0.1, fw: 0.62, fh: 0.4, chart: 'taluka' }, p2);
        add('chart', { fx: 0.03, fy: 0.52, fw: 0.62, fh: 0.38, chart: 'hist' }, p2);
      }
      if (S.zonal.villages) add('villages', { fx: 0.67, fy: 0.1, fw: 0.3, fh: 0.82, n: 22 }, p2);
      add('footer', { fx: 0.03, fy: 0.945, fw: 0.94, fh: 0.035 }, p2);
      R.activePage = R.pages[0];
    }
    select(null);
  };
  function subtitle() {
    const res = WP.activeResult();
    const lm = WP.legendModel();
    return `${S.aoi ? S.aoi.name : 'Washim district'}, Maharashtra${lm ? ' · ' + lm.sub : ''}${res ? ' · ' + Math.round(res.grid.resM) + ' m pixels' : ''}`;
  }
  R.addTimeSeries = function () {
    if (!R.pages.length) R.autoLayout();
    const p = newPage(); renderPages(); R.activePage = p;
    add('title', { fx: 0.03, fy: 0.03, fw: 0.9, fh: 0.055, text: `${WP.INDICES[WP.ts.index].name} time series · ${WP.ts.aoi.name}` }, p);
    add('chart', { fx: 0.03, fy: 0.1, fw: 0.94, fh: 0.4, chart: 'ts' }, p);
    add('chart', { fx: 0.03, fy: 0.52, fw: 0.46, fh: 0.3, chart: 'vci' }, p);
    add('chart', { fx: 0.51, fy: 0.52, fw: 0.46, fh: 0.3, chart: 'anom' }, p);
    add('text', { fx: 0.03, fy: 0.84, fw: 0.94, fh: 0.09, auto: 'ts', style: { fs: 11 } }, p);
    add('footer', { fx: 0.03, fy: 0.945, fw: 0.94, fh: 0.035 }, p);
    setTimeout(() => pageEl(p).scrollIntoView({ behavior: 'smooth' }), 100);
  };

  /* ---------- interact.js drag & resize ---------- */
  function initInteract() {
    interact('.rel').draggable({
      listeners: {
        move(e) { const { m } = findModel(e.target.dataset.id); if (!m || e.target.querySelector('[contenteditable=true]')) return; m.x += e.dx / R.scale; m.y += e.dy / R.scale; place(e.target, m); }
      }
    }).resizable({
      edges: { right: '.rh', bottom: '.rh' },
      listeners: {
        move(e) { const { m } = findModel(e.target.dataset.id); if (!m) return; m.w = Math.max(20, m.w + e.deltaRect.width / R.scale); m.h = Math.max(14, m.h + e.deltaRect.height / R.scale); place(e.target, m); if (m.type === 'scalebar') fillBody(e.target, m); },
        end(e) { const { m } = findModel(e.target.dataset.id); if (m && ['map', 'chart', 'locator'].includes(m.type)) refreshContent(m); }
      }
    });
  }

  /* ---------- export ---------- */
  async function capture(p) {
    if (R.pending.size) { WP.toast('Waiting for map rendering…'); await Promise.all([...R.pending]); }
    const pg = pageEl(p), holder = pg.parentElement;
    select(null);
    const prevT = pg.style.transform; pg.style.transform = 'none';
    try {
      return await html2canvas(pg, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: pg.offsetWidth, height: pg.offsetHeight });
    } finally { pg.style.transform = prevT; }
  }
  async function exportPDF() {
    if (!R.pages.length) return;
    WP.toast('Building PDF…');
    const [wmm, hmm] = pageMM();
    const pdf = new jspdf.jsPDF({ orientation: R.orient, unit: 'mm', format: [wmm, hmm] });
    for (let i = 0; i < R.pages.length; i++) {
      const cv = await capture(R.pages[i]);
      if (i) pdf.addPage([wmm, hmm], R.orient);
      pdf.addImage(cv.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, wmm, hmm);
    }
    pdf.setProperties({ title: 'Washim NDVI drought report', creator: 'Washim NDVI Drought Portal' });
    pdf.save(reportName('pdf'));
  }
  async function exportImg(type) {
    for (let i = 0; i < R.pages.length; i++) {
      const cv = await capture(R.pages[i]);
      await new Promise(res => cv.toBlob(b => { G.download(b, reportName(type, R.pages.length > 1 ? i + 1 : null)); res(); }, type === 'png' ? 'image/png' : 'image/jpeg', 0.93));
    }
  }
  const reportName = (ext, n) => `Washim_report_${(S.aoi ? S.aoi.name : '').replace(/[^\w]+/g, '_')}_${new Date().toISOString().slice(0, 10)}${n ? '_p' + n : ''}.${ext}`;

  /* ---------- wiring ---------- */
  function init() {
    $('#rp-size').onchange = e => { R.size = e.target.value; rescalePages(); };
    $('#rp-orient').onchange = e => { R.orient = e.target.value; R.autoLayout(); };
    $('#rp-template').onclick = () => R.autoLayout();
    $('#rp-addpage').onclick = () => { const p = newPage(); renderPages(); R.activePage = p; add('footer', { fx: 0.03, fy: 0.945, fw: 0.94, fh: 0.035 }, p); pageEl(p).scrollIntoView({ behavior: 'smooth' }); };
    $('#rp-clear').onclick = () => { const p = R.activePage || R.pages[0]; if (!p) return; p.els = []; renderPages(); select(null); };
    $$('[data-add]').forEach(b => b.onclick = () => {
      if (!R.pages.length) { newPage(); renderPages(); }
      const t = b.dataset.add;
      if (t === 'image') return $('#rp-image-file').click();
      const m = add(t, t === 'chart' ? { chart: WP.ts && WP.ts.ok && WP.ts.ok.length && !S.stats ? 'ts' : 'hist' } : {});
      select(m.id);
    });
    $('#rp-image-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader(); rd.onload = () => { const m = add('image', { src: rd.result }); select(m.id); }; rd.readAsDataURL(f); e.target.value = '';
    };
    $('#rp-fs').onchange = e => editSel(m => m.style.fs = +e.target.value);
    $('#rp-fw').onchange = e => editSel(m => m.style.fw = e.target.value);
    $('#rp-color').oninput = e => editSel(m => m.style.color = e.target.value);
    $('#rp-bg').oninput = e => editSel(m => { m.style.bg = e.target.value; m.style.transparent = false; $('#rp-transparent').checked = false; });
    $('#rp-align').onchange = e => editSel(m => m.style.align = e.target.value);
    $('#rp-border').onchange = e => editSel(m => m.style.border = e.target.value);
    $('#rp-transparent').onchange = e => editSel(m => m.style.transparent = e.target.checked);
    $('#rp-chartsrc').onchange = e => { const { m } = findModel(R.sel); if (m) { m.chart = e.target.value; refreshContent(m); } };
    $('#rp-mapext').onchange = e => { const { m } = findModel(R.sel); if (m) { m.extent = e.target.value; refreshContent(m); } };
    $('#rp-refresh').onclick = () => { const { m } = findModel(R.sel); if (!m) return; if (m.auto) m.text = m.auto === 'ts' ? tsText() : summaryText(); refreshContent(m); };
    $('#rp-front').onclick = () => editSel(m => { const { p } = findModel(m.id); m.z = Math.max(...p.els.map(e => e.z || 1)) + 1; });
    $('#rp-del').onclick = () => { const { m, p } = findModel(R.sel); if (!m) return; p.els = p.els.filter(e => e !== m); document.querySelector(`.rel[data-id="${m.id}"]`)?.remove(); select(null); };
    document.addEventListener('keydown', e => {
      if (!$('#view-report').classList.contains('active') || !R.sel || document.activeElement.isContentEditable || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('#rp-del').click(); }
      const d = e.shiftKey ? 10 : 1, mv = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[e.key];
      if (mv) { e.preventDefault(); editSel(m => { m.x += mv[0]; m.y += mv[1]; }); }
    });
    $('#rp-pdf').onclick = () => exportPDF().catch(e => WP.toast('PDF export failed: ' + e.message, true));
    $('#rp-png').onclick = () => exportImg('png').catch(e => WP.toast('PNG export failed: ' + e.message, true));
    $('#rp-jpg').onclick = () => exportImg('jpg').catch(e => WP.toast('JPG export failed: ' + e.message, true));
    $('#rp-print').onclick = () => {
      select(null);
      let st = document.getElementById('print-page-size'); if (!st) { st = document.createElement('style'); st.id = 'print-page-size'; document.head.appendChild(st); }
      const [w, h] = pageMM(); st.textContent = `@page{size:${w}mm ${h}mm;margin:0}`;
      window.print();
    };
    window.addEventListener('resize', layoutStage);
    document.addEventListener('wp:view', e => { if (e.detail === 'report') { if (!R.pages.length) R.autoLayout(); else layoutStage(); } });
    document.addEventListener('wp:results', () => { /* keep existing layout; user can press Refresh or Auto layout */ });
    initInteract();
  }
  function rescalePages() {
    // keep elements proportional when page size changes
    const old = R._last || pagePx(); const [pw, ph] = pagePx();
    R.pages.forEach(p => p.els.forEach(m => { m.x *= pw / old[0]; m.w *= pw / old[0]; m.y *= ph / old[1]; m.h *= ph / old[1]; }));
    R._last = [pw, ph]; renderPages();
    R.pages.forEach(p => p.els.filter(m => ['map', 'chart', 'locator'].includes(m.type)).forEach(refreshContent));
  }
  document.addEventListener('wp:ready', () => { init(); R._last = pagePx(); });
})();
