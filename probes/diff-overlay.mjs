import { LikeC4 } from '@likec4/language-services/node'
import { WithFileSystem, WithLikeC4ManualLayouts } from '@likec4/language-server/filesystem'
import { createLanguageServices, WithWasmGraphviz } from '@likec4/language-server/module'
import { URI } from 'langium'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const root = resolve('fixtures')
const services = createLanguageServices({ ...WithFileSystem(false), ...WithLikeC4ManualLayouts, ...WithWasmGraphviz })
const wm = services.shared.workspace.WorkspaceManager
const rootUri = URI.file(root).toString() + '/'
wm.initialize({ capabilities: {}, processId: null, rootUri, workspaceFolders: [{ name: 'ws', uri: rootUri }] })
await wm.initialized({})
const l = new LikeC4(services)
const da = JSON.parse(JSON.stringify((await l.layoutedModel('shop')).$data))
const f = join(root, 'shop/model.c4'); const uri = URI.file(f)
services.shared.workspace.TextDocuments.set(TextDocument.create(uri.toString(), 'likec4', 1, '// c\n' + readFileSync(f, 'utf8')))
await services.shared.workspace.DocumentBuilder.update([uri], [])
const db = JSON.parse(JSON.stringify((await l.layoutedModel('shop')).$data))
const diffs = []
function walk(x, y, p) { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === 'object' && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); return } diffs.push(p + ' : ' + JSON.stringify(x)?.slice(0, 60) + ' -> ' + JSON.stringify(y)?.slice(0, 60)) }
walk(da, db, '$'); console.log(diffs.length); console.log(diffs.slice(0, 12).join('\n'))
await l.dispose()
