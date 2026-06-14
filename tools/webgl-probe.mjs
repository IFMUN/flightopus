import { chromium } from 'playwright'

const html = `<!doctype html><html><body style="margin:0">
<canvas id="c" width="320" height="200"></canvas>
<script>
  const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl')
  if (gl) {
    gl.clearColor(0.1, 0.6, 0.9, 1); gl.clear(gl.COLOR_BUFFER_BIT)
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    window.__r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl.getParameter(gl.VERSION))
  } else window.__r = 'NO_WEBGL'
</script></body></html>`

const argSets = [
  ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  ['--use-gl=swiftshader', '--no-sandbox'],
  ['--no-sandbox']
]

for (const args of argSets) {
  try {
    const browser = await chromium.launch({ headless: true, args })
    const page = await browser.newPage()
    await page.setContent(html)
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => window.__r)
    await page.screenshot({ path: 'tools/probe.png' })
    await browser.close()
    console.log('OK with args:', JSON.stringify(args))
    console.log('WebGL renderer:', r)
    process.exit(0)
  } catch (e) {
    console.log('FAILED args', JSON.stringify(args), '->', e.message.split('\n')[0])
  }
}
console.log('All arg sets failed.')
process.exit(1)
