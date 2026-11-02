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
    const r = host.getBoundingClientRect()
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

/**
 * Shows the static snapshots at the saved viewport (same mapping as the interactive diagram),
 * so the switch to the interactive diagram does not move the content.
 */
export function applySavedViewportsToSnapshots(docKey: string) {
  for (const host of Array.from(document.querySelectorAll('.likec4-view'))) {
    const svg = host.querySelector(':scope > svg.likec4-static')
    if (!svg || host.shadowRoot) continue
    const v = loadViewport(docKey, host.id)
    if (!v) continue
    const r = svg.getBoundingClientRect()
    const w = r.width || v.w
    const h = r.height || v.h
    if (!(w > 0 && h > 0)) continue
    svg.setAttribute('viewBox', `${-v.x / v.zoom} ${-v.y / v.zoom} ${w / v.zoom} ${h / v.zoom}`)
  }
}
