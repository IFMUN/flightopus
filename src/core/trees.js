// Procedural conifer forest. Individual trees are placed by classifying the
// real elevation grid (elevation band + slope + clustering noise + water
// avoidance) and rendered as instanced low-poly conifers, lit by the scene
// lights so they react to time-of-day and weather like everything else.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

export class Forest {
  constructor (heightfield, geo) {
    this.hf = heightfield
    this.geo = geo
    this.group = new THREE.Group()
    this.group.name = 'forest'
    this.swayMats = []
    this._build()
  }

  _build () {
    const target = CONFIG.trees
    const { widthMeters, heightMeters } = this.geo
    const hf = this.hf

    // --- collect placements ---
    const xs = [], ys = [], zs = [], sc = [], rot = [], tint = []
    const maxAttempts = target * 7
    let placed = 0
    for (let a = 0; a < maxAttempts && placed < target; a++) {
      const x = (Math.random() - 0.5) * widthMeters * 0.985
      const z = (Math.random() - 0.5) * heightMeters * 0.985
      const h = hf.height(x, z)
      const slope = hf.slope(x, z)
      const p = forestProb(x, z, h, slope, hf.min)
      if (p <= 0 || Math.random() > p) continue
      xs.push(x); ys.push(h); zs.push(z)
      const s = 0.6 + Math.random() * 0.95
      sc.push(s)
      rot.push(Math.random() * Math.PI * 2)
      // green variation; a few autumn/golden ones lower down
      const autumn = h < hf.min + 500 && Math.random() < 0.05
      tint.push(autumn ? new THREE.Color(0.42, 0.30, 0.12) : new THREE.Color().setHSL(0.28 + Math.random() * 0.05, 0.4 + Math.random() * 0.18, 0.15 + Math.random() * 0.09))
      placed++
    }
    this.count = placed

    // --- geometry (low-poly conifer) ---
    const foliage = coniferFoliage()
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.9, 5, 4, 1)
    trunkGeo.translate(0, 2.5, 0)

    const foliageMat = new THREE.MeshLambertMaterial({ color: 0xffffff, fog: true })
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a, fog: true })

    const foliageMesh = new THREE.InstancedMesh(foliage, foliageMat, placed)
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, placed)
    foliageMesh.frustumCulled = true
    trunkMesh.frustumCulled = true

    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scl = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const baseHeight = 9 // unscaled foliage height ~9m; *scale -> 5..14m + trunk
    for (let i = 0; i < placed; i++) {
      q.setFromAxisAngle(up, rot[i])
      const s = sc[i]
      pos.set(xs[i], ys[i], zs[i])
      scl.set(s, s * (0.9 + Math.random() * 0.5), s)
      m.compose(pos, q, scl)
      foliageMesh.setMatrixAt(i, m)
      trunkMesh.setMatrixAt(i, m)
      foliageMesh.setColorAt(i, tint[i])
    }
    foliageMesh.instanceMatrix.needsUpdate = true
    trunkMesh.instanceMatrix.needsUpdate = true
    if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true

    // gentle wind sway on the canopy
    addSway(foliageMat, baseHeight)
    this.swayMats.push(foliageMat)

    this.group.add(trunkMesh)
    this.group.add(foliageMesh)
  }

  update (t, windStrength) {
    for (const mat of this.swayMats) {
      if (mat.userData.shader) {
        mat.userData.shader.uniforms.uTime.value = t
        mat.userData.shader.uniforms.uWind.value = windStrength
      }
    }
  }
}

function coniferFoliage () {
  // two stacked cones merged into one buffer geometry
  const geos = []
  const c1 = new THREE.ConeGeometry(3.0, 6, 7, 1); c1.translate(0, 5, 0)
  const c2 = new THREE.ConeGeometry(2.1, 5, 7, 1); c2.translate(0, 8.5, 0)
  geos.push(c1, c2)
  return mergeGeoms(geos)
}

function mergeGeoms (geoms) {
  let vCount = 0, iCount = 0
  for (const g of geoms) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const idx = new Uint32Array(iCount)
  let vo = 0, io = 0, base = 0
  for (const g of geoms) {
    const p = g.attributes.position.array, n = g.attributes.normal.array
    pos.set(p, vo * 3); nor.set(n, vo * 3)
    const gi = g.index ? g.index.array : null
    if (gi) for (let i = 0; i < gi.length; i++) idx[io++] = gi[i] + base
    else for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + base
    vo += g.attributes.position.count; base = vo
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  out.setIndex(new THREE.BufferAttribute(idx, 1))
  return out
}

function addSway (mat, height) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }
    shader.uniforms.uWind = { value: 0.2 }
    shader.uniforms.uHeight = { value: height }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uWind; uniform float uHeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float ph = ip.x * 0.05 + ip.z * 0.043;
          float sway = sin(uTime * 1.4 + ph) * 0.04 + sin(uTime * 0.6 + ph * 2.0) * 0.02;
          float up = clamp(position.y / uHeight, 0.0, 1.0);
          transformed.x += sway * up * (1.0 + uWind * 5.0) * uHeight * 0.5;
        #endif`)
    mat.userData.shader = shader
  }
}

function forestProb (x, z, h, slope, minH) {
  if (slope > 0.52) return 0
  // elevation band: grows from valley up to subalpine, fades near treeline
  const lo = smooth(minH + 30, minH + 260, h)
  const hi = 1 - smooth(2480, 2820, h)
  let band = lo * hi
  if (band <= 0) return 0
  // steepness falloff
  band *= 1 - smooth(0.34, 0.52, slope)
  // clustering / clearings
  const n = fbm(x * 0.0012, z * 0.0012)
  band *= smooth(0.32, 0.62, n)
  // thin out near water / open meadow
  if (h < minH + 18 && slope < 0.08) band *= 0.15
  return Math.min(1, band * 1.15)
}

// --- noise ---
function hash (x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
function vnoise (x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function fbm (x, y) { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, y); x *= 2.0; y *= 2.0; a *= 0.5 } return s }
function smooth (e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
