# Markdown Preview for LikeC4

Renders [LikeC4](https://likec4.dev) views in the built-in VS Code Markdown preview.

> **Not an official LikeC4 project.** This extension is developed independently and is not affiliated with or endorsed by the LikeC4 team. It uses the published `@likec4/*` packages.

````markdown
```likec4-view
index
```
````

The syntax and behavior follow [mkdocs-likec4](https://github.com/doubleSlashde/mkdocs-likec4), so one Markdown file renders the same in an MkDocs site and in the VS Code preview.

## Installation

Download `likec4-markdown-preview-<version>.vsix` from the [GitHub Releases](https://github.com/windead/likec4-markdown-preview/releases) page, then in VS Code run **Extensions: Install from VSIX...** (or `code --install-extension likec4-markdown-preview-<version>.vsix`).

## Features

- Renders element, dynamic and deployment views with the same components and styles as LikeC4 itself.
- Updates live as you edit `.c4` / `.likec4` files, including unsaved changes.
- Editing the Markdown text leaves rendered diagrams untouched.
- When the model has errors, the preview keeps showing the last valid version with a warning.
- Follows the VS Code color theme (light, dark, high contrast), unless a block sets `color-scheme`.
- Works alongside the official LikeC4 extension and Mermaid diagrams. It does not replace the built-in Markdown preview.

## Syntax

````markdown
```likec4-view [browser=true|false] [dynamic-variant=diagram|sequence] [project=<name>] [color-scheme=auto|light|dark]
<viewId>
```
````

- The block body is exactly one line: the view id. As in mkdocs-likec4, a block with more lines is not rendered (it shows an error here).
- The block must be fenced with backticks; `~~~likec4-view` blocks stay plain code blocks, as in MkDocs.
- Options go on the opening fence line, in any order, and are all optional. They are matched the same way as in mkdocs-likec4: values are case-sensitive, the first occurrence wins, and unknown options or invalid values are ignored.

| Option | Values | Default | Meaning |
|---|---|---|---|
| `browser` | `true` / `false` | `true` | Click the view to open the view browser (element details and navigation between views); `false` makes the view non-interactive |
| `dynamic-variant` | `diagram` / `sequence` | `diagram` | How dynamic views are displayed |
| `project` | project name | nearest project | Which LikeC4 project to use in a multi-project workspace |
| `color-scheme` | `auto` / `light` / `dark` | `likec4MarkdownPreview.colorScheme` (`auto`) | `auto` follows the VS Code theme |

View ids and project names must match `^[a-zA-Z][a-zA-Z0-9_-]*$`. Otherwise the block shows an error.

### Which project is used

- `project=<name>` selects a project by the `name` in its `likec4.config.json` (or `.likec4rc`).
- Without `project`, the nearest project that contains the Markdown file is used: the closest ancestor folder with a LikeC4 config.
- If the workspace folder has no config files but contains `.c4` files, its default project is used.
- If the Markdown file is outside every project and the workspace folder has exactly one project, that project is used (as in an MkDocs build). With several projects, the block must set `project=`.
- Markdown files outside the workspace look for a config in their parent folders.

`likec4.config.js` / `.ts` configs are not executed and are reported as unsupported. Use `likec4.config.json` instead.

## Interacting with diagrams

By default, embedded views behave like the mkdocs-likec4 web component: the diagram is static and fitted to its frame.

| Action | Result |
|---|---|
| Mouse wheel | Scrolls the Markdown page (never captured by diagrams) |
| Click the view (`browser=true`) | Opens the view browser on top of the page, where you can zoom, pan, open element details and navigate between views. Press Escape to close it |
| Click the view (`browser=false`) | Nothing |

With `likec4MarkdownPreview.panZoom` turned on, embedded views can also be zoomed (Ctrl/Cmd + wheel, or pinch) and panned (drag). Their zoom and pan are kept while you edit, and also when the preview reloads after a model change.

## Settings

| Setting | Default | Description |
|---|---|---|
| `likec4MarkdownPreview.enabled` | `true` | Render `likec4-view` blocks. When off, they show as plain code blocks. |
| `likec4MarkdownPreview.debounceMs` | `250` | Delay before unsaved `.c4` edits are applied to the preview |
| `likec4MarkdownPreview.maxHeight` | `600` | Maximum height of a view, in pixels |
| `likec4MarkdownPreview.graphviz` | `wasm` | Layout engine: bundled WebAssembly Graphviz, or the `dot` binary from `PATH` (`binary`) |
| `likec4MarkdownPreview.maxModelBytes` | `2097152` | Maximum model size embedded per project (2 MiB). Larger models are reduced to the views used in the document, and in-diagram navigation is disabled. |
| `likec4MarkdownPreview.colorScheme` | `auto` | Default color scheme of blocks without `color-scheme` (like the `color_scheme` option of mkdocs-likec4) |
| `likec4MarkdownPreview.panZoom` | `false` | Allow zooming and panning inside embedded views |

## How updates work

- **Editing the Markdown:** VS Code updates the preview in place. Diagrams are not re-created.
- **Editing the LikeC4 model:** VS Code offers no way to update the built-in preview in place for changes in other files, so the extension asks it to reload.
  - Each view first shows a static snapshot of the new model (at the zoom and pan you left it, with `panZoom`), then switches to the interactive diagram. A view never goes blank.
  - State inside a diagram, such as an open element-details overlay or a selection, is reset by the reload.
- **Errors:** while the model has errors, each view keeps its last valid version and shows a warning.

## Output and logs

The **LikeC4 Markdown Preview** output channel logs project discovery, model recomputations (with timings) and why the preview was refreshed. File contents are never logged.

## Requirements and limitations

- VS Code 1.123 or later. The bundled LikeC4 language server needs Node.js 22.22.3+ in the extension host.
- Read-only. Diagrams can't be edited, and manual layouts can't be saved, from the preview.
- Not supported: Markdown cells in notebooks, third-party Markdown preview extensions, and HTML/PDF export.

## License

MIT (see the `LICENSE` file). Bundled third-party software is listed in the `THIRD_PARTY_NOTICES` file.
