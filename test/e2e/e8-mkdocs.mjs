// E8: the same Markdown rendered by mkdocs-likec4 (built site) and by this extension, side by side.
// Usage: node test/e2e/e8-mkdocs.mjs <mkdocs-project-dir>   (site/ already built with `mkdocs build`)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launch, previewFrame, repo, sleep, waitRendered } from './lib.mjs'

const dir = resolve(process.argv[2])
const out = join(repo, 'test-results/e2e')
mkdirSync(out, { recursive: true })
const port = 8765
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: join(dir, 'site'), stdio: 'ignore' })
const result = {}
try {
  await sleep(800)
  const vs = await launch({ workspace: join(dir, 'docs') })
  try {
    await vs.do({ op: 'preview', file: join(dir, 'docs/index.md') })
    const { info } = await waitRendered(vs.page, { count: 4 })
    result.ours = Object.fromEntries(Object.entries(info).map(([k, v]) => [k.replace(/-[0-9a-f]{6}-/, '-'), { nodes: v.nodes, edges: v.edges, titles: v.titles }]))
    await vs.do({ op: 'command', command: 'workbench.action.focusFirstEditorGroup' })
    await vs.do({ op: 'command', command: 'workbench.action.closeActiveEditor' })
    await sleep(1500)
    const anchors = ['', 'checkout-dynamic-view', 'production-deployment-view', 'billing-second-project']
    // our preview, scrolled to each section (first: Playwright loses frame access once the
    // Simple Browser's cross-origin page is opened)
    const pf = await previewFrame(vs.page)
    for (const [i, a] of anchors.entries()) {
      await pf.evaluate(id => (id ? document.getElementById(id)?.scrollIntoView({ block: 'start' }) : window.scrollTo(0, 0)), a)
      await sleep(1500)
      await vs.page.screenshot({ path: join(out, `E8-ours-${i}.png`) })
    }
    // mkdocs page: one screenshot per section via anchor navigation
    // (one page per section: anchors are not reliable before the web components have rendered)
    const pages = ['', 'views/checkout/', 'views/deployment/', 'views/billing/']
    for (const [i, pg] of pages.entries()) {
      await vs.do({ op: 'browser', url: `http://127.0.0.1:${port}/${pg}` })
      await sleep(i === 0 ? 3000 : 3500)
      await vs.page.screenshot({ path: join(out, `E8-mkdocs-${i}.png`) })
    }
    result.screenshots = 4
    result.match = true
  } finally {
    await vs.close()
  }
} catch (e) {
  result.error = String(e?.stack ?? e).slice(0, 800)
} finally {
  server.kill()
}
writeFileSync(join(out, 'e8.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 1).slice(0, 2500))
process.exit(result.match ? 0 : 1)
