import { describe, it, expect } from 'vitest';
import { createBlankModel } from '../src/diagram/generator';
import { validateOperations, applyOperations } from '../src/diagram/operations';
import { validateModel } from '../src/diagram/validator';
import { buildDiagramState } from '../src/diagram/state';
import type { DiagramOperation, Model } from '../src/diagram/types';

function emptyModel(): Model {
  return createBlankModel('Test Diagram');
}

describe('Operation validation', () => {
  it('rejects unknown operations', () => {
    const r = validateOperations([{ operation: 'explode', id: 'x' } as unknown as DiagramOperation], emptyModel());
    expect(r.rejected.length).toBe(1);
    expect(r.ops.length).toBe(0);
  });

  it('rejects add_edge with dangling references', () => {
    const r = validateOperations(
      [{ operation: 'add_edge', id: 'e', source: 'a', target: 'b' }],
      emptyModel(),
    );
    expect(r.rejected.length).toBe(1);
  });

  it('accepts edges referencing nodes added in the same batch', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'a', label: 'A' },
      { operation: 'add_node', id: 'b', label: 'B' },
      { operation: 'add_edge', id: 'e', source: 'a', target: 'b', label: 'calls' },
    ];
    const r = validateOperations(ops, emptyModel());
    expect(r.rejected.length).toBe(0);
    expect(r.ops.length).toBe(3);
  });

  it('rejects modification of missing cells', () => {
    const r = validateOperations([{ operation: 'delete_node', id: 'ghost' }], emptyModel());
    expect(r.rejected.length).toBe(1);
  });

  it('sanitizes labels (control chars, overlong)', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'a', label: 'x\u0000y\u0007<script>' },
    ];
    const r = validateOperations(ops, emptyModel());
    expect(r.ops[0]).toBeDefined();
    const label = (r.ops[0] as { label: string }).label;
    expect(label).not.toContain('\u0000');
  });

  it('rejects invalid colors', () => {
    const r = validateOperations([{ operation: 'set_background', color: 'red' }], emptyModel());
    expect(r.rejected.length).toBe(1);
    expect(validateOperations([{ operation: 'set_background', color: '#0B1320' }], emptyModel()).rejected.length).toBe(0);
  });
});

describe('Operation application', () => {
  it('creates a diagram from scratch (nodes + edges)', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'user', label: 'User', kind: 'user' },
      { operation: 'add_node', id: 'gw', label: 'API Gateway', kind: 'gateway' },
      { operation: 'add_node', id: 'llm', label: 'LLM', kind: 'ai-model' },
      { operation: 'add_edge', id: 'e1', source: 'user', target: 'gw' },
      { operation: 'add_edge', id: 'e2', source: 'gw', target: 'llm', label: 'prompt' },
    ];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r = applyOperations(emptyModel(), valid);
    expect(r.rejected).toHaveLength(0);
    expect(r.addedNodeIds).toHaveLength(3);
    expect(validateModel(r.model).ok).toBe(true);
    const state = buildDiagramState(r.model);
    expect(state.nodes).toHaveLength(3);
    expect(state.edges).toHaveLength(2);
    const llm = state.nodes.find((n) => n.id === 'llm')!;
    expect(llm.kind).toBe('ai-model');
    expect(llm.style).toContain('#7C3AED');
  });

  it('renames a node without touching the rest', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'milvus', label: 'Milvus', kind: 'vector-db' },
      { operation: 'add_node', id: 'pg', label: 'PostgreSQL', kind: 'database' },
    ];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r1 = applyOperations(emptyModel(), valid);
    const r2 = applyOperations(r1.model, [
      { operation: 'rename_node', id: 'milvus', label: 'pgvector' },
    ]);
    expect(r2.rejected).toHaveLength(0);
    const state = buildDiagramState(r2.model);
    expect(state.nodes).toHaveLength(2);
    const milvus = state.nodes.find((n) => n.id === 'milvus')!;
    expect(milvus.label).toBe('pgvector');
    const pg = state.nodes.find((n) => n.id === 'pg')!;
    expect(pg.label).toBe('PostgreSQL');
  });

  it('deletes a node and its incident edges', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'a', label: 'A' },
      { operation: 'add_node', id: 'b', label: 'B' },
      { operation: 'add_node', id: 'c', label: 'C' },
      { operation: 'add_edge', id: 'e1', source: 'a', target: 'b' },
      { operation: 'add_edge', id: 'e2', source: 'b', target: 'c' },
    ];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r1 = applyOperations(emptyModel(), valid);
    const r2 = applyOperations(r1.model, [{ operation: 'delete_node', id: 'b' }]);
    const state = buildDiagramState(r2.model);
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(0);
    expect(validateModel(r2.model).ok).toBe(true);
  });

  it('adds an edge between existing nodes', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'agent', label: 'Agent', kind: 'agent' },
      { operation: 'add_node', id: 'tool', label: 'Tool Server', kind: 'tool' },
    ];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r1 = applyOperations(emptyModel(), valid);
    const r2 = applyOperations(r1.model, [
      { operation: 'add_edge', id: 'toolcall', source: 'agent', target: 'tool', label: 'tool calling' },
    ]);
    const state = buildDiagramState(r2.model);
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0]).toMatchObject({ id: 'toolcall', source: 'agent', target: 'tool', label: 'tool calling' });
  });

  it('moves a node and marks it manual (layout will not move it back)', () => {
    const ops: DiagramOperation[] = [{ operation: 'add_node', id: 'a', label: 'A' }];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r1 = applyOperations(emptyModel(), valid);
    const r2 = applyOperations(r1.model, [{ operation: 'move_node', id: 'a', x: 500, y: 300 }]);
    const cell = r2.model.cells.find((c) => c.id === 'a')!;
    expect(cell.geometry?.x).toBe(500);
    expect(cell.geometry?.y).toBe(300);
    expect(cell.attrs?.dmManual).toBe('1');
  });

  it('handles duplicate ids in a batch by renaming', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'dup', label: 'First' },
      { operation: 'add_node', id: 'dup', label: 'Second' },
    ];
    const { ops: valid, warnings } = validateOperations(ops, emptyModel());
    expect(warnings.length).toBeGreaterThan(0);
    const r = applyOperations(emptyModel(), valid);
    const state = buildDiagramState(r.model);
    expect(state.nodes).toHaveLength(2);
    expect(new Set(state.nodes.map((n) => n.id)).size).toBe(2);
  });

  it('applies add_node_to_group and expands the group geometry', () => {
    const ops: DiagramOperation[] = [
      { operation: 'add_node', id: 'a', label: 'A' },
      { operation: 'add_node', id: 'b', label: 'B' },
      { operation: 'add_group', id: 'g1', label: 'Cache Layer' },
    ];
    const { ops: valid } = validateOperations(ops, emptyModel());
    const r1 = applyOperations(emptyModel(), valid);
    // move the members apart, then group them
    const r2 = applyOperations(r1.model, [
      { operation: 'move_node', id: 'a', x: 100, y: 100 },
      { operation: 'move_node', id: 'b', x: 300, y: 200 },
      { operation: 'add_node_to_group', groupId: 'g1', nodeId: 'a' },
      { operation: 'add_node_to_group', groupId: 'g1', nodeId: 'b' },
    ]);
    const g = r2.model.cells.find((c) => c.id === 'g1')!;
    expect(g.geometry!.x!).toBeLessThan(100);
    expect(g.geometry!.width!).toBeGreaterThan(300 - 100 + 100);
    const state = buildDiagramState(r2.model);
    expect(state.groups).toHaveLength(1);
    expect(state.groups[0].memberIds).toEqual(['a', 'b']);
    expect(state.nodes.find((n) => n.id === 'a')?.groupId).toBe('g1');
  });
});
