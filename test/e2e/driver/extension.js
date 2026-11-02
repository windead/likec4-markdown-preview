// Test-only driver: executes requests written by the e2e runner into $LIKEC4_E2E_DIR.
const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

async function handle(req) {
  switch (req.op) {
    case 'command':
      return await vscode.commands.executeCommand(req.command, ...(req.args ?? []))
    case 'open': {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
      await vscode.window.showTextDocument(doc, { viewColumn: req.column ?? vscode.ViewColumn.One, preview: false })
      return true
    }
    case 'preview': {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false })
      await vscode.commands.executeCommand('markdown.showPreviewToSide', doc.uri)
      return true
    }
    case 'replace': {
      // unsaved edit: replace first occurrence of `find` with `replace`
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
      const text = doc.getText()
      const i = text.indexOf(req.find)
      if (i < 0) throw new Error(`text not found: ${req.find}`)
      const edit = new vscode.WorkspaceEdit()
      edit.replace(doc.uri, new vscode.Range(doc.positionAt(i), doc.positionAt(i + req.find.length)), req.replace)
      return await vscode.workspace.applyEdit(edit)
    }
    case 'save': {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
      return await doc.save()
    }
    case 'revert': {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(req.file))
      await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false, viewColumn: vscode.ViewColumn.One })
      await vscode.commands.executeCommand('workbench.action.files.revert')
      return true
    }
    case 'config':
      await vscode.workspace.getConfiguration().update(req.key, req.value, vscode.ConfigurationTarget.Global)
      return true
    case 'render':
      return await vscode.commands.executeCommand('markdown.api.render', await vscode.workspace.openTextDocument(vscode.Uri.file(req.file)))
    case 'extensions':
      return vscode.extensions.all.filter(e => !e.packageJSON.isBuiltin).map(e => ({ id: e.id, active: e.isActive }))
    case 'diagnostics':
      return vscode.languages.getDiagnostics().map(([u, ds]) => ({ file: u.fsPath, count: ds.length, sources: [...new Set(ds.map(d => d.source))] }))
    case 'eval':
      return { node: process.versions.node, vscode: vscode.version }
    default:
      throw new Error(`unknown op ${req.op}`)
  }
}

exports.activate = function activate(context) {
  const dir = process.env.LIKEC4_E2E_DIR
  if (!dir) return
  fs.mkdirSync(dir, { recursive: true })
  const seen = new Set()
  const tick = async () => {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('req-') || seen.has(f)) continue
      seen.add(f)
      const id = f.slice(4, -5)
      let res
      try {
        const req = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        res = { ok: true, value: await handle(req) ?? null }
      } catch (e) {
        res = { ok: false, error: String(e && e.stack || e) }
      }
      fs.writeFileSync(path.join(dir, `res-${id}.json`), JSON.stringify(res))
    }
  }
  const timer = setInterval(() => { void tick() }, 100)
  context.subscriptions.push({ dispose: () => clearInterval(timer) })
  fs.writeFileSync(path.join(dir, 'ready'), String(Date.now()))
}
