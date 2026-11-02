// Integration suite (runs in the extension host). Minimal runner, no mocha.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

const ws = process.env.LIKEC4_IT_WS
const tests = []
const test = (name, fn) => tests.push({ name, fn })

function hosts(html) {
  const out = []
  const re = /<div class="likec4-view" id="([^"]+)"(?: data-likec4-opts="([^"]*)")?><script type="application\/json">([\s\S]*?)<\/script>(?:<div class="likec4-notice[^"]*">[\s\S]*?<\/div>)*(?:<svg class="likec4-static"[\s\S]*?<\/svg>)?<\/div>/g
  let m
  while ((m = re.exec(html))) {
    const opts = m[2] ? JSON.parse(m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) : null
    out.push({ id: m[1], opts, data: JSON.parse(m[3]) })
  }
  return out
}
function models(html) {
  const out = []
  const re = /<div class="likec4-model" id="([^"]+)" hidden><script type="application\/json">([\s\S]*?)<\/script><\/div>/g
  let m
  while ((m = re.exec(html))) out.push({ id: m[1], data: JSON.parse(m[2]) })
  return out
}

async function api() {
  const ext = vscode.extensions.getExtension('windead.likec4-markdown-preview')
  assert.ok(ext, 'extension present')
  return ext.isActive ? ext.exports : await ext.activate()
}

/** Renders until no host is loading. */
async function render(file, accept = () => true, timeoutMs = 30000) {
  const a = await api()
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file))
  const end = Date.now() + timeoutMs
  let html
  for (;;) {
    html = await vscode.commands.executeCommand('markdown.api.render', doc)
    const hs = hosts(html)
    if (hs.length > 0 && hs.every(h => h.data.state !== 'loading') && accept(hs, html)) return html
    if (Date.now() > end) throw new Error(`render timed out: ${html.slice(0, 2000)}`)
    await a.idle()
    await new Promise(r => setTimeout(r, 200))
  }
}

test('renders host elements with valid JSON and one model per project', async () => {
  const html = await render(path.join(ws, 'docs/sample.md'))
  const hs = hosts(html)
  assert.equal(hs.length, 4)
  assert.deepEqual(hs.map(h => h.opts.viewId), ['index', 'checkout', 'prodDeployment', 'billingOverview'])
  assert.ok(hs.every(h => h.data.state === 'ok'), JSON.stringify(hs.map(h => h.data)))
  const ms = models(html)
  assert.equal(ms.length, 2)
  assert.ok(ms[0].data.model.views.index, 'shop model has index view')
  assert.equal(hs[2].opts.browser, false)
  assert.equal(hs[3].opts.scheme, 'light')
})

test('nearest project, unknown view, untouched other fences', async () => {
  const html = await render(path.join(ws, 'shop/docs/readme.md'))
  const hs = hosts(html)
  assert.equal(hs.length, 3)
  assert.equal(hs[0].data.state, 'ok')
  assert.equal(hs[0].opts.project, 'shop')
  assert.equal(hs[1].opts.variant, 'sequence')
  assert.equal(hs[2].data.state, 'error')
  assert.match(hs[2].data.message, /not found/)
  assert.match(html, /<code[^>]*class="[^"]*language-js/, 'js fence rendered as code')
})

test('changing a .c4 file on disk yields a new hash', async () => {
  const file = path.join(ws, 'docs/sample.md')
  const before = hosts(await render(file))[0].data.hash
  const model = path.join(ws, 'shop/model.c4')
  fs.writeFileSync(model, fs.readFileSync(model, 'utf8').replace("'Customer'", "'Customer (changed)'"))
  const html = await render(file, hs => hs[0].data.hash !== before)
  const ms = models(html)
  const shop = ms.find(m => m.data.model.views.index)
  assert.ok(JSON.stringify(shop.data.model.views.index).includes('Customer (changed)'))
})

test('unsaved edits of a .c4 document yield a new hash', async () => {
  const file = path.join(ws, 'docs/sample.md')
  const before = hosts(await render(file))[3].data.hash
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'billing/model.c4')))
  const edit = new vscode.WorkspaceEdit()
  const i = doc.getText().indexOf("'Ledger'")
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(i), doc.positionAt(i + 8)), "'General Ledger'")
  assert.ok(await vscode.workspace.applyEdit(edit))
  assert.ok(doc.isDirty)
  const html = await render(file, hs => hs[3].data.hash !== before)
  assert.ok(html.includes('General Ledger'))
  assert.ok(!fs.readFileSync(path.join(ws, 'billing/model.c4'), 'utf8').includes('General Ledger'), 'disk unchanged')
})

test('enabled=false renders plain code blocks', async () => {
  const cfg = vscode.workspace.getConfiguration('likec4MarkdownPreview')
  await cfg.update('enabled', false, vscode.ConfigurationTarget.Global)
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'docs/sample.md')))
    const html = await vscode.commands.executeCommand('markdown.api.render', doc)
    assert.equal(hosts(html).length, 0)
    assert.match(html, /<code[^>]*class="[^"]*language-likec4-view/, 'plain code block')
  } finally {
    await cfg.update('enabled', undefined, vscode.ConfigurationTarget.Global)
  }
})

exports.run = async function run() {
  let failed = 0
  for (const t of tests) {
    const t0 = Date.now()
    try {
      await t.fn()
      console.log(`  ✓ ${t.name} (${Date.now() - t0} ms)`)
    } catch (e) {
      failed++
      console.log(`  ✗ ${t.name}\n    ${String(e && e.stack || e).slice(0, 600).split('\n').slice(0, 6).join('\n    ')}`)
    }
  }
  console.log(`${tests.length - failed} passed, ${failed} failed`)
  if (failed) throw new Error(`${failed} integration test(s) failed`)
}
