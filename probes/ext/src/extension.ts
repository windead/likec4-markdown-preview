// Probe extension for P1/P3/P4. Not production code.
import * as vscode from 'vscode'
import { fromWorkspace } from '@likec4/language-services/node'
import * as fs from 'node:fs'
import * as path from 'node:path'

type Cached = { hash: string; model: unknown }
let cache: Cached | null = null
let counter = 0
const result: Record<string, unknown> = {}

function escapeJson(s: string): string {
  return s
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

function writeResult(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2))
}

export function activate(context: vscode.ExtensionContext) {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const probeDir = process.env.PROBE_DIR ?? (ws ? path.join(ws, '.probe') : '')
  result.node = process.versions.node
  result.electron = process.versions.electron
  result.vscode = vscode.version

  if (ws) {
    void (async () => {
      try {
        const t0 = performance.now()
        const likec4 = await fromWorkspace(ws, { graphviz: 'wasm', printErrors: false })
        const t1 = performance.now()
        const m = await likec4.layoutedModel('shop')
        const t2 = performance.now()
        // per-view layout timing (2nd pass, warm)
        const perView: Record<string, number> = {}
        for (const v of ['index', 'shopContainers', 'checkout', 'prodDeployment']) {
          const s = performance.now()
          await likec4.viewsService.layoutView({ viewId: v as any, projectId: 'shop' as any })
          perView[v] = Math.round(performance.now() - s)
        }
        const json = JSON.stringify(m.$data)
        cache = { hash: String(Date.now()), model: m.$data }
        Object.assign(result, {
          p4: { initMs: Math.round(t1 - t0), layoutedModelMs: Math.round(t2 - t1), perViewWarmMs: perView, modelJsonBytes: json.length },
        })
        writeResult(probeDir)
        await vscode.commands.executeCommand('markdown.preview.refresh')
      } catch (e) {
        result.p4error = String((e as Error)?.stack ?? e)
        writeResult(probeDir)
      }
    })()
  }

  if (probeDir) {
    fs.mkdirSync(probeDir, { recursive: true })
    const trigger = path.join(probeDir, 'trigger')
    fs.writeFileSync(trigger, '0')
    const w = fs.watch(trigger, () => {
      const mode = fs.readFileSync(trigger, 'utf8').trim()
      counter++
      if (mode.startsWith('md')) {
        // bump the markdown document version -> non-forced refresh -> morphdom updateContent
        const doc = vscode.workspace.textDocuments.find(d => d.fileName.endsWith('sample.md'))
        if (doc) {
          const edit = new vscode.WorkspaceEdit()
          const last = doc.lineAt(doc.lineCount - 1)
          edit.insert(doc.uri, last.range.end, ' x')
          void vscode.workspace.applyEdit(edit)
        }
      } else if (mode.startsWith('force')) {
        void vscode.commands.executeCommand('markdown.preview.refresh')
      }
    })
    context.subscriptions.push({ dispose: () => w.close() })
  }

  const open = process.env.PROBE_OPEN
  if (open) {
    void (async () => {
      const doc = await vscode.workspace.openTextDocument(open)
      await vscode.window.showTextDocument(doc)
      await vscode.commands.executeCommand('markdown.showPreviewToSide')
    })()
  }

  return {
    extendMarkdownIt(md: any) {
      const orig = md.renderer.rules.fence
      md.renderer.rules.fence = (tokens: any[], idx: number, opts: any, env: any, self: any) => {
        const tok = tokens[idx]
        const info = String(tok.info ?? '').trim()
        if (!info.startsWith('likec4-view')) {
          return orig ? orig(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts)
        }
        const viewId = String(tok.content).split('\n').map((s: string) => s.trim()).find(Boolean) ?? ''
        env.__likec4 ??= new Map<string, number>()
        const n = (env.__likec4.get(viewId) ?? 0) + 1
        env.__likec4.set(viewId, n)
        const browser = !/\bbrowser=false\b/.test(info)
        const payload = cache
          ? { hash: `${cache.hash}-${counter}`, state: 'ok', viewId, counter, model: cache.model }
          : { hash: 'loading', state: 'loading', viewId, counter }
        const opts2 = JSON.stringify({ browser, variant: 'diagram', scheme: 'auto' })
        return `<div class="likec4-view" id="likec4-shop-${viewId}-${n}" data-likec4-opts='${opts2}'>`
          + `<script type="application/json">${escapeJson(JSON.stringify(payload))}</script></div>\n`
      }
      return md
    },
  }
}

export function deactivate() {}
