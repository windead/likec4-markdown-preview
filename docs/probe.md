# Step 0 probe record

## Environment

| Item | Value |
|---|---|
| Host | WSL2 Ubuntu 24.04, Node 22.16 (scripts) / 26.13 |
| VS Code under test | 1.144.0 (Electron 43.8.3, extension host Node 24.22.1), downloaded by `@vscode/test-electron`, separate user-data/extensions folders |
| Driver | `_electron` from `playwright-core@1.64.0`, `xvfb-run` virtual display (1600×1000) |
| LikeC4 | `@likec4/language-services` / `@likec4/diagram` / `@likec4/core` all at 1.60.0 |
| Fixtures | `fixtures/shop` (element ×2, dynamic, deployment views), `fixtures/billing` (element view); `fixtures/docs/sample.md` contains 4 `likec4-view` blocks |

Prototype code is in `probes/`:

- `probes/ext/`: prototype extension (markdown-it fence → host element + inline JSON; preview script mounts a shadow root + React).
- `probes/build.mjs`: esbuild bundling (extension CJS / preview IIFE).
- `probes/run-vscode.mjs`: drives a real VS Code with Playwright, reads the DOM inside the preview webview, interacts, takes screenshots, writes `report.json`.
- `probes/p2-unsaved.mjs`: Node script for P2.
- `probes/check-fixtures.mjs`, `probes/size-breakdown.mjs`: fixture checks, size breakdown.

To reproduce:

```bash
node probes/build.mjs
xvfb-run -a -s "-screen 0 1600x1000x24" node probes/run-vscode.mjs <code executable> <output dir>
node probes/p2-unsaved.mjs fixtures
```

## Summary

| # | Probe | Result |
|---|---|---|
| P1 | morphdom keeps hosts | **Partial pass**: on incremental updates caused by Markdown document changes, hosts, shadow roots, React state and viewports are all kept; but `markdown.preview.refresh` is a **forced full page reload**, so the brief's path "`.c4` change → `markdown.preview.refresh`" (section 3.3) cannot keep state (see P1 details) |
| P2 | Unsaved text sync | Pass, without accessing `protected langium` |
| P3 | Shadow DOM rendering | Pass |
| P4 | Layout in the extension host | Pass |
| P5 | Bundle size | Recorded |

## P1 morphdom keeps hosts

**Method**: the fence emits `<div class="likec4-view" id="likec4-shop-<viewId>-<n>" data-likec4-opts='…'><script type="application/json">…</script></div>`. The preview script runs `attachShadow` + `createRoot` for each host and renders, inside the shadow root, a counter with `useState`, the `counter` from the JSON, and the LikeC4 view. A JS property token is set on the host to tell whether it is the same object. Playwright clicks the counter 3 times and zooms/pans the first view, then triggers an update in two ways:

- **P1a**: the extension edits the Markdown document (document version changes) and increments `counter` in the JSON;
- **P1b**: only `counter` in the JSON changes, then `markdown.preview.refresh` runs.

**Results**:

| Metric | P1a (Markdown edit) | P1b (`markdown.preview.refresh`) |
|---|---|---|
| Preview iframe | Same frame | Old frame destroyed, new frame created |
| Host element / shadow root | Same objects (token matches, `shadowRoot === saved reference`) | New |
| React mount count | 4 → 4 (not remounted, `root.render` count 1 → 2) | Remounted on the new page |
| Counter state | `clicks:3` → `clicks:3` | Reset |
| JSON update | `0` → `1` | `2` |
| Viewport | `translate(19px,245px) scale(1.364)` kept | Reset to fit view `scale(0.9)` |
| Update time | About 0.5–1.6 s (includes VS Code's 300 ms throttle and Playwright polling) | — |

Screenshots: `docs/probe/p1a-after-md-edit.png` (counter, JSON and zoom position all kept after the edit), `docs/probe/p1b-during-forced-refresh.png`.

**Cause (VS Code 1.144 source `extensions/markdown-language-features/src/preview/preview.ts`)**:

- `markdown.preview.refresh` → `MarkdownPreviewManager.refresh()` → `DynamicMarkdownPreview.refresh()` → `MarkdownPreview.refresh(true)`. `forceUpdate=true` makes `shouldReloadPage` true, so it takes the `renderDocument` full replacement path, not `updateContent`/morphdom.
- Non-forced refreshes are triggered only by `onDidChangeTextDocument` / file watching of the Markdown document itself, and `#updatePreview` compares `(uri, document.version)` and returns early if the version did not change. Configuration changes and contribution changes also use forced refreshes.
- Therefore: **when only a `.c4` changes and the Markdown does not, no public mechanism refreshes through morphdom.**

**Additional observations from P1b** (data for an alternative):

- When the VS Code webview swaps content, it loads the new iframe in the background and then swaps. A sampled timeline (counting rendered nodes per frame every ~10–150 ms) shows the old frame keeping 19 nodes until the swap; for about 400 ms after the swap the new frame has only 9/19 rendered (views outside the viewport not finished yet), then all. No blank frame in the visible area appeared in the screenshot sequence.
- The preview webview's `sessionStorage` and `localStorage` survive the forced reload (the new page reads values written by the previous one), which can be used to restore viewports across reloads.
- The scroll position is restored by the built-in preview itself.

**Other confirmations about the morphdom path**:

- The preview does no HTML sanitizing (no DOMPurify); `<script type="application/json">` is kept as is. When nodes are added, `domEval` recreates `<script>` elements but keeps the `type` attribute, so they are not executed.
- `areNodesEqual` compares light DOM only (`isEqualNode`, `textContent`, attributes); shadow roots are not compared.
- In 1.144, `areNodesEqual` lives in `preview-src/index.ts` (the brief's `src/util/previewNodeEquality.ts` does not exist in that version).

## P2 Unsaved text sync

**Method**: no `LikeC4` subclass and no access to `protected langium`; the services are assembled from public APIs instead:

```ts
const services = createLanguageServices({          // @likec4/language-server/module
  ...WithFileSystem(watch),                         // @likec4/language-server/filesystem
  ...WithLikeC4ManualLayouts,
  ...WithWasmGraphviz,                              // or WithGraphviz(new GraphvizBinaryAdapter())
})
// WorkspaceManager.initialize/initialized as in fromWorkspace
const likec4 = new LikeC4(services)                 // the LikeC4 constructor is public
// unsaved text: public Langium API
services.shared.workspace.TextDocuments.set(TextDocument.create(uri, 'likec4', version, text))
await services.shared.workspace.DocumentBuilder.update([uri], [])
// closing an unsaved document: delete, then update, falls back to disk
services.shared.workspace.TextDocuments.delete(uri)
```

Why it works: Langium 4.4's `DefaultLangiumDocumentFactory.update()` reads `TextDocuments.get(uri)` first and the file system only if there is none.

**Results** (`node probes/p2-unsaved.mjs fixtures`):

| Step | Result |
|---|---|
| Disk contents | `customer` title is `Customer` |
| Overlay changes the title to `Buyer` | `onModelUpdate('shop')` fires 14 ms after the update; `layoutView` returns `Buyer`; no errors |
| Overlay introduces a syntax error | `hasErrors()` is true; **`layoutView` still returns a result** (Langium recovers from parse errors; title still `Buyer`) |
| Overlay removed | Back to `Customer`, `hasErrors()` is false |
| Edit → single-view re-layout | 25 ms |

Conclusion: the `stale` decision cannot rely on whether a layout is produced; it must use `hasErrors()` (or diagnostics filtered by project), and the cache is not updated while there are errors.

## P3 Shadow DOM rendering

**Method**: render `<LikeC4ModelProvider likec4model={LikeC4Model.create(layoutedData)}><LikeC4View viewId … /></LikeC4ModelProvider>` inside the host's shadow root. `LikeC4View` creates another shadow root inside, injects the LikeC4 styles itself, and puts the Mantine CSS variables and `data-mantine-color-scheme` on `.likec4-shadow-root` inside that shadow root (`cssVariablesSelector`/`getRootElement`); the `@font-face` rules are injected into `document.head`.

**Results**:

- All 4 views (element ×2, dynamic, deployment) render, with node/edge counts 3/2, 6/4, 5/4, 5/2; each inner shadow root contains 3 `<style>` elements. Screenshot `docs/probe/p3-render.png`.
- Styles are complete: node font is `IBM Plex Sans Variable`, Mantine variables (`--mantine-color-body`) apply inside the shadow root, dark theme is correct.
- Interaction: wheel pans (`translate` y 41→191), Ctrl+wheel zooms (scale 0.9→1.364), drag pans; with `browser=true`, clicking an element opens the browser overlay (a second react-flow instance + dialog with navigation and zoom controls), screenshot `docs/probe/p3-browser-overlay.png`.
- Under the preview CSP (strict: `script-src 'nonce-…'`, `style-src 'unsafe-inline'`, no `unsafe-eval`, `default-src 'none'`) the console shows no related errors.
- Finding: `@likec4/diagram` contains Vite-style `import.meta.env.DEV`/`MODE` (in editor-related modules), which are `undefined` in an esbuild IIFE. **The second `root.render` throws `Cannot read properties of undefined (reading 'DEV')` and React 19 unmounts the whole tree.** Fixed by `define`-ing both constants at bundle time.
- The preview script must be bundled as an IIFE (`markdown.previewScripts` are loaded as classic `<script nonce>`).

## P4 Layout in the extension host

`fromWorkspace(fixtures, { graphviz: 'wasm' })` works in the VS Code 1.144 extension host (Electron 43 / Node 24.22.1):

| Metric | Value |
|---|---|
| Initialization (2 projects, 2 documents) | 738 ms |
| `layoutedModel('shop')` (4 views, first time) | 305 ms |
| Single view `layoutView` (cache hit) | 0–1 ms |
| `shop` layouted model `$data` JSON | 15 975 bytes |

Plain Node 22 (script) for comparison: initialization 469 ms, full `shop` layout 91 ms, `billing` 196 ms (including first wasm load).

## P5 Bundle size

Prototype (esbuild, minified):

| Output | Raw | gzip |
|---|---|---|
| `extension.js` (extension, CJS) | 3 250 856 B | 1 273 268 B |
| `preview.js` (preview, IIFE) | 2 493 623 B | 714 002 B |

Main contributors (`probes/size-breakdown.mjs`):

- Extension: `@hpcc-js/wasm-graphviz` 796 KB (wasm inlined), `@likec4/core` 613 KB, `zod` 445 KB, `@likec4/language-server` 416 KB, `langium` 188 KB, `chevrotain` 91 KB, `esbuild` (JS wrapper) 43 KB.
- Preview: `@likec4/diagram` 829 KB, `@likec4/core` 458 KB, `@mantine/core` 243 KB, `react-dom` 206 KB, `@likec4/styles` 97 KB, `motion-dom` 94 KB, `@xyflow/react` 81 KB.

The VSIX only needs the two outputs and the manifest; expected around 2 MB (zip).

## Other findings

1. **`bundle-require` / esbuild**: `@likec4/config` statically imports the optional peer `bundle-require` (used to load `likec4.config.{js,ts}`), which depends on the native esbuild binary. Without it, `@likec4/language-services` fails to load entirely; once bundled, esbuild's JS layer is included but loading a JS/TS config still needs the native binary for the platform at runtime.
2. **Node version requirement**: `@likec4/language-server@1.60.0` declares `engines.node >=22.22.3`, `chokidar@5` declares `>=20.19.0`. Node bundled with VS Code versions (`remote/.npmrc`): 1.100 → 20.19.0, 1.104 → 22.18.0, 1.108 → 22.21.1, 1.112 → 22.22.0, 1.120 → 22.22.1, 1.130 → 24.18.0.
3. **When morphdom became available**: `preview-src/index.ts` uses morphdom and dispatches `vscode.markdown.updateContent` since VS Code 1.63 (not in 1.62).
4. **How the LikeC4 components fit together**: `LikeC4View` takes the view by `viewId` from the **layouted model** in `LikeC4ModelProvider`; with `browser=true`, the browser overlay takes other views from the same model. The official VS Code preview panel uses `LikeC4ModelProvider` (computed model) + `LikeC4Diagram view={LayoutedView}`.
5. **`dynamic-variant=sequence`**: the props of `LikeC4View`/`LikeC4Diagram` 1.60 include `dynamicViewVariant` (`DynamicViewDisplayVariant`), which can be passed through; `pickViewBounds(view, variant)` gives the bounds per variant.
6. Direct dependencies: the P2 approach requires `@likec4/language-server`, `langium` and `vscode-languageserver-textdocument` as direct dependencies pinned to exact versions (matching what `@likec4/*` 1.60.0 uses: langium 4.4.0).

## For ADVISOR to decide

1. **Alternative for P1** (blocking): how to update the preview on `.c4` changes.
2. The items of section 3.6 of the brief: how to inline the model data for `browser=true` and its limit, `sequence` in the first version, `protected langium` (P2 gives a public API approach), go to source, the `engines.vscode` floor (constrained by the Node version requirement).
3. How to support `likec4.config.{js,ts}` (`bundle-require`/native esbuild binary).
