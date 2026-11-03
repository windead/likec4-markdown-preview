# Design: Markdown Preview for LikeC4

Renders ` ```likec4-view ` blocks in the built-in VS Code Markdown preview, with syntax compatible with mkdocs-likec4. This document describes the final design only.

## 1. Syntax

````markdown
```likec4-view [browser=true|false] [dynamic-variant=diagram|sequence] [project=<name>] [color-scheme=auto|light|dark]
<viewId>
```
````

- Fence handling follows mkdocs-likec4 1.2 (`parser.py`), so a block renders in VS Code exactly when it renders in MkDocs:
  - The fence uses backticks and its info string starts with `likec4-view` (followed by whitespace or the end). `~~~` fences are left to the original rule (plain code block), as MkDocs does not transform them.
  - The body is exactly one line, the view id (trimmed). Other bodies are not transformed by MkDocs; here they render an error block saying so.
  - Options are found with the same regular expressions (`\bbrowser=(true|false)\b`, `\bdynamic-variant=(diagram|sequence)\b`, `\bproject=(\S+)\b`, `\bcolor-scheme=(auto|light|dark)\b`) searched in the rest of the info string: any order, all optional, case-sensitive, first match wins; unknown options and invalid values are ignored and take their default. Unit tests compare against the output of mkdocs-likec4's own parser.

| Option | Default | Meaning |
|---|---|---|
| `browser` | `true` | Clicking the view opens the view browser overlay (element details, navigation); `false`: not interactive |
| `dynamic-variant` | `diagram` | Display of dynamic views; `sequence` is passed through to `dynamicViewVariant` |
| `project` | nearest project | Select a project in a multi-project workspace |
| `color-scheme` | setting `colorScheme` (`auto`) | `auto` follows the VS Code theme |

- View ids and project names must match `^[a-zA-Z][a-zA-Z0-9_-]*$`; otherwise an error block is rendered directly, without accessing the model.
- With `likec4MarkdownPreview.enabled=false`, `likec4-view` is passed back to the original fence rule and renders as a plain code block.

## 2. Project resolution

- Scan all workspace roots for `likec4.config.json`, `.likec4rc` and `likec4.config.{js,mjs,ts,mts}` (excluding `node_modules`). For JSON configs, `name` is the project name and the containing folder is the project root. Rescan when config files are added, removed or changed.
- **JS/TS configs are not executed.** They still take part in the nearest-project lookup (so a parent project is not picked by mistake), but render the error block "likec4.config.js/ts is not supported, use likec4.config.json". `bundle-require` and `esbuild` are replaced with stubs in the bundle.
- Without `project`: walk up from the Markdown file's folder to the nearest project root (as mkdocs-likec4 `_find_nearest_project`: the ancestor project root with the longest path). If none is found and the containing workspace root has no config files and contains `.c4`/`.likec4` files at its root, use that root's default project (named `default`); otherwise render "No LikeC4 project found".
- Still nothing found and the containing workspace root has exactly one project: use it (an MkDocs build from the docs root uses the only project for every page). With several, render "not inside a LikeC4 project; specify one with project=<name> (known: …)", matching the MkDocs build error "Specify exact project".
- With `project`: match by name among all discovered projects; if there is none, render an error block.
- Markdown outside the workspace: walk up from its folder looking for config files (file system lookups only, no scan).

## 3. Architecture

```
Extension host                                          Built-in Markdown preview webview
ProjectRegistry ── project discovery, nearest project    preview.js (previewScripts, IIFE)
ModelService (one per LikeC4 workspace root, lazy)       · scan .likec4-view hosts
  · Langium services from public APIs + new LikeC4()     · attachShadow + createRoot (first time)
  · disk: WithFileSystem(watch=true)                     · hash changed → root.render(new props)
  · unsaved: TextDocuments.set/delete + DocumentBuilder  · viewport in sessionStorage, keyed by
  · onModelUpdate → recompute used projects → hash         document + host id
  · cache project → {hash, state, model JSON}            · host removed → unmount
RefreshScheduler → runs markdown.preview.refresh once,
                   only when an affected document has an open preview
MarkdownItPlugin (synchronous, cache only) ── HTML ──▶
```

### 3.1 Extension host

- Activation: `onLanguage:markdown`.
- **ModelService**: one per LikeC4 workspace root (the VS Code workspace root containing the project, or the project root for Markdown outside the workspace), created lazily when first referenced by a render. Assembled from public APIs: `createLanguageServices({...WithFileSystem(true), ...WithLikeC4ManualLayouts, ...WithWasmGraphviz | WithGraphviz(new GraphvizBinaryAdapter())})`, `WorkspaceManager.initialize/initialized`, `new LikeC4(services)`. It does not subclass `LikeC4` or access `protected` members.
- **Unsaved edits**: listen to `onDidChangeTextDocument` for `.c4`/`.likec4` documents; after the `debounceMs` debounce, `TextDocuments.set(TextDocument.create(uri, 'likec4', version, text))` + `DocumentBuilder.update([uri], [])`. When the document is closed, `TextDocuments.delete(uri)` + `update` falls back to the disk contents.
- **Recomputation**: after `onModelUpdate(projectId)`, if the project is referenced by a rendered document, compute the layouted model with `layoutedModel(project)`. If the project `hasErrors()` (error-level diagnostics in its documents), the cache is not updated and the state becomes `stale` (last good result kept, with the first error). Recomputations within one ModelService run serially; a new request drops queued older ones.
- **Hash**: SHA-1 of the model JSON. An unchanged hash triggers no refresh.
- **Refresh**: `markdown.preview.refresh` force-reloads every Markdown preview, so it only runs when an affected project is referenced by a document that currently has an open preview, merged into one call (changes in several projects in the same event loop refresh once). The "document → project" references are recorded during markdown-it rendering; "currently open previews" are inferred from `TabInputWebview` tabs in `window.tabGroups` (`viewType` contains `markdown.preview`) and visible documents. If that inference fails, the rule falls back to "a document referencing the project is still open".
- **Loading**: while the cache is not ready, markdown-it outputs a `loading` placeholder; when the ModelService is ready, a refresh follows the rules above.
- **Log**: Output Channel "LikeC4 Markdown Preview" records project initialization, the duration of each recomputation, whether the hash changed, and refresh reasons. File contents are never logged.

### 3.2 HTML output

Each document gets one model per referenced project (stable id), and each block gets one host:

```html
<div class="likec4-model" id="likec4-model-<project>-<rootTag>" hidden><script type="application/json">{"hash":"…","trimmed":false,"model":{…LikeC4Model.Layouted $data…}}</script></div>
<div class="likec4-view" id="likec4-<project>-<rootTag>-<viewId>-<n>" data-likec4-opts='{"project":"…","viewId":"…","model":"likec4-model-…","browser":true,"variant":"diagram","scheme":"auto","maxHeight":600,"panZoom":false}'>
  <script type="application/json">{"hash":"…","state":"ok|loading|error|stale","message":"…","trimmed":false}</script>
  <svg class="likec4-static" viewBox="…" data-bounds="x y w h" …>…static snapshot…</svg>
</div>
```

- The model script is emitted right before the first host of its project (once per document). The id is on the outer `<div>`: when the built-in preview loads content and when morphdom adds nodes, `domEval` recreates `<script>` elements keeping only `type`/`src`/`nonce` and similar attributes, so an `id`/`class` on the `<script>` itself would be lost.
- `<rootTag>` is the first 6 hex digits of the SHA-1 of the ModelService root path, distinguishing same-named projects in different roots; host ids include `<project>-<rootTag>` as well.
- `<n>` is the occurrence number of the same `<project>-<viewId>` in the document, so morphdom matches the same element by id. Host attributes hold only options; data appears only in the `<script>` text.
- The host JSON `hash` = model hash + view state; the view itself is not inlined again.
- Before inlining, `<`, `>`, `&`, U+2028 and U+2029 in the JSON are escaped as `\uXXXX`.
- **Static snapshot**: the light DOM of `ok`/`stale` hosts contains an SVG generated by the extension host from the layout data (nodes, compound nodes, edges, labels; colors from the default LikeC4 theme; cache key is view hash + variant + max height). Element ids in the snapshot are prefixed with the host id, so they are unique in the page. No snapshot is generated for `dynamic-variant=sequence`. The snapshot is only a placeholder and is not meant to match the interactive diagram pixel for pixel; colors match LikeC4 and are the same in light and dark themes.
- Notices for stale and trimmed models are also emitted server-side, before the snapshot (`.likec4-notice`), matching the notice in the interactive diagram, so content does not shift down at handover.
- **Size limit**: when the UTF-8 size of the escaped model exceeds `maxModelBytes` (default 2 MiB), the model's `views` are trimmed to the views referenced by this document, hosts are forced to `browser=false` and show a notice. When every host in the document is `browser=false`, only the trimmed model is inlined as well.

### 3.3 Preview

- **Entry and lazy loading**: the `preview.js` entry is small. On `DOMContentLoaded` it first sets each static snapshot's `viewBox` to the viewport the interactive diagram will use: the saved viewport if there is one and the view is still visible in it, otherwise LikeC4's initial fit (16px padding, zoom in [0.05, 1], offsets rounded). It then `require`s the React/LikeC4 app after `load` (at most 250 ms). The webview swaps frames on the new document's `load` (or after a 200 ms fallback), so during a reload the first thing shown is the snapshot of the new content.
- After start-up the app scans once, then again after each `vscode.markdown.updateContent`. The first synchronous render (`flushSync`) mounts only hosts currently visible; hosts within one viewport height are mounted in the next task, and further ones by an `IntersectionObserver` as they come near. Unmounted hosts keep showing their snapshot. Mounted hosts are not recycled.
- New host: `attachShadow({mode:'open'})`; the shadow root contains, in order, styles, a hidden diagram container and a default `<slot>` (which keeps showing the snapshot from the light DOM). `createRoot` renders `LikeC4ModelProvider` + `LikeC4View` (`LikeC4View` creates another shadow root inside, injects the LikeC4 styles and puts the Mantine variables inside that shadow root). Once the diagram has initialized and restored its viewport, the container gets a ready flag and the diagram is shown instead of the slot. The ready flag lives inside the shadow root, out of morphdom's reach. Hosts without a snapshot (sequence variant) do not wait and are shown as soon as they mount; with a snapshot, the fallback for a host that never becomes ready is 15 seconds. When a host goes from error/loading to showing a diagram, its ready flag is cleared and it waits for initialization again. `LikeC4Model.create` results are cached per model hash and shared by hosts of the same project.
- Existing host: skipped when the host JSON, model hash, options and color scheme are unchanged; otherwise `root.render(new props)` without remounting.
- Host removed from the document: `unmount` and clean up.
- States: `loading` shows a placeholder; `error` shows an error block (no diagram); `stale` renders the last good model with a notice on top.
- Theme: `color-scheme=auto` reads the `vscode-light`/`vscode-dark`/`vscode-high-contrast` classes on `document.body` and watches them with a `MutationObserver`; `light`/`dark` are fixed.
- Size: the diagram frame is `min(100%, view width + 32px)` wide, keeps the aspect ratio of the layout bounds (`pickViewBounds(view, variant)`), has `max-height` = `maxHeight` and `min-height` = 160px, and is centered. The snapshot uses the same formula (inline style from the server); `LikeC4View` has its own `keepAspectRatio` turned off and fills the frame.
- Interaction (default, same as the mkdocs-likec4 web component, which renders `LikeC4View` with its defaults): the embedded diagram is static (`pannable=false`, `zoomable=false`) and fitted; the mouse wheel scrolls the Markdown page; with `browser=true`, clicking the canvas, a node or an edge opens the view browser overlay (pan, zoom, element details, navigation); `browser=false` views do not react to clicks. With the `panZoom` setting, embedded diagrams are also pannable (drag) and zoomable (Ctrl/⌘ + wheel or pinch); the wheel still scrolls the page (`reactFlowProps={zoomOnScroll:false, panOnScroll:false, preventScrolling:false}`).
- Viewport (only with `panZoom`; static views always show the initial fit, and their snapshots use the fit as well): stored in `sessionStorage` keyed by "document URI + host id". Interaction events are listened to in the capture phase on the host (React Flow stops propagation), writes are throttled, and the frame size is recorded. Only keys of the current document are kept. The diagram always initializes with `fitView=true` (with `fitView=false`, LikeC4 pan and zoom do not work). If the saved viewport still shows the view, it is restored in `onInitialized` through `diagram.send({type:'xyflow.setViewport'})`, followed by `xyflow.viewportMoved(manually)` so later container size changes do not fit again. On the morphdom path components are not remounted, so the viewport is kept naturally.
- Bundle: IIFE; `define` for `process.env.NODE_ENV`, `import.meta.env.DEV`, `import.meta.env.MODE`. No `eval`, no inserted `<script>`, no network requests.
- Test aid: with `sessionStorage['likec4-trace']='1'`, the entry records, frame by frame for about 4 seconds after loading, what each visible host shows (snapshot, diagram, blank) and its viewport. Recording starts at `DOMContentLoaded`; frames before that (webview already swapped but content not yet appended) cannot be observed from inside the page.

### 3.4 Update paths and known limitations

| Change | Path | Effect |
|---|---|---|
| Edit Markdown text or a block | Built-in preview non-forced update → morphdom | Hosts, shadow roots, React state and viewports all kept |
| Edit a `.c4` (including unsaved) | Debounce → recompute → hash changed → `markdown.preview.refresh` (full reload) | The new document first shows snapshots positioned at the saved viewport; the interactive diagram replaces them without a jump once ready; viewport restored from sessionStorage |
| `.c4` has errors | Cache not updated, `stale` | Last result kept with a notice |

Known limitations:
- A `.c4` change reloads every open Markdown preview that references an affected project. Transient state such as the browser overlay, the selection and dynamic-view stepping is lost after the reload.
- The reload path is bound by the VS Code preview's 300 ms throttle and loading of the new document; the interactive diagram is ready after about 1.2–1.4 s (excluding debounce), with the snapshot shown until then.
- For large models, the first full-model layout is a one-off cost (about 550 ms for `fixtures/large`); later incremental recomputations have a P95 of about 290 ms.

### 3.5 Log

Output Channel "LikeC4 Markdown Preview" records: `[projects]` project discovery, `[init]` workspace initialization time, `[edit]` unsaved text pushed, `[layout]` state, change, duration, view count and size of each recomputation, `[refresh]` refresh reasons, `[render]` number of blocks and duration of markdown-it rendering. File contents are never logged.

## 4. Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `likec4MarkdownPreview.enabled` | boolean | `true` | When off, blocks render as plain code blocks |
| `likec4MarkdownPreview.debounceMs` | number | `250` | Debounce for unsaved edits |
| `likec4MarkdownPreview.maxHeight` | number | `600` | Maximum view height (px) |
| `likec4MarkdownPreview.graphviz` | `wasm`/`binary` | `wasm` | Layout engine |
| `likec4MarkdownPreview.maxModelBytes` | number | `2097152` | Maximum inlined model size per project; beyond it the model is trimmed and browser is disabled |
| `likec4MarkdownPreview.colorScheme` | `auto`/`light`/`dark` | `auto` | Default for blocks without a valid `color-scheme` (mkdocs-likec4 `color_scheme`) |
| `likec4MarkdownPreview.panZoom` | boolean | `false` | Zoom and pan inside embedded views |

## 5. Scope and compatibility

- Read-only. No LSP client, no diagnostics and no completion, so it does not interfere with the official LikeC4 extension.
- The manifest declares `capabilities.untrustedWorkspaces: { supported: true }` (no workspace code is executed).
- Not included: go to source (`command:` URIs are not allowed in the preview; a `vscode://` URI approach may be evaluated later), notebooks, third-party previews, HTML/PDF export.
- `engines.vscode`: `^1.123.0`. This is the later of 1.63 (morphdom preview) and the earliest version whose desktop extension host Node satisfies the `engines.node` of every bundled dependency (`@likec4/language-server@1.60.0` requires ≥22.22.3): 1.122 ships Electron 39.8.8 / Node 22.22.1 (not enough), 1.123 ships Electron 42.3.0 / Node 24.15.0. Integration tests were run on VS Code 1.123.0 and 1.144.0.

## 6. Acceptance adjustments (relative to section 7.2 of the brief)

- E3: the brief's P95 < 1 s is bounded below by VS Code's forced reload path. ADVISOR ruled this non-blocking and set replacement thresholds (all excluding debounce, measured from pushing the unsaved text): extension-controlled segment (push → refresh issued) P95 ≤ 200 ms; new content visible (snapshot in place) P95 ≤ 1.5 s; interactive diagram ready is reported only. The viewport must also be kept, and an in-page per-frame trace (P1c) must show that in three cases (saved viewport, untouched view, saved viewport no longer showing the view) visible hosts have no blank frame and no fit-then-jump-back.
- E9: `ci-metrics` is not available on this machine, so a 10-view document on `fixtures/large` (a generated large model) is used instead; the same applies to the second model in 7.3.

## 7. ADVISOR rulings

| Item | Ruling |
|---|---|
| Updating on `.c4` changes | Forced refresh + viewport persistence (option A); refresh only previews that are affected and open |
| Model data for `browser=true` | One layouted model inlined per document per project; limit 2 MiB (setting); beyond it, trim views and disable browser; a single rendering path |
| `sequence` | Supported in the first version, passed through |
| `protected langium` | Not used; services assembled from public APIs |
| Go to source | Not in the first version |
| `engines.vscode` | Floor set by the Node version the dependencies declare, measured in the extension host |
| JS/TS configs | Not executed; `bundle-require`/`esbuild` stubbed; error block |
| Static snapshot + lazy entry | Accepted (removes blank frames during forced reloads); no snapshot for the sequence variant |
| Deferred mounting of off-screen hosts | Accepted; mounted hosts are not recycled |
| Full-model recomputation for large models | Accepted (incremental recomputation P95 287 ms < 500 ms); re-measure with a real large model |
| E3 latency | Non-blocking; replacement thresholds in §6; listed as a known limitation |

## 8. Changes after acceptance

| Change | Reason |
|---|---|
| Embedded views are static by default; zoom and pan are opt-in (`panZoom`) | Same behavior as mkdocs-likec4, whose web component uses `LikeC4View` defaults. The viewport persistence of §3.3 applies only with `panZoom` |
| Fence parsing ported from mkdocs-likec4 (single-line body, backtick fences, same option patterns) | A block renders here exactly when it renders in MkDocs |
| `colorScheme` setting | Counterpart of mkdocs-likec4's `color_scheme` plugin option |
| Single project of the workspace root used for documents outside every project | Same result as an MkDocs build from the docs root |
