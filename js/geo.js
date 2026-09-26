/* Geometry, projection, raster-grid and file helpers */
(function () {
  const R = 6378137;
  const G = WP.geo = {};

  G.toMerc = (lon, lat) => [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R];
  G.fromMerc = (x, y) => [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];

  /* ---- proj4 definitions ---- */
  const defined = new Set(['EPSG:4326', 'EPSG:3857']);
  G.ensureProj = async function (epsg) {
    const code = 'EPSG:' + epsg;
    if (defined.has(code)) return code;
    const n = +epsg;
    if (n >= 32601 && n <= 32660) proj4.defs(code, `+proj=utm +zone=${n - 32600} +datum=WGS84 +units=m +no_defs`);
    else if (n >= 32701 && n <= 32760) proj4.defs(code, `+proj=utm +zone=${n - 32700} +south +datum=WGS84 +units=m +no_defs`);
    else if (n >= 24341 && n <= 24347) proj4.defs(code, `+proj=utm +zone=${n - 24300} +a=6377301.243 +b=6356100.230165384 +towgs84=283,682,231,0,0,0,0 +units=m +no_defs`);
    else if (n === 7755) proj4.defs(code, '+proj=lcc +lat_0=24 +lon_0=80 +lat_1=12.472955 +lat_2=35.1728044444444 +x_0=4000000 +y_0=4000000 +ellps=WGS84 +units=m +no_defs');
    else if (n === 4269 || n === 4258) proj4.defs(code, '+proj=longlat +datum=WGS84 +no_defs');
    else {
      const r = await fetch(`https://epsg.io/${n}.proj4`);
      if (!r.ok) throw new Error(`Unknown projection EPSG:${n}. Reproject the image to WGS 84 / UTM and try again.`);
      proj4.defs(code, (await r.text()).trim());
    }
    defined.add(code);
    return code;
  };

  G.epsgFromImage = function (image) {
    const k = image.geoKeys || {};
    if (k.ProjectedCSTypeGeoKey && k.ProjectedCSTypeGeoKey !== 32767) return k.ProjectedCSTypeGeoKey;
    if (k.GeographicTypeGeoKey && k.GeographicTypeGeoKey !== 32767) return k.GeographicTypeGeoKey;
    if (k.GTModelTypeGeoKey === 2) return 4326;
    return null;
  };

  /* ---- geometry utils ---- */
  G.eachCoord = function (geom, fn) {
    const walk = c => { if (typeof c[0] === 'number') fn(c); else c.forEach(walk); };
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(g => G.eachCoord(g, fn));
    else walk(geom.coordinates);
  };
  G.bbox = function (geom) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    G.eachCoord(geom, ([x, y]) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; });
    return b;
  };
  G.polygons = function (geom) { // → array of polygons (array of rings)
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates];
    if (geom.type === 'MultiPolygon') return geom.coordinates;
    if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(G.polygons);
    if (geom.type === 'Feature') return G.polygons(geom.geometry);
    if (geom.type === 'FeatureCollection') return geom.features.flatMap(f => G.polygons(f.geometry));
    return [];
  };
  G.unionGeom = function (features) {
    const polys = features.flatMap(f => G.polygons(f.geometry || f));
    return { type: 'MultiPolygon', coordinates: polys };
  };
  G.pip = function (pt, geom) {
    const [x, y] = pt; let inside = false;
    for (const poly of G.polygons(geom)) {
      for (const ring of poly) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
      }
    }
    return inside;
  };
  G.areaKm2 = function (geom) { // spherical-excess approximation
    let a = 0;
    const ringA = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; s += (x2 - x1) * Math.PI / 180 * (2 + Math.sin(y1 * Math.PI / 180) + Math.sin(y2 * Math.PI / 180)); } return Math.abs(s * R * R / 2); };
    for (const p of G.polygons(geom)) { a += ringA(p[0]); for (let k = 1; k < p.length; k++) a -= ringA(p[k]); }
    return a / 1e6;
  };
  G.centroid = function (geom) { // centroid of largest polygon's outer ring
    let best = null, bestA = -1;
    for (const p of G.polygons(geom)) {
      const r = p[0]; let A = 0, cx = 0, cy = 0;
      for (let i = 0; i < r.length - 1; i++) { const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; A += f; cx += (r[i][0] + r[i + 1][0]) * f; cy += (r[i][1] + r[i + 1][1]) * f; }
      if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = A ? [cx / (3 * A), cy / (3 * A)] : r[0]; }
    }
    return best;
  };

  /* ---- analysis grid (regular in Web Mercator so it overlays Leaflet exactly) ---- */
  G.makeGrid = function (bboxLL, resM, maxPixels = 6e6) {
    const [minx, miny] = G.toMerc(bboxLL[0], bboxLL[1]);
    const [maxx, maxy] = G.toMerc(bboxLL[2], bboxLL[3]);
    const latc = (bboxLL[1] + bboxLL[3]) / 2;
    let s = resM / Math.cos(latc * Math.PI / 180);
    let w = Math.ceil((maxx - minx) / s), h = Math.ceil((maxy - miny) / s);
    let bumped = false;
    while (w * h > maxPixels) { s *= 1.25; w = Math.ceil((maxx - minx) / s); h = Math.ceil((maxy - miny) / s); bumped = true; }
    const grid = { x0: minx, y0: maxy, s, w, h, latc, resM: s * Math.cos(latc * Math.PI / 180), bumped };
    grid.key = [minx.toFixed(1), maxy.toFixed(1), s.toFixed(3), w, h].join('|');
    return grid;
  };
  G.gridBoundsLL = g => { const a = G.fromMerc(g.x0, g.y0 - g.h * g.s), b = G.fromMerc(g.x0 + g.w * g.s, g.y0); return [[a[1], a[0]], [b[1], b[0]]]; };
  G.pixelAreaKm2 = function (g) { // per-row ground area of a pixel (km²)
    const arr = new Float64Array(g.h);
    for (let r = 0; r < g.h; r++) { const lat = G.fromMerc(0, g.y0 - (r + 0.5) * g.s)[1]; const m = g.s * Math.cos(lat * Math.PI / 180); arr[r] = m * m / 1e6; }
    return arr;
  };
  G.llToPix = (g, lon, lat) => { const [x, y] = G.toMerc(lon, lat); return [(x - g.x0) / g.s, (g.y0 - y) / g.s]; };

  /* Scanline rasterisation of polygons into a label grid (Int32, −1 = none). */
  G.rasterize = function (grid, features, labels) {
    const out = labels || new Int32Array(grid.w * grid.h).fill(-1);
    features.forEach((f, id) => {
      const polys = G.polygons(f.geometry || f);
      for (const poly of polys) {
        const rings = poly.map(r => r.map(([lon, lat]) => G.llToPix(grid, lon, lat)));
        let minY = Infinity, maxY = -Infinity;
        for (const p of rings[0]) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
        const r0 = Math.max(0, Math.floor(minY)), r1 = Math.min(grid.h - 1, Math.ceil(maxY));
        const xs = [];
        for (let r = r0; r <= r1; r++) {
          const yc = r + 0.5; xs.length = 0;
          for (const ring of rings) {
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
              const [xi, yi] = ring[i], [xj, yj] = ring[j];
              if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) * (xj - xi) / (yj - yi));
            }
          }
          xs.sort((a, b) => a - b);
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(grid.w - 1, Math.floor(xs[k + 1] - 0.5));
            const base = r * grid.w;
            for (let c = c0; c <= c1; c++) out[base + c] = id;
          }
        }
      }
    });
    return out;
  };

  /* ---- GeoTIFF writer (single band Float32, EPSG:3857, uncompressed) ---- */
  G.writeFloatTiff = function (grid, data, nodata = -9999) {
    const w = grid.w, h = grid.h;
    const tags = [];
    const add = (tag, type, values) => tags.push({ tag, type, values: Array.isArray(values) ? values : [values] });
    const nd = String(nodata) + '\0';
    const geokeys = [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, 3857];
    const imgBytes = w * h * 4;
    add(256, 4, w); add(257, 4, h); add(258, 3, 32); add(259, 3, 1); add(262, 3, 1);
    add(273, 4, 0); add(277, 3, 1); add(278, 4, h); add(279, 4, imgBytes); add(284, 3, 1); add(339, 3, 3);
    add(33550, 12, [grid.s, grid.s, 0]); add(33922, 12, [0, 0, 0, grid.x0, grid.y0, 0]);
    add(34735, 3, geokeys); add(42113, 2, Array.from(nd).map(c => c.charCodeAt(0)));
    tags.sort((a, b) => a.tag - b.tag);
    const size = { 2: 1, 3: 2, 4: 4, 12: 8 };
    const ifdSize = 2 + tags.length * 12 + 4;
    let extraOff = 8 + ifdSize;
    const extras = [];
    for (const t of tags) { const n = t.values.length * size[t.type]; if (n > 4) { t.off = extraOff; extras.push(t); extraOff += n + (n % 2); } }
    const dataOff = extraOff + (extraOff % 4 ? 4 - extraOff % 4 : 0);
    tags.find(t => t.tag === 273).values = [dataOff];
    const buf = new ArrayBuffer(dataOff + imgBytes);
    const dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    let p = 8; dv.setUint16(p, tags.length, true); p += 2;
    const writeVals = (t, at) => {
      t.values.forEach((v, i) => {
        const o = at + i * size[t.type];
        if (t.type === 2) dv.setUint8(o, v); else if (t.type === 3) dv.setUint16(o, v, true);
        else if (t.type === 4) dv.setUint32(o, v, true); else dv.setFloat64(o, v, true);
      });
    };
    for (const t of tags) {
      dv.setUint16(p, t.tag, true); dv.setUint16(p + 2, t.type, true); dv.setUint32(p + 4, t.values.length, true);
      if (t.off) dv.setUint32(p + 8, t.off, true); else writeVals(t, p + 8);
      p += 12;
    }
    dv.setUint32(p, 0, true);
    for (const t of extras) writeVals(t, t.off);
    const f = new Float32Array(buf, dataOff, w * h);
    for (let i = 0; i < w * h; i++) f[i] = Number.isFinite(data[i]) ? data[i] : nodata;
    return buf;
  };

  G.download = function (blobOrText, name, type = 'application/octet-stream') {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  G.fmt = (v, d = 3) => (v == null || !Number.isFinite(v)) ? '–' : v.toFixed(d);
  G.fmtInt = v => Number.isFinite(v) ? Math.round(v).toLocaleString('en-IN') : '–';
  G.csv = rows => rows.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
})();
