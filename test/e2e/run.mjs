// End-to-end scenarios in a real VS Code: E1–E6 (+ P1c, latency). Writes test-results/e2e/.
// Usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs [scenario...]
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frameOffset, hostsInfo, launch, previewFrame, repo, sleep, waitRendered } from './lib.mjs'

const out = join(repo, 'test-results/e2e')
mkdirSync(out, { recursive: true })
const only = process.argv.slice(2)
const results = {}

function makeWorkspace() {
  const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-ws-'))
  cpSync(join(repo, 'fixtures'), ws, { recursive: true })
  return ws
}

const shot = (vs, name) => vs.page.screenshot({ path: join(out, `${name}.png`) })
const check = (cond, msg) => {
  if (!cond) throw new Error(`check failed: ${msg}`)
}

/** Marks every host element with a JS property so identity can be checked after updates. */
const markHosts = frame => frame.evaluate(() => {
  for (const h of document.querySelectorAll('.likec4-view')) {
    h.__e2eMark ??= Math.random().toString(36).slice(2)
    h.shadowRoot.__e2eMark ??= h.__e2eMark
  }
  return [...document.querySelectorAll('.likec4-view')].map(h => [h.id, h.__e2eMark, h.shadowRoot?.__e2eMark])
})

/** Zooms and pans the diagram of a host; returns the resulting viewport transform. */
async function zoomPan(vs, frame, hostId) {
  const off = await frameOffset(frame)
  await frame.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'center' }), hostId)
  await sleep(300)
  const r = await frame.evaluate(id => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } }, hostId)
  const cx = off.x + r.x + r.w / 2, cy = off.y + r.y + r.h / 2
  await vs.page.mouse.move(cx, cy)
  await vs.page.keyboard.down('Control')
  await vs.page.mouse.wheel(0, -250)
  await vs.page.keyboard.up('Control')
  await sleep(400)
  await vs.page.mouse.move(cx + 2, cy + 2)
  await vs.page.mouse.down()
  await vs.page.mouse.move(cx + 60, cy + 30, { steps: 8 })
  await vs.page.mouse.up()
  await sleep(700) // viewport saver is throttled (250 ms)
  return (await hostsInfo(frame))[hostId].viewport
}

/** The preview frame that is currently shown (VS Code swaps a pending frame in on reload). */
async function activeFrames(page) {
  const res = []
  for (const f of page.frames()) {
    if (f.isDetached()) continue
    try {
      if (!(await f.evaluate(() => !!document.querySelector('.markdown-body')))) continue
      const parent = f.parentFrame()
      const el = parent ? await parent.evaluate(() => {
        // the inner content frame lives in the webview host page; report which host iframe is active
        return document.getElementById('active-frame') ? 'host' : 'none'
      }).catch(() => 'n/a') : 'n/a'
      const visible = await f.evaluate(() => document.visibilityState).catch(() => 'n/a')
      res.push({ f, parent: el, visible })
    } catch {}
  }
  return res
}

async function scenario(name, fn) {
  if (only.length && !only.includes(name)) return
  const t0 = Date.now()
  try {
    results[name] = { ok: true, ...(await fn()) }
  } catch (e) {
    results[name] = { ok: false, error: String(e?.stack ?? e).slice(0, 1500) }
  }
  results[name].ms = Date.now() - t0
  console.log(`${results[name].ok ? '✓' : '✗'} ${name} (${results[name].ms} ms)${results[name].ok ? '' : `\n  ${results[name].error.split('\n')[0]}`}`)
}

// ---------------------------------------------------------------------------------------------

await scenario('E1-E2-E3-E4-E5', async () => {
  const ws = makeWorkspace()
  const vs = await launch({ workspace: ws })
  const r = {}
  try {
    const md = join(ws, 'docs/sample.md')
    const c4 = join(ws, 'shop/model.c4')
    const tOpen = Date.now()
    await vs.do({ op: 'preview', file: md })
    let { frame, info } = await waitRendered(vs.page, { count: 4 })
    r.E1 = { firstRenderMs: Date.now() - tOpen, hosts: Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { nodes: v.nodes, edges: v.edges, height: v.height, scheme: v.scheme }])) }
    check(Object.values(info).every(v => v.nodes > 0), 'E1: all 4 views rendered')
    await sleep(800)
    await shot(vs, 'E1-four-views')

    // ---- E2: zoom/pan, then edit markdown body (not the block) -> same host, viewport kept
    const first = Object.keys(info)[0]
    const vp = await zoomPan(vs, frame, first)
    const marks = await markHosts(frame)
    await vs.do({ op: 'replace', file: md, find: 'Intro paragraph.', replace: 'Intro paragraph (edited).' })
    await sleep(1500)
    const f2 = await previewFrame(vs.page)
    const marks2 = await f2.evaluate(() => [...document.querySelectorAll('.likec4-view')].map(h => [h.id, h.__e2eMark, h.shadowRoot?.__e2eMark]))
    const info2 = await hostsInfo(f2)
    const bodyText = await f2.evaluate(() => document.querySelector('.markdown-body').textContent)
    r.E2 = { sameFrame: f2 === frame, viewportBefore: vp, viewportAfter: info2[first].viewport, marksKept: JSON.stringify(marks) === JSON.stringify(marks2) }
    check(bodyText.includes('Intro paragraph (edited).'), 'E2: body updated')
    check(r.E2.sameFrame && r.E2.marksKept, 'E2: hosts and shadow roots kept (no reload)')
    check(info2[first].viewport === vp, 'E2: viewport kept')
    await shot(vs, 'E2-after-md-edit')

    // ---- E3 (+P1c): unsaved .c4 edit -> forced reload, viewport restored, no blank/fit frame
    frame = f2
    const latencies = []
    const visibleLat = []
    let sampleLog = []
    for (let i = 1; i <= 10; i++) {
      const vpBefore = (await hostsInfo(frame))[first].viewport
      const title = `Customer v${i}`
      const t0 = Date.now()
      await vs.do({ op: 'replace', file: c4, find: i === 1 ? "'Customer'" : `'Customer v${i - 1}'`, replace: `'${title}'` })
      // sample the *active* preview frame until the interactive diagram shows the new title
      let done = false
      let tVisible = null
      const samples = []
      while (!done && Date.now() - t0 < 10000) {
        for (const f of vs.page.frames()) {
          if (f.isDetached()) continue
          const role = await f.frameElement().then(e => e.getAttribute('id')).catch(() => null)
          if (role !== 'active-frame') continue
          const s = await f.evaluate(id => {
            const h = document.getElementById(id)
            if (!h) return null
            const inner = h.shadowRoot?.querySelector('.likec4-view')?.shadowRoot
            const nodes = inner ? [...inner.querySelectorAll('.react-flow__node')] : []
            const svg = h.shadowRoot ? null : h.querySelector(':scope > svg.likec4-static')
            return { nodes: nodes.length, text: nodes.map(n => n.textContent).join('|').slice(0, 300), svgText: svg?.textContent?.slice(0, 300) ?? '', svgViewBox: svg?.getAttribute('viewBox') ?? null, vp: inner?.querySelector('.react-flow__viewport')?.style.transform ?? null }
          }, first).catch(() => null)
          if (!s) continue
          const visible = s.text.includes(title) || s.svgText.includes(title)
          if (visible && tVisible === null) tVisible = Date.now() - t0
          samples.push({ t: Date.now() - t0, nodes: s.nodes, static: !!s.svgText, visible, vp: s.vp, svgViewBox: s.svgViewBox })
          if (s.text.includes(title)) done = true
        }
        if (!done) await sleep(25)
      }
      visibleLat.push(tVisible ?? Infinity)
      const latency = Date.now() - t0
      latencies.push(latency)
      check(done, `E3: title "${title}" appeared`)
      frame = await previewFrame(vs.page)
      await sleep(400)
      const vpAfter = (await hostsInfo(frame))[first].viewport
      sampleLog.push({ i, latency, vpBefore, vpAfter, samples: samples.slice(-12) })
      check(vpAfter === vpBefore, `E3: viewport restored (${vpBefore} -> ${vpAfter})`)
      if (i === 1) await shot(vs, 'E3-after-c4-edit')
    }
    const sorted = [...latencies].sort((a, b) => a - b)
    const vs2 = [...visibleLat].sort((a, b) => a - b)
    r.E3 = {
      interactive: { latencies, p50: sorted[4], p95: sorted[9] },
      visible: { latencies: visibleLat, p50: vs2[4], p95: vs2[9] },
      note: 'from the edit (incl. 250 ms debounce) until the active preview frame shows the new title',
      samples: sampleLog.slice(0, 3),
    }

    // ---- P1c: screenshot sampling around a reload for the visible first view (no blank frames)
    const clip = await (async () => {
      const off = await frameOffset(frame)
      const b = await frame.evaluate(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 400) } }, first)
      return { x: off.x + b.x, y: off.y + b.y, width: b.w, height: b.h }
    })()
    const shots = []
    const tP = Date.now()
    await vs.do({ op: 'replace', file: c4, find: "'Customer v10'", replace: "'Customer final'" })
    while (Date.now() - tP < 2000) {
      const buf = await vs.page.screenshot({ clip })
      shots.push({ t: Date.now() - tP, buf })
    }
    // a "blank" frame = nearly uniform image (all diagram nodes missing); estimate via PNG size
    const sizes = shots.map(s => s.buf.length)
    const minSize = Math.min(...sizes), maxSize = Math.max(...sizes)
    shots.forEach((s, i) => { if (i % 3 === 0) writeFileSync(join(out, `P1c-${String(i).padStart(2, '0')}-${s.t}ms.png`), s.buf) })
    r.P1c = { samples: shots.length, pngSizes: sizes, minSize, maxSize, blankSuspect: minSize < maxSize * 0.5 }

    // ---- E4: syntax error -> stale notice, last view kept; fix -> notice gone
    frame = await previewFrame(vs.page)
    await vs.do({ op: 'replace', file: c4, find: "'Customer final'", replace: "'Customer final' {{{ broken" })
    let res = await waitRendered(vs.page, { accept: i => i[first].notices.some(n => n.startsWith('warning')) })
    r.E4 = { staleNotice: res.info[first].notices, nodesWhileStale: res.info[first].nodes }
    check(res.info[first].nodes > 0, 'E4: last view still rendered')
    await sleep(500)
    await shot(vs, 'E4-stale')
    await vs.do({ op: 'replace', file: c4, find: "'Customer final' {{{ broken", replace: "'Customer fixed'" })
    res = await waitRendered(vs.page, { accept: i => i[first].notices.length === 0 && i[first].titles.some(t => t.includes('Customer fixed')) })
    r.E4.afterFix = res.info[first].notices

    // ---- E5: unknown view id in the block -> error; back -> rendered
    await vs.do({ op: 'replace', file: md, find: 'project=shop\nindex\n', replace: 'project=shop\nindexx\n' })
    res = await waitRendered(vs.page, { accept: i => Object.values(i)[0].notices.some(n => n.startsWith('error')) })
    r.E5 = { error: Object.values(res.info)[0].notices }
    await sleep(300)
    await shot(vs, 'E5-unknown-view')
    await vs.do({ op: 'replace', file: md, find: 'project=shop\nindexx\n', replace: 'project=shop\nindex\n' })
    res = await waitRendered(vs.page, { accept: i => Object.values(i)[0].nodes > 0 })
    r.E5.restoredNodes = Object.values(res.info)[0].nodes
    r.console = vs.console.filter(c => !/ERR_NETWORK|Failed to fetch|gallery|marketplace/i.test(c)).slice(0, 10)
  } finally {
    await vs.close()
  }
  return r
})

await scenario('E6-theme', async () => {
  const ws = makeWorkspace()
  const vs = await launch({ workspace: ws, theme: 'Default Dark Modern' })
  const r = {}
  try {
    await vs.do({ op: 'preview', file: join(ws, 'docs/sample.md') })
    let { info } = await waitRendered(vs.page, { count: 4 })
    const ids = Object.keys(info)
    const autoId = ids[0], lightId = ids[3]
    r.dark = { auto: info[autoId].scheme, light: info[lightId].scheme }
    check(r.dark.auto === 'dark' && r.dark.light === 'light', `E6 dark theme: ${JSON.stringify(r.dark)}`)
    for (const [theme, expected] of [['Default Light Modern', 'light'], ['Default High Contrast', 'dark'], ['Default High Contrast Light', 'light']]) {
      await vs.do({ op: 'config', key: 'workbench.colorTheme', value: theme })
      const res = await waitRendered(vs.page, { accept: i => i[autoId].scheme === expected, timeoutMs: 20000 })
      r[theme] = { auto: res.info[autoId].scheme, light: res.info[lightId].scheme }
      check(res.info[lightId].scheme === 'light', `E6 ${theme}: fixed light stays light`)
      await sleep(400)
      await shot(vs, `E6-${theme.replace(/\s+/g, '-')}`)
    }
  } finally {
    await vs.close()
  }
  return r
})

await scenario('E9-large', async () => {
  const ws = makeWorkspace()
  const vs = await launch({ workspace: ws })
  const r = {}
  try {
    const t0 = Date.now()
    await vs.do({ op: 'preview', file: join(ws, 'large/docs/architecture.md') })
    const { info } = await waitRendered(vs.page, { count: 10, timeoutMs: 90000 })
    r.firstScreenMs = Date.now() - t0
    r.firstScreen = Object.fromEntries(Object.entries(info).map(([k, v]) => [k.replace(/^likec4-large-[0-9a-f]{6}-/, ''), v.mounted ? v.nodes : 'static']))
    check(Object.values(info).every(v => v.nodes > 0 || (!v.mounted && v.staticSvg)), 'E9: all 10 views shown (interactive or static)')
    await sleep(800)
    await shot(vs, 'E9-large')
    // scroll through the document: every view gets mounted
    const frame = await previewFrame(vs.page)
    for (const id of Object.keys(info)) {
      await frame.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'center' }), id)
      await sleep(250)
    }
    const all = await waitRendered(vs.page, { accept: i => Object.values(i).every(v => v.nodes > 0), timeoutMs: 30000 })
    r.afterScroll = Object.fromEntries(Object.entries(all.info).map(([k, v]) => [k.replace(/^likec4-large-[0-9a-f]{6}-/, ''), v.nodes]))
    await frame.evaluate(() => window.scrollTo(0, 0))
    // latency on the large model
    const c4 = join(ws, 'large/model.c4')
    const lat = []
    for (let i = 1; i <= 10; i++) {
      const tt = Date.now()
      await vs.do({ op: 'replace', file: c4, find: i === 1 ? "'User'" : `'User ${i - 1}'`, replace: `'User ${i}'` })
      await waitRendered(vs.page, { accept: inf => Object.values(inf)[0].titles.some(t => t.startsWith(`User ${i}`)), timeoutMs: 20000 })
      lat.push(Date.now() - tt)
    }
    const s = [...lat].sort((a, b) => a - b)
    r.latency = { lat, p50: s[4], p95: s[9] }
  } finally {
    await vs.close()
  }
  return r
})

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
const failed = Object.values(results).filter(r => !r.ok).length
console.log(`${Object.keys(results).length - failed} passed, ${failed} failed -> ${join(out, 'results.json')}`)
process.exit(failed ? 1 : 0)
