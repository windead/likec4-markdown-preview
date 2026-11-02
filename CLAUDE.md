# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概况

VS Code 扩展 **Markdown Preview for LikeC4**（包名 `likec4-markdown-preview`，非 LikeC4 官方项目）：在 VS Code **内置** Markdown 预览中渲染 ` ```likec4-view ` 代码块，语法与 mkdocs-likec4 兼容。

- 完整需求、验收标准与流程：`docs/task.md`（权威来源，改设计前先读）。
- 经 ADVISOR 裁定后的最终设计：`docs/design.md`（只写最终结论，不写过程与否决方案）。
- 第 0 步探测记录：`docs/probe.md`；验收报告：`docs/acceptance.md`。

当前状态：仓库刚初始化，尚无代码。下一步是第 0 步探测（P1–P5，见 `docs/task.md` 第 4 节）。

## 命令

工程尚未搭建。预定工具链：TypeScript、esbuild（两份产物：扩展端 Node bundle 与预览端浏览器 bundle `preview.js`）、ESLint、单元测试（预览脚本用 jsdom + morphdom）、`@vscode/test-electron` 集成测试、`vsce package` 打包 VSIX。**搭建 `package.json` 后，把 build / lint / 全量测试 / 单个测试 / 集成测试 / 打包的实际命令补写到本节。**

## 架构（跨文件的关键点）

两端通过**内联在 HTML 中的 JSON** 单向通信，预览脚本无法直接与扩展通信。

**扩展宿主（Node）**
- `src/markdownIt.ts`：同步 markdown-it fence 规则，只接管 info string 以 `likec4-view` 开头的块，其余交回原规则（须能与其他改写 fence 的插件串联）。**规则内只读缓存**，不做 I/O 或布局；缓存未就绪输出 `state: "loading"` 占位，就绪后触发刷新。
- `src/projects.ts`：扫描各工作区根中的 `likec4.config.json` / `.likec4rc` / `likec4.config.{js,ts}`；从 Markdown 所在目录向上找最近项目（同 mkdocs-likec4 `_find_nearest_project`），兜底为默认项目（无配置、根目录有 `.c4`）。
- `src/modelService.ts`：每个项目一个实例，惰性创建。继承 `LikeC4`（`@likec4/language-services`）以访问 `protected langium`；磁盘变化靠 `fromWorkspace(root, {watch:true})`，未保存编辑经防抖后写入 Langium 文档并 `DocumentBuilder.update`，文档未保存关闭时回退磁盘内容。`onModelUpdate` 后**只重算已被渲染引用的视图**，比较布局哈希，有变化才调用一次 `markdown.preview.refresh`。同项目重算串行，丢弃排队中的旧请求。模型出错时保留上次成功布局，状态 `stale`。

**预览 webview（`preview/` → `preview.js`，经 `markdown.previewScripts` 注入）**
- 在 `DOMContentLoaded` 与每次 `vscode.markdown.updateContent` 后扫描 `.likec4-view` 宿主。
- 新宿主：`attachShadow` → 注入 `@likec4/diagram` 样式 → `createRoot`；已有宿主：`hash` 未变则跳过，否则 `root.render(新 props)`（不重挂载）；消失的宿主 `unmount`。
- 视口（缩放/平移）按宿主 id 存内存；`color-scheme=auto` 用 `MutationObserver` 监听 `body` 的 `vscode-light/dark/high-contrast` 类。

**宿主元素契约（无闪烁更新的核心，改动前务必理解）**

```html
<div class="likec4-view" id="likec4-<project>-<viewId>-<n>" data-likec4-opts='{...仅选项...}'>
  <script type="application/json">{"hash":"…","state":"ok|loading|error|stale","view":{…},"message":"…"}</script>
</div>
```

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
