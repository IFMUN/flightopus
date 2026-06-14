// Fetches REAL elevation + satellite imagery for Yosemite Valley and stitches
// them into bundled assets the app loads at runtime.
//
//  - Elevation: AWS "Terrain Tiles" (Terrarium RGB PNG encoding), key-free.
//      height_m = (R*256 + G + B/256) - 32768
//  - Satellite: ESRI World Imagery tiles, key-free.
//
// Output:  public/assets/heightmap.png  (lossless terrarium-encoded composite)
//          public/assets/satellite.jpg  (color imagery, same bbox)
//          public/assets/meta.json      (bbox, zoom, pixel size, scale info)
//
// If the network is unavailable the app falls back to a procedural Yosemite,
// so this script is best-effort: partial failures are tolerated.

import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/assets')

// Classic Yosemite Valley window: El Capitan + Half Dome + the big waterfalls.
const BBOX = { west: -119.705, east: -119.515, south: 37.695, north: 37.785 }
const ELEV_ZOOM = 13   // ~10-20 m/px — plenty for a 15 km valley
const SAT_ZOOM = 14    // crisper color drape
const TILE = 256

const UA = 'Mozilla/5.0 (FlightopusDataFetch; +https://example.com)'

function lon2tile (lon, z) { return ((lon + 180) / 360) * 2 ** z }
function lat2tile (lat, z) {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
function tile2lon (x, z) { return (x / 2 ** z) * 360 - 180 }
function tile2lat (y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

function tileRange (bbox, z) {
  const x0 = Math.floor(lon2tile(bbox.west, z))
  const x1 = Math.floor(lon2tile(bbox.east, z))
  const y0 = Math.floor(lat2tile(bbox.north, z)) // north = smaller y
  const y1 = Math.floor(lat2tile(bbox.south, z))
  return { x0, x1, y0, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1, z }
}

async function getTile (url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return Buffer.from(await res.arrayBuffer())
  } catch (e) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
      return getTile(url, attempt + 1)
    }
    throw e
  }
}

// Limited-concurrency map.
async function pool (items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return out
}

async function buildLayer (name, range, urlFor, { format }) {
  const { x0, y0, nx, ny, z } = range
  const W = nx * TILE
  const H = ny * TILE
  console.log(`[${name}] z${z}  ${nx}x${ny} tiles  -> ${W}x${H}px`)

  const jobs = []
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) jobs.push({ tx, ty })
  }

  let ok = 0
  let fail = 0
  const composites = await pool(jobs, 8, async ({ tx, ty }) => {
    const url = urlFor(x0 + tx, y0 + ty, z)
    try {
      const buf = await getTile(url)
      // Normalize each tile to raw PNG so sharp composites cleanly.
      const png = await sharp(buf).resize(TILE, TILE).png().toBuffer()
      ok++
      if ((ok + fail) % 16 === 0) process.stdout.write(`  ${name}: ${ok + fail}/${jobs.length}\r`)
      return { input: png, left: tx * TILE, top: ty * TILE }
    } catch (e) {
      fail++
      return null
    }
  })

  const valid = composites.filter(Boolean)
  console.log(`\n[${name}] fetched ${ok}/${jobs.length} tiles (${fail} failed)`)
  if (valid.length < jobs.length * 0.5) {
    throw new Error(`${name}: too many tile failures (${fail}/${jobs.length})`)
  }

  let img = sharp({ create: { width: W, height: H, channels: 3, background: { r: 30, g: 40, b: 30 } } })
    .composite(valid)

  if (format === 'png') {
    await img.png({ compressionLevel: 9 }).toFile(resolve(OUT, name + '.png'))
  } else {
    // Cap satellite size to keep the texture GPU-friendly.
    await img.resize({ width: Math.min(W, 4096), withoutEnlargement: true })
      .jpeg({ quality: 82 }).toFile(resolve(OUT, name + '.jpg'))
  }
  return { W, H, range }
}

async function main () {
  await mkdir(OUT, { recursive: true })

  const elevRange = tileRange(BBOX, ELEV_ZOOM)
  const satRange = tileRange(BBOX, SAT_ZOOM)

  // Exact geographic bounds covered by the stitched grids (whole tiles).
  const elevBounds = {
    west: tile2lon(elevRange.x0, ELEV_ZOOM),
    east: tile2lon(elevRange.x1 + 1, ELEV_ZOOM),
    north: tile2lat(elevRange.y0, ELEV_ZOOM),
    south: tile2lat(elevRange.y1 + 1, ELEV_ZOOM)
  }
  const satBounds = {
    west: tile2lon(satRange.x0, SAT_ZOOM),
    east: tile2lon(satRange.x1 + 1, SAT_ZOOM),
    north: tile2lat(satRange.y0, SAT_ZOOM),
    south: tile2lat(satRange.y1 + 1, SAT_ZOOM)
  }

  let elev = null
  let sat = null
  let meta_satSource = null

  try {
    elev = await buildLayer(
      'heightmap', elevRange,
      (x, y, z) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
      { format: 'png' }
    )
  } catch (e) {
    console.warn('Elevation fetch failed:', e.message)
  }

  // Try several key-free aerial imagery providers in order.
  const SAT_SOURCES = [
    { name: 'USGS National Map Imagery', url: (x, y, z) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}` },
    { name: 'ESRI World Imagery', url: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}` },
    { name: 'Google Satellite', url: (x, y, z) => `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}` }
  ]
  for (const src of SAT_SOURCES) {
    try {
      console.log(`[satellite] trying: ${src.name}`)
      sat = await buildLayer('satellite', satRange, src.url, { format: 'jpg' })
      meta_satSource = src.name
      break
    } catch (e) {
      console.warn(`[satellite] ${src.name} failed:`, e.message)
    }
  }

  // Use the elevation grid as the authoritative geographic frame.
  const frame = elev ? elevBounds : satBounds
  const midLat = (frame.north + frame.south) / 2
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * midLat * Math.PI / 180)
  const mPerDegLon = 111412.84 * Math.cos(midLat * Math.PI / 180) - 93.5 * Math.cos(3 * midLat * Math.PI / 180)
  const widthMeters = (frame.east - frame.west) * mPerDegLon
  const heightMeters = (frame.north - frame.south) * mPerDegLat

  const meta = {
    source: {
      elevation: elev ? 'AWS Terrain Tiles (Terrarium RGB)' : null,
      satellite: sat ? meta_satSource : null
    },
    bbox: frame,
    satBbox: satBounds,
    elevZoom: ELEV_ZOOM,
    satZoom: SAT_ZOOM,
    heightmap: elev ? { width: elev.W, height: elev.H } : null,
    widthMeters,
    heightMeters,
    mPerDegLat,
    mPerDegLon,
    // Terrarium decode: h = R*256 + G + B/256 - 32768
    decode: { scaleR: 256, scaleG: 1, scaleB: 1 / 256, offset: -32768 }
  }
  await writeFile(resolve(OUT, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log('\nWrote meta.json')
  console.log(`Region: ${widthMeters.toFixed(0)} m x ${heightMeters.toFixed(0)} m`)
  console.log(elev ? 'Elevation: REAL ✓' : 'Elevation: missing (app will synthesize)')
  console.log(sat ? 'Satellite: REAL ✓' : 'Satellite: missing (app will synthesize)')
}

main().catch(e => { console.error(e); process.exit(1) })
