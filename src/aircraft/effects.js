// Particle effects: persistent wreckage fire + smoke, and a soft blob shadow
// that tracks the live aircraft across the terrain.

import * as THREE from 'three'
import { makeGlow } from '../core/sky.js'

const fireTex = makeFire()
const smokeTex = makeSmoke()
const sparkTex = makeSpark()

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

// Battle damage that streams from a moving world point (a damaged part):
// additive orange flames at the source + flying sparks/embers + a dark smoke
// trail, all dragging behind the moving jet.
export class TrailSmoke {
  constructor (scene, { color = 0x1d1d1d, size = 9, n = 46 } = {}) {
    this.scene = scene; this.n = n
    this.t = 0
    this._src = new THREE.Vector3()
    this._prev = new THREE.Vector3()
    this._haveSrc = false

    // dark smoke (the original behaviour, slightly richer)
    this.pos = new Float32Array(n * 3); this.life = new Float32Array(n)
    for (let i = 0; i < n; i++) this.life[i] = Math.random()
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.mat = new THREE.PointsMaterial({ map: smokeTex, size, transparent: true, opacity: 0.42, depthWrite: false, color })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    scene.add(this.points)

    // additive flames anchored near the source
    this.NF = 28
    this.firePos = new Float32Array(this.NF * 3); this.fireLife = new Float32Array(this.NF)
    this.fireSeed = new Float32Array(this.NF)
    for (let i = 0; i < this.NF; i++) { this.fireLife[i] = Math.random(); this.fireSeed[i] = Math.random() }
    this.fireGeo = new THREE.BufferGeometry()
    this.fireGeo.setAttribute('position', new THREE.BufferAttribute(this.firePos, 3))
    this.fireMat = new THREE.PointsMaterial({ map: fireTex, size: size * 1.5, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff8a2a })
    this.fire = new THREE.Points(this.fireGeo, this.fireMat)
    this.fire.frustumCulled = false
    scene.add(this.fire)

    // flying sparks / embers (carry velocity, fall with a little gravity)
    this.NSP = 30
    this.sparkPos = new Float32Array(this.NSP * 3); this.sparkVel = new Float32Array(this.NSP * 3)
    this.sparkLife = new Float32Array(this.NSP)
    for (let i = 0; i < this.NSP; i++) this.sparkLife[i] = 0
    this.sparkGeo = new THREE.BufferGeometry()
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3))
    this.sparkMat = new THREE.PointsMaterial({ map: sparkTex, size: size * 0.9, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd06a })
    this.sparks = new THREE.Points(this.sparkGeo, this.sparkMat)
    this.sparks.frustumCulled = false
    scene.add(this.sparks)
  }

  update (dt, src, wind, intensity = 0.6) {
    const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0
    this.t += dt
    const I = THREE.MathUtils.clamp(intensity, 0, 1)

    // jet velocity, so flames/smoke drag behind the moving part
    if (this._haveSrc) this._prev.set((src.x - this._src.x) / Math.max(dt, 1e-4), (src.y - this._src.y) / Math.max(dt, 1e-4), (src.z - this._src.z) / Math.max(dt, 1e-4))
    this._src.copy(src); this._haveSrc = true
    const vx = this._prev.x, vy = this._prev.y, vz = this._prev.z

    // ---- dark smoke trail ----
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt * 0.55
      if (this.life[i] <= 0) {
        this.life[i] = 1
        this.pos[i * 3] = src.x + (Math.random() - 0.5) * 2.5
        this.pos[i * 3 + 1] = src.y + (Math.random() - 0.5) * 2.5
        this.pos[i * 3 + 2] = src.z + (Math.random() - 0.5) * 2.5
      } else {
        this.pos[i * 3] += (wx * 0.3 - vx * 0.35) * dt
        this.pos[i * 3 + 1] += dt * 9
        this.pos[i * 3 + 2] += (wz * 0.3 - vz * 0.35) * dt
      }
    }
    this.geo.attributes.position.needsUpdate = true
    this.mat.opacity = 0.30 + 0.30 * I

    // ---- additive flames hugging the source, dragged back along the jet ----
    for (let i = 0; i < this.NF; i++) {
      this.fireLife[i] -= dt * (1.6 + this.fireSeed[i] * 1.2)
      if (this.fireLife[i] <= 0) {
        this.fireLife[i] = 0.6 + Math.random() * 0.5
        this.firePos[i * 3] = src.x + (Math.random() - 0.5) * 1.8
        this.firePos[i * 3 + 1] = src.y + (Math.random() - 0.5) * 1.4
        this.firePos[i * 3 + 2] = src.z + (Math.random() - 0.5) * 1.8
      } else {
        const fl = this.fireLife[i]
        this.firePos[i * 3] += (-vx * 0.5 + Math.sin(this.t * 6 + i) * 1.5) * dt
        this.firePos[i * 3 + 1] += (5 + (1 - fl) * 4 - vy * 0.3) * dt
        this.firePos[i * 3 + 2] += (-vz * 0.5 + Math.cos(this.t * 5 + i) * 1.5) * dt
      }
    }
    this.fireGeo.attributes.position.needsUpdate = true
    this.fire.visible = I > 0.02
    this.fireMat.opacity = (0.55 + 0.4 * I) * (0.85 + 0.15 * Math.sin(this.t * 22))
    this.fireMat.size = (this.mat.size * 1.4) * (0.7 + 0.8 * I)

    // ---- sparks / embers ----
    const spawn = I > 0.05 ? Math.min(this.NSP, Math.ceil(I * 4)) : 0
    let made = 0
    for (let i = 0; i < this.NSP && made < spawn; i++) {
      if (this.sparkLife[i] <= 0 && Math.random() < 0.5) {
        this.sparkLife[i] = 0.5 + Math.random() * 0.7
        this.sparkPos[i * 3] = src.x; this.sparkPos[i * 3 + 1] = src.y; this.sparkPos[i * 3 + 2] = src.z
        this.sparkVel[i * 3] = -vx * 0.6 + (Math.random() - 0.5) * 22
        this.sparkVel[i * 3 + 1] = -vy * 0.4 + Math.random() * 14
        this.sparkVel[i * 3 + 2] = -vz * 0.6 + (Math.random() - 0.5) * 22
        made++
      }
    }
    for (let i = 0; i < this.NSP; i++) {
      if (this.sparkLife[i] <= 0) { this.sparkPos[i * 3 + 1] = -1e6; continue }
      this.sparkLife[i] -= dt
      this.sparkVel[i * 3 + 1] -= 26 * dt // gravity
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt
    }
    this.sparkGeo.attributes.position.needsUpdate = true
    this.sparks.visible = I > 0.05

    return true
  }

  dispose () {
    this.scene.remove(this.points); this.geo.dispose(); this.mat.dispose()
    this.scene.remove(this.fire); this.fireGeo.dispose(); this.fireMat.dispose()
    this.scene.remove(this.sparks); this.sparkGeo.dispose(); this.sparkMat.dispose()
  }
}

// One-shot crash blast: bright flash sprite + expanding fireball + expanding
// shockwave ring + flying debris/sparks (with gravity) + a punchy PointLight,
// all additive and fading over ~1s. Drives itself; returns false when done.
export class Explosion {
  constructor (scene, position, opts = {}) {
    this.scene = scene
    this.scale = opts.scale ?? 1
    this.t = 0
    this.dur = opts.dur ?? 1.0
    this.group = new THREE.Group()
    this.group.position.copy(position)
    scene.add(this.group)
    const S = this.scale

    // bright core flash (billboard sprite, pops then collapses)
    this.flashMat = new THREE.SpriteMaterial({ map: fireTex, color: 0xfff2c0, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    this.flash = new THREE.Sprite(this.flashMat)
    this.flash.scale.setScalar(40 * S)
    this.group.add(this.flash)

    // expanding shockwave ring (lies roughly flat, grows + fades)
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1.0, 48), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 2 * S
    this.group.add(this.ring)

    // expanding fireball (additive points puffing outward)
    this.NB = 60
    this.ballPos = new Float32Array(this.NB * 3); this.ballDir = new Float32Array(this.NB * 3)
    for (let i = 0; i < this.NB; i++) {
      const d = randDir()
      this.ballDir[i * 3] = d.x; this.ballDir[i * 3 + 1] = d.y * 0.7 + 0.3; this.ballDir[i * 3 + 2] = d.z
    }
    this.ballGeo = new THREE.BufferGeometry()
    this.ballGeo.setAttribute('position', new THREE.BufferAttribute(this.ballPos, 3))
    this.ballMat = new THREE.PointsMaterial({ map: fireTex, size: 34 * S, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff9a3a })
    this.ball = new THREE.Points(this.ballGeo, this.ballMat)
    this.ball.frustumCulled = false
    this.group.add(this.ball)

    // flying debris + sparks with gravity
    this.ND = 70
    this.debPos = new Float32Array(this.ND * 3); this.debVel = new Float32Array(this.ND * 3)
    for (let i = 0; i < this.ND; i++) {
      const d = randDir()
      const sp = (28 + Math.random() * 70) * S
      this.debVel[i * 3] = d.x * sp
      this.debVel[i * 3 + 1] = Math.abs(d.y) * sp * 0.9 + 22 * S
      this.debVel[i * 3 + 2] = d.z * sp
    }
    this.debGeo = new THREE.BufferGeometry()
    this.debGeo.setAttribute('position', new THREE.BufferAttribute(this.debPos, 3))
    this.debMat = new THREE.PointsMaterial({ map: sparkTex, size: 7 * S, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffe08a })
    this.deb = new THREE.Points(this.debGeo, this.debMat)
    this.deb.frustumCulled = false
    this.group.add(this.deb)

    // rising dark smoke from the blast
    this.NS = 26
    this.smkPos = new Float32Array(this.NS * 3); this.smkLife = new Float32Array(this.NS)
    for (let i = 0; i < this.NS; i++) {
      this.smkLife[i] = Math.random()
      this.smkPos[i * 3] = (Math.random() - 0.5) * 10 * S
      this.smkPos[i * 3 + 1] = Math.random() * 6 * S
      this.smkPos[i * 3 + 2] = (Math.random() - 0.5) * 10 * S
    }
    this.smkGeo = new THREE.BufferGeometry()
    this.smkGeo.setAttribute('position', new THREE.BufferAttribute(this.smkPos, 3))
    this.smkMat = new THREE.PointsMaterial({ map: smokeTex, size: 44 * S, transparent: true, opacity: 0.0, depthWrite: false, color: 0x222222 })
    this.smk = new THREE.Points(this.smkGeo, this.smkMat)
    this.smk.frustumCulled = false
    this.group.add(this.smk)

    // punchy flash light
    this.light = new THREE.PointLight(0xffaa55, 900 * S, 600 * S, 2)
    this.light.position.y = 6 * S
    this.group.add(this.light)
  }

  update (dt) {
    this.t += dt
    const f = this.t / this.dur
    if (f >= 1) return false
    const S = this.scale

    // core flash: snap big, collapse fast
    const ff = Math.min(1, this.t / (this.dur * 0.28))
    this.flash.scale.setScalar((30 + 90 * (1 - ff)) * S * (0.4 + 0.6 * Math.min(1, this.t / 0.05)))
    this.flashMat.opacity = Math.max(0, 1 - ff) * (this.t < 0.04 ? this.t / 0.04 : 1)

    // shockwave ring: expand outward, fade
    const rr = (8 + 220 * f) * S
    this.ring.scale.setScalar(rr)
    this.ringMat.opacity = Math.max(0, 1 - f) * 0.85

    // fireball: puff outward then dim
    const exp = (1 - Math.pow(1 - f, 2))
    for (let i = 0; i < this.NB; i++) {
      const r = exp * (70 + (i % 7) * 9) * S
      this.ballPos[i * 3] = this.ballDir[i * 3] * r
      this.ballPos[i * 3 + 1] = this.ballDir[i * 3 + 1] * r + f * 14 * S
      this.ballPos[i * 3 + 2] = this.ballDir[i * 3 + 2] * r
    }
    this.ballGeo.attributes.position.needsUpdate = true
    this.ballMat.opacity = Math.max(0, 1 - f * 1.3)
    this.ballMat.color.setRGB(1, 0.6 - 0.45 * f, 0.25 - 0.22 * f)
    this.ballMat.size = (34 + 24 * f) * S

    // debris with gravity
    for (let i = 0; i < this.ND; i++) {
      this.debVel[i * 3 + 1] -= 40 * S * dt
      this.debPos[i * 3] += this.debVel[i * 3] * dt
      this.debPos[i * 3 + 1] += this.debVel[i * 3 + 1] * dt
      this.debPos[i * 3 + 2] += this.debVel[i * 3 + 2] * dt
    }
    this.debGeo.attributes.position.needsUpdate = true
    this.debMat.opacity = Math.max(0, 1 - f * 1.1)

    // smoke rises + fades in then out
    for (let i = 0; i < this.NS; i++) {
      this.smkPos[i * 3 + 1] += dt * 20 * S
      this.smkPos[i * 3] += dt * 4 * S
    }
    this.smkGeo.attributes.position.needsUpdate = true
    this.smkMat.opacity = 0.5 * Math.sin(Math.min(Math.PI, f * Math.PI * 1.1))

    // light: hard spike then exponential decay
    this.light.intensity = (900 * S) * Math.max(0, Math.exp(-f * 6) - f * 0.08)

    return true
  }

  dispose () {
    this.scene.remove(this.group)
    this.flashMat.map = null; this.flashMat.dispose()
    this.ringMat.map?.dispose?.(); this.ringMat.dispose(); this.ring.geometry.dispose()
    this.ballGeo.dispose(); this.ballMat.dispose()
    this.debGeo.dispose(); this.debMat.dispose()
    this.smkGeo.dispose(); this.smkMat.dispose()
  }
}

function randDir () {
  const u = Math.random() * 2 - 1
  const a = Math.random() * Math.PI * 2
  const s = Math.sqrt(Math.max(0, 1 - u * u))
  return new THREE.Vector3(Math.cos(a) * s, u, Math.sin(a) * s)
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
function makeSpark () {
  const s = 32, cv = document.createElement('canvas'); cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,210,120,0.95)')
  g.addColorStop(1, 'rgba(255,120,30,0)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t
}
