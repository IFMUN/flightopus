// Headless screenshot harness. Boots a Vite dev server, drives the app in a
// SwiftShader Chromium, optionally presses keys over time, and saves PNGs.
//
//   node tools/screenshot.mjs <name> [--query "a=1&b=2"] [--wait 6000]
//       [--keys "g:500,F:300,ArrowUp:hold:2000"] [--w 1280] [--h 720]
//
// Multiple screenshots: pass --shots "2000,5000,9000" to capture at several
// elapsed times into <name>-0.png, <name>-1.png, ...

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SHOTS = resolve(__dirname, 'shots')
const PORT = parseInt(process.env.SHOT_PORT || '5191', 10)

function arg (name, def) {
  const i = process.argv.indexOf('--' + name)
  return i >= 0 ? process.argv[i + 1] : def
}
const name = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'shot'
const query = arg('query', 'test=1&skipintro=1')
const waitMs = parseInt(arg('wait', '6000'), 10)
const W = parseInt(arg('w', '1280'), 10)
const H = parseInt(arg('h', '720'), 10)
const keys = arg('keys', '')
const shots = (arg('shots', '') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number)

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist']

async function waitForServer (url, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try { const r = await fetch(url); if (r.ok) return true } catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error('dev server did not start')
}

async function main () {
  await mkdir(SHOTS, { recursive: true })

  const usePreview = process.argv.includes('--preview')
  const serverArgs = usePreview
    ? ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--host']
    : ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--host']
  const server = spawn('node', serverArgs, { cwd: ROOT, stdio: 'pipe', env: { ...process.env } })
  server.stdout.on('data', () => {})
  server.stderr.on('data', d => { const s = d.toString(); if (/error/i.test(s)) process.stderr.write('[vite] ' + s) })

  const url = `http://localhost:${PORT}/?${query}`
  try {
    await waitForServer(`http://localhost:${PORT}/`)

    const browser = await chromium.launch({ headless: true, args: GL_ARGS })
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })

    const errors = []
    const logs = []
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text())
      else if (m.text().startsWith('[')) logs.push(m.text())
    })
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message))

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // wait for first render (high quality can take a while under SwiftShader)
    await page.waitForFunction(() => window.__ready === true, { timeout: 120000 }).catch(() => {})

    async function press (spec) {
      // "g:500" press g wait 500 ; "ArrowUp:hold:2000" hold for 2000ms
      const parts = spec.split(':')
      if (parts[1] === 'hold') {
        await page.keyboard.down(parts[0])
        await page.waitForTimeout(parseInt(parts[2] || '1000', 10))
        await page.keyboard.up(parts[0])
      } else {
        await page.keyboard.press(parts[0])
        await page.waitForTimeout(parseInt(parts[1] || '200', 10))
      }
    }

    // run a sequence of "time:js" evals, e.g. --evals "1500:window.__app.testCrash()|4000:window.__app.newAttempt()"
    const evals = (arg('evals', '') || '').split('|').filter(Boolean).map(s => {
      const i = s.indexOf(':'); return { at: parseInt(s.slice(0, i), 10), code: s.slice(i + 1) }
    })
    if (evals.length) {
      let prev = 0
      for (const e of evals.sort((a, b) => a.at - b.at)) {
        await page.waitForTimeout(Math.max(0, e.at - prev)); prev = e.at
        try { await page.evaluate(e.code) } catch (err) { console.log('eval err:', err.message) }
      }
    }

    if (shots.length) {
      let prev = 0
      for (let i = 0; i < shots.length; i++) {
        await page.waitForTimeout(Math.max(0, shots[i] - prev)); prev = shots[i]
        await page.screenshot({ path: resolve(SHOTS, `${name}-${i}.png`), timeout: 120000 })
        console.log('saved', `${name}-${i}.png`, 'at', shots[i] + 'ms')
      }
    } else {
      await page.waitForTimeout(waitMs)
      if (keys) { for (const k of keys.split(',')) await press(k.trim()) }
      await page.screenshot({ path: resolve(SHOTS, `${name}.png`), timeout: 120000 })
      console.log('saved', `${name}.png`)
    }

    if (logs.length) {
      const tel = logs.filter(l => l.startsWith('[tel]'))
      const other = [...new Set(logs.filter(l => !l.startsWith('[tel]')))]
      if (other.length) console.log('logs:', other.slice(0, 8).join(' | '))
      if (tel.length) { console.log('telemetry:'); tel.slice(-16).forEach(l => console.log('  ' + l)) }
    }
    if (errors.length) {
      console.log('--- console/page errors (' + errors.length + ') ---')
      console.log([...new Set(errors)].slice(0, 12).join('\n'))
    } else {
      console.log('no console errors')
    }

    await browser.close()
  } finally {
    server.kill('SIGTERM')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
