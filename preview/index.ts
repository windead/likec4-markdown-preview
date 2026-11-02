/**
 * Entry of the preview script (markdown.previewScripts). Kept tiny: the React/LikeC4 app is
 * `require`d lazily so its initialization does not block the page from being shown.
 * Until then each host shows its static SVG snapshot (positioned at the saved viewport).
 */
import { applySavedViewportsToSnapshots, documentKey } from './viewport'

const diag = ((window as any).__likec4 ??= { log: [] as string[], marks: {} as Record<string, number> })
diag.marks.scriptStart ??= Math.round(performance.now())

function startApp() {
  if (diag.started) return
  diag.started = true
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require('./app') as typeof import('./app')
  app.start()
}

function onReady() {
  applySavedViewportsToSnapshots(documentKey())
  // let the webview show the new document (it swaps frames on `load`) before the heavy work
  if (document.readyState === 'complete') setTimeout(startApp, 0)
  else {
    window.addEventListener('load', () => setTimeout(startApp, 0), { once: true })
    setTimeout(startApp, 250)
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true })
else onReady()
