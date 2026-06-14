// Particle effects: persistent wreckage fire + smoke, and a soft blob shadow
// that tracks the live aircraft across the terrain.

import * as THREE from 'three'
import { makeGlow } from '../core/sky.js'

const fireTex = makeFire()
const smokeTex = makeSmoke()

export class FireSmoke {
  constructor (origin, scale = 1) {
    this.group = new THREE.Group()
    this.group.position.copy(origin)
    this.scale = scale
    this.t = 0

    // fire (additive, upward, flickering)
    this.NF = 110
    this.fireGeo = new THREE.BufferGeometry()
    this.firePos = new Float32Array(this.NF * 3)
    this.fireLife = new Float32Array(this.NF)
    this.fireSeed = new Float32Array(this.NF)
    for (let i = 0; i < this.NF; i++) { this.fireLife[i] = Math.random(); this.fireSeed[i] = Math.random() }
    this.fireGeo.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3))
    this.fireMat = new THREE.PointsMaterial({ map: fireTex, size: 17 * scale, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffa83a })
    this.fire = new THREE.Points(this.fireGeo, this.fireMat)
    this.fire.frustumCulled = false
    this.group.add(this.fire)

    // smoke (dark, rising, expanding)
    this.NS = 80
    this.smokeGeo = new THREE.BufferGeometry()
    this.smokePos = new Float32Array(this.NS * 3)
    this.smokeLife = new Float32Array(this.NS)
    for (let i = 0; i < this.NS; i++) this.smokeLife[i] = Math.random()
    this.smokeGeo.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3))
    this.smokeMat = new THREE.PointsMaterial({ map: smokeTex, size: 32 * scale, transparent: true, depthWrite: false, opacity: 0.7, color: 0x1c1c1c })
    this.smoke = new THREE.Points(this.smokeGeo, this.smokeMat)
    this.smoke.frustumCulled = false
    this.group.add(this.smoke)

    // ember glow light
    this.light = new THREE.PointLight(0xff7722, 60, 220, 2)
    this.light.position.y = 3
    this.group.add(this.light)
  }

  update (dt, t, wind) {
    this.t += dt
    const wx = wind ? wind.x : 0
    const wz = wind ? wind.z : 0
    for (let i = 0; i < this.NF; i++) {
      this.fireLife[i] -= dt * (0.8 + this.fireSeed[i] * 0.6)
      if (this.fireLife[i] <= 0) {
        this.fireLife[i] = 1
        this.firePos[i * 3] = (Math.random() - 0.5) * 6 * this.scale
        this.firePos[i * 3 + 1] = 0
        this.firePos[i * 3 + 2] = (Math.random() - 0.5) * 6 * this.scale
      }
      const l = this.fireLife[i]
      this.firePos[i * 3 + 1] += dt * (14 + (1 - l) * 8) * this.scale
      this.firePos[i * 3] += dt * (Math.sin(t * 3 + i) * 1.5 + wx * 0.05)
      this.firePos[i * 3 + 2] += dt * (Math.cos(t * 2 + i) * 1.5 + wz * 0.05)
    }
    this.fireGeo.attributes.position.needsUpdate = true
    this.fireMat.opacity = 0.9

    for (let i = 0; i < this.NS; i++) {
      this.smokeLife[i] -= dt * 0.22
      if (this.smokeLife[i] <= 0) {
        this.smokeLife[i] = 1
        this.smokePos[i * 3] = (Math.random() - 0.5) * 5 * this.scale
        this.smokePos[i * 3 + 1] = 6 * this.scale
        this.smokePos[i * 3 + 2] = (Math.random() - 0.5) * 5 * this.scale
      }
      this.smokePos[i * 3 + 1] += dt * 18 * this.scale
      this.smokePos[i * 3] += dt * (4 + wx * 0.25)
      this.smokePos[i * 3 + 2] += dt * (wz * 0.25)
    }
    this.smokeGeo.attributes.position.needsUpdate = true
    this.light.intensity = 50 + Math.sin(t * 18) * 20 + Math.sin(t * 7) * 12
  }

  dispose () {
    this.fireGeo.dispose(); this.smokeGeo.dispose()
    this.fireMat.dispose(); this.smokeMat.dispose()
  }
}

export function makeBlobShadow () {
  const tex = makeGlow('rgba(0,0,0,0.55)', 'rgba(0,0,0,0.0)')
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, color: 0x000000 })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), mat)
  m.rotation.x = -Math.PI / 2
  m.renderOrder = 5
  return m
}

function makeFire () {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,230,1)')
  g.addColorStop(0.4, 'rgba(255,170,60,0.9)')
  g.addColorStop(1, 'rgba(120,30,0,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t
}
function makeSmoke () {
  const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(120,120,120,0.8)')
  g.addColorStop(1, 'rgba(60,60,60,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv); return t
}
