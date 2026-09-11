import { describe, it, expect } from 'vitest';
import { MockProvider } from '../src/providers/mock';
import { runDiagramAgent } from '../src/agent/diagramAgent';
import { createBlankModel } from '../src/diagram/generator';
import { parseXml } from '../src/diagram/parser';
import { buildDiagramState } from '../src/diagram/state';
import { validateXml, validateModel } from '../src/diagram/validator';
import type { DiagramType, Model } from '../src/diagram/types';

/**
 * Integration: full agent pipeline with the MockProvider —
 * prompt → ops → validate → apply → layout → XML → validate.
 * This mirrors the acceptance cases (create, replace, add-between).
 */

const provider = new MockProvider();

async function run(text: string, model: Model, type: DiagramType = 'architecture') {
  const result = await runDiagramAgent(provider, text, {
    model,
    diagramType: type,
    history: [],
  });
  return result;
}

describe('Agent pipeline (integration)', () => {
  it('Case 1: creates a RAG architecture from natural language', async () => {
    const blank = createBlankModel('Test');
    const r = await run(
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      blank,
    );
    expect(r.changed).toBe(true);
    expect(r.rejected).toHaveLength(0);
    expect(validateXml(r.xml).ok).toBe(true);
    const model = parseXml(r.xml)!;
    expect(validateModel(model).ok).toBe(true);
    const state = buildDiagramState(model);
    const labels = state.nodes.map((n) => n.label.toLowerCase());
    expect(labels.some((l) => l.includes('milvus'))).toBe(true);
    expect(labels.some((l) => l.includes('llm'))).toBe(true);
    expect(state.edges.length).toBeGreaterThan(0);
    // laid out: no zero positions
    for (const n of state.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('Case 2: replaces Milvus with pgvector — same diagram, one node changed', async () => {
    const blank = createBlankModel('Test');
    const created = await run(
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      blank,
    );
    const modelBefore = parseXml(created.xml)!;
    const stateBefore = buildDiagramState(modelBefore);

    const r = await run('Replace Milvus with pgvector', modelBefore, 'architecture');
    expect(r.changed).toBe(true);
    const modelAfter = parseXml(r.xml)!;
    const stateAfter = buildDiagramState(modelAfter);

    // SAME number of nodes — nothing added/removed
    expect(stateAfter.nodes).toHaveLength(stateBefore.nodes.length);
    // Milvus node now labeled pgvector
    const milvus = stateAfter.nodes.find((n) => n.id === stateBefore.nodes.find((x) => x.label === 'Milvus')?.id);
    expect(milvus?.label).toBe('pgvector');
    // other nodes untouched
    expect(stateAfter.nodes.some((n) => n.label === 'LLM')).toBe(true);
  });

  it('Case 3: adds a Tool Server between Agent and external services', async () => {
    const blank = createBlankModel('Test');
    const created = await run(
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      blank,
    );
    const modelBefore = parseXml(created.xml)!;
    const before = buildDiagramState(modelBefore);

    const r = await run('Add a Tool Server between Agent and external services', modelBefore, 'architecture');
    const modelAfter = parseXml(r.xml)!;
    const after = buildDiagramState(modelAfter);
    expect(after.nodes).toHaveLength(before.nodes.length + 1);
    const tool = after.nodes.find((n) => n.label.toLowerCase().includes('tool'));
    expect(tool).toBeDefined();
    expect(validateXml(r.xml).ok).toBe(true);
  });

  it('produces draw.io-importable XML (mxGraphModel with unique ids)', async () => {
    const r = await run('Build a RAG system architecture', createBlankModel('T'));
    expect(r.xml).toContain('<mxGraphModel');
    // strict id match (avoids grid="1" style false positives)
    const ids = r.xml.match(/\bid="([^"]+)"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('answers queries without changing the diagram', async () => {
    const blank = createBlankModel('Test');
    const created = await run(
      'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
      blank,
    );
    const r = await run('What components are in this diagram?', parseXml(created.xml)!);
    expect(r.changed).toBe(false);
  });
});
