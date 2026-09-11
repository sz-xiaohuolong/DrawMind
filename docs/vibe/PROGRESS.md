# Progress — DrawMind

## Current Position

- Current Release: `v0.1.0`
- Current Requirement Baseline: [README.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/README.md)
- GitHub Repository: [https://github.com/sz-xiaohuolong/DrawMind](https://github.com/sz-xiaohuolong/DrawMind)
- Current Workflow State: `RELEASED`
- Operational Status: `ACTIVE`
- Current Phase: `Maintenance / Ready for New Tasks`
- Current Slice: `None`
- Current Task: `None`
- Last Stable Artifact: `drawmind@0.1.0 (Unit tests: 71 passed, Typecheck: passed)`
- Last Updated: `2026-09-11`

## Completed Capabilities

- [x] **draw.io Embed Bridge**: 实现与 `embed.diagrams.net` 官方 iframe 的双向通信（init / load / autosave / export / configure）。
- [x] **AI Agent 管道**:
  - 结构化输出（JSON Operation 协议：add_node, delete_node, update_node, move_node, add_edge, change_layout 等）。
  - 本地 Operation Validator 强校验（拦截未知操作、悬空引用、id 冲突、XML 注入）。
  - 无损 Cell 模型应用与本地确定性分层/树形/时序布局算法。
  - XML Generator 生成 mxGraphModel，结合 XML Validator（3 轮自动容错修复）。
  - **布局与防重叠引擎增强**:
    - 分层改为 DAG 最长路径算法，严格保证有向图拓扑顺序，消除逆向列与组内冲突；
    - 交叉轴垂直居中修复，彻底消除负坐标；
    - 分组（Group/Swimlane）包围盒自适应计算，子节点局部相对坐标转换与分组间安全间隔；
    - 弱连通子图分块隔离排布，杜绝多主题工作流在多轮对话中相互穿插挤压。
- [x] **双向同步与防回环**:
  - 用户手工移动、改字、增删节点自动回流至 DiagramState 语义摘要。
  - 基于结构签名的防回环机制与应用层 Undo/Redo 版本栈（上限 60）。
- [x] **前端 UI**:
  - 顶部 Toolbar（撤销、重做、新建页面、导入、导出 .drawio/.xml/.svg/.png）。
  - 左侧 70% draw.io 编辑器，底部多页签管理（切换、新建、重命名、删除）。
  - 右侧 30% 可折叠 AI 对话面板（状态机指示、快捷 Prompt、重试与错误提示）。
- [x] **双 AI Provider**:
  - 服务端代理：OpenAI 兼容端点（已支持 DeepSeek 官方原厂与火山方舟），Key 仅在 Node 端隔离。
  - 离线 MockProvider：零配置即可完整体验体验 RAG 架构生成与多轮修改。

## Verification Evidence

| Scope | Command/Flow | Result | Evidence | Time |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` | `PASS` | `tsc -b` 无报错 | 2026-09-11 |
| Unit & Integration | `npm test` | `PASS` | 10 个测试套件通过，71 例全部 PASS（新增多工作流零重叠断言） | 2026-09-11 |
| Linter | `npm run lint` | `PASS` | ESLint 0 warning / 0 error | 2026-09-11 |
| Build | `npm run build` | `PASS` | Vite + tsc 打包成功 (dist/) | 2026-09-11 |
| Agent Real API | `REAL_API=1 API_BASE=... npx vitest run tests/agent.real.test.ts` | `OPTIONAL` | 依赖在线 API Key 与运行中 dev:server | 按需运行 |
| E2E | `npm run test:e2e` | `READY` | Playwright 全链路测试覆盖 5 大场景 | 按需运行 |

## Known Limitations

1. **公网连接要求**: `embed.diagrams.net` 需要公网访问。离线状态下编辑区显示重试按钮。
2. **多页导入**: 导入外部含多个 `<diagram>` 的 draw.io 文件时，当前仅读取第一页。
3. **坐标布局**: AI 只做语义拓扑规划，几何坐标由本地布局算法生成；如需微调可直接在画布拖拽。

## Next Task

- 处于稳定就绪状态。可根据用户需求开启新功能特性或接入特定业务需求。
