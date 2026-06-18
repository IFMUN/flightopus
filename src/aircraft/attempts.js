// Manages the live aircraft plus a growing history of past attempts. When you
// crash or land, that airframe stays in the world (wreckage + fire if crashed,
// parked ghost if landed) along with its flight trail, and a fresh jet spawns
// so you can try again while seeing every previous run.

import * as THREE from 'three'
import { Boeing737 } from './boeing737.js'
import { FlightModel } from './flightmodel.js'
import { FireSmoke, Explosion, makeBlobShadow } from './effects.js'

const MAX_PAST = 5
const TRAIL_MAX = 900

export class Attempts {
  constructor (scene, hf) {
    this.scene = scene
    this.hf = hf
    this.past = []
    this.fires = []
    this.explosions = []
    this.count = 0
    this.spawnState = null

    this.plane = new Boeing737()
    scene.add(this.plane.group)
    this.fm = new FlightModel(hf)

    this.shadow = makeBlobShadow()
    scene.add(this.shadow)

    this._initTrail()
  }

  _initTrail () {
    this.trailPos = new Float32Array(TRAIL_MAX * 3)
    this.trailGeo = new THREE.BufferGeometry()
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3))
    this.trailGeo.setDrawRange(0, 0)
    this.trailMat = new THREE.LineBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.6 })
    this.trail = new THREE.Line(this.trailGeo, this.trailMat)
    this.trail.frustumCulled = false
    this.scene.add(this.trail)
    this.trailN = 0
    this.trailT = 0
  }

  spawn (state) {
    this.spawnState = state
    this.fm.reset(state)
    this.plane.group.position.copy(this.fm.pos)
    this.plane.group.quaternion.copy(this.fm.quat)
    this.trailN = 0
    this.trailGeo.setDrawRange(0, 0)
    this.crashedThisRun = false
    this.landedThisRun = false
  }

  // integrate physics + sync model; returns events
  update (dt, t, input, wind) {
    const ev = this.fm.integrate(dt, input, { wind })
    const p = this.plane
    p.group.position.copy(this.fm.pos)
    p.group.quaternion.copy(this.fm.quat)

    // landing-gear / flap / surface animation handled by caller via input
    if (ev.crash && !this.crashedThisRun) {
      this.crashedThisRun = true
      this._spawnFire(this.fm.pos, 1.4)
    }
    if (ev.touchdown && !this.landedThisRun) this.landedThisRun = true

    // blob shadow on the ground under the plane
    const gx = this.fm.pos.x, gz = this.fm.pos.z
    const gy = this.hf.height(gx, gz)
    this.shadow.position.set(gx, gy + 1.2, gz)
    const agl = Math.max(1, this.fm.pos.y - gy)
    const s = THREE.MathUtils.clamp(1.6 - agl / 600, 0.25, 1.6)
    this.shadow.scale.setScalar(s)
    this.shadow.material.opacity = 0.5 * s * (this.fm.dead ? 0 : 1)

    // trail sampling
    this.trailT += dt
    if (this.trailT > 0.08 && !this.fm.onGround && !this.fm.dead) {
      this.trailT = 0
      if (this.trailN < TRAIL_MAX) {
        this.trailPos[this.trailN * 3] = this.fm.pos.x
        this.trailPos[this.trailN * 3 + 1] = this.fm.pos.y
        this.trailPos[this.trailN * 3 + 2] = this.fm.pos.z
        this.trailN++
        this.trailGeo.attributes.position.needsUpdate = true
        this.trailGeo.setDrawRange(0, this.trailN)
      }
    }

    for (const f of this.fires) f.update(dt, t, wind)
    // one-shot crash explosions: update + dispose when finished
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      if (!this.explosions[i].update(dt)) { this.explosions[i].dispose(); this.explosions.splice(i, 1) }
    }
    return ev
  }

  _spawnFire (pos, scale) {
    const f = new FireSmoke(pos.clone(), scale)
    this.scene.add(f.group)
    this.fires.push(f)
    this._pendingFire = f
    // punchy one-shot blast on top of the persistent wreck fire
    this.explosions.push(new Explosion(this.scene, pos.clone(), { scale: scale * 1.1 }))
  }

  // Finalize current run and spawn a fresh aircraft at the original spawn.
  newAttempt () {
    const crashed = this.fm.crashed
    // freeze current airframe in place as a past attempt
    const ghost = this.plane
    ghost.update(0, 0, { dead: true })
    // dim/desaturate parked ghost; keep wreckage as-is
    if (!crashed) this._makeGhost(ghost)

    // freeze trail with a color by outcome
    this._freezeTrail(crashed ? 0xff5a44 : 0x66e08a)

    this.past.push({ plane: ghost, fire: this._pendingFire || null, trail: this._frozenTrail })
    this._pendingFire = null
    this._frozenTrail = null

    // cap history
    while (this.past.length > MAX_PAST) {
      const old = this.past.shift()
      this.scene.remove(old.plane.group)
      if (old.fire) { this.scene.remove(old.fire.group); old.fire.dispose() }
      if (old.trail) this.scene.remove(old.trail)
      // note: associated fire stays in this.fires array but we let it idle out
    }

    // new live plane + trail
    this.count++
    this.plane = new Boeing737()
    this.scene.add(this.plane.group)
    this._initTrailReplace()
    this.spawn(this.spawnState)
    return this.count
  }

  _initTrailReplace () {
    // keep the frozen trail in scene, start a new live trail line
    this.trailPos = new Float32Array(TRAIL_MAX * 3)
    this.trailGeo = new THREE.BufferGeometry()
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3))
    this.trailGeo.setDrawRange(0, 0)
    this.trail = new THREE.Line(this.trailGeo, this.trailMat.clone())
    this.trail.frustumCulled = false
    this.scene.add(this.trail)
    this.trailN = 0
  }

  _freezeTrail (color) {
    this.trail.material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
    this._frozenTrail = this.trail
  }

  _makeGhost (plane) {
    plane.group.traverse(o => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          m.transparent = true
          m.opacity = 0.55
        }
      }
    })
  }
}
