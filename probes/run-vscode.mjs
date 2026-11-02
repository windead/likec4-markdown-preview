// Drives a real VS Code (Electron) with the probe extension for P1/P3/P4.
// Usage: xvfb-run -a node probes/run-vscode.mjs <path-to-code-binary> <out-dir>
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const code = process.argv[2]
const out = resolve(process.argv[3] ?? 'probes/out')
mkdirSync(out, { recursive: true })
const ws = resolve('fixtures')
const probeDir = join(out, 'probe')
const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'vsc-'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a)

const app = await electron.launch({
  executablePath: code,
  args: [
    ws,
    `--extensionDevelopmentPath=${resolve('probes/ext')}`,
    `--user-data-dir=${join(tmp, 'u')}`,
    `--extensions-dir=${join(tmp, 'e')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--no-sandbox',
  ],
  env: { ...process.env, PROBE_OPEN: join(ws, 'docs/sample.md'), PROBE_DIR: probeDir },
  timeout: 60000,
})
const page = await app.firstWindow()
await page.setViewportSize?.({ width: 1600, height: 1000 }).catch(() => {})
const consoleMsgs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)) })

async function previewFrame(timeoutMs = 60000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    for (const f of page.frames()) {
      try {
        if (await f.evaluate(() => !!document.querySelector('.likec4-view'))) return f
      } catch {}
    }
    await sleep(500)
  }
  throw new Error('preview frame not found')
}

const report = {}
try {
  const frame = await previewFrame()
  log('preview frame found', frame.url().slice(0, 80))

  // wait until diagrams rendered (nested shadow roots are pierced by evaluate code below)
  const countNodes = () => frame.evaluate(() => {
    const res = {}
    for (const host of document.querySelectorAll('.likec4-view')) {
      const sr = host.shadowRoot
      const inner = sr?.querySelector('.likec4-view')?.shadowRoot ?? null
      const scope = inner ?? sr
      res[host.id] = {
        nodes: scope ? scope.querySelectorAll('.react-flow__node').length : -1,
        edges: scope ? scope.querySelectorAll('.react-flow__edge').length : -1,
        innerShadow: !!inner,
        styleTags: inner ? inner.querySelectorAll('style').length : 0,
        height: Math.round(host.getBoundingClientRect().height),
      }
    }
    return res
  })
  let nodes
  for (let i = 0; i < 120; i++) {
    nodes = await countNodes()
    if (Object.values(nodes).length >= 4 && Object.values(nodes).every(v => v.nodes > 0)) break
    await sleep(500)
  }
  report.p3_render = nodes
  log('rendered', JSON.stringify(nodes))
  await sleep(1500)
  await page.screenshot({ path: join(out, 'p3-preview.png') })

  // P3: computed style check inside nested shadow root: node background & font
  report.p3_style = await frame.evaluate(() => {
    const host = document.querySelector('.likec4-view')
    const inner = host.shadowRoot.querySelector('.likec4-view')?.shadowRoot
    const node = inner?.querySelector('.react-flow__node')
    const shape = node?.querySelector('[class*="likec4-element-shape"], svg, div')
    const cs = node ? getComputedStyle(node) : null
    const title = inner?.querySelector('.react-flow__node [class*="title"], .react-flow__node')
    return {
      nodePosition: cs?.position, nodeTransform: cs?.transform?.slice(0, 40),
      titleFont: title ? getComputedStyle(title).fontFamily.slice(0, 60) : null,
      titleColor: title ? getComputedStyle(title).color : null,
      mantineVars: inner ? getComputedStyle(inner.querySelector('.likec4-shadow-root') ?? inner.host).getPropertyValue('--mantine-color-body') : null,
      shapeTag: shape?.tagName,
    }
  })

  // P3: zoom / pan on the first diagram
  const firstId = Object.keys(nodes)[0]
  const viewportOf = (fr, id) => fr.evaluate(id => {
    const inner = document.getElementById(id)?.shadowRoot?.querySelector('.likec4-view')?.shadowRoot
    return inner?.querySelector('.react-flow__viewport')?.style.transform ?? null
  }, id)
  const frameOffset = async fr => { const b = await (await fr.frameElement()).boundingBox(); return { x: b.x, y: b.y } }
  let off = await frameOffset(frame)
  const box = await frame.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }, firstId)
  const before = await viewportOf(frame, firstId)
  const cx = off.x + box.x + box.w / 2, cy = off.y + box.y + Math.min(box.h / 2, 200)
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -300)
  await sleep(600)
  const afterWheel = await viewportOf(frame, firstId)
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control')
  await sleep(600)
  const afterCtrlWheel = await viewportOf(frame, firstId)
  await page.mouse.move(cx + 3, cy + 3)
  await page.mouse.down(); await page.mouse.move(cx + 80, cy + 50, { steps: 10 }); await page.mouse.up()
  await sleep(600)
  const afterPan = await viewportOf(frame, firstId)
  report.p3_zoomPan = { before, afterWheel, afterCtrlWheel, afterPan }
  log('zoom/pan', JSON.stringify(report.p3_zoomPan))

  // P1a: markdown edit (non-forced refresh -> morphdom). JSON counter also changes in the same update.
  for (let i = 0; i < 3; i++) await frame.locator(`[data-probe-counter="${firstId}"]`).click()
  const snap = async fr => ({
    hosts: await fr.evaluate(() => window.__probe.hosts()),
    mounts: await fr.evaluate(() => window.__probe.mounts),
    clicks: await fr.evaluate(id => document.getElementById(id)?.shadowRoot?.querySelector('[data-probe-counter]')?.textContent, firstId),
    json: await fr.evaluate(id => document.getElementById(id)?.shadowRoot?.querySelector('[data-probe-json-counter]')?.textContent, firstId),
    viewport: await viewportOf(fr, firstId),
  })
  const a0 = await snap(frame)
  let t0 = Date.now()
  writeFileSync(join(probeDir, 'trigger'), 'md ' + Date.now())
  let a1
  for (let i = 0; i < 60; i++) { await sleep(100); a1 = await snap(frame); if (a1.json !== a0.json) break }
  await sleep(1200)
  const a2 = await snap(frame)
  report.p1a_mdEdit = { ms: Date.now() - t0, before: a0, after: a1, later: a2, frameDetached: frame.isDetached(),
    errors: await frame.evaluate(() => window.__probe.errors),
    shadowDump: await frame.evaluate(id => { const h = document.getElementById(id); return { html: h.shadowRoot?.innerHTML.slice(0, 300), len: h.shadowRoot?.innerHTML.length, rect: h.getBoundingClientRect().height, light: h.innerHTML.slice(0, 120) } }, firstId) }
  log('p1a', JSON.stringify({ ms: report.p1a_mdEdit.ms, mounts: [a0.mounts, a1.mounts], clicks: [a0.clicks, a1.clicks], json: [a0.json, a1.json], vp: [a0.viewport, a1.viewport] }))
  await page.screenshot({ path: join(out, 'p1a-after-md-edit.png') })

  // P1b: forced refresh (markdown.preview.refresh) -> timeline of what is visible
  const timeline = []
  t0 = Date.now()
  writeFileSync(join(probeDir, 'trigger'), 'force ' + Date.now())
  const shots = []
  while (Date.now() - t0 < 2500) {
    let entry = { t: Date.now() - t0, frames: 0, total: 0 }
    for (const f of page.frames()) {
      try {
        const n = await f.evaluate(() => {
          if (!document.querySelector('.likec4-view')) return null
          let c = 0
          for (const h of document.querySelectorAll('.likec4-view')) c += h.shadowRoot?.querySelector('.likec4-view')?.shadowRoot?.querySelectorAll('.react-flow__node').length ?? 0
          const vis = document.visibilityState
          return { c, vis }
        })
        if (n) { entry.frames++; entry.total += n.c; entry.vis = n.vis }
      } catch {}
    }
    timeline.push(entry)
    if (shots.length < 6 && entry.t > shots.length * 120) { const p = join(out, `p1b-${shots.length}.png`); await page.screenshot({ path: p }); shots.push(p) }
  }
  const f2 = await previewFrame()
  await sleep(1000)
  report.p1b_force = { timeline, after: await snap(f2), prevSession: await f2.evaluate(() => window.__probe.prevSession), prevLocal: await f2.evaluate(() => window.__probe.prevLocal) }
  log('p1b', JSON.stringify({ detached: frame.isDetached(), mounts: report.p1b_force.after.mounts, prevSession: report.p1b_force.prevSession, minTotal: Math.min(...timeline.map(e => e.total)) }))

  // P3: click an element node (browser=true opens overlay) in the new frame
  off = await frameOffset(f2)
  const nodeBox = await f2.evaluate(id => {
    const inner = document.getElementById(id).shadowRoot.querySelector('.likec4-view')?.shadowRoot
    const n = inner?.querySelector('.react-flow__node')
    const r = n?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null
  }, firstId)
  if (nodeBox) {
    await page.mouse.click(off.x + nodeBox.x, off.y + nodeBox.y)
    await sleep(1500)
    report.p3_click = await f2.evaluate(id => {
      const inner = document.getElementById(id).shadowRoot.querySelector('.likec4-view')?.shadowRoot
      return { flows: inner?.querySelectorAll('.react-flow').length ?? 0, dialogs: inner?.querySelectorAll('dialog,[role=dialog]').length ?? 0 }
    }, firstId)
    await page.screenshot({ path: join(out, 'p3-after-click.png') })
  }
  report.previewErrors = await f2.evaluate(() => window.__probe.errors)

} catch (e) {
  report.error = String(e?.stack ?? e)
  await page.screenshot({ path: join(out, 'error.png') }).catch(() => {})
} finally {
  report.console = consoleMsgs.filter(m => !/Extension Host|punycode|deprecat/i.test(m)).slice(0, 40)
  const res = join(probeDir, 'result.json')
  report.ext = existsSync(res) ? JSON.parse(readFileSync(res, 'utf8')) : null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  await app.close().catch(() => {})
  log('done ->', join(out, 'report.json'))
}
