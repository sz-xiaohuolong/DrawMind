import { describe, it, expect } from 'vitest';
import { createBlankModel, serializeModel, serializeCellFragment, escapeXmlAttr } from '../src/diagram/generator';
import { parseXml } from '../src/diagram/parser';
import { validateXml } from '../src/diagram/validator';
import type { Cell } from '../src/diagram/types';

describe('XML generator', () => {
  it('produces valid mxfile XML for a blank model', () => {
    const model = createBlankModel('Test');
    const xml = serializeModel(model);
    expect(xml).toContain('<mxfile');
    expect(xml).toContain('<mxGraphModel');
    expect(xml).toContain('<mxCell id="0"/>');
    expect(xml).toContain('<mxCell id="1" parent="0"/>');
    expect(validateXml(xml).ok).toBe(true);
  });

  it('escapes labels and style attributes', () => {
    const model = createBlankModel('A & B <C>');
    const node: Cell = {
      id: 'n1',
      parent: '1',
      vertex: true,
      value: 'RAG & "LLM" <ok>',
      style: 'fillColor=#162238;label=hello & world',
      geometry: { x: 10, y: 20, width: 120, height: 60 },
    };
    model.cells.push(node);
    const xml = serializeModel(model);
    expect(xml).toContain('RAG &amp; &quot;LLM&quot; &lt;ok&gt;');
    expect(xml).toContain('hello &amp; world');
    // round-trips back to original values
    const parsed = parseXml(xml)!;
    const pn = parsed.cells.find((c) => c.id === 'n1')!;
    expect(pn.value).toBe('RAG & "LLM" <ok>');
    expect(pn.style).toBe('fillColor=#162238;label=hello & world');
    expect(pn.geometry?.x).toBe(10);
    expect(pn.geometry?.y).toBe(20);
    expect(pn.geometry?.width).toBe(120);
  });

  it('preserves edge waypoints and custom attributes (lossless round-trip)', () => {
    const model = createBlankModel();
    const a: Cell = {
      id: 'a',
      parent: '1',
      vertex: true,
      value: 'A',
      style: 'rounded=1;',
      geometry: { x: 0, y: 0, width: 100, height: 50 },
    };
    const b: Cell = {
      id: 'b',
      parent: '1',
      vertex: true,
      value: 'B',
      style: 'rounded=1;',
      geometry: { x: 400, y: 0, width: 100, height: 50 },
    };
    const e: Cell = {
      id: 'e1',
      parent: '1',
      edge: true,
      source: 'a',
      target: 'b',
      value: 'flow',
      style: 'edgeStyle=orthogonalEdgeStyle;',
      attrs: { dmKind: 'service', connectable: '0' },
      geometry: {
        relative: true,
        points: [{ x: 200, y: 40 }, { x: 300, y: 40 }],
        sourcePoint: { x: 100, y: 25 },
        targetPoint: { x: 400, y: 25 },
      },
    };
    model.cells.push(a, b, e);
    const xml = serializeModel(model);
    expect(validateXml(xml).ok).toBe(true);
    const parsed = parseXml(xml)!;
    const pe = parsed.cells.find((c) => c.id === 'e1')!;
    expect(pe.source).toBe('a');
    expect(pe.attrs?.dmKind).toBe('service');
    expect(pe.attrs?.connectable).toBe('0');
    expect(pe.geometry?.relative).toBe(true);
    expect(pe.geometry?.points?.length).toBe(2);
    expect(pe.geometry?.sourcePoint).toEqual({ x: 100, y: 25 });
    expect(pe.value).toBe('flow');
  });

  it('serializes a single-cell fragment for incremental merge', () => {
    const cell: Cell = {
      id: 'new',
      parent: '1',
      vertex: true,
      value: 'Redis',
      style: 'rounded=1;',
      geometry: { x: 0, y: 0, width: 130, height: 54 },
    };
    const xml = serializeCellFragment(cell);
    expect(xml).toContain('<mxCell id="new"');
    expect(xml).toContain('Redis');
    // A fragment is not a full document, but must still parse and round-trip.
    const parsed = parseXml(xml)!;
    const cellOut = parsed.cells.find((c) => c.id === 'new')!;
    expect(cellOut.value).toBe('Redis');
    expect(cellOut.geometry?.width).toBe(130);
  });

  it('escapes XML special characters correctly', () => {
    expect(escapeXmlAttr('a<b>c&d"e')).toBe('a&lt;b&gt;c&amp;d&quot;e');
  });
});
