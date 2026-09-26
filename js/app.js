/* Washim NDVI Drought Portal — map view application */
(function () {
  const G = WP.geo, E = WP.engine;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const S = WP.state = {
    data: {}, aoi: null, source: 'pc-s2', scenes: [], sceneA: null, sceneB: null, custom: null,
    results: {}, view: 'A', display: {}, labelCache: {}, layers: {}, busy: false, zonal: {}
  };

  /* ---------- small UI helpers ---------- */
  let toastT;
  WP.toast = function (msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 7000 : 3500);
  };
  WP.progress = function (el, frac, txt) {
    el.hidden = frac == null;
    if (frac == null) return;
    el.querySelector('.bar').style.width = Math.round(frac * 100) + '%';
    el.querySelector('.ptxt').textContent = txt || '';
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  WP.esc = esc;
  const iso = d => d.toISOString().slice(0, 10);

  /* ---------- Chart.js defaults ---------- */
  Chart.defaults.font.family = '"IBM Plex Sans", system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  Chart.defaults.color = '#92A399';
  Chart.defaults.borderColor = 'rgba(146,163,153,.14)';
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
  WP.theme = t => t === 'light'
    ? { text: '#3d4a43', grid: 'rgba(40,60,50,.12)', title: '#1d2420' }
    : { text: '#92A399', grid: 'rgba(146,163,153,.14)', title: '#E6ECE7' };
  WP.chartBuilders = {};
  WP.chartImage = function (kind, w = 900, h = 420) {
    const b = WP.chartBuilders[kind]; if (!b) return null;
    const cfg = b('light'); if (!cfg) return null;
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px`;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; holder.appendChild(cv); document.body.appendChild(holder);
    cfg.options = Object.assign({}, cfg.options, { responsive: false, animation: false, devicePixelRatio: 2 });
    const ch = new Chart(cv, cfg);
    const url = ch.toBase64Image('image/png', 1);
    ch.destroy(); holder.remove();
    return url;
  };
  const charts = {};
  function drawChart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = cfg ? new Chart($('#' + id), cfg) : null; }
  WP.drawChart = drawChart;

  /* ---------- colour helpers ---------- */
  const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  WP.rampLUT = function (name) {
    const st = WP.RAMPS[name].stops.map(hex2rgb), lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255 * (st.length - 1), k = Math.min(st.length - 2, Math.floor(t)), f = t - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = st[k][c] + (st[k + 1][c] - st[k][c]) * f;
    }
    return lut;
  };
  WP.rampColor = function (name, t) {
    const lut = WP.rampLUT(name), i = Math.max(0, Math.min(255, Math.round(t * 255)));
    return `rgb(${lut[i * 3]},${lut[i * 3 + 1]},${lut[i * 3 + 2]})`;
  };
  WP.rampCSS = name => `linear-gradient(90deg,${WP.RAMPS[name].stops.join(',')})`;

  /* ---------- map ---------- */
  const map = L.map('map', { zoomControl: true, preferCanvas: false, attributionControl: true }).setView([20.25, 77.15], 9);
  WP.map = map;
  map.createPane('results'); map.getPane('results').style.zIndex = 390;
  map.createPane('vectors'); map.getPane('vectors').style.zIndex = 420;
  const vecRenderer = L.canvas({ pane: 'vectors', padding: 0.3 });
  let baseLayer = null;
  function setBasemap(k) {
    if (baseLayer) map.removeLayer(baseLayer);
    const b = WP.BASEMAPS[k]; S.basemap = k;
    baseLayer = b.url ? L.tileLayer(b.url, { attribution: b.attr, maxZoom: b.max, subdomains: b.sub || 'abc', crossOrigin: 'anonymous' }).addTo(map) : null;
  }
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
  map.on('mousemove', e => { $('#map-status').textContent = `${e.latlng.lat.toFixed(5)}°N  ${e.latlng.lng.toFixed(5)}°E`; });

  /* ---------- boundaries ---------- */
  async function loadData() {
    const names = ['region_districts', 'washim_district', 'washim_talukas', 'washim_villages'];
    const got = await Promise.all(names.map(n => fetch(`data/${n}.geojson`).then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
    names.forEach((n, i) => S.data[n] = got[i]);
    S.data.villages = S.data.washim_villages.features;
    S.data.villages.forEach((f, i) => { f.properties._id = i; f._bbox = G.bbox(f.geometry); });
    S.data.talukas = S.data.washim_talukas.features.sort((a, b) => a.properties.taluka.localeCompare(b.properties.taluka));
    S.data.talukas.forEach((f, i) => { f.properties._id = i; f._bbox = G.bbox(f.geometry); });
    S.data.district = S.data.washim_district.features[0];
  }

  function buildLayers() {
    const L_ = S.layers;
    L_.region = L.geoJSON(S.data.region_districts, { pane: 'vectors', renderer: vecRenderer, interactive: false, style: { color: '#c9d3cd', weight: 1, opacity: 0.55, fill: false, dashArray: '4 4' } });
    L_.regionLabels = L.layerGroup(S.data.region_districts.features.filter(f => f.properties.district !== 'Washim').map(f => {
      const c = G.centroid(f.geometry); return L.tooltip({ permanent: true, direction: 'center', className: 'lbl-region' }).setLatLng([c[1], c[0]]).setContent(f.properties.district);
    }));
    L_.district = L.geoJSON(S.data.washim_district, { pane: 'vectors', renderer: vecRenderer, interactive: false, style: { color: '#D9A441', weight: 3, fill: false } });
    L_.taluka = L.geoJSON(S.data.washim_talukas, { pane: 'vectors', renderer: vecRenderer, interactive: false, style: { color: '#ffffff', weight: 1.4, opacity: 0.9, fill: false } });
    L_.talukaLabels = L.layerGroup(S.data.talukas.map(f => { const c = G.centroid(f.geometry); return L.tooltip({ permanent: true, direction: 'center', className: 'lbl-taluka' }).setLatLng([c[1], c[0]]).setContent(f.properties.taluka); }));
    L_.village = L.geoJSON(S.data.washim_villages, { pane: 'vectors', renderer: vecRenderer, interactive: false, style: villageStyle });
    L_.aoi = L.geoJSON(null, { pane: 'vectors', renderer: vecRenderer, interactive: false, style: { color: '#7BC67E', weight: 2.5, dashArray: '6 4', fill: false } }).addTo(map);
    syncLayerToggles();
  }
  function villageStyle(f) {
    const z = S.zonal.villages, choro = $('#lyr-choro').checked && z;
    if (!choro) return { color: '#e8efe9', weight: 0.5, opacity: 0.55, fill: false };
    const zz = z.byId[f.properties._id];
    if (!zz || !Number.isFinite(zz.mean)) return { color: '#e8efe9', weight: 0.4, opacity: 0.4, fillOpacity: 0 };
    return { color: '#1b231f', weight: 0.4, opacity: 0.8, fillColor: colorForValue(zz.mean, z.key), fillOpacity: 0.85 };
  }
  WP.villageStyle = villageStyle;
  function syncLayerToggles() {
    const L_ = S.layers, on = (l, v) => v ? l.addTo(map) : map.removeLayer(l);
    on(L_.region, $('#lyr-region').checked); on(L_.regionLabels, $('#lyr-region').checked);
    on(L_.district, $('#lyr-district').checked);
    on(L_.taluka, $('#lyr-taluka').checked); on(L_.talukaLabels, $('#lyr-taluka').checked);
    const showV = $('#lyr-village').checked || $('#lyr-choro').checked;
    on(L_.village, showV);
    if (showV) L_.village.setStyle(villageStyle);
  }

  /* ---------- AOI ---------- */
  function setAOI(aoi, fit = true) {
    S.aoi = aoi;
    aoi.bbox = G.bbox(aoi.geom);
    aoi.areaKm2 = G.areaKm2(aoi.geom);
    S.layers.aoi.clearLayers();
    if (aoi.level !== 'district') S.layers.aoi.addData(aoi.geom);
    $('#aoi-chip').textContent = `${aoi.name} · ${G.fmtInt(aoi.areaKm2)} km²`;
    if (fit) map.fitBounds([[aoi.bbox[1], aoi.bbox[0]], [aoi.bbox[3], aoi.bbox[2]]], { padding: [30, 30] });
    document.dispatchEvent(new CustomEvent('wp:aoi'));
  }
  WP.setAOI = setAOI;
  function districtAOI() { return { name: 'Washim district', level: 'district', geom: S.data.district.geometry }; }
  WP.districtAOI = districtAOI;
  function talukaAOI(i) { const f = S.data.talukas[i]; return { name: f.properties.taluka + ' taluka', level: 'taluka', geom: f.geometry, id: i }; }
  WP.talukaAOI = talukaAOI;
  function villageAOI(i) { const f = S.data.villages[i]; return { name: `${f.properties.village} (${f.properties.taluka})`, level: 'village', geom: f.geometry, id: i }; }
  WP.villageAOI = villageAOI;

  function initAOIControls() {
    const tal = S.data.talukas.map((f, i) => `<option value="${i}">${esc(f.properties.taluka)}</option>`).join('');
    $('#sel-taluka').innerHTML = tal;
    $('#sel-vtaluka').innerHTML = '<option value="">All talukas</option>' + tal;
    fillVillageList();
    $$('#aoi-level button').forEach(b => b.onclick = () => {
      $$('#aoi-level button').forEach(x => x.classList.toggle('on', x === b));
      const lv = b.dataset.level;
      $('#row-taluka').hidden = lv !== 'taluka'; $('#row-village').hidden = lv !== 'village'; $('#row-custom').hidden = lv !== 'custom';
      if (lv === 'district') setAOI(districtAOI());
      if (lv === 'taluka') setAOI(talukaAOI(+$('#sel-taluka').value));
      if (lv === 'village') { $('#lyr-village').checked = true; syncLayerToggles(); }
    });
    $('#sel-taluka').onchange = e => setAOI(talukaAOI(+e.target.value));
    $('#sel-vtaluka').onchange = fillVillageList;
    $('#inp-vsearch').onchange = e => {
      const v = e.target.value.trim().toLowerCase();
      const idx = S.data.villages.findIndex(f => `${f.properties.village} · ${f.properties.taluka}`.toLowerCase() === v || f.properties.village.toLowerCase() === v);
      if (idx >= 0) setAOI(villageAOI(idx)); else WP.toast('No village with that name in Washim district.', true);
    };
    const drawOpts = { shapeOptions: { color: '#7BC67E', weight: 2 } };
    $('#btn-draw-poly').onclick = () => new L.Draw.Polygon(map, drawOpts).enable();
    $('#btn-draw-rect').onclick = () => new L.Draw.Rectangle(map, drawOpts).enable();
    map.on(L.Draw.Event.CREATED, e => setAOI({ name: 'Drawn area', level: 'custom', geom: e.layer.toGeoJSON().geometry }));
    $('#inp-aoi-file').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        let gj;
        if (/\.zip$/i.test(f.name)) { gj = await shp(await f.arrayBuffer()); if (Array.isArray(gj)) gj = { type: 'FeatureCollection', features: gj.flatMap(x => x.features) }; }
        else gj = JSON.parse(await f.text());
        const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj }];
        const geom = G.unionGeom(feats.filter(x => x.geometry && /Polygon/.test(x.geometry.type)));
        if (!geom.coordinates.length) throw new Error('The file has no polygons.');
        const b = G.bbox(geom);
        if (Math.abs(b[0]) > 180 || Math.abs(b[1]) > 90) throw new Error('Coordinates are not in WGS 84 longitude/latitude. Re-export the file in EPSG:4326.');
        setAOI({ name: f.name.replace(/\.(zip|geojson|json)$/i, ''), level: 'custom', geom });
      } catch (err) { WP.toast('Could not read the AOI file: ' + err.message, true); }
      e.target.value = '';
    };
  }
  function fillVillageList() {
    const t = $('#sel-vtaluka').value;
    const tname = t === '' ? null : S.data.talukas[+t].properties.taluka;
    $('#dl-villages').innerHTML = S.data.villages.filter(f => !tname || f.properties.taluka === tname)
      .map(f => `<option value="${esc(f.properties.village)} · ${esc(f.properties.taluka)}"></option>`).join('');
  }

  /* ---------- source UI ---------- */
  function initSourceControls() {
    const today = new Date(), from = new Date(Date.now() - 60 * 864e5);
    $('#inp-to').value = iso(today); $('#inp-from').value = iso(from);
    $('#inp-cloud').oninput = e => $('#lbl-cloud').textContent = e.target.value + '%';
    $('#sel-source').onchange = e => {
      S.source = e.target.value;
      $('#src-search').hidden = !['pc-s2', 'es-s2', 'pc-ls', 'stac'].includes(S.source);
      $('#src-stac').hidden = S.source !== 'stac';
      $('#src-url').hidden = S.source !== 'url';
      $('#src-upload').hidden = S.source !== 'upload';
      $('#band-map').hidden = true;
      $('#sel-res').value = S.source === 'pc-ls' ? '30' : $('#sel-res').value;
    };
    $('#btn-search').onclick = searchScenes;
    $('#btn-load-item').onclick = loadItemURL;
    $('#btn-load-cogs').onclick = () => {
      const urls = $('#inp-cog-urls').value.split(/\s+/).map(s => s.trim()).filter(Boolean);
      if (!urls.length) return WP.toast('Paste at least one COG URL.', true);
      inspectCustom(urls.map(href => ({ href })));
    };
    const drop = $('#src-upload .file-drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { const fs = [...e.dataTransfer.files].filter(f => /\.tiff?$/i.test(f.name)); if (fs.length) inspectCustom(fs.map(file => ({ file }))); });
    $('#inp-tif').onchange = e => { const fs = [...e.target.files]; if (fs.length) inspectCustom(fs.map(file => ({ file }))); };
    $('#btn-use-custom').onclick = useCustomScene;
  }

  function currentSourceDef() {
    if (S.source === 'stac') {
      const api = $('#inp-stac-api').value.trim(), collection = $('#inp-stac-col').value.trim();
      return { id: 'stac', label: 'Custom STAC', short: collection, api, collection, bands: null };
    }
    return Object.assign({ id: S.source }, WP.SOURCES[S.source]);
  }
  WP.currentSourceDef = currentSourceDef;
  WP.sourceDef = function (id) {
    if (id === 'stac') return { id: 'stac', label: 'Custom STAC', short: $('#inp-stac-col').value.trim(), api: $('#inp-stac-api').value.trim(), collection: $('#inp-stac-col').value.trim(), bands: null };
    return Object.assign({ id }, WP.SOURCES[id]);
  };

  let searchCtl;
  async function searchScenes() {
    const src = currentSourceDef();
    if (!src.api || !src.collection) return WP.toast('Enter the STAC API URL and collection id.', true);
    const aoi = S.aoi, btn = $('#btn-search');
    if (searchCtl) searchCtl.abort();
    searchCtl = new AbortController();
    btn.disabled = true; btn.textContent = 'Searching…';
    $('#scene-list').innerHTML = '';
    try {
      const items = await E.stacSearch({
        api: src.api, collection: src.collection, bbox: aoi.bbox.map(v => +v.toFixed(5)), from: $('#inp-from').value, to: $('#inp-to').value,
        maxCloud: +$('#inp-cloud').value, extraQuery: src.query, maxItems: 400, signal: searchCtl.signal,
        onPage: n => btn.textContent = `Searching… ${n} items`
      });
      S.scenes = E.groupScenes(items, src);
      S.scenes.forEach(s => s.sourceId = src.id);
      renderSceneList();
      if (!S.scenes.length) WP.toast('No scenes match. Widen the dates or raise the cloud limit.');
    } catch (e) {
      if (e.name !== 'AbortError') { WP.toast(e.message.includes('Failed to fetch') ? 'Could not reach the STAC catalogue. Check your connection or the API URL.' : e.message, true); console.error(e); }
    } finally { btn.disabled = false; btn.textContent = 'Search scenes'; }
  }

  function renderSceneList() {
    const el = $('#scene-list');
    if (!S.scenes.length) { el.innerHTML = ''; return; }
    el.innerHTML = `<div class="scene-count">${S.scenes.length} dates · ${S.scenes.reduce((a, s) => a + s.items.length, 0)} tiles. Choose A (and B to compare).</div>` +
      S.scenes.map((s, i) => `
      <div class="scene ${S.sceneA === s ? 'selA' : ''} ${S.sceneB === s ? 'selB' : ''}" data-i="${i}">
        ${s.thumb ? `<img loading="lazy" src="${esc(s.thumb)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb-ph'}))">` : '<div class="thumb-ph"></div>'}
        <div class="meta"><div class="d">${s.date}</div>
          <div class="s">${esc(s.platform)} · ${s.items.length} tile${s.items.length > 1 ? 's' : ''} · ${s.cloud == null ? 'cloud n/a' : s.cloud.toFixed(1) + '% cloud'}</div>
          <div class="cloudbar"><i style="width:${Math.min(100, s.cloud || 0)}%"></i></div></div>
        <div class="ab"><button class="a ${S.sceneA === s ? 'on' : ''}" data-set="A" title="Use as scene A">A</button><button class="b ${S.sceneB === s ? 'on' : ''}" data-set="B" title="Use as scene B">B</button></div>
      </div>`).join('');
    el.querySelectorAll('.ab button').forEach(b => b.onclick = () => {
      const s = S.scenes[+b.closest('.scene').dataset.i];
      if (b.dataset.set === 'A') { S.sceneA = S.sceneA === s ? null : s; } else { S.sceneB = S.sceneB === s ? null : s; if (S.sceneB) $('#sel-compare').value = 'on'; }
      renderSceneList(); renderSlots(); updatePreview();
    });
  }
  function sceneLabel(s) { return s ? `${s.date} · ${s.platform}${s.items && s.items.length > 1 ? ' · ' + s.items.length + ' tiles' : ''}` : ''; }
  WP.sceneLabel = sceneLabel;
  function renderSlots() {
    [['A', S.sceneA, 'No scene chosen'], ['B', S.sceneB, 'Optional comparison scene']].forEach(([k, s, ph]) => {
      const el = $('#slot-' + k); el.classList.toggle('set', !!s); el.querySelector('.slot-txt').textContent = s ? sceneLabel(s) : ph;
    });
  }

  /* STAC item URL */
  async function loadItemURL() {
    const url = $('#inp-item-url').value.trim();
    if (!url) return WP.toast('Paste a STAC item URL.', true);
    try {
      const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const items = j.type === 'FeatureCollection' ? j.features : [j];
      const scenes = E.groupScenes(items, null);
      const missing = ['red', 'nir'].filter(b => !scenes[0].items[0].bands[b]);
      if (missing.length) throw new Error('Could not find ' + missing.join(' and ') + ' assets. Assets in this item: ' + Object.keys(items[0].assets).join(', '));
      S.scenes = scenes.concat(S.scenes.filter(s => !scenes.some(n => n.key === s.key)));
      S.sceneA = scenes[0]; renderSceneList(); renderSlots();
      WP.toast(`Loaded ${items.length} item(s): bands ${Object.keys(scenes[0].items[0].bands).join(', ')}.`);
    } catch (e) { WP.toast('Could not load the STAC item: ' + e.message, true); }
  }

  /* COG URLs / uploads with band mapping */
  async function inspectCustom(list) {
    try {
      WP.toast('Reading image headers…');
      const infos = await E.inspectSources(list);
      S.custom = { infos };
      const opts = [];
      infos.forEach((inf, fi) => { for (let b = 0; b < inf.spp; b++) opts.push({ v: fi + ':' + b, t: inf.spp > 1 ? `${inf.name} · band ${b + 1}` : inf.name }); });
      const guess = {};
      let landsat = false;
      infos.forEach((inf, fi) => {
        if (inf.spp === 1) { const g = E.guessBandFromName(inf.name); if (g.common && !guess[g.common]) guess[g.common] = fi + ':0'; landsat = landsat || g.landsat; }
        else {
          const order = inf.spp >= 6 ? ['blue', 'green', 'red', 'nir', 'swir1', 'swir2'] : inf.spp === 4 ? ['blue', 'green', 'red', 'nir'] : inf.spp === 3 ? ['red', 'green', 'blue'] : [];
          order.forEach((c, b) => { if (!guess[c]) guess[c] = fi + ':' + b; });
        }
      });
      const commons = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'lwir', 'qa'];
      $('#band-map-rows').innerHTML = commons.map(c => `<div class="row"><label for="bm-${c}">${WP.BAND_LABELS[c]}</label><select id="bm-${c}"><option value="">—</option>${opts.map(o => `<option value="${o.v}" ${guess[c] === o.v ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></div>`).join('');
      const maxv = Math.max(...infos.map(i => i.maxv));
      if (landsat) { $('#inp-scale').value = 0.0000275; $('#inp-offset').value = -0.2; $('#inp-tscale').value = 0.00341802; $('#inp-toffset').value = 149; }
      else if (maxv <= 1.5) { $('#inp-scale').value = 1; $('#inp-offset').value = 0; }
      else { $('#inp-scale').value = 0.0001; $('#inp-offset').value = 0; }
      const dm = (infos[0].name.match(/(20\d{2})(\d{2})(\d{2})/) || []);
      $('#inp-scene-date').value = dm[1] ? `${dm[1]}-${dm[2]}-${dm[3]}` : iso(new Date());
      $('#band-map').hidden = false;
      const outside = infos.filter(i => !i.epsg);
      WP.toast(`${infos.length} file(s) · ${opts.length} band(s)` + (outside.length ? ' · warning: some files have no CRS' : '') + '. Check the band mapping, then press "Use as scene".');
    } catch (e) { console.error(e); WP.toast('Could not read the GeoTIFF: ' + e.message, true); }
  }
  function useCustomScene() {
    const infos = S.custom && S.custom.infos; if (!infos) return;
    const sc = +$('#inp-scale').value, of = +$('#inp-offset').value, tsc = +$('#inp-tscale').value, tof = +$('#inp-toffset').value;
    const bands = {}; let maskType = null;
    ['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'lwir', 'qa'].forEach(c => {
      const v = $('#bm-' + c).value; if (!v) return;
      const [fi, b] = v.split(':').map(Number), inf = infos[fi];
      const base = Object.assign({}, inf.src, { sample: b, nodata: inf.nodata != null ? inf.nodata : 0 });
      if (c === 'qa') { base.scale = 1; base.offset = 0; maskType = /scl/i.test(inf.name) ? 'scl' : /qa_pixel/i.test(inf.name) ? 'landsat' : /fmask/i.test(inf.name) ? 'fmask' : null; if (!maskType) return; }
      else if (c === 'lwir') { base.scale = tsc; base.offset = tof; }
      else { base.scale = sc; base.offset = of; }
      bands[c] = base;
    });
    if (!bands.red || !bands.nir) return WP.toast('Map at least the Red and NIR bands.', true);
    const date = $('#inp-scene-date').value || iso(new Date());
    const scene = { key: 'custom-' + Date.now(), date, datetime: date, platform: S.source === 'upload' ? 'Uploaded image' : 'COG', items: [{ id: infos.map(i => i.name).join('+'), bands, maskType, props: {}, epsg: infos[0].epsg, cloud: null }], cloud: null, custom: true, emissivity: $('#chk-emis').checked };
    S.scenes.unshift(scene);
    S.sceneA = scene;
    renderSceneList(); renderSlots();
    // zoom to image if it's outside the current AOI
    const b = infos[0].bbox;
    WP.toast('Custom scene ready. Choose an index and press Compute.');
  }

  /* true-colour preview (Planetary Computer data API) */
  let previewGroup = null;
  async function updatePreview() {
    if (previewGroup) { map.removeLayer(previewGroup); previewGroup = null; }
    if (!$('#lyr-preview').checked || !S.sceneA) return;
    const tj = S.sceneA.items.filter(i => i.tilejson);
    if (!tj.length) { WP.toast('Tile preview is available for Planetary Computer scenes only.'); return; }
    previewGroup = L.layerGroup().addTo(map);
    for (const it of tj) {
      try { const j = await (await fetch(it.tilejson)).json(); L.tileLayer(j.tiles[0], { pane: 'results', opacity: 1, maxZoom: 18 }).addTo(previewGroup); }
      catch (e) { console.warn(e); }
    }
  }

  /* ---------- index / display controls ---------- */
  function initIndexControls() {
    const opts = Object.entries(WP.INDICES).map(([k, v]) => `<option value="${k}">${v.name} · ${v.long}</option>`).join('');
    $('#sel-index').innerHTML = opts;
    $('#sel-index').onchange = () => { const i = WP.INDICES[$('#sel-index').value]; $('#index-note').textContent = `${i.formula}. ${i.use}`; };
    $('#sel-index').onchange();
    $('#sel-ramp').innerHTML = Object.entries(WP.RAMPS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    $('#sel-basemap').innerHTML = Object.entries(WP.BASEMAPS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    $('#sel-basemap').onchange = e => setBasemap(e.target.value);
    const onDisp = () => {
      const d = activeDisplay(); if (!d) return;
      d.ramp = $('#sel-ramp').value; d.mode = $('#sel-mode').value; d.vmin = +$('#inp-vmin').value; d.vmax = +$('#inp-vmax').value;
      refreshView();
    };
    ['#sel-ramp', '#sel-mode', '#inp-vmin', '#inp-vmax'].forEach(s => $(s).addEventListener('change', onDisp));
    $('#inp-opacity').oninput = e => { $('#lbl-op').textContent = e.target.value + '%'; Object.values(S.overlays || {}).forEach(o => o && o.setOpacity(e.target.value / 100)); };
    ['#lyr-region', '#lyr-district', '#lyr-taluka', '#lyr-village', '#lyr-choro'].forEach(s => $(s).onchange = syncLayerToggles);
    $('#lyr-preview').onchange = updatePreview;
    $$('#view-seg button').forEach(b => b.onclick = () => setView(b.dataset.v));
    $('#btn-compute').onclick = compute;
  }

  function productKey(view) { return view === 'swipe' ? 'B' : view; }
  function activeResult() { return S.results[productKey(S.view)]; }
  WP.activeResult = activeResult;
  function displayFor(key) {
    const res = S.results[key]; if (!res) return null;
    if (!S.display[key]) {
      if (res.rgb) S.display[key] = { rgb: true };
      else if (key === 'change') S.display[key] = { ramp: 'rdbu', vmin: -0.3, vmax: 0.3, mode: 'stretch', classes: WP.INDICES[res.baseIndex].classes === 'ndvi' ? 'change' : null };
      else { const i = WP.INDICES[res.index]; S.display[key] = { ramp: i.ramp, vmin: i.range[0], vmax: i.range[1], mode: 'stretch', classes: i.classes }; }
    }
    return S.display[key];
  }
  function activeDisplay() { return displayFor(productKey(S.view)); }
  WP.activeDisplay = activeDisplay;
  function syncDisplayInputs() {
    const d = activeDisplay(); if (!d || d.rgb) return;
    $('#sel-ramp').value = d.ramp; $('#sel-mode').value = d.mode; $('#inp-vmin').value = d.vmin; $('#inp-vmax').value = d.vmax;
    $('#sel-mode').querySelector('[value=class]').disabled = !d.classes;
  }
  function colorForValue(v, key) {
    const d = displayFor(key);
    if (d.mode === 'class' && d.classes) return WP.CLASSES[d.classes].items[E.classOf(v, WP.CLASSES[d.classes].items)].color;
    const t = (v - d.vmin) / (d.vmax - d.vmin);
    return WP.rampColor(d.ramp, Math.max(0, Math.min(1, t)));
  }
  WP.colorForValue = colorForValue;

  /* result → coloured canvas */
  function renderCanvas(res, disp) {
    const g = res.grid, cv = document.createElement('canvas'); cv.width = g.w; cv.height = g.h;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(g.w, g.h), px = img.data, N = g.w * g.h;
    if (res.rgb) {
      const lims = res.data.map(ch => { const s = []; const st = Math.max(1, Math.floor(N / 200000)); for (let i = 0; i < N; i += st) if (ch[i] === ch[i]) s.push(ch[i]); s.sort((a, b) => a - b); return [s[Math.floor(s.length * 0.02)] || 0, s[Math.floor(s.length * 0.98)] || 0.3]; });
      for (let i = 0; i < N; i++) {
        const r = res.data[0][i]; if (r !== r) continue;
        for (let c = 0; c < 3; c++) { const [lo, hi] = lims[c]; px[i * 4 + c] = 255 * Math.pow(Math.max(0, Math.min(1, (res.data[c][i] - lo) / (hi - lo))), 0.85); }
        px[i * 4 + 3] = 255;
      }
    } else if (disp.mode === 'class' && disp.classes) {
      const items = WP.CLASSES[disp.classes].items, cols = items.map(c => hex2rgb(c.color));
      for (let i = 0; i < N; i++) { const v = res.data[i]; if (v !== v) continue; const c = cols[E.classOf(v, items)]; px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
    } else {
      const lut = WP.rampLUT(disp.ramp), lo = disp.vmin, span = (disp.vmax - disp.vmin) || 1;
      for (let i = 0; i < N; i++) {
        const v = res.data[i]; if (v !== v) continue;
        let k = Math.round((v - lo) / span * 255); k = k < 0 ? 0 : k > 255 ? 255 : k;
        px[i * 4] = lut[k * 3]; px[i * 4 + 1] = lut[k * 3 + 1]; px[i * 4 + 2] = lut[k * 3 + 2]; px[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
  WP.renderCanvas = renderCanvas;

  S.overlays = {}; S.canvases = {};
  function showOverlay(key) {
    const res = S.results[key]; if (!res) return;
    const disp = displayFor(key), cv = renderCanvas(res, disp);
    S.canvases[key] = cv;
    const url = cv.toDataURL('image/png');
    if (S.overlays[key]) { S.overlays[key].setUrl(url); S.overlays[key].setBounds(L.latLngBounds(G.gridBoundsLL(res.grid))); }
    else S.overlays[key] = L.imageOverlay(url, G.gridBoundsLL(res.grid), { pane: 'results', opacity: $('#inp-opacity').value / 100, className: 'res-img' });
  }
  function refreshView() {
    const key = productKey(S.view);
    Object.entries(S.overlays).forEach(([k, o]) => { if (o) map.removeLayer(o); });
    if (S.view === 'swipe') {
      showOverlay('A'); showOverlay('B');
      S.overlays.A.addTo(map); S.overlays.B.addTo(map);
      $('#swipe').hidden = false; applySwipe();
    } else {
      $('#swipe').hidden = true;
      if (S.overlays.B) S.overlays.B.getElement() && (S.overlays.B.getElement().style.clipPath = '');
      if (S.results[key]) { showOverlay(key); S.overlays[key].addTo(map); }
    }
    syncDisplayInputs();
    renderLegend();
    if (S.results[key]) { renderSummary(key); runZonal(key); }
  }
  WP.refreshView = refreshView;
  function setView(v) {
    if (v !== 'A' && !S.results[productKey(v)] && !(v === 'swipe' && S.results.A && S.results.B)) return;
    S.view = v; $$('#view-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    refreshView();
  }

  /* swipe */
  let swipeX = 0.5;
  function applySwipe() {
    const o = S.overlays.B; if (!o || !o.getElement()) return;
    const el = o.getElement(), size = map.getSize();
    const x = swipeX * size.x;
    $('#swipe .swipe-line').style.left = x + 'px'; $('#swipe-handle').style.left = x + 'px';
    const tl = map.latLngToContainerPoint(o.getBounds().getNorthWest()), br = map.latLngToContainerPoint(o.getBounds().getSouthEast());
    const wpx = br.x - tl.x, elW = parseFloat(el.style.width) || el.width;
    const clip = Math.max(0, (x - tl.x) * (elW / wpx));
    el.style.clipPath = `inset(0 0 0 ${clip}px)`;
  }
  map.on('move zoom zoomend moveend resize', () => { if (S.view === 'swipe') applySwipe(); });
  (function initSwipe() {
    const h = $('#swipe-handle'); let drag = false;
    h.addEventListener('pointerdown', e => { drag = true; h.setPointerCapture(e.pointerId); map.dragging.disable(); });
    h.addEventListener('pointermove', e => { if (!drag) return; const r = $('#map').getBoundingClientRect(); swipeX = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)); applySwipe(); });
    h.addEventListener('pointerup', () => { drag = false; map.dragging.enable(); });
  })();

  /* legend */
  function legendModel(key) {
    key = key || productKey(S.view);
    const res = S.results[key]; if (!res) return null;
    const d = displayFor(key);
    const idx = key === 'change' ? { name: WP.INDICES[res.baseIndex].name + ' change (B − A)', unit: '' } : WP.INDICES[res.index];
    const sceneTxt = key === 'change' ? `${S.results.A.scene.date} → ${S.results.B.scene.date}` : sceneLabel(res.scene);
    if (res.rgb) return { title: idx.name, sub: sceneTxt, rgb: true, formula: idx.formula };
    if (d.mode === 'class' && d.classes) return { title: WP.CLASSES[d.classes].title, sub: sceneTxt, classes: WP.CLASSES[d.classes].items, unit: idx.unit };
    return { title: idx.name + (idx.unit ? ` (${idx.unit})` : ''), sub: sceneTxt, ramp: d.ramp, vmin: d.vmin, vmax: d.vmax };
  }
  WP.legendModel = legendModel;
  WP.legendHTML = function (m) {
    if (!m) return '';
    let h = `<h5>${esc(m.title)}</h5>`;
    if (m.rgb) h += `<div class="sub">${esc(m.formula)}</div>`;
    else if (m.classes) {
      let prev = null;
      h += '<div class="cls">' + m.classes.map(c => { const s = `<i style="background:${c.color}"></i><span>${esc(c.label)}</span>`; prev = c.max; return s; }).join('') + '</div>';
    } else {
      const mid = (m.vmin + m.vmax) / 2;
      h += `<div class="grad" style="background:${WP.rampCSS(m.ramp)}"></div><div class="ticks"><span>${+m.vmin.toFixed(2)}</span><span>${+mid.toFixed(2)}</span><span>${+m.vmax.toFixed(2)}</span></div>`;
    }
    h += `<div class="sub">${esc(m.sub)}</div>`;
    return h;
  };
  function renderLegend() { const m = legendModel(); $('#map-legend').hidden = !m; $('#map-legend').innerHTML = WP.legendHTML(m); }

  /* ---------- labels (village / taluka / AOI) per grid ---------- */
  function labelsFor(grid, kind) {
    const k = grid.key + '|' + kind + (kind === 'aoi' ? '|' + S.aoi.name + S.aoi.areaKm2 : '');
    if (S.labelCache[k]) return S.labelCache[k];
    let lab;
    if (kind === 'villages') lab = G.rasterize(grid, S.data.villages);
    else if (kind === 'talukas') lab = G.rasterize(grid, S.data.talukas);
    else lab = G.rasterize(grid, [{ geometry: S.aoi.geom }]);
    const keys = Object.keys(S.labelCache); if (keys.length > 12) delete S.labelCache[keys[0]];
    return (S.labelCache[k] = lab);
  }
  WP.labelsFor = labelsFor;

  /* ---------- compute ---------- */
  let computeCtl;
  async function compute() {
    if (S.busy) { computeCtl && computeCtl.abort(); return; }
    if (!S.sceneA) return WP.toast('Choose scene A first: search and press "A" on a scene.', true);
    const idxKey = $('#sel-index').value, idx = WP.INDICES[idxKey];
    const res = +$('#sel-res').value, compare = $('#sel-compare').value === 'on' && S.sceneB;
    if ($('#sel-compare').value === 'on' && !S.sceneB) WP.toast('No scene B chosen, computing scene A only.');
    const grid = G.makeGrid(S.aoi.bbox, res, 6e6);
    if (grid.bumped) WP.toast(`Pixel size raised to ${Math.round(grid.resM)} m to keep the ${S.aoi.name} grid within browser memory.`);
    const aoiLabels = $('#chk-clip').checked ? labelsFor(grid, 'aoi') : null;
    const btn = $('#btn-compute'), pr = $('#progress');
    S.busy = true; btn.textContent = 'Stop'; computeCtl = new AbortController();
    const t0 = performance.now();
    try {
      const run = async (scene, tag, frac0, span) => {
        const r = await E.compute(scene, idxKey, grid, {
          cloudMask: $('#chk-cloudmask').checked, aoiLabels, emissivity: !!scene.emissivity, signal: computeCtl.signal,
          progress: f => WP.progress(pr, frac0 + f * span, `Scene ${tag}: ${Math.round(f * 100)}% · ${grid.w}×${grid.h} px at ${Math.round(grid.resM)} m`)
        });
        return r;
      };
      WP.progress(pr, 0.02, `Scene A: opening ${S.sceneA.items.length} tile(s)…`);
      const A = await run(S.sceneA, 'A', 0, compare ? 0.5 : 1);
      const results = { A };
      if (compare) { results.B = await run(S.sceneB, 'B', 0.5, 0.5); if (!idx.rgb) results.change = E.difference(A, results.B); }
      S.results = results; S.display = {}; S.zonal = {};
      $('#view-seg').hidden = !compare;
      $('#view-seg [data-v=change]').disabled = !results.change;
      if (A.valid === 0) WP.toast('Scene A has no clear pixels over this area. Try a clearer date or turn off cloud masking.', true);
      else WP.toast(`Computed ${idx.name} in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${(100 * A.valid / A.total).toFixed(0)}% of the area clear.`);
      setView(compare && results.change ? 'change' : 'A');
      if (compare && !results.change) setView('A');
      document.dispatchEvent(new CustomEvent('wp:results'));
    } catch (e) {
      console.error(e);
      if (e.name === 'AbortError') WP.toast('Computation stopped.');
      else WP.toast((/Failed to fetch|NetworkError|Load failed/.test(e.message) ? 'Could not download image data (network or CORS). ' : '') + e.message, true);
    } finally { S.busy = false; btn.textContent = 'Compute'; WP.progress(pr, null); }
  }

  /* ---------- summary panel ---------- */
  function classesFor(key) { const d = displayFor(key); return d && d.classes ? WP.CLASSES[d.classes] : null; }
  function renderSummary(key) {
    const res = S.results[key]; if (!res) return;
    $('#sum-empty').hidden = true; $('#sum-body').hidden = false;
    const d = displayFor(key), cls = classesFor(key);
    if (res.rgb) {
      $('#sum-head').innerHTML = `<b>${esc(WP.INDICES[res.index].name)}</b>${esc(sceneLabel(res.scene))} · ${esc(S.aoi.name)}`;
      $('#kpis').innerHTML = kpi('Clear', (100 * res.valid / res.total).toFixed(1), '%') + kpi('Cloud', (100 * res.cloud / res.total).toFixed(1), '%') + kpi('Pixel', Math.round(res.grid.resM), 'm');
      drawChart('ch-hist', null); drawChart('ch-class', null); $('#tbl-class').innerHTML = ''; S.stats = null; return;
    }
    const st = E.stats(res, cls, [d.vmin, d.vmax]);
    S.stats = Object.assign(st, { key, index: key === 'change' ? res.baseIndex : res.index });
    const idx = key === 'change' ? WP.INDICES[res.baseIndex] : WP.INDICES[res.index];
    const title = key === 'change' ? `${idx.name} change` : idx.name;
    $('#sum-head').innerHTML = `<b>${esc(title)} · ${esc(S.aoi.name)}</b>${esc(key === 'change' ? S.results.A.scene.date + ' → ' + S.results.B.scene.date : sceneLabel(res.scene))} · ${Math.round(res.grid.resM)} m`;
    const u = idx.unit || '';
    let stress = '';
    if (cls && cls.stressBelow != null && st.classAreas) {
      const a = cls.items.reduce((s, c, i) => s + ((c.max <= cls.stressBelow && c.max > cls.stressAbove + 1e-9) ? st.classAreas[i] : 0), 0);
      S.stats.stressPct = 100 * a / st.areaKm2; S.stats.stressKm2 = a;
      stress = kpi('Stressed', S.stats.stressPct.toFixed(1), '%', S.stats.stressPct > 40 ? 'flag' : 'good');
    }
    if (key === 'change' && st.classAreas) {
      const loss = st.classAreas.slice(0, 3).reduce((a, b) => a + b, 0);
      S.stats.lossPct = 100 * loss / st.areaKm2;
      stress = kpi('Area losing', S.stats.lossPct.toFixed(1), '%', S.stats.lossPct > 30 ? 'flag' : '');
    }
    const dp = idx.unit === '°C' ? 1 : 3;
    $('#kpis').innerHTML = kpi('Mean', G.fmt(st.mean, dp), u) + kpi('Median', G.fmt(st.median, dp), u) + kpi('Std dev', G.fmt(st.std, dp), u) +
      kpi('Min', G.fmt(st.min, dp), u) + kpi('Max', G.fmt(st.max, dp), u) + (stress || kpi('P10–P90', `${G.fmt(st.p10, 2)}–${G.fmt(st.p90, 2)}`, '')) +
      kpi('Clear', st.clearPct.toFixed(1), '%', st.clearPct < 60 ? 'flag' : '') + kpi('Valid area', G.fmtInt(st.areaKm2), 'km²') + kpi('Pixel', Math.round(res.grid.resM), 'm');
    drawChart('ch-hist', WP.chartBuilders.hist('dark'));
    if (st.classAreas) {
      $('#cls-title').hidden = false;
      drawChart('ch-class', WP.chartBuilders.class('dark'));
      $('#tbl-class').innerHTML = '<tr><th>Class</th><th style="text-align:right">km²</th><th style="text-align:right">%</th></tr>' + cls.items.map((c, i) =>
        `<tr><td><span class="sw" style="background:${c.color}"></span>${esc(c.label)}</td><td class="n">${G.fmtInt(st.classAreas[i])}</td><td class="n">${(100 * st.classAreas[i] / st.areaKm2).toFixed(1)}</td></tr>`).join('');
    } else { $('#cls-title').hidden = true; drawChart('ch-class', null); $('#tbl-class').innerHTML = ''; }
  }
  const kpi = (k, v, u, cls = '') => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}<span class="u"> ${u}</span></div></div>`;

  WP.chartBuilders.hist = theme => {
    const st = S.stats; if (!st) return null;
    const T = WP.theme(theme), h = st.hist, d = displayFor(st.key);
    const labels = h.counts.map((_, i) => (h.lo + (i + 0.5) * (h.hi - h.lo) / h.bins));
    const colors = labels.map(v => colorForValue(v, st.key));
    return {
      type: 'bar', data: { labels: labels.map(v => v.toFixed(2)), datasets: [{ data: h.counts.map(c => c * (S.results[st.key].grid.resM ** 2) / 1e6), backgroundColor: colors, barPercentage: 1, categoryPercentage: 1 }] },
      options: { plugins: { legend: { display: false }, title: { display: theme === 'light', text: 'Distribution of ' + (st.key === 'change' ? 'change' : WP.INDICES[st.index].name), color: T.title } },
        scales: { x: { ticks: { color: T.text, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: T.text }, grid: { color: T.grid }, title: { display: true, text: 'km²', color: T.text } } } }
    };
  };
  WP.chartBuilders.class = theme => {
    const st = S.stats; if (!st || !st.classAreas) return null;
    const T = WP.theme(theme), cls = classesFor(st.key);
    return {
      type: 'bar', data: { labels: cls.items.map(c => c.label), datasets: [{ data: st.classAreas, backgroundColor: cls.items.map(c => c.color), borderRadius: 3 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false }, title: { display: theme === 'light', text: 'Area by class (km²)', color: T.title } },
        scales: { x: { ticks: { color: T.text }, grid: { color: T.grid } }, y: { ticks: { color: T.text, font: { size: 10.5 } }, grid: { display: false } } } }
    };
  };
  WP.chartBuilders.taluka = theme => {
    const z = S.zonal.talukas; if (!z) return null;
    const T = WP.theme(theme);
    const rows = z.rows.filter(r => Number.isFinite(r.mean));
    return {
      type: 'bar', data: { labels: rows.map(r => r.name), datasets: [{ data: rows.map(r => r.mean), backgroundColor: rows.map(r => colorForValue(r.mean, z.key)), borderRadius: 3 }] },
      options: { plugins: { legend: { display: false }, title: { display: theme === 'light', text: 'Mean by taluka', color: T.title } },
        scales: { x: { ticks: { color: T.text }, grid: { display: false } }, y: { ticks: { color: T.text }, grid: { color: T.grid } } } }
    };
  };

  /* ---------- zonal statistics ---------- */
  function runZonal(key) {
    const res = S.results[key]; if (!res || res.rgb) { S.zonal = {}; renderZonalTables(); return; }
    const cls = classesFor(key);
    const vl = labelsFor(res.grid, 'villages'), tl = labelsFor(res.grid, 'talukas');
    const vz = E.zonal(res, vl, S.data.villages.length, cls), tz = E.zonal(res, tl, S.data.talukas.length, cls);
    const vrows = vz.map((z, i) => Object.assign({ id: i, name: S.data.villages[i].properties.village, taluka: S.data.villages[i].properties.taluka, lgd: S.data.villages[i].properties.lgd }, z)).filter(r => r.n > 0 || r.clearPct === 0 && false);
    const byId = {}; vrows.forEach(r => byId[r.id] = r);
    S.zonal = {
      key, villages: { key, rows: vrows, byId }, talukas: { key, rows: tz.map((z, i) => Object.assign({ id: i, name: S.data.talukas[i].properties.taluka }, z)).filter(r => r.n > 0) }
    };
    renderZonalTables();
    if ($('#lyr-choro').checked) syncLayerToggles();
  }
  let vSort = { col: 'mean', dir: 1 };
  function renderZonalTables() {
    const z = S.zonal, idxName = z.key ? (z.key === 'change' ? 'Δ' : WP.INDICES[S.results[z.key].index].name) : '';
    const hasStress = z.villages && z.villages.rows.some(r => Number.isFinite(r.stressPct));
    const dp = z.key && S.results[z.key] && WP.INDICES[S.results[z.key].index || S.results[z.key].baseIndex]?.unit === '°C' ? 1 : 3;
    if (!z.villages) { $('#tbl-villages').innerHTML = '<tr><td class="empty">Compute an index to see village statistics.</td></tr>'; $('#tbl-talukas').innerHTML = ''; drawChart('ch-taluka', null); return; }
    const f = $('#vt-filter').value.trim().toLowerCase();
    const rows = z.villages.rows.filter(r => !f || r.name.toLowerCase().includes(f) || r.taluka.toLowerCase().includes(f))
      .sort((a, b) => { const x = a[vSort.col], y = b[vSort.col]; return (typeof x === 'string' ? x.localeCompare(y) : ((x ?? -1e9) - (y ?? -1e9))) * vSort.dir; });
    const cols = [['name', 'Village'], ['taluka', 'Taluka'], ['mean', 'Mean ' + idxName]].concat(hasStress ? [['stressPct', 'Stress %']] : []).concat([['clearPct', 'Clear %']]);
    $('#tbl-villages').innerHTML = '<thead><tr>' + cols.map(([k, t]) => `<th data-k="${k}">${t}${vSort.col === k ? (vSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('') + '</tr></thead><tbody>' +
      rows.map(r => `<tr class="click" data-id="${r.id}"><td>${esc(r.name)}</td><td>${esc(r.taluka)}</td><td class="n"><span class="sw" style="background:${Number.isFinite(r.mean) ? colorForValue(r.mean, z.key) : 'transparent'}"></span>${G.fmt(r.mean, dp)}</td>${hasStress ? `<td class="n">${G.fmt(r.stressPct, 0)}</td>` : ''}<td class="n">${G.fmt(r.clearPct, 0)}</td></tr>`).join('') + '</tbody>';
    $$('#tbl-villages th').forEach(th => th.onclick = () => { const k = th.dataset.k; vSort = { col: k, dir: vSort.col === k ? -vSort.dir : 1 }; renderZonalTables(); });
    $$('#tbl-villages tr.click').forEach(tr => tr.onclick = () => zoomVillage(+tr.dataset.id));
    const tr = z.talukas.rows;
    $('#tbl-talukas').innerHTML = `<tr><th>Taluka</th><th style="text-align:right">Mean</th>${hasStress ? '<th style="text-align:right">Stress %</th>' : ''}<th style="text-align:right">Clear %</th><th style="text-align:right">km²</th></tr>` +
      tr.map(r => `<tr class="click" data-id="${r.id}"><td><span class="sw" style="background:${Number.isFinite(r.mean) ? colorForValue(r.mean, z.key) : 'transparent'}"></span>${esc(r.name)}</td><td class="n">${G.fmt(r.mean, dp)}</td>${hasStress ? `<td class="n">${G.fmt(r.stressPct, 0)}</td>` : ''}<td class="n">${G.fmt(r.clearPct, 0)}</td><td class="n">${G.fmtInt(r.areaKm2)}</td></tr>`).join('');
    $$('#tbl-talukas tr.click').forEach(tr => tr.onclick = () => { const f = S.data.talukas[+tr.dataset.id]; const b = f._bbox; map.fitBounds([[b[1], b[0]], [b[3], b[2]]]); });
    drawChart('ch-taluka', WP.chartBuilders.taluka('dark'));
  }
  $('#vt-filter').addEventListener('input', renderZonalTables);
  function zoomVillage(id) {
    const f = S.data.villages[id], b = f._bbox;
    map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom: 14, padding: [40, 40] });
    const c = G.centroid(f.geometry); setTimeout(() => inspect(L.latLng(c[1], c[0])), 350);
  }

  /* ---------- inspector ---------- */
  function valueAt(res, lat, lng) {
    if (!res) return null;
    const [c, r] = G.llToPix(res.grid, lng, lat).map(Math.floor);
    if (c < 0 || r < 0 || c >= res.grid.w || r >= res.grid.h) return null;
    const i = r * res.grid.w + c;
    return res.rgb ? res.data.map(ch => ch[i]) : res.data[i];
  }
  function featureAt(list, lng, lat) {
    for (const f of list) { const b = f._bbox; if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue; if (G.pip([lng, lat], f.geometry)) return f; }
    return null;
  }
  function inspect(ll) {
    const v = featureAt(S.data.villages, ll.lng, ll.lat), t = featureAt(S.data.talukas, ll.lng, ll.lat);
    const lines = [];
    const key = productKey(S.view), res = S.results[key];
    let valHTML = '';
    if (res) {
      const val = valueAt(res, ll.lat, ll.lng);
      const idx = key === 'change' ? { name: 'Change', unit: '' } : WP.INDICES[res.index];
      if (res.rgb) valHTML = `<div class="m">${idx.name}: ${val ? val.map(x => G.fmt(x, 3)).join(' / ') : 'no data'}</div>`;
      else {
        const dp = idx.unit === '°C' ? 1 : 3, cls = classesFor(key);
        valHTML = `<div class="v">${Number.isFinite(val) ? G.fmt(val, dp) + (idx.unit ? ' ' + idx.unit : '') : 'no data'}</div><div class="m">${esc(idx.name)}${Number.isFinite(val) && cls ? ' · ' + esc(cls.items[E.classOf(val, cls.items)].label) : ''}</div>`;
        if (key !== 'A' && S.results.A && !S.results.A.rgb) { const a = valueAt(S.results.A, ll.lat, ll.lng), b = valueAt(S.results.B, ll.lat, ll.lng); lines.push(`A ${G.fmt(a, 3)} → B ${G.fmt(b, 3)}`); }
      }
      if (v && S.zonal.villages && S.zonal.villages.byId[v.properties._id]) { const z = S.zonal.villages.byId[v.properties._id]; lines.push(`Village mean ${G.fmt(z.mean, 3)}${Number.isFinite(z.stressPct) ? ` · ${z.stressPct.toFixed(0)}% stressed` : ''}`); }
    }
    const html = `<div class="pop"><h5>${v ? esc(v.properties.village) : 'Outside village boundaries'}</h5><div class="m">${t ? esc(t.properties.taluka) + ' taluka' : ''}${v ? ' · LGD ' + esc(v.properties.lgd) : ''}</div>${valHTML}${lines.map(l => `<div class="m">${esc(l)}</div>`).join('')}<div class="m">${ll.lat.toFixed(5)}°N, ${ll.lng.toFixed(5)}°E</div>${v ? `<button class="btn sm" data-aoi="${v.properties._id}">Set village as area of interest</button>` : ''}</div>`;
    L.popup({ maxWidth: 280 }).setLatLng(ll).setContent(html).openOn(map);
    $('#inspect-body').innerHTML = html; $('#inspect-body').classList.remove('empty');
    setTimeout(() => $$('[data-aoi]').forEach(b => b.onclick = () => { setAOI(villageAOI(+b.dataset.aoi)); map.closePopup(); }), 0);
  }
  map.on('click', e => inspect(e.latlng));

  /* dock tabs */
  $$('.dock-tabs button').forEach(b => b.onclick = () => { $$('.dock-tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('#dock .dock-body').forEach(d => d.hidden = d.id !== 'd-' + b.dataset.d); });
  $('#dock-toggle').onclick = () => { $('#dock').classList.toggle('collapsed'); setTimeout(() => map.invalidateSize(), 50); };

  /* ---------- exports ---------- */
  function exportName(ext, key) {
    key = key || productKey(S.view); const res = S.results[key];
    const nm = key === 'change' ? WP.INDICES[res.baseIndex].name + '_change' : WP.INDICES[res.index].name;
    const d = key === 'change' ? `${S.results.A.scene.date}_${S.results.B.scene.date}` : res.scene.date;
    return `Washim_${S.aoi.name.replace(/[^\w]+/g, '_')}_${nm}_${d}.${ext}`;
  }
  function need() { const r = activeResult(); if (!r) { WP.toast('Compute an index first.', true); return null; } return r; }
  $('#exp-tif').onclick = () => {
    const r = need(); if (!r) return;
    if (r.rgb) return WP.toast('GeoTIFF export is for index layers. Use PNG for colour composites.', true);
    G.download(new Blob([G.writeFloatTiff(r.grid, r.data)], { type: 'image/tiff' }), exportName('tif'));
  };
  $('#exp-png').onclick = () => {
    const r = need(); if (!r) return;
    const key = productKey(S.view), cv = S.canvases[key] || renderCanvas(r, displayFor(key));
    cv.toBlob(b => {
      G.download(b, exportName('png'));
      const g = r.grid; const pgw = [g.s, 0, 0, -g.s, g.x0 + g.s / 2, g.y0 - g.s / 2].join('\n');
      G.download(pgw, exportName('pgw'), 'text/plain');
      G.download('PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","3857"]]', exportName('prj'), 'text/plain');
    });
  };
  $('#exp-csv').onclick = () => {
    const z = S.zonal.villages; if (!z) return WP.toast('Compute an index first.', true);
    const rows = [['lgd_code', 'village', 'taluka', 'mean', 'std', 'min', 'max', 'stress_pct', 'clear_pct', 'valid_km2']].concat(z.rows.map(r => [r.lgd, r.name, r.taluka, G.fmt(r.mean, 4), G.fmt(r.std, 4), G.fmt(r.min, 4), G.fmt(r.max, 4), G.fmt(r.stressPct, 1), G.fmt(r.clearPct, 1), G.fmt(r.areaKm2, 3)]));
    G.download(G.csv(rows), exportName('csv').replace('.csv', '_villages.csv'), 'text/csv');
  };
  $('#exp-geojson').onclick = () => {
    const z = S.zonal.villages; if (!z) return WP.toast('Compute an index first.', true);
    const fc = { type: 'FeatureCollection', features: z.rows.map(r => ({ type: 'Feature', properties: { lgd: r.lgd, village: r.name, taluka: r.taluka, mean: +G.fmt(r.mean, 4) || null, stress_pct: Number.isFinite(r.stressPct) ? +r.stressPct.toFixed(1) : null, clear_pct: +r.clearPct.toFixed(1) }, geometry: S.data.villages[r.id].geometry })) };
    G.download(JSON.stringify(fc), exportName('geojson').replace('.geojson', '_villages.geojson'), 'application/geo+json');
  };
  $('#exp-map').onclick = async () => {
    try { const cv = await WP.quickMap(); cv.toBlob(b => G.download(b, S.results.A ? exportName('png').replace('.png', '_map.png') : 'Washim_map.png')); }
    catch (e) { WP.toast('Map export failed: ' + e.message, true); }
  };
  $('#exp-compose').onclick = () => { WP.switchView('report'); WP.report && WP.report.autoLayout(); };

  /* ---------- map → canvas renderer (for quick map & report) ---------- */
  function loadImg(src) {
    return new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = src; setTimeout(() => res(null), 12000); });
  }
  WP.extentBBox = function (extent) {
    if (Array.isArray(extent)) return extent;
    if (extent === 'aoi' && S.aoi) return S.aoi.bbox;
    if (extent === 'district') return G.bbox(S.data.district.geometry);
    const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
  };
  WP.renderMap = async function ({ w, h, extent = 'view', basemap = true, overlay = true, pad = 0.04, noLabels = false, scale = null }) {
    const bb = WP.extentBBox(extent);
    const [x0, y0] = G.toMerc(bb[0], bb[1]), [x1, y1] = G.toMerc(bb[2], bb[3]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const mpp = Math.max((x1 - x0) / w, (y1 - y0) / h) * (extent === 'view' ? 1 : 1 + pad * 2);
    const vx0 = cx - w / 2 * mpp, vy1 = cy + h / 2 * mpp;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#e9ece8'; ctx.fillRect(0, 0, w, h);
    const P = (lon, lat) => { const [x, y] = G.toMerc(lon, lat); return [(x - vx0) / mpp, (vy1 - y) / mpp]; };
    const bm = WP.BASEMAPS[S.basemap];
    if (basemap && bm && bm.url) {
      const WORLD = 2 * Math.PI * 6378137, O = WORLD / 2;
      let z = Math.ceil(Math.log2(WORLD / (256 * mpp))); z = Math.max(0, Math.min(bm.max || 18, z));
      const tm = WORLD / (256 * Math.pow(2, z)); // metres per tile pixel
      const tx0 = Math.floor((vx0 + O) / (256 * tm)), tx1 = Math.floor((vx0 + w * mpp + O) / (256 * tm));
      const ty0 = Math.floor((O - vy1) / (256 * tm)), ty1 = Math.floor((O - (vy1 - h * mpp)) / (256 * tm));
      const jobs = [];
      const subs = (bm.sub || 'abc').split('');
      for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
        const url = bm.url.replace('{z}', z).replace('{x}', tx).replace('{y}', ty).replace('{s}', subs[(tx + ty) % subs.length]);
        jobs.push(loadImg(url).then(im => ({ im, tx, ty })));
      }
      const tiles = await Promise.all(jobs);
      const sz = 256 * tm / mpp;
      for (const t of tiles) if (t.im) ctx.drawImage(t.im, (t.tx * 256 * tm - O - vx0) / mpp, (vy1 - (O - t.ty * 256 * tm)) / mpp, sz + 0.5, sz + 0.5);
      try { ctx.getImageData(0, 0, 1, 1); } catch (e) { ctx.fillStyle = '#e9ece8'; ctx.fillRect(0, 0, w, h); console.warn('basemap tainted canvas; skipped'); }
    }
    const key = productKey(S.view), res = S.results[key];
    if (overlay && res) {
      const cvs = S.canvases[key] || renderCanvas(res, displayFor(key));
      const g = res.grid;
      ctx.save(); ctx.imageSmoothingEnabled = (g.s / mpp) < 1; ctx.globalAlpha = $('#inp-opacity').value / 100;
      ctx.drawImage(cvs, (g.x0 - vx0) / mpp, (vy1 - g.y0) / mpp, g.w * g.s / mpp, g.h * g.s / mpp);
      ctx.restore();
    }
    const strokeGeom = (geom, style) => {
      ctx.beginPath();
      for (const poly of G.polygons(geom)) for (const ring of poly) { ring.forEach(([lo, la], i) => { const [x, y] = P(lo, la); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); }
      if (style.fill) { ctx.fillStyle = style.fill; ctx.globalAlpha = style.fillOpacity ?? 1; ctx.fill('evenodd'); ctx.globalAlpha = 1; }
      if (style.color) { ctx.strokeStyle = style.color; ctx.lineWidth = style.weight || 1; ctx.setLineDash(style.dash || []); ctx.globalAlpha = style.opacity ?? 1; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]); }
    };
    const k = scale || Math.max(1, w / 1400);
    if ($('#lyr-region').checked) S.data.region_districts.features.forEach(f => strokeGeom(f.geometry, { color: '#6b746f', weight: 1 * k, dash: [4 * k, 4 * k], opacity: 0.8 }));
    if ($('#lyr-village').checked || $('#lyr-choro').checked) S.data.villages.forEach(f => { const st = villageStyle(f); strokeGeom(f.geometry, { color: st.fill === false || !st.fillOpacity ? '#ffffff' : '#2a2f2c', weight: 0.5 * k, opacity: 0.7, fill: st.fillOpacity ? st.fillColor : null, fillOpacity: st.fillOpacity }); });
    if ($('#lyr-taluka').checked) S.data.talukas.forEach(f => { strokeGeom(f.geometry, { color: '#ffffff', weight: 2.6 * k, opacity: 0.9 }); strokeGeom(f.geometry, { color: '#2b2b2b', weight: 1 * k, opacity: 0.9 }); });
    if ($('#lyr-district').checked) strokeGeom(S.data.district.geometry, { color: '#b9811f', weight: 3 * k });
    if (S.aoi && S.aoi.level !== 'district') strokeGeom(S.aoi.geom, { color: '#1e7a34', weight: 2.5 * k, dash: [7 * k, 4 * k] });
    if (!noLabels && $('#lyr-taluka').checked) {
      ctx.font = `600 ${Math.round(12 * k)}px "IBM Plex Sans", sans-serif`; ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      S.data.talukas.forEach(f => { const c = G.centroid(f.geometry), [x, y] = P(c[0], c[1]); if (x < 0 || y < 0 || x > w || y > h) return; const t = f.properties.taluka.toUpperCase(); ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(t, x, y); ctx.fillStyle = '#fff'; ctx.fillText(t, x, y); });
    }
    const latc = G.fromMerc(cx, cy)[1];
    return { canvas: cv, mpp, groundMpp: mpp * Math.cos(latc * Math.PI / 180), bbox: [G.fromMerc(vx0, vy1 - h * mpp), G.fromMerc(vx0 + w * mpp, vy1)] };
  };

  /* scale bar helper: returns {px, label} for a nice length */
  WP.niceScale = function (groundMpp, maxPx) {
    const maxM = groundMpp * maxPx, p = Math.pow(10, Math.floor(Math.log10(maxM)));
    let m = [5, 2, 1].map(f => f * p).find(v => v <= maxM) || p;
    return { px: m / groundMpp, m, label: m >= 1000 ? (m / 1000) + ' km' : m + ' m' };
  };

  WP.quickMap = async function () {
    const W = 2000, H = 1400, M = 60, mapW = W - 2 * M, mapH = H - 200 - M;
    const r = await WP.renderMap({ w: mapW, h: mapH, extent: 'view' });
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1d2420'; c.font = '700 44px "Bricolage Grotesque", sans-serif'; c.textBaseline = 'alphabetic';
    const lm = legendModel();
    c.fillText(lm ? `${lm.title} · ${S.aoi.name}` : `${S.aoi.name}, Maharashtra`, M, 88);
    c.font = '400 22px "IBM Plex Sans", sans-serif'; c.fillStyle = '#56645c';
    c.fillText(lm ? lm.sub : 'District, taluka and village boundaries', M, 126);
    c.drawImage(r.canvas, M, 150);
    c.strokeStyle = '#1d2420'; c.lineWidth = 2; c.strokeRect(M, 150, mapW, mapH);
    // north arrow
    const nx = W - M - 60, ny = 190;
    c.fillStyle = '#fff'; c.globalAlpha = 0.85; c.fillRect(nx - 30, ny - 20, 60, 90); c.globalAlpha = 1;
    c.fillStyle = '#1d2420'; c.beginPath(); c.moveTo(nx, ny); c.lineTo(nx + 16, ny + 50); c.lineTo(nx, ny + 40); c.closePath(); c.fill();
    c.fillStyle = '#8a958f'; c.beginPath(); c.moveTo(nx, ny); c.lineTo(nx - 16, ny + 50); c.lineTo(nx, ny + 40); c.closePath(); c.fill();
    c.fillStyle = '#1d2420'; c.font = '700 20px "IBM Plex Sans", sans-serif'; c.textAlign = 'center'; c.fillText('N', nx, ny + 68); c.textAlign = 'left';
    // scale bar
    const sb = WP.niceScale(r.groundMpp, 300), sx = M + 20, sy = 150 + mapH - 40;
    c.fillStyle = 'rgba(255,255,255,.88)'; c.fillRect(sx - 10, sy - 30, sb.px + 90, 50);
    c.fillStyle = '#1d2420'; c.fillRect(sx, sy, sb.px / 2, 10); c.strokeStyle = '#1d2420'; c.lineWidth = 2; c.strokeRect(sx, sy, sb.px, 10);
    c.font = '500 18px "IBM Plex Mono", monospace'; c.fillText('0', sx - 5, sy - 8); c.fillText(sb.label, sx + sb.px - 20, sy - 8);
    // legend
    if (lm && !lm.rgb) {
      const lh = lm.classes ? 56 + lm.classes.length * 30 : 104, lx = W - M - 390, ly = 150 + mapH - lh - 12;
      c.fillStyle = 'rgba(255,255,255,.93)'; c.fillRect(lx, ly, 378, lh);
      c.fillStyle = '#1d2420'; c.font = '600 20px "IBM Plex Sans", sans-serif'; c.fillText(lm.title, lx + 14, ly + 30);
      if (lm.classes) lm.classes.forEach((k, i) => { c.fillStyle = k.color; c.fillRect(lx + 14, ly + 46 + i * 30, 26, 18); c.fillStyle = '#1d2420'; c.font = '400 18px "IBM Plex Sans", sans-serif'; c.fillText(k.label, lx + 50, ly + 61 + i * 30); });
      else {
        const gr = c.createLinearGradient(lx + 14, 0, lx + 364, 0); const st = WP.RAMPS[lm.ramp].stops; st.forEach((s, i) => gr.addColorStop(i / (st.length - 1), s));
        c.fillStyle = gr; c.fillRect(lx + 14, ly + 46, 350, 18);
        c.fillStyle = '#1d2420'; c.font = '400 17px "IBM Plex Mono", monospace'; c.fillText(String(+lm.vmin.toFixed(2)), lx + 14, ly + 88); c.textAlign = 'right'; c.fillText(String(+lm.vmax.toFixed(2)), lx + 364, ly + 88); c.textAlign = 'left';
      }
    }
    c.fillStyle = '#6b7771'; c.font = '400 17px "IBM Plex Sans", sans-serif';
    c.fillText(`Source: ${lm ? 'Copernicus Sentinel-2 / USGS Landsat via STAC' : 'Boundaries'} · Projection: WGS 84 / Pseudo-Mercator · Basemap: ${WP.BASEMAPS[S.basemap].name} · Printed ${iso(new Date())} · Washim NDVI Drought Portal`, M, H - 26);
    return cv;
  };

  /* ---------- tabs ---------- */
  WP.switchView = function (v) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + v));
    if (v === 'map') setTimeout(() => map.invalidateSize(), 30);
    document.dispatchEvent(new CustomEvent('wp:view', { detail: v }));
  };
  $$('.tab').forEach(t => t.onclick = () => WP.switchView(t.dataset.view));

  /* guide table */
  $('#guide-indices').innerHTML = Object.values(WP.INDICES).map(i => `<tr><td><b>${i.name}</b><br><span style="color:var(--muted)">${esc(i.long)}</span></td><td><code>${esc(i.formula)}</code></td><td>${esc(i.use)}</td></tr>`).join('');

  /* ---------- boot ---------- */
  (async function boot() {
    setBasemap('imagery'); $('#sel-basemap').value = 'imagery';
    initIndexControls(); initSourceControls();
    try { await loadData(); } catch (e) { WP.toast('Could not load boundary files. Serve the folder through a web server (for example GitHub Pages or "python -m http.server"), not file://.', true); return; }
    buildLayers(); initAOIControls();
    setAOI(districtAOI());
    renderZonalTables();
    document.dispatchEvent(new CustomEvent('wp:ready'));
  })();
})();
