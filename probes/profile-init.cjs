// Profiles top-level init of dist/preview.js under jsdom (node --cpu-prof).
const { JSDOM } = require('jsdom')
const fs = require('fs')
const dom = new JSDOM('<!doctype html><body><div class="markdown-body"></div></body>', { pretendToBeVisual: true })
for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'MutationObserver', 'CustomEvent', 'Event', 'sessionStorage', 'localStorage', 'location', 'matchMedia', 'performance'])
  try { globalThis[k] ??= dom.window[k] } catch {}
globalThis.window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })
const code = fs.readFileSync(process.argv[2], 'utf8')
const t = performance.now()
try { new Function(code).call(globalThis) } catch (e) { console.log('err', e.message.slice(0, 200)) }
console.log('init ms', Math.round(performance.now() - t))
