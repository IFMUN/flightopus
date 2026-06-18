// Sleek homepage / intro. A live aurora backdrop and a liquid-glass card that
// expands and dissolves into the running 3D world when you launch.

export class Homepage {
  constructor (root, { onEnter }) {
    this.root = root
    this.onEnter = onEnter
    this._build()
    this._anim()
  }

  _build () {
    this.root.innerHTML = `
      <canvas id="aurora-canvas"></canvas>
      <div class="card glass strong">
        <div class="brand">
          <svg class="mark" viewBox="0 0 24 24" fill="none"><path d="M2 13l9-2 4-8 2 1-2 7 5 1v2l-5 1 2 7-2 1-4-8-9-2z" fill="url(#g)"/><defs><linearGradient id="g" x1="0" y1="0" x2="24" y2="24"><stop stop-color="#9fe6ff"/><stop offset="1" stop-color="#b58cff"/></linearGradient></defs></svg>
          <h1>FLIGHTOPUS</h1>
        </div>
        <div class="tag">Fly a to-scale Boeing 737 MAX 9 through Yosemite Valley</div>
        <div class="sub">Real NASA-derived elevation · procedural granite, forest &amp; snow · six famous
          waterfalls · five times of day · dynamic weather from northern lights to hurricane-force winds.
          Every crash and landing stays in the world — fly again and watch your past attempts.</div>
        <div class="specs">
          <span class="spec"><b>42.16 m</b> length</span>
          <span class="spec"><b>35.9 m</b> wingspan</span>
          <span class="spec"><b>266k</b> trees</span>
          <span class="spec"><b>1047–3027 m</b> real terrain</span>
        </div>
        <div class="modeseg" id="modeseg">
          <div class="seg-label">Controls</div>
          <button class="seg active" data-mode="cursor">🖱 Cursor — easy (point where to fly)</button>
          <button class="seg" data-mode="keyboard">⌨ Keyboard — full control</button>
        </div>
        <div style="margin-top:18px">
          <button class="enter glass" id="enter-btn" disabled>Loading…</button>
        </div>
        <div class="loadbar"><i id="load-i"></i></div>
        <div class="loadtext" id="load-t">Pulling elevation &amp; building the valley…</div>
      </div>
      <div class="foot">Keyboard flight · Shift/Ctrl throttle · G gear · F/R flaps · H for help</div>
    `
    this.controlMode = 'cursor'
    this.root.querySelectorAll('.modeseg .seg').forEach(b => b.addEventListener('click', () => {
      this.root.querySelectorAll('.modeseg .seg').forEach(x => x.classList.remove('active'))
      b.classList.add('active')
      this.controlMode = b.dataset.mode
    }))
    this.btn = this.root.querySelector('#enter-btn')
    this.loadI = this.root.querySelector('#load-i')
    this.loadT = this.root.querySelector('#load-t')
    this.card = this.root.querySelector('.card')
    this.canvas = this.root.querySelector('#aurora-canvas')
    this.btn.addEventListener('click', () => this._enter())
    this._keyHandler = e => { if ((e.key === 'Enter' || e.key === ' ') && !this.btn.disabled && !this._launched) { e.preventDefault(); this._enter() } }
    window.addEventListener('keydown', this._keyHandler)
  }

  progress (p, text) {
    this.loadI.style.width = Math.round(p * 100) + '%'
    if (text) this.loadT.textContent = text
  }

  ready () {
    this.btn.disabled = false
    this.btn.textContent = 'Enter Yosemite ▸'
    this.loadT.textContent = 'Ready for departure.'
  }

  _enter () {
    if (this._launched) return
    this._launched = true
    const veil = document.getElementById('veil')
    veil.classList.add('flash')
    this.root.classList.add('launch')
    setTimeout(() => this.onEnter?.(), 480)
    setTimeout(() => {
      this.root.classList.add('gone')
      this._stop = true
      window.removeEventListener('keydown', this._keyHandler)
      setTimeout(() => { this.root.style.display = 'none'; veil.classList.remove('flash') }, 1100)
    }, 700)
  }

  _anim () {
    const cv = this.canvas
    const ctx = cv.getContext('2d')
    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight }
    resize(); window.addEventListener('resize', resize)
    let t = 0
    const bands = [
      { c: 'rgba(90,230,180,0.20)', y: 0.32, a: 90, s: 0.6 },
      { c: 'rgba(120,160,255,0.18)', y: 0.42, a: 70, s: 0.9 },
      { c: 'rgba(180,120,255,0.16)', y: 0.5, a: 120, s: 0.45 }
    ]
    const draw = () => {
      if (this._stop) return
      t += 0.006
      ctx.clearRect(0, 0, cv.width, cv.height)
      for (const b of bands) {
        ctx.beginPath()
        for (let x = 0; x <= cv.width; x += 12) {
          const y = cv.height * b.y + Math.sin(x * 0.004 + t * (b.s * 4)) * b.a + Math.sin(x * 0.012 + t * 2) * b.a * 0.4
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.lineTo(cv.width, cv.height); ctx.lineTo(0, cv.height); ctx.closePath()
        const g = ctx.createLinearGradient(0, cv.height * b.y - b.a, 0, cv.height)
        g.addColorStop(0, b.c); g.addColorStop(1, 'rgba(8,12,26,0)')
        ctx.fillStyle = g; ctx.fill()
      }
      requestAnimationFrame(draw)
    }
    draw()
  }
}
