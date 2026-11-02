/** Discovers LikeC4 projects in the workspace (VS Code side). */
import * as path from 'node:path'
import * as vscode from 'vscode'
import { CONFIG_FILES, DEFAULT_PROJECT, isWithin, norm, parseConfigName, resolveProject, type ProjectInfo, type Resolution } from './projects'

const CONFIG_GLOB = `**/{${CONFIG_FILES.map(c => c.name).join(',')}}`
const EXCLUDE_GLOB = '**/{node_modules,.git}/**'
const SOURCE_GLOB = '**/*.{c4,likec4}'

export class ProjectRegistry implements vscode.Disposable {
  private projects: ProjectInfo[] = []
  private scanned = false
  private scanning: Promise<void> | null = null
  private readonly outside = new Map<string, ProjectInfo[] | 'pending'>()
  private readonly disposables: vscode.Disposable[] = []
  private readonly emitter = new vscode.EventEmitter<void>()
  /** Fires when the set of projects changed (after a rescan). */
  readonly onDidChange = this.emitter.event

  constructor(private readonly log: (m: string) => void) {
    const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB)
    const rescan = () => this.rescan()
    watcher.onDidCreate(rescan)
    watcher.onDidDelete(rescan)
    watcher.onDidChange(rescan)
    const srcWatcher = vscode.workspace.createFileSystemWatcher(SOURCE_GLOB, false, true, false)
    srcWatcher.onDidCreate(() => this.onSourceCreatedOrDeleted())
    srcWatcher.onDidDelete(() => this.onSourceCreatedOrDeleted())
    this.disposables.push(watcher, srcWatcher, this.emitter, vscode.workspace.onDidChangeWorkspaceFolders(rescan))
    void this.rescan()
  }

  get isReady(): boolean {
    return this.scanned
  }

  all(): ReadonlyArray<ProjectInfo> {
    return this.projects
  }

  whenReady(): Promise<void> {
    return this.scanning ?? Promise.resolve()
  }

  private onSourceCreatedOrDeleted() {
    // default projects depend on whether .c4 files exist
    if (this.projects.length === 0 || this.projects.some(p => p.kind === 'default')) void this.rescan()
  }

  rescan(): Promise<void> {
    const run = async () => {
      const t0 = performance.now()
      const next: ProjectInfo[] = []
      const folders = vscode.workspace.workspaceFolders ?? []
      const files = await vscode.workspace.findFiles(CONFIG_GLOB, EXCLUDE_GLOB)
      for (const uri of files) {
        const info = await readConfig(uri.fsPath, folderRootOf(uri.fsPath, folders))
        if (info) next.push(info)
      }
      for (const f of folders) {
        const root = f.uri.fsPath
        if (next.some(p => isWithin(p.root, root))) continue
        const src = await vscode.workspace.findFiles(new vscode.RelativePattern(f, SOURCE_GLOB), EXCLUDE_GLOB, 1)
        if (src.length > 0) {
          next.push({ name: DEFAULT_PROJECT, root: norm(root), kind: 'default', configPath: '', serviceRoot: norm(root) })
        }
      }
      const before = JSON.stringify(this.projects)
      const first = !this.scanned
      this.projects = next
      this.outside.clear()
      this.scanned = true
      this.log(`[projects] ${next.map(p => `${p.name || '(script)'}@${p.root}`).join(', ') || 'none'} (${Math.round(performance.now() - t0)} ms)`)
      if (first || before !== JSON.stringify(next)) this.emitter.fire()
    }
    const p = (this.scanning ?? Promise.resolve()).then(run, run).finally(() => {
      if (this.scanning === p) this.scanning = null
    })
    this.scanning = p
    return p
  }

  /** Synchronous resolution for markdown-it; 'pending' while a scan or lookup is in progress. */
  resolve(docDir: string | undefined, explicit: string | undefined): Resolution | 'pending' {
    if (!this.scanned) return 'pending'
    const folders = vscode.workspace.workspaceFolders ?? []
    if (docDir && !folders.some(f => isWithin(docDir, f.uri.fsPath))) {
      const found = this.outside.get(norm(docDir))
      if (found === undefined) {
        this.lookupOutside(docDir)
        return 'pending'
      }
      if (found === 'pending') return 'pending'
      return resolveProject(docDir, explicit, [...found, ...this.projects])
    }
    return resolveProject(docDir, explicit, this.projects)
  }

  /** Looks for config files above a directory outside the workspace (async). */
  private lookupOutside(docDir: string) {
    const key = norm(docDir)
    this.outside.set(key, 'pending')
    void (async () => {
      const found: ProjectInfo[] = []
      let dir = key
      for (;;) {
        for (const c of CONFIG_FILES) {
          const file = path.join(dir, c.name)
          try {
            await vscode.workspace.fs.stat(vscode.Uri.file(file))
            const info = await readConfig(file, undefined)
            if (info) found.push(info)
          } catch {
            // not found
          }
        }
        if (found.length > 0) break
        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
      }
      this.outside.set(key, found)
      this.log(`[projects] outside workspace ${key}: ${found.map(p => p.root).join(', ') || 'none'}`)
      this.emitter.fire()
    })()
  }

  dispose() {
    for (const d of this.disposables.splice(0)) d.dispose()
  }
}

function folderRootOf(fsPath: string, folders: ReadonlyArray<vscode.WorkspaceFolder>): string | undefined {
  let best: string | undefined
  for (const f of folders) {
    const r = f.uri.fsPath
    if (isWithin(fsPath, r) && (!best || r.length > best.length)) best = r
  }
  return best
}

async function readConfig(file: string, folderRoot: string | undefined): Promise<ProjectInfo | undefined> {
  const base = path.basename(file)
  const kind = CONFIG_FILES.find(c => c.name === base)?.kind
  if (!kind) return undefined
  const root = norm(path.dirname(file))
  let name = ''
  if (kind === 'json') {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(file))
      name = parseConfigName(new TextDecoder().decode(bytes)) ?? ''
    } catch {
      name = ''
    }
  }
  return { name, root, kind, configPath: file, serviceRoot: norm(folderRoot ?? root) }
}
