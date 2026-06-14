// 6-DOF-ish flight dynamics for the 737 MAX 9.
// Real-ish aerodynamics: lift/drag from angle-of-attack with stall, induced
// drag, thrust, gravity, sideslip weathervaning, control moments with
// damping, plus wind that enters through the *relative* airflow (so gusts,
// crosswinds and hurricanes genuinely push the jet around). Mild stability
// augmentation keeps it approachable.

import * as THREE from 'three'

const D2R = Math.PI / 180

const P = {
  m: 70000,            // mass (kg)
  S: 127,              // wing area (m^2)
  b: 35.9,             // span (m)
  c: 3.9,              // mean chord (m)
  Tmax: 250000,        // max thrust, both engines (N)
  Ipitch: 3.0e6, Iyaw: 4.5e6, Iroll: 1.3e6,
  // longitudinal
  CL0: 0.12, CLa: 5.4, aStall: 16 * D2R, dCLflap: 0.95,
  CD0: 0.021, kInd: 0.045, dCDflap: 0.030, gearCD: 0.018, spoilCD: 0.07,
  // moments — Cm0 sets the hands-off trim AoA (~5°) for level cruise
  Cm0: 0.077, Cma: -0.9, Cmde: 0.11, Cmq: -26,
  Clda: 0.085, Clp: -0.6,
  Cnb: 0.11, Cndr: -0.10, Cnr: -0.42, CYb: -0.95, CYdr: 0.12,
  gearH: 3.7,          // CG height above wheels, gear down (m)
  bellyH: 1.7          // clearance from CG to lowest structure
}

const tmpV = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()

export class FlightModel {
  constructor (hf) {
    this.hf = hf
    this.reset()
  }

  reset (state = {}) {
    this.pos = state.pos ? state.pos.clone() : new THREE.Vector3(0, 1850, 3000)
    this.quat = state.quat ? state.quat.clone() : new THREE.Quaternion()
    this.vel = state.vel ? state.vel.clone() : new THREE.Vector3(0, 0, -120) // moving north
    this.omega = new THREE.Vector3() // body rates (x=pitch,y=yaw,z=roll)
    this.onGround = false
    this.dead = false
    this.crashed = false
    this.landed = false
    this.gLoad = 1
    this.alpha = 0
    this.beta = 0
    this.Vair = this.vel.length()
    this.stall = false
    this._wasAir = true
    this.touchdownSink = 0
    this.damage = { nose: 0, wingL: 0, wingR: 0, engineL: 0, engineR: 0, tail: 0 }
    this._buffet = new THREE.Vector3()
  }

  applyDamage (part, amt) {
    if (this.damage[part] === undefined) return
    this.damage[part] = THREE.MathUtils.clamp(this.damage[part] + amt, 0, 1)
  }

  overallDamage () {
    const d = this.damage
    return THREE.MathUtils.clamp(
      (d.nose * 0.5 + d.wingL + d.wingR + d.engineL * 0.8 + d.engineR * 0.8 + d.tail * 1.2) / 4.5, 0, 1)
  }

  // body basis
  forward (o) { return o.set(0, 0, -1).applyQuaternion(this.quat) }
  up (o) { return o.set(0, 1, 0).applyQuaternion(this.quat) }
  right (o) { return o.set(1, 0, 0).applyQuaternion(this.quat) }

  integrate (dt, input, ctx) {
    if (this.dead) { this._integrateDead(dt); return {} }
    dt = Math.min(dt, 0.05)
    const ev = {}
    const wind = ctx.wind || tmpV.set(0, 0, 0)
    const alt = this.pos.y
    const rho = 1.225 * Math.exp(-Math.max(0, alt) / 8500)

    // --- relative airflow ---
    const airV = this.vel.clone().sub(wind)
    const Vair = Math.max(airV.length(), 0.001)
    this.Vair = Vair
    // airflow in body frame
    const vb = airV.clone().applyQuaternion(tmpQ.copy(this.quat).invert())
    const u = -vb.z // forward
    const v = vb.x  // right
    const w = -vb.y // down
    const uSafe = Math.max(Math.abs(u), 1.0) * Math.sign(u || 1)
    const alpha = Math.atan2(w, Math.abs(uSafe))
    const beta = Math.atan2(v, Math.abs(uSafe))
    this.alpha = alpha; this.beta = beta
    const qd = 0.5 * rho * Vair * Vair
    const Vh = Math.max(Vair, 12)

    // --- coefficients ---
    const flap = input.flaps || 0
    let CL = P.CL0 + P.CLa * alpha + flap * P.dCLflap
    // smooth stall: lose lift past stall angle
    const over = Math.abs(alpha) - (P.aStall - flap * 2 * D2R)
    this.stall = false
    if (over > 0) {
      const f = Math.exp(-over * 7)
      CL *= Math.max(0.35, f)
      if (Vair > 20) this.stall = true
    }
    const spoiler = input.spoiler || 0
    let CD = P.CD0 + P.kInd * CL * CL + flap * P.dCDflap + spoiler * P.spoilCD
    if (input.gearDown) CD += P.gearCD
    // battle damage degrades the airframe
    const d = this.damage
    const liftDmg = 1 - 0.45 * (d.wingL + d.wingR) * 0.5
    CD += (d.wingL + d.wingR) * 0.012 + d.nose * 0.01
    const Lift = qd * P.S * CL * liftDmg
    const Drag = qd * P.S * CD
    const Side = qd * P.S * (P.CYb * beta + P.CYdr * (input.yaw || 0))

    // --- force directions (world) ---
    const fwd = this.forward(new THREE.Vector3())
    const rgt = this.right(new THREE.Vector3())
    const airDir = airV.clone().multiplyScalar(1 / Vair)      // direction of travel through air
    const dragDir = airDir.clone().multiplyScalar(-1)
    let liftDir = new THREE.Vector3().crossVectors(rgt, airDir).normalize()
    if (liftDir.dot(this.up(tmpV)) < 0) liftDir.multiplyScalar(-1)

    const engPow = Math.max(0, 1 - 0.5 * d.engineL - 0.5 * d.engineR)
    const thrust = (input.throttle || 0) * P.Tmax * engPow
    const F = new THREE.Vector3(0, -9.81 * P.m, 0)
    F.addScaledVector(fwd, thrust)
    F.addScaledVector(dragDir, Drag)
    F.addScaledVector(liftDir, Lift)
    F.addScaledVector(rgt, Side)

    // --- linear integration ---
    const acc = F.multiplyScalar(1 / P.m)
    this.gLoad = Math.max(-2, Math.min(6, Lift / (P.m * 9.81))) // load factor
    this.vel.addScaledVector(acc, dt)

    // --- moments / rotation ---
    const adim = P.c / (2 * Vh)
    const bdim = P.b / (2 * Vh)
    // tail damage cuts pitch/yaw control and adds a relentless nose-down pull
    const tailEff = 1 - 0.8 * d.tail
    const pitchM = qd * P.S * P.c * (P.Cm0 + P.Cma * alpha + P.Cmde * (input.pitch || 0) * tailEff + P.Cmq * this.omega.x * adim - 0.07 * d.tail)
    const rollM = qd * P.S * P.b * (P.Clda * (input.roll || 0) + P.Clp * this.omega.z * bdim + (d.wingR - d.wingL) * 0.06)
    const yawM = qd * P.S * P.b * (P.Cnb * beta + P.Cndr * (input.yaw || 0) * tailEff + P.Cnr * this.omega.y * bdim + (d.engineR - d.engineL) * 0.05)
    this.omega.x += (pitchM / P.Ipitch) * dt
    this.omega.y += (yawM / P.Iyaw) * dt
    this.omega.z += (rollM / P.Iroll) * dt

    // --- mild stability augmentation (approachability) ---
    if (!this.onGround) {
      // roll leveling when hands-off ailerons
      const upv = this.up(new THREE.Vector3())
      const bank = Math.atan2(rgt.y, upv.y)
      if (Math.abs(input.roll || 0) < 0.05) this.omega.z += (-bank * 0.6 - this.omega.z * 0.8) * dt
      // gentle phugoid damping (opposes sustained climb/sink) when hands-off pitch
      if (Math.abs(input.pitch || 0) < 0.05) {
        this.omega.x += (-this.vel.y * 0.0010 - this.omega.x * 0.9) * dt
        // ground-proximity assist: ease the nose up when low & sinking hands-off
        const agl = this.pos.y - this.hf.height(this.pos.x, this.pos.z)
        if (agl < 260 && this.vel.y < -1) {
          this.omega.x += (0.32 - this.omega.x) * Math.min(1, dt * 1.4) * (1 - agl / 260)
        }
      }
      // structural buffeting scales with battle damage
      const od = this.overallDamage()
      if (od > 0.04) {
        this.omega.x += (Math.random() - 0.5) * od * 0.5 * dt
        this.omega.y += (Math.random() - 0.5) * od * 0.4 * dt
        this.omega.z += (Math.random() - 0.5) * od * 0.9 * dt
      }
    }

    // keep body rates sane
    this.omega.x = THREE.MathUtils.clamp(this.omega.x, -0.7, 0.7)
    this.omega.y = THREE.MathUtils.clamp(this.omega.y, -0.6, 0.6)
    this.omega.z = THREE.MathUtils.clamp(this.omega.z, -1.6, 1.6)

    this._applyRotation(dt)
    this.pos.addScaledVector(this.vel, dt)

    // --- ground / terrain ---
    this._ground(dt, input, ev)

    if (this.pos.y < -200) { this._die(false, ev) } // sanity

    return ev
  }

  _applyRotation (dt) {
    const w = this.omega
    const ang = w.length() * dt
    if (ang > 1e-7) {
      tmpV.copy(w).normalize()
      tmpQ.setFromAxisAngle(tmpV, ang)
      this.quat.multiply(tmpQ).normalize()
    }
  }

  _ground (dt, input, ev) {
    const tH = this.hf.height(this.pos.x, this.pos.z)
    const gearDown = input.gearDown
    const contactY = tH + (gearDown ? P.gearH : P.bellyH)
    const sink = -this.vel.y

    if (this.pos.y <= contactY) {
      // first contact this frame?
      const firstTouch = this._wasAir
      this._wasAir = false

      // hard impact / bad attitude / gear up => crash
      const upv = this.up(new THREE.Vector3())
      const fwd = this.forward(new THREE.Vector3())
      const bank = Math.abs(Math.atan2(this.right(tmpV).y, upv.y))
      const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1))
      const gs = Math.hypot(this.vel.x, this.vel.z)

      if (firstTouch) this.touchdownSink = sink

      const badGear = !gearDown
      const hardLanding = sink > 4.2
      const badAttitude = bank > 12 * D2R || pitch < -8 * D2R || pitch > 16 * D2R
      const slopeSteep = this.hf.slope(this.pos.x, this.pos.z) > 0.22

      if (badGear || (firstTouch && hardLanding) || badAttitude || slopeSteep) {
        this._die(true, ev)
        this.pos.y = contactY
        return
      }

      // good ground contact — roll
      this.pos.y = contactY
      if (this.vel.y < 0) this.vel.y = 0
      this.onGround = true

      // tires: kill lateral slip, apply rolling resistance + brakes
      const heading = new THREE.Vector3(fwd.x, 0, fwd.z).normalize()
      const fSpeed = this.vel.dot(heading)
      const lateral = this.vel.clone().sub(heading.clone().multiplyScalar(fSpeed))
      lateral.y = 0
      this.vel.sub(lateral.multiplyScalar(Math.min(1, dt * 6))) // grip
      let roll = 0.015 + (input.brake ? 0.9 : 0) + (input.spoiler || 0) * 0.05
      const nf = Math.max(0, fSpeed - roll * 9.81 * dt * (input.brake ? 60 : 8))
      this.vel.copy(heading).multiplyScalar(fSpeed > 0 ? nf : fSpeed * (1 - dt * 0.6))
      // keep a little vertical from lift so takeoff is smooth
      // self-level attitude on the ground
      this.omega.multiplyScalar(Math.max(0, 1 - dt * 4))
      this._levelToGround(dt, gearDown ? 1.0 : 0.4)

      if (firstTouch && !this.crashed) {
        this.landed = true
        ev.touchdown = { sink, gs }
      }
      if (gs < 1.0) ev.stopped = true
    } else {
      this._wasAir = true
      this.onGround = false
    }
  }

  // ease pitch & roll toward level with the local ground
  _levelToGround (dt, k) {
    const e = new THREE.Euler().setFromQuaternion(this.quat, 'YXZ')
    e.z *= Math.max(0, 1 - dt * 3 * k)            // roll -> 0
    e.x = THREE.MathUtils.lerp(e.x, 3 * D2R, Math.min(1, dt * 2 * k)) // slight nose-up sit
    this.quat.setFromEuler(e)
  }

  _die (crash, ev) {
    if (this.dead) return
    this.dead = true
    this.crashed = crash
    ev.crash = crash
    // tumble a bit
    this.omega.set((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3)
  }

  _integrateDead (dt) {
    dt = Math.min(dt, 0.05)
    const tH = this.hf.height(this.pos.x, this.pos.z)
    if (this.pos.y > tH + P.bellyH) {
      this.vel.y -= 9.81 * dt
      this.vel.multiplyScalar(1 - dt * 0.1)
      this.pos.addScaledVector(this.vel, dt)
      this._applyRotation(dt)
      this.omega.multiplyScalar(1 - dt * 0.5)
    } else {
      this.pos.y = tH + P.bellyH
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 3))
      this.omega.multiplyScalar(Math.max(0, 1 - dt * 3))
    }
  }

  telemetry () {
    const fwd = this.forward(new THREE.Vector3())
    const upv = this.up(new THREE.Vector3())
    const rgt = this.right(new THREE.Vector3())
    let hdg = Math.atan2(fwd.x, -fwd.z) / D2R
    if (hdg < 0) hdg += 360
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) / D2R
    const bank = Math.atan2(rgt.y, upv.y) / D2R
    const agl = this.pos.y - this.hf.height(this.pos.x, this.pos.z)
    return {
      kias: this.Vair * 1.94384,          // m/s -> knots
      mps: this.Vair,
      altMSL: this.pos.y * 3.28084,        // ft
      agl: agl * 3.28084,
      aglM: agl,
      vs: this.vel.y * 196.85,             // m/s -> ft/min
      hdg, pitch, bank,
      aoa: this.alpha / D2R,
      g: this.gLoad,
      stall: this.stall,
      onGround: this.onGround,
      dead: this.dead, crashed: this.crashed,
      damage: this.damage, overallDamage: this.overallDamage()
    }
  }
}

export const PLANE_PARAMS = P
