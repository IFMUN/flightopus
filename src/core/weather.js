// Dynamic weather: a wind field that the flight model reads (so gusts, shear
// and hurricane-force winds physically shove the jet), plus rain/snow, a
// scrolling cloud deck, aurora curtains and lightning.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const D2R = Math.PI / 180

export const WEATHER_PRESETS = {
  clear:  { label: 'Clear', windBase: 3, windDir: 250, gust: 2, turb: 0.4, cloud: 0.08, precip: 'none',
            mod: { fogDensityMul: 0.9, sunMul: 1, ambientMul: 1 } },
  cloudy: { label: 'Cloudy', windBase: 8, windDir: 240, gust: 5, turb: 1.0, cloud: 0.55, precip: 'none',
            mod: { fogDensityMul: 1.4, sunMul: 0.7, ambientMul: 1.05, fogColor: new THREE.Color(0.7, 0.74, 0.8) } },
  rain:   { label: 'Rain', windBase: 12, windDir: 230, gust: 8, turb: 1.8, cloud: 0.85, precip: 'rain', precipRate: 1,
            mod: { fogDensityMul: 2.6, sunMul: 0.42, ambientMul: 0.9, fogColor: new THREE.Color(0.55, 0.58, 0.63) } },
  snow:   { label: 'Snow', windBase: 6, windDir: 300, gust: 5, turb: 1.2, cloud: 0.8, precip: 'snow', precipRate: 1, snowLineDelta: -900,
            mod: { fogDensityMul: 2.2, sunMul: 0.6, ambientMul: 1.1, fogColor: new THREE.Color(0.82, 0.85, 0.9), snowLineDelta: -900 } },
  storm:  { label: 'Storm — hurricane winds', windBase: 30, windDir: 215, gust: 16, turb: 5.0, cloud: 1.0, precip: 'rain', precipRate: 2, lightning: true,
            mod: { fogDensityMul: 3.4, sunMul: 0.28, ambientMul: 0.75, fogColor: new THREE.Color(0.4, 0.42, 0.48) } },
  aurora: { label: 'Aurora (best at night)', windBase: 4, windDir: 200, gust: 2, turb: 0.3, cloud: 0.05, precip: 'none', aurora: true,
            mod: { fogDensityMul: 0.8, sunMul: 1, ambientMul: 1 } }
}
export const WEATHER_ORDER = ['clear', 'cloudy', 'rain', 'snow', 'storm', 'aurora']

export class Weather {
  constructor (scene, env, geo) {
    this.scene = scene
    this.env = env
    this.geo = geo
    this.name = 'clear'
    this.preset = WEATHER_PRESETS.clear
    this._wind = new THREE.Vector3()
    this._gustPhase = Math.random() * 100
    this._lightT = 4 + Math.random() * 4

    this._buildClouds()
    this._buildPrecip()
    this._buildAurora()
    // lightning strikes
    this.onStrike = null
    this.target = null
    this._boltT = 0
    this._boltDur = 0.5
    this._boltMeshes = []
    // bright blue-white core shared by all bolt segments
    this._boltMat = new THREE.MeshBasicMaterial({ color: 0xeaf3ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    // additive impact flash sprite at the plane
    this._impactMat = new THREE.SpriteMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    this._impact = new THREE.Sprite(this._impactMat)
    this._impact.visible = false
    this.scene.add(this._impact)
    // flicker schedule (fractions of bolt life at which to re-flash env)
    this._flickerSeq = [0.1, 0.2, 0.32, 0.46, 0.64]
    this._flickerIdx = 0
    this.setWeather(CONFIG.initialWeather || 'clear')
  }

  setTarget (fm) { this.target = fm }

  // ---- wind field read by the flight model ----
  getWind (pos, t) {
    const p = this.preset
    const dir = p.windDir * D2R
    const base = p.windBase
    // direction wind blows toward (meteorological dir is where it comes FROM)
    const toward = dir + Math.PI
    const gust = (Math.sin(t * 0.7 + this._gustPhase) * 0.6 + Math.sin(t * 1.9 + pos.x * 0.0003) * 0.4) * p.gust
    const speed = base + gust
    const wx = Math.sin(toward) * speed
    const wz = -Math.cos(toward) * speed
    // turbulence (3D jitter) + mountain-wave-ish vertical near terrain
    const tb = p.turb
    const tx = Math.sin(t * 3.1 + pos.z * 0.002) * tb
    const ty = Math.sin(t * 2.3 + pos.x * 0.0017) * tb * 0.8
    const tz = Math.cos(t * 2.7 + pos.x * 0.002) * tb
    this._wind.set(wx + tx, ty, wz + tz)
    return this._wind
  }

  windSpeed () { return this.preset.windBase + this.preset.gust * 0.5 }

  setWeather (name) {
    if (!WEATHER_PRESETS[name]) name = 'clear'
    this.name = name
    this.preset = WEATHER_PRESETS[name]
    this.env.setWeatherMod(this.preset.mod || {})
    // clouds
    this.cloudMat.uniforms.uCover.value = this.preset.cloud
    this.cloudMat.uniforms.uDark.value = name === 'storm' ? 0.75 : (name === 'rain' ? 0.5 : 0.15)
    // precip mode
    this._precipMode = this.preset.precip
    this.rain.visible = this._precipMode === 'rain'
    this.snow.visible = this._precipMode === 'snow'
    this.auroraGroup.visible = !!this.preset.aurora
  }

  cycle () {
    const i = WEATHER_ORDER.indexOf(this.name)
    this.setWeather(WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length])
    return this.preset.label
  }

  update (dt, t, camera) {
    // clouds follow camera, scroll with wind
    this.cloudMesh.position.set(camera.position.x, this.cloudY, camera.position.z)
    this.cloudMat.uniforms.uTime.value = t
    this.cloudMat.uniforms.uWind.value.set(Math.sin(this.preset.windDir * D2R) * 0.02, Math.cos(this.preset.windDir * D2R) * 0.02)

    this._updatePrecip(dt, t, camera)

    if (this.preset.aurora) {
      this.auroraGroup.position.set(camera.position.x, 0, camera.position.z)
      this.auroraMat.uniforms.uTime.value = t
    }

    // lightning
    if (this.preset.lightning) {
      this._lightT -= dt
      if (this._lightT <= 0) {
        this._lightT = 1.8 + Math.random() * 4.0
        this.env.flash(0.9 + Math.random() * 0.6)
        // a strike sometimes finds the exposed jet
        if (this.target && !this.target.onGround && !this.target.dead && Math.random() < 0.5) this._strikePlane()
      }
    }
    if (this._boltT > 0) {
      this._boltT -= dt
      const life = Math.max(0, this._boltT / this._boltDur) // 1 -> 0
      const age = 1 - life // 0 -> 1

      // flicker: re-flash the environment a few times across the bolt's life
      while (this._flickerIdx < this._flickerSeq.length && age >= this._flickerSeq[this._flickerIdx]) {
        this.env.flash(1.15 - this._flickerIdx * 0.16)
        this._flickerIdx++
      }
      // strobing brightness — a few on/off blinks plus an overall decay
      const strobe = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(age * Math.PI * 14))
      this._boltMat.opacity = life * strobe

      // impact flash pops at the plane then fades fast
      const ip = Math.max(0, 1 - age * 2.4)
      this._impactMat.opacity = ip * 0.9
      this._impact.scale.setScalar(60 + (1 - ip) * 140)

      if (this._boltT <= 0) this._clearBolt()
    }
  }

  _clearBolt () {
    for (const m of this._boltMeshes) { this.scene.remove(m); m.geometry.dispose() }
    this._boltMeshes.length = 0
    this._impact.visible = false
    this._impactMat.opacity = 0
  }

  // build one jagged tube between two points; segs/jit control roughness
  _boltSegment (from, to, jit, radius, droop = 0) {
    const n = 9
    const pts = []
    for (let i = 0; i <= n; i++) {
      const f = i / n
      const taper = (i > 0 && i < n) ? Math.sin(f * Math.PI) : 0
      pts.push(new THREE.Vector3(
        THREE.MathUtils.lerp(from.x, to.x, f) + (Math.random() - 0.5) * jit * taper,
        THREE.MathUtils.lerp(from.y, to.y, f) + (Math.random() - 0.5) * jit * taper - droop * f * f,
        THREE.MathUtils.lerp(from.z, to.z, f) + (Math.random() - 0.5) * jit * taper))
    }
    const curve = new THREE.CatmullRomCurve3(pts)
    const geo = new THREE.TubeGeometry(curve, 40, radius, 5, false)
    const mesh = new THREE.Mesh(geo, this._boltMat)
    mesh.frustumCulled = false
    this.scene.add(mesh)
    this._boltMeshes.push(mesh)
    return pts
  }

  _strikePlane () {
    const p = this.target.pos
    this._clearBolt()

    const top = new THREE.Vector3(
      p.x + (Math.random() - 0.5) * 240,
      p.y + 1600,
      p.z + (Math.random() - 0.5) * 240)
    const plane = new THREE.Vector3(p.x, p.y, p.z)

    // main jagged bolt: sky -> plane (thick bright core)
    const spine = this._boltSegment(top, plane, 130, 3.0)

    // 2-4 shorter forks peeling off the upper/mid spine, hanging downward
    const forks = 2 + Math.floor(Math.random() * 3)
    for (let k = 0; k < forks; k++) {
      const a = spine[1 + Math.floor(Math.random() * (spine.length - 3))]
      const len = 180 + Math.random() * 320
      const end = new THREE.Vector3(
        a.x + (Math.random() - 0.5) * 260,
        a.y - len,
        a.z + (Math.random() - 0.5) * 260)
      this._boltSegment(a, end, 70, 1.6, 30)
    }

    // impact flash at the plane
    this._impact.position.copy(plane)
    this._impact.scale.setScalar(60)
    this._impactMat.opacity = 0.9
    this._impact.visible = true

    this._boltT = this._boltDur
    this._flickerIdx = 0
    this.env.flash(1.6)
    this.onStrike?.()
  }

  // ---- clouds ----
  _buildClouds () {
    this.cloudY = 3300
    const geo = new THREE.PlaneGeometry(46000, 46000, 1, 1)
    geo.rotateX(-Math.PI / 2)
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uTime: { value: 0 }, uCover: { value: 0.1 }, uDark: { value: 0.15 },
        uWind: { value: new THREE.Vector2(0.01, 0.01) }
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision highp float; varying vec2 vUv;
        uniform float uTime, uCover, uDark; uniform vec2 uWind;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
        float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
        float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vn(p);p*=2.02;a*=.5;}return v;}
        void main(){
          vec2 p = (vUv-0.5)*22.0 + uWind*uTime*8.0;
          float n = fbm(p) ;
          float c = smoothstep(1.0-uCover, 1.05-uCover*0.4, n);
          vec3 col = mix(vec3(0.96,0.97,1.0), vec3(0.32,0.34,0.4), uDark);
          float edge = smoothstep(0.0, 0.55, length(vUv-0.5)); // fade far edge
          gl_FragColor = vec4(col, c*(1.0-edge)*0.93);
        }`
    })
    this.cloudMesh = new THREE.Mesh(geo, this.cloudMat)
    this.cloudMesh.renderOrder = -10
    this.cloudMesh.frustumCulled = false
    this.scene.add(this.cloudMesh)
  }

  // ---- precipitation ----
  _buildPrecip () {
    this.precipBox = 320
    const N = CONFIG.test ? 600 : 6000
    this.NP = N
    // rain as line segments
    const rpos = new Float32Array(N * 2 * 3)
    this._rainP = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) this._seedDrop(i, true)
    this._writeRain(rpos)
    this.rainGeo = new THREE.BufferGeometry()
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3))
    this.rain = new THREE.LineSegments(this.rainGeo, new THREE.LineBasicMaterial({ color: 0x9fb4cc, transparent: true, opacity: 0.45 }))
    this.rain.frustumCulled = false
    this.rain.visible = false
    this.scene.add(this.rain)
    // snow as points
    this._snowP = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { this._snowP[i * 3] = (Math.random() - 0.5) * this.precipBox; this._snowP[i * 3 + 1] = Math.random() * this.precipBox; this._snowP[i * 3 + 2] = (Math.random() - 0.5) * this.precipBox }
    this.snowGeo = new THREE.BufferGeometry()
    this.snowGeo.setAttribute('position', new THREE.BufferAttribute(this._snowP, 3))
    this.snow = new THREE.Points(this.snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, transparent: true, opacity: 0.85, depthWrite: false }))
    this.snow.frustumCulled = false
    this.snow.visible = false
    this.scene.add(this.snow)
  }

  _seedDrop (i, anywhere) {
    this._rainP = this._rainP || new Float32Array(this.NP * 3)
    this._rainP[i * 3] = (Math.random() - 0.5) * this.precipBox
    this._rainP[i * 3 + 1] = anywhere ? Math.random() * this.precipBox : this.precipBox * 0.5
    this._rainP[i * 3 + 2] = (Math.random() - 0.5) * this.precipBox
  }

  _writeRain (arr) {
    const slantX = 2.5, slantZ = 0
    for (let i = 0; i < this.NP; i++) {
      const x = this._rainP[i * 3], y = this._rainP[i * 3 + 1], z = this._rainP[i * 3 + 2]
      arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z
      arr[i * 6 + 3] = x + slantX; arr[i * 6 + 4] = y - 6; arr[i * 6 + 5] = z + slantZ
    }
  }

  _updatePrecip (dt, t, camera) {
    const box = this.precipBox
    this.rain.position.copy(camera.position)
    this.snow.position.copy(camera.position)
    if (this._precipMode === 'rain') {
      const fall = 90 * dt * this.preset.precipRate
      const wx = this._wind.x * dt, wz = this._wind.z * dt
      for (let i = 0; i < this.NP; i++) {
        this._rainP[i * 3] += wx; this._rainP[i * 3 + 1] -= fall; this._rainP[i * 3 + 2] += wz
        if (this._rainP[i * 3 + 1] < -box * 0.5) this._seedDrop(i, false)
        this._wrap(i, box)
      }
      this._writeRain(this.rainGeo.attributes.position.array)
      this.rainGeo.attributes.position.needsUpdate = true
    } else if (this._precipMode === 'snow') {
      const fall = 14 * dt
      for (let i = 0; i < this.NP; i++) {
        this._snowP[i * 3] += Math.sin(t * 0.7 + i) * 0.4 + this._wind.x * dt * 0.3
        this._snowP[i * 3 + 1] -= fall
        this._snowP[i * 3 + 2] += Math.cos(t * 0.6 + i) * 0.4 + this._wind.z * dt * 0.3
        if (this._snowP[i * 3 + 1] < -box * 0.5) this._snowP[i * 3 + 1] = box * 0.5
        this._wrapArr(this._snowP, i, box)
      }
      this.snowGeo.attributes.position.needsUpdate = true
    }
  }

  _wrap (i, box) { this._wrapArr(this._rainP, i, box) }
  _wrapArr (a, i, box) {
    const h = box * 0.5
    if (a[i * 3] > h) a[i * 3] -= box; else if (a[i * 3] < -h) a[i * 3] += box
    if (a[i * 3 + 2] > h) a[i * 3 + 2] -= box; else if (a[i * 3 + 2] < -h) a[i * 3 + 2] += box
  }

  // ---- aurora ----
  _buildAurora () {
    this.auroraGroup = new THREE.Group()
    this.auroraMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; uniform float uTime;
        void main(){ vUv=uv; vec3 p=position; p.x += sin(uv.y*6.0+uTime*0.6)*900.0; p.z += cos(uv.y*5.0+uTime*0.5)*700.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime;
        void main(){ float v = smoothstep(0.0,0.2,vUv.y)*smoothstep(1.0,0.6,vUv.y);
          float ribbon = 0.5+0.5*sin(vUv.x*18.0+uTime*1.2);
          vec3 c = mix(vec3(0.15,1.0,0.55), vec3(0.5,0.25,1.0), vUv.y);
          gl_FragColor = vec4(c, v*ribbon*0.78); }`
    })
    for (let k = 0; k < 5; k++) {
      const g = new THREE.PlaneGeometry(26000, 6500, 28, 10)
      const m = new THREE.Mesh(g, this.auroraMat)
      m.position.set((k - 2) * 2600, 6200 + k * 220, -3200 - k * 700)
      m.rotation.x = -0.5
      m.rotation.y = 0.12 * (k - 2)
      this.auroraGroup.add(m)
    }
    this.auroraGroup.visible = false
    this.scene.add(this.auroraGroup)
  }
}
