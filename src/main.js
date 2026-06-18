import * as THREE from 'three'
import { CONFIG } from './config.js'
import { loadMeta, Geo } from './core/geo.js'
import { Heightfield } from './core/heightfield.js'
import { Terrain } from './core/terrain.js'
import { Forest } from './core/trees.js'
import { Environment, TIME_ORDER, TIME_PRESETS } from './core/environment.js'
import { Weather } from './core/weather.js'
import { Waterfalls } from './core/water.js'
import { Controls } from './aircraft/controls.js'
import { Attempts } from './aircraft/attempts.js'
import { HUD } from './ui/hud.js'
import { Homepage } from './ui/homepage.js'
import { CameraRig } from './ui/cameras.js'
import { DamageUI } from './ui/damage.js'
import { TrailSmoke } from './aircraft/effects.js'

const app = {}
window.__app = app
window.__ready = false

const params = new URLSearchParams(location.search)
const DEBUG = params.get('debug') === '1'
const camMode = params.get('cam')          // presence => spectator inspection mode
const spectator = !!camMode

function spawnState () {
  return {
    // start high and clear of every peak (terrain max ~3027 m) heading east
    // down the valley, so hands-off flight never flies into a mountain
    pos: new THREE.Vector3(-5200, 3250, 900),
    vel: new THREE.Vector3(150, 0, 0),
    quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'))
  }
}

async function boot () {
  // ---- renderer / scene / camera ----
  const renderer = new THREE.WebGLRenderer({ antialias: !CONFIG.test, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.pixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  document.getElementById('scene').appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 2.5, 55000)
  camera.position.set(-6500, 2600, 2200)
  camera.lookAt(0, 1700, 0)
  Object.assign(app, { renderer, scene, camera })

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  // ---- homepage (shows immediately, reports loading progress) ----
  const home = new Homepage(document.getElementById('home'), { onEnter: () => startGameplay(home.controlMode) })
  if (CONFIG.skipIntro) document.getElementById('home').style.display = 'none'
  const prog = (p, t) => { if (!CONFIG.skipIntro) home.progress(p, t) }

  // ---- world ----
  prog(0.1, 'Pulling real elevation…')
  const meta = await loadMeta()
  const geo = new Geo(meta)
  const hf = await new Heightfield(geo).load()
  prog(0.35, 'Carving the granite valley…')
  const terrain = new Terrain(hf, geo)
  scene.add(terrain.mesh)
  const env = new Environment(scene, terrain.uniforms)
  env.setTime(CONFIG.initialTime)
  prog(0.55, 'Planting 266,000 trees…')
  const forest = new Forest(hf, geo)
  scene.add(forest.group)
  prog(0.75, 'Routing the waterfalls…')
  const water = new Waterfalls(scene, hf, geo)
  const weather = new Weather(scene, env, geo)
  prog(0.9, 'Fuelling the 737…')

  Object.assign(app, { meta, geo, hf, terrain, env, forest, water, weather })
  console.log('[elev]', hf.min.toFixed(0), '..', hf.max.toFixed(0), 'm  range', (hf.max - hf.min).toFixed(0))
  console.log('[forest]', forest.count, 'trees')

  // ---- aircraft + control + ui ----
  const attempts = new Attempts(scene, hf)
  attempts.spawn(spawnState())
  const cameras = new CameraRig(camera)
  const hud = new HUD(document.getElementById('hud'))
  const damageUI = new DamageUI()
  Object.assign(app, { attempts, cameras, hud, damageUI })

  // ---- lightning damage ----
  const partSmokes = new Map()
  const tmpV3 = new THREE.Vector3()
  weather.setTarget(attempts.fm)
  weather.onStrike = () => onLightningStrike()

  const STRIKE_PARTS = [
    ['wingL', 'Left wing'], ['wingR', 'Right wing'],
    ['engineL', 'Left engine'], ['engineR', 'Right engine'],
    ['tail', 'Tail'], ['nose', 'Nose']
  ]
  function onLightningStrike () {
    if (!started || app.paused || attempts.fm.dead) return
    // bias toward wings/engines, rarely the nose
    const [part, label] = STRIKE_PARTS[Math.floor(Math.pow(Math.random(), 1.3) * STRIKE_PARTS.length) % STRIKE_PARTS.length]
    attempts.fm.applyDamage(part, 0.22 + Math.random() * 0.3)
    damageUI.strike()
    hud.toast('⚡ LIGHTNING STRIKE', label + ' damaged — fly it down!', 'danger')
    if (!partSmokes.has(part)) partSmokes.set(part, new TrailSmoke(scene, { color: 0x151515 }))
  }
  function clearDamageFx () {
    for (const s of partSmokes.values()) s.dispose()
    partSmokes.clear()
    damageUI.reset()
  }

  let timeIdx = TIME_ORDER.indexOf(env.timeName); if (timeIdx < 0) timeIdx = 2
  let gearAnim = 0
  let started = false
  const lastAtt = { bank: 0, pitch: 0 } // fed to cursor steering (1-frame lag, fine)
  app.paused = false

  const controls = new Controls({
    onGear: down => hud.toast(down ? 'Gear down' : 'Gear up', '', ''),
    onCamera: () => hud.setCam(cameras.cycle()),
    onTime: () => { timeIdx = (timeIdx + 1) % TIME_ORDER.length; const n = TIME_ORDER[timeIdx]; env.setTime(n); hud.setTime(TIME_PRESETS[n].label) },
    onWeather: () => hud.setWeather(weather.cycle()),
    onHelp: () => hud.toggleHelp(),
    onPause: () => { app.paused = !app.paused; hud.toast(app.paused ? 'Paused' : 'Resumed', '', '') },
    onMode: () => { const m = controls.toggleMode(); hud.setControlMode(m); hud.toast(m === 'cursor' ? 'Cursor steering' : 'Keyboard controls', m === 'cursor' ? 'Point where you want to fly' : 'WASD / arrows + Q/E', '') },
    onNewAttempt: () => newAttempt()
  })
  app.controls = controls
  cameras.snapBehind(attempts.fm)

  function resetCruise () {
    controls.setGear(false); controls.setThrottle(0.34); controls.setFlaps(0)
    controls.input.pitch = controls.input.roll = controls.input.yaw = 0
    gearAnim = 0
  }
  resetCruise()

  function newAttempt () {
    const n = attempts.newAttempt()
    resetCruise()
    clearDamageFx()
    cameras.snapBehind(attempts.fm)
    hud.setAttempt(n + 1)
    hud.toast('New attempt #' + (n + 1), 'Your past runs remain in the valley', '')
  }

  function handleEvents (ev) {
    if (ev.crash) {
      hud.toast('CRASH', 'Press Space to fly again', 'danger')
      cameras.mode = 3; app._cineUntil = 0; cameras.snapDead(attempts.fm); hud.setCam(cameras.name) // cinematic on the wreck
    }
    else if (ev.touchdown) {
      const sink = ev.touchdown.sink
      const soft = sink < 1.8
      hud.toast(soft ? 'SMOOTH LANDING' : 'TOUCHDOWN', sink.toFixed(1) + ' m/s sink · ' + (ev.touchdown.gs * 1.94384).toFixed(0) + ' kt', 'success')
    }
  }

  // ---- intro / start ----
  function startGameplay (mode) {
    if (started) return
    started = true
    controls.enabled = true
    hud.setControlMode(controls.setMode(mode || 'keyboard'))
    hud.show()
    hud.setTime(TIME_PRESETS[env.timeName].label)
    hud.setWeather(weather.preset.label)
    hud.setCam(cameras.name)
    // cinematic opener, then settle into chase
    cameras.mode = 3
    app._cineUntil = performance.now() + 4500
  }
  app.start = startGameplay
  app.newAttempt = newAttempt
  // test hooks
  app.testCrash = () => { const f = attempts.fm; const ty = hf.height(f.pos.x, f.pos.z); f.pos.y = ty + 2; f.vel.set(70, -28, 0); controls.setGear(false) }
  app.testGround = () => {
    const f = attempts.fm; const x = 2400, z = 250; const ty = hf.height(x, z)
    f.pos.set(x, ty + 3.6, z); f.vel.set(34, -0.4, 0)
    f.quat.copy(spawnState().quat); f.omega.set(0, 0, 0)
    controls.setGear(true); controls.setThrottle(0.10); controls.setFlaps(3)
  }
  app.testStrike = (part = 'wingR', amt = 0.45) => {
    attempts.fm.applyDamage(part, amt); damageUI.strike()
    if (!partSmokes.has(part)) partSmokes.set(part, new TrailSmoke(scene, { color: 0x151515 }))
    hud.toast('⚡ LIGHTNING STRIKE', part + ' damaged', 'danger')
  }
  if (CONFIG.skipIntro && !spectator) startGameplay(params.get('control') || 'keyboard')
  if (!CONFIG.skipIntro) { home.ready() }

  // ---- main loop ----
  const clock = new THREE.Clock()
  let t0 = performance.now()
  let telT = 0

  function frame () {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = (performance.now() - t0) / 1000

    if (spectator) {
      runSpectator(t)
      attempts.plane.update(dt, t)
    } else if (started && !app.paused) {
      controls.update(dt, lastAtt)
      const input = controls.input
      const wind = weather.getWind(attempts.fm.pos, t)
      const ev = attempts.update(dt, t, input, wind)
      handleEvents(ev)

      const p = attempts.plane
      gearAnim += ((input.gearDown ? 1 : 0) - gearAnim) * Math.min(1, dt * 1.6)
      p.setGear(gearAnim)
      p.setFlaps(input.flaps)
      p.setControls(input.pitch, input.roll, input.yaw)
      p.setThrottle(input.throttle)
      p.update(dt, t, { dead: attempts.fm.dead })

      if (app._cineUntil && performance.now() > app._cineUntil) { cameras.mode = 0; app._cineUntil = 0; hud.setCam(cameras.name) }
      cameras.update(dt, attempts.fm)

      const T = attempts.fm.telemetry()
      lastAtt.bank = T.bank; lastAtt.pitch = T.pitch
      hud.update(T, input, { flapNotch: controls.flapNotch, gearMoving: Math.abs((input.gearDown ? 1 : 0) - gearAnim) > 0.02 })
      hud.setWind(weather.windSpeed() * 1.94384)

      // battle-damage visuals: scorch parts, fill the schematic, trail fire+smoke
      damageUI.setDamage(attempts.fm.damage, T.overallDamage)
      if (T.overallDamage > 0.001) {
        const dmg = attempts.fm.damage
        if (p.setPartDamage) for (const k in dmg) p.setPartDamage(k, dmg[k])
        if (p.parts) for (const [part, smoke] of partSmokes) { const loc = p.parts[part]; if (loc) smoke.update(dt, loc.getWorldPosition(tmpV3), wind, dmg[part]) }
      }

      if (DEBUG && (telT += dt) > 0.5) {
        telT = 0
        console.log('[tel]', 'IAS', T.kias.toFixed(0), 'ALT', T.altMSL.toFixed(0), 'AGL', T.agl.toFixed(0),
          'VS', T.vs.toFixed(0), 'PITCH', T.pitch.toFixed(1), 'BANK', T.bank.toFixed(1), 'HDG', T.hdg.toFixed(0),
          'THR', (input.throttle * 100).toFixed(0), 'G', T.g.toFixed(2), T.stall ? 'STALL' : '', T.onGround ? 'GND' : '', T.dead ? (T.crashed ? 'CRASH' : 'DEAD') : '')
      }
    } else {
      // pre-start gentle drift over the valley (homepage backdrop)
      const a = t * 0.03
      camera.position.set(Math.sin(a) * 7200, 2900, Math.cos(a) * 7200)
      camera.up.set(0, 1, 0); camera.lookAt(0, 1600, 0)
      attempts.plane.update(dt, t)
    }

    weather.update(dt, t, camera)
    water.update(dt, t)
    forest.update(t, Math.min(1, weather.windSpeed() / 18))
    env.update(dt)
    env.sky.follow(camera)

    renderer.render(scene, camera)
    window.__ready = true
    requestAnimationFrame(frame)
  }

  // spectator inspection cameras (via ?cam=...)
  function runSpectator (t) {
    const P = attempts.plane.group.position
    camera.up.set(0, 1, 0)
    if (camMode === 'top') { camera.position.set(120, 11000, 120); camera.up.set(0, 0, -1); camera.lookAt(0, 1400, 0) }
    else if (camMode === 'tunnel') { camera.position.set(-7052, 2050, 2320); camera.lookAt(4000, 1700, -600) }
    else if (camMode === 'floor') { camera.position.set(-3526, 1320, 1700); camera.lookAt(-3526, 2100, 211) }
    else if (camMode === 'plane') { const a = t * 0.6, r = 34; camera.position.set(P.x + Math.sin(a) * r, P.y + 6 + Math.sin(a * 0.5) * 4, P.z + Math.cos(a) * r); camera.lookAt(P.x, P.y, P.z) }
    else if (camMode === 'falls') { const f = app.water.places[0]; camera.position.set(f.x - 600, f.yTop + 60, f.z + 600); camera.lookAt(f.x, f.yTop - 150, f.z) }
    else { const r = 7000; camera.position.set(Math.sin(t * 0.05) * r, 3200, Math.cos(t * 0.05) * r); camera.lookAt(0, 1500, 0) }
  }

  frame()
}

boot().catch(err => {
  console.error('BOOT ERROR', err)
  document.body.insertAdjacentHTML('beforeend',
    `<pre style="position:fixed;top:0;left:0;z-index:999;color:#f88;background:#000a;padding:12px;max-width:100vw;white-space:pre-wrap">${err.stack || err}</pre>`)
})
