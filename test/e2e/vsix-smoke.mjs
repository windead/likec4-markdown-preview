// Installs nothing itself: runs VS Code with an extensions dir that contains the installed VSIX
// (no --extensionDevelopmentPath for this extension) and checks that views render.
// Usage: node test/e2e/vsix-smoke.mjs <extensions-dir>
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launch, repo, sleep, waitRendered } from './lib.mjs'

const extDir = resolve(process.argv[2])
const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-vsix-'))
cpSync(join(repo, 'fixtures'), ws, { recursive: true })
const tmpExt = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-vsix-ext-'))
cpSync(extDir, tmpExt, { recursive: true })
const vs = await launch({ workspace: ws, extensionsDir: tmpExt, dev: false })
let ok = false
try {
  const exts = await vs.do({ op: 'extensions' })
  console.log('installed:', exts.filter(e => e.id.includes('likec4')).map(e => `${e.id} active=${e.active}`).join(', '))
  await vs.do({ op: 'preview', file: join(ws, 'docs/sample.md') })
  const { info } = await waitRendered(vs.page, { count: 4 })
  console.log(Object.entries(info).map(([k, v]) => `${k}: ${v.mounted ? `${v.nodes} nodes` : 'snapshot'}`).join('\n'))
  ok = Object.values(info).every(v => v.nodes > 0 || v.staticSvg)
  await sleep(800)
  mkdirSync(join(repo, 'test-results/e2e'), { recursive: true })
  await vs.page.screenshot({ path: join(repo, 'test-results/e2e/vsix-installed.png') })
} finally {
  await vs.close()
}
console.log(ok ? 'VSIX smoke: OK' : 'VSIX smoke: FAILED')
process.exit(ok ? 0 : 1)
