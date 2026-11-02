# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

VS Code 扩展 **Markdown Preview for LikeC4**（包名 `likec4-markdown-preview`，非 LikeC4 官方项目）：在 VS Code **内置** Markdown 预览中渲染 ` ```likec4-view ` 代码块，语法与 mkdocs-likec4 兼容。

- 完整需求、验收标准与流程：`docs/task.md`（权威来源，改设计前先读）。
- 经 ADVISOR 裁定后的最终设计：`docs/design.md`（只写最终结论，不写过程与否决方案）。
- 第 0 步探测记录：`docs/probe.md`；验收报告：`docs/acceptance.md`。

当前状态：0.1.0 已实现并验收（`docs/acceptance.md`）；最终设计见 `docs/design.md`（含 ADVISOR 裁定）。

## 命令

```bash
npm run build                 # esbuild → dist/extension.js (Node CJS) + dist/preview.js (IIFE)；--dev 不压缩带 sourcemap
npx tsc -p .                  # 类型检查（esbuild 不做类型检查）
npx eslint .
npx vitest run                # 单元测试；单个：npx vitest run test/unit/markdownIt.test.ts -t "关键字"
xvfb-run -a node test/integration/run.mjs                      # @vscode/test-electron，VS Code 1.144（VSCODE_VERSION=1.123.0 测下限）
xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs  # Playwright 驱动真实 VS Code；可传场景名：E1-E2-E3-E4-E5 P1c E6-theme E9-large E7-coexist
node scripts/notices.mjs      # 由 dist/meta.json 生成 THIRD_PARTY_NOTICES（需先 build）
npm run package               # build + notices + vsce package
```

- e2e 结果与截图在 `test-results/e2e/`（无参数运行会先清空）；`test/e2e/driver/` 是仅测试时加载的驱动扩展（打开文件、未保存编辑、改设置）。E7 需先把官方扩展装到 `.vscode-test/e7-extensions`，E8 用 `test/e2e/e8-mkdocs.mjs <已构建的 mkdocs 目录>`。
- WSL 下 `!` 执行的命令没有 TTY，`sudo` 需用户在终端自行执行。

## 架构（跨文件的关键点）

两端通过**内联在 HTML 中的 JSON** 单向通信，预览脚本无法直接与扩展通信。

**扩展宿主（Node）**
- 注意：`markdown.preview.refresh` 是**强制整页重载**（P1 结论），只改 `.c4` 时不存在走 morphdom 的路径；为此宿主 light DOM 内有服务端生成的静态 SVG 快照（`src/staticSvg.ts`），预览入口（`preview/index.ts`）先按保存视口定位快照、再懒加载应用（`preview/app.tsx`），图在 shadow 内隐藏初始化、就绪后才替换 `<slot>` 显示的快照。细节见 `docs/design.md` §3.3。
- `src/markdownIt.ts`：同步 markdown-it fence 规则，只接管 info string 以 `likec4-view` 开头的块，其余交回原规则（须能与其他改写 fence 的插件串联）。**规则内只读缓存**，不做 I/O 或布局；缓存未就绪输出 `state: "loading"` 占位，就绪后触发刷新。
- `src/projects.ts`：扫描各工作区根中的 `likec4.config.json` / `.likec4rc` / `likec4.config.{js,ts}`；从 Markdown 所在目录向上找最近项目（同 mkdocs-likec4 `_find_nearest_project`），兜底为默认项目（无配置、根目录有 `.c4`）。
- `src/modelService.ts`：每个 LikeC4 工作区根一个实例，惰性创建。不继承 `LikeC4`，而是用 `@likec4/language-server` 的公开模块组装服务后 `new LikeC4(services)`，磁盘变化靠 `WithFileSystem(true)`（chokidar），未保存编辑经防抖后 `TextDocuments.set` + `DocumentBuilder.update`，文档关闭/保存时 `delete` 回退磁盘内容。`onModelUpdate` 后**只重算已被渲染引用的项目**（`layoutedModel`），以规范化 JSON（键排序，`$data` 键序不稳定）的哈希判断变化。重算串行合并。模型有错误（以 `hasErrors` 类诊断判定，Langium 容错仍会产出模型）时保留上次成功结果，状态 `stale`。
- `src/refresh.ts` + `src/extension.ts`：`markdown.preview.refresh` 会重载**所有**预览，故仅当受影响项目被仍打开的文档引用、且有 Markdown 预览打开时才调用（5 ms 合并）。

**预览 webview（`preview/` → `preview.js`，经 `markdown.previewScripts` 注入）**
- `preview/index.ts`（轻量入口）→ `preview/app.tsx`（React + `LikeC4ModelProvider` + `LikeC4View`，懒 `require`）；`preview/hosts.ts` 管宿主生命周期（可单测，不依赖 React），`preview/viewport.ts` 管视口持久化（`sessionStorage`，键为文档 URI + 宿主 id）与快照定位。
- 已有宿主：hash/选项/配色未变则跳过，否则 `root.render(新 props)`（不重挂载）；消失的宿主 `unmount`；屏幕外宿主延迟挂载。
- 图始终 `fitView=true` 初始化（`fitView=false` 时 LikeC4 平移/缩放失效），在 `onInitialized` 中用 `diagram.send({type:'xyflow.setViewport'})` 恢复视口；宿主上用**捕获阶段**监听交互（React Flow 阻止冒泡）。滚轮滚动页面，Ctrl/⌘+滚轮缩放。
- 打包需 `define` `import.meta.env.DEV/MODE`（`@likec4/diagram` 含 Vite 风格引用，否则二次渲染崩溃）。

**宿主元素契约（无闪烁更新的核心，改动前务必理解）**

```html
<div class="likec4-model" id="likec4-model-<project>-<rootTag>" hidden><script type="application/json">{"hash","trimmed","model":{…}}</script></div>
<div class="likec4-view" id="likec4-<project>-<rootTag>-<viewId>-<n>" data-likec4-opts='{...仅选项...}'>
  <script type="application/json">{"hash":"…","state":"ok|loading|error|stale","message":"…"}</script>
  [<div class="likec4-notice">…</div>] <svg class="likec4-static" data-bounds="…">…快照…</svg>
</div>
```

- 模型每文档每项目一份，id 放在外层 `<div>`：VS Code 的 `domEval` 重建 `<script>` 时只保留 `type` 等属性。
- 就绪标记在 shadow root 内（`.likec4-root[data-ready]`）：宿主自身的属性会被 morphdom 删掉。`ShadowRoot.querySelector` 中不能用 `:scope`。

- VS Code 预览用 morphdom 合并 DOM（`areNodesEqual` 只比 light DOM、忽略 `data-line`）。`id` 必须稳定（`<n>` 为该视图在文档中的出现序号），宿主属性**只放选项**，数据只出现在 `<script>` 文本里——这样 morphdom 只改文本节点，宿主元素与其 shadow root、React root 得以保留。
- 内联 JSON 前把 `<` `>` `&` U+2028 U+2029 转义为 `\uXXXX`。
- 视图 id 与项目名须匹配 `^[a-zA-Z][a-zA-Z0-9_-]*$`，否则直接输出错误块、不访问模型；未知 fence 选项静默忽略。

## 硬性约束

- 不复制 LikeC4 源码；确需复制须保留其 MIT 头并记入 `THIRD_PARTY_NOTICES`（复用 VS Code `areNodesEqual` 逻辑的测试代码同样注明来源与 MIT 声明）。
- 不依赖官方 LikeC4 扩展内部 API；不注册 LSP 客户端、不提供诊断/补全，以免与官方扩展冲突。名称与图标不得暗示官方，不用 LikeC4 logo。
- 预览脚本：无 `eval`、不动态插入 `<script>`、无网络请求。
- 依赖钉精确版本，`likec4` / `@likec4/*` 版本一致（基线 `likec4@1.60.0`）。
- 日志写独立 Output Channel（重算耗时与刷新原因），不输出文件内容。
- 范围外：编辑能力、Notebook 单元格、第三方预览扩展、HTML/PDF 导出、发布到市场。

## 流程（主 Agent + ADVISOR 双人门控）

1. 第 0 步探测 P1–P5，结果写入 `docs/probe.md`；任一不通过须先与 ADVISOR 定替代方案。
2. 方案共审：以**只读子代理**启动 ADVISOR，交给它 `docs/task.md` 与探测结果，对第 3.6 节逐条裁定，写入 `docs/design.md` 后开工。
3. 分 M1 / M2 / M3 实施，每步交 ADVISOR 做改动验收与效果验收，附测试命令与输出。
4. 终评审由 ADVISOR 主导，达成一致后闭合。

- 提交信息只写变更内容本身，**不附任何 agent/LLM 署名**（覆盖默认的 Co-Authored-By 规则）。
- 不推送远端、不发布扩展，由用户决定。
