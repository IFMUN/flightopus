// Camera rig with several views that cycle with the C key.

import * as THREE from 'three'

const MODES = ['Chase', 'Cockpit', 'Wing', 'Cinematic']

export class CameraRig {
  constructor (camera) {
    this.camera = camera
    this.mode = 0
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3()
    this._look = new THREE.Vector3(); this._d = new THREE.Vector3()
  }

  cycle () { this.mode = (this.mode + 1) % MODES.length; return MODES[this.mode] }
  get name () { return MODES[this.mode] }

  snapDead (fm) {
    this.camera.position.copy(fm.pos).add(this._d.set(34, 15, 46))
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(fm.pos)
  }

  snapBehind (fm) {
    const fwd = fm.forward(this._a); const up = fm.up(this._b)
    this.camera.position.copy(fm.pos).addScaledVector(fwd, -55).addScaledVector(up, 13)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(fm.pos)
  }

  update (dt, fm) {
    const cam = this.camera
    const fwd = fm.forward(this._a); const up = fm.up(this._b); const rgt = fm.right(this._c)
    cam.up.set(0, 1, 0)
    let desired = this._look
    const k = 1 - Math.exp(-dt * 4)
    if (this.mode === 0) { // chase
      desired.copy(fm.pos).addScaledVector(fwd, -55).addScaledVector(up, 13)
      cam.position.lerp(desired, k)
      cam.lookAt(fm.pos.clone().addScaledVector(fwd, 35))
    } else if (this.mode === 1) { // cockpit / forward nose view (rolls with the jet)
      desired.copy(fm.pos).addScaledVector(fwd, 24).addScaledVector(up, 0.6)
      cam.position.lerp(desired, 1 - Math.exp(-dt * 22))
      cam.up.copy(up)
      cam.lookAt(fm.pos.clone().addScaledVector(fwd, 240).addScaledVector(up, -8))
    } else if (this.mode === 2) { // wing
      desired.copy(fm.pos).addScaledVector(rgt, 38).addScaledVector(up, 4).addScaledVector(fwd, -4)
      cam.position.lerp(desired, k)
      cam.lookAt(fm.pos)
    } else { // cinematic — pull back high, slow drift
      if (fm.dead) {
        // stable elevated 3/4 view of the wreck
        desired.copy(fm.pos).add(this._d.set(34, 15, 46))
        cam.position.lerp(desired, 1 - Math.exp(-dt * 1.4))
        cam.lookAt(fm.pos)
      } else {
        desired.copy(fm.pos).addScaledVector(fwd, -120).addScaledVector(up, 55).addScaledVector(rgt, 40)
        cam.position.lerp(desired, 1 - Math.exp(-dt * 1.5))
        cam.lookAt(fm.pos)
      }
    }
  }
}
