// The six famous Yosemite waterfalls, placed at their real brink coordinates
// and oriented down the local cliff fall-line, with an animated water shader,
// plunge pools and drifting mist.

import * as THREE from 'three'
import { makeGlow } from './sky.js'

const FALLS = [
  { name: 'Yosemite Falls', lat: 37.7568, lon: -119.5966, drop: 436, width: 30 },
  { name: 'Ribbon Fall', lat: 37.7376, lon: -119.6527, drop: 480, width: 9 },
  { name: 'Bridalveil Fall', lat: 37.7165, lon: -119.6466, drop: 188, width: 12 },
  { name: 'Sentinel Fall', lat: 37.7330, lon: -119.5876, drop: 300, width: 10 },
  { name: 'Nevada Fall', lat: 37.7259, lon: -119.5336, drop: 181, width: 22 },
  { name: 'Vernal Fall', lat: 37.7271, lon: -119.5429, drop: 97, width: 24 }
]

const waterFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv; uniform float uTime;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
  float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
  void main(){
    vec2 uv = vUv;
    float flow = uv.y*7.0 + uTime*3.2;          // downward scroll
    float streak = vn(vec2(uv.x*14.0, flow)) * 0.6 + vn(vec2(uv.x*30.0, flow*1.7))*0.4;
    float foamTop = smoothstep(0.0, 0.12, 1.0-uv.y);
    float foamBot = smoothstep(0.0, 0.16, uv.y);
    float edge = smoothstep(0.0,0.12,uv.x)*smoothstep(1.0,0.88,uv.x);
    float bright = mix(0.6, 1.0, streak) + foamTop*0.5 + foamBot*0.6;
    vec3 col = mix(vec3(0.72,0.84,0.95), vec3(1.0), bright*0.6);
    float a = edge * (0.55 + streak*0.4 + foamBot*0.3);
    gl_FragColor = vec4(col, a);
  }
`

export class Waterfalls {
  constructor (scene, hf, geo) {
    this.group = new THREE.Group()
    this.group.name = 'waterfalls'
    this.hf = hf; this.geo = geo
    this.mats = []
    this.mistSystems = []
    this.places = []
    const mistTex = makeGlow('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)')

    for (const f of FALLS) {
      const { x, z } = geo.lonLatToWorld(f.lon, f.lat)
      const yTop = hf.height(x, z)
      const n = hf.normal(x, z, {})
      let down = new THREE.Vector3(n.x, 0, n.z)
      if (down.lengthSq() < 1e-4) down.set(0, 0, 1)
      down.normalize()
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), down).normalize()
      const basis = new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 1, 0), down)
      const quat = new THREE.Quaternion().setFromRotationMatrix(basis)

      const geom = new THREE.PlaneGeometry(f.width, f.drop, 1, 1)
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: waterFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false
      })
      this.mats.push(mat)
      const sheet = new THREE.Mesh(geom, mat)
      sheet.quaternion.copy(quat)
      sheet.position.set(x, yTop - f.drop / 2, z).addScaledVector(down, 4)
      this.group.add(sheet)

      // plunge pool
      const pool = new THREE.Mesh(new THREE.CircleGeometry(f.width * 0.9, 18),
        new THREE.MeshBasicMaterial({ color: 0x2a5a6a, transparent: true, opacity: 0.5 }))
      pool.rotation.x = -Math.PI / 2
      const baseX = x + down.x * (f.drop * 0.18 + 6)
      const baseZ = z + down.z * (f.drop * 0.18 + 6)
      pool.position.set(baseX, hf.height(baseX, baseZ) + 1, baseZ)
      this.group.add(pool)

      // mist at the base
      const mist = makeMist(mistTex, f.width)
      mist.group.position.set(baseX, hf.height(baseX, baseZ) + 8, baseZ)
      this.group.add(mist.group)
      this.mistSystems.push(mist)

      this.places.push({ name: f.name, x, z, yTop })
    }
    scene.add(this.group)
  }

  update (dt, t) {
    for (const m of this.mats) m.uniforms.uTime.value = t
    for (const m of this.mistSystems) m.update(dt, t)
  }
}

function makeMist (tex, width) {
  const N = 26
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  const life = new Float32Array(N)
  for (let i = 0; i < N; i++) { life[i] = Math.random(); reseed(pos, i, width) }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ map: tex, size: width * 1.4, transparent: true, opacity: 0.32, depthWrite: false, color: 0xffffff })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  const group = new THREE.Group(); group.add(points)
  return {
    group,
    update (dt) {
      for (let i = 0; i < N; i++) {
        life[i] -= dt * 0.4
        if (life[i] <= 0) { life[i] = 1; reseed(pos, i, width) }
        pos[i * 3 + 1] += dt * 6
        pos[i * 3] += dt * 1.2
      }
      geo.attributes.position.needsUpdate = true
    }
  }
}
function reseed (pos, i, width) {
  pos[i * 3] = (Math.random() - 0.5) * width
  pos[i * 3 + 1] = (Math.random() - 0.5) * 14
  pos[i * 3 + 2] = (Math.random() - 0.5) * width
}
