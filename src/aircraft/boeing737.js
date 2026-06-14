// A to-scale Boeing 737 MAX 9 built from primitives.
//   Length 42.16 m · Wingspan 35.9 m · Tail height 12.3 m · Fuselage Ø3.76 m
// Body frame: nose toward -Z, right wing +X, up +Y.
// Exposes animated landing gear, flaps, ailerons/elevator/rudder and lights,
// plus a per-part damage system (this.parts / setPartDamage).

import * as THREE from 'three'

const WHITE = 0xf4f6f8
const GREY = 0x9aa3ad
const DARKMETAL = 0x3a4048
const NAVY = 0x1d3a6b
const BLUE = 0x2b5fa6
const SCORCH = new THREE.Color(0x141414)

export class Boeing737 {
  constructor () {
    this.group = new THREE.Group()
    this.group.name = 'b737'
    this.surfaces = {}
    this.engines = []
    this.lights = {}
    this.parts = {}
    this._gear = 1
    this._flaps = 0
    this._spin = 0
    // damage bookkeeping: name -> { level, mats:[{mat,base}], droop:Group }
    this._damage = {}
    this._build()
  }

  _build () {
    const body = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 70, specular: 0x555a60, vertexColors: true })
    const metal = new THREE.MeshPhongMaterial({ color: GREY, shininess: 90, specular: 0x777777 })
    const dark = new THREE.MeshPhongMaterial({ color: DARKMETAL, shininess: 40 })
    const navy = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 80, specular: 0x335599 })
    this.materials = { body, metal, dark, navy }

    // ---- fuselage (body of revolution along Z) ----
    const profile = [
      [-21.08, 0.05, 0.55], [-20.4, 0.5, 0.52], [-19.8, 0.92, 0.46], [-19.2, 1.22, 0.40],
      [-18.3, 1.55, 0.30], [-17.2, 1.76, 0.18], [-15.8, 1.86, 0.08], [-14.0, 1.88, 0.02],
      [-9, 1.88, 0], [0, 1.88, 0], [7, 1.88, 0.05],
      [10.5, 1.8, 0.2], [13.5, 1.55, 0.5], [16.5, 1.12, 0.95], [19, 0.66, 1.35],
      [20.4, 0.36, 1.55], [21.08, 0.16, 1.66]
    ]
    const fuse = bodyOfRevolution(profile, 30)
    const fuseMesh = new THREE.Mesh(fuse, body)
    this.group.add(fuseMesh)

    // wing-to-body belly fairing (smooth pod where the wing root meets the belly)
    const fairing = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 18, 12),
      new THREE.MeshPhongMaterial({ color: WHITE, shininess: 55, specular: 0x556 }))
    fairing.scale.set(2.55, 1.35, 7.2)
    fairing.position.set(0, -1.45, 2.4)
    this.group.add(fairing)

    // ---- nose / radome + cockpit ----
    const noseGrp = this._buildNose()
    this.group.add(noseGrp)

    // ---- wings ----
    const wingR = buildWing(1)
    const wingL = buildWing(-1)
    this.group.add(wingR.group, wingL.group)
    this.surfaces.aileronR = wingR.aileron
    this.surfaces.aileronL = wingL.aileron
    this.surfaces.flapR = wingR.flap
    this.surfaces.flapL = wingL.flap

    // ---- engines under the wings (sit forward & slightly high like the MAX) ----
    const engGroups = {}
    for (const side of [1, -1]) {
      const eng = buildEngine(side)
      eng.group.position.set(side * 5.5, -1.35, -4.2)
      this.group.add(eng.group)
      this.engines.push(eng)
      engGroups[side] = eng
    }

    // ---- horizontal stabilizer ----
    for (const side of [1, -1]) {
      const stab = buildStab(side)
      stab.group.position.set(0, 1.4, 18.2)
      this.group.add(stab.group)
      if (side === 1) this.surfaces.elevatorR = stab.elevator
      else this.surfaces.elevatorL = stab.elevator
    }

    // ---- vertical fin + rudder ----
    const fin = buildFin()
    fin.group.position.set(0, 1.6, 16.4)
    this.group.add(fin.group)
    this.surfaces.rudder = fin.rudder

    // ---- dorsal fairings, antennas, APU ----
    this._buildDetails()

    // ---- landing gear ----
    this.gear = {
      nose: makeGear(2, 0.55, false),
      mainL: makeGear(4, 0.75, true),
      mainR: makeGear(4, 0.75, true)
    }
    this.gear.nose.group.position.set(0, -1.7, -13.5)
    this.gear.mainL.group.position.set(-2.4, -1.8, 2.5)
    this.gear.mainR.group.position.set(2.4, -1.8, 2.5)
    this.group.add(this.gear.nose.group, this.gear.mainL.group, this.gear.mainR.group)

    // ---- lights ----
    this._buildLights()

    // ---- damage parts (locators + collected materials) ----
    this._setupParts({
      noseGrp, wingR, wingL, engR: engGroups[1], engL: engGroups[-1], fin
    })

    this.setGear(1)
    this.setFlaps(0)
  }

  _buildNose () {
    const g = new THREE.Group()
    g.name = 'nose'
    // dielectric radome cap (very slightly off-white / matte)
    const radome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      new THREE.MeshPhongMaterial({ color: 0xe6e8ea, shininess: 30, specular: 0x333 }))
    radome.scale.set(0.55, 0.6, 1.5)
    radome.rotation.x = -Math.PI / 2
    radome.position.set(0, 0.05, -21.1)
    g.add(radome)

    // wrap-around cockpit windscreen: several angled dark-glass panels.
    const glass = new THREE.MeshPhongMaterial({ color: 0x0c1a26, shininess: 130, specular: 0xaaccee })
    // two big forward windscreen panes (V-shaped) + two side quarter windows each side
    const panes = [
      // [w,h, x,y,z, ry, rx]
      [0.95, 0.62, 0.52, 0.62, -18.05, 0.42, -0.30],
      [0.95, 0.62, -0.52, 0.62, -18.05, -0.42, -0.30],
      [0.62, 0.5, 1.06, 0.5, -17.35, 0.95, -0.18],
      [0.62, 0.5, -1.06, 0.5, -17.35, -0.95, -0.18],
      [0.5, 0.42, 1.32, 0.42, -16.5, 1.25, -0.1],
      [0.5, 0.42, -1.32, 0.42, -16.5, -1.25, -0.1]
    ]
    for (const [w, h, x, y, z, ry, rx] of panes) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass)
      p.position.set(x, y, z)
      p.rotation.set(rx, ry, 0)
      g.add(p)
    }
    // dark eyebrow / frame strip just above the windscreen for definition
    const brow = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.07, 8, 18, Math.PI),
      new THREE.MeshPhongMaterial({ color: 0x23272d, shininess: 50 }))
    brow.scale.set(1.0, 0.7, 1.0)
    brow.position.set(0, 0.95, -17.7)
    brow.rotation.x = -0.35
    g.add(brow)
    return g
  }

  _buildDetails () {
    // dorsal fin fillet: a low triangular fairing blending the fin into the spine.
    // Triangle in the Z-Y plane (long, low wedge), extruded thin along X.
    const filletMat = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 70, specular: 0x335599 })
    const fillet = new THREE.Mesh(
      wedgeZY(0.34, [[8.0, 1.7], [16.7, 1.7], [16.7, 3.9]]), filletMat)
    this.group.add(fillet)

    // APU exhaust at the tail cone
    const apu = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, 0.5, 14),
      new THREE.MeshPhongMaterial({ color: 0x23262b, shininess: 30 }))
    apu.rotation.x = Math.PI / 2
    apu.position.set(0, 0.18, 21.2)
    this.group.add(apu)

    // dorsal blade antennas / aerials on top of the fuselage
    const antMat = new THREE.MeshPhongMaterial({ color: 0xdfe3e8, shininess: 40 })
    for (const z of [-7.5, -2.0, 5.5]) {
      const blade = new THREE.Mesh(bladeAntenna(), antMat)
      blade.position.set(0, 1.95, z)
      this.group.add(blade)
    }
    // a couple of belly antennas
    const bantMat = new THREE.MeshPhongMaterial({ color: 0x2a2f36, shininess: 30 })
    for (const z of [-9, 8]) {
      const b = new THREE.Mesh(bladeAntenna(), bantMat)
      b.position.set(0, -1.92, z); b.rotation.z = Math.PI
      this.group.add(b)
    }
  }

  _buildLights () {
    const mk = (color, x, y, z, size = 0.34) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8),
        new THREE.MeshBasicMaterial({ color }))
      m.position.set(x, y, z)
      this.group.add(m)
      return m
    }
    this.lights.navR = mk(0x22ff44, 17.6, 0.9, 3.2)   // green = right
    this.lights.navL = mk(0xff2222, -17.6, 0.9, 3.2)  // red = left
    this.lights.tail = mk(0xffffff, 0, 8.6, 19.4, 0.3)
    this.lights.beaconTop = mk(0xff3322, 0, 2.0, -1)
    this.lights.beaconBot = mk(0xff3322, 0, -2.0, -1)
    this.lights.strobeR = mk(0xffffff, 17.9, 0.9, 3.4, 0.26)
    this.lights.strobeL = mk(0xffffff, -17.9, 0.9, 3.4, 0.26)
    // forward landing light (also a real spotlight when gear down)
    this.landingLight = new THREE.SpotLight(0xfff6e0, 0, 1400, Math.PI * 0.16, 0.5, 1.2)
    this.landingLight.position.set(0, -1.4, -14)
    this.landingTarget = new THREE.Object3D()
    this.landingTarget.position.set(0, -8, -120)
    this.group.add(this.landingLight, this.landingTarget)
    this.landingLight.target = this.landingTarget
  }

  // ---- damage parts ----------------------------------------------------------
  // Build locators at each part centre and collect the paint-able materials so
  // setPartDamage() can scorch them. Locators live in the scene graph so the
  // damage system can read getWorldPosition().
  _setupParts ({ noseGrp, wingR, wingL, engR, engL, fin }) {
    const locator = (x, y, z) => {
      const o = new THREE.Object3D()
      o.position.set(x, y, z)
      this.group.add(o)
      return o
    }
    this.parts.nose = locator(0, 0.2, -18.5)
    this.parts.wingR = locator(9, 0.2, 2.0)
    this.parts.wingL = locator(-9, 0.2, 2.0)
    this.parts.engineR = locator(5.5, -1.35, -4.2)
    this.parts.engineL = locator(-5.5, -1.35, -4.2)
    this.parts.tail = locator(0, 7.0, 18.0)

    // collect materials (with their pristine colours) for each part
    const collect = (root) => {
      const out = []
      root.traverse(o => {
        if (o.isMesh && o.material && o.material.color &&
            !(o.material instanceof THREE.MeshBasicMaterial)) {
          // clone shared materials so scorching one part doesn't bleed to others
          if (o.material.userData.__cloned !== true) {
            o.material = o.material.clone()
            o.material.userData.__cloned = true
          }
          out.push({ mat: o.material, base: o.material.color.clone() })
        }
      })
      return out
    }

    this._damage = {
      nose: { level: 0, mats: collect(noseGrp).concat(collect(this.parts.nose)) },
      wingR: { level: 0, mats: collect(wingR.group), droop: wingR.aileron, droopBase: 0 },
      wingL: { level: 0, mats: collect(wingL.group), droop: wingL.aileron, droopBase: 0 },
      engineR: { level: 0, mats: collect(engR.group) },
      engineL: { level: 0, mats: collect(engL.group) },
      tail: { level: 0, mats: collect(fin.group), droop: fin.rudder }
    }
    // Fuselage skin shares the nose visual region; scorch a copy of body for nose.
    // (Nose locator has no meshes of its own — it borrows the fuselage look via
    //  a dedicated dark decal handled in setPartDamage through noseGrp materials.)
  }

  // part: nose|wingL|wingR|engineL|engineR|tail ; level 0..1
  setPartDamage (part, level) {
    const d = this._damage[part]
    if (!d) return
    const L = THREE.MathUtils.clamp(level || 0, 0, 1)
    d.level = L
    for (const { mat, base } of d.mats) {
      mat.color.copy(base).lerp(SCORCH, L * 0.92)
      if (mat.shininess !== undefined) mat.shininess = THREE.MathUtils.lerp(base.__shin || mat.shininess, 8, L)
    }
    // droop a damaged control surface slightly (looks like flak damage)
    if (d.droop) {
      const droop = -L * 0.5
      // only override when damaged; let setControls/setFlaps win when undamaged
      d.droop.userData.__damageDroop = L > 0.01 ? droop : 0
      if (L > 0.01) d.droop.rotation.x = droop
      else if (d.droop.userData.__damageDroop === 0) { /* leave for control logic */ }
    }
  }

  reset () {
    for (const name of Object.keys(this._damage)) this.setPartDamage(name, 0)
  }

  // gear: 1 = down/locked, 0 = up/stowed
  setGear (t) {
    this._gear = t
    const tt = THREE.MathUtils.clamp(t, 0, 1)
    // nose retracts forward, mains rotate up into wells
    this.gear.nose.pivot.rotation.x = (1 - tt) * 1.55
    this.gear.mainL.pivot.rotation.z = (1 - tt) * -1.5
    this.gear.mainR.pivot.rotation.z = (1 - tt) * 1.5
    const vis = tt > 0.02
    for (const g of [this.gear.nose, this.gear.mainL, this.gear.mainR]) g.group.visible = vis
    // gear doors open with the gear, close when stowed
    const doorAng = tt * 1.45
    if (this.gear.nose.door) this.gear.nose.door.rotation.x = doorAng
    if (this.gear.mainL.door) this.gear.mainL.door.rotation.z = -doorAng
    if (this.gear.mainR.door) this.gear.mainR.door.rotation.z = doorAng
  }

  setFlaps (t) {
    this._flaps = t
    const ang = t * 0.7 // up to ~40°
    if (this.surfaces.flapL) this.surfaces.flapL.rotation.x = ang
    if (this.surfaces.flapR) this.surfaces.flapR.rotation.x = ang
  }

  // control deflections in -1..1
  setControls (pitch, roll, yaw) {
    const ail = (g, v) => { if (g) g.rotation.x = (g.userData.__damageDroop || 0) + v }
    if (this.surfaces.elevatorL) this.surfaces.elevatorL.rotation.x = pitch * 0.4
    if (this.surfaces.elevatorR) this.surfaces.elevatorR.rotation.x = pitch * 0.4
    ail(this.surfaces.aileronL, roll * 0.4)
    ail(this.surfaces.aileronR, -roll * 0.4)
    if (this.surfaces.rudder) {
      this.surfaces.rudder.rotation.y = -yaw * 0.4
      if (this.surfaces.rudder.userData.__damageDroop) this.surfaces.rudder.rotation.x = this.surfaces.rudder.userData.__damageDroop
    }
  }

  setThrottle (t) { this._throttle = t }

  update (dt, t, opts = {}) {
    // spin the fans with throttle
    this._spin += dt * (6 + (this._throttle || 0) * 60)
    for (const e of this.engines) e.fan.rotation.z = this._spin
    // blink beacons + strobes
    const beacon = (Math.sin(t * 6) > 0.0) ? 1 : 0.05
    this.lights.beaconTop.material.color.setRGB(beacon, beacon * 0.15, beacon * 0.1)
    this.lights.beaconBot.material.color.copy(this.lights.beaconTop.material.color)
    const strobe = ((t * 1.2) % 1) < 0.06 ? 1 : 0.0
    this.lights.strobeR.material.color.setScalar(strobe)
    this.lights.strobeL.material.color.setScalar(strobe)
    // landing light on when gear down & engines/electrics live
    const on = this._gear > 0.5 && !opts.dead
    this.landingLight.intensity = on ? 1200 : 0
  }
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function bodyOfRevolution (profile, seg) {
  const rings = profile.length
  const pos = []
  const col = []
  const nor = []
  const white = new THREE.Color(WHITE)
  const winGlass = new THREE.Color(0x16212f)
  const winSurround = new THREE.Color(0xc7ccd2)
  const cheat = new THREE.Color(BLUE)
  const cheat2 = new THREE.Color(NAVY)
  const belly = new THREE.Color(0xdfe3e8)
  for (let i = 0; i < rings; i++) {
    const [z, r, yc] = profile[i]
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const x = Math.sin(a) * r
      const y = Math.cos(a) * r + yc
      pos.push(x, y, z)
      nor.push(Math.sin(a), Math.cos(a), 0)
      // ---- livery via vertex colours, banded by cabin-side height ----
      let c = white
      const side = Math.abs(Math.sin(a))
      const upper = Math.cos(a)
      const cabin = (z > -16.5 && z < 13)
      if (cabin && side > 0.45) {
        // window stripe: a crisp passenger-window band on the upper-mid side
        if (upper > 0.18 && upper < 0.62) {
          // alternate glass / surround around the ring to read as windows
          const win = (Math.floor((z + 16.5) / 1.02) % 2) === 0
          c = (upper > 0.26 && upper < 0.54 && side > 0.6 && win) ? winGlass : winSurround
        } else if (upper > 0.62 && upper < 0.86) {
          // navy/blue cheatline just above the window stripe
          c = (upper > 0.74) ? cheat2 : cheat
        }
      }
      if (upper < -0.55) c = belly
      col.push(c.r, c.g, c.b)
    }
  }
  const idx = []
  const stride = seg + 1
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * stride + j, b = a + 1, d = a + stride, e = d + 1
      idx.push(a, d, b, b, d, e)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

function buildWing (side) {
  const group = new THREE.Group()
  const mat = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 60, specular: 0x556 })
  const greyMat = new THREE.MeshPhongMaterial({ color: 0x8d949c, shininess: 70, specular: 0x888 })
  // planform in X-Z plane (x outboard, z chordwise), extruded in Y (thickness)
  const shape = new THREE.Shape()
  shape.moveTo(1.88, -2.6)
  shape.lineTo(1.88, 2.4)
  shape.lineTo(16.2, 3.5)
  shape.lineTo(16.6, 2.2)
  shape.lineTo(4, -2.4)
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.42, bevelEnabled: false })
  geo.translate(0, 0, -0.21)
  geo.rotateX(-Math.PI / 2) // bring extrude (Z) to Y thickness
  const wing = new THREE.Mesh(geo, mat)
  wing.scale.x = side
  group.add(wing)

  // leading-edge slat strip (thin grey wedge along the front of the wing)
  const slat = new THREE.Mesh(new THREE.BoxGeometry(14.3, 0.2, 0.55), greyMat)
  slat.position.set(side * 9, 0.06, -2.55)
  slat.rotation.y = side * -0.05
  group.add(slat)

  // dihedral + slight incidence
  group.rotation.z = side * 0.085
  group.rotation.x = -0.02

  // ---- split-tip "Advanced Technology" scimitar winglet ----
  group.add(buildWinglet(side, mat))

  // ---- flap-track fairings: teardrop pods under the trailing edge ----
  const fairMat = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 55, specular: 0x556 })
  for (const fx of [3.2, 6.0, 8.8, 11.6]) {
    const pod = new THREE.Mesh(teardrop(), fairMat)
    pod.position.set(side * fx, -0.42, 2.6)
    pod.scale.set(0.42, 0.45, 1.9)
    group.add(pod)
  }

  // trailing-edge flap (hinged) — inboard
  const flap = new THREE.Group()
  flap.position.set(side * 6, -0.1, 3.3)
  const flapPanel = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.16, 1.5), mat)
  flapPanel.position.set(0, 0, 0.75)
  flap.add(flapPanel)
  group.add(flap)

  // aileron (hinged) — outboard
  const aileron = new THREE.Group()
  aileron.position.set(side * 13, 0.18, 3.0)
  const ailPanel = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.14, 1.1), mat)
  ailPanel.position.set(0, 0, 0.55)
  aileron.add(ailPanel)
  group.add(aileron)

  return { group, flap, aileron }
}

function buildWinglet (side, mat) {
  const g = new THREE.Group()
  g.position.set(side * 16.4, 0.4, 2.85)
  // upper scimitar: swept, canted blade tapering to a tip
  const upShape = new THREE.Shape()
  upShape.moveTo(0, 0); upShape.lineTo(1.6, 0); upShape.lineTo(1.15, 2.55); upShape.lineTo(0.55, 2.7); upShape.closePath()
  const upGeo = new THREE.ExtrudeGeometry(upShape, { depth: 0.12, bevelEnabled: false })
  upGeo.translate(0, 0, -0.06)
  upGeo.rotateY(Math.PI / 2) // thickness along X
  const up = new THREE.Mesh(upGeo, mat)
  up.rotation.z = side * -0.28
  up.scale.x = side
  // navy tip cap accent
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.7),
    new THREE.MeshPhongMaterial({ color: NAVY, shininess: 70 }))
  tip.position.set(side * 0.62, 2.55, 0.85)
  // lower scimitar: short downward blade
  const loShape = new THREE.Shape()
  loShape.moveTo(0, 0); loShape.lineTo(1.5, 0); loShape.lineTo(1.05, -1.25); loShape.lineTo(0.6, -1.3); loShape.closePath()
  const loGeo = new THREE.ExtrudeGeometry(loShape, { depth: 0.12, bevelEnabled: false })
  loGeo.translate(0, 0, -0.06)
  loGeo.rotateY(Math.PI / 2)
  const lo = new THREE.Mesh(loGeo, mat)
  lo.rotation.z = side * 0.30
  lo.scale.x = side
  g.add(up, lo, tip)
  return g
}

function buildEngine (side) {
  const group = new THREE.Group()
  const cowlMat = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 80, specular: 0x666 })
  // main cowl — fuller at the intake, tapering aft
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 0.92, 3.6, 26), cowlMat)
  cowl.rotation.x = Math.PI / 2
  cowl.position.z = 0.1
  // intake lip (polished metal ring)
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.14, 14, 26),
    new THREE.MeshPhongMaterial({ color: GREY, shininess: 120, specular: 0xbbbbbb }))
  lip.position.z = -1.85
  // dark intake interior
  const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.84, 0.5, 26),
    new THREE.MeshPhongMaterial({ color: 0x0a0c10, shininess: 10 }))
  intake.rotation.x = Math.PI / 2; intake.position.z = -1.55
  // ---- fan ----
  const fan = new THREE.Group()
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 14),
    new THREE.MeshPhongMaterial({ color: 0xd9dce0, shininess: 120, specular: 0xffffff }))
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -1.78
  fan.add(spinner)
  const bladeMat = new THREE.MeshPhongMaterial({ color: 0x2a2e34, shininess: 120, specular: 0xbbbbbb, side: THREE.DoubleSide })
  for (let i = 0; i < 22; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.82), bladeMat)
    const a = (i / 22) * Math.PI * 2
    b.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5, -1.55)
    b.rotation.z = a + 0.5
    b.rotation.y = 0.55
    fan.add(b)
  }
  // ---- exhaust nozzle with chevron / scalloped trailing edge (MAX signature) ----
  const exhMat = new THREE.MeshPhongMaterial({ color: 0x4a4f56, shininess: 60, specular: 0x777 })
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.72, 1.4, 24), exhMat)
  nozzle.rotation.x = Math.PI / 2; nozzle.position.z = 1.95
  // exhaust plug
  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 18),
    new THREE.MeshPhongMaterial({ color: 0x35393f, shininess: 50 }))
  plug.rotation.x = -Math.PI / 2; plug.position.z = 2.9
  // chevrons: a ring of small triangles on the nozzle trailing edge
  const chevMat = new THREE.MeshPhongMaterial({ color: 0x3f444b, shininess: 50, side: THREE.DoubleSide })
  const chevrons = new THREE.Group()
  const nChev = 12
  for (let i = 0; i < nChev; i++) {
    const a = (i / nChev) * Math.PI * 2
    const tri = new THREE.Mesh(chevTriangle(), chevMat)
    tri.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 2.65)
    tri.rotation.z = a - Math.PI / 2
    chevrons.add(tri)
  }
  // ---- pylon to wing ----
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.5, 2.8),
    new THREE.MeshPhongMaterial({ color: WHITE, shininess: 50, specular: 0x556 }))
  pylon.position.set(0, 1.15, 1.1)
  pylon.rotation.x = -0.05
  group.add(cowl, lip, intake, fan, nozzle, plug, chevrons, pylon)
  return { group, fan }
}

function buildStab (side) {
  const group = new THREE.Group()
  const mat = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 60, specular: 0x556 })
  const shape = new THREE.Shape()
  shape.moveTo(0, -1.7); shape.lineTo(0, 1.5); shape.lineTo(6.6, 2.1); shape.lineTo(6.9, 1.4); shape.lineTo(2.2, -1.6); shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.28, bevelEnabled: false })
  geo.translate(0, 0, -0.14); geo.rotateX(-Math.PI / 2)
  const stab = new THREE.Mesh(geo, mat); stab.scale.x = side
  group.add(stab)
  const elevator = new THREE.Group(); elevator.position.set(side * 3.2, 0.05, 1.8)
  const ep = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.12, 0.9), mat); ep.position.z = 0.45
  elevator.add(ep); group.add(elevator)
  return { group, elevator }
}

function buildFin () {
  const group = new THREE.Group()
  const mat = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 70, specular: 0x335599 })
  // fin profile in Z-Y plane, extruded thin in X
  const shape = new THREE.Shape()
  shape.moveTo(0, 0); shape.lineTo(-1.0, 6.8); shape.lineTo(1.7, 7.0); shape.lineTo(4.2, 0.2); shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: false })
  geo.translate(0, 0, -0.16)
  // shape is in X(=our Z) , Y ; extrude along Z(=our X). rotate so extrude->X
  geo.rotateY(Math.PI / 2)
  const fin = new THREE.Mesh(geo, mat)
  group.add(fin)
  // white cap stripe at the fin tip for contrast
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 2.6),
    new THREE.MeshPhongMaterial({ color: WHITE, shininess: 70 }))
  cap.position.set(0, 6.85, 0.45)
  group.add(cap)
  const rudder = new THREE.Group(); rudder.position.set(0, 3.4, 3.0)
  const rp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 6.2, 1.1), mat); rp.position.z = 0.55
  rudder.add(rp); group.add(rudder)
  return { group, rudder }
}

function makeGear (wheels, wheelR, withDoor) {
  const group = new THREE.Group()
  const pivot = new THREE.Group()
  group.add(pivot)
  const strutMat = new THREE.MeshPhongMaterial({ color: 0x8a9099, shininess: 90, specular: 0xaaaaaa })
  const tyreMat = new THREE.MeshPhongMaterial({ color: 0x14161a, shininess: 10 })
  const hubMat = new THREE.MeshPhongMaterial({ color: 0xb8bdc4, shininess: 90, specular: 0xdddddd })
  // main strut (oleo) with a fatter upper cylinder + thin lower piston
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.5, 12), strutMat)
  upper.position.y = -0.85
  pivot.add(upper)
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 1.3, 10), hubMat)
  piston.position.y = -2.0
  pivot.add(piston)
  // torque link (small diagonal bar)
  const link = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), strutMat)
  link.position.set(0.18, -1.7, 0); link.rotation.z = 0.4
  pivot.add(link)
  // bogie beam for the main gear (carries two axles)
  if (wheels > 2) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.4), strutMat)
    beam.position.y = -2.55
    pivot.add(beam)
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, wheels > 2 ? 1.2 : 0.7, 8), strutMat)
  axle.rotation.z = Math.PI / 2; axle.position.y = -2.55
  pivot.add(axle)
  const n = wheels > 2 ? 2 : 1
  for (let r = 0; r < n; r++) {
    for (const sx of (wheels > 2 ? [-0.45, 0.45] : [0])) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.34, 16), tyreMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(sx, -2.55, n > 1 ? (r === 0 ? -0.55 : 0.55) : 0)
      pivot.add(wheel)
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, 0.36, 12), hubMat)
      hub.rotation.z = Math.PI / 2
      hub.position.copy(wheel.position)
      pivot.add(hub)
    }
  }
  // gear door (hinged flap attached to the bay edge, not the strut)
  let door = null
  if (withDoor) {
    door = new THREE.Group()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.6, 2.4),
      new THREE.MeshPhongMaterial({ color: WHITE, shininess: 55, specular: 0x556 }))
    panel.position.set(-0.85, 0, 0)
    door.add(panel)
    group.add(door)
  } else {
    // nose gear: small twin forward-hinged doors
    door = new THREE.Group()
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 1.6),
      new THREE.MeshPhongMaterial({ color: WHITE, shininess: 55, specular: 0x556 }))
    panel.position.set(0, 0, -1.0)
    door.add(panel)
    group.add(door)
  }
  return { group, pivot, door }
}

// ---- small geometry helpers -----------------------------------------------
// teardrop pod (rounded front, pointed tail), oriented with tail toward +Z
function teardrop () {
  const g = new THREE.SphereGeometry(1, 12, 10)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i)
    if (z > 0) p.setZ(i, z * 2.4) // stretch the back into a tail
  }
  p.needsUpdate = true
  g.computeVertexNormals()
  return g
}

// single chevron triangle (in local XY, pointing -Y toward axis-ish)
function chevTriangle () {
  const g = new THREE.BufferGeometry()
  const v = [0, 0.22, 0, -0.14, -0.18, 0, 0.14, -0.18, 0]
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3))
  g.setIndex([0, 1, 2])
  g.computeVertexNormals()
  return g
}

// thin swept blade antenna (sits on the spine, +Y up, chord runs fore-aft Z)
function bladeAntenna () {
  // shape: chord along X, height along Y; extrude thin -> then rotate chord to Z
  const shape = new THREE.Shape()
  shape.moveTo(-0.42, 0); shape.lineTo(0.42, 0); shape.lineTo(0.14, 0.46); shape.lineTo(-0.04, 0.5); shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false })
  geo.translate(0, 0, -0.03)
  geo.rotateY(Math.PI / 2) // chord (was X) now runs along Z; thin along X
  return geo
}

// Polygon in the body Z-Y plane (points are [z, y]), extruded thin along X and
// centred on X. Built directly so the axis mapping is unambiguous.
function wedgeZY (thick, pts) {
  const n = pts.length
  const pos = []
  const idx = []
  const hx = thick / 2
  // two faces (+X and -X)
  for (let s = 0; s < 2; s++) {
    const x = s === 0 ? hx : -hx
    for (const [z, y] of pts) pos.push(x, y, z)
  }
  // fan-triangulate each face
  for (let i = 1; i < n - 1; i++) idx.push(0, i, i + 1)              // +X face
  for (let i = 1; i < n - 1; i++) idx.push(n, n + i + 1, n + i)      // -X face (reversed)
  // side walls
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n
    idx.push(a, b, n + b, a, n + b, n + a)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
