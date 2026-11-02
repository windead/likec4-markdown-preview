/** Viewport persistence in sessionStorage, keyed by document + host id (survives preview reloads). */

export interface SavedViewport {
  x: number
  y: number
  zoom: number
  /** Size of the diagram area when saved. */
  w: number
  h: number
}

const PREFIX = 'likec4vp|'

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function viewportKey(docKey: string, hostId: string): string {
  return `${PREFIX}${docKey}|${hostId}`
}

export function loadViewport(docKey: string, hostId: string): SavedViewport | null {
  try {
    const raw = storage()?.getItem(viewportKey(docKey, hostId))
    if (!raw) return null
    const v = JSON.parse(raw)
    return [v.x, v.y, v.zoom, v.w, v.h].every(n => typeof n === 'number' && Number.isFinite(n)) && v.zoom > 0 ? v : null
  } catch {
    return null
  }
}

export function saveViewport(docKey: string, hostId: string, v: SavedViewport) {
  try {
    storage()?.setItem(viewportKey(docKey, hostId), JSON.stringify(v))
  } catch {
    // quota or disabled storage: ignore
  }
}

/** Drops saved viewports of other documents. */
export function clearOtherDocuments(docKey: string) {
  const s = storage()
  if (!s) return
  try {
    const mine = `${PREFIX}${docKey}|`
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i)
      if (k?.startsWith(PREFIX) && !k.startsWith(mine)) s.removeItem(k)
    }
  } catch {
    // ignore
  }
}

/**
 * True when the saved viewport still shows part of the view bounds
 * (otherwise the content moved out of sight and the caller should fit the view).
 */
export function isViewportUsable(v: SavedViewport, bounds: { x: number; y: number; width: number; height: number }): boolean {
  const left = -v.x / v.zoom
  const top = -v.y / v.zoom
  const right = left + v.w / v.zoom
  const bottom = top + v.h / v.zoom
  return right > bounds.x && left < bounds.x + bounds.width && bottom > bounds.y && top < bounds.y + bounds.height
}

/**
 * Saves the viewport after user interaction (wheel, drag, keyboard, double click), throttled.
 * Events from inside the shadow DOM are observed on the (light DOM) host element.
 */
export function makeViewportSaver(
  host: Element,
  docKey: string,
  hostId: string,
  get: () => { x: number; y: number; zoom: number },
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    timer = undefined
    const frame = host.shadowRoot?.querySelector('[data-likec4-frame]') ?? host
    const r = frame.getBoundingClientRect()
    const v = get()
    saveViewport(docKey, hostId, { x: v.x, y: v.y, zoom: v.zoom, w: r.width, h: r.height })
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(save, 250)
  }
  const events = ['wheel', 'pointerup', 'pointermove', 'keyup', 'dblclick', 'touchend', 'click'] as const
  // capture phase: React Flow (d3-zoom) stops propagation of wheel/pointer events inside the diagram
  for (const e of events) host.addEventListener(e, schedule, { passive: true, capture: true })
  return () => {
    clearTimeout(timer)
    for (const e of events) host.removeEventListener(e, schedule, { capture: true })
  }
}

/** URI of the previewed document (from the preview's settings), used to scope saved viewports. */
export function documentKey(): string {
  try {
    const raw = document.getElementById('vscode-markdown-preview-data')?.getAttribute('data-settings')
    const source = raw ? JSON.parse(raw).source : undefined
    return typeof source === 'string' ? source : location.pathname
  } catch {
    return location.pathname
  }
}

/** Bounds of a view as written by the extension (`data-bounds="x y w h"`). */
export function snapshotBounds(svg: Element): { x: number; y: number; width: number; height: number } | null {
  const v = (svg.getAttribute('data-bounds') ?? '').split(' ').map(Number)
  return v.length === 4 && v.every(Number.isFinite) && v[2]! > 0 && v[3]! > 0 ? { x: v[0]!, y: v[1]!, width: v[2]!, height: v[3]! } : null
}

/** LikeC4's initial fit (xyflow getViewportForBounds, 16px padding, zoom in [0.05, 1], rounded offsets). */
export function fitViewport(b: { x: number; y: number; width: number; height: number }, width: number, height: number) {
  const pad = 16
  const zoom = Math.min(Math.max(Math.min((width - 2 * pad) / b.width, (height - 2 * pad) / b.height), 0.05), 1)
  return {
    x: Math.round(width / 2 - (b.x + b.width / 2) * zoom),
    y: Math.round(height / 2 - (b.y + b.height / 2) * zoom),
    zoom,
  }
}

/**
 * Positions each static snapshot exactly like the interactive diagram will be:
 * at the saved viewport when it still shows the view, otherwise at LikeC4's fit view.
 */
export function positionSnapshots(docKey: string) {
  for (const host of Array.from(document.querySelectorAll('.likec4-view'))) {
    const svg = host.querySelector(':scope > svg.likec4-static')
    if (!svg || host.shadowRoot) continue
    const bounds = snapshotBounds(svg)
    const r = svg.getBoundingClientRect()
    if (!bounds || !(r.width > 0 && r.height > 0)) continue
    const saved = loadViewport(docKey, host.id)
    const v = saved && isViewportUsable({ ...saved, w: r.width, h: r.height }, bounds) ? saved : fitViewport(bounds, r.width, r.height)
    svg.setAttribute('viewBox', `${-v.x / v.zoom} ${-v.y / v.zoom} ${r.width / v.zoom} ${r.height / v.zoom}`)
  }
}

/**
 * Test aid (enabled with sessionStorage['likec4-trace'] = '1'): records, on every animation frame
 * for a few seconds after load, what each host shows (snapshot / interactive / nothing) and its
 * viewport, into window.__likec4.trace.
 */
export function startTrace() {
  let on = false
  try {
    on = window.sessionStorage.getItem('likec4-trace') === '1'
  } catch {}
  if (!on) return
  const out: unknown[] = ((window as any).__likec4.trace = [])
  const t0 = performance.now()
  const tick = () => {
    const hosts = []
    for (const host of Array.from(document.querySelectorAll('.likec4-view'))) {
      const r = host.getBoundingClientRect()
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue
      const ready = !!host.shadowRoot?.querySelector('.likec4-root[data-ready]')
      const svg = ready ? null : host.querySelector(':scope > svg.likec4-static')
      const inner = host.shadowRoot?.querySelector('.likec4-view')?.shadowRoot
      const nodes = inner?.querySelectorAll('.react-flow__node') ?? []
      const visibleNodes = [...nodes].filter(n => (n as HTMLElement).style.visibility !== 'hidden').length
      hosts.push({
        id: host.id,
        shows: !ready ? (svg ? 'snapshot' : 'nothing') : visibleNodes > 0 || host.shadowRoot?.querySelector('[data-likec4-notice]') ? 'interactive' : 'nothing',
        viewBox: svg?.getAttribute('viewBox') ?? null,
        transform: (inner?.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? null,
        notice: !!host.shadowRoot?.querySelector('[data-likec4-notice]'),
      })
    }
    out.push({ t: Math.round(performance.now() - t0), hosts })
    if (performance.now() - t0 < 4000) requestAnimationFrame(tick)
  }
  tick()
}
