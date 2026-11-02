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
let t = performance.now(); await l.layoutedModel('large'); console.log('first full', Math.round(performance.now() - t))
const f = join(root, 'large/model.c4'), uri = URI.file(f), disk = readFileSync(f, 'utf8')
const times = []
for (let i = 1; i <= 10; i++) {
  s.shared.workspace.TextDocuments.set(TextDocument.create(uri.toString(), 'likec4', i, disk.replace("'S1C1 Component 1'", `'S1C1 Component ${i}x'`)))
  t = performance.now()
  await s.shared.workspace.DocumentBuilder.update([uri], [])
  const m = await l.layoutedModel('large'); JSON.stringify(m.$data)
  times.push(Math.round(performance.now() - t))
}
times.sort((a, b) => a - b); console.log('incremental edit->full model+json ms', times, 'p50', times[4], 'p95', times[9])
await l.dispose()
