/**
 * Preview script injected into the built-in Markdown preview (markdown.previewScripts).
 * Finds `.likec4-view` hosts, mounts React into each host's shadow root, and re-renders
 * (without remounting) when the inline JSON changes.
 */
import { LikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, LikeC4View, pickViewBounds } from '@likec4/diagram'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { HostManager, readJson } from './hosts'
import { clearOtherDocuments, loadViewport, makeViewportSaver, isViewportUsable, type SavedViewport } from './viewport'
import type { HostData, HostOptions, ModelData } from '../src/types'

type Scheme = 'light' | 'dark'

interface ModelEntry {
  hash: string
  model: LikeC4Model<any>
  trimmed: boolean
}

const models = new Map<string, ModelEntry>()

function vscodeScheme(): Scheme {
  const c = document.body.classList
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light') ? 'dark' : 'light'
}

function documentKey(): string {
  try {
    const raw = document.getElementById('vscode-markdown-preview-data')?.getAttribute('data-settings')
    const source = raw ? JSON.parse(raw).source : undefined
    return typeof source === 'string' ? source : location.pathname
  } catch {
    return location.pathname
  }
}

function modelFor(id: string): ModelEntry | null {
  const el = document.getElementById(id)?.querySelector(':scope > script[type="application/json"]') ?? null
  if (!el) return null
  const cached = models.get(id)
  // cheap check before parsing the whole model: the hash is at the start of the JSON
  const head = el.textContent?.slice(0, 200) ?? ''
  if (cached && head.includes(JSON.stringify(cached.hash))) return cached
  const data = readJson<ModelData>(el)
  if (!data?.model) return null
  try {
    const entry: ModelEntry = { hash: data.hash, model: LikeC4Model.create(data.model as any), trimmed: data.trimmed }
    models.set(id, entry)
    return entry
  } catch (e) {
    console.error('[likec4] invalid model data', e)
    return null
  }
}

/** Padding (px, diagram units) around the view bounds when sizing the frame. */
const PAD = 16
const MIN_HEIGHT = 160

const box: CSSProperties = {
  fontFamily: 'var(--vscode-font-family, sans-serif)',
  fontSize: '13px',
  padding: '8px 12px',
  borderRadius: '4px',
  margin: '0 0 6px 0',
}

function Notice({ kind, children }: { kind: 'error' | 'warning' | 'info'; children: React.ReactNode }) {
  const color = kind === 'error'
    ? 'var(--vscode-editorError-foreground, #f14c4c)'
    : kind === 'warning'
    ? 'var(--vscode-editorWarning-foreground, #cca700)'
    : 'var(--vscode-descriptionForeground, #888)'
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} data-likec4-notice={kind}
      style={{ ...box, borderLeft: `3px solid ${color}`, background: 'var(--vscode-textBlockQuote-background, rgba(127,127,127,.1))', color: 'var(--vscode-foreground, inherit)' }}>
      {children}
    </div>
  )
}

interface HostProps {
  hostId: string
  host: Element
  opts: HostOptions
  data: HostData
  model: ModelEntry | null
  scheme: Scheme
  docKey: string
}

function Diagram({ hostId, host, opts, data, model, scheme, docKey }: HostProps & { model: ModelEntry }) {
  const [saved] = useState<SavedViewport | null>(() => loadViewport(docKey, hostId))
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const browser = opts.browser && !data.trimmed
  const view = model.model.findView(opts.viewId as any)

  const onInitialized = ({ xyflow }: { xyflow: any }) => {
    cleanup.current?.()
    if (saved && view?.isLayouted()) {
      const bounds = pickViewBounds(view.$layouted as any, opts.variant)
      if (isViewportUsable(saved, bounds)) xyflow.setViewport({ x: saved.x, y: saved.y, zoom: saved.zoom }, { duration: 0 })
      else void xyflow.fitView({ duration: 0 })
    }
    cleanup.current = makeViewportSaver(host, docKey, hostId, () => xyflow.getViewport())
  }

  const bounds = view?.isLayouted() ? pickViewBounds(view.$layouted as any, opts.variant) : null
  const size: CSSProperties = bounds
    ? {
      width: `min(100%, ${Math.ceil(bounds.width + 2 * PAD)}px)`,
      aspectRatio: `${Math.ceil(bounds.width + 2 * PAD)} / ${Math.ceil(bounds.height + 2 * PAD)}`,
      maxHeight: `${opts.maxHeight}px`,
      minHeight: `${Math.min(MIN_HEIGHT, opts.maxHeight)}px`,
      margin: '0 auto',
    }
    : { height: `${opts.maxHeight}px` }
  return (
    <div>
      {data.state === 'stale' && (
        <Notice kind="warning">Showing the last valid version. {data.message}</Notice>
      )}
      {data.trimmed && opts.browser && (
        <Notice kind="info">The LikeC4 model is too large to embed completely; navigation is disabled.</Notice>
      )}
      <div style={size} data-likec4-frame>
      <LikeC4ModelProvider likec4model={model.model}>
        <LikeC4View
          keepAspectRatio={false}
          viewId={opts.viewId as any}
          colorScheme={scheme}
          browser={browser}
          pannable
          zoomable
          dynamicViewVariant={opts.variant}
          {...({ fitView: !saved, onInitialized } as any)}
        />
      </LikeC4ModelProvider>
      </div>
    </div>
  )
}

function HostView(props: HostProps) {
  const { data, model, opts } = props
  if (data.state === 'loading') return <Notice kind="info">Loading LikeC4 view…</Notice>
  if (data.state === 'error') return <Notice kind="error">{data.message ?? 'LikeC4 view error'}</Notice>
  if (!model) return <Notice kind="error">LikeC4 model data is missing.</Notice>
  if (!model.model.findView(opts.viewId as any)) return <Notice kind="error">View "{opts.viewId}" not found.</Notice>
  return <Diagram {...props} model={model} />
}

let currentScheme: Scheme = 'light'
let docKey = ''

const FALLBACK_OPTS: HostOptions = { project: '', viewId: '', model: '', browser: false, variant: 'diagram', scheme: 'auto', maxHeight: 600 }

function schemeOf(opts: HostOptions | null): Scheme {
  return opts?.scheme === 'light' || opts?.scheme === 'dark' ? opts.scheme : currentScheme
}

const manager = new HostManager<ModelEntry>(document, {
  createRoot: container => createRoot(container),
  model: id => modelFor(id),
  extraKey: ({ opts }) => schemeOf(opts),
  view: ({ host, hostId, opts, data, model }) => (
    <HostView hostId={hostId} host={host} opts={opts ?? FALLBACK_OPTS} data={data} model={model} scheme={schemeOf(opts)} docKey={docKey} />
  ),
})

function scan(force = false) {
  docKey = documentKey()
  manager.scan(force)
  for (const id of [...models.keys()]) {
    if (!document.getElementById(id)) models.delete(id)
  }
}

function start() {
  currentScheme = vscodeScheme()
  clearOtherDocuments(documentKey())
  scan()
  new MutationObserver(() => {
    const s = vscodeScheme()
    if (s !== currentScheme) {
      currentScheme = s
      scan(true)
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

window.addEventListener('vscode.markdown.updateContent', () => scan())
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
else start()
