# DrawMind — 架构设计文档 (docs/architecture.md)

## 1. 系统总览

```
┌────────────────────────────────────────────────────────────────┐
│ Browser (React SPA, Vite)                                      │
│                                                                │
│  ┌──────────────┐   ┌─────────────────────────────────────┐   │
│  │ AgentPanel   │   │ DrawioEditor (iframe)               │   │
│  │ 对话 + 状态   │   │ embed.diagrams.net?embed=1&proto=json│   │
│  └──────┬───────┘   └────────────▲────────────────────────┘   │
│         │                        │ postMessage JSON 协议       │
│  ┌──────▼────────────────────────┴─────────────────────────┐  │
│  │ store/diagramStore.ts (Zustand)                          │  │
│  │  model · versions(undo/redo) · conversation · 状态机      │  │
│  └──────┬───────────────────────────────────────────────────┘  │
│         │ /api/chat (同源代理，Key 不出浏览器)                    │
└─────────┼──────────────────────────────────────────────────────┘
          ▼
┌─────────────────────────┐        ┌───────────────────────────┐
│ Express server :3001    │───────▶│ DeepSeek / Volcengine Ark  │
│ aiProxy (Bearer Key)    │ fetch  │ /api/plan/v3/chat/completions
│ 静态托管 dist/           │        │ deepseek-v4-flash          │
└─────────────────────────┘        └───────────────────────────┘
```

## 2. 数据管道（AI → 图）

```
User Prompt
   ↓
Diagram Agent (agent/diagramAgent.ts)
   ├─ prompts.ts      System Prompt（diagram architect，强约束结构化输出）
   ├─ buildMessages   历史对话 + 当前图 JSON 摘要 + 用户消息
   ├─ provider.chat() DeepSeekProvider(服务器代理) / MockProvider(离线)
   ├─ planner.ts      稳健 JSON 解析（容错 code fence / 杂散文本 / 残缺对象）
   ↓
AgentResult { intent, diagramType, layout, operations[] }
   ↓
Operation Validator (diagram/operations.ts)
   ├─ 未知操作 / 悬空引用 / id 冲突 / 非法颜色 / 注入字符 → 拒绝并记录
   ↓
applyOperations → 无损 Cell 模型（只改动相关 cell，不动其他）
   ↓
Layout 引擎 (diagram/layout.ts)
   ├─ 显式 change_layout → 全量布局（尊重 dmManual 标记的节点）
   ├─ 新建图 → flowchart/architecture/mindmap/sequence 布局
   └─ 增量 add → layoutNewNodes（不动已有节点位置）
   ↓
XML Generator (diagram/generator.ts) → mxfile/mxGraphModel XML
   ↓
XML Validator (diagram/validator.ts) — 最多 3 轮 修复→再校验
   ├─ XML 语法 / mxGraphModel 存在 / id 唯一 / edge 端点存在 / geometry 合法
   └─ 失败 → repairModel（去重、删悬空边、补 root/layer、修几何）
   ↓
draw.io bridge.load(xml, autosave=1) → 编辑器渲染
```

## 3. 双向同步（Editor ⇄ AI）

- **AI → Editor**：每次 AI 修改 = 一组操作 → 新模型 → 新 XML → `{action:'load', xml, autosave:1}`。
  无损 Cell 模型保证用户手工编辑（样式/位置/拐点）在往返中不丢失。
- **Editor → AI**：`autosave` 事件携带用户编辑后的完整 XML → `parseXml` 无损解析回模型
  → `buildDiagramState` 生成 AI 可见的语义摘要（节点/边/分组，不含几何噪音）。
- **防回环**：结构签名（structureSig，排除几何）比较——AI 自己触发的 autosave 回显
  不会产生新版本；拖动等纯位置变化只更新模型，不产生版本。
- **版本历史**：结构变化（AI 批次、导入、用户增删改）才创建 `DiagramVersion`；
  Undo/Redo 恢复对应 XML 并重新 `load`。上限 60 条。

## 4. Diagram Operations（增量修改词汇表）

| 操作 | 语义 |
|---|---|
| add_node | 新增节点（kind → 样式预设；id 冲突自动改名） |
| delete_node | 删除节点及其入射/出射边 |
| update_node / rename_node | 改标签 / kind / 样式 |
| move_node | 显式定位，并标记 `dmManual=1`（布局不再移动它） |
| add_edge / delete_edge / update_edge | 连线增删改 |
| change_style | 原样覆盖 draw.io style 字符串 |
| change_layout | 重布局（auto/architecture/flowchart/mindmap/sequence，LR/TB） |
| add_group / add_node_to_group | 分组（容器自动扩到成员包围盒） |
| set_title / set_background / clear | 图元数据 |

LLM 只做语义决策（加什么、连谁、改什么），几何完全由本地布局引擎计算——
模型永远不需要输出坐标，从根上避免 position 重叠和布局混乱。

## 5. 关键实现要点

- **无损模型**：`Cell` 保留 mxCell 的全部属性（含自定义 attr 如 dmKind/dmManual）与
  mxGeometry（points/sourcePoint/targetPoint），序列化逐字段回写 → 用户手工编辑可
  无损往返。
- **样式预设**：`diagram/styles.ts` 按 kind 输出单一深色专业色板（#162238 填充 +
  角色色描边），用户/决策等特殊节点使用强调色，整体克制不花哨。
- **布局引擎**：零依赖。最长路径分层（LR 列 / TB 行，块内居中）、思维导图树形
  （后序子树高度）、时序图（参与者顶部 + exitDy/entryDy 错层消息行 + 隐形锚点生命线）。
- **LLM 稳定性**：`response_format=json_object` + 强 system prompt + 最多 2 次
  JSON 修复重试 + 本地双重校验（操作级、XML 级）。
- **错误恢复**：任何阶段失败都转成用户可读的错误消息 + Retry，绝不白屏；
  详细日志只在开发环境 console。

## 6. 测试策略

- **单元**：generator / parser（无损往返）/ validator（含修复）/ operations /
  layout / planner（JSON 容错）。
- **集成**：agent.integration（Mock 全管道：创建→替换→插入→查询）、store
  （版本/undo/redo/导入/位置-only 不建版本/持久化）。
- **真实模型**：`REAL_API=1` 标记的 agent.real（连接本机代理，跑 3 个验收案例）。
- **E2E**（Playwright，`?provider=mock` 确定性）：创建 RAG → 多轮修改（替换/新增
  保持布局）→ undo/redo → 导出 .drawio → 重新导入结构一致 → mindmap/sequence 渲染。
  通过在宿主页捕获 postMessage 验证编辑器真实往返。
