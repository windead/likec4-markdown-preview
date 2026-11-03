# Changelog

## 0.1.0

First release.

- Renders ```` ```likec4-view ```` code blocks in the built-in VS Code Markdown preview, with the same syntax and options as [mkdocs-likec4](https://github.com/doubleSlashde/mkdocs-likec4): `browser`, `dynamic-variant`, `project`, `color-scheme`.
- Project resolution: `likec4.config.json` / `.likec4rc` projects, nearest project to the Markdown file, default project, multi-root workspaces, Markdown files outside the workspace.
- Live updates from saved and unsaved `.c4` / `.likec4` edits. Editing the Markdown keeps diagrams untouched. Model changes reload the preview; a static snapshot is shown until the interactive diagram is ready, so views never go blank.
- When the model has errors, the last valid version is shown with a warning.
- Behaves like mkdocs-likec4 1.2: static, fitted views; with `browser=true`, clicking a view opens the view browser (zoom, pan, element details, navigation); `browser=false` views are not interactive. Fence parsing follows mkdocs-likec4 too: single-line body, backtick fences only, options matched with the same patterns. A document outside every project uses the workspace's only project.
- Optional zoom and pan inside embedded views (`panZoom` setting): Ctrl/Cmd + wheel or pinch to zoom, drag to pan, kept across edits and reloads.
- Settings: `enabled`, `debounceMs`, `maxHeight`, `graphviz` (`wasm` / `binary`), `maxModelBytes`, `colorScheme` (default for blocks without `color-scheme`, like mkdocs-likec4's `color_scheme`), `panZoom`.
- Published as a VSIX on GitHub Releases by a tag-triggered GitHub Actions workflow.
- Works alongside the official LikeC4 extension and Mermaid support. This extension provides no language server, diagnostics or completion.
