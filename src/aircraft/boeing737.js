// A to-scale Boeing 737 MAX 9 built from primitives.
//   Length 42.16 m · Wingspan 35.9 m · Tail height 12.3 m · Fuselage Ø3.76 m
// Body frame: nose toward -Z, right wing +X, up +Y.
// Exposes animated landing gear, flaps, ailerons/elevator/rudder and lights.

import * as THREE from 'three'

const WHITE = 0xf4f6f8
const GREY = 0x9aa3ad
const DARKMETAL = 0x3a4048
const NAVY = 0x1d3a6b

export class Boeing737 {
  constructor () {
    this.group = new THREE.Group()
    this.group.name = 'b737'
    this.surfaces = {}
    this.engines = []
    this.lights = {}
    this._gear = 1
    this._flaps = 0
    this._spin = 0
    this._build()
  }

  _build () {
    const body = new THREE.MeshPhongMaterial({ color: WHITE, shininess: 70, specular: 0x555a60, vertexColors: true })
    const metal = new THREE.MeshPhongMaterial({ color: GREY, shininess: 90, specular: 0x777777 })
    const dark = new THREE.MeshPhongMaterial({ color: DARKMETAL, shininess: 40 })
    const navy = new THREE.MeshPhongMaterial({ color: NAVY, shininess: 80, specular: 0x335599 })
    this.materials = { body, metal, dark, navy }

    // ---- fuselage (body of revolution along Z) ----
    const R = 1.88
    const profile = [
      [-21.08, 0.05, 0.55], [-20.2, 0.55, 0.5], [-19.2, 1.05, 0.42], [-18.0, 1.5, 0.3],
      [-16.5, 1.78, 0.16], [-14.5, 1.88, 0.05], [-9, 1.88, 0], [0, 1.88, 0], [7, 1.88, 0.05],
      [10.5, 1.8, 0.2], [13.5, 1.55, 0.5], [16.5, 1.12, 0.95], [19, 0.66, 1.35], [21.08, 0.2, 1.62]
    ]
    const fuse = bodyOfRevolution(profile, 28)
    this.group.add(new THREE.Mesh(fuse, body))

    // cockpit windscreen
    const wind = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.42),
      new THREE.MeshPhongMaterial({ color: 0x10202e, shininess: 120, specular: 0xaaccee }))
    wind.scale.set(1.0, 0.7, 1.4); wind.position.set(0, 0.5, -17.6); wind.rotation.x = -0.3
    this.group.add(wind)

    // ---- wings ----
    const wingR = buildWing(1)
    const wingL = buildWing(-1)
    this.group.add(wingR.group, wingL.group)
    this.surfaces.aileronR = wingR.aileron
    this.surfaces.aileronL = wingL.aileron
    this.surfaces.flapR = wingR.flap
    this.surfaces.flapL = wingL.flap

    // ---- engines under the wings ----
    for (const side of [1, -1]) {
      const eng = buildEngine()
      eng.group.position.set(side * 5.5, -1.7, -3.2)
      this.group.add(eng.group)
      this.engines.push(eng)
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

    // ---- landing gear ----
    this.gear = {
      nose: makeGear(2, 0.55),
      mainL: makeGear(4, 0.75),
      mainR: makeGear(4, 0.75)
    }
    this.gear.nose.group.position.set(0, -1.7, -13.5)
    this.gear.mainL.group.position.set(-2.4, -1.8, 2.5)
    this.gear.mainR.group.position.set(2.4, -1.8, 2.5)
    this.group.add(this.gear.nose.group, this.gear.mainL.group, this.gear.mainR.group)

    // ---- lights ----
    this._buildLights()

    this.setGear(1)
    this.setFlaps(0)
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
  }

  setFlaps (t) {
    this._flaps = t
    const ang = t * 0.7 // up to ~40°
    if (this.surfaces.flapL) this.surfaces.flapL.rotation.x = ang
    if (this.surfaces.flapR) this.surfaces.flapR.rotation.x = ang
  }

  // control deflections in -1..1
  setControls (pitch, roll, yaw) {
    if (this.surfaces.elevatorL) this.surfaces.elevatorL.rotation.x = pitch * 0.4
    if (this.surfaces.elevatorR) this.surfaces.elevatorR.rotation.x = pitch * 0.4
    if (this.surfaces.aileronL) this.surfaces.aileronL.rotation.x = roll * 0.4
    if (this.surfaces.aileronR) this.surfaces.aileronR.rotation.x = -roll * 0.4
    if (this.surfaces.rudder) this.surfaces.rudder.rotation.y = -yaw * 0.4
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
  const win = new THREE.Color(0x1a2738)
  const belly = new THREE.Color(0xdfe3e8)
  for (let i = 0; i < rings; i++) {
    const [z, r, yc] = profile[i]
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2
      const x = Math.sin(a) * r
      const y = Math.cos(a) * r + yc
      pos.push(x, y, z)
      nor.push(Math.sin(a), Math.cos(a), 0)
      // livery: window band on the upper sides of the cabin
      let c = white
      const side = Math.abs(Math.sin(a))
      const upper = Math.cos(a)
      if (z > -15 && z < 11 && side > 0.6 && upper > 0.1 && upper < 0.75) c = win
      else if (upper < -0.55) c = belly
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

  // dihedral + slight incidence
  group.rotation.z = side * 0.085
  group.rotation.x = -0.02

  // split-tip winglet (737 MAX Advanced Technology)
  const upper = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 1.7), mat)
  upper.position.set(side * 16.6, 1.2, 3.0); upper.rotation.z = side * -0.25; upper.rotation.x = 0.12
  const lower = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 1.0), mat)
  lower.position.set(side * 16.5, -0.6, 3.1); lower.rotation.z = side * 0.3
  group.add(upper, lower)

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

function buildEngine () {
  const group = new THREE.Group()
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.85, 4.0, 22),
    new THREE.MeshPhongMaterial({ color: WHITE, shininess: 80, specular: 0x666 }))
  cowl.rotation.x = Math.PI / 2
  // intake lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.12, 12, 22),
    new THREE.MeshPhongMaterial({ color: GREY, shininess: 110, specular: 0xaaaaaa }))
  lip.position.z = -2.0
  // dark intake interior
  const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.4, 22),
    new THREE.MeshBasicMaterial({ color: 0x0a0c10 }))
  intake.rotation.x = Math.PI / 2; intake.position.z = -1.7
  // fan
  const fan = new THREE.Group()
  const hub = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 12), new THREE.MeshPhongMaterial({ color: 0x222222 }))
  hub.rotation.x = -Math.PI / 2; hub.position.z = -1.85
  fan.add(hub)
  const bladeMat = new THREE.MeshPhongMaterial({ color: 0x32363c, shininess: 120, specular: 0xbbbbbb, side: THREE.DoubleSide })
  for (let i = 0; i < 18; i++) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.78), bladeMat)
    const a = (i / 18) * Math.PI * 2
    b.position.set(Math.cos(a) * 0.46, Math.sin(a) * 0.46, -1.75)
    b.rotation.z = a + 0.5
    b.rotation.y = 0.5
    fan.add(b)
  }
  // exhaust cone
  const exh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 18), new THREE.MeshPhongMaterial({ color: 0x4a4f56, shininess: 60 }))
  exh.rotation.x = -Math.PI / 2; exh.position.z = 2.4
  // pylon to wing
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.7, 2.6), new THREE.MeshPhongMaterial({ color: WHITE, shininess: 50 }))
  pylon.position.set(0, 1.2, 0.4)
  group.add(cowl, lip, intake, fan, exh, pylon)
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
  const rudder = new THREE.Group(); rudder.position.set(0, 3.4, 3.0)
  const rp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 6.2, 1.1), mat); rp.position.z = 0.55
  rudder.add(rp); group.add(rudder)
  return { group, rudder }
}

function makeGear (wheels, wheelR) {
  const group = new THREE.Group()
  const pivot = new THREE.Group()
  group.add(pivot)
  const strutMat = new THREE.MeshPhongMaterial({ color: 0x8a9099, shininess: 90, specular: 0xaaaaaa })
  const tyreMat = new THREE.MeshPhongMaterial({ color: 0x14161a, shininess: 10 })
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.6, 10), strutMat)
  strut.position.y = -1.3
  pivot.add(strut)
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, wheels > 2 ? 1.2 : 0.7, 8), strutMat)
  axle.rotation.z = Math.PI / 2; axle.position.y = -2.55
  pivot.add(axle)
  const n = wheels > 2 ? 2 : 1
  for (let r = 0; r < n; r++) {
    for (const sx of (wheels > 2 ? [-0.45, 0.45] : [0])) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.34, 14), tyreMat)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(sx, -2.55, n > 1 ? (r === 0 ? -0.55 : 0.55) : 0)
      pivot.add(wheel)
    }
  }
  return { group, pivot }
}
