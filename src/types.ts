import type { ProjectInfo, Resolution } from './projects'

export type HostState = 'ok' | 'loading' | 'error' | 'stale'

/** Cached, layouted model of one project, as produced by ModelService. */
export interface ProjectSnapshot {
  /** Content hash of the model JSON (changes iff the model changed). */
  hash: string
  /** ok: current; stale: model has errors, data is the last good one; error: no usable data. */
  state: 'ok' | 'stale' | 'error'
  message?: string
  viewIds: ReadonlySet<string>
  /** LikeC4Model.Layouted $data (plain JSON). Absent when state === 'error'. */
  data?: { views: Record<string, unknown>; [k: string]: unknown }
  /** Full model JSON, already escaped for inline <script>. */
  modelJson?: string
}

/** JSON inside each host's <script type="application/json">. */
export interface HostData {
  hash: string
  state: HostState
  message?: string
  /** Model was trimmed (size limit) — browser navigation disabled. */
  trimmed?: boolean
}

/** JSON inside the per-project model <script>. */
export interface ModelData {
  hash: string
  trimmed: boolean
  model: unknown
}

/** data-likec4-opts attribute (options only, stable across data changes). */
export interface HostOptions {
  project: string
  viewId: string
  model: string
  browser: boolean
  variant: 'diagram' | 'sequence'
  scheme: 'auto' | 'light' | 'dark'
  maxHeight: number
}

export interface RenderDeps {
  enabled(): boolean
  maxModelBytes(): number
  maxHeight(): number
  /** Resolves the project for a document directory; 'pending' while discovery is still running. */
  resolve(docDir: string | undefined, explicit: string | undefined): Resolution | 'pending'
  /** Returns the cached snapshot (undefined while loading) and makes sure it gets computed. */
  snapshot(project: ProjectInfo): ProjectSnapshot | undefined
  /** Records which projects a document references (used to decide which previews to refresh). */
  recordReferences(docKey: string, projects: ReadonlyArray<ProjectInfo>): void
}
