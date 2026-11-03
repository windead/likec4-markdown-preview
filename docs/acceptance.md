# Acceptance report: Markdown Preview for LikeC4 0.1.0

- Deliverable: `likec4-markdown-preview-0.1.0.vsix` (1.94 MB, 10 files), produced by `npm run package`.
- Environment: WSL2 Ubuntu 24.04 with an xvfb virtual display; VS Code 1.144.0 under test (Electron 43.8.3, extension host Node 24.22.1); VS Code 1.123.0 tested separately as the compatibility floor.
- Evidence folder: `docs/acceptance/`. All e2e data and screenshots come from one complete run (output folder cleared first, `node test/e2e/run.mjs`, all 6 scenarios passed); E8 and the VSIX smoke test ran right after.

## 1. Automated tests (brief 7.1)

| Area | Command | Result |
|---|---|---|
| Type check | `npx tsc -p .` | No errors |
| Lint | `npx eslint .` | No errors |
| Unit tests | `npx vitest run` | 9 files, 62 tests, all pass |
| Extension integration (VS Code 1.144.0) | `xvfb-run -a node test/integration/run.mjs` | 5/5 pass |
| Extension integration (VS Code 1.123.0) | `VSCODE_VERSION=1.123.0 xvfb-run -a node test/integration/run.mjs` | 5/5 pass |
| End to end | `xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs` | E1–E5, P1c, E6, E9, E7, M3-browser-sequence: 6 scenarios, all pass (`docs/acceptance/results.json`) |
| VSIX install smoke test | `node test/e2e/vsix-smoke.mjs <extensions folder with the VSIX installed>` | Pass (development path not loaded; screenshot `vsix-installed.png`) |

Coverage of the items in brief 7.1:

| Area | Tests |
|---|---|
| Fence parsing | `fence.test.ts`: options in any order, defaults, unknown options and invalid values ignored, invalid view ids and project names, empty body; `markdownIt.test.ts`: non-`likec4-view` blocks passed back to the original rule, both take effect when chained with another fence-rewriting plugin (in both install orders), and `enabled=false` |
| JSON escaping | `html.test.ts`: titles and descriptions containing `</script>`, `<!--`, U+2028/2029 do not break the HTML structure, round-trip equal, and are valid JS; `markdownIt.test.ts`: inline model containing `</script>` |
| Project resolution | `projects.test.ts`: single project, nested projects (deepest wins), same-named projects in several roots, explicit `project=`, no project found, default project, script config error, no document folder |
| ModelService | `modelService.test.ts` (real LikeC4): lazy computation, only referenced projects computed, disk change triggers recomputation (watch), unsaved edit and fallback to disk on close, `stale` on errors keeping the last layout and recovery after the fix, `error` when broken from the start, unchanged hash reports no change, concurrent edits merged with the latest winning |
| Refresh scheduling | `refresh.test.ts`: merging, no refresh without a preview, no refresh when the document is closed or has no references, `refreshAll`, `dispose` |
| Preview script | `preview.test.ts` (jsdom + morphdom, reproducing VS Code 1.144's `areNodesEqual`/`domEval`/morphdom options, with source and MIT notice in the file header): changing only the JSON keeps host and shadow root and does not recreate the React root; changes elsewhere in the Markdown leave hosts untouched; same `hash` skips rendering; removed hosts are unmounted; multiple references to the same view are independent; hosts with snapshots survive morphdom updates; model element id survives `domEval`; deferred mounting |
| Snapshot and viewport | `staticSvg.test.ts` (real layouts: complete structure for 4 view kinds, text escaping, none for sequence); `viewport.test.ts` (fit formula, content-out-of-view check); `markdownIt.test.ts` (snapshot escaping, unique ids in the page) |
| Extension integration | `test/integration/suite.cjs`: `markdown.api.render` outputs hosts and valid JSON, one model per project; nearest project and unknown view; new hash after changing a `.c4` on disk; new hash after an unsaved edit with the disk unchanged; `enabled=false` outputs a plain code block |

## 2. End to end (brief 7.2)

Fixture: `fixtures/`, with three projects: `shop` (element ×2, dynamic, deployment), `billing`, `large` (generated).

| # | Result | Evidence |
|---|---|---|
| E1 | Pass. All 4 views render: shop index 3 nodes 2 edges, checkout (dynamic) 5/4, prodDeployment (deployment) 5/2, billing 3/1. The 3 views on the first screen mount directly; the off-screen view shows its snapshot first and mounts once scrolled near. Elements and edges match the same view in the official LikeC4 extension's preview panel | `E1-four-views.png`, `E7-coexist.png` (this extension) against `E7-official-preview-panel.png` (official panel) |
| `browser` / `sequence` / trimming | Pass (scenario `M3-browser-sequence`). `browser=true`: clicking an element opens the in-diagram browser overlay (a 2nd react-flow instance and 1 dialog with navigation and zoom controls); Markdown text and disk files unchanged. `browser=false`: no overlay on click. `dynamic-variant=sequence`: a sequence diagram with 5 participants and 4 steps renders in `shop/docs/readme.md`. Over the limit: with `maxModelBytes=65536`, the large model (122 KB) inlines only the 10 views referenced by the document, shows the "The LikeC4 model is too large…" notice, and no overlay opens on click | `M3-browser-overlay.png`, `M3-sequence.png`, `M3-trimmed.png`, `results.json` → `M3-browser-sequence` |
| E2 | Pass. Zoom and pan, then edit the Markdown text: same frame, host and shadow root markers kept, viewport `translate(78px,-74px) scale(0.972)` unchanged | `E2-after-md-edit.png`, `results.json` → `E2` |
| E3 | Pass (with ADVISOR's replacement criteria). 20 unsaved `.c4` edits, viewport restored every time. Timings in §3 | `E3-after-c4-edit.png`, `results.json` → `E3.rows` |
| P1c | Pass (added by ADVISOR). Per-frame in-page trace during forced reloads: 0 blank frames for visible hosts in all three cases; snapshot `viewBox` matches the interactive diagram transform (deviation ≤ 1e-14); the transform is unique after the diagram mounts (no fit-then-jump-back). The cases: A saved viewport; B untouched view; C saved viewport no longer shows the view, so snapshot and diagram both fit | `results.json` → `P1c` |
| E4 | Pass. On a syntax error the stale notice appears ("Showing the last valid version… model.c4:19 Expecting token…") and the last layout (3 nodes) is kept; after the fix the notice disappears | `E4-stale.png` |
| E5 | Pass. With the view id changed to `indexx`, the error block 'View "indexx" not found in LikeC4 project "shop".' appears; rendering resumes after changing it back | `E5-unknown-view.png` |
| E6 | Pass. In Dark Modern, Light Modern, High Contrast and High Contrast Light, `auto` is dark/light/dark/light, and `color-scheme=light` is always light | `E6-*.png` |
| E7 | Pass. With the official `likec4.likec4-vscode` 1.60.0 installed and the Mermaid support built into VS Code 1.144: both extensions activate, LikeC4 views and Mermaid diagrams render; when `shop/model.c4` has an error there is exactly 1 diagnostic, from the official extension only (`likec4`), while this extension shows stale | `E7-coexist.png`, `results.json` → `E7-coexist` |
| E8 | Pass. mkdocs 1.6.1 + mkdocs-likec4 1.2.2 + likec4 1.60.0 build the same `sample.md` (plus one page per view, for screenshots); compared view by view with this extension's preview: elements, layout, edge labels and dynamic-view step numbers match. Colors differ because the MkDocs page is light while this extension's `auto` follows the dark VS Code theme | `E8-ours-{0..3}.png` against `E8-mkdocs-{0..3}.png` |
| E9 | Substitute run. `ci-metrics` is not on this machine (searched the whole disk), so a document with 10 views on `fixtures/large` (313 elements, 37 views, generated by `scripts/gen-large-fixture.mjs`) is used: all 10 views show and all mount after scrolling | `E9-large.png`, `results.json` → `E9-large` |

Recordings: screenshot sequences and the per-frame in-page trace (P1c) replace screen recordings in this environment.

## 3. Performance (brief 7.3)

Data comes from the Output Channel logs of the same complete run (`docs/acceptance/extension-log-*.log`, with epoch timestamps) and page marks.

### `.c4` edit to preview update (fixtures, E3, 20 edits, 1.5 s between edits, excluding the 250 ms debounce, measured from pushing the unsaved text, P95 by nearest rank)

| Segment | P50 | P95 | Threshold |
|---|---|---|---|
| Extension-controlled segment (push → `markdown.preview.refresh`) | 64 ms | 123 ms | ≤ 200 ms ✓ |
| of which LikeC4 recomputation | 59 ms | 117 ms | — |
| of which extension's own overhead (recomputation done → refresh) | 5 ms | 6 ms | — |
| New content visible (snapshot in place) | 676 ms | 749 ms | ≤ 1.5 s ✓ (also under the brief's 1 s) |
| First frame of the interactive diagram | 1058 ms | 1259 ms | Reported only |

Viewport restoration needed one retry each time, inside the hidden container.

Measurement condition: 1.5 seconds between edits, like a pause in typing, by which time the background work of the previous preview reload has finished. Editing again while the previous reload is still initializing makes both compete for CPU, and LikeC4 recomputation gets a long tail: in one run of 20 back-to-back edits, P95 was 233 ms and the maximum 260 ms, while the extension's own overhead stayed at 15 ms or less. In plain Node with no VS Code load, 40 recomputations had P50 41 ms and P95 104 ms (`probes/layout-tail.mjs`).

### Large model (`fixtures/large`, E9, `extension-log-E9.log`)

| Metric | Value |
|---|---|
| Workspace initialization (3 projects) | 1706 ms |
| First full-model layout (37 views) | 1325 ms (extension host, cold start) |
| Incremental recomputation (10 times) | 91–282 ms |
| Push → refresh | P50 214 ms / P95 366 ms |
| Edit (including debounce) → new title in the interactive diagram | P50 2019 ms / P95 2553 ms |
| First screen of the 10-view document (from opening the preview, including the first initialization right after VS Code starts) | About 7.5 s; visible views mounted, the rest show snapshots |

### First screen of the 4-view document (fixtures, E1)

From opening the preview to all 4 views shown: 6844 ms, all cold (VS Code just started), including the project scan, LikeC4 workspace initialization (about 2 s), the first layout and a preview reload. Warm start was not measured separately.

### Size

| Output | Size |
|---|---|
| VSIX | 2 036 782 B (1.94 MB) |
| `dist/extension.js` | 3 192 521 B |
| `dist/preview.js` | 2 571 191 B |
| `THIRD_PARTY_NOTICES` | About 200 KB, 113 packages plus 2 embedded components (Graphviz EPL-1.0, Expat MIT) |

## 4. ADVISOR rulings

| Item | Ruling |
|---|---|
| Updating on `.c4` changes | Only the forced full page reload is available (shown by P1), so "forced refresh + viewport persistence" is used; refresh only when an affected document has an open preview |
| Model data for `browser=true` | One layouted model inlined per document per project; limit 2 MiB (setting `maxModelBytes`); beyond it, trim views and disable browsing, keeping a single rendering path |
| `dynamic-variant=sequence` | Supported in the first version, passed through |
| `protected langium` | Not used; services assembled from public APIs |
| Go to source | Not in the first version (`command:` URIs are not allowed in the preview) |
| `engines.vscode` | Set by the Node version the dependencies declare; measured floor 1.123.0 |
| JS/TS configs | Not executed; `bundle-require`/`esbuild` stubbed; error block |
| Static snapshot + lazy entry | Accepted (removes blank frames during reloads) |
| Deferred mounting of off-screen hosts | Accepted |
| Full-model recomputation for large models | Accepted (incremental recomputation P95 287 ms < 500 ms) |
| E3 latency over 1 s | Non-blocking; replacement thresholds; listed as a known limitation |
| E3 measurement method (20 edits, 1.5 s apart, recomputation and own overhead split) | Accepted, not a change of criteria; back-to-back edit data kept in §5 |
| Final review | Closed (M1–M3 pass) |
| Wheel interaction (scrolls the page, Ctrl/⌘+wheel zooms) | Accepted, documented in the design and README |
| `sequence` hosts (no snapshot) during reloads | "Do not cover, show directly", recorded as an open issue |

## 5. Open issues and known limitations

1. A `.c4` change force-reloads every open Markdown preview that references an affected project. Transient state such as the browser overlay, the selection and dynamic-view stepping is lost after the reload. The interactive diagram is ready after about 1.2–1.4 s (excluding debounce), with the snapshot shown until then.
2. The per-frame trace starts at `DOMContentLoaded`. Whether the webview has already swapped and briefly shows a document whose content has not been appended yet cannot be observed from inside the page (the VS Code preview appends content only at `DOMContentLoaded`). No blank was seen in sampled screenshots.
3. The static snapshot is an approximation (nodes, compound nodes, edges and labels) without icons or every LikeC4 style detail. The `sequence` variant has no snapshot: such hosts are shown directly after mounting instead of hidden while waiting (ruled "do not cover"), avoiding a blank area during reloads. The cost is that when such a view restores a saved viewport, one frame may show the fit view first. Until the new document's app has loaded (about 1.1 s measured, i.e. the first frame of the interactive diagram), that position shows only the host placeholder.
4. There is no `ci-metrics` model, so the "real large model" data for E9 and 7.3 come from the generated `fixtures/large`. The full-model recomputation time should be re-measured with a real large model (ADVISOR request).
5. `likec4.config.js/ts` is not supported.
6. Go to source is not implemented.
7. Publishing fields: `publisher` is provisionally `windead` and there is no icon (the official LikeC4 logo is not used). To be decided by the user before publishing to a marketplace.
8. With fast back-to-back edits while the previous preview reload is still initializing, CPU contention pushes the extension-controlled segment over the 200 ms threshold: in two back-to-back runs, the extension segment P95 was 278 ms (10 edits) and 252 ms (20 edits), mainly from the LikeC4 recomputation tail (233/260 ms); the extension's own overhead stayed at 15 ms or less (see §3).
9. Each document inlines the full layouted model, which grows the preview HTML for many documents with large models; above 2 MiB the model is trimmed automatically.
