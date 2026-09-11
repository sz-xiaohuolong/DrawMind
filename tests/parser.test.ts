import { describe, it, expect } from 'vitest';
import { parseXml, getVertexCells, getEdgeCells } from '../src/diagram/parser';
import { serializeModel } from '../src/diagram/generator';
import { buildDiagramState } from '../src/diagram/state';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" version="24.0.0" type="device">
  <diagram id="p1" name="RAG System" background="#0B1320">
    <mxGraphModel dx="1022" dy="602" grid="1" gridSize="10" page="0" pageWidth="1920" pageHeight="1080" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="user" value="User" style="rounded=1;fillColor=#F5A623;" vertex="1" parent="1">
          <mxGeometry x="60" y="40" width="130" height="54" as="geometry"/>
        </mxCell>
        <mxCell id="llm" value="LLM" style="rounded=1;" vertex="1" parent="1" dmKind="ai-model">
          <mxGeometry x="400" y="300" width="160" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="e1" value="calls" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="user" target="llm">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

describe('XML parser', () => {
  it('parses a full draw.io document', () => {
    const model = parseXml(SAMPLE)!;
    expect(model).not.toBeNull();
    expect(model.title).toBe('RAG System');
    expect(model.background).toBe('#0B1320');
    expect(model.layerIds).toEqual(['1']);
    const vertices = getVertexCells(model);
    expect(vertices).toHaveLength(2);
    const edges = getEdgeCells(model);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('user');
    expect(edges[0].target).toBe('llm');
  });

  it('preserves custom dmKind attributes', () => {
    const model = parseXml(SAMPLE)!;
    const llm = model.cells.find((c) => c.id === 'llm')!;
    expect(llm.attrs?.dmKind).toBe('ai-model');
  });

  it('round-trips an edited diagram (simulating user manual edits)', () => {
    const model = parseXml(SAMPLE)!;
    // user moved + renamed a node, changed an edge style, added a waypoint
    model.cells = model.cells.map((c) => {
      if (c.id === 'user') {
        return { ...c, value: 'End User', geometry: { ...c.geometry!, x: 999, y: 777 } };
      }
      if (c.id === 'e1') {
        return { ...c, style: 'edgeStyle=entityRelationEdgeStyle;', geometry: { ...c.geometry!, points: [{ x: 250, y: 120 }] } };
      }
      return c;
    });
    const xml = serializeModel(model);
    const reparsed = parseXml(xml)!;
    const user = reparsed.cells.find((c) => c.id === 'user')!;
    expect(user.value).toBe('End User');
    expect(user.geometry?.x).toBe(999);
    expect(user.geometry?.y).toBe(777);
    const e1 = reparsed.cells.find((c) => c.id === 'e1')!;
    expect(e1.style).toContain('entityRelationEdgeStyle');
    expect(e1.geometry?.points).toEqual([{ x: 250, y: 120 }]);
    expect(reparsed.background).toBe('#0B1320');
  });

  it('rejects malformed XML', () => {
    expect(parseXml('<mxfile><diagram>')).toBeNull();
    expect(parseXml('not xml at all')).toBeNull();
    expect(parseXml('')).toBeNull();
  });

  it('builds a semantic DiagramState the AI can read', () => {
    const model = parseXml(SAMPLE)!;
    const state = buildDiagramState(model);
    expect(state.nodes).toHaveLength(2);
    expect(state.edges).toHaveLength(1);
    expect(state.nodes.find((n) => n.id === 'llm')?.kind).toBe('ai-model');
    expect(state.title).toBe('RAG System');
  });
});
