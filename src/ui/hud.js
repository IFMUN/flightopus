// Glass HUD: flight instruments, system state chips, event toasts and a help
// overlay. Pure DOM over the WebGL canvas; styled by the liquid-glass CSS.

import { KEYMAP } from '../aircraft/controls.js'

export class HUD {
  constructor (root) {
    this.root = root
    this._build()
    this._toastTimer = 0
  }

  _build () {
    this.root.innerHTML = `
      <div class="panel tl">
        <div class="glass instr" style="min-width:190px">
          <div class="title">FLIGHTOPUS · Yosemite</div>
          <div class="cluster" style="margin-top:8px;flex-wrap:wrap;gap:8px">
            <span class="chip"><span class="dot"></span><b id="h-time">Golden</b></span>
            <span class="chip"><span class="dot"></span><b id="h-wx">Clear</b></span>
            <span class="chip" id="h-mode" title="Press M to switch">🖱 <b>Cursor</b></span>
          </div>
          <div class="sub" style="margin-top:8px">Attempt <b id="h-attempt">1</b> · <span id="h-wind">wind 3 kt</span></div>
        </div>
      </div>

      <div class="panel tr">
        <div class="glass instr" style="min-width:170px">
          <div class="throttle-wrap">
            <div class="label">Throttle <span id="h-thr-n" class="unit">24%</span></div>
            <div class="bar"><i id="h-thr"></i></div>
            <div class="label" style="margin-top:9px">Flaps <span id="h-flap-n" class="unit">0</span></div>
            <div class="bar flaps"><i id="h-flap"></i></div>
          </div>
          <div class="cluster" style="margin-top:11px;flex-wrap:wrap">
            <span class="chip off" id="h-gear"><span class="dot"></span>GEAR</span>
            <span class="chip off" id="h-brake"><span class="dot"></span>BRK</span>
            <span class="chip off" id="h-spoiler"><span class="dot"></span>SPL</span>
          </div>
        </div>
      </div>

      <div class="panel bl">
        <div class="cluster">
          <div class="glass instr"><div class="label">Airspeed</div><div><span class="value" id="h-ias">0</span><span class="unit">kt</span></div><div class="sub" id="h-mach">M 0.00</div></div>
          <div class="glass instr"><div class="label">Altitude AGL</div><div><span class="value" id="h-agl">0</span><span class="unit">ft</span></div><div class="sub" id="h-msl">0 ft MSL</div></div>
          <div class="glass instr"><div class="label">Vertical Spd</div><div><span class="value" id="h-vs">0</span><span class="unit">fpm</span></div><div class="sub" id="h-aoa">AoA 0°</div></div>
        </div>
      </div>

      <div class="panel bc">
        <div class="glass ribbon">
          <span class="chip"><b id="h-hdg">090</b>°</span>
          <span class="chip">PITCH <b id="h-pitch">0</b>°</span>
          <span class="chip">BANK <b id="h-bank">0</b>°</span>
          <span class="chip" id="h-g">G <b>1.0</b></span>
          <span class="chip warn hidden" id="h-stall"><span class="dot"></span>STALL</span>
        </div>
      </div>

      <div class="panel br">
        <div class="glass instr" style="min-width:120px"><div class="label">View</div><div class="value" id="h-cam" style="font-size:18px">Chase</div><div class="sub">Press <span class="help-key">H</span> for help</div></div>
      </div>

      <div class="toast" id="h-toast"></div>

      <div class="panel" id="h-help" style="inset:0;display:none;place-items:center;z-index:40;pointer-events:auto">
        <div class="glass strong" style="padding:28px 34px;max-width:520px">
          <div class="title" style="font-size:14px;margin-bottom:14px">Controls</div>
          <div class="keys">${KEYMAP.map(([k, d]) => `<div class="k"><span class="help-key">${k}</span></div><div class="d">${d}</div>`).join('')}</div>
          <div class="sub" style="margin-top:16px;text-align:center">Press <span class="help-key">H</span> to close</div>
        </div>
      </div>
    `
    const $ = id => this.root.querySelector('#' + id)
    this.el = {
      time: $('h-time'), wx: $('h-wx'), attempt: $('h-attempt'), wind: $('h-wind'),
      thr: $('h-thr'), thrN: $('h-thr-n'), flap: $('h-flap'), flapN: $('h-flap-n'),
      gear: $('h-gear'), brake: $('h-brake'), spoiler: $('h-spoiler'),
      ias: $('h-ias'), mach: $('h-mach'), agl: $('h-agl'), msl: $('h-msl'), vs: $('h-vs'), aoa: $('h-aoa'),
      hdg: $('h-hdg'), pitch: $('h-pitch'), bank: $('h-bank'), g: $('h-g'), stall: $('h-stall'),
      cam: $('h-cam'), toast: $('h-toast'), help: $('h-help'), mode: $('h-mode')
    }

    // cursor-steering reticle + fixed boresight (shown only in cursor mode)
    this.reticle = document.createElement('div'); this.reticle.className = 'reticle'
    this.boresight = document.createElement('div'); this.boresight.className = 'boresight'
    this.root.append(this.reticle, this.boresight)
    window.addEventListener('mousemove', e => {
      this.reticle.style.left = e.clientX + 'px'
      this.reticle.style.top = e.clientY + 'px'
    })
  }

  setControlMode (m) {
    this.el.mode.innerHTML = m === 'cursor' ? '🖱 <b>Cursor</b>' : '⌨ <b>Keyboard</b>'
    document.body.classList.toggle('cursor-steer', m === 'cursor')
  }

  show () { this.root.classList.remove('hidden'); requestAnimationFrame(() => this.root.classList.add('show')) }

  update (T, input, st) {
    const e = this.el
    e.ias.textContent = Math.max(0, T.kias).toFixed(0)
    e.mach.textContent = 'M ' + (T.mps / 340).toFixed(2)
    e.agl.textContent = Math.max(0, T.agl).toFixed(0)
    e.msl.textContent = T.altMSL.toFixed(0) + ' ft MSL'
    e.vs.textContent = (T.vs >= 0 ? '+' : '') + T.vs.toFixed(0)
    e.aoa.textContent = 'AoA ' + T.aoa.toFixed(1) + '°'
    e.hdg.textContent = String(Math.round(T.hdg)).padStart(3, '0')
    e.pitch.textContent = T.pitch.toFixed(0)
    e.bank.textContent = T.bank.toFixed(0)
    e.g.querySelector('b').textContent = T.g.toFixed(1)
    e.stall.classList.toggle('hidden', !T.stall)

    const thr = Math.round((input.throttle || 0) * 100)
    e.thr.style.width = thr + '%'; e.thrN.textContent = thr + '%'
    const fl = Math.round((input.flaps || 0) * 100)
    e.flap.style.width = fl + '%'; e.flapN.textContent = st.flapNotch ?? 0
    this._chip(e.gear, input.gearDown, st.gearMoving ? 'GEAR…' : 'GEAR')
    this._chip(e.brake, input.brake, 'BRK')
    this._chip(e.spoiler, input.spoiler, 'SPL')
  }

  _chip (el, on, label) {
    el.classList.toggle('off', !on)
    el.lastChild.textContent = ' ' + label
  }

  setTime (t) { this.el.time.textContent = t }
  setWeather (w) { this.el.wx.textContent = w }
  setWind (kt) { this.el.wind.textContent = 'wind ' + Math.round(kt) + ' kt' }
  setAttempt (n) { this.el.attempt.textContent = n }
  setCam (c) { this.el.cam.textContent = c }
  toggleHelp () { const h = this.el.help; h.style.display = h.style.display === 'none' ? 'grid' : 'none' }

  toast (msg, sub, type) {
    const t = this.el.toast
    t.className = 'toast show ' + (type || '')
    t.innerHTML = `<span class="big">${msg}</span>${sub ? `<span class="small">${sub}</span>` : ''}`
    clearTimeout(this._tt)
    this._tt = setTimeout(() => t.classList.remove('show'), 3200)
  }
}
