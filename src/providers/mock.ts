import type { AIProvider, ProviderChatOptions, ProviderMessage, ProviderResult } from './types';
import type { AgentResult, DiagramOperation, NodeKind } from '../diagram/types';

/**
 * MockProvider — a deterministic, keyword-driven planner used when the
 * DeepSeek API key is missing or in E2E tests (?provider=mock).
 *
 * It speaks the exact same AgentResult JSON protocol as the real provider,
 * so the entire pipeline (validation → ops → XML → editor) is exercised
 * without a network call. Clearly labeled in the UI.
 */

const KNOWN_COMPONENTS: Record<string, NodeKind> = {
  user: 'user',
  'api gateway': 'gateway',
  gateway: 'gateway',
  agent: 'agent',
  'embedding model': 'ai-model',
  llm: 'ai-model',
  milvus: 'vector-db',
  pgvector: 'vector-db',
  redis: 'cache',
  postgres: 'database',
  postgresql: 'database',
  mysql: 'database',
  mongodb: 'database',
  kafka: 'queue',
  'tool server': 'tool',
  tools: 'tool',
  database: 'database',
  'vector database': 'vector-db',
  'vector db': 'vector-db',
  cache: 'cache',
  queue: 'queue',
};

function classify(text: string): { kind: NodeKind; label: string } {
  const lower = text.toLowerCase().trim();
  const entry = Object.entries(KNOWN_COMPONENTS).find(([name]) => lower.includes(name));
  if (entry) {
    return { kind: entry[1], label: text.trim() };
  }
  if (/(client|web|frontend|browser|前端|用户)/.test(lower)) return { kind: 'client', label: text.trim() };
  if (/(tool|工具)/.test(lower)) return { kind: 'tool', label: text.trim() };
  if (/(service|服务|后端|server)/.test(lower)) return { kind: 'service', label: text.trim() };
  return { kind: 'generic', label: text.trim() };
}

function slug(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || `node-${Math.floor(Math.random() * 1000)}`
  );
}

/** Extract component names from free text ("User, API Gateway, Agent, LLM"). */
function extractComponents(text: string): string[] {
  // Prefer the part after "with / including / 包含 / 包括" — that's the component list.
  const sepIdx = text.search(/\b(with|including|include)\b|\b(包含|包括)\b|[:：]/i);
  const body = sepIdx >= 0 ? text.slice(sepIdx) : text;
  const cleaned = body
    .replace(/\b(with|including|include|and)\b/gi, ',')
    .replace(/(包含|包括|和|以及)/g, ',')
    .replace(/[，、。；;:：→\->]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

  const FILLERS = new Set([
    'a', 'an', 'the', 'create', 'build', 'draw', 'make', 'design', 'for', 'of',
    'rag', 'system', 'architecture', 'flow', 'workflow', 'diagram', 'mind', 'map',
    '流程', '架构', '系统', '图', '一个', '一张', '思维导图',
  ]);
  const rawParts = cleaned.includes(',') ? cleaned.split(',') : cleaned.split(' ');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of rawParts) {
    const s = p.trim();
    if (!s || s.length < 2 || FILLERS.has(s.toLowerCase())) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 12);
}

function createOps(_kind: string, components: string[]): DiagramOperation[] {
  const ops: DiagramOperation[] = [];
  const ids: Array<{ id: string; label: string; kind: NodeKind }> = [];
  components.forEach((c, i) => {
    const { kind, label } = classify(c);
    const id = slug(label) || `node-${i}`;
    ids.push({ id, label, kind });
    ops.push({ operation: 'add_node', id, label, kind });
  });
  // fallback: plain chain when roles are unclear
  for (let i = 1; i < ids.length; i++) {
    ops.push({ operation: 'add_edge', id: `e-${ids[i - 1].id}-${ids[i].id}`, source: ids[i - 1].id, target: ids[i].id });
  }
  return ops;
}

/**
 * Layered architecture ops for well-known RAG / platform components.
 * Produces a real layered topology (User → Gateway → Agent, then fan-out to
 * embedding/vector-db/LLM/tools/database) instead of a naive linear chain.
 */
function architectureOps(components: string[]): DiagramOperation[] {
  const ops: DiagramOperation[] = [];
  const add = (kind: NodeKind, label: string) => {
    const { kind: k, label: l } = classify(label);
    const id = slug(label) || `node-${kind}-${Math.floor(Math.random() * 1000)}`;
    ops.push({ operation: 'add_node', id, label: l, kind: kind !== 'generic' ? kind : k });
    return id;
  };
  const edge = (a: string, b: string) =>
    ops.push({ operation: 'add_edge', id: `e-${a}-${b}`, source: a, target: b });

  // ordered role matchers (first match wins; order matters)
  const matchers: Array<{ key: string; kind: NodeKind; re: RegExp }> = [
    { key: 'user', kind: 'user', re: /(^|\s)(user|用户)\b/i },
    { key: 'client', kind: 'client', re: /(client|web|frontend|browser|前端)/i },
    { key: 'gateway', kind: 'gateway', re: /(gateway|网关|api ?gw)/i },
    { key: 'agent', kind: 'agent', re: /\b(agent|代理)\b/i },
    { key: 'embedding', kind: 'ai-model', re: /(embedding|向量化|向量模型)/i },
    { key: 'vector', kind: 'vector-db', re: /(vector|milvus|pgvector|faiss|chroma|weaviate|向量库|向量数据库)/i },
    { key: 'llm', kind: 'ai-model', re: /(llm|gpt|claude|deepseek|qwen|model|大模型)/i },
    { key: 'tool', kind: 'tool', re: /(tool|工具|function calling)/i },
    { key: 'database', kind: 'database', re: /(database|db|postgres|mysql|mongo|sql|数据库)/i },
    { key: 'cache', kind: 'cache', re: /(cache|redis)/i },
    { key: 'queue', kind: 'queue', re: /(queue|kafka|mq|消息)/i },
  ];

  const idsByRole: Record<string, string> = {};
  const used = new Set<string>();
  const leftovers: string[] = [];

  for (const comp of components) {
    const lower = comp.toLowerCase();
    const hit = matchers.find((m) => m.re.test(lower));
    if (hit) {
      idsByRole[hit.key] = add(hit.kind, comp);
      used.add(comp);
    }
  }
  for (const comp of components) {
    if (!used.has(comp)) leftovers.push(add('service', comp));
  }

  const { user, client, gateway, agent, llm, embedding, vector, database, tool, cache, queue } = idsByRole;
  const entry = user ?? client;

  if (agent) {
    if (entry) edge(entry, agent);
    if (gateway) {
      if (entry) edge(entry, gateway);
      if (gateway !== agent) edge(gateway, agent);
    }
    if (embedding) edge(agent, embedding);
    if (vector) {
      if (embedding) edge(embedding, vector);
      else edge(agent, vector);
    }
    if (llm) {
      edge(agent, llm);
      if (vector) edge(vector, llm);
    }
    if (tool) edge(agent, tool);
    for (const l of leftovers) edge(agent, l);
    if (database && llm) edge(llm, database);
    if (cache) edge(agent, cache);
    if (queue) edge(cache ?? agent, queue);
  } else if (gateway) {
    if (entry) edge(entry, gateway);
    if (llm) edge(gateway, llm);
    if (vector) edge(gateway, vector);
    for (const l of leftovers) edge(gateway, l);
  } else if (entry) {
    for (const l of leftovers) edge(entry, l);
    if (llm) edge(entry, llm);
  }

  return ops;
}

function mindmapOps(components: string[]): DiagramOperation[] {
  const ops: DiagramOperation[] = [];
  const root = components[0] || 'Java 面试';
  const rootId = 'root';
  ops.push({ operation: 'add_node', id: rootId, label: root, kind: 'generic' });
  const rest = components.slice(1);
  if (rest.length === 0) rest.push('Java 基础');
  rest.forEach((c, i) => {
    const { kind, label } = classify(c);
    const id = `b${i + 1}-${slug(label)}`;
    ops.push({ operation: 'add_node', id, label, kind });
    ops.push({ operation: 'add_edge', id: `e-r-${id}`, source: rootId, target: id });
  });
  return ops;
}

function detectRequest(text: string, context: string): 'create' | 'modify' | 'query' {
  const lower = text.toLowerCase();
  const existingIds = [...context.matchAll(/id":"([^"]+)"/g)].map((m) => m[1]);
  if (existingIds.length > 0) {
    if (/(replace|change|修改|改成|替换|delete|remove|删除|add|增加|insert|加入|between|在.*和.*之间)/.test(lower)) {
      return 'modify';
    }
  }
  if (/(replace|change|修改|delete|remove|删除|add|增加|insert)/.test(lower)) return 'modify';
  if (/(describe|list|总结|说明|what|分析)/.test(lower)) return 'query';
  return 'create';
}

function findId(label: string, context: string): string | null {
  const lower = label.toLowerCase();
  const m = context.match(/"id":"([^"]+)","label":"([^"]+)"/g);
  if (!m) return null;
  const exact: string[] = [];
  const partial: string[] = [];
  for (const entry of m) {
    const match = entry.match(/"id":"([^"]+)","label":"([^"]+)"/);
    if (!match) continue;
    const [, id, lab] = match;
    const labLower = lab.toLowerCase();
    if (labLower === lower) exact.push(id);
    else if (labLower.includes(lower) || lower.includes(labLower)) partial.push(id);
  }
  return exact[0] ?? partial[0] ?? null;
}

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly label = 'Mock Provider (offline)';

  async chat(messages: ProviderMessage[], options: ProviderChatOptions = {}): Promise<ProviderResult> {
    // honor abort
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const last = [...messages].reverse().find((m) => m.role === 'user');
    // The LAST system message carries the current diagram context (see buildMessages).
    const context = [...messages].reverse().find((m) => m.role === 'system')?.content ?? '';
    const userText = last?.content ?? '';

    const result = this.plan(userText, context);

    // simulate latency so the UI pipeline is visible
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 350);
      options.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        resolve();
      });
    });

    return { content: JSON.stringify(result), model: 'mock-planner-v1' };
  }

  plan(userText: string, context: string): AgentResult {
    const request = detectRequest(userText, context);
    const lower = userText.toLowerCase();
    let diagramType: AgentResult['diagramType'] = 'architecture';
    let layout: AgentResult['layout'] = { mode: 'architecture', direction: 'LR' };
    let ops: DiagramOperation[] = [];

    if (request === 'query') {
      return {
        summary: '这是当前图表的说明。',
        intent: 'query',
        diagramType,
        layout,
        operations: [],
      };
    }

    // --- modify requests (operate on existing diagram) ---
    if (request === 'modify') {
      // "replace X with Y" — separator is REQUIRED so the lazy label capture
      // cannot stop early; falls back to "rename X".
      const replaceSep = userText.match(
        /(?:replace|change|修改|改成)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)\s+(?:to|into|为|成|with|替换为)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*)/i,
      );
      const replaceNoSep = userText.match(
        /(?:replace|change|修改|改成)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)(?:[.,，。]|$)/i,
      );
      const replace = replaceSep ?? replaceNoSep;
      if (replace) {
        const target = replace[1].trim();
        const newLabel = replace[2]?.trim();
        const id = findId(target, context);
        if (id) {
          ops.push(
            newLabel
              ? { operation: 'update_node', id, label: newLabel }
              : { operation: 'rename_node', id, label: target },
          );
          return {
            summary: newLabel ? `已将「${target}」替换为「${newLabel}」。` : `已将节点「${target}」重命名。`,
            intent: 'modify',
            diagramType,
            layout,
            operations: ops,
          };
        }
      }
      const del = userText.match(/(?:delete|remove|删除)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)(?:[.,，。]|$)/i);
      if (del) {
        const id = findId(del[1].trim(), context);
        if (id) {
          ops.push({ operation: 'delete_node', id });
          return {
            summary: `已删除「${del[1].trim()}」及其连线。`,
            intent: 'modify',
            diagramType,
            layout,
            operations: ops,
          };
        }
      }
      const addBetween = userText.match(
        /(?:add|insert|增加|加入|添加)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)\s+(?:between|在)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)\s+(?:and|和)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*)/i,
      );
      const addPlain = userText.match(
        /(?:add|insert|增加|加入|添加)\s+([A-Za-z\u4e00-\u9fa5][\w\s\u4e00-\u9fa5]*?)(?:[.,，。]|$)/i,
      );
      const add = addBetween ?? addPlain;
      if (add) {
        // stop the component label at conjunctions ("Redis but keep ...")
        const label = add[1].trim().split(/\s+(?:but|and|with|to)\s+/i)[0];
        const { kind } = classify(label);
        const id = slug(label);
        ops.push({ operation: 'add_node', id, label, kind });
        const srcId = add[2] ? findId(add[2].trim(), context) : null;
        const tgtId = add[3] ? findId(add[3].trim(), context) : null;
        if (srcId && tgtId) {
          ops.push({ operation: 'add_edge', id: `e-${id}-1`, source: srcId, target: id });
          ops.push({ operation: 'add_edge', id: `e-${id}-2`, source: id, target: tgtId });
        } else if (srcId) {
          ops.push({ operation: 'add_edge', id: `e-${srcId}-${id}`, source: srcId, target: id });
        } else {
          ops.push({ operation: 'change_layout', layout: 'architecture', direction: 'LR' });
        }
        return {
          summary: `已添加「${label}」。`,
          intent: 'modify',
          diagramType,
          layout: { mode: 'manual', direction: 'LR' },
          operations: ops,
        };
      }
      const layoutReq = /(layout|布局|排列|align|重排)/i.test(userText);
      if (layoutReq) {
        ops.push({ operation: 'change_layout', layout: 'auto', direction: 'LR' });
        return {
          summary: '已重新布局。',
          intent: 'modify',
          diagramType,
          layout: { mode: 'auto', direction: 'LR' },
          operations: ops,
        };
      }
      // fallthrough: treat as create with extracted components
    }

    // --- create requests ---
    if (/(mind|思维导图|面试|interview)/.test(lower)) {
      diagramType = 'mindmap';
      layout = { mode: 'mindmap', direction: 'LR' };
      if (/(面试|interview)/.test(lower)) {
        // documented example: Java interview knowledge mind map
        ops = mindmapOps(['Java 面试', 'Java 基础', 'JVM', '并发', 'MySQL', 'Redis', 'Spring', '微服务']);
      } else {
        const components = extractComponents(userText);
        ops = mindmapOps(components.length > 1 ? components : ['中心主题', '分支 1', '分支 2', '分支 3']);
      }
    } else if (/(sequence|时序|tool calling|调用顺序|sequence diagram)/.test(lower)) {
      diagramType = 'sequence';
      layout = { mode: 'sequence', direction: 'LR' };
      const components = extractComponents(userText);
      if (components.length < 2) {
        ops = createOps('sequence', ['User', 'Agent', 'LLM', 'Tool', 'Database']);
      } else {
        ops = createOps('sequence', components);
      }
    } else if (/(flow|流程|login|登录|workflow)/.test(lower)) {
      diagramType = 'flowchart';
      layout = { mode: 'flowchart', direction: 'TB' };
      const components = extractComponents(userText);
      if (components.length < 3) {
        ops = [
          { operation: 'add_node', id: 'start', label: 'Start', kind: 'start' },
          { operation: 'add_node', id: 'input', label: '输入账号密码', kind: 'process' },
          { operation: 'add_node', id: 'check', label: '后端校验', kind: 'decision' },
          { operation: 'add_node', id: 'db', label: '查询数据库', kind: 'database' },
          { operation: 'add_node', id: 'ok', label: '生成 Token', kind: 'process' },
          { operation: 'add_node', id: 'err', label: '返回错误', kind: 'end' },
          { operation: 'add_edge', id: 'e1', source: 'start', target: 'input' },
          { operation: 'add_edge', id: 'e2', source: 'input', target: 'check' },
          { operation: 'add_edge', id: 'e3', source: 'check', target: 'db', label: 'valid' },
          { operation: 'add_edge', id: 'e4', source: 'db', target: 'ok' },
          { operation: 'add_edge', id: 'e5', source: 'check', target: 'err', label: 'invalid' },
        ];
      } else {
        ops = createOps('flowchart', components);
      }
    } else if (/(microservice|微服务|spring cloud|系统架构|architecture)/.test(lower)) {
      diagramType = 'architecture';
      layout = { mode: 'architecture', direction: 'LR' };
      const components = extractComponents(userText);
      ops = architectureOps(
        components.length >= 3
          ? components
          : ['User', 'API Gateway', 'Agent', 'Embedding Model', 'Vector DB', 'LLM', 'PostgreSQL'],
      );
    } else {
      // RAG or generic architecture
      diagramType = 'architecture';
      layout = { mode: 'architecture', direction: 'LR' };
      const components = extractComponents(userText);
      if (/(rag|检索|向量)/.test(lower) || components.length >= 3) {
        ops = architectureOps(
          components.length >= 3
            ? components
            : ['User', 'API Gateway', 'Agent', 'Embedding Model', 'Vector DB', 'LLM', 'PostgreSQL'],
        );
      } else {
        ops = architectureOps(['User', 'API Gateway', 'Service', 'Database']);
      }
    }

    return {
      summary: '已创建图表。',
      intent: 'create',
      diagramType,
      layout,
      operations: ops,
    };
  }
}
