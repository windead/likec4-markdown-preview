# Changelog

## 0.1.0

First release.

- Renders ```` ```likec4-view ```` code blocks in the built-in VS Code Markdown preview, with the same syntax and options as [mkdocs-likec4](https://github.com/doubleSlashde/mkdocs-likec4): `browser`, `dynamic-variant`, `project`, `color-scheme`.
- Project resolution: `likec4.config.json` / `.likec4rc` projects, nearest project to the Markdown file, default project, multi-root workspaces, Markdown files outside the workspace.
- Live updates from saved and unsaved `.c4` / `.likec4` edits. Editing the Markdown keeps diagrams, zoom and pan untouched. Model changes reload the preview while keeping each view's zoom and pan; a static snapshot is shown until the interactive diagram is ready, so views never go blank.
- When the model has errors, the last valid version is shown with a warning.
- Interactive diagrams: Ctrl/Cmd + wheel or pinch to zoom, drag to pan. With `browser=true`, clicking an element opens element details and view navigation inside the diagram.
- Settings: `enabled`, `debounceMs`, `maxHeight`, `graphviz` (`wasm` / `binary`), `maxModelBytes`.
- Works alongside the official LikeC4 extension and Mermaid support. This extension provides no language server, diagnostics or completion.
