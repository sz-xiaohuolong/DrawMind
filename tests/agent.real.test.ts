import { describe, it, expect } from 'vitest';
import { DeepSeekProvider } from '../src/providers/deepseek';
import { runDiagramAgent } from '../src/agent/diagramAgent';
import { createBlankModel } from '../src/diagram/generator';
import { parseXml } from '../src/diagram/parser';
import { buildDiagramState } from '../src/diagram/state';
import { validateXml } from '../src/diagram/validator';

/**
 * Live E2E against the real DeepSeek model via the local server proxy.
 * Run with: REAL_API=1 npx vitest run tests/agent.real.test.ts
 * (requires the dev server on :3001 with DEEPSEEK_API_KEY set).
 */
const real = process.env.REAL_API === '1';

describe.skipIf(!real)('Agent pipeline (live DeepSeek)', () => {
  it('Case 1: creates a RAG architecture from natural language', async () => {
    const provider = new DeepSeekProvider();
    const r = await runDiagramAgent(
      provider,
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      { model: createBlankModel('Live Test'), diagramType: 'architecture', history: [] },
    );
    expect(r.changed).toBe(true);
    expect(r.rejected).toHaveLength(0);
    expect(validateXml(r.xml).ok).toBe(true);
    const state = buildDiagramState(parseXml(r.xml)!);
    const labels = state.nodes.map((n) => n.label.toLowerCase().trim());
    expect(labels.some((l) => l.includes('milvus'))).toBe(true);
    expect(labels.some((l) => l.includes('llm'))).toBe(true);
    console.log('created:', labels.join(', '), '| edges:', state.edges.length);
  }, 180_000);

  it('Case 2: replaces Milvus with pgvector incrementally', async () => {
    const provider = new DeepSeekProvider();
    const created = await runDiagramAgent(
      provider,
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      { model: createBlankModel('Live Test'), diagramType: 'architecture', history: [] },
    );
    const before = buildDiagramState(parseXml(created.xml)!);
    const r = await runDiagramAgent(provider, 'Replace Milvus with pgvector', {
      model: parseXml(created.xml)!,
      diagramType: 'architecture',
      history: [],
    });
    const after = buildDiagramState(parseXml(r.xml)!);
    expect(after.nodes).toHaveLength(before.nodes.length);
    const milvusId = before.nodes.find((n) => n.label.toLowerCase().includes('milvus'))?.id;
    const node = after.nodes.find((n) => n.id === milvusId);
    expect(node?.label.toLowerCase()).toContain('pgvector');
    expect(validateXml(r.xml).ok).toBe(true);
    console.log('replaced:', node?.label);
  }, 180_000);

  it('Case 3: adds a Tool Server between Agent and LLM', async () => {
    const provider = new DeepSeekProvider();
    const created = await runDiagramAgent(
      provider,
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      { model: createBlankModel('Live Test'), diagramType: 'architecture', history: [] },
    );
    const before = buildDiagramState(parseXml(created.xml)!);
    const r = await runDiagramAgent(provider, 'Add a Tool Server between Agent and LLM', {
      model: parseXml(created.xml)!,
      diagramType: 'architecture',
      history: [],
    });
    const after = buildDiagramState(parseXml(r.xml)!);
    expect(after.nodes.length).toBeGreaterThanOrEqual(before.nodes.length);
    expect(after.nodes.some((n) => n.label.toLowerCase().includes('tool'))).toBe(true);
    expect(validateXml(r.xml).ok).toBe(true);
    console.log('added tool node:', after.nodes.map((n) => n.label).join(', '));
  }, 180_000);
});
