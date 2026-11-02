# 设计：Markdown Preview for LikeC4

在 VS Code 内置 Markdown 预览中渲染 ` ```likec4-view ` 代码块，语法与 mkdocs-likec4 兼容。本文只写最终设计。

## 1. 语法

````markdown
```likec4-view [browser=true|false] [dynamic-variant=diagram|sequence] [project=<name>] [color-scheme=auto|light|dark]
<viewId>
```
````

- info string 以 `likec4-view` 开头（`likec4-view` 之后须为空白或结束）；正文第一行非空内容为视图 id，其余行忽略。
- 选项空格分隔、顺序任意、全部可选；未知选项、取值非法的选项忽略并取缺省值。

| 选项 | 缺省 | 含义 |
|---|---|---|
| `browser` | `true` | 元素详情与视图间导航（图内浮层） |
| `dynamic-variant` | `diagram` | 动态视图形态，`sequence` 透传给 `dynamicViewVariant` |
| `project` | 最近项目 | 多项目工作区中指定项目 |
| `color-scheme` | `auto` | `auto` 跟随 VS Code 主题 |

- 视图 id 与项目名须匹配 `^[a-zA-Z][a-zA-Z0-9_-]*$`，否则直接渲染错误块，不访问模型。
- `likec4MarkdownPreview.enabled=false` 时 `likec4-view` 交回原 fence 规则，按普通代码块渲染。

## 2. 项目解析

- 扫描所有工作区根中的 `likec4.config.json`、`.likec4rc`、`likec4.config.{js,mjs,ts,mts}`（排除 `node_modules`）。JSON 类配置读取 `name` 为项目名、所在目录为项目根；配置文件增删改时重新扫描。
- **JS/TS 配置不执行**：仍参与“最近项目”查找（避免误用上级项目），但渲染错误块“不支持 likec4.config.js/ts，请改用 likec4.config.json”。打包时 `bundle-require` 与 `esbuild` 以桩替换。
- 未指定 `project`：从 Markdown 文件所在目录向上找最近的项目根（同 mkdocs-likec4 `_find_nearest_project`：路径最长的祖先项目根）。找不到时，若所在工作区根没有任何配置文件且根目录下存在 `.c4`/`.likec4` 文件，则使用该根的默认项目（项目名 `default`）；否则渲染“未找到 LikeC4 项目”。
- 指定 `project`：在所有已发现项目中按名称匹配；不存在则渲染错误块。
- Markdown 不在工作区内：按其所在目录向上查找配置文件（只查文件系统，不扫描）。

## 3. 架构

```
扩展宿主                                               内置 Markdown 预览 webview
ProjectRegistry ── 发现项目、最近项目                    preview.js（previewScripts，IIFE）
ModelService（每个 LikeC4 工作区根一个，惰性）            · 扫描 .likec4-view 宿主
  · 公开 API 组装 Langium 服务 + new LikeC4(services)   · attachShadow + createRoot（首次）
  · 磁盘：WithFileSystem(watch=true)                    · hash 变化 → root.render(新 props)
  · 未保存：TextDocuments.set/delete + DocumentBuilder   · 视口按「文档 + 宿主 id」存 sessionStorage
  · onModelUpdate → 重算被引用项目 → 比较哈希           · 宿主消失 → unmount
  · 缓存 project → {hash, state, model JSON}
RefreshScheduler → 仅当受影响文档有打开的预览时
                   执行一次 markdown.preview.refresh
MarkdownItPlugin（同步，只读缓存）── HTML ──────────▶
```

### 3.1 扩展宿主

- 激活：`onLanguage:markdown`。
- **ModelService**：以 LikeC4 工作区根（含该项目的 VS Code 工作区根，或工作区外 Markdown 的项目根）为单位创建，首次被渲染引用时惰性创建。用公开 API 组装：`createLanguageServices({...WithFileSystem(true), ...WithLikeC4ManualLayouts, ...WithWasmGraphviz | WithGraphviz(new GraphvizBinaryAdapter())})`，`WorkspaceManager.initialize/initialized`，`new LikeC4(services)`。不继承 `LikeC4`、不访问 `protected` 成员。
- **未保存编辑**：监听 `.c4`/`.likec4` 文档的 `onDidChangeTextDocument`，按 `debounceMs` 防抖后 `TextDocuments.set(TextDocument.create(uri, 'likec4', version, text))` + `DocumentBuilder.update([uri], [])`；文档关闭时 `TextDocuments.delete(uri)` + `update`，回退磁盘内容。
- **重算**：`onModelUpdate(projectId)` 后，若该项目被某个已渲染文档引用，则计算布局后模型：`layoutedModel(project)`；若项目 `hasErrors()`（该项目文档存在错误级诊断）则不更新缓存，状态置 `stale`（保留上次成功结果，附首条错误）。同一 ModelService 内重算串行，新请求到来时丢弃排队中的旧请求。
- **哈希**：对模型 JSON 计算 SHA-1。哈希不变不触发刷新。
- **刷新**：`markdown.preview.refresh` 会强制重载所有 Markdown 预览，因此只有当“受影响项目被某个当前打开预览的文档引用”时才执行，并合并为一次（同一事件循环内多项目变化只刷新一次）。“文档 → 项目”的引用关系由 markdown-it 渲染时记录；“当前打开的预览”由 `window.tabGroups` 中 `TabInputWebview`（`viewType` 含 `markdown.preview`）与可见文档推断，推断失败时按“引用该项目的文档仍打开”处理。
- **加载中**：缓存未就绪时 markdown-it 输出 `loading` 占位，ModelService 就绪后按上述规则刷新。
- **日志**：Output Channel “LikeC4 Markdown Preview”，记录项目初始化、每次重算耗时、哈希是否变化、刷新原因；不输出文件内容。

### 3.2 HTML 输出

每个文档、每个被引用项目输出一份模型（id 稳定），每个代码块输出一个宿主：

```html
<div class="likec4-model" id="likec4-model-<project>-<rootTag>" hidden><script type="application/json">{"hash":"…","trimmed":false,"model":{…LikeC4Model.Layouted $data…}}</script></div>
<div class="likec4-view" id="likec4-<project>-<viewId>-<n>" data-likec4-opts='{"project":"…","viewId":"…","browser":true,"variant":"diagram","scheme":"auto"}'>
  <script type="application/json">{"hash":"…","state":"ok|loading|error|stale","message":"…"}</script>
</div>
```

- 模型脚本紧跟在该项目首个宿主之前输出（同一文档只输出一次）。id 放在外层 `<div>` 上：内置预览加载内容与 morphdom 新增节点时会以 `domEval` 重建 `<script>`，只保留 `type`/`src`/`nonce` 等属性，`<script>` 自身的 `id`/`class` 会丢失。
- `<rootTag>` 为 ModelService 根路径 SHA-1 的前 6 位，区分不同根中同名项目；宿主 id 同样包含 `<project>-<rootTag>`。
- `<n>` 为同一 `<project>-<viewId>` 在文档中的出现序号，使 morphdom 按 id 匹配同一元素。宿主属性只放选项；数据只在 `<script>` 文本中。
- 宿主 JSON 的 `hash` = 模型哈希 + 视图状态，`view` 不重复内联。
- JSON 内联前将 `<`、`>`、`&`、U+2028、U+2029 转义为 `\uXXXX`。
- **体积上限**：转义后模型超过 `maxModelBytes`（缺省 2 MiB）时，把模型的 `views` 裁剪为本文档引用的视图，宿主强制 `browser=false` 并显示提示；文档中全部宿主为 `browser=false` 时也只内联裁剪后的模型。

### 3.3 预览端

- `DOMContentLoaded` 与每次 `vscode.markdown.updateContent` 后扫描一次。
- 新宿主：`attachShadow({mode:'open'})`，`createRoot`，渲染 `LikeC4ModelProvider` + `LikeC4View`（`LikeC4View` 内部再建一层 shadow root、注入 LikeC4 样式、把 Mantine 变量挂在 shadow 内）。同一项目的 `LikeC4Model.create` 结果按模型哈希缓存，多宿主共享。
- 已有宿主：宿主 JSON 与模型哈希都未变则跳过；否则 `root.render(新 props)`，组件不重挂载。
- 宿主从文档消失：`unmount` 并清理。
- 状态：`loading` 显示占位；`error` 显示错误块（不渲染图）；`stale` 渲染上次成功的模型并叠加提示条。
- 主题：`color-scheme=auto` 读 `document.body` 的 `vscode-light`/`vscode-dark`/`vscode-high-contrast` 类，`MutationObserver` 监听变化；`light`/`dark` 固定。
- 尺寸：`LikeC4View` 按布局边界（`pickViewBounds(view, variant)`）保持宽高比自适应宽度，最大高度为 `maxHeight`（通过 CSS 变量 `--likec4-view-max-height` 与宿主 `max-height`）。图内可缩放、平移。
- 视口：以「文档 URI + 宿主 id」为键存 `sessionStorage`（限流写入，只保留当前文档的键）。重载或重挂载时，若有保存的视口，则以 `fitView=false` 渲染并在 `onInitialized` 中 `setViewport` 恢复；否则 fit view。同一宿主数据更新（morphdom 路径）时组件不重挂载，视口自然保持。
- 打包：IIFE；`define` `process.env.NODE_ENV`、`import.meta.env.DEV`、`import.meta.env.MODE`。无 `eval`、不插入 `<script>`、无网络请求。

### 3.4 更新链路与已知限制

| 变化 | 链路 | 效果 |
|---|---|---|
| 编辑 Markdown 正文或代码块 | 内置预览非强制刷新 → morphdom | 宿主、shadow root、React 状态、视口全部保留 |
| 编辑 `.c4`（含未保存） | 防抖 → 重算 → 哈希变化 → `markdown.preview.refresh`（整页重载） | 视口从 sessionStorage 恢复；webview 后台加载后切换 |
| `.c4` 出现错误 | 不更新缓存，`stale` | 保留上次结果并提示 |

已知限制：`.c4` 变化会重载所有打开的、引用了受影响项目的 Markdown 预览；浏览浮层、选中、动态视图步进等瞬时状态在重载后丢失。

## 4. 设置项

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `likec4MarkdownPreview.enabled` | boolean | `true` | 关闭后按普通代码块渲染 |
| `likec4MarkdownPreview.debounceMs` | number | `250` | 未保存编辑的防抖时间 |
| `likec4MarkdownPreview.maxHeight` | number | `600` | 视图最大高度（px） |
| `likec4MarkdownPreview.graphviz` | `wasm`/`binary` | `wasm` | 布局引擎 |
| `likec4MarkdownPreview.maxModelBytes` | number | `2097152` | 单项目内联模型上限，超出时裁剪并禁用 browser |

## 5. 范围与兼容

- 只读；不注册 LSP 客户端，不提供诊断与补全，与官方 LikeC4 扩展互不干扰。
- 清单声明 `capabilities.untrustedWorkspaces: { supported: true }`（不执行工作区代码）。
- 不包含：定位源码（`command:` URI 在预览中不放行，待后续评估 `vscode://` URI 方案）、Notebook、第三方预览、导出 HTML/PDF。
- `engines.vscode`：取 1.63 与“桌面扩展宿主内置 Node 满足所有打包依赖 `engines.node`（`@likec4/language-server@1.60.0` 要求 ≥22.22.3）”的最早版本中的较大者，以扩展宿主实测 `process.versions.node` 为准。

## 6. 验收口径调整（相对任务书 7.2）

- E3：从 `.c4` 编辑到预览更新 1 秒内（P95，不含防抖）；视口保持；截屏序列中可见区域内的视图不出现空白帧，也不出现先 fit 再跳回。
- E9：本机无 `ci-metrics`，以 `fixtures/large`（脚本生成的大模型）上的 10 视图文档替代；7.3 第二个模型同此。

## 7. ADVISOR 裁定清单

| 事项 | 裁定 |
|---|---|
| `.c4` 变化的更新方式 | 强制刷新 + 视口持久化（方案 A）；仅受影响且打开的预览才刷新 |
| `browser=true` 模型数据 | 每文档每项目内联一份布局后模型；上限 2 MiB（设置项），超限裁剪视图并禁用 browser，单一渲染路径 |
| `sequence` | 首版支持，透传 |
| `protected langium` | 不用；公开 API 组装服务 |
| 定位源码 | 不纳入首版 |
| `engines.vscode` | 依赖声明的 Node 版本决定下限，实测扩展宿主 Node |
| JS/TS 配置 | 不执行，桩替换 `bundle-require`/`esbuild`，渲染错误块 |
