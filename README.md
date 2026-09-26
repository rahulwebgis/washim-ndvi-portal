# Washim NDVI Drought Portal

A static WebGIS application for monitoring vegetation health and drought across **Washim district, Maharashtra**. It covers the district, its 6 talukas and 792 villages. Every index is computed in the browser from Sentinel-2 or Landsat cloud-optimised GeoTIFFs (COGs).

## Features

| Area | What it does |
|---|---|
| Area of interest | District, taluka (Washim, Malegaon, Risod, Mangrulpir, Manora, Karanja), any of 792 villages (with LGD codes), a drawn polygon or rectangle, or an uploaded GeoJSON or zipped Shapefile |
| Imagery | Sentinel-2 L2A (Planetary Computer or Earth Search AWS), Landsat 8/9 C2 L2 (Planetary Computer), any custom STAC API, a pasted STAC item or COG URLs, or an uploaded GeoTIFF with band mapping |
| Indices | NDVI, EVI, SAVI, NDWI, MNDWI, NDMI, NDDI, NBR, BSI, LST (Landsat ST_B10, or an uploaded thermal band with NDVI emissivity), plus true-colour, false-colour and agriculture composites |
| Processing | Mosaics same-date tiles, masks clouds with Sentinel-2 SCL or Landsat QA_PIXEL (HLS Fmask also supported), clips to the AOI, and lets you pick pixel sizes from 10 to 250 m |
| Drought | NDVI health classes, stressed-area %, A vs B change map with swipe, village and taluka zonal statistics, village choropleth |
| Time series | Clearest scene per month or fortnight, or every scene. Covers the AOI plus all talukas, with the Vegetation Condition Index (Kogan) drought classes, same-month anomalies, trend per year and CSV export |
| Report composer | A4, A3 or Letter pages in portrait or landscape. Elements are draggable and resizable: title, text, map, legend, north arrow, linked scale bar, locator map, statistics table, charts, village table, logo and footer. Auto layout builds a report in one step. Export to PDF, PNG or JPG, or print |
| Exports | Float32 GeoTIFF (EPSG:3857), PNG with world file (.pgw/.prj), village CSV and GeoJSON, and a quick map PNG with legend, north arrow and scale bar |

## Run locally

```bash
cd washim-ndvi-portal
python -m http.server 8000
# open http://localhost:8000
```
Opening `index.html` directly from disk (`file://`) blocks the boundary files, so use a web server.

## Publish on GitHub Pages

1. Create a repository, for example `washim-ndvi-portal`, and push the contents of this folder to it.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch** with `main` / `root`, and save.
3. The site is served at `https://<user>.github.io/washim-ndvi-portal/`.

## Structure

```
index.html
css/app.css
js/config.js      sources, indices, colour ramps, drought classes
js/geo.js         projections, analysis grid, polygon rasterisation, GeoTIFF writer
js/engine.js      STAC search, Planetary Computer signing, COG window reads, index maths, statistics
js/app.js         map UI, AOI, scenes, display, zonal stats, exports, map renderer
js/timeseries.js  time series, VCI, anomaly
js/report.js      report composer
data/             Washim district, talukas (dissolved from villages), villages, neighbouring districts
lib/              Leaflet, Leaflet.draw, geotiff.js, proj4, Chart.js, jsPDF, html2canvas, interact.js, shpjs (bundled locally)
```

## Notes

- **Reflectance scaling.** Sentinel-2 processing-baseline 04.00+ offsets (−0.1) are applied automatically. Earth Search items that are already harmonised are detected. Landsat uses ×0.0000275 − 0.2, and ST_B10 uses ×0.00341802 + 149 K.
- **Drought classes.** NDVI classes are indicative thresholds for rainfed Kharif cropland. VCI in the time-series tab uses the series' own min/max, so run 3 or more years (monthly) for meaningful classes.
- **Performance.** District-wide 30 m NDVI reads about 2–4 Sentinel-2 tiles and takes roughly 10–40 s depending on bandwidth. Time series read COG overviews at 100–500 m, so they are much faster per date.
- **Network.** The app needs internet access for STAC catalogues, imagery and basemap tiles. The Planetary Computer and Earth Search both allow browser (CORS) access.
- The taluka boundaries were dissolved from the village polygons. The Washim entries in the supplied taluka file were incomplete (Malegaon was missing).
