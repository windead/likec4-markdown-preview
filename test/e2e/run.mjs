// End-to-end scenarios in a real VS Code: E1–E6 (+ P1c, latency). Writes test-results/e2e/.
// Usage: xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs [scenario...]
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frameOffset, hostsInfo, launch, previewFrame, repo, sleep, waitRendered } from './lib.mjs'

const out = join(repo, 'test-results/e2e')
const only = process.argv.slice(2)
// a full run starts from an empty output directory; partial runs merge into results.json
if (only.length === 0) rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const results = existsSync(join(out, 'results.json')) ? JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')) : {}

function makeWorkspace() {
  const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-ws-'))
  cpSync(join(repo, 'fixtures'), ws, { recursive: true })
  // extension log with epoch timestamps (Output Channel content), for latency evidence
  process.env.LIKEC4_MDP_LOG = join(ws, 'extension.log')
  writeFileSync(process.env.LIKEC4_MDP_LOG, '')
  return ws
}

const logLines = ws => readFileSync(join(ws, 'extension.log'), 'utf8').trim().split('\n').filter(Boolean)
  .map(l => ({ t: Number(l.slice(0, l.indexOf(' '))), m: l.slice(l.indexOf(' ') + 1) }))
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
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
    check(Object.values(info).every(v => v.nodes > 0 || (!v.mounted && v.staticSvg)), 'E1: all 4 views shown')
    r.E1.initiallyMounted = Object.values(info).filter(v => v.mounted).length
    await sleep(800)
    await shot(vs, 'E1-four-views')
    // every view mounts when scrolled into view
    for (const id of Object.keys(info)) {
      await frame.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'center' }), id)
      await sleep(300)
    }
    ;({ frame, info } = await waitRendered(vs.page, { accept: i => Object.values(i).every(v => v.nodes > 0) }))
    r.E1.hosts = Object.fromEntries(Object.entries(info).map(([k, v]) => [k, { nodes: v.nodes, edges: v.edges, height: v.height, scheme: v.scheme }]))
    await frame.evaluate(() => window.scrollTo(0, 0))
    await sleep(500)

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

    // ---- E3: unsaved .c4 edits -> forced reload; viewport restored; latency from timestamps
    frame = f2
    const rows = []
    for (let i = 1; i <= 10; i++) {
      const vpBefore = (await hostsInfo(frame))[first].viewport
      const title = `Customer v${i}`
      const tEdit = Date.now()
      await vs.do({ op: 'replace', file: c4, find: i === 1 ? "'Customer'" : `'Customer v${i - 1}'`, replace: `'${title}'` })
      const res = await waitRendered(vs.page, { accept: inf => inf[first]?.titles.some(t => t.includes(title)), timeoutMs: 15000 })
      frame = res.frame
      await sleep(300)
      const page = await frame.evaluate(() => ({ origin: performance.timeOrigin, marks: window.__likec4.marks, restores: window.__likec4.restores ?? [] }))
      const lines = logLines(ws).filter(l => l.t >= tEdit)
      const push = lines.find(l => l.m.startsWith('[edit]'))?.t
      const refresh = lines.find(l => l.m.startsWith('[refresh]'))?.t
      const layout = lines.find(l => l.m.startsWith('[layout] shop'))?.t
      const vpAfter = (await hostsInfo(frame))[first].viewport
      check(vpAfter === vpBefore, `E3: viewport restored (${vpBefore} -> ${vpAfter})`)
      rows.push({
        i,
        debounceMs: push - tEdit,
        extensionMs: refresh - push,
        recomputeMs: layout - push,
        navigationMs: Math.round(page.origin - push),
        snapshotVisibleMs: Math.round(page.origin + page.marks.snapshotsPositioned - push),
        interactiveMs: Math.round(page.origin + page.marks.interactiveFrame - push),
        restoreRetries: page.restores.find(r => r.hostId === first)?.retries ?? null,
      })
      if (i === 1) await shot(vs, 'E3-after-c4-edit')
    }
    const col = k => rows.map(r => r[k])
    r.E3 = {
      note: 'all times from the overlay push (debounce excluded); extension = push -> markdown.preview.refresh',
      rows,
      extension: { p50: pct(col('extensionMs'), 50), p95: pct(col('extensionMs'), 95) },
      snapshotVisible: { p50: pct(col('snapshotVisibleMs'), 50), p95: pct(col('snapshotVisibleMs'), 95) },
      interactive: { p50: pct(col('interactiveMs'), 50), p95: pct(col('interactiveMs'), 95) },
      restoreRetries: col('restoreRetries'),
    }
    check(r.E3.extension.p95 <= 200, `E3: extension segment P95 <= 200 ms (${r.E3.extension.p95})`)
    check(r.E3.snapshotVisible.p95 <= 1500, `E3: snapshot visible P95 <= 1.5 s (${r.E3.snapshotVisible.p95})`)

    // ---- E4: syntax error -> stale notice, last view kept; fix -> notice gone
    frame = await previewFrame(vs.page)
    await vs.do({ op: 'replace', file: c4, find: "'Customer v10'", replace: "'Customer final' {{{ broken" })
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

// P1c: per-frame trace of the visible hosts across a forced reload (recorded in the page).
await scenario('P1c', async () => {
  const ws = makeWorkspace()
  const vs = await launch({ workspace: ws, settings: { 'likec4MarkdownPreview.maxHeight': 300 } })
  const r = {}
  const parseT = t => { const m = t?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/); return m ? { x: +m[1], y: +m[2], zoom: +m[3] } : null }
  const parseVB = v => { const a = v?.split(' ').map(Number); return a?.length === 4 ? a : null }
  /** Checks one host's trace: never blank; snapshot geometry == interactive geometry; no jump. */
  function analyse(trace, id, frameSize) {
    const frames = trace.map(f => ({ t: f.t, h: f.hosts.find(h => h.id === id) })).filter(f => f.h)
    const blank = frames.filter(f => f.h.shows === 'nothing')
    const snaps = frames.filter(f => f.h.shows === 'snapshot').map(f => parseVB(f.h.viewBox))
    const inter = frames.filter(f => f.h.shows === 'interactive').map(f => parseT(f.h.transform))
    const transforms = [...new Set(frames.filter(f => f.h.shows === 'interactive').map(f => f.h.transform))]
    let snapshotVsInteractive = null
    if (snaps.length && inter.length) {
      const [vx, vy, vw] = snaps.at(-1)
      const t = inter[0]
      const zoom = frameSize.w / vw
      snapshotVsInteractive = { dx: Math.abs(-vx * zoom - t.x), dy: Math.abs(-vy * zoom - t.y), dzoom: Math.abs(zoom - t.zoom) }
    }
    return { frames: frames.length, blankFrames: blank.length, snapshotFrames: snaps.length, interactiveFrames: inter.length, distinctInteractiveTransforms: transforms, snapshotVsInteractive }
  }
  try {
    await vs.do({ op: 'preview', file: join(ws, 'docs/sample.md') })
    let { frame, info } = await waitRendered(vs.page, { count: 4 })
    const [idA, idB] = Object.keys(info)
    // case A: user zoomed/panned view A; case B: view B untouched
    await zoomPan(vs, frame, idA)
    await frame.evaluate(() => window.scrollTo(0, 0))
    await sleep(300)
    const sizeOf = async (fr, id) => fr.evaluate(id => { const f = document.getElementById(id).shadowRoot.querySelector('[data-likec4-frame]').getBoundingClientRect(); return { w: f.width, h: f.height } }, id)
    const sizeA = await sizeOf(frame, idA), sizeB = await sizeOf(frame, idB)
    const vpA = parseT((await hostsInfo(frame))[idA].viewport)
    await frame.evaluate(() => sessionStorage.setItem('likec4-trace', '1'))
    const c4 = join(ws, 'shop/model.c4')
    await vs.do({ op: 'replace', file: c4, find: "'Customer'", replace: "'Customer A'" })
    let res = await waitRendered(vs.page, { accept: i => i[idA]?.titles.some(t => t.includes('Customer A')) && i[idB]?.nodes > 0 })
    await sleep(4200)
    let trace = await res.frame.evaluate(() => window.__likec4.trace)
    r.caseA_saved = analyse(trace, idA, sizeA)
    r.caseA_saved.expected = vpA
    r.caseB_untouched = analyse(trace, idB, sizeB)
    // case C: saved viewport no longer shows the view -> both snapshot and diagram fit
    frame = res.frame
    const docKey = await frame.evaluate(() => JSON.parse(document.getElementById('vscode-markdown-preview-data').getAttribute('data-settings')).source)
    await frame.evaluate(([k, id]) => {
      sessionStorage.setItem(`likec4vp|${k}|${id}`, JSON.stringify({ x: -9000, y: -9000, zoom: 1, w: 400, h: 300 }))
      sessionStorage.setItem('likec4-trace', '1')
    }, [docKey, idB])
    await vs.do({ op: 'replace', file: c4, find: "'Customer A'", replace: "'Customer C'" })
    res = await waitRendered(vs.page, { accept: i => i[idA]?.titles.some(t => t.includes('Customer C')) && i[idB]?.nodes > 0 })
    await sleep(4200)
    trace = await res.frame.evaluate(() => window.__likec4.trace)
    r.caseC_outOfView = analyse(trace, idB, sizeB)
    r.caseC_outOfView.finalTransform = (await hostsInfo(res.frame))[idB].viewport
    for (const [k, c] of Object.entries({ A: r.caseA_saved, B: r.caseB_untouched, C: r.caseC_outOfView })) {
      check(c.frames > 0 && c.blankFrames === 0, `P1c ${k}: no blank frame (${JSON.stringify(c)})`)
      check(c.interactiveFrames > 0, `P1c ${k}: interactive diagram shown`)
      check(c.distinctInteractiveTransforms.length === 1, `P1c ${k}: no jump after mount (${c.distinctInteractiveTransforms})`)
      if (c.snapshotVsInteractive) check(c.snapshotVsInteractive.dx <= 2 && c.snapshotVsInteractive.dy <= 2 && c.snapshotVsInteractive.dzoom < 0.01, `P1c ${k}: snapshot matches diagram (${JSON.stringify(c.snapshotVsInteractive)})`)
    }
    const tA = parseT(r.caseA_saved.distinctInteractiveTransforms[0])
    check(Math.abs(tA.x - vpA.x) <= 1 && Math.abs(tA.zoom - vpA.zoom) < 1e-3, 'P1c A: saved viewport restored')
    check(!/^translate\(-9000px/.test(r.caseC_outOfView.finalTransform ?? ''), 'P1c C: unusable saved viewport replaced by fit')
  } finally {
    await vs.close()
  }
  return r
})

await scenario('E6-theme', async () => {
  const ws = makeWorkspace()
  const vs = await launch({ workspace: ws, theme: 'Default Dark Modern', settings: { 'likec4MarkdownPreview.maxHeight': 250 } })
  const r = {}
  try {
    await vs.do({ op: 'preview', file: join(ws, 'docs/sample.md') })
    let { info } = await waitRendered(vs.page, { count: 4, accept: i => Object.values(i).every(v => v.nodes > 0) })
    const ids = Object.keys(info)
    const autoId = ids[0], lightId = ids[3]
    r.dark = { auto: info[autoId].scheme, light: info[lightId].scheme }
    check(r.dark.auto === 'dark' && r.dark.light === 'light', `E6 dark theme: ${JSON.stringify(r.dark)}`)
    await sleep(400)
    await shot(vs, 'E6-Default-Dark-Modern')
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

await scenario('E7-coexist', async () => {
  const ws = makeWorkspace()
  const extDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-ext-'))
  cpSync(join(repo, '.vscode-test/e7-extensions'), extDir, { recursive: true })
  const vs = await launch({ workspace: ws, extensionsDir: extDir })
  const r = {}
  try {
    await vs.do({ op: 'preview', file: join(ws, 'docs/coexist.md') })
    const { frame, info } = await waitRendered(vs.page, { count: 1 })
    r.likec4Nodes = Object.values(info)[0].nodes
    // mermaid renders asynchronously into an <svg>
    let mermaidSvg = false
    for (let i = 0; i < 40 && !mermaidSvg; i++) {
      mermaidSvg = await frame.evaluate(() => !!document.querySelector('.mermaid svg, [class*=mermaid] svg')).catch(() => false)
      if (!mermaidSvg) await sleep(250)
    }
    r.mermaidSvg = mermaidSvg
    r.extensions = await vs.do({ op: 'extensions' })
    // diagnostics: break the model (unsaved) -> only the official extension reports, once
    const c4 = join(ws, 'shop/model.c4')
    await vs.do({ op: 'open', file: c4 })
    await sleep(4000) // official language server start
    await vs.do({ op: 'replace', file: c4, find: "'Customer'", replace: "'Customer' {{{" })
    let diags = []
    for (let i = 0; i < 40; i++) {
      diags = (await vs.do({ op: 'diagnostics' })).filter(d => d.file.endsWith(join('shop', 'model.c4')))
      if (diags.some(d => d.count > 0)) break
      await sleep(250)
    }
    r.diagnostics = diags
    await vs.do({ op: 'preview', file: join(ws, 'docs/coexist.md') })
    const stale = await waitRendered(vs.page, { accept: i => Object.values(i)[0].notices.some(n => n.startsWith('warning')), timeoutMs: 20000 })
    r.staleWhileOfficialActive = Object.values(stale.info)[0].notices
    await vs.do({ op: 'replace', file: c4, find: "'Customer' {{{", replace: "'Customer'" })
    await sleep(1500)
    await shot(vs, 'E7-coexist')
    // official preview panel of the same view, for visual comparison with E1
    try {
      await vs.do({ op: 'command', command: 'likec4.open-preview', args: ['index', 'shop'] })
      await sleep(5000)
      await shot(vs, 'E7-official-preview-panel')
      r.officialPreview = true
    } catch (e) {
      r.officialPreview = String(e).slice(0, 200)
    }
    const ours = r.extensions.find(e => e.id === 'windead.likec4-markdown-preview')
    const official = r.extensions.find(e => e.id === 'likec4.likec4-vscode')
    check(ours?.active, 'E7: our extension active')
    check(official?.active, 'E7: official LikeC4 extension active')
    check(r.likec4Nodes > 0, 'E7: LikeC4 view rendered')
    check(r.mermaidSvg, 'E7: Mermaid diagram rendered')
    const sources = new Set(diags.flatMap(d => d.sources))
    check(diags.length === 1 && diags[0].count > 0, `E7: diagnostics reported once (${JSON.stringify(diags)})`)
    r.diagnosticSources = [...sources]
  } finally {
    await vs.close()
  }
  return r
})

writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2))
const failed = Object.values(results).filter(r => !r.ok).length
console.log(`${Object.keys(results).length - failed} passed, ${failed} failed -> ${join(out, 'results.json')}`)
process.exit(failed ? 1 : 0)
