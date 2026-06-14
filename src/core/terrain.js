// Builds the terrain mesh from the real elevation grid and shades it with a
// procedural land-cover shader (granite cliffs, forest, meadow, water, snow)
// that responds to sun direction, ambient, fog and snow line.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const vert = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vDepth;
  void main () {
    vWorld = position;
    vNormalW = normalize(normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const frag = /* glsl */`
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vDepth;

  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uSnowLine;
  uniform float uSnowBlend;
  uniform float uWaterLevel;
  uniform float uMinH;
  uniform float uMaxH;

  // cheap value noise
  float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise (vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1.0,0.0));
    float c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm (vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main () {
    vec3 N = normalize(vNormalW);
    float slope = 1.0 - clamp(N.y, 0.0, 1.0);          // 0 flat .. 1 vertical
    float h = vWorld.y;
    float hn = clamp((h - uMinH) / max(1.0, (uMaxH - uMinH)), 0.0, 1.0);

    vec2 np = vWorld.xz;
    float bigN = fbm(np * 0.0016);
    float detN = fbm(np * 0.02);

    // --- palette ---
    vec3 meadow  = mix(vec3(0.34,0.40,0.20), vec3(0.45,0.52,0.28), detN);   // valley floor
    vec3 forest  = mix(vec3(0.13,0.24,0.12), vec3(0.18,0.33,0.16), detN);   // conifer slopes
    vec3 granite = mix(vec3(0.50,0.49,0.47), vec3(0.66,0.64,0.60), bigN);   // cliffs
    vec3 talus   = mix(vec3(0.40,0.37,0.33), vec3(0.55,0.51,0.46), detN);

    // vegetation: meadow low -> forest mid, fading out toward treeline
    float forestBand = smoothstep(0.04, 0.20, hn) * (1.0 - smoothstep(0.62, 0.86, hn));
    vec3 veg = mix(meadow, forest, smoothstep(0.06, 0.30, hn));
    veg = mix(meadow, veg, clamp(forestBand + 0.25, 0.0, 1.0));

    // rock takes over on steep ground (Yosemite's signature granite walls)
    float rockMix = smoothstep(0.24, 0.46, slope);
    rockMix = max(rockMix, smoothstep(0.86, 0.98, hn) * 0.6); // bare high summits
    rockMix += (detN - 0.5) * 0.12;
    rockMix = clamp(rockMix, 0.0, 1.0);
    vec3 rock = mix(talus, granite, smoothstep(0.34, 0.66, slope));
    vec3 base = mix(veg, rock, rockMix);

    // water on the very lowest flat ground (river / pools)
    float water = (1.0 - smoothstep(uWaterLevel - 4.0, uWaterLevel + 8.0, h)) * (1.0 - smoothstep(0.10, 0.22, slope));
    vec3 waterCol = mix(vec3(0.06,0.20,0.26), vec3(0.10,0.30,0.34), detN);
    base = mix(base, waterCol, clamp(water, 0.0, 1.0));

    // snow: high + flattish, with a soft, noisy snow line
    float snowLine = uSnowLine + (bigN - 0.5) * 220.0;
    float snow = smoothstep(snowLine, snowLine + uSnowBlend, h) * (1.0 - smoothstep(0.42, 0.72, slope));
    base = mix(base, vec3(0.93,0.95,0.99), clamp(snow, 0.0, 1.0));

    // --- lighting ---
    float diff = max(dot(N, normalize(uSunDir)), 0.0);
    // soft self-occlusion in steep gullies
    float ao = mix(0.78, 1.0, smoothstep(0.0, 0.5, N.y));
    vec3 hemi = mix(uGroundColor, uSkyColor, clamp(N.y * 0.5 + 0.5, 0.0, 1.0)) * uAmbient;
    vec3 lit = base * (hemi * ao + uSunColor * diff);

    // tiny specular sparkle on snow & water
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 Hh = normalize(normalize(uSunDir) + V);
    float spec = pow(max(dot(N, Hh), 0.0), 60.0) * (snow * 0.6 + water * 0.9);
    lit += uSunColor * spec;

    // fog
    float fog = 1.0 - exp(-pow(uFogDensity * vDepth, 2.0));
    vec3 color = mix(lit, uFogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
  }
`

export class Terrain {
  constructor (heightfield, geo) {
    this.hf = heightfield
    this.geo = geo
    this.mesh = this._build()
  }

  _build () {
    const { widthMeters, heightMeters } = this.geo
    const segX = CONFIG.terrainSeg
    const segZ = Math.max(40, Math.round(segX * (heightMeters / widthMeters)))
    const nx = segX + 1, nz = segZ + 1
    const positions = new Float32Array(nx * nz * 3)
    let k = 0
    for (let j = 0; j < nz; j++) {
      const z = (j / segZ - 0.5) * heightMeters
      for (let i = 0; i < nx; i++) {
        const x = (i / segX - 0.5) * widthMeters
        positions[k++] = x
        positions[k++] = this.hf.height(x, z)
        positions[k++] = z
      }
    }
    const indices = []
    for (let j = 0; j < segZ; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setIndex(indices)
    geom.computeVertexNormals()
    geom.computeBoundingSphere()

    const uniforms = {
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1, 0.96, 0.86) },
      uSkyColor: { value: new THREE.Color(0.55, 0.7, 0.95) },
      uGroundColor: { value: new THREE.Color(0.30, 0.27, 0.22) },
      uAmbient: { value: 0.55 },
      uFogColor: { value: new THREE.Color(0.7, 0.78, 0.88) },
      uFogDensity: { value: 0.000045 },
      uSnowLine: { value: 2550 },
      uSnowBlend: { value: 180 },
      uWaterLevel: { value: this.hf.min + 12 },
      uMinH: { value: this.hf.min },
      uMaxH: { value: this.hf.max }
    }
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = true
    mesh.name = 'terrain'
    this.uniforms = uniforms
    return mesh
  }
}
