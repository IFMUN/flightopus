// Gradient sky dome + sun/moon glow + stars. Driven by the Environment.

import * as THREE from 'three'

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main () {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // force to far plane
  }
`
const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;   // glow falloff
  uniform float uHaze;
  void main () {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 col;
    if (y > 0.0) {
      float t = pow(clamp(y, 0.0, 1.0), 0.55);
      col = mix(uHorizon, uZenith, t);
    } else {
      col = mix(uHorizon, uGround, clamp(-y * 2.2, 0.0, 1.0));
    }
    // sun glow + disc
    float md = max(dot(d, normalize(uSunDir)), 0.0);
    float glow = pow(md, uSunSize);
    float disc = smoothstep(0.9985, 0.9995, md);
    col += uSunColor * glow * 0.9;
    col += uSunColor * disc * 6.0;
    // horizon haze band
    col += uHaze * uHorizon * exp(-abs(y) * 9.0) * 0.6;
    gl_FragColor = vec4(col, 1.0);
  }
`

export class Sky {
  constructor () {
    this.group = new THREE.Group()
    this.group.name = 'sky'

    this.uniforms = {
      uZenith: { value: new THREE.Color(0.18, 0.36, 0.66) },
      uHorizon: { value: new THREE.Color(0.74, 0.82, 0.92) },
      uGround: { value: new THREE.Color(0.12, 0.13, 0.16) },
      uSunDir: { value: new THREE.Vector3(0.3, 0.5, -0.4).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.95, 0.85) },
      uSunSize: { value: 900 },
      uHaze: { value: 0.5 }
    }
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(48000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms,
        side: THREE.BackSide, depthWrite: false, fog: false
      })
    )
    dome.renderOrder = -1000
    dome.frustumCulled = false
    this.group.add(dome)

    this._buildStars()
    this._buildMoon()
  }

  _buildStars () {
    const N = 4500
    const pos = new Float32Array(N * 3)
    const siz = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      // upper hemisphere bias
      const u = Math.random(), v = Math.random() * 0.85 + 0.04
      const theta = u * Math.PI * 2
      const phi = Math.acos(v)
      const r = 44000
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      pos[i * 3 + 1] = r * Math.cos(phi)
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      siz[i] = Math.random() * 2.2 + 0.5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('asize', new THREE.BufferAttribute(siz, 1))
    this.starsMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { uOpacity: { value: 0.0 } },
      vertexShader: `
        attribute float asize; varying float vt;
        void main(){ vt = asize;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = asize * (300.0 / -mv.z) * 60.0; }`,
      fragmentShader: `
        precision highp float; uniform float uOpacity; varying float vt;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
          float a = smoothstep(0.5,0.0,d);
          float tw = 0.7 + 0.3*sin(vt*40.0);
          gl_FragColor = vec4(vec3(1.0,0.97,0.92), a*uOpacity*tw); }`
    })
    this.stars = new THREE.Points(g, this.starsMat)
    this.stars.frustumCulled = false
    this.group.add(this.stars)
  }

  _buildMoon () {
    const tex = makeGlow('#dfe6f0', '#aab6c8')
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, fog: false, blending: THREE.AdditiveBlending }))
    this.moon.scale.set(2600, 2600, 1)
    this.group.add(this.moon)
  }

  setParams (p) {
    const u = this.uniforms
    u.uZenith.value.copy(p.zenith)
    u.uHorizon.value.copy(p.horizon)
    u.uGround.value.copy(p.ground)
    u.uSunColor.value.copy(p.sunColor)
    u.uSunDir.value.copy(p.sunDir)
    u.uSunSize.value = p.sunSize
    u.uHaze.value = p.haze
    this.starsMat.uniforms.uOpacity.value = p.stars
    // moon opposite-ish the sun, up high at night
    this.moon.material.opacity = p.moon
    const md = p.sunDir.clone().multiplyScalar(-1)
    md.y = Math.abs(md.y) * 0.6 + 0.5
    this.moon.position.copy(md.normalize().multiplyScalar(40000))
  }

  // keep sky centered on camera so it never clips
  follow (cam) { this.group.position.set(cam.position.x, 0, cam.position.z) }
}

export function makeGlow (inner, outer) {
  const s = 128
  const cv = document.createElement('canvas'); cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, inner)
  g.addColorStop(0.25, inner)
  g.addColorStop(0.6, outer)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
