# 任务书：Markdown Preview for LikeC4（VS Code 扩展）

本任务书交给实施 Agent，覆盖设计、开发与验收。实施遵守工作区约定的「主 Agent + ADVISOR 双人门控」：方案共审 → 逐步共识 → 终评审（见第 9 节）。

## 1. 目标

在 VS Code 内置 Markdown 预览中渲染 LikeC4 视图，语法与 [mkdocs-likec4](https://github.com/doubleSlashde/mkdocs-likec4) 兼容：

````markdown
```likec4-view
service-context
```
````

完成后应满足：

- 同一份 Markdown 在 mkdocs-likec4 站点与 VS Code 预览中写法一致、都能渲染；
- 修改 Markdown 或 `.c4` 文件（含未保存的编辑）后，预览中的视图在 1 秒内更新，且不闪烁、不丢失缩放与平移——表现与官方 LikeC4 扩展的预览面板一致；
- 不替换内置 Markdown 渲染，与其他 Markdown 扩展（如 Mermaid）共存。

## 2. 必读材料

| 材料 | 用途 |
|---|---|
| [VS Code Markdown Extension Guide](https://code.visualstudio.com/api/extension-guides/markdown-extension) | `markdown.markdownItPlugins`、`markdown.previewScripts`、`markdown.previewStyles` |
| VS Code 源码 `extensions/markdown-language-features/preview-src/index.ts`（`updateContent` 分支）、`src/util/previewNodeEquality.ts` | 预览用 morphdom 差异合并、`areNodesEqual` 只比较 light DOM 且忽略 `data-line`；`vscode.markdown.updateContent` 事件 |
| mkdocs-likec4 源码 `mkdocs_likec4/parser.py`、`plugin.py` | fence 语法、选项、最近项目查找规则 |
| LikeC4 仓库 `packages/vscode/src/panel/useDiagramPanel.ts`、`panel/activateMessenger.ts`、`useRpc.ts` | 官方预览的更新链路：模型变化通知 → webview 失效重取 → 组件不重挂载 |
| LikeC4 仓库 `packages/vscode-preview/src/state.ts`、`screens/View.tsx` | 官方预览端对 `LayoutedView` 的渲染方式 |
| LikeC4 仓库 `packages/language-server/src/Rpc.ts` | `LangiumDocuments` / `DocumentBuilder` 的用法与变更通知的合并防抖 |
| npm `likec4@1.60.0` 类型定义（`LikeC4.fromWorkspace`、`LikeC4Options.watch`）、`@likec4/language-services` 的 `LikeC4` 类（`layoutedModel()`、`onModelUpdate()`、`protected langium`） | 扩展宿主侧的模型服务 |
| `@likec4/diagram` 的 `LikeC4View` / `LikeC4Diagram` 类型定义 | 预览端渲染组件与 props |

## 3. 设计

### 3.1 语法

- fence 的 info string 以 `likec4-view` 开头；正文第一行非空内容为视图 id；其余行忽略。
- 选项写在 info string 中，空格分隔，顺序任意，全部可选，与 mkdocs-likec4 一致：

| 选项 | 取值 | 缺省 | 含义 |
|---|---|---|---|
| `browser` | `true` / `false` | `true` | 是否允许打开元素详情与视图间导航 |
| `dynamic-variant` | `diagram` / `sequence` | `diagram` | 动态视图的展示形态 |
| `project` | LikeC4 项目名 | 最近项目 | 多项目工作区中指定项目 |
| `color-scheme` | `auto` / `light` / `dark` | `auto` | `auto` 跟随 VS Code 主题 |

- 视图 id 与项目名须匹配 `^[a-zA-Z][a-zA-Z0-9_-]*$`；不匹配时渲染错误块，不访问模型。
- 未知选项忽略（与 mkdocs-likec4 行为一致），不报错。

### 3.2 项目解析

- 扫描工作区（含多根工作区的每个根）中的 `likec4.config.json` / `.likec4rc` / `likec4.config.{js,ts}`，以 `name` 为项目名、所在目录为项目根。
- 未指定 `project` 时，从 Markdown 文件所在目录向上查找最近的项目根（规则同 mkdocs-likec4 `_find_nearest_project`）；找不到且工作区只有一个默认项目（无配置文件、根目录下存在 `.c4`）时使用默认项目；否则渲染「未找到 LikeC4 项目」错误块。
- Markdown 文件不在工作区内时，按其所在目录向上查找；仍找不到则渲染错误块。

### 3.3 架构

```
扩展宿主（Node）                                       内置 Markdown 预览 webview
┌────────────────────────────────────────┐          ┌───────────────────────────────────────┐
│ ModelService（每个项目一个实例）          │          │ preview.js（previewScripts，静态打包）  │
│  · 自定义子类继承 LikeC4，暴露 langium    │          │  · 扫描 .likec4-view 宿主元素           │
│  · 磁盘：fromWorkspace(root, watch:true) │          │  · 首次：attachShadow + 注入样式        │
│  · 未保存：onDidChangeTextDocument →     │          │         + createRoot                  │
│    DocumentBuilder.update（防抖）         │          │  · 每次 updateContent：读 JSON，        │
│  · onModelUpdate → 重算被引用视图布局     │          │    哈希变化时 root.render(新 props)     │
│  · 缓存 viewId → {hash, LayoutedView}    │          │  · 视口状态按宿主 id 保存               │
│  · 有视图变化 → markdown.preview.refresh │          │  · 宿主消失时 root.unmount()            │
│ MarkdownItPlugin（同步）                  │  HTML    │                                       │
│  · fence → 宿主元素 + 内联 JSON           │ ───────▶ │ React + @likec4/diagram（shadow DOM）  │
│  · 缓存未就绪 → 占位，就绪后触发刷新       │          └───────────────────────────────────────┘
└────────────────────────────────────────┘
```

**宿主元素**（markdown-it 插件输出）：

```html
<div class="likec4-view" id="likec4-<project>-<viewId>-<n>"
     data-likec4-opts='{"browser":true,"variant":"diagram","scheme":"auto"}'>
  <script type="application/json">{ "hash": "...", "state": "ok", "view": { …LayoutedView… } }</script>
</div>
```

- `id` 稳定：`<n>` 为同一视图在本文档中的出现序号，使 morphdom 按 id 匹配同一元素。
- 宿主的属性只放选项，不放哈希或数据——数据变化只体现在 `<script>` 文本上，morphdom 只改该文本节点、保留宿主元素及其 shadow root。
- JSON 内联前转义 `<`、`>`、`&`、U+2028、U+2029 为 `\u` 形式，防止 `</script>` 截断与注入。
- `state` 取值：`ok`、`loading`（缓存未就绪）、`error`（附 `message`，如视图不存在、项目不存在、模型解析失败且无历史结果）、`stale`（模型当前有错误，`view` 为上次成功的结果，附 `message`）。

**预览端更新规则**：

1. `DOMContentLoaded` 与每次 `vscode.markdown.updateContent` 后执行一次扫描。
2. 新宿主：`attachShadow({mode:'open'})`，注入 `@likec4/diagram` 样式（以 `<style>` 或 constructable stylesheet 放入 shadow root），`createRoot` 后渲染。
3. 已有宿主：读取 JSON，`hash` 与上次相同则跳过；不同则以新 `view` 调用 `root.render`，组件不重挂载。
4. 已挂载但从文档中消失的宿主：`unmount` 并清理状态。
5. `color-scheme=auto` 时读取 `document.body` 的 `vscode-light` / `vscode-dark` / `vscode-high-contrast` 类，并以 `MutationObserver` 监听主题切换。
6. 视图高度：按布局边界的宽高比自适应预览宽度，上限为设置项 `maxHeight`；超出时可在图内缩放、平移。
7. 视口（缩放与平移）以宿主 id 为键保存在内存中；同一宿主数据更新后保持视口，除非视图边界变化导致内容完全移出可视区（此时 fit view）。

**扩展宿主侧更新规则**：

1. 激活：`onLanguage:markdown`；首次渲染到某项目的视图时才创建该项目的 ModelService（惰性）。
2. 磁盘变化走 `watch: true`；未保存的编辑监听 likec4 语言文档的 `onDidChangeTextDocument`，以设置项 `debounceMs`（默认 250）防抖后写入 Langium 文档并 `DocumentBuilder.update`；文档关闭且未保存时回退到磁盘内容。
3. `onModelUpdate(projectId)` 后，只重算本扩展已渲染过的视图（维护「项目 → 被引用视图」集合），比较布局哈希；有变化才执行一次 `markdown.preview.refresh`。
4. 模型有错误时保留每个视图上次成功的布局，状态置为 `stale`。
5. 同一项目内的重算串行执行，新请求到来时丢弃排队中的旧请求。

### 3.4 设置项

| 键 | 类型 | 缺省 | 说明 |
|---|---|---|---|
| `likec4MarkdownPreview.enabled` | boolean | `true` | 关闭后 `likec4-view` 按普通代码块渲染 |
| `likec4MarkdownPreview.debounceMs` | number | `250` | 未保存编辑的防抖时间 |
| `likec4MarkdownPreview.maxHeight` | number | `600` | 视图最大高度（px） |
| `likec4MarkdownPreview.graphviz` | `wasm` / `binary` | `wasm` | 布局引擎，对应 `LikeC4Options.graphviz` |

### 3.5 交互范围

- 只读：不支持拖拽改布局、保存手动布局等编辑操作。
- `browser=true` 时支持元素详情与视图间导航（导航在图内切换，不改变 Markdown 文本）；需要完整模型时，按项目内联一份模型数据（同一文档多处引用时只内联一次），由 3.6 裁定具体方式。
- 点击元素「定位源码」作为可选能力（M3），实现方式由 3.6 裁定（预览脚本无法直接与本扩展通信，可用 `command:` URI 链接）。

### 3.6 需与 ADVISOR 裁定的细节

- `browser=true` 所需的完整模型数据：内联方式、体积上限与超限时的降级。
- `dynamic-variant=sequence` 是否首版支持（取决于 `@likec4/diagram` 的组件支持情况）。
- 继承 `LikeC4` 访问 `protected langium` 的方式是否可接受；若第 0 步发现更好的公开 API，改用公开 API。
- 「定位源码」的实现方式与是否纳入首版。
- `engines.vscode` 最低版本（以 morphdom 预览与 `vscode.markdown.updateContent` 事件可用的最早版本为下限，第 0 步确认）。

## 4. 开工前的探测（第 0 步）

各写最小原型，结果作为方案共审的依据；任一项不通过须先与 ADVISOR 定替代方案再开工：

| # | 探测 | 通过标准 |
|---|---|---|
| P1 | morphdom 保留宿主 | 在内置预览中，宿主带稳定 id、React 挂在其 shadow root；只改 `<script>` 文本并 `markdown.preview.refresh` 后，宿主元素与 shadow root 是同一对象，React 状态（如计数器）保留 |
| P2 | 未保存文本同步 | 继承 `LikeC4` 后以内存文本 `DocumentBuilder.update`，`onModelUpdate` 触发且 `layoutedModel()` 返回新布局 |
| P3 | shadow DOM 渲染 | `@likec4/diagram` 在 shadow root 内样式完整，缩放、平移、元素点击可用；预览 CSP 下无报错 |
| P4 | 扩展宿主布局 | `fromWorkspace` + wasm Graphviz 在 VS Code 扩展宿主（Electron Node）中可运行；记录典型视图的布局耗时 |
| P5 | 打包体积 | `preview.js` 与扩展包体积；记录数值 |

## 5. 范围

### 5.1 包含

| 模块 | 内容 |
|---|---|
| `src/extension.ts` | 激活、设置项、`extendMarkdownIt` 导出 |
| `src/markdownIt.ts` | fence 规则：只接管 `likec4-view`，其余交回原规则；选项解析；宿主元素与 JSON 输出 |
| `src/projects.ts` | 项目发现与最近项目查找；配置文件增删时更新 |
| `src/modelService.ts` | LikeC4 实例管理、未保存文本同步、布局缓存与哈希、刷新触发 |
| `preview/` | 预览脚本：扫描、shadow root、渲染、更新、视口保存、主题跟随、错误与 stale 展示 |
| 工程 | TypeScript、esbuild 打包（扩展端 Node / 预览端浏览器两份产物）、ESLint、单元测试、扩展集成测试、`vsce package` |
| 文档 | README（语法、选项、与 mkdocs-likec4 的兼容说明、设置项、「非 LikeC4 官方项目」声明）、CHANGELOG |
| 许可 | 本项目 MIT；`THIRD_PARTY_NOTICES` 由工具生成，覆盖打包进 VSIX 的全部依赖（含 Apache-2.0 的 `@hpcc-js/wasm-graphviz` 与其内含的 Graphviz 声明） |

### 5.2 不包含

- 编辑能力（拖拽、手动布局保存）；
- Notebook 中 Markdown 单元格的渲染；
- 第三方 Markdown 预览扩展（如 Markdown Preview Enhanced）的适配；
- 导出 HTML / PDF 时的视图渲染；
- 发布到 Marketplace / Open VSX（由用户决定，交付到可发布的 VSIX 为止）。

## 6. 技术约束

- 不复制 LikeC4 源码；如确需复制片段，文件头保留 LikeC4 的 MIT 版权声明并记入 `THIRD_PARTY_NOTICES`。
- 名称与图标不得暗示官方：扩展名形如 `likec4-markdown-preview`，显示名 `Markdown Preview for LikeC4`，不使用 LikeC4 官方 logo。
- 不修改、不依赖官方 LikeC4 扩展的内部 API；与官方扩展同时安装时互不干扰（不注册 LSP 客户端、不提供诊断与补全）。
- 预览脚本不使用 `eval`、不动态插入 `<script>`、不发起网络请求；所有数据来自内联 JSON。
- 扩展宿主不阻塞：markdown-it 规则内只读缓存，不做同步 I/O 与布局计算。
- 依赖钉精确版本；`likec4` / `@likec4/*` 各包版本一致。
- 日志输出到独立的 Output Channel，记录每次重算的耗时与刷新原因；不输出文件内容。

## 7. 验收标准

### 7.1 自动化测试

| 类别 | 必须覆盖 |
|---|---|
| fence 解析 | 选项任意顺序、缺省值、未知选项忽略、非法视图 id 与项目名、空正文、非 `likec4-view` 代码块原样交回原规则（与另一个改写 fence 的插件串联时两者都生效） |
| JSON 转义 | 视图标题与描述含 `</script>`、`<!--`、U+2028 时 HTML 结构不被破坏，解析后与原数据相等 |
| 项目解析 | 单项目、多项目嵌套、多根工作区、`project=` 显式指定、找不到项目、默认项目 |
| ModelService | 磁盘修改触发重算；未保存编辑触发重算；关闭未保存文档回退磁盘内容；模型错误时 `stale` 且保留上次布局；哈希不变不触发刷新；并发编辑只保留最新一次重算 |
| 预览脚本（jsdom + morphdom，复用 VS Code `areNodesEqual` 的逻辑，注明来源与 MIT 声明） | 只改 JSON 时宿主与 shadow root 保留、React root 不重建；Markdown 其他部分变化时宿主不被触碰；宿主删除时 unmount；同一视图多次引用互不干扰；`hash` 相同跳过渲染 |
| 扩展集成（`@vscode/test-electron`） | 以 `markdown.api.render` 命令渲染样例文档，输出包含宿主元素与合法 JSON；修改 fixture 中的 `.c4` 后再次渲染得到新哈希；`enabled=false` 时输出普通代码块 |

### 7.2 端到端（手工 + 录屏）

使用仓库内 `fixtures/` 工作区（至少两个 LikeC4 项目，含 element、dynamic、deployment 视图各一）：

| # | 操作 | 期望 |
|---|---|---|
| E1 | 打开含 4 个 `likec4-view` 的 Markdown 预览 | 四个视图全部渲染，元素与连线与官方扩展预览面板一致 |
| E2 | 在预览中缩放、平移某视图后编辑 Markdown 正文（不动该代码块） | 该视图不闪烁，视口保持 |
| E3 | 不保存，修改 `.c4` 中该视图内某元素的标题 | 1 秒内预览中标题更新，视口保持，无整图闪烁 |
| E4 | 在 `.c4` 中制造语法错误 | 视图保留上次结果并显示 stale 提示；修正后提示消失 |
| E5 | 把代码块中的视图 id 改为不存在的 id，再改回 | 显示错误块，改回后恢复渲染 |
| E6 | 切换 VS Code 亮/暗/高对比主题 | `auto` 视图随之切换，`light`/`dark` 视图保持 |
| E7 | 同时安装官方 LikeC4 扩展与 Mermaid 扩展 | 三者功能正常，诊断不重复，Mermaid 图正常 |
| E8 | 同一 Markdown 用 mkdocs-likec4 构建 | 两边渲染的视图一致（截图对比） |
| E9 | 打开 `ci-metrics/docs/design/arc42.md` 的副本，把其中的 LikeC4 视图引用改为 `likec4-view` 写法 | 全部视图在预览中渲染 |

### 7.3 性能

在 fixture 与 `ci-metrics/docs/design` 两个模型上记录（来自 Output Channel 日志）：

- 从 `.c4` 编辑到预览更新完成的耗时（P50 / P95），目标 P95 < 1 秒（不含防抖）；
- 打开含 10 个视图的文档的首屏耗时；
- 扩展包与 `preview.js` 体积。

结果写入验收报告，不达标项由 ADVISOR 裁定是否阻塞。

## 8. 交付物

1. 扩展源码、测试与 `fixtures/`；可安装的 VSIX。
2. 设计文档 `docs/design.md`：只写最终设计（本任务书第 3 节经裁定后的版本），不写过程与否决方案。
3. README、CHANGELOG、LICENSE（MIT）、`THIRD_PARTY_NOTICES`。
4. 第 0 步探测记录（`docs/probe.md`：每项的做法、结果、数据）。
5. 验收报告 `docs/acceptance.md`：7.1 测试输出摘要、7.2 每项的录屏或截图、7.3 性能数据、ADVISOR 裁定清单、遗留问题。

## 9. 流程

1. **第 0 步探测**（第 4 节），记录结果。
2. **方案共审**：以子代理启动 ADVISOR（只读评审方），交给它本任务书与探测结果，对第 3.6 节逐条裁定；裁定写入 `docs/design.md` 后开工。
3. **分步实施与逐步共识**，建议拆分：
   - M1：fence 插件 + 项目解析 + ModelService（磁盘模式）+ 预览端静态渲染（E1、E5、E6、E9）；
   - M2：未保存文本同步 + morphdom 保留 + 视口保存 + stale（E2、E3、E4）；
   - M3：`browser=true`、`sequence`、定位源码（按裁定）、共存与兼容（E7、E8）、性能与打包。
   每步交 ADVISOR 做改动验收与效果验收，附测试命令与输出。
4. **终评审**：ADVISOR 主导整体评审，提供独立复核与遗漏清单，达成一致后闭合。

提交信息只写变更内容本身，不附任何 agent/LLM 署名。不推送远端、不发布扩展，由用户决定。
