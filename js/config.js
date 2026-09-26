/* Washim NDVI Drought Portal — configuration: imagery sources, indices, colour ramps, classes */
window.WP = window.WP || {};

WP.PC_API = 'https://planetarycomputer.microsoft.com/api/stac/v1';
WP.PC_SAS = 'https://planetarycomputer.microsoft.com/api/sas/v1/token/';

WP.SOURCES = {
  'pc-s2': {
    label: 'Sentinel-2 L2A (Planetary Computer)', short: 'Sentinel-2', api: WP.PC_API, collection: 'sentinel-2-l2a',
    sign: 'pc', mask: 'scl', nativeRes: 10,
    bands: { blue: 'B02', green: 'B03', red: 'B04', nir: 'B08', swir1: 'B11', swir2: 'B12', qa: 'SCL' }
  },
  'es-s2': {
    label: 'Sentinel-2 L2A (Earth Search)', short: 'Sentinel-2', api: 'https://earth-search.aws.element84.com/v1', collection: 'sentinel-2-l2a',
    sign: null, mask: 'scl', nativeRes: 10,
    bands: { blue: 'blue', green: 'green', red: 'red', nir: 'nir', swir1: 'swir16', swir2: 'swir22', qa: 'scl' }
  },
  'pc-ls': {
    label: 'Landsat 8/9 C2 L2 (Planetary Computer)', short: 'Landsat', api: WP.PC_API, collection: 'landsat-c2-l2',
    sign: 'pc', mask: 'landsat', nativeRes: 30,
    query: { platform: { in: ['landsat-8', 'landsat-9'] } },
    bands: { blue: 'blue', green: 'green', red: 'red', nir: 'nir08', swir1: 'swir16', swir2: 'swir22', lwir: 'lwir11', qa: 'qa_pixel' }
  }
};

/* common-name → list of asset keys commonly used by STAC catalogues (for custom STAC auto-mapping) */
WP.ASSET_GUESS = {
  blue: ['blue', 'B02', 'b02', 'B2', 'SR_B2', 'sr_b2'],
  green: ['green', 'B03', 'b03', 'B3', 'SR_B3'],
  red: ['red', 'B04', 'b04', 'B4', 'SR_B4'],
  nir: ['nir', 'nir08', 'B08', 'b08', 'B8', 'B8A', 'B05', 'SR_B5', 'nir08'],
  swir1: ['swir16', 'swir1', 'B11', 'b11', 'SR_B6'],
  swir2: ['swir22', 'swir2', 'B12', 'b12', 'SR_B7'],
  lwir: ['lwir11', 'lwir', 'ST_B10', 'st_b10', 'B10'],
  qa: ['scl', 'SCL', 'qa_pixel', 'QA_PIXEL', 'Fmask', 'fmask']
};
WP.COMMON_TO_EO = { blue: 'blue', green: 'green', red: 'red', nir: 'nir', swir1: 'swir16', swir2: 'swir22', lwir: 'lwir11' };

WP.BAND_LABELS = { blue: 'Blue', green: 'Green', red: 'Red', nir: 'NIR', swir1: 'SWIR-1 (1.6 µm)', swir2: 'SWIR-2 (2.2 µm)', lwir: 'Thermal', qa: 'Cloud mask (SCL / QA)' };

/* ---------- Colour ramps ---------- */
WP.RAMPS = {
  ndvi: { name: 'NDVI (soil → crop)', stops: ['#7a3b10', '#b8671c', '#dca43f', '#f1e08b', '#b7d56b', '#6fb34a', '#2e8b3a', '#0d5b28'] },
  rdylgn: { name: 'Red–Yellow–Green', stops: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'] },
  brbg: { name: 'Brown–Teal', stops: ['#543005', '#8c510a', '#bf812d', '#dfc27d', '#f6e8c3', '#c7eae5', '#80cdc1', '#35978f', '#01665e', '#003c30'] },
  blues: { name: 'Water (tan → blue)', stops: ['#8c6d46', '#c9ae82', '#efe6cf', '#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
  turbo: { name: 'Turbo', stops: ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0403'] },
  inferno: { name: 'Inferno', stops: ['#000004', '#1f0c48', '#550f6d', '#88226a', '#ba3655', '#e35933', '#f98e09', '#f9cb35', '#fcffa4'] },
  viridis: { name: 'Viridis', stops: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'] },
  rdbu: { name: 'Change (loss → gain)', stops: ['#8e2a0b', '#c9531f', '#ec9a55', '#f7d6ae', '#f4f4f0', '#c3e3b2', '#7cc36f', '#2f8f3c', '#0c5a24'] },
  spectral: { name: 'Spectral', stops: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'] }
};

/* ---------- Classes ---------- */
WP.CLASSES = {
  ndvi: {
    title: 'Vegetation health (NDVI)',
    items: [
      { max: 0.05, label: 'Water / built-up', color: '#4f7fb0' },
      { max: 0.15, label: 'Bare soil · extreme stress', color: '#8a3a12' },
      { max: 0.25, label: 'Severe stress', color: '#d4562b' },
      { max: 0.35, label: 'Moderate stress', color: '#eea53a' },
      { max: 0.50, label: 'Mild stress · sparse cover', color: '#e6dc74' },
      { max: 0.65, label: 'Healthy', color: '#7dbf55' },
      { max: Infinity, label: 'Dense, vigorous', color: '#1f7a37' }
    ],
    stressBelow: 0.35, stressAbove: 0.05
  },
  ndwi: {
    title: 'Surface water (NDWI)',
    items: [
      { max: -0.3, label: 'Dry vegetation / soil', color: '#9a7a4c' },
      { max: 0.0, label: 'Moist vegetation', color: '#cdbf8e' },
      { max: 0.2, label: 'Wet surface / shallow water', color: '#6baed6' },
      { max: Infinity, label: 'Open water', color: '#08519c' }
    ]
  },
  ndmi: {
    title: 'Canopy moisture (NDMI)',
    items: [
      { max: -0.2, label: 'Very dry · high water stress', color: '#8a3a12' },
      { max: 0.0, label: 'Dry · water stress', color: '#e08a3a' },
      { max: 0.2, label: 'Moderate moisture', color: '#e8dc8a' },
      { max: 0.4, label: 'High moisture', color: '#5fb0a0' },
      { max: Infinity, label: 'Very high / waterlogged', color: '#1c5f8f' }
    ],
    stressBelow: 0.0, stressAbove: -1
  },
  lst: {
    title: 'Land surface temperature',
    items: [
      { max: 30, label: '< 30 °C', color: '#2c7bb6' },
      { max: 35, label: '30–35 °C', color: '#abd9e9' },
      { max: 40, label: '35–40 °C', color: '#ffffbf' },
      { max: 45, label: '40–45 °C', color: '#fdae61' },
      { max: 50, label: '45–50 °C', color: '#e5502b' },
      { max: Infinity, label: '> 50 °C', color: '#8a0f1c' }
    ]
  },
  change: {
    title: 'NDVI change (B − A)',
    items: [
      { max: -0.2, label: 'Strong loss', color: '#8e2a0b' },
      { max: -0.1, label: 'Moderate loss', color: '#e07b3c' },
      { max: -0.03, label: 'Slight loss', color: '#f4cfa0' },
      { max: 0.03, label: 'Stable', color: '#eeeeea' },
      { max: 0.1, label: 'Slight gain', color: '#b8dea5' },
      { max: 0.2, label: 'Moderate gain', color: '#5fae4d' },
      { max: Infinity, label: 'Strong gain', color: '#0c5a24' }
    ]
  },
  vci: [
    { max: 10, label: 'Extreme drought', color: '#7f1d0c' },
    { max: 20, label: 'Severe drought', color: '#c8431e' },
    { max: 30, label: 'Moderate drought', color: '#ec8f3a' },
    { max: 40, label: 'Mild drought', color: '#f2cf5b' },
    { max: Infinity, label: 'No drought', color: '#5fae4d' }
  ]
};

/* ---------- Indices ----------
   b = reflectance values (0–1); lwir in Kelvin (already scaled) */
WP.INDICES = {
  ndvi: { name: 'NDVI', long: 'Normalised Difference Vegetation Index', bands: ['red', 'nir'], range: [-0.1, 0.9], ramp: 'ndvi', classes: 'ndvi', unit: '',
    formula: '(NIR − Red) / (NIR + Red)', use: 'Crop vigour and greenness; core drought indicator.',
    fn: b => (b.nir - b.red) / (b.nir + b.red) },
  evi: { name: 'EVI', long: 'Enhanced Vegetation Index', bands: ['blue', 'red', 'nir'], range: [-0.1, 0.8], ramp: 'ndvi', classes: 'ndvi', unit: '',
    formula: '2.5 (NIR − Red) / (NIR + 6 Red − 7.5 Blue + 1)', use: 'Less saturation over dense canopy; corrects for haze.',
    fn: b => 2.5 * (b.nir - b.red) / (b.nir + 6 * b.red - 7.5 * b.blue + 1) },
  savi: { name: 'SAVI', long: 'Soil-Adjusted Vegetation Index', bands: ['red', 'nir'], range: [-0.1, 0.8], ramp: 'ndvi', classes: 'ndvi', unit: '',
    formula: '1.5 (NIR − Red) / (NIR + Red + 0.5)', use: 'Sparse crops and exposed black-cotton soil early in the season.',
    fn: b => 1.5 * (b.nir - b.red) / (b.nir + b.red + 0.5) },
  ndwi: { name: 'NDWI', long: 'Normalised Difference Water Index (McFeeters)', bands: ['green', 'nir'], range: [-0.6, 0.4], ramp: 'blues', classes: 'ndwi', unit: '',
    formula: '(Green − NIR) / (Green + NIR)', use: 'Open water in tanks, dams and rivers (Penganga, Katepurna).',
    fn: b => (b.green - b.nir) / (b.green + b.nir) },
  mndwi: { name: 'MNDWI', long: 'Modified NDWI (Xu)', bands: ['green', 'swir1'], range: [-0.6, 0.6], ramp: 'blues', classes: 'ndwi', unit: '',
    formula: '(Green − SWIR1) / (Green + SWIR1)', use: 'Water bodies with less confusion from built-up land.',
    fn: b => (b.green - b.swir1) / (b.green + b.swir1) },
  ndmi: { name: 'NDMI', long: 'Normalised Difference Moisture Index', bands: ['nir', 'swir1'], range: [-0.4, 0.5], ramp: 'brbg', classes: 'ndmi', unit: '',
    formula: '(NIR − SWIR1) / (NIR + SWIR1)', use: 'Canopy water content; early sign of crop water stress.',
    fn: b => (b.nir - b.swir1) / (b.nir + b.swir1) },
  nddi: { name: 'NDDI', long: 'Normalised Difference Drought Index', bands: ['red', 'nir', 'swir1'], range: [-0.5, 1.5], ramp: 'rdylgn', classes: null, unit: '', invert: true,
    formula: '(NDVI − NDMI) / (NDVI + NDMI)', use: 'Higher values mean drier conditions (Gu et al., 2007).',
    fn: b => { const v = (b.nir - b.red) / (b.nir + b.red), w = (b.nir - b.swir1) / (b.nir + b.swir1); const s = v + w; return Math.abs(s) < 0.02 ? NaN : (v - w) / s; } },
  nbr: { name: 'NBR', long: 'Normalised Burn Ratio', bands: ['nir', 'swir2'], range: [-0.3, 0.7], ramp: 'rdylgn', classes: null, unit: '',
    formula: '(NIR − SWIR2) / (NIR + SWIR2)', use: 'Stubble and residue burning, harvested fields.',
    fn: b => (b.nir - b.swir2) / (b.nir + b.swir2) },
  bsi: { name: 'BSI', long: 'Bare Soil Index', bands: ['blue', 'red', 'nir', 'swir1'], range: [-0.4, 0.4], ramp: 'brbg', classes: null, unit: '', invert: true,
    formula: '((SWIR1 + Red) − (NIR + Blue)) / ((SWIR1 + Red) + (NIR + Blue))', use: 'Fallow and bare fields; higher means more exposed soil.',
    fn: b => ((b.swir1 + b.red) - (b.nir + b.blue)) / ((b.swir1 + b.red) + (b.nir + b.blue)) },
  lst: { name: 'LST', long: 'Land Surface Temperature', bands: ['lwir'], optBands: ['red', 'nir'], range: [25, 50], ramp: 'turbo', classes: 'lst', unit: '°C', thermal: true,
    formula: 'Landsat ST_B10 × 0.00341802 + 149.0 − 273.15', use: 'Heat stress on crops and soil; Landsat or uploaded thermal band only.',
    fn: (b, opts) => {
      let T = b.lwir; // Kelvin
      if (opts && opts.emissivity && isFinite(b.red) && isFinite(b.nir)) {
        const nd = (b.nir - b.red) / (b.nir + b.red);
        let pv = (nd - 0.2) / (0.5 - 0.2); pv = Math.min(1, Math.max(0, pv)); pv *= pv;
        const e = nd < 0 ? 0.991 : (nd < 0.2 ? 0.966 : (nd > 0.5 ? 0.99 : 0.004 * pv + 0.986));
        T = T / (1 + (10.895e-6 * T / 1.4388e-2) * Math.log(e));
      }
      return T - 273.15;
    } },
  truecolor: { name: 'True colour', long: 'Natural colour composite (Red, Green, Blue)', bands: ['red', 'green', 'blue'], rgb: true, formula: 'R = Red, G = Green, B = Blue', use: 'Visual check of fields, clouds and water.' },
  falsecolor: { name: 'False colour', long: 'Colour-infrared composite (NIR, Red, Green)', bands: ['nir', 'red', 'green'], rgb: true, formula: 'R = NIR, G = Red, B = Green', use: 'Healthy crops appear bright red.' },
  agri: { name: 'Agriculture', long: 'Agriculture composite (SWIR1, NIR, Blue)', bands: ['swir1', 'nir', 'blue'], rgb: true, formula: 'R = SWIR1, G = NIR, B = Blue', use: 'Separates crops, fallow and moist soil.' }
};

WP.BASEMAPS = {
  imagery: { name: 'Esri World Imagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Esri, Maxar, Earthstar Geographics', max: 19 },
  dark: { name: 'Carto Dark', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', attr: '© OpenStreetMap © CARTO', max: 19, sub: 'abcd' },
  light: { name: 'Carto Light', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', attr: '© OpenStreetMap © CARTO', max: 19, sub: 'abcd' },
  topo: { name: 'Esri Topographic', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attr: 'Esri', max: 19 },
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: '© OpenStreetMap contributors', max: 19 },
  none: { name: 'No basemap', url: null }
};
