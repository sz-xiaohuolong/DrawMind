# Agent Instructions

## Workflow & Governance
本项目遵循 `vibe-workflow` 软件生命周期管理规范。

### 核心规则
1. **Constitution**:
   - 工程开始前必须冻结需求（Requirement Status == FROZEN, Open Questions == None）。
   - What to build is frozen. How to build it is delegated.
   - 不得静默改变产品范围；产品变化必须经过明确的人类决策。
   - Repository is memory. Chat is conversation.
   - 没有 fresh verification evidence，不得声称完成。
2. **事实源与导航**:
   - 项目总览与 Document Map: `docs/vibe/PROJECT.md`
   - 当前执行进度与验证证据: `docs/vibe/PROGRESS.md`
   - 当前架构事实: `docs/architecture.md` (或 `docs/vibe/TECH_DESIGN.md`)
   - 调研与协议事实: `docs/research.md`
   - 决策记录: `docs/vibe/decisions/`
   - Bug 追踪: `docs/vibe/bugs/`
3. **技术栈与环境**:
   - 前端: React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Zustand 5
   - 后端: Node.js + Express + tsx
   - 编辑器: draw.io 官方 Embed 模式 (`embed.diagrams.net`)
   - AI: DeepSeek V4.1 Flash (火山方舟/DeepSeek 官方 OpenAI 兼容接口) / MockProvider
   - 测试: Vitest + Playwright
4. **关键命令**:
   - 安装依赖: `npm install`
   - 启动前端与服务: `npm run dev`
   - 单测与集成: `npm test`
   - 类型检查: `npm run typecheck`
   - 代码检查: `npm run lint`
   - E2E 测试: `npm run test:e2e`
   - 生产构建: `npm run build`
