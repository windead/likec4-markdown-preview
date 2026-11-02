// Helpers to drive a real VS Code (Electron) with Playwright for end-to-end checks.
import { _electron as electron } from 'playwright-core'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const repo = resolve(new URL('../..', import.meta.url).pathname)

export async function vscodeBinary() {
  if (process.env.VSCODE_BIN) return process.env.VSCODE_BIN
  return downloadAndUnzipVSCode({ version: process.env.VSCODE_VERSION ?? '1.144.0', cachePath: join(repo, '.vscode-test') })
}

/**
 * Launches VS Code with this extension under development.
 * @param {{ workspace: string, files?: string[], settings?: object, extensionsDir?: string, theme?: string, dev?: boolean }} o
 */
export async function launch(o) {
  const tmp = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-e2e-'))
  const userDir = join(tmp, 'user')
  mkdirSync(join(userDir, 'User'), { recursive: true })
  writeFileSync(join(userDir, 'User', 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.colorTheme': o.theme ?? 'Default Dark Modern',
    'git.openRepositoryInParentFolders': 'never',
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'chat.commandCenter.enabled': false,
    'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'security.workspace.trust.enabled': false,
    'window.restoreWindows': 'none',
    ...o.settings,
  }, null, 2))
  const args = [
    o.workspace,
    ...(o.files ?? []),
    ...(o.dev === false ? [] : [`--extensionDevelopmentPath=${repo}`]),
    `--extensionDevelopmentPath=${join(repo, 'test/e2e/driver')}`,
    `--user-data-dir=${userDir}`,
    `--extensions-dir=${o.extensionsDir ?? join(tmp, 'ext')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--no-sandbox',
  ]
  const driverDir = join(tmp, 'driver')
  const app = await electron.launch({ executablePath: await vscodeBinary(), args, timeout: 90000, env: { ...process.env, LIKEC4_E2E_DIR: driverDir } })
  const page = await app.firstWindow()
  const console = []
  page.on('console', m => {
    if (m.type() === 'error') console.push(m.text().slice(0, 400))
  })
  await page.waitForSelector('.monaco-workbench', { timeout: 60000 })
  for (let i = 0; i < 300 && !existsSync(join(driverDir, 'ready')); i++) await sleep(100)
  let seq = 0
  /** Sends a request to the driver extension and waits for its result. */
  const request = async (req, timeoutMs = 30000) => {
    const id = `${Date.now()}-${++seq}`
    writeFileSync(join(driverDir, `req-${id}.json`), JSON.stringify(req))
    const resFile = join(driverDir, `res-${id}.json`)
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (existsSync(resFile)) {
        const res = JSON.parse(readFileSync(resFile, 'utf8'))
        if (!res.ok) throw new Error(`driver ${req.op} failed: ${res.error}`)
        return res.value
      }
      await sleep(50)
    }
    throw new Error(`driver ${req.op} timed out`)
  }
  return { app, page, console, tmp, userDir, do: request, close: () => app.close().catch(() => {}) }
}

/** Runs a command through the command palette. */
export async function runCommand(page, label) {
  await page.locator('.monaco-workbench').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {})
  await page.keyboard.press('F1')
  await page.locator('.quick-input-widget input').waitFor({ state: 'visible', timeout: 10000 })
  await page.keyboard.type('>' === label[0] ? label.slice(1) : label)
  await sleep(400)
  await page.keyboard.press('Enter')
  await sleep(300)
}

/** Opens a file via Quick Open. */
export async function openFile(page, relPath) {
  await page.keyboard.press('Control+P')
  await page.locator('.quick-input-widget input').waitFor({ state: 'visible', timeout: 10000 })
  await page.keyboard.type(relPath)
  await sleep(600)
  await page.keyboard.press('Enter')
  await sleep(500)
}

/** Finds the frame of the Markdown preview that contains `.likec4-view` hosts. */
export async function previewFrame(page, { timeoutMs = 60000, exclude } = {}) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    for (const f of page.frames()) {
      if (f === exclude || f.isDetached()) continue
      try {
        if (await f.evaluate(() => !!document.querySelector('.markdown-body .likec4-view'))) return f
      } catch {}
    }
    await sleep(250)
  }
  throw new Error('Markdown preview with likec4-view hosts not found')
}

/** Per-host summary read from inside the shadow roots. */
export function hostsInfo(frame) {
  return frame.evaluate(() => {
    const out = {}
    for (const host of document.querySelectorAll('.likec4-view')) {
      const sr = host.shadowRoot
      const inner = sr?.querySelector('.likec4-view')?.shadowRoot ?? null
      const notices = [...(sr?.querySelectorAll('[data-likec4-notice]') ?? [])].map(n => `${n.getAttribute('data-likec4-notice')}: ${n.textContent}`)
      const vp = inner?.querySelector('.react-flow__viewport')?.style.transform ?? null
      const rect = host.getBoundingClientRect()
      out[host.id] = {
        nodes: inner ? inner.querySelectorAll('.react-flow__node').length : 0,
        edges: inner ? inner.querySelectorAll('.react-flow__edge').length : 0,
        titles: inner ? [...inner.querySelectorAll('.react-flow__node')].map(n => n.textContent.trim().slice(0, 40)) : [],
        notices,
        viewport: vp,
        scheme: inner?.querySelector('[data-mantine-color-scheme]')?.getAttribute('data-mantine-color-scheme') ?? null,
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        state: JSON.parse(host.querySelector(':scope > script')?.textContent ?? '{}').state,
      }
    }
    return out
  })
}

/**
 * Waits until every host in the (current) preview frame is rendered (nodes > 0) or shows an error.
 * The preview may reload (new frame) meanwhile, so the frame is looked up again each time.
 * @returns {{ frame, info }}
 */
export async function waitRendered(page, { timeoutMs = 60000, count, accept } = {}) {
  const end = Date.now() + timeoutMs
  let info
  while (Date.now() < end) {
    const frame = await previewFrame(page, { timeoutMs: Math.max(1000, end - Date.now()) })
    info = await hostsInfo(frame).catch(() => null)
    if (info) {
      const vals = Object.values(info)
      const done = vals.length > 0 && (count === undefined || vals.length >= count)
        && vals.every(v => v.state !== 'loading' && (v.nodes > 0 || v.notices.some(n => n.startsWith('error'))))
        && (!accept || accept(info))
      if (done) return { frame, info }
    }
    await sleep(200)
  }
  throw new Error(`hosts not rendered in time: ${JSON.stringify(info)}`)
}

/** Page coordinates of an element rect inside a frame. */
export async function frameOffset(frame) {
  const b = await (await frame.frameElement()).boundingBox()
  return { x: b.x, y: b.y }
}
