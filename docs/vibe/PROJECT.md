# Project — DrawMind

## Current Positioning

- Project Name: `DrawMind`
- Current Release: `v0.1.0`
- Quality Profile: `Standard`
- Product Summary: AI Diagram Agent — 基于自然语言生成与增量编辑 draw.io 图表（ChatGPT + draw.io 模式），支持双向同步、无损修改、多页管理与导入导出。
- Primary Users: 架构师、开发人员、产品经理、需要快速绘制和迭代架构图/流程图/时序图/思维导图的技术人员。

## Current Product Boundaries

- In Scope:
  - 自然语言对话生成架构图、流程图、思维导图、时序图。
  - 多轮增量对话修改（如增加节点、替换组件、重连边、重布局）。
  - 内嵌官方 draw.io 编辑器，支持拖拽、修改、连线等手工编辑。
  - 编辑器与 AI 的双向同步（用户在画布修改后，状态回流至 AI 记忆）。
  - 多页面管理（底部页签新建、切换、重命名、删除）。
  - 导入/导出（.drawio, .xml, .svg, .png）。
  - 确定性本地布局算法与多层防御校验（Operation 校验、XML 结构修复）。
  - 离线 MockProvider 与在线 DeepSeek / OpenAI 兼容端点双支持。
- Out of Scope:
  - 离线本地运行 draw.io 完整网页服务（依赖官方 embed.diagrams.net）。
  - 自由复杂拓扑的物理引擎或重型 Dagre/ELK 布局（当前采用轻量确定性分层与树形布局）。
  - 多人协同实时在线白板（协作依赖导出或 draw.io 原生生态）。

## Document Map

| 职责 | 实际路径 | 说明 |
|---|---|---|
| Agent Rules | [AGENTS.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/AGENTS.md) | Agent 行为规则与事实源入口 |
| Current Project | [docs/vibe/PROJECT.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/docs/vibe/PROJECT.md) | 项目定位、边界与文档地图（当前文件） |
| Current Architecture | [docs/architecture.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/docs/architecture.md) | 当前真实架构事实、双向同步通道、数据管道与布局 |
| Tech Research | [docs/research.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/docs/research.md) | draw.io 协议调研、消息格式与选型依据 |
| Current Progress | [docs/vibe/PROGRESS.md](file:///Users/daiyifei/Documents/code/llms/DrawMind/docs/vibe/PROGRESS.md) | 当前执行状态、验证证据与已知限制 |
| Decisions | `docs/vibe/decisions/` | 架构与设计决策记录（按需归档） |
| Bugs | `docs/vibe/bugs/` | Bug 复现与根因追踪记录（按需归档） |
| Releases | `docs/vibe/releases/` | Release 基线、Brief 与封存文档（按需归档） |

## Supported Commands

| 目的 | 命令 | 备注 |
|---|---|---|
| Setup | `npm install` | 安装 Node.js 前后端依赖 |
| Dev (Full) | `npm run dev` | 并行启动 Web (5173) 与 AI Proxy Server (3001) |
| Dev (Web Only) | `npm run dev:web` | 仅启动 Vite 前端开发服务器 (5173) |
| Dev (Server Only) | `npm run dev:server` | 仅启动 Express AI 代理后端 (3001) |
| Test (Unit/Integration) | `npm test` | Vitest 运行单元与集成测试（默认 70 例通过） |
| Test (Watch) | `npm run test:watch` | Vitest 交互式监控测试 |
| Test (E2E) | `npm run test:e2e` | Playwright 端到端浏览器测试 |
| Typecheck | `npm run typecheck` | TypeScript 类型检查 (`tsc -b`) |
| Lint | `npm run lint` | ESLint 检查 |
| Build | `npm run build` | 构建前端静态资源到 `dist/` |
| Start (Prod) | `npm start` | 生产模式启动 Express 服务托管静态与 API |

## Current Risks and Constraints

1. **公网依赖**: 编辑器基于 `embed.diagrams.net` 官方 iframe，无外网时画布区域无法加载（AI 面板与状态仍可工作）。
2. **Key 隔离**: 服务端代理通过 `.env` 隔离 AI Key，绝不能传递或硬编码至前端客户端代码。
3. **多页导入限制**: 导入包含多页的 `.drawio` 文件时，目前默认加载第一页。
