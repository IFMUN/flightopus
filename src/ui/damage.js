// Battle-damage UI: a corner airframe schematic that lights up the damaged
// parts, a styled red edge vignette that intensifies with damage, and a quick
// white flash on a lightning strike.

const PARTS = ['nose', 'wingL', 'wingR', 'engineL', 'engineR', 'tail']

export class DamageUI {
  constructor () {
    this.vig = el('div', 'dmg-vignette')
    this.flash = el('div', 'dmg-flash')
    this.panel = el('div', 'dmg-panel glass')
    this.panel.innerHTML = `
      <div class="dmg-title">Airframe</div>
      <svg viewBox="0 0 120 168" xmlns="http://www.w3.org/2000/svg">
        <!-- wings -->
        <polygon id="p-wingR" class="dpart" points="66,72 112,98 112,106 66,92"/>
        <polygon id="p-wingL" class="dpart" points="54,72 8,98 8,106 54,92"/>
        <!-- engines -->
        <ellipse id="p-engineR" class="dpart" cx="90" cy="95" rx="5" ry="8"/>
        <ellipse id="p-engineL" class="dpart" cx="30" cy="95" rx="5" ry="8"/>
        <!-- fuselage body -->
        <rect class="dbody" x="53" y="26" width="14" height="116" rx="7"/>
        <!-- nose -->
        <path id="p-nose" class="dpart" d="M60 8 C66 12 67 22 66 30 L54 30 C53 22 54 12 60 8 Z"/>
        <!-- tail: stabs + fin -->
        <g id="p-tail" class="dpart">
          <polygon points="64,124 88,136 88,140 64,131"/>
          <polygon points="56,124 32,136 32,140 56,131"/>
          <polygon points="57,118 63,118 61,143 59,143"/>
        </g>
      </svg>
      <div class="dmg-bar"><i id="dmg-i"></i></div>
      <div class="dmg-int"><span id="dmg-pct">100</span>% integrity</div>`
    document.body.append(this.vig, this.flash, this.panel)
    this.parts = {}
    for (const p of PARTS) this.parts[p] = this.panel.querySelector('#p-' + p)
    this.bar = this.panel.querySelector('#dmg-i')
    this.pct = this.panel.querySelector('#dmg-pct')
    this._flashT = 0
  }

  setDamage (dmg, overall) {
    const any = overall > 0.001
    this.panel.classList.toggle('show', any)
    for (const p of PARTS) {
      const lvl = dmg[p] || 0
      this.parts[p].style.fill = mix(lvl)
      this.parts[p].style.filter = lvl > 0.05 ? `drop-shadow(0 0 ${2 + lvl * 5}px rgba(255,40,40,${0.4 + lvl * 0.5}))` : 'none'
    }
    const integ = Math.round((1 - overall) * 100)
    this.bar.style.width = integ + '%'
    this.pct.textContent = integ
    this.vig.style.opacity = Math.min(0.92, overall * 1.25)
    this.vig.classList.toggle('crit', overall > 0.5)
  }

  strike () {
    this.flash.classList.add('on')
    clearTimeout(this._ft)
    this._ft = setTimeout(() => this.flash.classList.remove('on'), 110)
  }

  reset () { this.setDamage({}, 0) }
}

function el (tag, cls) { const e = document.createElement(tag); e.className = cls; return e }

// steel -> amber -> red as damage rises
function mix (l) {
  const stops = [[90, 100, 112], [255, 190, 70], [255, 40, 38]]
  const t = Math.max(0, Math.min(1, l))
  let a, b, f
  if (t < 0.5) { a = stops[0]; b = stops[1]; f = t / 0.5 } else { a = stops[1]; b = stops[2]; f = (t - 0.5) / 0.5 }
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * f))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
