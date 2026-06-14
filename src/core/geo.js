// Geographic <-> local world transforms.
// World frame: origin at bbox center.  +X = east, +Z = south, +Y = up (meters).
// North therefore points toward -Z, matching a standard nav heading where
// heading 0 = north = -Z and heading 90 = east = +X.

import { ASSET_BASE } from '../config.js'

export async function loadMeta () {
  try {
    const res = await fetch(`${ASSET_BASE}assets/meta.json`)
    if (!res.ok) throw new Error('no meta')
    return await res.json()
  } catch (e) {
    return null
  }
}

export class Geo {
  constructor (meta) {
    // Fallback synthetic frame if real data is missing.
    if (!meta || !meta.bbox) {
      meta = {
        bbox: { west: -119.705, east: -119.515, south: 37.695, north: 37.785 },
        widthMeters: 16700,
        heightMeters: 9990,
        mPerDegLon: 88000,
        mPerDegLat: 111000,
        heightmap: { width: 1024, height: 768 }
      }
      this.synthetic = true
    }
    this.meta = meta
    this.bbox = meta.bbox
    this.centerLon = (meta.bbox.west + meta.bbox.east) / 2
    this.centerLat = (meta.bbox.south + meta.bbox.north) / 2
    this.widthMeters = meta.widthMeters
    this.heightMeters = meta.heightMeters
    this.mPerDegLon = meta.mPerDegLon
    this.mPerDegLat = meta.mPerDegLat
    this.W = meta.heightmap?.width || 1024
    this.H = meta.heightmap?.height || 768
  }

  lonLatToWorld (lon, lat) {
    return {
      x: (lon - this.centerLon) * this.mPerDegLon,
      z: (this.centerLat - lat) * this.mPerDegLat
    }
  }

  // World (x,z) -> fractional heightmap pixel coords.
  worldToPixel (x, z) {
    return {
      col: (x / this.widthMeters + 0.5) * (this.W - 1),
      row: (z / this.heightMeters + 0.5) * (this.H - 1)
    }
  }

  // World (x,z) -> 0..1 UV across the terrain (for texture draping).
  worldToUV (x, z) {
    return {
      u: x / this.widthMeters + 0.5,
      v: 1 - (z / this.heightMeters + 0.5)
    }
  }
}
