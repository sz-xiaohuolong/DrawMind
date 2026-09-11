# DrawMind — 技术调研报告 (docs/research.md)

> 调研时间：2026-09（本报告基于 Firecrawl 联网检索与官方文档逐页阅读，非记忆假设）

## 1. draw.io 架构

draw.io（github.com/jgraph/drawio）本质是 **mxGraph 图形引擎 + 编辑器 UI**：

- **mxGraph**：底层模型。`mxGraphModel` 以树形 `mxCell` 组织图形；`mxCell` 分三类——`vertex`（节点）、`edge`（边）、`group`/容器。几何信息在 `<mxGeometry>` 子节点（`x/y/width/height` 或 `relative=1` 的边几何）。
- **EditorUi**：编辑器外壳，管理菜单、工具条、命令栈（undo/redo）、剪贴板等。
- **分层**：`GraphEditor` → `EditorUi` → `mxGraph` → `mxGraphModel`。XML 持久化由 `mxCodec` 完成（对象 ↔ XML 双向编解码）。
- 官方托管版本：`app.diagrams.net`（完整站）、`embed.diagrams.net`（**专供嵌入**，官方声明嵌入模式仅支持该域名）。

关键结论：**不需要** fork/编译整个 drawio 仓库。官方提供 embed 模式，通过 iframe + `postMessage` 即可获得完整编辑器能力（拖拽、连线、编辑、样式、shape 库），宿主零成本升级。

## 2. XML 基本结构

```xml
<mxfile host="app.diagrams.net" agent="..." version="..." type="device">
  <diagram id="page1" name="Page-1" background="#0B1320">
    <mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1"
                  connect="1" arrows="1" fold="1" page="0" pageScale="1"
                  pageWidth="1920" pageHeight="1080" math="0" shadow="0">
      <root>
        <mxCell id="0"/>                       <!-- 根 -->
        <mxCell id="1" parent="0"/>            <!-- 默认图层 -->
        <mxCell id="user" value="User" style="rounded=1;..." vertex="1" parent="1">
          <mxGeometry x="40" y="40" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;"
                edge="1" parent="1" source="user" target="api">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

要点：
- `<diagram background="...">` 控制画布背景色。
- 边通过 `source` / `target` 属性引用节点 id；几何 `relative="1"`。
- 文字需 XML 转义；节点 id 全图唯一。
- 多页以多个 `<diagram>` 表示。

## 3. 编辑器集成方案（Embed Mode，官方推荐）

官方文档 `https://www.drawio.com/docs/reference/embed-mode/` 明确给出 iframe 集成协议：

- URL：`https://embed.diagrams.net/?embed=1&proto=json&spin=1&modified=unsavedChanges&configure=1&libraries=1`
- `configure=1`：编辑器先发 `{event:'configure'}`，宿主回 `{action:'configure', config:{...}}`（可设置暗色主题、隐藏菜单项等）后才初始化。
- 初始化完成后发送 `{event:'init'}` → 宿主回 `{action:'load', xml:'...', autosave:1}`。
- `autosave:1`：**用户每次编辑**（改字、拖动、连线、删元素、改样式…）编辑器自动回传 `{event:'autosave', xml:'...'}` —— 这就是 Editor→AI 双向同步的通道。
- 宿主可用 action：`load`（全量载入）、`merge`（增量合并 XML）、`export`（xml/svg/png/json）、`fit`、`layout`、`invokeAction`（undo/redo/zoomIn…）、`status`、`dialog` 等。
- `export` action 支持 `format:'xml'`（最快取回当前图）、`svg`、`png`、`xmlsvg`、`xmlpng`。

已确认的官方约束：嵌入模式**只支持** `embed.diagrams.net`；`ready` 参数在 JSON 协议下被忽略（用 `init` 事件）；未知消息返回 `{error:'unknownMessage'}`。

## 4. 宿主页面通信方式（postMessage）

- 双向 JSON 消息，全部经 `iframe.contentWindow.postMessage(JSON.stringify(msg), '*')`。
- 事件（editor→host）：`init` / `configure` / `autosave` / `save` / `exit` / `export` / `load`（含 bounds/modelBounds/scale/translate/containerSize）。
- Action（host→editor）：`load` / `configure` / `merge` / `export` / `fit` / `layout` / `invokeAction` / `status` / `spinner` / `resetEditor` 等。
- 消息用 `event` 或 `action` 字段区分方向；宿主侧对 `evt.source === iframe.contentWindow` 做来源校验。

## 5. AI 模型接入（DeepSeek V4.1 Flash / 火山方舟）

- dsh 已配置的火山方舟（Volcengine Ark）端点：`https://ark.cn-beijing.volces.com/api/plan/v3`，OpenAI 兼容 `chat/completions` 格式，`Authorization: Bearer <ark-...>`。
- 实测（curl 200）：`model: deepseek-v4-flash` 有效，返回 `reasoning_content` 字段（推理模型），支持 `response_format: {"type":"json_object"}` 结构化输出。
- DeepSeek 官方更新日志确认 `deepseek-v4-flash` / `deepseek-v4-pro` 模型名，OpenAI ChatCompletions 接口兼容。
- 结论：后端 Express 代理，`fetch(baseURL + '/chat/completions')` 转发，API Key 只存在于服务端 `.env`，绝不进浏览器。

## 6. 最终采用的技术方案

| 层 | 方案 | 理由 |
|---|---|---|
| 编辑器 | iframe 嵌入 `embed.diagrams.net`（embed+proto=json） | 官方支持、完整编辑能力、无需自编译 drawio、升级免费 |
| 通信 | postMessage JSON 协议（load/autosave/merge/export） | 官方协议，双向同步天然成立 |
| 前端 | React 18 + TypeScript + Vite + Tailwind CSS + Zustand | 主流、类型安全、构建快 |
| 后端 | Node.js + Express（/api/chat 代理 + 静态托管） | API Key 不出浏览器 |
| AI | 统一 `AIProvider`（DeepSeekProvider / MockProvider），默认火山方舟 deepseek-v4-flash | 可替换、可离线演示 |
| 结构化输出 | LLM 返回 **Diagram Operations**（JSON，`response_format=json_object`）+ 本地强校验 | 不依赖解析 Markdown，容错 |
| 布局 | 自研轻量分层布局（flowchart/architecture/mindmap/sequence） | 确定性、零依赖、可控；避免 dagre/elkjs 重依赖 |
| 测试 | Vitest 单元/集成 + Playwright E2E（Mock 模式） | 全链路可验证 |

## 7. 为什么采用该方案

1. **官方 embed 协议**是 jgraph 唯一公开、持续维护的宿主集成方式（github 仓库与官方文档双重确认），比自编译 drawio 源码维护成本低一个数量级，且天然具备"AI 生成的图可被用户手工编辑、编辑结果可回传"的能力——这是产品闭环的核心。
2. **操作级（Operation）增量修改**：LLM 不直接吐整段 XML，而是返回结构化操作（add_node / delete_node / update_node / move_node / add_edge / change_layout …），由本地 Operation Validator 校验后应用到**无损 Cell 模型**，再序列化为 draw.io XML。id 冲突、悬空 source/target、XML 注入、重复布局全部在本地防御，LLM 只需做语义决策。
3. **编辑状态同步**：用户手工编辑 → autosave XML → 无损解析回 Cell 模型 → 作为 AI 上下文（对话里携带当前图摘要），避免"AI 以为图还是旧版本"。
4. **火山方舟实测可用**：DeepSeek V4.1 Flash 经方舟 OpenAI 兼容端点 + `json_object` 结构化输出，满足稳定结构化返回需求。

## 8. 风险与对策

- 嵌入编辑器依赖公网（embed.diagrams.net）：开发/演示环境需要网络；离线时 Editor 区显示重试提示（不影响其余功能）。
- LLM 输出不可靠：三层防御——prompt 约束 schema + 本地 Operation Validator（修复/丢弃非法操作）+ XML Validator（最多自动修复 N 次，仍失败则友好报错，不白屏）。
- 全量 `load` 会重置编辑器 undo 栈：应用层自建 Diagram Version 历史（Undo/Redo），编辑器 undo 仅用于用户手工编辑。
