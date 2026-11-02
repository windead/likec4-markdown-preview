# 验收报告：Markdown Preview for LikeC4 0.1.0

- 交付物：`likec4-markdown-preview-0.1.0.vsix`（1.94 MB，10 个文件），由 `npm run package` 生成。
- 验收环境：WSL2 Ubuntu 24.04、xvfb 虚拟显示；测试用 VS Code 1.144.0（Electron 43.8.3，扩展宿主 Node 24.22.1），兼容性下限另测 VS Code 1.123.0。
- 证据目录：`docs/acceptance/`。所有 e2e 数据与截图出自同一次完整运行（先清空输出目录，`node test/e2e/run.mjs`，6 个场景全部通过），E8 与 VSIX 冒烟紧随其后运行。

## 1. 自动化测试（任务书 7.1）

| 类别 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc -p .` | 无错误 |
| Lint | `npx eslint .` | 无错误 |
| 单元测试 | `npx vitest run` | 9 个文件、62 个用例全部通过 |
| 扩展集成（VS Code 1.144.0） | `xvfb-run -a node test/integration/run.mjs` | 5/5 通过 |
| 扩展集成（VS Code 1.123.0） | `VSCODE_VERSION=1.123.0 xvfb-run -a node test/integration/run.mjs` | 5/5 通过 |
| 端到端 | `xvfb-run -a -s "-screen 0 1600x1000x24" node test/e2e/run.mjs` | E1–E5、P1c、E6、E9、E7、M3-browser-sequence 共 6 个场景全部通过（`docs/acceptance/results.json`） |
| VSIX 安装冒烟 | `node test/e2e/vsix-smoke.mjs <装有 VSIX 的扩展目录>` | 通过（不加载开发路径；截图 `vsix-installed.png`） |

任务书 7.1 各项的覆盖情况：

| 类别 | 覆盖用例 |
|---|---|
| fence 解析 | `fence.test.ts`：选项任意顺序、缺省值、未知选项与非法取值忽略、非法视图 id 与项目名、空正文；`markdownIt.test.ts`：非 `likec4-view` 代码块交回原规则，与另一个改写 fence 的插件串联（两种安装顺序）时两者都生效，以及 `enabled=false` |
| JSON 转义 | `html.test.ts`：标题和描述含 `</script>`、`<!--`、U+2028/2029 时 HTML 结构不被破坏，往返解析相等，也是合法 JS；`markdownIt.test.ts`：内联模型含 `</script>` |
| 项目解析 | `projects.test.ts`：单项目、多项目嵌套（最深者优先）、多根同名项目、`project=` 显式指定、找不到项目、默认项目、脚本配置报错、无文档目录 |
| ModelService | `modelService.test.ts`（真实 LikeC4）：惰性计算、只算被引用的项目、磁盘修改触发重算（watch）、未保存编辑与关闭回退磁盘、出错时 `stale` 并保留上次布局及修复后恢复、一开始就出错为 `error`、哈希不变不触发变化、并发编辑合并且以最新为准 |
| 刷新调度 | `refresh.test.ts`：合并、无预览不刷新、文档关闭或无引用不刷新、`refreshAll`、`dispose` |
| 预览脚本 | `preview.test.ts`（jsdom + morphdom，复刻 VS Code 1.144 的 `areNodesEqual`/`domEval`/morphdom 选项，文件头注明来源与 MIT 声明）：只改 JSON 时宿主与 shadow root 保留、React root 不重建；Markdown 其他部分变化时宿主不被触碰；`hash` 相同跳过渲染；宿主删除时 unmount；同一视图多次引用互不干扰；带快照的宿主经 morphdom 更新仍保留；模型元素 id 经 `domEval` 后保留；延迟挂载 |
| 快照与视口 | `staticSvg.test.ts`（真实布局：4 种视图结构完整、文本转义、sequence 不生成）；`viewport.test.ts`（fit 公式、内容移出可视区判定）；`markdownIt.test.ts`（快照转义、页面内 id 唯一） |
| 扩展集成 | `test/integration/suite.cjs`：`markdown.api.render` 输出宿主与合法 JSON、一个项目一份模型；最近项目与未知视图；修改 `.c4` 磁盘文件后得到新哈希；未保存编辑得到新哈希且磁盘不变；`enabled=false` 输出普通代码块 |

## 2. 端到端（任务书 7.2）

fixture：`fixtures/`，含 `shop`（element ×2、dynamic、deployment）、`billing`、`large`（脚本生成）三个项目。

| # | 结果 | 证据 |
|---|---|---|
| E1 | 通过。4 个视图全部渲染：shop index 3 节点 2 连线、checkout（dynamic）5/4、prodDeployment（deployment）5/2、billing 3/1。首屏 3 个视图直接挂载，屏幕外的视图先显示快照，滚动到附近后挂载。与官方 LikeC4 扩展预览面板同一视图的元素和连线一致 | `E1-four-views.png`、`E7-coexist.png`（本扩展）对照 `E7-official-preview-panel.png`（官方面板） |
| `browser` / `sequence` / 裁剪 | 通过（场景 `M3-browser-sequence`）。`browser=true`：点击元素后打开图内浏览浮层（第 2 个 react-flow 实例和 1 个对话框，含导航与缩放控件），Markdown 正文与磁盘文件不变；`browser=false`：点击后不出现浮层；`dynamic-variant=sequence`：`shop/docs/readme.md` 中渲染出时序图，5 个参与者、4 个步骤；超出上限：`maxModelBytes=65536` 时 large 模型（122 KB）只内联本文档引用的 10 个视图，显示“The LikeC4 model is too large…”提示，点击后不出现浮层 | `M3-browser-overlay.png`、`M3-sequence.png`、`M3-trimmed.png`，`results.json` → `M3-browser-sequence` |
| E2 | 通过。缩放、平移后编辑 Markdown 正文：同一 frame，宿主与 shadow root 标记保留，视口 `translate(78px,-74px) scale(0.972)` 不变 | `E2-after-md-edit.png`，`results.json` → `E2` |
| E3 | 通过（按 ADVISOR 替代口径）。20 次未保存 `.c4` 编辑，视口全部恢复。耗时见 §3 | `E3-after-c4-edit.png`，`results.json` → `E3.rows` |
| P1c | 通过（ADVISOR 追加项）。强制重载期间页内逐帧记录，三种情况下可见宿主空白帧均为 0；快照 `viewBox` 与交互图 transform 一致（偏差 ≤ 1e-14）；交互图挂载后 transform 唯一（没有先 fit 再跳回）。三种情况为：A 已保存视口；B 未触碰的视图；C 保存的视口已看不到视图，此时快照与图都 fit | `results.json` → `P1c` |
| E4 | 通过。语法错误时显示 stale 提示（“Showing the last valid version… model.c4:19 Expecting token…”），保留上次布局（3 节点）；修复后提示消失 | `E4-stale.png` |
| E5 | 通过。视图 id 改为 `indexx` 时显示错误块“View "indexx" not found in LikeC4 project "shop".”，改回后恢复渲染 | `E5-unknown-view.png` |
| E6 | 通过。Dark Modern、Light Modern、High Contrast、High Contrast Light 四种主题下，`auto` 依次为 dark/light/dark/light，`color-scheme=light` 始终为 light | `E6-*.png` |
| E7 | 通过。同时安装官方 `likec4.likec4-vscode` 1.60.0，并使用 VS Code 1.144 内置的 Mermaid：两个扩展都激活，LikeC4 视图与 Mermaid 图都渲染；`shop/model.c4` 出错时诊断只有 1 条、来源只有官方扩展（`likec4`），本扩展同时显示 stale | `E7-coexist.png`，`results.json` → `E7-coexist` |
| E8 | 通过。mkdocs 1.6.1 + mkdocs-likec4 1.2.2 + likec4 1.60.0 构建同一份 `sample.md`（另为每个视图各建一页，便于截图），与本扩展预览逐视图对比：元素、布局、连线标签、动态视图步骤序号一致；配色不同，因为 MkDocs 页面是亮色，而本扩展的 `auto` 跟随 VS Code 暗色主题 | `E8-ours-{0..3}.png` 对照 `E8-mkdocs-{0..3}.png` |
| E9 | 替代执行。本机没有 `ci-metrics`（已全盘查找），改用 `fixtures/large`（313 个元素、37 个视图，`scripts/gen-large-fixture.mjs` 生成）中含 10 个视图的文档：10 个视图全部显示，滚动后全部挂载 | `E9-large.png`，`results.json` → `E9-large` |

录屏：本环境用截图序列与页内逐帧记录（P1c）代替录屏。

## 3. 性能（任务书 7.3）

数据出自同一次完整运行的 Output Channel 日志（`docs/acceptance/extension-log-*.log`，带 epoch 时间戳）和页面打点。

### `.c4` 编辑到预览更新（fixtures，E3，20 次，不含 250 ms 防抖，从推送未保存文本起算，P95 取 nearest rank）

| 段 | P50 | P95 | 门槛 |
|---|---|---|---|
| 扩展可控段（推送 → `markdown.preview.refresh`） | 64 ms | 123 ms | ≤ 200 ms ✓ |
| 　其中 LikeC4 重算 | 59 ms | 117 ms | — |
| 　其中扩展自身开销（重算完成 → refresh） | 5 ms | 6 ms | — |
| 新内容可见（快照就位） | 676 ms | 749 ms | ≤ 1.5 s ✓（也低于任务书的 1 s） |
| 交互图首帧 | 1058 ms | 1259 ms | 只报告数值 |

视口恢复每次只需 1 次重试，发生在隐藏容器中。

测量前提：两次编辑之间间隔 1.5 秒，相当于输入停顿，此时上一次预览重载的后台工作已经结束。若在上一次重载仍在初始化时立即编辑，两者争用 CPU，LikeC4 重算会出现长尾：一次连续 20 次编辑的运行里，P95 为 233 ms、最大 260 ms，扩展自身开销仍不超过 15 ms。在纯 Node、无 VS Code 负载时，40 次重算的 P50 为 41 ms、P95 为 104 ms（`probes/layout-tail.mjs`）。

### 大模型（`fixtures/large`，E9，`extension-log-E9.log`）

| 指标 | 值 |
|---|---|
| 工作区初始化（3 个项目） | 1706 ms |
| 首次全模型布局（37 个视图） | 1325 ms（扩展宿主，冷启动） |
| 增量重算（10 次） | 91–282 ms |
| 推送 → refresh | P50 214 ms / P95 366 ms |
| 编辑（含防抖）→ 交互图出现新标题 | P50 2019 ms / P95 2553 ms |
| 10 视图文档首屏（从打开预览起，含 VS Code 刚启动后的首次初始化） | 约 7.5 s；可见视图挂载，其余显示快照 |

### 打开 4 视图文档的首屏（fixtures，E1）

从打开预览到 4 个视图全部显示：6844 ms，均为冷启动（VS Code 刚启动），包含项目扫描、LikeC4 工作区初始化（约 2 s）、首次布局和预览重载。未单独测热启动。

### 体积

| 产物 | 大小 |
|---|---|
| VSIX | 2 036 782 B（1.94 MB） |
| `dist/extension.js` | 3 192 521 B |
| `dist/preview.js` | 2 571 191 B |
| `THIRD_PARTY_NOTICES` | 约 200 KB，113 个包加 2 个内嵌组件（Graphviz EPL-1.0、Expat MIT） |

## 4. ADVISOR 裁定清单

| 事项 | 裁定 |
|---|---|
| `.c4` 变化的更新方式 | 只有强制整页重载这一条路（P1 已证明），采用“强制刷新 + 视口持久化”；仅在受影响文档有打开的预览时才刷新 |
| `browser=true` 的模型数据 | 每个文档每个项目内联一份布局后模型；上限 2 MiB（设置项 `maxModelBytes`），超限时裁剪视图并禁用浏览，只保留一条渲染路径 |
| `dynamic-variant=sequence` | 首版支持，直接透传 |
| `protected langium` | 不使用；用公开 API 组装服务 |
| 定位源码 | 不纳入首版（`command:` URI 在预览中不放行） |
| `engines.vscode` | 由依赖声明的 Node 版本决定；实测下限为 1.123.0 |
| JS/TS 配置 | 不执行；`bundle-require`/`esbuild` 以桩替换，渲染错误块 |
| 静态快照 + 懒加载入口 | 接受（消除重载期间的空白帧） |
| 屏幕外宿主延迟挂载 | 接受 |
| 大模型的全模型重算 | 接受（增量重算 P95 287 ms < 500 ms） |
| E3 延迟未达 1 s | 不阻塞，改用替代门槛，列入已知限制 |
| 滚轮交互（滚动页面，Ctrl/⌘+滚轮缩放） | 接受，写入设计与 README |
| `sequence` 宿主（无快照）重载期间 | 采用“不遮挡、直接显示”，记入遗留 |

## 5. 遗留问题与已知限制

1. `.c4` 变化会强制重载所有打开的、引用了受影响项目的 Markdown 预览。浏览浮层、选中、动态视图步进等瞬时状态在重载后丢失。交互图约 1.2–1.4 s（不含防抖）后就绪，在此之前显示快照。
2. 逐帧记录从 `DOMContentLoaded` 开始。此前 webview 是否已切换并短暂显示还没追加内容的文档，无法在页内观测（VS Code 预览在 `DOMContentLoaded` 时才追加内容）。截图采样中未见空白。
3. 静态快照是近似渲染（节点、复合节点、连线与标签），不包含图标与 LikeC4 的全部样式细节。`sequence` 形态没有快照：此类宿主挂载后不再隐藏等待，直接显示（裁定为“不遮挡”），避免重载期间出现空白区域。代价是这类视图恢复保存的视口时，可能有一帧先显示 fit 视图。在新文档的应用加载完成之前（实测约 1.1 s，即交互图首帧），该位置只显示宿主占位。
4. 没有 `ci-metrics` 模型，E9 与 7.3 的“真实大模型”数据以生成的 `fixtures/large` 代替。拿到真实大模型后应复测全模型重算耗时（ADVISOR 要求）。
5. 不支持 `likec4.config.js/ts`。
6. 定位源码未实现。
7. 发布字段：`publisher` 暂为 `windead`，没有 `repository`（打包时使用 `--allow-missing-repository`），也没有图标（不使用 LikeC4 官方 logo）。发布前由用户补充。
8. 连续快速编辑、且上一次预览重载仍在初始化时，LikeC4 重算存在 CPU 争用长尾（实测最大约 260 ms，见 §3）。
9. 每份文档内联完整的布局后模型，对多文档、大模型的场景会增加预览 HTML 体积；超过 2 MiB 时自动裁剪。
