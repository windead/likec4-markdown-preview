import { appendFileSync } from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type MarkdownIt from 'markdown-it'
import { likec4MarkdownIt, projectKey } from './markdownIt'
import { ModelService } from './modelService'
import { isWithin, norm, type ProjectInfo } from './projects'
import { RefreshScheduler } from './refresh'
import { ProjectRegistry } from './registry'
import type { RenderDeps } from './types'

const SECTION = 'likec4MarkdownPreview'
const LIKEC4_EXT = /\.(c4|likec4)$/i

function config() {
  const c = vscode.workspace.getConfiguration(SECTION)
  return {
    enabled: c.get<boolean>('enabled', true),
    debounceMs: Math.max(0, c.get<number>('debounceMs', 250)),
    maxHeight: Math.max(100, c.get<number>('maxHeight', 600)),
    graphviz: c.get<'wasm' | 'binary'>('graphviz', 'wasm') === 'binary' ? 'binary' as const : 'wasm' as const,
    maxModelBytes: Math.max(64 * 1024, c.get<number>('maxModelBytes', 2 * 1024 * 1024)),
  }
}

export interface ExtensionApi {
  extendMarkdownIt(md: MarkdownIt): MarkdownIt
  /** For tests: waits until project discovery and all pending recomputes are finished. */
  idle(): Promise<void>
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = vscode.window.createOutputChannel('LikeC4 Markdown Preview')
  const logFile = process.env.LIKEC4_MDP_LOG
  const log = (m: string) => {
    const line = `${new Date().toISOString().slice(11, 23)} ${m}`
    output.appendLine(line)
    if (logFile) {
      try {
        appendFileSync(logFile, `${Date.now()} ${m}\n`)
      } catch {}
    }
  }
  let cfg = config()

  const registry = new ProjectRegistry(log)
  const services = new Map<string, ModelService>()
  /** doc URI -> project keys */
  const references = new Map<string, Set<string>>()

  const scheduler = new RefreshScheduler({
    documentsReferencing: keys => [...references].filter(([, ks]) => keys.some(k => ks.has(k))).map(([d]) => d),
    hasOpenPreview,
    isDocumentOpen,
    refresh: reason => {
      log(`[refresh] markdown.preview.refresh: ${reason}`)
      void vscode.commands.executeCommand('markdown.preview.refresh')
    },
  })

  function serviceFor(root: string): ModelService {
    const key = norm(root)
    let s = services.get(key)
    if (!s) {
      s = new ModelService(key, {
        graphviz: cfg.graphviz,
        watch: true,
        log,
        onDidChange: projects => scheduler.projectsChanged(projects.map(p => `${key}::${p}`), `model changed: ${projects.join(', ')}`),
      })
      services.set(key, s)
      void s.ready.then(() => syncOpenDocuments(s!))
    }
    return s
  }

  const deps: RenderDeps = {
    enabled: () => cfg.enabled,
    maxModelBytes: () => cfg.maxModelBytes,
    maxHeight: () => cfg.maxHeight,
    resolve: (docDir, explicit) => registry.resolve(docDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, explicit),
    snapshot: (p: ProjectInfo) => serviceFor(p.serviceRoot).snapshot(p.name),
    recordReferences: (docKey, projects) => references.set(docKey, new Set(projects.map(projectKey))),
    onRendered: (docKey, blocks, ms) =>
      log(`[render] ${docKey ? path.basename(vscode.Uri.parse(docKey).fsPath) : '(string)'}: ${blocks} likec4-view block(s) in ${ms.toFixed(1)} ms`),
  }

  // ---- unsaved text sync ----------------------------------------------------------------
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  function servicesContaining(fsPath: string): ModelService[] {
    return [...services.values()].filter(s => isWithin(fsPath, s.root))
  }
  function pushOverlay(doc: vscode.TextDocument) {
    const targets = servicesContaining(doc.uri.fsPath)
    if (targets.length > 0) log(`[edit] ${path.basename(doc.uri.fsPath)} v${doc.version} -> ${targets.length} service(s)`)
    for (const s of targets) void s.setOverlay(doc.uri.fsPath, doc.getText(), doc.version)
  }
  function syncOpenDocuments(s: ModelService) {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === 'file' && LIKEC4_EXT.test(doc.uri.fsPath) && doc.isDirty && isWithin(doc.uri.fsPath, s.root)) {
        void s.setOverlay(doc.uri.fsPath, doc.getText(), doc.version)
      }
    }
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const doc = e.document
      if (doc.uri.scheme !== 'file' || !LIKEC4_EXT.test(doc.uri.fsPath) || e.contentChanges.length === 0) return
      const key = doc.uri.toString()
      clearTimeout(timers.get(key))
      timers.set(key, setTimeout(() => {
        timers.delete(key)
        pushOverlay(doc)
      }, cfg.debounceMs))
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      if (doc.uri.scheme !== 'file' || !LIKEC4_EXT.test(doc.uri.fsPath)) return
      clearTimeout(timers.get(doc.uri.toString()))
      timers.delete(doc.uri.toString())
      for (const s of servicesContaining(doc.uri.fsPath)) void s.setOverlay(doc.uri.fsPath, null)
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      // saved text equals disk: drop the overlay so the file watcher is the source of truth
      if (doc.uri.scheme !== 'file' || !LIKEC4_EXT.test(doc.uri.fsPath)) return
      for (const s of servicesContaining(doc.uri.fsPath)) void s.setOverlay(doc.uri.fsPath, null)
    }),
  )

  // ---- settings & project set ---------------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(SECTION)) return
      const prev = cfg
      cfg = config()
      if (prev.graphviz !== cfg.graphviz) {
        for (const s of services.values()) void s.dispose()
        services.clear()
      }
      scheduler.refreshAll('settings changed')
    }),
    registry.onDidChange(() => {
      // project roots may have moved between services: drop services no longer used
      const roots = new Set(registry.all().map(p => p.serviceRoot))
      for (const [root, s] of services) {
        if (!roots.has(root) && ![...references.values()].some(ks => [...ks].some(k => k.startsWith(`${root}::`)))) {
          void s.dispose()
          services.delete(root)
        }
      }
      scheduler.refreshAll('LikeC4 projects changed')
    }),
    registry,
    output,
    { dispose: () => scheduler.dispose() },
    { dispose: () => { for (const s of services.values()) void s.dispose() } },
  )

  log(`[activate] VS Code ${vscode.version}, Node ${process.versions.node}`)

  return {
    extendMarkdownIt(md: MarkdownIt) {
      return likec4MarkdownIt(md, deps)
    },
    async idle() {
      await registry.whenReady()
      for (const s of services.values()) await s.idle()
    },
  }
}

function previewTabs(): vscode.Tab[] {
  const out: vscode.Tab[] = []
  for (const g of vscode.window.tabGroups.all) {
    for (const t of g.tabs) {
      const input = t.input
      if (input instanceof vscode.TabInputWebview && /markdown\.preview/i.test(input.viewType)) out.push(t)
    }
  }
  return out
}

function hasOpenPreview(): boolean {
  return previewTabs().length > 0
}

function isDocumentOpen(docUri: string): boolean {
  if (vscode.workspace.textDocuments.some(d => d.uri.toString() === docUri)) return true
  const base = path.basename(vscode.Uri.parse(docUri).fsPath)
  return previewTabs().some(t => t.label.includes(base))
}

export function deactivate() {}
