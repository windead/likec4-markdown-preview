// Repeated single-edit recomputes in plain Node (no VS Code load): LikeC4 layout time distribution.
import { LikeC4 } from '@likec4/language-services/node'
import { WithFileSystem, WithLikeC4ManualLayouts } from '@likec4/language-server/filesystem'
import { createLanguageServices, WithWasmGraphviz } from '@likec4/language-server/module'
import { URI } from 'langium'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve('fixtures')
const s = createLanguageServices({ ...WithFileSystem(false), ...WithLikeC4ManualLayouts, ...WithWasmGraphviz })
const wm = s.shared.workspace.WorkspaceManager, rootUri = URI.file(root).toString() + '/'
wm.initialize({ capabilities: {}, processId: null, rootUri, workspaceFolders: [{ name: 'ws', uri: rootUri }] }); await wm.initialized({})
const l = new LikeC4(s)
await l.layoutedModel('shop')
const f = join(root, 'shop/model.c4'), uri = URI.file(f), disk = readFileSync(f, 'utf8')
const t = []
for (let i = 1; i <= 40; i++) {
  s.shared.workspace.TextDocuments.set(TextDocument.create(uri.toString(), 'likec4', i, disk.replace("'Customer'", `'Customer v${i}'`)))
  const t0 = performance.now()
  await s.shared.workspace.DocumentBuilder.update([uri], [])
  const m = await l.layoutedModel('shop'); JSON.stringify(m.$data)
  t.push(Math.round(performance.now() - t0))
}
t.sort((a, b) => a - b); console.log('edit->layout ms', t.join(' '), '| p50', t[19], 'p95', t[37])
await l.dispose()
