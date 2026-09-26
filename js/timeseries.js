/* Time-series analysis: monthly index series, VCI drought classes, anomalies, taluka comparison */
(function () {
  const G = WP.geo, E = WP.engine, S = WP.state;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = WP.esc;
  const TS = WP.ts = { rows: [], talukaNames: [] };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const TCOL = ['#7BC67E', '#E7A04C', '#5B9BD5', '#D36BA6', '#C9C35A', '#62C6C0'];
  const VEG = ['ndvi', 'evi', 'savi', 'ndmi'];

  function init() {
    const idx = Object.entries(WP.INDICES).filter(([, v]) => !v.rgb && !v.thermal).map(([k, v]) => `<option value="${k}">${v.name} · ${v.long}</option>`).join('');
    $('#ts-index').innerHTML = idx + '<option value="lst">LST · Land Surface Temperature (Landsat)</option>';
    const now = new Date(), from = new Date(now.getFullYear() - 3, 0, 1);
    $('#ts-to').value = now.toISOString().slice(0, 10); $('#ts-from').value = from.toISOString().slice(0, 10);
    fillAOI();
    document.addEventListener('wp:aoi', fillAOI);
    $('#ts-run').onclick = run;
    $('#ts-stop').onclick = () => ctl && ctl.abort();
    $('#ts-show-tal').onchange = draw;
    $('#ts-index').onchange = () => { if ($('#ts-index').value === 'lst') $('#ts-source').value = 'pc-ls'; };
    $('#ts-csv').onclick = exportCSV;
    $('#ts-png').onclick = () => { const u = WP.chartImage('ts', 1400, 600); if (!u) return WP.toast('Run a time series first.', true); fetch(u).then(r => r.blob()).then(b => G.download(b, fileBase() + '_trend.png')); };
    $('#ts-report').onclick = () => { if (!TS.rows.length) return WP.toast('Run a time series first.', true); WP.switchView('report'); WP.report.addTimeSeries(); };
    const vl = WP.CLASSES.vci;
    $('#vci-legend').innerHTML = vl.map(c => `<span><i style="background:${c.color}"></i>${c.label}</span>`).join('');
  }
  function fillAOI() {
    const cur = $('#ts-aoi').value;
    const opts = [`<option value="current">Current map area · ${esc(S.aoi ? S.aoi.name : '')}</option>`, '<option value="district">Washim district</option>']
      .concat((S.data.talukas || []).map((f, i) => `<option value="t:${i}">${esc(f.properties.taluka)} taluka</option>`));
    $('#ts-aoi').innerHTML = opts.join('');
    if (cur) $('#ts-aoi').value = cur;
  }
  function resolveAOI() {
    const v = $('#ts-aoi').value;
    if (v === 'district') return WP.districtAOI();
    if (v.startsWith('t:')) return WP.talukaAOI(+v.slice(2));
    return S.aoi;
  }
  const fileBase = () => `Washim_${(TS.aoi ? TS.aoi.name : 'area').replace(/[^\w]+/g, '_')}_${TS.index ? WP.INDICES[TS.index].name : ''}_timeseries`;

  let ctl;
  async function run() {
    const aoi = resolveAOI(), idxKey = $('#ts-index').value, idx = WP.INDICES[idxKey];
    const src = WP.sourceDef($('#ts-source').value);
    if (idx.thermal && src.id !== 'pc-ls') return WP.toast('LST needs Landsat. Choose the Landsat source.', true);
    const withTal = $('#ts-talukas').checked;
    const dist = S.data.district.geometry;
    const bbox = withTal ? mergeBBox(G.bbox(dist), G.bbox(aoi.geom)) : G.bbox(aoi.geom);
    const grid = G.makeGrid(bbox, +$('#ts-res').value, 2.5e6);
    const aoiLab = G.rasterize(grid, [{ geometry: aoi.geom }]);
    const talLab = withTal ? G.rasterize(grid, S.data.talukas) : null;
    const union = new Int32Array(aoiLab);
    if (talLab) for (let i = 0; i < union.length; i++) if (talLab[i] >= 0) union[i] = 0;
    const pr = $('#ts-progress');
    ctl = new AbortController();
    $('#ts-run').disabled = true; $('#ts-stop').disabled = false;
    TS.rows = []; TS.aoi = aoi; TS.index = idxKey; TS.withTal = withTal; TS.talukaNames = S.data.talukas.map(f => f.properties.taluka); TS.source = src;
    $('#ts-title').textContent = `${idx.name} trend · ${aoi.name}`;
    try {
      WP.progress(pr, 0.01, 'Searching catalogue…');
      const items = await E.stacSearch({ api: src.api, collection: src.collection, bbox: G.bbox(aoi.geom).map(v => +v.toFixed(5)), from: $('#ts-from').value, to: $('#ts-to').value, maxCloud: +$('#ts-cloud').value, extraQuery: src.query, maxItems: 3000, signal: ctl.signal, onPage: n => WP.progress(pr, 0.02, `Searching catalogue… ${n} items`) });
      let groups = E.groupScenes(items, src).sort((a, b) => a.date.localeCompare(b.date));
      const mode = $('#ts-sample').value;
      if (mode !== 'all') {
        const best = new Map();
        for (const g of groups) {
          const d = g.date, k = mode === 'month' ? d.slice(0, 7) : d.slice(0, 7) + (+d.slice(8, 10) <= 15 ? 'a' : 'b');
          const cur = best.get(k); if (!cur || (g.cloud ?? 100) < (cur.cloud ?? 100)) best.set(k, g);
        }
        groups = [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
      }
      if (groups.length > 150) { groups = groups.slice(-150); WP.toast('Limited to the latest 150 dates. Use monthly sampling for longer periods.'); }
      if (!groups.length) { WP.toast('No scenes found for these settings.', true); return; }
      const minValid = +$('#ts-minvalid').value;
      let done = 0;
      const queue = groups.slice();
      const worker = async () => {
        while (queue.length) {
          const g = queue.shift();
          let row = { date: g.date, platform: g.platform, tiles: g.items.length, cloud: g.cloud, mean: NaN, clearPct: 0, tal: [] };
          try {
            const r = await E.compute(g, idxKey, grid, { cloudMask: true, aoiLabels: union, signal: ctl.signal });
            const za = E.zonal(r, aoiLab, 1, null)[0];
            row.clearPct = za.clearPct; row.rawMean = za.mean;
            row.mean = za.clearPct >= minValid ? za.mean : NaN;
            if (talLab) row.tal = E.zonal(r, talLab, TS.talukaNames.length, null).map(z => z.clearPct >= minValid ? z.mean : NaN);
          } catch (e) { if (e.name === 'AbortError') throw e; row.error = e.message; console.warn(g.date, e); }
          TS.rows.push(row); TS.rows.sort((a, b) => a.date.localeCompare(b.date));
          done++;
          WP.progress(pr, done / groups.length, `${done}/${groups.length} dates · ${g.date}`);
          if (done % 3 === 0 || done === groups.length) { analyse(); draw(); }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      analyse(); draw();
      const used = TS.rows.filter(r => Number.isFinite(r.mean)).length, errs = TS.rows.filter(r => r.error).length;
      WP.toast(`Time series ready: ${used} of ${TS.rows.length} dates were clear enough.` + (errs ? ` ${errs} date(s) failed to load.` : ''));
    } catch (e) {
      if (e.name === 'AbortError') { WP.toast('Time series stopped. Showing dates processed so far.'); analyse(); draw(); }
      else { console.error(e); WP.toast(e.message, true); }
    } finally { $('#ts-run').disabled = false; $('#ts-stop').disabled = true; WP.progress(pr, null); }
  }
  const mergeBBox = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

  function analyse() {
    const ok = TS.rows.filter(r => Number.isFinite(r.mean));
    TS.ok = ok;
    if (!ok.length) return;
    const vals = ok.map(r => r.mean), mn = Math.min(...vals), mx = Math.max(...vals);
    const veg = VEG.includes(TS.index);
    const clim = {};
    ok.forEach(r => { const m = +r.date.slice(5, 7); (clim[m] = clim[m] || []).push(r.mean); });
    TS.rows.forEach(r => {
      r.vci = veg && Number.isFinite(r.mean) && mx > mn ? 100 * (r.mean - mn) / (mx - mn) : NaN;
      r.vciClass = Number.isFinite(r.vci) ? WP.CLASSES.vci[E.classOf(r.vci, WP.CLASSES.vci)] : null;
      const c = clim[+r.date.slice(5, 7)];
      r.anom = Number.isFinite(r.mean) && c && c.length >= 2 ? r.mean - c.reduce((a, b) => a + b, 0) / c.length : NaN;
    });
    // linear trend (per year)
    const t = ok.map(r => Date.parse(r.date) / (365.25 * 864e5)), y = vals;
    const tm = t.reduce((a, b) => a + b, 0) / t.length, ym = y.reduce((a, b) => a + b, 0) / y.length;
    let num = 0, den = 0; t.forEach((ti, i) => { num += (ti - tm) * (y[i] - ym); den += (ti - tm) ** 2; });
    TS.slope = den ? num / den : NaN; TS.mean = ym; TS.min = ok[vals.indexOf(mn)]; TS.max = ok[vals.indexOf(mx)];
    TS.latest = ok[ok.length - 1];
    TS.drought = ok.filter(r => Number.isFinite(r.vci) && r.vci < 40).length;
  }

  function draw() {
    const idx = WP.INDICES[TS.index], ok = TS.ok || [];
    if (!ok.length) { $('#ts-kpis').innerHTML = '<div class="empty">No clear observations yet.</div>'; WP.drawChart('ch-ts', null); WP.drawChart('ch-vci', null); WP.drawChart('ch-anom', null); $('#tbl-ts').innerHTML = ''; return; }
    const dp = idx.unit === '°C' ? 1 : 3, u = idx.unit || '';
    const kp = (k, v, sub, cls = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="u">${sub || ''}</div></div>`;
    const lv = TS.latest;
    $('#ts-kpis').innerHTML =
      kp('Latest', G.fmt(lv.mean, dp) + ' ' + u, lv.date + (lv.vciClass ? ' · ' + lv.vciClass.label : ''), lv.vci < 40 ? 'flag' : 'good') +
      kp('Series mean', G.fmt(TS.mean, dp) + ' ' + u, `${ok.length} clear dates of ${TS.rows.length}`) +
      kp('Trend', (TS.slope >= 0 ? '+' : '') + G.fmt(TS.slope, dp + 1), `${u || 'units'} per year`, TS.slope < 0 && VEG.includes(TS.index) ? 'flag' : '') +
      kp('Lowest', G.fmt(TS.min.mean, dp), TS.min.date) + kp('Highest', G.fmt(TS.max.mean, dp), TS.max.date) +
      (VEG.includes(TS.index) ? kp('Drought dates', TS.drought + ' / ' + ok.length, 'VCI below 40', TS.drought / ok.length > 0.3 ? 'flag' : '') : '');
    WP.drawChart('ch-ts', WP.chartBuilders.ts('dark'));
    WP.drawChart('ch-vci', WP.chartBuilders.vci('dark'));
    WP.drawChart('ch-anom', WP.chartBuilders.anom('dark'));
    $('#anom-note').hidden = TS.rows.some(r => Number.isFinite(r.anom));
    $('#tbl-ts').innerHTML = `<thead><tr><th>Date</th><th>Platform</th><th style="text-align:right">Tiles</th><th style="text-align:right">Scene cloud %</th><th style="text-align:right">Area clear %</th><th style="text-align:right">Mean ${idx.name}</th><th style="text-align:right">VCI</th><th>Drought class</th><th style="text-align:right">Anomaly</th></tr></thead><tbody>` +
      TS.rows.slice().reverse().map(r => `<tr${Number.isFinite(r.mean) ? '' : ' style="opacity:.5"'}><td>${r.date}</td><td>${esc(r.platform)}</td><td class="n">${r.tiles}</td><td class="n">${G.fmt(r.cloud, 1)}</td><td class="n">${G.fmt(r.clearPct, 0)}</td><td class="n">${G.fmt(r.mean, dp)}</td><td class="n">${G.fmt(r.vci, 0)}</td><td>${r.vciClass ? `<span class="pill" style="background:${r.vciClass.color};color:${r.vci < 20 ? '#fff' : '#1b1406'}">${r.vciClass.label}</span>` : (r.error ? 'load error' : Number.isFinite(r.mean) ? '' : 'too cloudy')}</td><td class="n">${Number.isFinite(r.anom) ? (r.anom >= 0 ? '+' : '') + r.anom.toFixed(dp) : '–'}</td></tr>`).join('') + '</tbody>';
  }

  const fmtMs = ms => { const d = new Date(ms), ok = TS.ok || []; const span = ok.length ? Date.parse(ok[ok.length - 1].date) - Date.parse(ok[0].date) : 0; return span < 200 * 864e5 ? d.getUTCDate() + ' ' + MON[d.getUTCMonth()] : MON[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2); };
  WP.chartBuilders.ts = theme => {
    const ok = TS.ok || []; if (!ok.length) return null;
    const T = WP.theme(theme), idx = WP.INDICES[TS.index];
    const showTal = TS.withTal && $('#ts-show-tal').checked;
    const ds = [{ label: TS.aoi.name, data: ok.map(r => ({ x: Date.parse(r.date), y: r.mean })), borderColor: theme === 'light' ? '#2e7d32' : '#D9A441', backgroundColor: theme === 'light' ? 'rgba(46,125,50,.12)' : 'rgba(217,164,65,.14)', fill: !showTal, tension: 0.25, pointRadius: 3, borderWidth: 2.2, pointBackgroundColor: ok.map(r => r.vciClass ? r.vciClass.color : (theme === 'light' ? '#2e7d32' : '#D9A441')) }];
    if (showTal) TS.talukaNames.forEach((n, k) => ds.push({ label: n, data: TS.rows.filter(r => Number.isFinite(r.tal[k])).map(r => ({ x: Date.parse(r.date), y: r.tal[k] })), borderColor: TCOL[k % TCOL.length], borderWidth: 1.4, pointRadius: 1.5, tension: 0.25, fill: false }));
    return {
      type: 'line', data: { datasets: ds },
      options: {
        parsing: true, interaction: { mode: 'nearest', intersect: false },
        plugins: { legend: { display: showTal || theme === 'light', labels: { color: T.text, boxWidth: 12 } }, title: { display: theme === 'light', text: `${idx.name} · ${TS.aoi.name}`, color: T.title },
          tooltip: { callbacks: { title: it => new Date(it[0].parsed.x).toISOString().slice(0, 10) } } },
        scales: { x: { type: 'linear', ticks: { color: T.text, callback: v => fmtMs(v), maxTicksLimit: 12 }, grid: { color: T.grid } }, y: { ticks: { color: T.text }, grid: { color: T.grid }, title: { display: true, text: idx.name + (idx.unit ? ' (' + idx.unit + ')' : ''), color: T.text } } }
      }
    };
  };
  WP.chartBuilders.vci = theme => {
    const ok = (TS.ok || []).filter(r => Number.isFinite(r.vci)); if (!ok.length) return null;
    const T = WP.theme(theme);
    return {
      type: 'bar', data: { labels: ok.map(r => r.date), datasets: [{ data: ok.map(r => r.vci), backgroundColor: ok.map(r => r.vciClass.color), borderRadius: 2, maxBarThickness: 22 }] },
      options: { plugins: { legend: { display: false }, title: { display: theme === 'light', text: 'Vegetation Condition Index', color: T.title } },
        scales: { x: { ticks: { color: T.text, maxTicksLimit: 10, callback: function (v) { const l = this.getLabelForValue(v); return MON[+l.slice(5, 7) - 1] + ' ' + l.slice(2, 4); } }, grid: { display: false } }, y: { min: 0, max: 100, ticks: { color: T.text }, grid: { color: T.grid }, title: { display: true, text: 'VCI (%)', color: T.text } } } }
    };
  };
  WP.chartBuilders.anom = theme => {
    const ok = (TS.ok || []).filter(r => Number.isFinite(r.anom)); if (!ok.length) return null;
    const T = WP.theme(theme);
    return {
      type: 'bar', data: { labels: ok.map(r => r.date), datasets: [{ data: ok.map(r => r.anom), backgroundColor: ok.map(r => r.anom >= 0 ? '#5fae4d' : '#c9531f'), borderRadius: 2, maxBarThickness: 22 }] },
      options: { plugins: { legend: { display: false }, title: { display: theme === 'light', text: 'Anomaly vs same-month mean', color: T.title } },
        scales: { x: { ticks: { color: T.text, maxTicksLimit: 10, callback: function (v) { const l = this.getLabelForValue(v); return MON[+l.slice(5, 7) - 1] + ' ' + l.slice(2, 4); } }, grid: { display: false } }, y: { ticks: { color: T.text }, grid: { color: T.grid } } } }
    };
  };

  function exportCSV() {
    if (!TS.rows.length) return WP.toast('Run a time series first.', true);
    const head = ['date', 'platform', 'tiles', 'scene_cloud_pct', 'area_clear_pct', 'mean', 'vci', 'drought_class', 'anomaly'].concat(TS.withTal ? TS.talukaNames.map(n => 'mean_' + n.replace(/\s+/g, '_')) : []);
    const rows = [head].concat(TS.rows.map(r => [r.date, r.platform, r.tiles, G.fmt(r.cloud, 1), G.fmt(r.clearPct, 1), G.fmt(r.mean, 4), G.fmt(r.vci, 1), r.vciClass ? r.vciClass.label : '', G.fmt(r.anom, 4)].concat(TS.withTal ? TS.talukaNames.map((_, k) => G.fmt(r.tal[k], 4)) : [])));
    G.download(G.csv(rows), fileBase() + '.csv', 'text/csv');
  }

  document.addEventListener('wp:ready', init);
})();
