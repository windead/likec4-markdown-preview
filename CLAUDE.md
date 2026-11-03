# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

VS Code extension **Markdown Preview for LikeC4** (package `likec4-markdown-preview`, not an official LikeC4 project): renders ` ```likec4-view ` blocks in the **built-in** VS Code Markdown preview, with syntax compatible with mkdocs-likec4.

- Full requirements, acceptance criteria and process: `docs/task.md` (authoritative; read before changing the design).
- Final design after the reviewer's rulings: `docs/design.md` (final conclusions only, no process or rejected options).
- Step 0 probe record: `docs/probe.md`; acceptance report: `docs/acceptance.md`.

Status: 0.1.0 is implemented and accepted (`docs/acceptance.md`); the final design is in `docs/design.md`.

## Commands

```bash
npm run build                 # esbuild → dist/extension.js (Node CJS) + dist/preview.js (IIFE); --dev: no minify, with sourcemaps
npx tsc -p .                  # type check (esbuild does not type check)
npx eslint .
npx vitest run                # unit tests; single: npx vitest run test/unit/markdownIt.test.ts -t "keyword"
xvfb-run -a node test/integration/run.mjs                      # @vscode/test-electron, VS Code 1.144 (VSCODE_VERSION=1.123.0 tests the floor)
xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs  # Playwright drives a real VS Code; scenario names: E1-E2-E3-E4-E5 P1c E6-theme E9-large E7-coexist M3-browser-sequence mkdocs-parity
node scripts/notices.mjs      # generate THIRD_PARTY_NOTICES from dist/meta.json (build first)
npm run package               # build + notices + vsce package
```

- e2e results and screenshots go to `test-results/e2e/` (a run without arguments clears it first). `test/e2e/driver/` is a driver extension loaded only in tests (opens files, makes unsaved edits, changes settings). E7 needs the official extension installed into `.vscode-test/e7-extensions`; E8 uses `test/e2e/e8-mkdocs.mjs <built mkdocs folder>`.
- Under WSL, commands run with `!` have no TTY; `sudo` must be run by the user in their own terminal.

## Architecture (cross-file essentials)

The two sides communicate one way through **JSON inlined in the HTML**; the preview script cannot talk to the extension directly.

**Extension host (Node)**
- Note: `markdown.preview.refresh` is a **forced full page reload** (probe P1), so there is no morphdom path when only a `.c4` changes. To cover this, the host's light DOM contains a server-generated static SVG snapshot (`src/staticSvg.ts`); the preview entry (`preview/index.ts`) positions snapshots at the saved viewport, then lazily loads the app (`preview/app.tsx`); the diagram initializes hidden inside the shadow root and replaces the snapshot shown through `<slot>` only when ready. Details in `docs/design.md` §3.3.
- `src/markdownIt.ts`: synchronous markdown-it fence rule; handles only blocks whose info string starts with `likec4-view` and passes everything else to the original rule (must chain with other fence-rewriting plugins). **The rule only reads the cache**, no I/O or layout; while the cache is not ready it outputs a `state: "loading"` placeholder and a refresh follows when ready.
- `src/fence.ts`: fence detection and option parsing, ported from mkdocs-likec4's `parser.py` (single-line body, backtick fences, same regexes); keep it in step with mkdocs-likec4.
- `src/projects.ts`: scans each workspace root for `likec4.config.json` / `.likec4rc` / `likec4.config.{js,ts}`; walks up from the Markdown folder to the nearest project (as mkdocs-likec4 `_find_nearest_project`), falling back to the default project (no config, `.c4` in the root).
- `src/modelService.ts`: one instance per LikeC4 workspace root, created lazily. It does not subclass `LikeC4`; it assembles services from public `@likec4/language-server` modules and calls `new LikeC4(services)`. Disk changes come from `WithFileSystem(true)` (chokidar); unsaved edits are debounced, then `TextDocuments.set` + `DocumentBuilder.update`; on close/save, `delete` falls back to disk. After `onModelUpdate` it **recomputes only projects referenced by a render** (`layoutedModel`) and detects changes by hashing canonical JSON (sorted keys; `$data` key order is unstable). Recomputations are serialized and merged. When the model has errors (decided by `hasErrors`-style diagnostics, since Langium still produces a model), the last good result is kept with state `stale`.
- `src/refresh.ts` + `src/extension.ts`: `markdown.preview.refresh` reloads **all** previews, so it is called only when an affected project is referenced by a still-open document and a Markdown preview is open (5 ms merge window).

**Preview webview (`preview/` → `preview.js`, injected through `markdown.previewScripts`)**
- `preview/index.ts` (small entry) → `preview/app.tsx` (React + `LikeC4ModelProvider` + `LikeC4View`, lazily `require`d); `preview/hosts.ts` manages host lifecycle (unit-testable, no React), `preview/viewport.ts` handles viewport persistence (`sessionStorage`, key = document URI + host id) and snapshot positioning.
- Existing hosts: skipped when hash/options/color scheme are unchanged, otherwise `root.render(new props)` (no remount); hosts that disappear are `unmount`ed; off-screen hosts mount later.
- The diagram always initializes with `fitView=true` (with `fitView=false`, LikeC4 pan/zoom break); the viewport is restored in `onInitialized` with `diagram.send({type:'xyflow.setViewport'})`; interaction is listened to in the **capture phase** on the host (React Flow stops propagation). By default views are static like in mkdocs-likec4 (click opens the view browser); the `panZoom` setting enables zoom/pan and viewport persistence. The wheel always scrolls the page.
- The bundle must `define` `import.meta.env.DEV/MODE` (`@likec4/diagram` has Vite-style references; without them the second render crashes).

**Host element contract (the core of flicker-free updates; understand it before changing anything)**

```html
<div class="likec4-model" id="likec4-model-<project>-<rootTag>" hidden><script type="application/json">{"hash","trimmed","model":{…}}</script></div>
<div class="likec4-view" id="likec4-<project>-<rootTag>-<viewId>-<n>" data-likec4-opts='{...options only...}'>
  <script type="application/json">{"hash":"…","state":"ok|loading|error|stale","message":"…"}</script>
  [<div class="likec4-notice">…</div>] <svg class="likec4-static" data-bounds="…">…snapshot…</svg>
</div>
```

- One model per document per project, with the id on the outer `<div>`: VS Code's `domEval` keeps only `type` and a few other attributes when it recreates `<script>` elements.
- The ready flag lives inside the shadow root (`.likec4-root[data-ready]`): morphdom would remove attributes on the host itself. `:scope` does not work in `ShadowRoot.querySelector`.
- The VS Code preview merges the DOM with morphdom (`areNodesEqual` compares light DOM only and ignores `data-line`). `id`s must be stable (`<n>` is the occurrence number of the view in the document), host attributes hold **only options**, and data appears only in `<script>` text — so morphdom changes only text nodes and the host element, its shadow root and React root survive.
- Before inlining JSON, escape `<` `>` `&` U+2028 U+2029 as `\uXXXX`.
- View ids and project names must match `^[a-zA-Z][a-zA-Z0-9_-]*$`; otherwise an error block is output without touching the model. Unknown fence options are silently ignored.

## Hard constraints

- Do not copy LikeC4 source code; if copying is unavoidable, keep its MIT header and list it in `THIRD_PARTY_NOTICES` (test code that reuses VS Code's `areNodesEqual` logic likewise names its source and MIT notice).
- Do not depend on internal APIs of the official LikeC4 extension; no LSP client, no diagnostics/completion, to avoid conflicts with it. Name and icon must not suggest an official project; no LikeC4 logo.
- Preview script: no `eval`, no dynamically inserted `<script>`, no network requests.
- Pin dependencies to exact versions; `likec4` / `@likec4/*` at the same version (baseline `likec4@1.60.0`).
- Log to a dedicated Output Channel (recomputation times and refresh reasons); never log file contents.
- Out of scope: editing, notebook cells, third-party preview extensions, HTML/PDF export.

## Repository conventions

- All repository content (code, comments, tests, docs, commit messages) is in English.
- Commit messages describe only the change itself and **never name an LLM or agent** (no Co-Authored-By or "generated with" lines; this overrides the default attribution rule).
- GitHub remote: `git@github.com:windead/likec4-markdown-preview.git` (branch `main`). Push, tag or publish only when the user asks.
- Releases: pushing a `v*` tag runs `.github/workflows/release.yml`, which builds, tests, packages the VSIX and attaches it to a GitHub Release.
