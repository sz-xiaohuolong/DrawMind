# DrawMind — AI Diagram Agent

> 自然语言 → **可编辑的 draw.io 图表**。内置真正的 draw.io 编辑器，支持多轮对话增量修改、双向同步、Undo/Redo、导入导出。

![diagram: ChatGPT + draw.io](https://img.shields.io/badge/chatgpt-%2B-draw.io) ![stack](https://img.shields.io/badge/React-TS-Vite-Tailwind-Zustand)

## 项目介绍

DrawMind 是一个「ChatGPT + draw.io」风格的 AI 智能绘图工具：

- 左侧 **70%**：嵌入官方 `embed.diagrams.net` 编辑器（完整 draw.io 能力：拖拽、连线、改字、改样式、shape 库，界面已中文化）。
- 底部 **页面页签栏**：支持多页面文档——点击「新建页面」在底部新增一页（保留已有页面），可切换 / 双击重命名 / 删除页面。
- 右侧 **30%**：AI Agent 对话面板（可折叠）。
- 输入 `帮我画一个 RAG 系统架构图，包含用户、API Gateway、Agent、Embedding Model、Milvus、LLM 和 PostgreSQL`，AI 生成**可编辑的 draw.io XML** 并渲染到编辑器；继续对话 `把 Milvus 改成 pgvector`、`在 Agent 和 LLM 之间增加一个 Tool Calling 模块`，AI 对**同一张图**做增量修改。

AI 永远不直接吐整段 XML：模型输出结构化 **Diagram Operations**，经本地校验、无损应用、自动布局、XML 生成与校验后进入编辑器——格式错误、id 冲突、悬空连线、XML 注入等全部在本地防御。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · TypeScript · Vite 6 · Tailwind CSS 3 · Zustand 5 |
| 后端 | Node.js + Express（`/api/chat` AI 代理 + 生产静态托管） |
| 编辑器 | 官方 draw.io Embed Mode（`embed.diagrams.net/?embed=1&proto=json`） |
| AI | DeepSeek V4.1 Flash（火山方舟 OpenAI 兼容端点）/ 离线 MockProvider |
| 测试 | Vitest（单元+集成 59 例）· Playwright E2E（5 条全链路） |

## 快速开始

```bash
npm install

# 配置 AI（.env，服务端专用，绝不进浏览器）
cp .env.example .env
# 填入你的 Key（火山方舟 / DeepSeek 官方均可，OpenAI 兼容）
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
DEEPSEEK_MODEL=deepseek-v4-flash

npm run dev          # web: http://localhost:5173  (server: :3001)
```

未配置 Key 时自动切换到离线 MockProvider（面板会提示），可完整体验流程。

生产构建：

```bash
npm run build        # tsc + vite build → dist/
npm start            # Express 同时托管 dist 与 /api
```

## draw.io 集成原理

- 官方唯一受支持的宿主集成方式：iframe 嵌入 `embed.diagrams.net`，`proto=json` 启用 JSON 消息协议，`postMessage` 通信。
- 协议（详见 [官方文档](https://www.drawio.com/docs/reference/embed-mode/)）：编辑器就绪发 `{event:'init'}`；宿主回 `{action:'load', xml, autosave:1}`；用户每次编辑编辑器自动回传 `{event:'autosave', xml}`；宿主可随时 `export` / `fit` / `merge` / `invokeAction`。
- 宿主侧只接受 `evt.source === iframe.contentWindow` 的消息，未知消息安全忽略。
- 因此 AI 生成的图**天然可被用户手工编辑**，编辑结果自动回流到 AI 上下文——不存在“AI 以为图还是旧版本”的问题。

## AI Agent 工作机制

```
User Prompt
   ↓
Intent 理解 + 当前图摘要（DiagramState JSON）
   ↓
LLM 结构化输出（response_format=json_object）
   ↓
Diagram Operations（add_node / add_edge / update_node / change_layout ...）
   ↓
Operation Validator → 无损应用 → 布局引擎 → XML Generator → XML Validator（≤3 次自动修复）
   ↓
draw.io 编辑器（autosave 双向同步）
```

- **Diagram JSON**：`{type, title, nodes:[{id,label,kind}], edges:[{id,source,target,label}], groups}` —— 模型看到的语义视图（无坐标噪音）。
- **Diagram Operations**：模型只做语义决策，坐标由本地布局引擎计算；`change_layout` 才会触发重排，且尊重用户手动移动过的节点（`dmManual` 标记）。
- **多轮修改**：历史对话 + 当前图摘要一起发给模型，约束其“优先增量修改、不删除无关元素”；本地再校验保证不越界。

## 图表能力

- 流程图（Top→Bottom 分层）、系统架构图（Left→Right 分层）、思维导图（根节点左置树形）、时序图（参与者 + 错层消息 + 生命线）——均为零依赖确定性布局，节点不重叠、间距一致。
- 节点按角色着色（用户/网关/服务/AI 模型/数据库/向量库/缓存/工具…），单色系专业深色风格。
- 导出 `.drawio` / `.xml`（可直接重新导入 diagrams.net 继续编辑）/ `.svg` / `.png`；导入 `.drawio` / `.xml` 后 AI 可继续修改。
- Undo/Redo 基于 Diagram Version 历史（AI 每批修改、导入、用户结构编辑各成一版，上限 60）。

## 如何测试

```bash
npm test              # 59 个单元/集成测试（vitest, jsdom）
npm run test:e2e      # Playwright 全链路（需要网络加载 embed.diagrams.net；自动用 mock provider）
npm run test:e2e -- --headed   # 可视化运行

# 真实 DeepSeek 模型验收（需要 dev server 在 :3001 运行）
REAL_API=1 API_BASE=http://localhost:3001 npx vitest run tests/agent.real.test.ts
```

E2E 覆盖：创建 RAG 架构 → 多轮修改（替换 Milvus→pgvector、新增 Redis 且保持布局）→ Undo/Redo → 导出 .drawio → 重新导入结构一致 → 思维导图/时序图渲染。

## 项目结构

```
src/
├── agent/        diagramAgent.ts · prompts.ts · planner.ts
├── diagram/      types.ts · parser.ts · generator.ts · validator.ts
│                  layout.ts · operations.ts · styles.ts · state.ts
├── drawio/       bridge.ts · messages.ts
├── providers/    types.ts · deepseek.ts · mock.ts
├── store/        diagramStore.ts（状态机 + 版本历史 + 双向同步）
├── components/   Editor/ · AgentPanel/ · Toolbar/
server/           index.ts · aiProxy.ts（API Key 只在此）
tests/ · e2e/     Vitest 单元/集成 + Playwright
docs/             research.md · architecture.md
```

## 配置 DeepSeek API

服务器通过 `.env` 读取（`server/aiProxy.ts`），浏览器永不接触 Key：

```
DEEPSEEK_API_KEY=           # 必填
DEEPSEEK_BASE_URL=          # 默认 https://ark.cn-beijing.volces.com/api/plan/v3
DEEPSEEK_MODEL=             # 默认 deepseek-v4-flash
PORT=3001
```

模型名以 `deepseek-v4-flash`（V4.1 Flash）为准；调用为 OpenAI 兼容 `chat/completions` + `response_format=json_object`，已实测火山方舟端点。

## 当前限制

- 编辑器来自公网 `embed.diagrams.net`：离线时编辑区无法加载（面板与 AI 仍可用，有重试提示）。
- 多页 `<diagram>` 文件导入时取第一页；PNG/SVG 内嵌 XML 的导入未支持（.drawio/.xml 完全支持）。
- 多页面由应用自己管理（编辑器始终只加载当前页），因此 AI 修改只作用于当前页，切换页面、新建页面均不会跳页或丢内容。
- 每次 AI 修改以 `load` 全量载入编辑器（应用层版本历史承担 Undo/Redo；编辑器 undo 栈用于用户手工编辑）。操作是增量的——无关 cell 不会被触碰。
- 复杂自由布局（如 dagre 级路由）未内置；当前布局对分层/树形/时序足够，特殊布局可用 `move_node`/手动拖动。
- 时序图生命线用隐形锚点实现（导出后可编辑，不影响内容）。
