# Task: Markdown Preview for LikeC4 (VS Code extension)

This brief covers design, development and acceptance. The work follows a two-party gate between the implementer and a reviewer (ADVISOR): joint plan review → agreement at each step → final review (see section 9).

## 1. Goal

Render LikeC4 views in the built-in VS Code Markdown preview, with syntax compatible with [mkdocs-likec4](https://github.com/doubleSlashde/mkdocs-likec4):

````markdown
```likec4-view
service-context
```
````

When done:

- The same Markdown file is written the same way for an mkdocs-likec4 site and the VS Code preview, and renders in both.
- After editing the Markdown or a `.c4` file (including unsaved edits), the views in the preview update within 1 second, without flicker and without losing zoom and pan — the same experience as the preview panel of the official LikeC4 extension.
- The built-in Markdown rendering is not replaced, and the extension coexists with other Markdown extensions (such as Mermaid).

## 2. Required reading

| Material | Purpose |
|---|---|
| [VS Code Markdown Extension Guide](https://code.visualstudio.com/api/extension-guides/markdown-extension) | `markdown.markdownItPlugins`, `markdown.previewScripts`, `markdown.previewStyles` |
| VS Code source `extensions/markdown-language-features/preview-src/index.ts` (the `updateContent` branch), `src/util/previewNodeEquality.ts` | The preview merges with morphdom; `areNodesEqual` compares light DOM only and ignores `data-line`; the `vscode.markdown.updateContent` event |
| mkdocs-likec4 source `mkdocs_likec4/parser.py`, `plugin.py` | Fence syntax, options, nearest-project lookup |
| LikeC4 repo `packages/vscode/src/panel/useDiagramPanel.ts`, `panel/activateMessenger.ts`, `useRpc.ts` | How the official preview updates: model change notification → webview invalidates and refetches → components are not remounted |
| LikeC4 repo `packages/vscode-preview/src/state.ts`, `screens/View.tsx` | How the official preview renders a `LayoutedView` |
| LikeC4 repo `packages/language-server/src/Rpc.ts` | Use of `LangiumDocuments` / `DocumentBuilder` and debouncing of change notifications |
| npm `likec4@1.60.0` type definitions (`LikeC4.fromWorkspace`, `LikeC4Options.watch`), the `LikeC4` class of `@likec4/language-services` (`layoutedModel()`, `onModelUpdate()`, `protected langium`) | Model service in the extension host |
| `LikeC4View` / `LikeC4Diagram` type definitions in `@likec4/diagram` | Rendering components and props in the preview |

## 3. Design

### 3.1 Syntax

- The fence info string starts with `likec4-view`. The first non-empty line of the body is the view id; other lines are ignored.
- Options go in the info string, separated by spaces, in any order, all optional, as in mkdocs-likec4:

| Option | Values | Default | Meaning |
|---|---|---|---|
| `browser` | `true` / `false` | `true` | Allow opening element details and navigating between views |
| `dynamic-variant` | `diagram` / `sequence` | `diagram` | How dynamic views are displayed |
| `project` | LikeC4 project name | nearest project | Select a project in a multi-project workspace |
| `color-scheme` | `auto` / `light` / `dark` | `auto` | `auto` follows the VS Code theme |

- View ids and project names must match `^[a-zA-Z][a-zA-Z0-9_-]*$`; otherwise an error block is rendered and the model is not accessed.
- Unknown options are ignored without error (same as mkdocs-likec4).

### 3.2 Project resolution

- Scan the workspace (every root of a multi-root workspace) for `likec4.config.json` / `.likec4rc` / `likec4.config.{js,ts}`. The `name` is the project name and the containing folder is the project root.
- Without `project`, walk up from the Markdown file's folder to the nearest project root (same rule as mkdocs-likec4 `_find_nearest_project`). If none is found and the workspace has a single default project (no config files, `.c4` files in the root), use the default project; otherwise render a "no LikeC4 project found" error block.
- For Markdown files outside the workspace, walk up from the file's folder; if still nothing is found, render an error block.

### 3.3 Architecture

```
Extension host (Node)                                   Built-in Markdown preview webview
┌────────────────────────────────────────┐          ┌───────────────────────────────────────┐
│ ModelService (one per project)          │          │ preview.js (previewScripts, bundled)  │
│  · subclass of LikeC4 exposing langium  │          │  · scans .likec4-view host elements   │
│  · disk: fromWorkspace(root, watch)     │          │  · first time: attachShadow + styles  │
│  · unsaved: onDidChangeTextDocument →   │          │         + createRoot                  │
│    DocumentBuilder.update (debounced)   │          │  · each updateContent: read JSON,     │
│  · onModelUpdate → re-layout used views │          │    root.render(new props) on change   │
│  · cache viewId → {hash, LayoutedView}  │          │  · viewport saved per host id         │
│  · views changed → markdown.preview.    │          │  · host removed → root.unmount()      │
│    refresh                              │          │                                       │
│ MarkdownItPlugin (synchronous)          │  HTML    │                                       │
│  · fence → host element + inline JSON   │ ───────▶ │ React + @likec4/diagram (shadow DOM)  │
│  · cache not ready → placeholder        │          └───────────────────────────────────────┘
└────────────────────────────────────────┘
```

**Host element** (output of the markdown-it plugin):

```html
<div class="likec4-view" id="likec4-<project>-<viewId>-<n>"
     data-likec4-opts='{"browser":true,"variant":"diagram","scheme":"auto"}'>
  <script type="application/json">{ "hash": "...", "state": "ok", "view": { …LayoutedView… } }</script>
</div>
```

- Stable `id`: `<n>` is the occurrence number of the view in the document, so morphdom matches the same element by id.
- Host attributes hold only options, never the hash or data. Data changes appear only in the `<script>` text, so morphdom changes only that text node and keeps the host element and its shadow root.
- Before inlining, `<`, `>`, `&`, U+2028 and U+2029 in the JSON are escaped as `\u` sequences, to prevent `</script>` truncation and injection.
- `state` values: `ok`; `loading` (cache not ready); `error` (with `message`, e.g. unknown view, unknown project, model fails to parse and there is no earlier result); `stale` (the model currently has errors, `view` is the last good result, with `message`).

**Preview update rules**:

1. Scan once on `DOMContentLoaded` and after each `vscode.markdown.updateContent`.
2. New host: `attachShadow({mode:'open'})`, inject the `@likec4/diagram` styles into the shadow root (as `<style>` or a constructable stylesheet), `createRoot` and render.
3. Existing host: read the JSON; skip if `hash` is unchanged; otherwise call `root.render` with the new `view` without remounting.
4. Mounted hosts that disappeared from the document: `unmount` and clean up.
5. With `color-scheme=auto`, read the `vscode-light` / `vscode-dark` / `vscode-high-contrast` classes on `document.body` and watch for theme changes with a `MutationObserver`.
6. View height: keep the aspect ratio of the layout bounds within the preview width, capped by the `maxHeight` setting; beyond that, users zoom and pan inside the diagram.
7. Viewport (zoom and pan) is kept in memory keyed by host id, and survives data updates of the same host, unless the view bounds change so that the content is entirely out of view (then fit the view).

**Extension host update rules**:

1. Activation: `onLanguage:markdown`. A project's ModelService is created lazily, when a view of that project is first rendered.
2. Disk changes use `watch: true`. Unsaved edits: listen to `onDidChangeTextDocument` for LikeC4 documents, debounce by the `debounceMs` setting (default 250), write to the Langium document and `DocumentBuilder.update`. When an unsaved document is closed, fall back to the disk contents.
3. After `onModelUpdate(projectId)`, re-layout only views this extension has rendered (keep a "project → referenced views" set) and compare layout hashes; run `markdown.preview.refresh` once only if something changed.
4. When the model has errors, keep the last good layout of each view and set the state to `stale`.
5. Recomputations within a project run serially; a new request drops queued older ones.

### 3.4 Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `likec4MarkdownPreview.enabled` | boolean | `true` | When off, `likec4-view` renders as a plain code block |
| `likec4MarkdownPreview.debounceMs` | number | `250` | Debounce for unsaved edits |
| `likec4MarkdownPreview.maxHeight` | number | `600` | Maximum view height (px) |
| `likec4MarkdownPreview.graphviz` | `wasm` / `binary` | `wasm` | Layout engine, maps to `LikeC4Options.graphviz` |

### 3.5 Interaction scope

- Read-only: no dragging to change the layout, no saving manual layouts, no other editing.
- With `browser=true`, element details and navigation between views are supported (navigation switches inside the diagram and does not change the Markdown). If the full model is needed, inline one copy of the model data per project (once per document even when referenced several times); the exact method is decided under 3.6.
- "Go to source" on element click is optional (M3); the method is decided under 3.6 (the preview script cannot talk to the extension directly; `command:` URI links are an option).

### 3.6 Details to decide with ADVISOR

- Full model data for `browser=true`: how to inline it, size limit, degradation beyond the limit.
- Whether `dynamic-variant=sequence` ships in the first version (depends on component support in `@likec4/diagram`).
- Whether subclassing `LikeC4` to access `protected langium` is acceptable; if step 0 finds a better public API, use it.
- How to implement "go to source" and whether it ships in the first version.
- Minimum `engines.vscode` (the earliest version where the morphdom preview and the `vscode.markdown.updateContent` event exist, confirmed in step 0).

## 4. Probes before starting (step 0)

Write a minimal prototype for each; the results feed the joint plan review. If any probe fails, agree on an alternative with ADVISOR before starting:

| # | Probe | Pass criterion |
|---|---|---|
| P1 | morphdom keeps hosts | In the built-in preview, a host with a stable id has React mounted in its shadow root. After changing only the `<script>` text and running `markdown.preview.refresh`, the host element and shadow root are the same objects and React state (e.g. a counter) is kept |
| P2 | Unsaved text sync | With a `LikeC4` subclass, `DocumentBuilder.update` with in-memory text fires `onModelUpdate`, and `layoutedModel()` returns the new layout |
| P3 | Shadow DOM rendering | `@likec4/diagram` inside a shadow root has complete styles; zoom, pan and element clicks work; no errors under the preview CSP |
| P4 | Layout in the extension host | `fromWorkspace` + wasm Graphviz runs in the VS Code extension host (Electron Node); record layout time of typical views |
| P5 | Bundle size | Size of `preview.js` and the extension package; record the numbers |

## 5. Scope

### 5.1 Included

| Module | Contents |
|---|---|
| `src/extension.ts` | Activation, settings, `extendMarkdownIt` export |
| `src/markdownIt.ts` | Fence rule: handles only `likec4-view` and passes everything else to the original rule; option parsing; host element and JSON output |
| `src/projects.ts` | Project discovery and nearest-project lookup; updates when config files are added or removed |
| `src/modelService.ts` | LikeC4 instance management, unsaved text sync, layout cache and hashes, refresh triggering |
| `preview/` | Preview script: scanning, shadow root, rendering, updates, viewport persistence, theme following, error and stale display |
| Engineering | TypeScript, esbuild (two outputs: extension for Node, preview for the browser), ESLint, unit tests, extension integration tests, `vsce package` |
| Docs | README (syntax, options, compatibility with mkdocs-likec4, settings, "not an official LikeC4 project" notice), CHANGELOG |
| License | This project is MIT. `THIRD_PARTY_NOTICES` is generated by a tool and covers every dependency bundled into the VSIX (including the Apache-2.0 `@hpcc-js/wasm-graphviz` and the Graphviz notices it contains) |

### 5.2 Not included

- Editing (dragging, saving manual layouts);
- Rendering Markdown cells in notebooks;
- Support for third-party Markdown preview extensions (such as Markdown Preview Enhanced);
- Rendering views when exporting HTML / PDF;
- Publishing to the Marketplace / Open VSX (the user decides; delivery ends at a publishable VSIX).

## 6. Technical constraints

- Do not copy LikeC4 source code. If a fragment must be copied, keep LikeC4's MIT copyright notice in the file header and list it in `THIRD_PARTY_NOTICES`.
- Name and icon must not suggest an official project: extension name like `likec4-markdown-preview`, display name `Markdown Preview for LikeC4`, no official LikeC4 logo.
- Do not modify or depend on internal APIs of the official LikeC4 extension. When both are installed they must not interfere (no LSP client, no diagnostics, no completion).
- The preview script uses no `eval`, inserts no `<script>` dynamically and makes no network requests; all data comes from inline JSON.
- The extension host must not block: the markdown-it rule only reads the cache, with no synchronous I/O and no layout computation.
- Pin dependencies to exact versions; all `likec4` / `@likec4/*` packages at the same version.
- Log to a dedicated Output Channel: the duration of each recomputation and the reason for each refresh. Never log file contents.

## 7. Acceptance criteria

### 7.1 Automated tests

| Area | Must cover |
|---|---|
| Fence parsing | Options in any order, defaults, unknown options ignored, invalid view ids and project names, empty body, non-`likec4-view` blocks passed to the original rule unchanged (both take effect when chained with another plugin that rewrites fences) |
| JSON escaping | View titles and descriptions containing `</script>`, `<!--`, U+2028 do not break the HTML structure, and parse back equal to the original data |
| Project resolution | Single project, nested projects, multi-root workspace, explicit `project=`, no project found, default project |
| ModelService | Disk change triggers recomputation; unsaved edit triggers recomputation; closing an unsaved document falls back to disk; model errors give `stale` and keep the last layout; unchanged hash triggers no refresh; concurrent edits keep only the latest recomputation |
| Preview script (jsdom + morphdom, reusing the logic of VS Code's `areNodesEqual`, with source and MIT notice) | Changing only the JSON keeps host and shadow root and does not recreate the React root; changes elsewhere in the Markdown leave hosts untouched; removed hosts are unmounted; multiple references to the same view are independent; same `hash` skips rendering |
| Extension integration (`@vscode/test-electron`) | Render a sample document with the `markdown.api.render` command: output contains host elements and valid JSON; after editing a `.c4` in the fixture, rendering again gives a new hash; with `enabled=false` the output is a plain code block |

### 7.2 End to end (manual + screen recording)

Use the `fixtures/` workspace in the repo (at least two LikeC4 projects, with at least one element, dynamic and deployment view each):

| # | Action | Expected |
|---|---|---|
| E1 | Open the preview of a Markdown file with 4 `likec4-view` blocks | All four render; elements and edges match the official extension's preview panel |
| E2 | Zoom and pan a view in the preview, then edit the Markdown text (not that block) | The view does not flicker and keeps its viewport |
| E3 | Without saving, change the title of an element in that view in the `.c4` | Title updates in the preview within 1 second, viewport kept, no full-diagram flicker |
| E4 | Introduce a syntax error in the `.c4` | View keeps the last result and shows a stale notice; the notice disappears after the fix |
| E5 | Change the view id in the block to an unknown id, then back | An error block appears, rendering resumes after changing it back |
| E6 | Switch between light, dark and high-contrast VS Code themes | `auto` views follow; `light`/`dark` views stay |
| E7 | Install the official LikeC4 extension and a Mermaid extension as well | All three work, diagnostics are not duplicated, Mermaid diagrams render |
| E8 | Build the same Markdown with mkdocs-likec4 | Views render the same on both sides (screenshot comparison) |
| E9 | Open a copy of `ci-metrics/docs/design/arc42.md` with its LikeC4 view references changed to `likec4-view` blocks | All views render in the preview |

### 7.3 Performance

Record on the fixture and on the `ci-metrics/docs/design` model (from the Output Channel log):

- Time from a `.c4` edit to the preview being updated (P50 / P95), target P95 < 1 second (excluding debounce);
- Time to first screen when opening a document with 10 views;
- Size of the extension package and `preview.js`.

Write the results into the acceptance report; ADVISOR decides whether any miss is blocking.

## 8. Deliverables

1. Extension source, tests and `fixtures/`; an installable VSIX.
2. Design document `docs/design.md`: final design only (section 3 of this brief after the rulings), not the process or rejected options.
3. README, CHANGELOG, LICENSE (MIT), `THIRD_PARTY_NOTICES`.
4. Step 0 probe record (`docs/probe.md`: method, result and data for each probe).
5. Acceptance report `docs/acceptance.md`: summary of 7.1 test output, a recording or screenshot for each 7.2 item, 7.3 performance data, the list of ADVISOR rulings, open issues.

## 9. Process

1. **Step 0 probes** (section 4); record the results.
2. **Joint plan review**: start ADVISOR as a sub-agent (read-only reviewer), give it this brief and the probe results, and have it rule on each item of section 3.6; write the rulings into `docs/design.md` before starting.
3. **Stepwise implementation with agreement at each step**, suggested split:
   - M1: fence plugin + project resolution + ModelService (disk mode) + static rendering in the preview (E1, E5, E6, E9);
   - M2: unsaved text sync + morphdom preservation + viewport persistence + stale (E2, E3, E4);
   - M3: `browser=true`, `sequence`, go to source (as ruled), coexistence and compatibility (E7, E8), performance and packaging.
   Each step goes to ADVISOR for change review and result review, with test commands and output.
4. **Final review**: led by ADVISOR, with independent verification and a list of gaps; closed once both agree.

Commit messages describe only the change itself, without any agent/LLM attribution. Do not push to a remote or publish the extension; the user decides.
