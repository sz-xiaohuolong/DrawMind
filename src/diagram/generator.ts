import type { Cell, Geometry, Model, Point } from './types';

/**
 * Serialize a Model back to draw.io XML (lossless round-trip of user edits).
 * Unknown attributes and geometry details are preserved verbatim.
 */

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function num(v: number | undefined): string {
  return v === undefined ? '' : String(Math.round(v * 100) / 100);
}

function serializePoint(p: Point, as?: string): string {
  const asAttr = as ? ` as="${as}"` : '';
  return `<mxPoint x="${p.x}" y="${p.y}"${asAttr}/>`;
}

export function serializeGeometry(g: Geometry | undefined): string {
  if (!g) return '';
  const parts: string[] = ['<mxGeometry'];
  const attrs = { ...(g.attrs || {}) };
  const set = (k: string, v: string | undefined) => {
    if (v !== undefined && v !== '') attrs[k] = v;
  };
  set('x', num(g.x));
  set('y', num(g.y));
  set('width', num(g.width));
  set('height', num(g.height));
  set('relative', g.relative ? '1' : undefined);
  set('as', g.as || 'geometry');
  for (const [k, v] of Object.entries(attrs)) {
    parts.push(` ${k}="${escapeXmlAttr(v)}"`);
  }
  parts.push('>');
  if (g.sourcePoint) parts.push(serializePoint(g.sourcePoint, 'sourcePoint'));
  if (g.targetPoint) parts.push(serializePoint(g.targetPoint, 'targetPoint'));
  for (const p of g.points || []) parts.push(serializePoint(p, 'points'));
  parts.push('</mxGeometry>');
  return parts.join('');
}

export function serializeCell(cell: Cell, depth = 0): string {
  const pad = '  '.repeat(depth + 1);
  const parts: string[] = [`${pad}<mxCell`];
  parts.push(` id="${escapeXmlAttr(cell.id)}"`);
  if (cell.parent !== undefined) parts.push(` parent="${escapeXmlAttr(cell.parent)}"`);
  if (cell.value !== undefined) parts.push(` value="${escapeXmlAttr(cell.value)}"`);
  if (cell.style !== undefined) parts.push(` style="${escapeXmlAttr(cell.style)}"`);
  if (cell.vertex) parts.push(' vertex="1"');
  if (cell.edge) parts.push(' edge="1"');
  if (cell.source !== undefined) parts.push(` source="${escapeXmlAttr(cell.source)}"`);
  if (cell.target !== undefined) parts.push(` target="${escapeXmlAttr(cell.target)}"`);
  for (const [k, v] of Object.entries(cell.attrs || {})) {
    parts.push(` ${k}="${escapeXmlAttr(v)}"`);
  }
  const hasGeo = cell.geometry;
  const children = cell.children || [];
  if (!hasGeo && children.length === 0) {
    parts.push('/>');
    return parts.join('');
  }
  parts.push('>');
  if (hasGeo) parts.push(`\n${pad}  ` + serializeGeometry(cell.geometry));
  for (const child of children) {
    parts.push('\n' + serializeCell(child, depth + 1));
  }
  parts.push(`\n${pad}</mxCell>`);
  return parts.join('');
}

export function serializeModel(model: Model): string {
  const attrStr = (attrs: Record<string, string>) =>
    Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');

  const graphAttrs = {
    dx: '1022',
    dy: '602',
    grid: '1',
    gridSize: '10',
    guides: '1',
    tooltips: '1',
    connect: '1',
    arrows: '1',
    fold: '1',
    page: '0',
    pageScale: '1',
    pageWidth: '1920',
    pageHeight: '1080',
    math: '0',
    shadow: '0',
    ...model.graphAttrs,
  };

  const cellsXml = model.cells.map((c) => serializeCell(c)).join('\n');
  const diagramExtra = { ...model.diagramAttrs };
  delete diagramExtra.id;
  delete diagramExtra.name;
  delete diagramExtra.background;

  const diagram = `<diagram id="drawmind-page" name="${escapeXmlAttr(model.title || 'Page-1')}"${model.background ? ` background="${escapeXmlAttr(model.background)}"` : ''}${attrStr(diagramExtra)}>
    <mxGraphModel${attrStr(graphAttrs)}>
      <root>
${cellsXml}
      </root>
    </mxGraphModel>
  </diagram>`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<mxfile host="app.diagrams.net" agent="drawmind-ai-diagram-agent" version="24.0.0" type="device">`,
    `  ${diagram}`,
    `</mxfile>`,
  ].join('\n');
}

/** Serialize the <diagram> element of one page (no mxfile wrapper). */
export function serializeDiagramElement(model: Model): string {
  const attrStr = (attrs: Record<string, string>) =>
    Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');

  const graphAttrs = {
    dx: '1022',
    dy: '602',
    grid: '1',
    gridSize: '10',
    guides: '1',
    tooltips: '1',
    connect: '1',
    arrows: '1',
    fold: '1',
    page: '0',
    pageScale: '1',
    pageWidth: '1920',
    pageHeight: '1080',
    math: '0',
    shadow: '0',
    ...model.graphAttrs,
  };
  const cellsXml = model.cells.map((c) => serializeCell(c)).join('\n');
  const diagramExtra = { ...model.diagramAttrs };
  delete diagramExtra.id;
  delete diagramExtra.name;
  delete diagramExtra.background;

  return `<diagram id="drawmind-page" name="${escapeXmlAttr(model.title || 'Page-1')}"${model.background ? ` background="${escapeXmlAttr(model.background)}"` : ''}${attrStr(diagramExtra)}>
    <mxGraphModel${attrStr(graphAttrs)}>
      <root>
${cellsXml}
      </root>
    </mxGraphModel>
  </diagram>`;
}

/** Serialize a multi-page document (one <diagram> per page). */
export function serializeMultiPage(pages: Array<{ model: Model }>): string {
  const diagrams = pages.map((p) => serializeDiagramElement(p.model)).join('\n  ');
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<mxfile host="app.diagrams.net" agent="drawmind-ai-diagram-agent" version="24.0.0" type="device">`,
    `  ${diagrams}`,
    `</mxfile>`,
  ].join('\n');
}

/**
 * Serialize only a subset of cells (for incremental `merge` into the editor).
 * Includes the necessary layer parent so new cells attach correctly.
 */
export function serializeCellsFragment(cells: Cell[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<mxfile><diagram name="fragment"><mxGraphModel><root>\n${cells
    .map((c) => serializeCell(c))
    .join('\n')}\n</root></mxGraphModel></diagram></mxfile>`;
}

/** Serialize one cell (for merge). */
export function serializeCellFragment(cell: Cell): string {
  return serializeCellsFragment([cell]);
}

/** Build a blank model (matching draw.io's default structure). */
export function createBlankModel(title = 'Untitled Diagram'): Model {
  const root: Cell = { id: '0' };
  const layer: Cell = { id: '1', parent: '0' };
  return {
    cells: [root, layer],
    rootId: '0',
    layerIds: ['1'],
    title,
    diagramAttrs: {},
    graphAttrs: {},
  };
}
