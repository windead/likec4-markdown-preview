// Probe preview script for P1/P3. Not production code.
import { LikeC4Model } from '@likec4/core/model'
import { LikeC4ModelProvider, LikeC4View } from '@likec4/diagram'
import { useEffect, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

type Payload = { hash: string; state: string; viewId: string; counter: number; model?: any }
type Entry = { root: Root; lastHash: string | null; shadow: ShadowRoot; token: number; renders: number }

const entries = new Map<Element, Entry>()
let mounts = 0
let tokenSeq = 0
const errors: string[] = []
let prevSession: string | null = null
let prevLocal: string | null = null
try {
  prevSession = sessionStorage.getItem('probe-load')
  sessionStorage.setItem('probe-load', String(Date.now()))
} catch (e) {
  prevSession = 'ERR ' + String(e)
}
try {
  prevLocal = localStorage.getItem('probe-load')
  localStorage.setItem('probe-load', String(Date.now()))
} catch (e) {
  prevLocal = 'ERR ' + String(e)
}
window.addEventListener('error', e => errors.push(String(e.message)))

function scheme(): 'light' | 'dark' {
  const c = document.body.classList
  return c.contains('vscode-dark') || c.contains('vscode-high-contrast') ? 'dark' : 'light'
}

function Counter({ id }: { id: string }) {
  const [clicks, setClicks] = useState(0)
  useEffect(() => {
    mounts++
  }, [])
  return (
    <button data-probe-counter={id} onClick={() => setClicks(c => c + 1)} style={{ fontSize: 11 }}>
      clicks:{clicks}
    </button>
  )
}

function App({ data, id, browser }: { data: Payload; id: string; browser: boolean }) {
  const model = useMemo(() => (data.model ? LikeC4Model.create(data.model) : null), [data.model])
  return (
    <div>
      <Counter id={id} />
      <span data-probe-json-counter>{data.counter}</span>
      {model
        ? (
          <LikeC4ModelProvider likec4model={model}>
            <LikeC4View
              viewId={data.viewId as any}
              colorScheme={scheme()}
              browser={browser}
              pannable
              zoomable
              controls={false}
            />
          </LikeC4ModelProvider>
        )
        : <div>loading…</div>}
    </div>
  )
}

function scan() {
  for (const host of Array.from(document.querySelectorAll('.likec4-view'))) {
    const script = host.querySelector(':scope > script[type="application/json"]')
    if (!script) continue
    let data: Payload
    try {
      data = JSON.parse(script.textContent ?? '')
    } catch (e) {
      errors.push('json: ' + String(e))
      continue
    }
    let entry = entries.get(host)
    if (!entry) {
      const shadow = host.attachShadow({ mode: 'open' })
      const container = document.createElement('div')
      shadow.appendChild(container)
      entry = { root: createRoot(container, { onUncaughtError: (e: any) => errors.push('uncaught: ' + String(e?.stack ?? e).slice(0, 600)), onCaughtError: (e: any) => errors.push('caught: ' + String(e?.stack ?? e).slice(0, 600)) }), lastHash: null, shadow, token: ++tokenSeq, renders: 0 }
      ;(host as any).__probeToken = entry.token
      entries.set(host, entry)
    }
    if (entry.lastHash !== data.hash) {
      const opts = JSON.parse(host.getAttribute('data-likec4-opts') ?? '{}')
      entry.root.render(<App data={data} id={host.id} browser={opts.browser !== false} />)
      entry.lastHash = data.hash
      entry.renders++
    }
  }
  for (const [host, entry] of entries) {
    if (!host.isConnected) {
      entry.root.unmount()
      entries.delete(host)
    }
  }
  ;(window as any).__probe = {
    get mounts() {
      return mounts
    },
    errors,
    prevSession,
    prevLocal,
    hosts: () =>
      Array.from(entries.entries()).map(([h, e]) => ({
        id: h.id,
        token: e.token,
        tokenOnEl: (h as any).__probeToken,
        sameShadow: h.shadowRoot === e.shadow,
        renders: e.renders,
        lastHash: e.lastHash,
      })),
  }
}

window.addEventListener('vscode.markdown.updateContent', scan)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
else scan()
