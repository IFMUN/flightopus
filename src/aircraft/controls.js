// Keyboard flight controls. Continuous axes (pitch/roll/yaw/throttle) are
// smoothed; discrete actions (gear, flaps, view, time, weather, new attempt)
// fire callbacks.

export const KEYMAP = [
  ['Mouse', 'Steer toward cursor (Cursor mode)'],
  ['M', 'Switch Keyboard / Cursor'],
  ['W / ↑', 'Pitch up (climb) — Keyboard'],
  ['S / ↓', 'Pitch down (dive) — Keyboard'],
  ['A / ←', 'Roll left — Keyboard'],
  ['D / →', 'Roll right — Keyboard'],
  ['Q  E', 'Rudder yaw L / R'],
  ['Shift', 'Throttle up'],
  ['Ctrl', 'Throttle down'],
  ['G', 'Landing gear up / down'],
  ['F / R', 'Flaps extend / retract'],
  ['X', 'Spoilers / airbrake (hold)'],
  ['B', 'Wheel brakes (hold)'],
  ['Space / ⏎', 'New attempt'],
  ['C', 'Cycle camera view'],
  ['T', 'Cycle time of day'],
  ['Y', 'Cycle weather'],
  ['H', 'Toggle help'],
  ['P', 'Pause']
]

const FLAP_DETENTS = [0, 0.34, 0.67, 1.0]

export class Controls {
  constructor (handlers = {}) {
    this.h = handlers
    this.keys = new Set()
    this.input = { pitch: 0, roll: 0, yaw: 0, throttle: 0.0, flaps: 0, gearDown: true, brake: false, spoiler: false }
    this._flapNotch = 0
    this.enabled = false
    this.mode = 'keyboard'           // 'keyboard' | 'cursor'
    this.mouse = { x: 0, y: 0 }       // normalised device coords, (0,0) = centre

    this._down = e => this._onDown(e)
    this._up = e => this._onUp(e)
    this._move = e => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1
      this.mouse.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('keydown', this._down)
    window.addEventListener('keyup', this._up)
    window.addEventListener('mousemove', this._move)
  }

  setMode (m) { this.mode = m === 'cursor' ? 'cursor' : 'keyboard'; return this.mode }
  toggleMode () { return this.setMode(this.mode === 'cursor' ? 'keyboard' : 'cursor') }

  _code (e) {
    const k = e.key
    if (k === 'ArrowUp') return 'up'
    if (k === 'ArrowDown') return 'down'
    if (k === 'ArrowLeft') return 'left'
    if (k === 'ArrowRight') return 'right'
    if (k === ' ') return 'space'
    if (k === 'Shift') return 'shift'
    if (k === 'Control') return 'ctrl'
    if (k === 'Enter') return 'enter'
    return k.length === 1 ? k.toLowerCase() : k.toLowerCase()
  }

  _onDown (e) {
    const c = this._code(e)
    if (['up', 'down', 'left', 'right', 'space'].includes(c)) e.preventDefault()
    if (!this.enabled) return
    if (this.keys.has(c)) return // ignore auto-repeat for one-shots
    this.keys.add(c)
    switch (c) {
      case 'g': this.input.gearDown = !this.input.gearDown; this.h.onGear?.(this.input.gearDown); break
      case 'f': this._flapNotch = Math.min(FLAP_DETENTS.length - 1, this._flapNotch + 1); this.h.onFlaps?.(this._flapNotch); break
      case 'r': this._flapNotch = Math.max(0, this._flapNotch - 1); this.h.onFlaps?.(this._flapNotch); break
      case 'c': this.h.onCamera?.(); break
      case 't': this.h.onTime?.(); break
      case 'y': this.h.onWeather?.(); break
      case 'h': this.h.onHelp?.(); break
      case 'p': this.h.onPause?.(); break
      case 'm': this.h.onMode?.(); break
      case 'space': case 'enter': this.h.onNewAttempt?.(); break
    }
  }

  _onUp (e) { this.keys.delete(this._code(e)) }

  // att (optional) = { bank, pitch } in degrees, used by cursor steering.
  update (dt, att = null) {
    const k = this.keys
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
    const approach = (cur, target, rate) => {
      const d = target - cur
      const step = rate * dt
      return Math.abs(d) <= step ? target : cur + Math.sign(d) * step
    }

    // throttle / flaps / brakes / spoilers — same in both modes
    if (k.has('shift')) this.input.throttle = Math.min(1, this.input.throttle + dt * 0.45)
    if (k.has('ctrl')) this.input.throttle = Math.max(0, this.input.throttle - dt * 0.5)
    this.input.flaps += (FLAP_DETENTS[this._flapNotch] - this.input.flaps) * Math.min(1, dt * 1.5)
    this.input.brake = k.has('b')
    this.input.spoiler = k.has('x')
    const yKey = (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0)

    if (this.mode === 'cursor') {
      // cursor offset from centre -> commanded bank / pitch; a proportional
      // controller flies the jet toward that attitude (self-limiting & easy).
      const dz = v => { const s = Math.sign(v), a = Math.abs(v); if (a < 0.045) return 0; const tt = (a - 0.045) / 0.955; return s * Math.min(1, 0.28 * tt + 0.95 * tt * tt) }
      const cmdBank = dz(this.mouse.x) * 55      // degrees
      const cmdPitch = dz(-this.mouse.y) * 22    // degrees
      if (att) {
        const rollT = clamp((cmdBank - att.bank) * 0.05, -1, 1)
        const pitchT = clamp((cmdPitch - att.pitch) * 0.07, -1, 1)
        const yawT = clamp(yKey + (cmdBank / 55) * 0.25, -1, 1)   // coordinated turn
        this.input.roll = approach(this.input.roll, rollT, 5)
        this.input.pitch = approach(this.input.pitch, pitchT, 5)
        this.input.yaw = approach(this.input.yaw, yawT, 4)
      } else {
        this.input.roll = approach(this.input.roll, dz(this.mouse.x), 4)
        this.input.pitch = approach(this.input.pitch, dz(-this.mouse.y), 4)
        this.input.yaw = approach(this.input.yaw, yKey, 4)
      }
    } else {
      const pT = (k.has('w') || k.has('up') ? 1 : 0) - (k.has('s') || k.has('down') ? 1 : 0)
      const rT = (k.has('d') || k.has('right') ? 1 : 0) - (k.has('a') || k.has('left') ? 1 : 0)
      this.input.pitch = approach(this.input.pitch, pT, 3.2)
      this.input.roll = approach(this.input.roll, rT, 4.0)
      this.input.yaw = approach(this.input.yaw, yKey, 4.0)
    }
  }

  setThrottle (v) { this.input.throttle = v }
  setGear (down) { this.input.gearDown = down }
  setFlaps (notch) { this._flapNotch = notch }
  get flapNotch () { return this._flapNotch }

  dispose () {
    window.removeEventListener('keydown', this._down)
    window.removeEventListener('keyup', this._up)
  }
}
