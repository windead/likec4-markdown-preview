# 第 0 步探测记录

## 环境

| 项 | 值 |
|---|---|
| 宿主机 | WSL2 Ubuntu 24.04，Node 22.16（脚本）/ 26.13 |
| 测试用 VS Code | 1.144.0（Electron 43.8.3，扩展宿主 Node 24.22.1），`@vscode/test-electron` 下载，独立 user-data/extensions 目录 |
| 驱动 | `playwright-core@1.64.0` 的 `_electron`，`xvfb-run` 虚拟显示（1600×1000） |
| LikeC4 | `@likec4/language-services` / `@likec4/diagram` / `@likec4/core` 均为 1.60.0 |
| fixtures | `fixtures/shop`（element ×2、dynamic、deployment 视图）、`fixtures/billing`（element 视图），`fixtures/docs/sample.md` 含 4 个 `likec4-view` |

原型代码在 `probes/`：

- `probes/ext/`：原型扩展（markdown-it fence → 宿主元素 + 内联 JSON；预览脚本挂 shadow root + React）。
- `probes/build.mjs`：esbuild 打包（扩展端 CJS / 预览端 IIFE）。
- `probes/run-vscode.mjs`：Playwright 驱动真实 VS Code，进入预览 webview 读 DOM、操作、截图，输出 `report.json`。
- `probes/p2-unsaved.mjs`：P2 的 Node 脚本。
- `probes/check-fixtures.mjs`、`probes/size-breakdown.mjs`：fixture 校验、体积分解。

复现：

```bash
node probes/build.mjs
xvfb-run -a -s "-screen 0 1600x1000x24" node probes/run-vscode.mjs <code 可执行文件> <输出目录>
node probes/p2-unsaved.mjs fixtures
```

## 结果总览

| # | 探测 | 结论 |
|---|---|---|
| P1 | morphdom 保留宿主 | **部分通过**：Markdown 文档变化触发的增量更新中宿主、shadow root、React 状态、视口全部保留；但 `markdown.preview.refresh` 是**强制整页重载**，任务书 3.3 中“`.c4` 变化 → `markdown.preview.refresh`”的链路无法保留状态（见 P1 详情） |
| P2 | 未保存文本同步 | 通过，且无需访问 `protected langium` |
| P3 | shadow DOM 渲染 | 通过 |
| P4 | 扩展宿主布局 | 通过 |
| P5 | 打包体积 | 已记录 |

## P1 morphdom 保留宿主

**做法**：fence 输出 `<div class="likec4-view" id="likec4-shop-<viewId>-<n>" data-likec4-opts='…'><script type="application/json">…</script></div>`；预览脚本对每个宿主 `attachShadow` + `createRoot`，在 shadow 内渲染一个带 `useState` 的计数器、JSON 中的 `counter` 和 LikeC4 视图；宿主上挂一个 JS 属性 token 用于判断元素是否同一对象。Playwright 先点击计数器 3 次、缩放平移第一个视图，再分两种方式触发更新：

- **P1a**：扩展对 Markdown 文档做一次编辑（文档 version 变化），同时 JSON 的 `counter` 加 1；
- **P1b**：只改 JSON 的 `counter`，执行 `markdown.preview.refresh`。

**结果**：

| 指标 | P1a（Markdown 编辑） | P1b（`markdown.preview.refresh`） |
|---|---|---|
| 预览 iframe | 同一 frame | 旧 frame 被销毁，新建 frame |
| 宿主元素 / shadow root | 同一对象（token 一致、`shadowRoot === 保存的引用`） | 全新 |
| React 挂载次数 | 4 → 4（未重挂载，`root.render` 次数 1 → 2） | 新页面重新挂载 |
| 计数器状态 | `clicks:3` → `clicks:3` | 归零 |
| JSON 更新 | `0` → `1` | `2` |
| 视口 | `translate(19px,245px) scale(1.364)` 保持 | 重置为 fit view `scale(0.9)` |
| 更新耗时 | 约 0.5–1.6 s（含 VS Code 300 ms 节流与 Playwright 轮询） | — |

截图：`docs/probe/p1a-after-md-edit.png`（编辑后计数器、JSON、缩放位置均保留）、`docs/probe/p1b-during-forced-refresh.png`。

**原因（VS Code 1.144 源码 `extensions/markdown-language-features/src/preview/preview.ts`）**：

- `markdown.preview.refresh` → `MarkdownPreviewManager.refresh()` → `DynamicMarkdownPreview.refresh()` → `MarkdownPreview.refresh(true)`；`forceUpdate=true` 使 `shouldReloadPage` 为真，走 `renderDocument` 整页替换，不走 `updateContent`/morphdom。
- 非强制刷新只由 Markdown 文档自身的 `onDidChangeTextDocument` / 文件监听触发，且 `#updatePreview` 以 `(uri, document.version)` 判等，version 未变直接返回。配置变更、贡献点变更同样走强制刷新。
- 因此：**只改 `.c4`、不改 Markdown 时，公开机制中不存在走 morphdom 的刷新路径。**

**P1b 的附加观测**（为替代方案提供数据）：

- VS Code webview 换内容时先在后台 iframe 加载再切换，采样时间线（每 ~10–150 ms 统计各 frame 的已渲染节点数）显示旧 frame 一直保持 19 个节点直到切换；切换后约 400 ms 内新 frame 只渲染出 9/19（视口外的视图尚未完成），之后完整。截屏序列中可见区域未出现空白帧。
- 预览 webview 的 `sessionStorage` 与 `localStorage` 在强制重载后仍保留（新页面能读到上一页写入的值），可用于跨重载恢复视口。
- 滚动位置由内置预览自身恢复。

**morphdom 路径的其他确认**：

- 预览端不做 HTML 过滤（无 DOMPurify），`<script type="application/json">` 原样保留；新增节点时 `domEval` 会重建 `<script>` 但保留 `type` 属性，不会执行。
- `areNodesEqual` 只比较 light DOM（`isEqualNode`、`textContent`、属性），shadow root 不参与比较。
- 1.144 中 `areNodesEqual` 位于 `preview-src/index.ts` 内（任务书所列 `src/util/previewNodeEquality.ts` 在该版本不存在）。

## P2 未保存文本同步

**做法**：不继承 `LikeC4`、不访问 `protected langium`，改用公开 API 自行组装服务：

```ts
const services = createLanguageServices({          // @likec4/language-server/module
  ...WithFileSystem(watch),                         // @likec4/language-server/filesystem
  ...WithLikeC4ManualLayouts,
  ...WithWasmGraphviz,                              // 或 WithGraphviz(new GraphvizBinaryAdapter())
})
// WorkspaceManager.initialize/initialized 同 fromWorkspace
const likec4 = new LikeC4(services)                 // LikeC4 构造函数是公开的
// 未保存文本：Langium 公开 API
services.shared.workspace.TextDocuments.set(TextDocument.create(uri, 'likec4', version, text))
await services.shared.workspace.DocumentBuilder.update([uri], [])
// 关闭未保存文档：delete 后再 update，回退磁盘内容
services.shared.workspace.TextDocuments.delete(uri)
```

原理：Langium 4.4 的 `DefaultLangiumDocumentFactory.update()` 优先读 `TextDocuments.get(uri)`，没有才读文件系统。

**结果**（`node probes/p2-unsaved.mjs fixtures`）：

| 步骤 | 结果 |
|---|---|
| 磁盘内容 | `customer` 标题 `Customer` |
| overlay 改标题为 `Buyer` | `onModelUpdate('shop')` 在 update 后 +14 ms 触发；`layoutView` 返回 `Buyer`；无错误 |
| overlay 引入语法错误 | `hasErrors()` 为 true；**`layoutView` 仍返回结果**（Langium 容错解析，标题仍为 `Buyer`） |
| 删除 overlay | 回退 `Customer`，`hasErrors()` 为 false |
| 编辑 → 单视图重新布局 | 25 ms |

结论：`stale` 判定不能依赖“是否产出布局”，须以 `hasErrors()`（或按项目过滤的诊断）为准，有错误时不更新缓存。

## P3 shadow DOM 渲染

**做法**：在宿主 shadow root 内渲染 `<LikeC4ModelProvider likec4model={LikeC4Model.create(layoutedData)}><LikeC4View viewId … /></LikeC4ModelProvider>`。`LikeC4View` 内部会再创建一层 shadow root，自行注入 LikeC4 样式，并把 Mantine 的 CSS 变量与 `data-mantine-color-scheme` 挂在 shadow 内的 `.likec4-shadow-root` 上（`cssVariablesSelector`/`getRootElement`）；字体 `@font-face` 注入到 `document.head`。

**结果**：

- 4 个视图（element ×2、dynamic、deployment）全部渲染：节点/连线数 3/2、6/4、5/4、5/2；每个内层 shadow 含 3 个 `<style>`。截图 `docs/probe/p3-render.png`。
- 样式完整：节点字体为 `IBM Plex Sans Variable`，Mantine 变量（`--mantine-color-body`）在 shadow 内生效，暗色主题正确。
- 交互：滚轮平移（`translate` y 41→191）、Ctrl+滚轮缩放（scale 0.9→1.364）、拖拽平移均生效；`browser=true` 时点击元素打开浏览浮层（第二个 react-flow 实例 + dialog，含导航与缩放控件），截图 `docs/probe/p3-browser-overlay.png`。
- 预览 CSP（strict：`script-src 'nonce-…'`，`style-src 'unsafe-inline'`，无 `unsafe-eval`，`default-src 'none'`）下控制台无相关报错。
- 发现：`@likec4/diagram` 含 Vite 风格的 `import.meta.env.DEV`/`MODE`（editor 相关模块），esbuild 打 IIFE 后为 `undefined`，**第二次 `root.render` 时抛出 `Cannot read properties of undefined (reading 'DEV')`，React 19 卸载整棵树**。打包时 `define` 这两个常量后修复。
- 预览脚本须打包为 IIFE（`markdown.previewScripts` 以经典 `<script nonce>` 加载）。

## P4 扩展宿主布局

`fromWorkspace(fixtures, { graphviz: 'wasm' })` 在 VS Code 1.144 扩展宿主（Electron 43 / Node 24.22.1）中运行正常：

| 指标 | 值 |
|---|---|
| 初始化（2 个项目、2 个文档） | 738 ms |
| `layoutedModel('shop')`（4 个视图，首次） | 305 ms |
| 单视图 `layoutView`（缓存命中） | 0–1 ms |
| `shop` 布局后模型 `$data` JSON | 15 975 字节 |

纯 Node 22（脚本）对照：初始化 469 ms，`shop` 全模型布局 91 ms，`billing` 196 ms（含 wasm 首次加载）。

## P5 打包体积

原型（esbuild，minify）：

| 产物 | 原始 | gzip |
|---|---|---|
| `extension.js`（扩展端，CJS） | 3 250 856 B | 1 273 268 B |
| `preview.js`（预览端，IIFE） | 2 493 623 B | 714 002 B |

主要构成（`probes/size-breakdown.mjs`）：

- 扩展端：`@hpcc-js/wasm-graphviz` 796 KB（wasm 以内联形式打入）、`@likec4/core` 613 KB、`zod` 445 KB、`@likec4/language-server` 416 KB、`langium` 188 KB、`chevrotain` 91 KB、`esbuild`（JS 包装层）43 KB。
- 预览端：`@likec4/diagram` 829 KB、`@likec4/core` 458 KB、`@mantine/core` 243 KB、`react-dom` 206 KB、`@likec4/styles` 97 KB、`motion-dom` 94 KB、`@xyflow/react` 81 KB。

VSIX 只需包含两个产物与清单，预计 2 MB 量级（zip）。

## 其他发现

1. **`bundle-require` / esbuild**：`@likec4/config` 静态导入可选 peer `bundle-require`（用于加载 `likec4.config.{js,ts}`），后者依赖 esbuild 原生二进制。未安装时整个 `@likec4/language-services` 无法加载；打包后 esbuild 的 JS 层被打入，但运行时仍需对应平台的原生二进制，否则加载 JS/TS 配置时失败。
2. **Node 版本要求**：`@likec4/language-server@1.60.0` 声明 `engines.node >=22.22.3`，`chokidar@5` 声明 `>=20.19.0`。各 VS Code 版本内置 Node（`remote/.npmrc`）：1.100 → 20.19.0，1.104 → 22.18.0，1.108 → 22.21.1，1.112 → 22.22.0，1.120 → 22.22.1，1.130 → 24.18.0。
3. **morphdom 可用版本**：`preview-src/index.ts` 自 VS Code 1.63 起使用 morphdom 并派发 `vscode.markdown.updateContent`（1.62 无）。
4. **LikeC4 渲染组件的组合方式**：`LikeC4View` 依赖 `LikeC4ModelProvider` 中的**布局后模型**按 `viewId` 取视图；`browser=true` 时的浏览浮层从同一模型取其他视图。官方 VS Code 预览面板用的是 `LikeC4ModelProvider`（computed model）+ `LikeC4Diagram view={LayoutedView}`。
5. **`dynamic-variant=sequence`**：`LikeC4View`/`LikeC4Diagram` 1.60 的 props 含 `dynamicViewVariant`（`DynamicViewDisplayVariant`），可直接透传；`pickViewBounds(view, variant)` 按形态给出边界。
6. 依赖直接引用：上述 P2 方案需将 `@likec4/language-server`、`langium`、`vscode-languageserver-textdocument` 列为直接依赖并钉精确版本（与 `@likec4/*` 1.60.0 所用版本一致：langium 4.4.0）。

## 待 ADVISOR 裁定

1. **P1 替代方案**（阻塞项）：`.c4` 变化时如何更新预览。
2. 任务书 3.6 各项：`browser=true` 模型数据的内联方式与上限、`sequence` 首版支持、`protected langium`（P2 已给出公开 API 方案）、定位源码、`engines.vscode` 下限（受 Node 版本要求约束）。
3. `likec4.config.{js,ts}` 的支持方式（`bundle-require`/esbuild 原生二进制）。
