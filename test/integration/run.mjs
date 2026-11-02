// Runs the integration suite inside a real VS Code (extension host) on a temp copy of fixtures/.
import { runTests } from '@vscode/test-electron'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repo = resolve(new URL('../..', import.meta.url).pathname)
const ws = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'likec4-it-'))
cpSync(join(repo, 'fixtures'), ws, { recursive: true })
let code = 0
try {
  await runTests({
    version: process.env.VSCODE_VERSION ?? '1.144.0',
    cachePath: join(repo, '.vscode-test'),
    extensionDevelopmentPath: repo,
    extensionTestsPath: join(repo, 'test/integration/suite.cjs'),
    launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--disable-gpu', '--no-sandbox', `--user-data-dir=${join(ws, '.user')}`],
    extensionTestsEnv: { LIKEC4_IT_WS: ws },
  })
} catch (e) {
  console.error(e)
  code = 1
} finally {
  rmSync(ws, { recursive: true, force: true })
}
process.exit(code)
