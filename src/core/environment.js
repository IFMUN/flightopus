// Time-of-day + lighting orchestration. Owns the sun/moon directional light,
// hemispheric ambient, fog, sky dome params and pushes everything into the
// terrain shader so the whole world stays consistent. Weather layers a
// modifier on top (dimming, fog, tint, flashes).

import * as THREE from 'three'
import { Sky } from './sky.js'

function dir (azDeg, elDeg) {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180
  return new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    -Math.cos(el) * Math.cos(az)
  ).normalize()
}
const C = (r, g, b) => new THREE.Color(r, g, b)

export const TIME_PRESETS = {
  dawn: {
    label: 'Dawn', sunAz: 92, sunEl: 6,
    sunColor: C(1.0, 0.62, 0.46), sunInt: 2.0,
    zenith: C(0.20, 0.31, 0.52), horizon: C(0.98, 0.66, 0.55), ground: C(0.10, 0.10, 0.13),
    fog: C(0.85, 0.71, 0.66), fogDensity: 0.000060,
    hemiSky: C(0.55, 0.55, 0.72), hemiGround: C(0.30, 0.26, 0.24), hemiInt: 0.8,
    snowLine: 2500, stars: 0.30, moon: 0.25, haze: 0.75, sunSize: 650
  },
  day: {
    label: 'Midday', sunAz: 168, sunEl: 64,
    sunColor: C(1.0, 0.97, 0.90), sunInt: 3.2,
    zenith: C(0.15, 0.40, 0.80), horizon: C(0.70, 0.82, 0.95), ground: C(0.12, 0.13, 0.16),
    fog: C(0.74, 0.82, 0.92), fogDensity: 0.000038,
    hemiSky: C(0.60, 0.76, 1.0), hemiGround: C(0.40, 0.38, 0.32), hemiInt: 1.25,
    snowLine: 2580, stars: 0.0, moon: 0.0, haze: 0.45, sunSize: 1500
  },
  golden: {
    label: 'Golden Hour', sunAz: 250, sunEl: 10,
    sunColor: C(1.0, 0.72, 0.40), sunInt: 2.4,
    zenith: C(0.22, 0.30, 0.54), horizon: C(1.0, 0.64, 0.40), ground: C(0.12, 0.11, 0.12),
    fog: C(0.96, 0.74, 0.56), fogDensity: 0.000052,
    hemiSky: C(0.72, 0.62, 0.62), hemiGround: C(0.36, 0.28, 0.24), hemiInt: 0.95,
    snowLine: 2520, stars: 0.0, moon: 0.0, haze: 0.85, sunSize: 560
  },
  dusk: {
    label: 'Dusk', sunAz: 270, sunEl: 1.5,
    sunColor: C(1.0, 0.48, 0.40), sunInt: 1.3,
    zenith: C(0.10, 0.14, 0.32), horizon: C(0.86, 0.44, 0.46), ground: C(0.08, 0.08, 0.12),
    fog: C(0.50, 0.40, 0.50), fogDensity: 0.000066,
    hemiSky: C(0.42, 0.42, 0.62), hemiGround: C(0.24, 0.20, 0.24), hemiInt: 0.60,
    snowLine: 2480, stars: 0.45, moon: 0.55, haze: 0.9, sunSize: 480
  },
  night: {
    label: 'Night', sunAz: 305, sunEl: -16, lightAz: 300, lightEl: 42,
    sunColor: C(0.45, 0.55, 0.85), sunInt: 0.22,
    zenith: C(0.02, 0.04, 0.10), horizon: C(0.05, 0.08, 0.17), ground: C(0.02, 0.03, 0.05),
    fog: C(0.04, 0.06, 0.12), fogDensity: 0.000058,
    hemiSky: C(0.10, 0.14, 0.28), hemiGround: C(0.03, 0.04, 0.07), hemiInt: 0.40,
    snowLine: 2450, stars: 1.0, moon: 0.95, haze: 0.30, sunSize: 380
  }
}
export const TIME_ORDER = ['dawn', 'day', 'golden', 'dusk', 'night']

export class Environment {
  constructor (scene, terrainUniforms) {
    this.scene = scene
    this.tu = terrainUniforms
    this.sky = new Sky()
    scene.add(this.sky.group)

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3)
    this.sunLight.name = 'sun'
    scene.add(this.sunLight)
    scene.add(this.sunLight.target)

    this.hemi = new THREE.HemisphereLight(0x88aaff, 0x554433, 1)
    scene.add(this.hemi)

    scene.fog = new THREE.FogExp2(0xbcc8d8, 0.00004)

    this._mod = null
    this._flash = 0
    this.setTime('golden')
  }

  setTime (name) {
    this.timeName = name
    this.base = TIME_PRESETS[name] || TIME_PRESETS.golden
    this._apply()
  }

  setWeatherMod (mod) { this._mod = mod; this._apply() }

  flash (amt) { this._flash = Math.max(this._flash, amt) }

  update (dt) {
    if (this._flash > 0.001) {
      this._flash = Math.max(0, this._flash - dt * 3.0)
      this._apply(this._flash)
    } else if (this._flash !== 0) {
      this._flash = 0
      this._apply(0)
    }
  }

  _apply (flash = 0) {
    const p = this.base
    const m = this._mod || {}
    const sunMul = (m.sunMul ?? 1)
    const ambMul = (m.ambientMul ?? 1)
    const fogMul = (m.fogDensityMul ?? 1)
    const fogColor = m.fogColor ? p.fog.clone().lerp(m.fogColor, m.fogColorMix ?? 0.6) : p.fog.clone()

    const sunDir = dir(p.sunAz, p.sunEl)
    const lightDir = dir(p.lightAz ?? p.sunAz, p.lightEl ?? Math.max(p.sunEl, 3))

    // directional sun/moon light
    this.sunLight.position.copy(lightDir.clone().multiplyScalar(30000))
    this.sunLight.target.position.set(0, 0, 0)
    const sc = p.sunColor.clone()
    if (m.tint) sc.lerp(m.tint, m.tintMix ?? 0.3)
    this.sunLight.color.copy(sc)
    this.sunLight.intensity = p.sunInt * sunMul + flash * 6.0

    // ambient
    this.hemi.color.copy(p.hemiSky)
    this.hemi.groundColor.copy(p.hemiGround)
    this.hemi.intensity = p.hemiInt * ambMul + flash * 1.5

    // fog
    this.scene.fog.color.copy(fogColor).lerp(new THREE.Color(1, 1, 1), flash * 0.5)
    this.scene.fog.density = p.fogDensity * fogMul

    // sky dome
    this.sky.setParams({
      zenith: p.zenith.clone().lerp(new THREE.Color(1, 1, 1), flash * 0.3),
      horizon: fogColor.clone().lerp(p.horizon, 0.5),
      ground: p.ground,
      sunDir, sunColor: sc, sunSize: p.sunSize, haze: p.haze * (m.hazeMul ?? 1),
      stars: p.stars * (m.starsMul ?? 1), moon: p.moon
    })

    // terrain shader
    const tu = this.tu
    if (tu) {
      tu.uSunDir.value.copy(lightDir)
      tu.uSunColor.value.copy(sc).multiplyScalar(p.sunInt * sunMul * 0.34 + flash)
      tu.uSkyColor.value.copy(p.hemiSky).multiplyScalar(0.9)
      tu.uGroundColor.value.copy(p.hemiGround)
      tu.uAmbient.value = p.hemiInt * ambMul * 0.5 + 0.12
      tu.uFogColor.value.copy(this.scene.fog.color)
      tu.uFogDensity.value = this.scene.fog.density
      tu.uSnowLine.value = (p.snowLine) + (m.snowLineDelta ?? 0)
    }

    this.sunDir = sunDir
    this.lightDir = lightDir
  }
}
