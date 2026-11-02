/**
 * One LikeC4 workspace (a root folder that may contain several projects).
 * Built from public APIs: @likec4/language-server modules + `new LikeC4(services)`.
 * Unsaved editor text is fed through Langium's TextDocuments + DocumentBuilder.
 */
import { createHash } from 'node:crypto'
import { LikeC4 } from '@likec4/language-services/node'
import { WithFileSystem, WithLikeC4ManualLayouts } from '@likec4/language-server/filesystem'
import { createLanguageServices, WithGraphviz, WithWasmGraphviz } from '@likec4/language-server/module'
import { GraphvizBinaryAdapter } from '@likec4/layouts/graphviz/binary'
import { URI } from 'langium'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { escapeJsonForScript } from './html'
import type { ProjectSnapshot } from './types'

export interface ModelServiceOptions {
  graphviz: 'wasm' | 'binary'
  /** Watch the file system for changes (chokidar). */
  watch: boolean
  log: (msg: string) => void
  /** Called after a recompute changed the snapshot of the given projects. */
  onDidChange: (projects: string[]) => void
}

type Services = ReturnType<typeof createLanguageServices>

export class ModelService {
  readonly root: string
  readonly ready: Promise<void>
  private services!: Services
  private likec4!: LikeC4
  private readonly snapshots = new Map<string, ProjectSnapshot>()
  private readonly referenced = new Set<string>()
  private readonly pending = new Set<string>()
  private running: Promise<void> | null = null
  private disposed = false
  private readonly disposables: Array<() => void> = []
  private initError: string | null = null
  /** Increments on every computed snapshot change (for tests/diagnostics). */
  generation = 0

  constructor(root: string, private readonly opts: ModelServiceOptions) {
    this.root = root
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const t0 = performance.now()
    try {
      this.services = createLanguageServices({
        ...WithFileSystem(this.opts.watch),
        ...WithLikeC4ManualLayouts,
        ...(this.opts.graphviz === 'binary' ? WithGraphviz(new GraphvizBinaryAdapter()) : WithWasmGraphviz),
      })
      const wm = this.services.shared.workspace.WorkspaceManager
      const rootUri = URI.file(this.root).toString().replace(/\/?$/, '/')
      wm.initialize({
        capabilities: {},
        processId: null,
        rootUri,
        workspaceFolders: [{ name: 'likec4', uri: rootUri }],
      } as any)
      await wm.initialized({})
      this.likec4 = new LikeC4(this.services as any)
      this.disposables.push(this.likec4.onModelUpdate(p => this.onModelUpdate(String(p))))
      this.opts.log(
        `[init] ${this.root}: ${this.likec4.documentCount()} documents, projects [${this.projectIds().join(', ')}] in ${Math.round(performance.now() - t0)} ms`,
      )
    } catch (e) {
      this.initError = errorMessage(e)
      this.opts.log(`[init] ${this.root} failed: ${this.initError}`)
    }
  }

  projectIds(): string[] {
    if (!this.likec4) return []
    try {
      return this.likec4.projects().map(String)
    } catch {
      return []
    }
  }

  /** Current snapshot (undefined until first computed). Marks the project as referenced. */
  snapshot(projectId: string): ProjectSnapshot | undefined {
    if (!this.referenced.has(projectId)) {
      this.referenced.add(projectId)
      this.request(projectId)
    }
    return this.snapshots.get(projectId)
  }

  isReferenced(projectId: string): boolean {
    return this.referenced.has(projectId)
  }

  /** Sets (text) or clears (null) the unsaved content of a LikeC4 document. */
  async setOverlay(fsPath: string, text: string | null, version = 0): Promise<void> {
    await this.ready
    if (this.disposed || !this.services) return
    const uri = URI.file(fsPath)
    const docs = this.services.shared.workspace.TextDocuments as any
    if (text === null) {
      if (!docs.get(uri.toString())) return
      docs.delete(uri.toString())
    } else {
      docs.set(TextDocument.create(uri.toString(), 'likec4', version, text))
    }
    await this.services.shared.workspace.DocumentBuilder.update([uri], [])
  }

  private onModelUpdate(projectId: string) {
    if (this.referenced.has(projectId)) this.request(projectId)
  }

  /** Queues a recompute; requests arriving while one is queued are coalesced. */
  private request(projectId: string) {
    this.pending.add(projectId)
    if (!this.running) this.running = this.drain()
  }

  private async drain(): Promise<void> {
    try {
      await this.ready
      while (this.pending.size > 0 && !this.disposed) {
        const batch = [...this.pending]
        this.pending.clear()
        const changed: string[] = []
        for (const p of batch) {
          if (await this.compute(p)) changed.push(p)
        }
        if (changed.length > 0 && !this.disposed) {
          this.generation++
          this.opts.onDidChange(changed)
        }
      }
    } finally {
      this.running = null
      if (this.pending.size > 0 && !this.disposed) this.running = this.drain()
    }
  }

  /** Waits until all queued recomputes are done (tests). */
  async idle(): Promise<void> {
    await this.ready
    while (this.running) await this.running
  }

  private projectErrors(projectId: string): string[] {
    const pm = this.services.shared.workspace.ProjectsManager
    const out: string[] = []
    for (const doc of this.services.shared.workspace.LangiumDocuments.all) {
      if (pm.isExcluded(doc) || String(pm.ownerProjectId(doc)) !== projectId) continue
      for (const d of doc.diagnostics ?? []) {
        if (d.severity === 1) out.push(`${pm.relativePath(doc)}:${d.range.start.line + 1} ${String(d.message).slice(0, 200)}`)
      }
    }
    return out
  }

  /** Recomputes one project; returns true when its snapshot changed. */
  private async compute(projectId: string): Promise<boolean> {
    const prev = this.snapshots.get(projectId)
    const t0 = performance.now()
    let next: ProjectSnapshot
    if (this.initError || !this.likec4) {
      next = { hash: `init-error`, state: 'error', message: this.initError ?? 'LikeC4 failed to start', viewIds: new Set() }
    } else if (!this.projectIds().includes(projectId)) {
      next = { hash: 'missing', state: 'error', message: `LikeC4 project "${projectId}" not found in ${this.root}.`, viewIds: new Set() }
    } else {
      const errors = this.projectErrors(projectId)
      if (errors.length > 0) {
        const message = `LikeC4 model has errors: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`
        next = prev?.data
          ? { ...prev, state: 'stale', message }
          : { hash: 'errors', state: 'error', message, viewIds: new Set() }
      } else {
        try {
          const model = await this.likec4.layoutedModel(projectId)
          const json = JSON.stringify(model.$data)
          const hash = stableHash(model.$data)
          if (prev?.state === 'ok' && prev.hash === hash) {
            this.opts.log(`[layout] ${projectId}: unchanged (${Math.round(performance.now() - t0)} ms)`)
            return false
          }
          const data = JSON.parse(json)
          const modelJson = escapeJsonForScript(json)
          next = { hash, state: 'ok', viewIds: new Set(Object.keys(data.views ?? {})), data, modelJson, modelBytes: Buffer.byteLength(modelJson) }
        } catch (e) {
          const message = `LikeC4 layout failed: ${errorMessage(e)}`
          next = prev?.data ? { ...prev, state: 'stale', message } : { hash: 'layout-error', state: 'error', message, viewIds: new Set() }
        }
      }
    }
    const changed = !prev || prev.hash !== next.hash || prev.state !== next.state || prev.message !== next.message
    this.snapshots.set(projectId, next)
    this.opts.log(
      `[layout] ${projectId}: ${next.state}${changed ? ' (changed)' : ''} in ${Math.round(performance.now() - t0)} ms, ${next.viewIds.size} views, ${next.modelJson?.length ?? 0} bytes`,
    )
    return changed
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const d of this.disposables.splice(0)) d()
    await this.ready.catch(() => {})
    await this.likec4?.dispose().catch(() => {})
  }
}

/** SHA-1 of a canonical JSON form (object keys sorted): key order of the model is not stable. */
export function stableHash(value: unknown): string {
  const h = createHash('sha1')
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object') {
      h.update(JSON.stringify(v) ?? 'null')
    } else if (Array.isArray(v)) {
      h.update('[')
      for (const x of v) {
        walk(x)
        h.update(',')
      }
      h.update(']')
    } else {
      h.update('{')
      for (const k of Object.keys(v).sort()) {
        const x = (v as Record<string, unknown>)[k]
        if (x === undefined || typeof x === 'function') continue
        h.update(JSON.stringify(k))
        h.update(':')
        walk(x)
        h.update(',')
      }
      h.update('}')
    }
  }
  walk(value)
  return h.digest('hex').slice(0, 16)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
