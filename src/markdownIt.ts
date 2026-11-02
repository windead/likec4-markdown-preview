/**
 * markdown-it plugin: renders ```likec4-view fences as host elements with inline JSON.
 * Synchronous: only reads caches; never does I/O or layout.
 */
import { createHash } from 'node:crypto'
import * as path from 'node:path'
import type MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { isLikeC4Fence, NAME_RE, parseFenceOptions, parseViewId, type FenceOptions } from './fence'
import { escapeHtml, escapeJsonForScript, jsonForScript } from './html'
import type { ProjectInfo } from './projects'
import type { HostData, HostOptions, ProjectSnapshot, RenderDeps } from './types'

type Env = Record<string, unknown> & { currentDocument?: { fsPath?: string; toString(): string } }

interface Planned {
  project: ProjectInfo
  views: Set<string>
  anyBrowser: boolean
}

interface DocState {
  counts: Map<string, number>
  emittedModels: Set<string>
  plan: Map<string, Planned>
  errSeq: number
  loadSeq: number
}

const STATE_KEY = '__likec4MarkdownPreview'

export function projectKey(p: ProjectInfo): string {
  return `${p.serviceRoot}::${p.name}`
}

/** Stable short tag for a project, unique across service roots. */
export function projectTag(p: ProjectInfo): string {
  const h = createHash('sha1').update(p.serviceRoot).digest('hex').slice(0, 6)
  return `${p.name}-${h}`
}

export function modelElementId(p: ProjectInfo): string {
  return `likec4-model-${projectTag(p)}`
}

function docDirOf(env: Env): string | undefined {
  const fsPath = env?.currentDocument?.fsPath
  return fsPath ? path.dirname(fsPath) : undefined
}

function docKeyOf(env: Env): string | undefined {
  return env?.currentDocument ? String(env.currentDocument.toString()) : undefined
}

type FenceResolution =
  | { kind: 'error'; message: string; opts: FenceOptions; viewId: string }
  | { kind: 'loading'; opts: FenceOptions; viewId: string; project?: ProjectInfo }
  | { kind: 'ok'; opts: FenceOptions; viewId: string; project: ProjectInfo }

function resolveFence(token: Token, env: Env, deps: RenderDeps): FenceResolution {
  const opts = parseFenceOptions(token.info)
  const viewId = parseViewId(token.content)
  if (!viewId) return { kind: 'error', message: 'Missing view id in likec4-view block.', opts, viewId }
  if (!NAME_RE.test(viewId)) return { kind: 'error', message: `Invalid view id "${viewId}".`, opts, viewId }
  if (opts.project !== undefined && !NAME_RE.test(opts.project)) {
    return { kind: 'error', message: `Invalid project name "${opts.project}".`, opts, viewId }
  }
  const res = deps.resolve(docDirOf(env), opts.project)
  if (res === 'pending') return { kind: 'loading', opts, viewId }
  if (!res.ok) return { kind: 'error', message: res.message, opts, viewId }
  return { kind: 'ok', opts, viewId, project: res.project }
}

function planDocument(tokens: Token[], env: Env, deps: RenderDeps): Map<string, Planned> {
  const plan = new Map<string, Planned>()
  for (const t of tokens) {
    if (t.type !== 'fence' || !isLikeC4Fence(t.info)) continue
    const r = resolveFence(t, env, deps)
    if (r.kind !== 'ok') continue
    const key = projectKey(r.project)
    let p = plan.get(key)
    if (!p) plan.set(key, (p = { project: r.project, views: new Set(), anyBrowser: false }))
    p.views.add(r.viewId)
    p.anyBrowser ||= r.opts.browser
  }
  return plan
}

/** Model JSON for a document: full, or trimmed to the referenced views when needed. */
function modelPayload(snap: ProjectSnapshot, planned: Planned, maxBytes: number): { json: string; trimmed: boolean } {
  const full = snap.modelJson!
  if (planned.anyBrowser && full.length <= maxBytes) return { json: full, trimmed: false }
  const views: Record<string, unknown> = {}
  for (const id of planned.views) {
    if (snap.data!.views[id]) views[id] = snap.data!.views[id]
  }
  return { json: jsonForScript({ ...snap.data, views }), trimmed: full.length > maxBytes }
}

function firstLikeC4Fence(tokens: Token[]): number {
  return tokens.findIndex(t => t.type === 'fence' && isLikeC4Fence(t.info))
}

function hostHtml(id: string, opts: HostOptions | null, data: HostData): string {
  const attr = opts ? ` data-likec4-opts="${escapeHtml(JSON.stringify(opts))}"` : ''
  return `<div class="likec4-view" id="${escapeHtml(id)}"${attr}><script type="application/json">${jsonForScript(data)}</script></div>\n`
}

export function renderLikeC4Fence(tokens: Token[], idx: number, env: Env, deps: RenderDeps): string {
  const st: DocState = ((env as any)[STATE_KEY] ??= {
    counts: new Map(),
    emittedModels: new Set(),
    plan: planDocument(tokens, env, deps),
    errSeq: 0,
    loadSeq: 0,
  })
  if (idx === firstLikeC4Fence(tokens)) {
    const docKey = docKeyOf(env)
    if (docKey) deps.recordReferences(docKey, [...st.plan.values()].map(p => p.project))
  }

  const r = resolveFence(tokens[idx]!, env, deps)
  const errorId = () => `likec4-error-${++st.errSeq}`

  if (r.kind === 'error') return hostHtml(errorId(), null, { hash: `error:${r.message}`, state: 'error', message: r.message })
  if (r.kind === 'loading') return hostHtml(`likec4-loading-${++st.loadSeq}`, null, { hash: 'loading', state: 'loading' })

  const { project, viewId, opts } = r
  const tag = projectTag(project)
  const countKey = `${tag}-${viewId}`
  const n = (st.counts.get(countKey) ?? 0) + 1
  st.counts.set(countKey, n)
  const hostId = `likec4-${tag}-${viewId}-${n}`

  const snap = deps.snapshot(project)
  const hostOpts: HostOptions = {
    project: project.name,
    viewId,
    model: modelElementId(project),
    browser: opts.browser,
    variant: opts.variant,
    scheme: opts.scheme,
    maxHeight: deps.maxHeight(),
  }
  if (!snap) return hostHtml(hostId, hostOpts, { hash: 'loading', state: 'loading' })
  if (snap.state === 'error' || !snap.data) {
    const message = snap.message ?? 'Failed to load the LikeC4 model.'
    return hostHtml(hostId, hostOpts, { hash: `error:${snap.hash}:${message}`, state: 'error', message })
  }
  if (!snap.viewIds.has(viewId)) {
    const message = `View "${viewId}" not found in LikeC4 project "${project.name}".`
    return hostHtml(hostId, hostOpts, { hash: `error:${snap.hash}:${viewId}`, state: 'error', message })
  }

  let out = ''
  const planned = st.plan.get(projectKey(project)) ?? { project, views: new Set([viewId]), anyBrowser: opts.browser }
  const payload = modelPayload(snap, planned, deps.maxModelBytes())
  const modelHash = `${snap.hash}${payload.trimmed ? ':t' : planned.anyBrowser ? '' : ':v'}`
  if (!st.emittedModels.has(projectKey(project))) {
    st.emittedModels.add(projectKey(project))
    const head = escapeJsonForScript(`{"hash":${JSON.stringify(modelHash)},"trimmed":${payload.trimmed},"model":`)
    // the id lives on a wrapper <div>: VS Code re-creates <script> elements (domEval) keeping only `type`
    out += `<div class="likec4-model" id="${escapeHtml(modelElementId(project))}" hidden><script type="application/json">${head}${payload.json}}</script></div>\n`
  }
  const data: HostData = {
    hash: `${modelHash}:${snap.state}`,
    state: snap.state === 'stale' ? 'stale' : 'ok',
    ...(snap.message && snap.state === 'stale' ? { message: snap.message } : {}),
    ...(payload.trimmed ? { trimmed: true } : {}),
  }
  return out + hostHtml(hostId, hostOpts, data)
}

/** Installs the fence rule; non-likec4 fences go to the previous rule untouched. */
export function likec4MarkdownIt(md: MarkdownIt, deps: RenderDeps): MarkdownIt {
  const original = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    if (deps.enabled() && isLikeC4Fence(token.info)) {
      return renderLikeC4Fence(tokens, idx, env as Env, deps)
    }
    return original ? original(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
  }
  return md
}
