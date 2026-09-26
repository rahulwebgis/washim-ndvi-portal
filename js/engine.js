/* Imagery engine: STAC search, signing, COG window reads, index computation, statistics */
(function () {
  const E = WP.engine = {};
  const G = WP.geo;

  /* ---------------- Planetary Computer SAS signing ---------------- */
  const tokens = {};
  E.signHref = async function (href, collection) {
    if (!href || !/blob\.core\.windows\.net/.test(href) || /[?&]sig=/.test(href)) return href;
    const acct = (href.match(/https:\/\/([^.]+)\.blob/) || [])[1];
    const cont = (href.match(/windows\.net\/([^/]+)/) || [])[1];
    const key = collection || (acct + '/' + cont);
    const t = tokens[key];
    if (!t || t.exp < Date.now() + 120000) {
      const url = collection ? WP.PC_SAS + collection : `${WP.PC_SAS.replace('/token/', '/token/')}${acct}/${cont}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('Planetary Computer token request failed (' + r.status + ')');
      const j = await r.json();
      tokens[key] = { token: j.token, exp: Date.parse(j['msft:expiry']) || Date.now() + 30 * 60e3 };
    }
    return href + (href.includes('?') ? '&' : '?') + tokens[key].token;
  };

  /* ---------------- STAC search ---------------- */
  async function postJSON(url, body, signal) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error(`STAC search failed (${r.status}) ${t.slice(0, 160)}`); e.status = r.status; throw e; }
    return r.json();
  }
  E.stacSearch = async function ({ api, collection, bbox, from, to, maxCloud, extraQuery, maxItems = 400, signal, onPage }) {
    api = api.replace(/\/+$/, '');
    const base = { collections: [collection], bbox, datetime: `${from}T00:00:00Z/${to}T23:59:59Z`, limit: 100 };
    const q = Object.assign({}, extraQuery || {});
    if (maxCloud < 100) q['eo:cloud_cover'] = { lte: maxCloud };
    const variants = [
      Object.assign({}, base, Object.keys(q).length ? { query: q } : {}, { sortby: [{ field: 'properties.datetime', direction: 'desc' }] }),
      Object.assign({}, base, Object.keys(q).length ? { query: q } : {}),
      Object.assign({}, base)
    ];
    let page, body, vi = 0;
    for (; vi < variants.length; vi++) {
      try { body = variants[vi]; page = await postJSON(api + '/search', body, signal); break; }
      catch (e) { if (e.name === 'AbortError' || !(e.status >= 400 && e.status < 500) || vi === variants.length - 1) throw e; }
    }
    let items = page.features || [];
    onPage && onPage(items.length);
    let guard = 0;
    while (items.length < maxItems && guard++ < 20) {
      const next = (page.links || []).find(l => l.rel === 'next');
      if (!next) break;
      if ((next.method || 'GET').toUpperCase() === 'POST') {
        const nb = next.merge ? Object.assign({}, body, next.body) : (next.body || body);
        page = await postJSON(next.href, nb, signal);
      } else {
        const r = await fetch(next.href, { signal }); if (!r.ok) break; page = await r.json();
      }
      const f = page.features || []; if (!f.length) break;
      items = items.concat(f); onPage && onPage(items.length);
    }
    if (vi === 2) { // server ignored query: filter client-side
      items = items.filter(it => { const c = it.properties['eo:cloud_cover']; return c == null || c <= maxCloud; });
      if (extraQuery && extraQuery.platform) items = items.filter(it => extraQuery.platform.in.includes(it.properties.platform));
    }
    return items;
  };

  /* ---------------- STAC item → band entries ---------------- */
  function rasterBand(asset) { const rb = asset && asset['raster:bands']; return rb && rb[0] ? rb[0] : null; }
  function guessKey(assets, common) {
    for (const [k, a] of Object.entries(assets)) {
      const eb = a['eo:bands'] || (a.bands) || [];
      if (eb.length === 1 && (eb[0].common_name === common || eb[0]['eo:common_name'] === common)) {
        if (common === 'nir' && eb[0].name && /8A|B05|nir09/i.test(eb[0].name)) continue;
        return k;
      }
    }
    for (const k of WP.ASSET_GUESS[common] || []) if (assets[k]) return k;
    if (common === 'swir1') { for (const [k, a] of Object.entries(assets)) { const eb = a['eo:bands'] || []; if (eb.length === 1 && eb[0].common_name === 'swir16') return k; } }
    if (common === 'swir2') { for (const [k, a] of Object.entries(assets)) { const eb = a['eo:bands'] || []; if (eb.length === 1 && eb[0].common_name === 'swir22') return k; } }
    if (common === 'lwir') { for (const [k, a] of Object.entries(assets)) { const eb = a['eo:bands'] || []; if (eb.length === 1 && /lwir/.test(eb[0].common_name || '')) return k; } }
    return null;
  }
  E.itemToEntry = function (item, src) {
    const p = item.properties || {};
    const coll = (item.collection || (src && src.collection) || '').toLowerCase();
    const isS2 = /sentinel-2|s2/.test(coll) || p['s2:processing_baseline'] != null;
    const isLS = /landsat|hls.*l30/.test(coll) || /landsat/.test(p.platform || '');
    const commons = ['blue', 'green', 'red', 'nir', 'swir1', 'swir2', 'lwir', 'qa'];
    const bands = {};
    let maskType = null;
    for (const c of commons) {
      const key = src && src.bands ? src.bands[c] : guessKey(item.assets, c);
      const asset = key && item.assets[key];
      if (!asset) continue;
      const rb = rasterBand(asset);
      let scale = 1, offset = 0;
      if (c === 'qa') {
        maskType = /scl/i.test(key) ? 'scl' : /qa_pixel/i.test(key) ? 'landsat' : /fmask/i.test(key) ? 'fmask' : null;
      } else if (c === 'lwir') {
        scale = rb && rb.scale != null ? rb.scale : 0.00341802; offset = rb && rb.offset != null ? rb.offset : 149.0;
      } else if (isS2) {
        scale = 1e-4;
        if (p['earthsearch:boa_offset_applied'] === true) offset = 0;
        else if (rb && rb.offset != null) { offset = rb.offset; scale = rb.scale != null ? rb.scale : 1e-4; }
        else offset = parseFloat(p['s2:processing_baseline'] || '0') >= 4 ? -0.1 : 0;
      } else if (rb && rb.scale != null) { scale = rb.scale; offset = rb.offset || 0; }
      else if (isLS) { scale = 2.75e-5; offset = -0.2; }
      else { scale = 1e-4; offset = 0; }
      bands[c] = { href: asset.href, sample: 0, scale, offset, nodata: rb && rb.nodata != null ? rb.nodata : 0, key, collection: item.collection };
    }
    if (!maskType && bands.qa) delete bands.qa;
    return {
      id: item.id, bands, maskType, props: p, collection: item.collection,
      cloud: p['eo:cloud_cover'], epsg: p['proj:epsg'] || (p['proj:code'] ? +String(p['proj:code']).split(':')[1] : null),
      thumb: (item.assets.rendered_preview || item.assets.thumbnail || {}).href,
      tilejson: (item.assets.tilejson || {}).href,
      tileKey: p['s2:mgrs_tile'] || p['grid:code'] || (p['landsat:wrs_path'] ? p['landsat:wrs_path'] + '/' + p['landsat:wrs_row'] : item.id)
    };
  };

  E.groupScenes = function (items, src) {
    const groups = new Map();
    for (const it of items) {
      const p = it.properties;
      const dt = p.datetime || p.start_datetime;
      const date = dt.slice(0, 10);
      const plat = p.platform || it.collection || '';
      const key = date + '|' + plat;
      if (!groups.has(key)) groups.set(key, { key, date, datetime: dt, platform: plat, entries: new Map(), source: src && src.id });
      const g = groups.get(key);
      const e = E.itemToEntry(it, src);
      const prev = g.entries.get(e.tileKey);
      if (!prev || (p.updated || it.id) > (prev.props.updated || prev.id)) g.entries.set(e.tileKey, e);
    }
    return [...groups.values()].map(g => {
      const items = [...g.entries.values()].sort((a, b) => (a.cloud ?? 0) - (b.cloud ?? 0));
      const cl = items.map(i => i.cloud).filter(v => v != null);
      return { key: g.key, date: g.date, datetime: g.datetime, platform: prettyPlatform(g.platform), items, cloud: cl.length ? cl.reduce((a, b) => a + b, 0) / cl.length : null, thumb: items.find(i => i.thumb)?.thumb };
    }).sort((a, b) => b.date.localeCompare(a.date));
  };
  function prettyPlatform(p) {
    p = String(p || '');
    const m = p.match(/sentinel-?2([ab c])?/i); if (m) return 'Sentinel-2' + (m[1] ? m[1].trim().toUpperCase() : '');
    const l = p.match(/landsat-?(\d)/i); if (l) return 'Landsat ' + l[1];
    return p || 'Scene';
  }

  /* ---------------- COG access ---------------- */
  const tiffCache = new Map();
  E.openTiff = async function (band) {
    const key = band.file ? 'file:' + band.file.name + ':' + band.file.size + ':' + band.file.lastModified : band.href;
    if (tiffCache.has(key)) return tiffCache.get(key);
    const p = (async () => {
      if (band.file) return GeoTIFF.fromBlob(band.file);
      const url = await E.signHref(band.href, band.collection);
      return GeoTIFF.fromUrl(url, { allowFullFile: false, cacheSize: 64 });
    })();
    tiffCache.set(key, p);
    if (tiffCache.size > 250) tiffCache.delete(tiffCache.keys().next().value);
    p.catch(() => tiffCache.delete(key));
    return p;
  };

  async function pickImage(tiff, targetRes) {
    const img0 = await tiff.getImage(0);
    const bb = img0.getBoundingBox();
    const W = bb[2] - bb[0];
    let chosen = img0, chosenRes = W / img0.getWidth();
    const n = await tiff.getImageCount();
    for (let i = 1; i < n; i++) {
      const im = await tiff.getImage(i);
      const nst = im.fileDirectory.NewSubfileType || 0;
      if (nst & 4) continue; // mask
      const res = W / im.getWidth();
      if (res <= targetRes * 1.25 && res > chosenRes) { chosen = im; chosenRes = res; }
    }
    return { img0, chosen, bb };
  }

  E.readWindow = async function (band, bboxCRS, targetRes, signal) {
    const tiff = await E.openTiff(band);
    const { chosen, bb } = await pickImage(tiff, targetRes);
    const cw = chosen.getWidth(), ch = chosen.getHeight();
    const rx = (bb[2] - bb[0]) / cw, ry = (bb[3] - bb[1]) / ch;
    const c0 = Math.max(0, Math.floor((bboxCRS[0] - bb[0]) / rx) - 1), c1 = Math.min(cw, Math.ceil((bboxCRS[2] - bb[0]) / rx) + 1);
    const r0 = Math.max(0, Math.floor((bb[3] - bboxCRS[3]) / ry) - 1), r1 = Math.min(ch, Math.ceil((bb[3] - bboxCRS[1]) / ry) + 1);
    if (c1 <= c0 || r1 <= r0) return null;
    const ras = await chosen.readRasters({ window: [c0, r0, c1, r1], samples: [band.sample || 0], interleave: false, signal });
    return { data: ras[0], w: c1 - c0, h: r1 - r0, ox: bb[0] + c0 * rx, oy: bb[3] - r0 * ry, rx, ry };
  };

  E.itemCRS = async function (entry, bandName) {
    const tiff = await E.openTiff(entry.bands[bandName]);
    const img = await tiff.getImage(0);
    const epsg = G.epsgFromImage(img) || entry.epsg;
    if (!epsg) throw new Error('The image has no coordinate reference system. Save it as a GeoTIFF with an EPSG code.');
    return G.ensureProj(epsg);
  };

  function makeTransform(code) {
    if (code === 'EPSG:3857') return (x, y) => [x, y];
    if (code === 'EPSG:4326') return (x, y) => G.fromMerc(x, y);
    const t = proj4('EPSG:3857', code);
    return (x, y) => t.forward([x, y]);
  }

  /* cloud mask decoders: true = reject */
  const SCL_BAD = new Uint8Array(16); [0, 1, 3, 8, 9, 10].forEach(v => SCL_BAD[v] = 1);
  const maskFns = {
    scl: q => q < 16 ? SCL_BAD[q] === 1 : true,
    landsat: q => (q & 0x1F) !== 0,       // fill, dilated cloud, cirrus, cloud, shadow
    fmask: q => (q & 0x0E) !== 0 || q === 255
  };

  /* ---------------- Index computation over a grid ---------------- */
  E.compute = async function (scene, indexKey, grid, opts = {}) {
    const idx = WP.INDICES[indexKey];
    const N = grid.w * grid.h;
    const need = idx.bands.slice();
    if (idx.thermal && opts.emissivity) need.push('red', 'nir');
    const out = idx.rgb ? [new Float32Array(N).fill(NaN), new Float32Array(N).fill(NaN), new Float32Array(N).fill(NaN)] : new Float32Array(N).fill(NaN);
    const state = new Uint8Array(N); // 0 empty, 1 valid, 2 cloud/no-data
    const aoi = opts.aoiLabels || null;
    const prog = opts.progress || (() => {});
    const missing = need.filter(b => !scene.items.some(it => it.bands[b]));
    if (missing.length) throw new Error(`${idx.name} needs the ${missing.map(m => WP.BAND_LABELS[m]).join(', ')} band, which this scene does not provide.`);

    let done = 0;
    for (const entry of scene.items) {
      if (opts.signal && opts.signal.aborted) throw new DOMException('Stopped', 'AbortError');
      if (!need.every(b => entry.bands[b])) { done++; continue; }
      const code = await E.itemCRS(entry, need[0]);
      const tf = makeTransform(code);
      const isGeo = code === 'EPSG:4326';
      const step = 16, nx = Math.ceil(grid.w / step) + 1, ny = Math.ceil(grid.h / step) + 1;
      const LX = new Float64Array(nx * ny), LY = new Float64Array(nx * ny);
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const [X, Y] = tf(grid.x0 + i * step * grid.s, grid.y0 - j * step * grid.s);
        LX[j * nx + i] = X; LY[j * nx + i] = Y;
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X; if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
      }
      const targetRes = isGeo ? grid.resM / 111320 : grid.resM;
      const useMask = opts.cloudMask !== false && entry.bands.qa && entry.maskType;
      const toRead = useMask ? need.concat('qa') : need;
      const uniq = [...new Set(toRead)];
      const wins = await Promise.all(uniq.map(b => E.readWindow(entry.bands[b], [bx0, by0, bx1, by1], targetRes, opts.signal).catch(e => { if (e.name === 'AbortError') throw e; throw new Error(`Reading ${b} failed: ${e.message}`); })));
      done++;
      if (wins.some(w => !w)) { prog(done / scene.items.length); continue; }
      const W = {}; uniq.forEach((b, k) => W[b] = wins[k]);
      const bandMeta = uniq.map(b => ({ name: b, win: W[b], m: entry.bands[b] }));
      const specs = bandMeta.filter(x => x.name !== 'qa');
      const qaSpec = useMask ? bandMeta.find(x => x.name === 'qa') : null;
      const maskFn = qaSpec ? maskFns[entry.maskType] : null;
      const vals = {};
      const fn = idx.fn, fopts = { emissivity: opts.emissivity };

      for (let r = 0; r < grid.h; r++) {
        const fy = (r + 0.5) / step, j0 = Math.min(ny - 2, Math.floor(fy)), ty = fy - j0;
        for (let c = 0; c < grid.w; c++) {
          const i = r * grid.w + c;
          if (state[i] === 1) continue;
          if (aoi && aoi[i] < 0) continue;
          const fx = (c + 0.5) / step, i0 = Math.min(nx - 2, Math.floor(fx)), tx = fx - i0;
          const a = j0 * nx + i0, b = a + 1, d = a + nx, e = d + 1;
          const X = (LX[a] * (1 - tx) + LX[b] * tx) * (1 - ty) + (LX[d] * (1 - tx) + LX[e] * tx) * ty;
          const Y = (LY[a] * (1 - tx) + LY[b] * tx) * (1 - ty) + (LY[d] * (1 - tx) + LY[e] * tx) * ty;
          let ok = true;
          if (qaSpec) {
            const w = qaSpec.win, col = Math.floor((X - w.ox) / w.rx), row = Math.floor((w.oy - Y) / w.ry);
            if (col < 0 || row < 0 || col >= w.w || row >= w.h) continue;
            if (maskFn(w.data[row * w.w + col])) { state[i] = 2; continue; }
          }
          for (let k = 0; k < specs.length; k++) {
            const s = specs[k], w = s.win;
            const col = Math.floor((X - w.ox) / w.rx), row = Math.floor((w.oy - Y) / w.ry);
            if (col < 0 || row < 0 || col >= w.w || row >= w.h) { ok = false; break; }
            const raw = w.data[row * w.w + col];
            if (raw === s.m.nodata || raw !== raw) { ok = false; break; }
            vals[s.name] = raw * s.m.scale + s.m.offset;
          }
          if (!ok) continue;
          if (idx.rgb) {
            out[0][i] = vals[idx.bands[0]]; out[1][i] = vals[idx.bands[1]]; out[2][i] = vals[idx.bands[2]]; state[i] = 1;
          } else {
            const v = fn(vals, fopts);
            if (Number.isFinite(v)) { out[i] = v; state[i] = 1; }
          }
        }
      }
      prog(done / scene.items.length);
      await new Promise(r => setTimeout(r, 0));
    }
    let valid = 0, cloud = 0, total = 0;
    for (let i = 0; i < N; i++) { if (aoi && aoi[i] < 0) continue; total++; if (state[i] === 1) valid++; else if (state[i] === 2) cloud++; }
    return { data: out, rgb: !!idx.rgb, index: indexKey, grid, valid, cloud, total, scene };
  };

  E.difference = function (A, B) {
    const N = A.data.length, out = new Float32Array(N);
    let valid = 0;
    for (let i = 0; i < N; i++) { const v = B.data[i] - A.data[i]; out[i] = v; if (v === v) valid++; }
    return { data: out, rgb: false, index: 'change', baseIndex: A.index, grid: A.grid, valid, cloud: 0, total: A.total, scene: null };
  };

  /* ---------------- Statistics ---------------- */
  E.classOf = function (v, classes) { for (let k = 0; k < classes.length; k++) if (v < classes[k].max) return k; return classes.length - 1; };

  E.stats = function (res, classesDef, range) {
    const d = res.data, g = res.grid, pa = G.pixelAreaKm2(g);
    let n = 0, sum = 0, sq = 0, mn = Infinity, mx = -Infinity, area = 0;
    const cls = classesDef ? new Float64Array(classesDef.items.length) : null;
    const sample = [];
    const stride = Math.max(1, Math.floor(res.valid / 250000));
    let k = 0;
    for (let r = 0; r < g.h; r++) {
      const a = pa[r];
      for (let c = 0; c < g.w; c++) {
        const v = d[r * g.w + c];
        if (v !== v) continue;
        n++; sum += v; sq += v * v; area += a;
        if (v < mn) mn = v; if (v > mx) mx = v;
        if (cls) cls[E.classOf(v, classesDef.items)] += a;
        if ((k++ % stride) === 0) sample.push(v);
      }
    }
    sample.sort((x, y) => x - y);
    const q = p => sample.length ? sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] : NaN;
    const mean = n ? sum / n : NaN;
    const lo = range ? range[0] : q(0.01), hi = range ? range[1] : q(0.99);
    const bins = 40, hist = new Array(bins).fill(0);
    for (const v of sample) { const b = Math.floor((v - lo) / (hi - lo) * bins); if (b >= 0 && b < bins) hist[b]++; }
    const scaleH = n / Math.max(1, sample.length);
    return {
      n, mean, std: n ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : NaN, min: mn, max: mx,
      median: q(0.5), p10: q(0.1), p90: q(0.9), areaKm2: area,
      clearPct: res.total ? 100 * res.valid / res.total : NaN, cloudPct: res.total ? 100 * res.cloud / res.total : NaN,
      classAreas: cls ? Array.from(cls) : null,
      hist: { lo, hi, bins, counts: hist.map(h => h * scaleH) }
    };
  };

  E.zonal = function (res, labels, nZones, classesDef) {
    const d = res.data, g = res.grid, pa = G.pixelAreaKm2(g);
    const Z = Array.from({ length: nZones }, () => ({ n: 0, sum: 0, sq: 0, min: Infinity, max: -Infinity, area: 0, stress: 0, total: 0 }));
    const sb = classesDef && classesDef.stressBelow, sa = classesDef ? classesDef.stressAbove : null;
    for (let r = 0; r < g.h; r++) {
      const a = pa[r];
      for (let c = 0; c < g.w; c++) {
        const i = r * g.w + c, z = labels[i];
        if (z < 0) continue;
        const o = Z[z]; o.total++;
        const v = d[i]; if (v !== v) continue;
        o.n++; o.sum += v; o.sq += v * v; o.area += a;
        if (v < o.min) o.min = v; if (v > o.max) o.max = v;
        if (sb != null && v < sb && v >= sa) o.stress += a;
      }
    }
    return Z.map(o => ({ n: o.n, mean: o.n ? o.sum / o.n : NaN, std: o.n ? Math.sqrt(Math.max(0, o.sq / o.n - (o.sum / o.n) ** 2)) : NaN, min: o.n ? o.min : NaN, max: o.n ? o.max : NaN, areaKm2: o.area, stressPct: o.area ? 100 * o.stress / o.area : NaN, clearPct: o.total ? 100 * o.n / o.total : NaN }));
  };

  /* ---------------- Custom sources (URLs / uploads) ---------------- */
  E.inspectSources = async function (list) { // list of {href}|{file}
    const out = [];
    for (const s of list) {
      const tiff = await E.openTiff(s);
      const img = await tiff.getImage(0);
      const spp = img.getSamplesPerPixel();
      const epsg = G.epsgFromImage(img);
      const name = s.file ? s.file.name : s.href.split('/').pop().split('?')[0];
      // sample value range from the smallest overview
      let maxv = 0;
      try {
        const n = await tiff.getImageCount();
        const small = await tiff.getImage(n - 1);
        const ras = await small.readRasters({ samples: [0], interleave: false, window: [0, 0, Math.min(small.getWidth(), 256), Math.min(small.getHeight(), 256)] });
        for (const v of ras[0]) if (v > maxv && v < 60000) maxv = v;
      } catch (e) { /* ignore */ }
      const bb = img.getBoundingBox();
      out.push({ src: s, name, spp, epsg, maxv, w: img.getWidth(), h: img.getHeight(), bbox: bb, nodata: img.getGDALNoData() });
    }
    return out;
  };

  E.guessBandFromName = function (name) {
    const n = name.toUpperCase();
    const ls = /L[COTEM]0?[4-9]|LANDSAT|SR_B|ST_B/.test(n);
    const rules = ls ? [
      ['lwir', /ST_B10|B10\b|_B10[._]/], ['qa', /QA_PIXEL/], ['blue', /SR_B2|_B2[._]/], ['green', /SR_B3|_B3[._]/], ['red', /SR_B4|_B4[._]/],
      ['nir', /SR_B5|_B5[._]/], ['swir1', /SR_B6|_B6[._]/], ['swir2', /SR_B7|_B7[._]/]
    ] : [
      ['qa', /SCL/], ['blue', /B0?2\b|B02|BLUE/], ['green', /B0?3\b|B03|GREEN/], ['red', /B0?4\b|B04|RED\b|_RED/], ['nir', /B0?8\b|B08|NIR/],
      ['swir1', /B11|SWIR1|SWIR16/], ['swir2', /B12|SWIR2|SWIR22/], ['lwir', /THERM|LWIR|B10/]
    ];
    for (const [c, re] of rules) if (re.test(n)) return { common: c, landsat: ls };
    return { common: null, landsat: ls };
  };
})();
