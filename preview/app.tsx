/**
 * Preview script injected into the built-in Markdown preview (markdown.previewScripts).
 * Finds `.likec4-view` hosts, mounts React into each host's shadow root, and re-renders
 * (without remounting) when the inline JSON changes.
 */
import { LikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, LikeC4View, pickViewBounds } from '@likec4/diagram'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { HostManager, markReady, readJson, unmarkReady } from './hosts'
import { clearOtherDocuments, documentKey, loadViewport, makeViewportSaver, isViewportUsable, type SavedViewport } from './viewport'
import type { HostData, HostOptions, ModelData } from '../src/types'

type Scheme = 'light' | 'dark'

interface ModelEntry {
  hash: string
  model: LikeC4Model<any>
  trimmed: boolean
}

const models = new Map<string, ModelEntry>()
/** Diagnostics for tests: viewport restore decisions. */
const diag: any = ((window as any).__likec4 ??= { log: [] as string[], marks: {} as Record<string, number> })
const debugLog: string[] = diag.log
const mark = (name: string) => {
  diag.marks[name] ??= Math.round(performance.now())
}
mark('appInit')
const debug = (m: string) => {
  if (debugLog.length < 200) debugLog.push(m)
}

function vscodeScheme(): Scheme {
  const c = document.body.classList
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast') && !c.contains('vscode-high-contrast-light') ? 'dark' : 'light'
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

/**
 * The wheel scrolls the Markdown page (it must not be captured by the diagram);
 * Ctrl/Cmd + wheel or pinch zooms, dragging pans.
 */
const REACT_FLOW_PROPS = { zoomOnScroll: false, panOnScroll: false, preventScrolling: false } as const

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

/** Current viewport, read from the rendered React Flow transform inside the nested shadow roots. */
function readViewport(host: Element): { x: number; y: number; zoom: number } | null {
  const inner = host.shadowRoot?.querySelector('.likec4-view')?.shadowRoot
  const el = inner?.querySelector<HTMLElement>('.react-flow__viewport')
  const m = el?.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)\s*scale\(([-\d.e]+)\)/)
  return m ? { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) } : null
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
  // a diagram mounted after an error/loading state: keep the snapshot until it is initialized
  // without a snapshot (sequence variant) there is nothing to show meanwhile: display the diagram
  // right away rather than an empty area
  useLayoutEffect(() => {
    if (host.querySelector(':scope > svg.likec4-static')) unmarkReady(host)
    else markReady(host)
  }, [host])
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])
  const browser = opts.browser && !data.trimmed
  const view = model.model.findView(opts.viewId as any)

  const onInitialized = ({ diagram, xyflow }: { diagram: any; xyflow: any }) => {
    cleanup.current?.()
    // The diagram is initialized with fit view (synchronously, before the first paint); a saved
    // viewport that still shows the view is applied right after (same rule as the snapshot).
    const frame = host.shadowRoot?.querySelector('[data-likec4-frame]')?.getBoundingClientRect()
    if (saved && frame && view?.isLayouted() && isViewportUsable({ ...saved, w: frame.width, h: frame.height }, pickViewBounds(view.$layouted as any, opts.variant))) {
      const viewport = { x: saved.x, y: saved.y, zoom: saved.zoom }
      let tries = 0
      const apply = () => {
        if (!host.isConnected) return
        diagram.send({ type: 'xyflow.setViewport', viewport, duration: 0 })
        // mark as manually moved so later container resizes do not re-fit the view
        diagram.send({ type: 'xyflow.viewportMoved', viewport, manually: true })
        const now = readViewport(host)
        const ok = !!now && Math.abs(now.x - Math.round(viewport.x)) < 1.5 && Math.abs(now.y - Math.round(viewport.y)) < 1.5 && Math.abs(now.zoom - viewport.zoom) < 1e-3
        if (!ok && ++tries < 20) requestAnimationFrame(apply)
        else {
          diag.restores = [...(diag.restores ?? []), { hostId, ok, retries: tries }]
          debug(`restore ${hostId}: ${ok ? 'ok' : 'failed'} (${tries} retries)`)
          markReady(host)
        }
      }
      apply()
    } else {
      // the initial fit is applied synchronously during initialization
      markReady(host)
    }
    cleanup.current = makeViewportSaver(host, docKey, hostId, () => readViewport(host) ?? xyflow.getViewport())
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
          reactFlowProps={REACT_FLOW_PROPS}
          {...({ fitView: true, onInitialized } as any)}
        />
      </LikeC4ModelProvider>
      </div>
    </div>
  )
}

function Ready({ host }: { host: Element }) {
  useEffect(() => markReady(host), [host])
  return null
}

function HostView(props: HostProps) {
  const { data, model, opts, host } = props
  useEffect(() => {
    // never keep the snapshot forever if the diagram does not initialize
    // with a snapshot to show, wait longer (cold start of large models); without one, fail fast
    const t = setTimeout(() => markReady(host), host.querySelector(':scope > svg.likec4-static') ? 15000 : 3000)
    return () => clearTimeout(t)
  }, [host])
  if (data.state === 'loading') return <><Ready host={host} /><Notice kind="info">Loading LikeC4 view…</Notice></>
  if (data.state === 'error') return <><Ready host={host} /><Notice kind="error">{data.message ?? 'LikeC4 view error'}</Notice></>
  if (!model) return <><Ready host={host} /><Notice kind="error">LikeC4 model data is missing.</Notice></>
  if (!model.model.findView(opts.viewId as any)) return <><Ready host={host} /><Notice kind="error">View "{opts.viewId}" not found.</Notice></>
  return <Diagram {...props} model={model} />
}

let currentScheme: Scheme = 'light'
let docKey = ''

const FALLBACK_OPTS: HostOptions = { project: '', viewId: '', model: '', browser: false, variant: 'diagram', scheme: 'auto', maxHeight: 600 }

function schemeOf(opts: HostOptions | null): Scheme {
  return opts?.scheme === 'light' || opts?.scheme === 'dark' ? opts.scheme : currentScheme
}

/** Mount only hosts within ~1 screen of the viewport; others keep their static snapshot. */
function nearViewport(host: Element): boolean {
  const r = host.getBoundingClientRect()
  const h = window.innerHeight || 800
  // first (synchronous) pass: only what is visible; later passes: within one screen around it
  return initialPass ? r.bottom > 0 && r.top < h : r.bottom > -h && r.top < 2 * h
}

let initialPass = false

const observer = typeof IntersectionObserver === 'undefined'
  ? null
  : new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) scan()
  }, { rootMargin: '100% 0px 100% 0px' })

const manager = new HostManager<ModelEntry>(document, {
  createRoot: container => createRoot(container),
  shouldMount: host => {
    if (!observer || nearViewport(host)) {
      observer?.unobserve(host)
      return true
    }
    observer.observe(host)
    return false
  },
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

/** Mounts the interactive diagrams. Called by the entry script once the page is shown. */
export function start() {
  mark('start')
  currentScheme = vscodeScheme()
  clearOtherDocuments(documentKey())
  initialPass = true
  flushSync(() => scan())
  initialPass = false
  mark('firstCommit')
  requestAnimationFrame(() => mark('interactiveFrame'))
  // mount the remaining hosts near the viewport in a later task (after the first paint)
  setTimeout(() => scan(), 0)
  requestAnimationFrame(() => mark('firstFrame'))
  new MutationObserver(() => {
    const s = vscodeScheme()
    if (s !== currentScheme) {
      currentScheme = s
      scan(true)
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('vscode.markdown.updateContent', () => scan())
}
