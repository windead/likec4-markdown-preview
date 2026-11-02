// P2: sync unsaved (in-memory) text into LikeC4 via public APIs only.
// Usage: node probes/p2-unsaved.mjs <workspace>
import { LikeC4 } from '@likec4/language-services/node'
import { WithFileSystem, WithLikeC4ManualLayouts } from '@likec4/language-server/filesystem'
import { createLanguageServices, WithWasmGraphviz } from '@likec4/language-server/module'
import { URI } from 'langium'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(process.argv[2] ?? 'fixtures')
const t = () => performance.now()

const services = createLanguageServices({
  ...WithFileSystem(false),
  ...WithLikeC4ManualLayouts,
  ...WithWasmGraphviz,
})
const wm = services.shared.workspace.WorkspaceManager
const rootUri = URI.file(root).toString() + '/'
wm.initialize({ capabilities: {}, processId: null, rootUri, workspaceFolders: [{ name: 'ws', uri: rootUri }] })
await wm.initialized({})

const likec4 = new LikeC4(services)
const textDocs = services.shared.workspace.TextDocuments
const builder = services.shared.workspace.DocumentBuilder
console.log('projects', likec4.projects(), 'textDocs', textDocs?.constructor?.name)

const updates = []
likec4.onModelUpdate(p => updates.push({ p, at: t() }))

const projectId = 'shop'
async function customerTitle() {
  const r = await likec4.viewsService.layoutView({ viewId: 'index', projectId })
  return r?.diagram.nodes.find(n => n.id === 'customer')?.title ?? null
}

const file = join(root, 'shop/model.c4')
const uri = URI.file(file)
const disk = readFileSync(file, 'utf8')

async function setOverlay(text, version) {
  textDocs.set(TextDocument.create(uri.toString(), 'likec4', version, text))
  const t0 = t()
  updates.length = 0
  await builder.update([uri], [])
  return t0
}

console.log('1. disk title:', await customerTitle())

let t0 = await setOverlay(disk.replace("'Customer'", "'Buyer'"), 1)
await new Promise(r => setTimeout(r, 400))
console.log('2. overlay title:', await customerTitle(), 'onModelUpdate:', updates.map(u => `${u.p}@+${Math.round(u.at - t0)}ms`), 'errors', likec4.hasErrors())

t0 = await setOverlay(disk.replace("'Customer'", "'Buyer' {{{ broken"), 2)
await new Promise(r => setTimeout(r, 400))
let broken
try { broken = await customerTitle() } catch (e) { broken = 'throws: ' + e.message }
console.log('3. syntax error -> title:', broken, 'hasErrors', likec4.hasErrors(), 'firstError', likec4.getErrors()[0]?.message?.slice(0, 80), 'updates', updates.length)

textDocs.delete(uri.toString())
t0 = t(); updates.length = 0
await builder.update([uri], [])
await new Promise(r => setTimeout(r, 400))
console.log('4. overlay removed -> title:', await customerTitle(), 'hasErrors', likec4.hasErrors(), 'updates', updates.length)

// timing: edit -> new layout of one view
const t1 = t()
await setOverlay(disk.replace("'Customer'", "'Client'"), 3)
const title = await customerTitle()
console.log('5. edit->layout ms', Math.round(t() - t1), title)

await likec4.dispose()
