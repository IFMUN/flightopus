// Decodes the terrarium-encoded heightmap PNG into a Float32 elevation grid and
// provides fast bilinear sampling in world space. Falls back to a procedural
// Yosemite-like field if the real heightmap is unavailable.

import { ASSET_BASE } from '../config.js'

export class Heightfield {
  constructor (geo) {
    this.geo = geo
    this.W = geo.W
    this.H = geo.H
    this.data = null
    this.min = Infinity
    this.max = -Infinity
  }

  async load () {
    const ok = await this._loadReal().catch(() => false)
    if (!ok) this._synthesize()
    this._computeStats()
    return this
  }

  async _loadReal () {
    if (this.geo.synthetic) return false
    const img = await loadImage(`${ASSET_BASE}assets/heightmap.png`)
    const W = img.naturalWidth, H = img.naturalHeight
    const cv = document.createElement('canvas')
    cv.width = W; cv.height = H
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    const px = ctx.getImageData(0, 0, W, H).data
    const data = new Float32Array(W * H)
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      data[i] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768
    }
    this.W = W; this.H = H; this.data = data
    return true
  }

  // Procedural Yosemite-ish valley: flat-ish floor with steep granite walls,
  // a couple of dome-like massifs. Only used if the real DEM can't be loaded.
  _synthesize () {
    const W = this.W, H = this.H
    const data = new Float32Array(W * H)
    const floor = 1200, wall = 2700
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const u = c / (W - 1), v = r / (H - 1)
        // valley runs east-west through the middle
        const dv = Math.abs(v - 0.5)
        const valley = Math.exp(-(dv * dv) / (2 * 0.10 * 0.10))
        let h = wall - (wall - floor) * valley
        // domes
        h += 900 * bump(u, v, 0.78, 0.40, 0.07)
        h += 700 * bump(u, v, 0.30, 0.58, 0.06)
        h += fbm(u * 7, v * 7) * 260
        // carve a meander on the floor
        const river = Math.exp(-Math.pow((v - 0.5 - 0.04 * Math.sin(u * 12)) / 0.012, 2))
        h -= river * 30
        data[r * W + c] = h
      }
    }
    this.data = data
  }

  _computeStats () {
    let mn = Infinity, mx = -Infinity
    const d = this.data
    for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i] }
    this.min = mn; this.max = mx
  }

  // Raw bilinear sample by fractional pixel coords.
  atPixel (col, row) {
    const W = this.W, H = this.H, d = this.data
    if (col < 0) col = 0; else if (col > W - 1) col = W - 1
    if (row < 0) row = 0; else if (row > H - 1) row = H - 1
    const c0 = col | 0, r0 = row | 0
    const c1 = c0 + 1 < W ? c0 + 1 : c0
    const r1 = r0 + 1 < H ? r0 + 1 : r0
    const fx = col - c0, fy = row - r0
    const a = d[r0 * W + c0], b = d[r0 * W + c1]
    const e = d[r1 * W + c0], f = d[r1 * W + c1]
    const top = a + (b - a) * fx
    const bot = e + (f - e) * fx
    return top + (bot - top) * fy
  }

  // Elevation (meters) at world x (east), z (south).
  height (x, z) {
    const p = this.geo.worldToPixel(x, z)
    return this.atPixel(p.col, p.row)
  }

  // Surface normal in world space via central differences.
  normal (x, z, out) {
    const e = 12 // sample step (m)
    const hL = this.height(x - e, z), hR = this.height(x + e, z)
    const hD = this.height(x, z - e), hU = this.height(x, z + e)
    const nx = (hL - hR) / (2 * e)
    const nz = (hD - hU) / (2 * e)
    out = out || { x: 0, y: 0, z: 0 }
    const inv = 1 / Math.hypot(nx, 1, nz)
    out.x = nx * inv; out.y = 1 * inv; out.z = nz * inv
    return out
  }

  // Steepness 0 (flat) .. 1 (vertical).
  slope (x, z) {
    const n = this.normal(x, z)
    return 1 - Math.max(0, Math.min(1, n.y))
  }
}

function loadImage (src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// --- procedural helpers (fallback only) ---
function hash (x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function noise (x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm (x, y) {
  let v = 0, amp = 0.5
  for (let i = 0; i < 5; i++) { v += amp * noise(x, y); x *= 2; y *= 2; amp *= 0.5 }
  return v
}
function bump (u, v, cu, cv, r) {
  const du = u - cu, dv = v - cv
  return Math.exp(-(du * du + dv * dv) / (2 * r * r))
}
