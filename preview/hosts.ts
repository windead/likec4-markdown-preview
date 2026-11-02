/** Host lifecycle in the preview document, independent of React/LikeC4 (unit-testable). */
import type { HostData, HostOptions } from '../src/types'

export interface RootLike {
  render(node: unknown): void
  unmount(): void
}

export interface HostInput<M> {
  host: Element
  hostId: string
  opts: HostOptions | null
  data: HostData
  model: M | null
}

export interface HostManagerDeps<M extends { hash: string }> {
  createRoot(container: Element): RootLike
  /** Model for a model element id (cached by the caller), or null. */
  model(id: string): M | null
  /** Builds what to render for a host (a React element in production). */
  view(input: HostInput<M>): unknown
  /** Extra key component that forces re-render when it changes (e.g. color scheme). */
  extraKey?(input: HostInput<M>): string
  /**
   * Whether a host that is not mounted yet should be mounted now (e.g. only near the viewport).
   * Hosts that are skipped keep showing their light-DOM fallback.
   */
  shouldMount?(host: Element): boolean
}

interface Entry {
  root: RootLike
  shadow: ShadowRoot
  key: string | null
}

export function readJson<T>(el: Element | null): T | null {
  if (!el?.textContent) return null
  try {
    return JSON.parse(el.textContent) as T
  } catch {
    return null
  }
}

export class HostManager<M extends { hash: string }> {
  readonly entries = new Map<Element, Entry>()
  /** Hosts waiting to be mounted (not near the viewport yet). */
  readonly deferred = new Set<Element>()
  /** Number of renders performed (diagnostics/tests). */
  renders = 0

  constructor(private readonly doc: Document, private readonly deps: HostManagerDeps<M>) {}

  scan(force = false): void {
    for (const host of Array.from(this.doc.querySelectorAll('.likec4-view'))) {
      const data = readJson<HostData>(host.querySelector(':scope > script[type="application/json"]'))
      if (!data) continue
      const optsRaw = host.getAttribute('data-likec4-opts')
      let opts: HostOptions | null = null
      try {
        opts = optsRaw ? JSON.parse(optsRaw) : null
      } catch {
        opts = null
      }
      const model = opts && (data.state === 'ok' || data.state === 'stale') ? this.deps.model(opts.model) : null
      const input: HostInput<M> = { host, hostId: host.id, opts, data, model }
      const key = `${data.hash}|${model?.hash ?? ''}|${optsRaw ?? ''}|${this.deps.extraKey?.(input) ?? ''}`

      let entry = this.entries.get(host)
      if (!entry && this.deps.shouldMount && !this.deps.shouldMount(host)) {
        this.deferred.add(host)
        continue
      }
      this.deferred.delete(host)
      if (!entry) {
        const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
        const container = this.doc.createElement('div')
        shadow.appendChild(container)
        entry = { root: this.deps.createRoot(container), shadow, key: null }
        this.entries.set(host, entry)
      }
      if (!force && entry.key === key) continue
      entry.key = key
      this.renders++
      entry.root.render(this.deps.view(input))
    }
    for (const host of this.deferred) if (!host.isConnected) this.deferred.delete(host)
    for (const [host, entry] of this.entries) {
      if (!host.isConnected) {
        entry.root.unmount()
        this.entries.delete(host)
      }
    }
  }
}
