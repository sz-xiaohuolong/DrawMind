import { describe, it, expect } from 'vitest';
import { createBlankModel } from '../src/diagram/generator';
import { layoutModel, layoutNewNodes, layoutSequence } from '../src/diagram/layout';
import { applyOperations, validateOperations } from '../src/diagram/operations';
import { buildDiagramState } from '../src/diagram/state';
import type { DiagramOperation, Model } from '../src/diagram/types';

function build(opStrings: DiagramOperation[]): Model {
  const { ops } = validateOperations(opStrings, createBlankModel('L'));
  return applyOperations(createBlankModel('L'), ops).model;
}

function nodesOf(model: Model) {
  return buildDiagramState(model).nodes;
}

function assertNoOverlap(model: Model): void {
  const nodes = nodesOf(model);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const overlap =
        a.x < b.x + b.w + 20 && a.x + a.w + 20 > b.x && a.y < b.y + b.h + 20 && a.y + a.h + 20 > b.y;
      expect(overlap, `nodes ${a.id} and ${b.id} overlap`).toBe(false);
    }
  }
}

describe('Layout engine', () => {
  it('layers an architecture left-to-right with no overlaps', () => {
    const model = build([
      { operation: 'add_node', id: 'user', label: 'User', kind: 'user' },
      { operation: 'add_node', id: 'gw', label: 'API Gateway', kind: 'gateway' },
      { operation: 'add_node', id: 'agent', label: 'Agent', kind: 'agent' },
      { operation: 'add_node', id: 'llm', label: 'LLM', kind: 'ai-model' },
      { operation: 'add_node', id: 'vdb', label: 'Milvus', kind: 'vector-db' },
      { operation: 'add_node', id: 'pg', label: 'PostgreSQL', kind: 'database' },
      { operation: 'add_edge', id: 'e1', source: 'user', target: 'gw' },
      { operation: 'add_edge', id: 'e2', source: 'gw', target: 'agent' },
      { operation: 'add_edge', id: 'e3', source: 'agent', target: 'llm' },
      { operation: 'add_edge', id: 'e4', source: 'agent', target: 'vdb' },
      { operation: 'add_edge', id: 'e5', source: 'agent', target: 'pg' },
    ]);
    const laid = layoutModel(model, { mode: 'architecture', direction: 'LR' });
    assertNoOverlap(laid);
    const nodes = nodesOf(laid);
    const user = nodes.find((n) => n.id === 'user')!;
    const gw = nodes.find((n) => n.id === 'gw')!;
    const llm = nodes.find((n) => n.id === 'llm')!;
    // left → right ordering
    expect(user.x).toBeLessThan(gw.x);
    expect(gw.x).toBeLessThan(llm.x);
  });

  it('lays out a flowchart top-to-bottom', () => {
    const model = build([
      { operation: 'add_node', id: 's1', label: 'Start', kind: 'start' },
      { operation: 'add_node', id: 'p1', label: 'Check', kind: 'process' },
      { operation: 'add_node', id: 'd1', label: 'Valid?', kind: 'decision' },
      { operation: 'add_node', id: 'ok', label: 'OK', kind: 'process' },
      { operation: 'add_node', id: 'err', label: 'Error', kind: 'process' },
      { operation: 'add_edge', id: 'e1', source: 's1', target: 'p1' },
      { operation: 'add_edge', id: 'e2', source: 'p1', target: 'd1' },
      { operation: 'add_edge', id: 'e3', source: 'd1', target: 'ok' },
      { operation: 'add_edge', id: 'e4', source: 'd1', target: 'err' },
    ]);
    const laid = layoutModel(model, { mode: 'flowchart', direction: 'TB' });
    assertNoOverlap(laid);
    const nodes = nodesOf(laid);
    const s1 = nodes.find((n) => n.id === 's1')!;
    const p1 = nodes.find((n) => n.id === 'p1')!;
    const d1 = nodes.find((n) => n.id === 'd1')!;
    expect(s1.y).toBeLessThan(p1.y);
    expect(p1.y).toBeLessThan(d1.y);
  });

  it('lays out a mindmap as a tree from the root', () => {
    const model = build([
      { operation: 'add_node', id: 'root', label: 'Java 面试', kind: 'generic' },
      { operation: 'add_node', id: 'c1', label: 'JVM', kind: 'generic' },
      { operation: 'add_node', id: 'c2', label: '并发', kind: 'generic' },
      { operation: 'add_node', id: 'c3', label: 'MySQL', kind: 'database' },
      { operation: 'add_node', id: 'g1', label: 'GC', kind: 'generic' },
      { operation: 'add_edge', id: 'e1', source: 'root', target: 'c1' },
      { operation: 'add_edge', id: 'e2', source: 'root', target: 'c2' },
      { operation: 'add_edge', id: 'e3', source: 'root', target: 'c3' },
      { operation: 'add_edge', id: 'e4', source: 'c1', target: 'g1' },
    ]);
    const laid = layoutModel(model, { mode: 'mindmap' });
    assertNoOverlap(laid);
    const nodes = nodesOf(laid);
    const root = nodes.find((n) => n.id === 'root')!;
    const c1 = nodes.find((n) => n.id === 'c1')!;
    const g1 = nodes.find((n) => n.id === 'g1')!;
    expect(c1.x).toBeGreaterThan(root.x);
    expect(g1.x).toBeGreaterThan(c1.x);
  });

  it('lays out a sequence diagram with participants and staggered rows', () => {
    const model = build([
      { operation: 'add_node', id: 'user', label: 'User', kind: 'user' },
      { operation: 'add_node', id: 'agent', label: 'Agent', kind: 'agent' },
      { operation: 'add_node', id: 'llm', label: 'LLM', kind: 'ai-model' },
      { operation: 'add_edge', id: 'm1', source: 'user', target: 'agent', label: 'query' },
      { operation: 'add_edge', id: 'm2', source: 'agent', target: 'llm', label: 'prompt' },
      { operation: 'add_edge', id: 'm3', source: 'llm', target: 'agent', label: 'answer' },
    ]);
    const laid = layoutModel(model, { mode: 'sequence' });
    assertNoOverlap(laid);
    const state = buildDiagramState(laid);
    const m1 = state.edges.find((e) => e.id === 'm1')!;
    const m3 = state.edges.find((e) => e.id === 'm3')!;
    expect(m1.style).toContain('exitDy=');
    expect(m3.style).toContain('exitDy=');
    // staggered: later message has a bigger exit offset
    const dy1 = Number(m1.style.match(/exitDy=(-?\d+)/)?.[1]);
    const dy3 = Number(m3.style.match(/exitDy=(-?\d+)/)?.[1]);
    expect(dy3).toBeGreaterThan(dy1);
    // helper cells added
    expect(laid.cells.some((c) => c.id.startsWith('_anchor_'))).toBe(true);
    expect(laid.cells.some((c) => c.id.startsWith('_lifeline_'))).toBe(true);
  });

  it('incremental placement adds nodes without moving existing ones', () => {
    const model = build([
      { operation: 'add_node', id: 'a', label: 'A' },
      { operation: 'add_node', id: 'b', label: 'B' },
      { operation: 'add_edge', id: 'e1', source: 'a', target: 'b' },
    ]);
    const laid = layoutModel(model, { mode: 'architecture', direction: 'LR' });
    const before = nodesOf(laid);
    const aBefore = before.find((n) => n.id === 'a')!;
    const bBefore = before.find((n) => n.id === 'b')!;

    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'c', label: 'C' },
      { operation: 'add_edge', id: 'e2', source: 'b', target: 'c' },
    ];
    const { ops: valid } = validateOperations(ops, laid);
    const grown = applyOperations(laid, valid).model;
    const incremental = layoutNewNodes(grown, ['c'], 'LR');

    const after = nodesOf(incremental);
    const aAfter = after.find((n) => n.id === 'a')!;
    const bAfter = after.find((n) => n.id === 'b')!;
    expect(aAfter.x).toBe(aBefore.x);
    expect(aAfter.y).toBe(aBefore.y);
    expect(bAfter.x).toBe(bBefore.x);
    expect(bAfter.y).toBe(bBefore.y);
    const c = after.find((n) => n.id === 'c')!;
    expect(c.x).toBeGreaterThan(bAfter.x + bAfter.w - 10);
  });

  it('does not disturb manually moved nodes during relayout', () => {
    const model = build([{ operation: 'add_node', id: 'a', label: 'A' }]);
    const moved = applyOperations(model, [{ operation: 'move_node', id: 'a', x: 500, y: 300 }]).model;
    const relaid = layoutModel(moved, { mode: 'architecture', force: false });
    const a = buildDiagramState(relaid).nodes.find((n) => n.id === 'a')!;
    expect(a.x).toBe(500);
    expect(a.y).toBe(300);
  });

  it('sequence layout helper is callable directly with bounds', () => {
    const model = createBlankModel();
    const r = layoutSequence(
      model,
      [
        { id: 'u', x: 0, y: 0, w: 120, h: 54 },
        { id: 'a', x: 0, y: 0, w: 140, h: 54 },
      ],
      [
        { id: 'm1', source: 'u', target: 'a' },
        { id: 'm2', source: 'a', target: 'u' },
      ],
    );
    expect(r.positions.get('u')).toEqual({ x: 60, y: 60 });
    expect(r.positions.get('a')!.x).toBeGreaterThan(120 + 150 - 1);
    expect(r.edgeStyles.size).toBe(2);
    expect(r.anchors).toHaveLength(2);
    expect(r.anchorEdges).toHaveLength(2);
  });

  it('lays out complex multi-workflow diagrams with groups with zero overlaps and non-negative coordinates', () => {
    const complexOps: DiagramOperation[] = [
      // Workflow 1: RAG
      { operation: 'add_node', id: 'user', label: 'User', kind: 'user' },
      { operation: 'add_node', id: 'gw', label: 'API Gateway', kind: 'gateway' },
      { operation: 'add_node', id: 'agent', label: 'Agent', kind: 'agent' },
      { operation: 'add_node', id: 'embed', label: 'Embedding 模型', kind: 'ai-model' },
      { operation: 'add_node', id: 'milvus', label: 'Milvus 向量库', kind: 'vector-db' },
      { operation: 'add_node', id: 'llm', label: 'LLM', kind: 'ai-model' },
      { operation: 'add_node', id: 'pg', label: 'PostgreSQL', kind: 'database' },
      { operation: 'add_edge', id: 'e1', source: 'user', target: 'gw' },
      { operation: 'add_edge', id: 'e2', source: 'gw', target: 'agent' },
      { operation: 'add_edge', id: 'e3', source: 'agent', target: 'embed' },
      { operation: 'add_edge', id: 'e4', source: 'embed', target: 'milvus' },
      { operation: 'add_edge', id: 'e5', source: 'agent', target: 'llm' },
      { operation: 'add_edge', id: 'e6', source: 'agent', target: 'pg' },

      // Workflow 2: PDF processing pipeline with group
      { operation: 'add_node', id: 'pdf_doc', label: 'PDF 文档', kind: 'storage' },
      { operation: 'add_group', id: 'g_layout', label: '版面感知解析' },
      { operation: 'add_node', id: 'pymupdf', label: 'PyMuPDF / pdfplumber', kind: 'tool', group: 'g_layout' },
      { operation: 'add_node', id: 'ocr', label: 'OCR / 多模态模型', kind: 'ai-model', group: 'g_layout' },
      { operation: 'add_node', id: 'chunking', label: '动态分块', kind: 'process' },
      { operation: 'add_edge', id: 'e_pdf1', source: 'pdf_doc', target: 'pymupdf' },
      { operation: 'add_edge', id: 'e_pdf2', source: 'pdf_doc', target: 'ocr' },
      { operation: 'add_edge', id: 'e_pdf3', source: 'pymupdf', target: 'chunking' },
      { operation: 'add_edge', id: 'e_pdf4', source: 'ocr', target: 'chunking' },
      { operation: 'add_edge', id: 'e_pdf5', source: 'chunking', target: 'embed' },

      // Workflow 3: Agent 3 Patterns
      { operation: 'add_group', id: 'g_react', label: 'ReAct 模式' },
      { operation: 'add_node', id: 'thought', label: 'Thought 思考(分析)', kind: 'process', group: 'g_react' },
      { operation: 'add_node', id: 'action', label: 'Action 调用工具', kind: 'tool', group: 'g_react' },
      { operation: 'add_node', id: 'obs', label: 'Observation 观察', kind: 'process', group: 'g_react' },
      { operation: 'add_edge', id: 'e_r1', source: 'thought', target: 'action' },
      { operation: 'add_edge', id: 'e_r2', source: 'action', target: 'obs' },

      { operation: 'add_group', id: 'g_pe', label: 'Plan-and-Execute' },
      { operation: 'add_node', id: 'planner', label: 'Planner 规划', kind: 'process', group: 'g_pe' },
      { operation: 'add_node', id: 'executor', label: 'Executor 执行', kind: 'process', group: 'g_pe' },
      { operation: 'add_node', id: 'replanner', label: 'Replanner 重规划', kind: 'process', group: 'g_pe' },
      { operation: 'add_edge', id: 'e_p1', source: 'planner', target: 'executor' },
      { operation: 'add_edge', id: 'e_p2', source: 'executor', target: 'replanner' },

      { operation: 'add_group', id: 'g_multi', label: 'Multi-Agent' },
      { operation: 'add_node', id: 'coord', label: 'Coordinator', kind: 'agent', group: 'g_multi' },
      { operation: 'add_node', id: 'worker_a', label: 'Worker A', kind: 'agent', group: 'g_multi' },
      { operation: 'add_node', id: 'worker_b', label: 'Worker B', kind: 'agent', group: 'g_multi' },
      { operation: 'add_edge', id: 'e_m1', source: 'coord', target: 'worker_a' },
      { operation: 'add_edge', id: 'e_m2', source: 'coord', target: 'worker_b' },

      { operation: 'add_edge', id: 'e_conn1', source: 'agent', target: 'thought' },
      { operation: 'add_edge', id: 'e_conn2', source: 'agent', target: 'planner' },
      { operation: 'add_edge', id: 'e_conn3', source: 'agent', target: 'coord' },
    ];

    const model = build(complexOps);
    const laid = layoutModel(model, { mode: 'architecture', direction: 'LR' });
    const state = buildDiagramState(laid);

    // 1. Zero node overlaps
    assertNoOverlap(laid);

    // 2. All coordinates are strictly non-negative (>= MARGIN)
    for (const n of state.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(50);
      expect(n.y).toBeGreaterThanOrEqual(50);
    }

    // 3. Groups properly surround their members
    for (const g of state.groups) {
      const gCell = laid.cells.find((c) => c.id === g.id);
      expect(gCell?.geometry?.width).toBeGreaterThan(150);
      expect(gCell?.geometry?.height).toBeGreaterThan(80);
      const members = state.nodes.filter((n) => n.groupId === g.id);
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) {
        expect(m.x).toBeGreaterThanOrEqual(gCell!.geometry!.x!);
        expect(m.y).toBeGreaterThanOrEqual(gCell!.geometry!.y!);
      }
    }
  });
});
