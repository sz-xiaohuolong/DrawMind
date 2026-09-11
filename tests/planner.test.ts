import { describe, it, expect } from 'vitest';
import { extractJsonObject, parseAgentResponse, ParseError } from '../src/agent/planner';
import { buildDiagramContext, buildMessages } from '../src/agent/prompts';
import { buildDiagramState } from '../src/diagram/state';
import { createBlankModel } from '../src/diagram/generator';
import { applyOperations, validateOperations } from '../src/diagram/operations';
import type { DiagramOperation } from '../src/diagram/types';

describe('Agent planner (structured output parsing)', () => {
  it('extracts JSON from a clean response', () => {
    const raw = extractJsonObject('{"summary":"ok","operations":[]}');
    expect(raw).toMatchObject({ summary: 'ok' });
  });

  it('extracts JSON from fenced markdown', () => {
    const raw = extractJsonObject('```json\n{"summary":"fenced","operations":[]}\n```');
    expect(raw).toMatchObject({ summary: 'fenced' });
  });

  it('extracts JSON surrounded by prose', () => {
    const raw = extractJsonObject('Here you go: {"summary":"mid","operations":[]} hope that helps');
    expect(raw).toMatchObject({ summary: 'mid' });
  });

  it('throws on garbage', () => {
    expect(() => extractJsonObject('no json here')).toThrow(ParseError);
    expect(() => extractJsonObject('{"unbalanced"')).toThrow(ParseError);
  });

  it('normalizes a full AgentResult', () => {
    const r = parseAgentResponse(
      JSON.stringify({
        summary: 'Added cache',
        intent: 'modify',
        diagramType: 'architecture',
        layout: { mode: 'architecture', direction: 'LR' },
        operations: [
          { operation: 'add_node', id: 'redis', label: 'Redis', kind: 'cache' },
          { operation: 'bogus_op' },
          { operation: 'add_edge', id: 'e', source: 'redis', target: 'ghost' },
        ],
      }),
    );
    expect(r.summary).toBe('Added cache');
    expect(r.operations).toHaveLength(2);
    expect(r.operations[0]).toMatchObject({ operation: 'add_node', id: 'redis' });
    // the add_edge is structurally parseable; dangling refs are caught later by validateOperations
    expect(r.operations[1]).toMatchObject({ operation: 'add_edge', id: 'e' });
  });

  it('fills defaults when fields are missing', () => {
    const r = parseAgentResponse(JSON.stringify({ summary: '' }));
    expect(r.diagramType).toBe('architecture');
    expect(r.intent).toBe('modify');
    expect(r.layout.mode).toBe('auto');
  });

  it('builds a compact diagram context for the model', () => {
    const model = createBlankModel('RAG');
    const { ops } = validateOperations(
      [
        { operation: 'add_node', id: 'user', label: 'User', kind: 'user' },
        { operation: 'add_node', id: 'llm', label: 'LLM', kind: 'ai-model' },
        { operation: 'add_edge', id: 'e1', source: 'user', target: 'llm' },
      ] as DiagramOperation[],
      model,
    );
    const m = applyOperations(model, ops).model;
    const ctx = buildDiagramContext(buildDiagramState(m));
    const parsed = JSON.parse(ctx);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe('user');
    // no geometry noise for the model
    expect(JSON.stringify(parsed)).not.toContain('"x"');
  });

  it('builds system + history + user messages', () => {
    const msgs = buildMessages(
      [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'done' }],
      '{"nodes":[]}',
      'add redis',
    );
    expect(msgs[0].role).toBe('system');
    expect(msgs.some((m) => m.content.includes('CURRENT DIAGRAM'))).toBe(true);
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'user', content: 'add redis' });
    expect(msgs.length).toBe(5);
  });
});
