import type { Cell, Geometry, Model, Point } from './types';
import { createBlankModel, serializeDiagramElement } from './generator';

/**
 * Parse draw.io XML into a lossless Cell model.
 * Uses DOMParser (native in browser, jsdom in tests).
 */

const EMPTY_MODEL: Model = {
  cells: [],
  rootId: '0',
  layerIds: [],
  title: 'Page-1',
  diagramAttrs: {},
  graphAttrs: {},
};

function isDOMParserAvailable(): boolean {
  return typeof DOMParser !== 'undefined';
}

/** Parse XML string; returns null on syntax errors. */
export function parseXmlString(xml: string): Document | null {
  if (!isDOMParserAvailable()) return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const err = doc.getElementsByTagName('parsererror');
  if (err.length > 0) return null;
  return doc;
}

function attrNum(el: Element, name: string): number | undefined {
  const v = el.getAttribute(name);
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseGeometry(el: Element): Geometry {
  const g: Geometry = {};
  const x = attrNum(el, 'x');
  const y = attrNum(el, 'y');
  const width = attrNum(el, 'width');
  const height = attrNum(el, 'height');
  if (x !== undefined) g.x = x;
  if (y !== undefined) g.y = y;
  if (width !== undefined) g.width = width;
  if (height !== undefined) g.height = height;
  const rel = el.getAttribute('relative');
  if (rel === '1') g.relative = true;
  const as = el.getAttribute('as');
  if (as) g.as = as;
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (!['x', 'y', 'width', 'height', 'relative', 'as'].includes(a.name)) {
      attrs[a.name] = a.value;
    }
  }
  if (Object.keys(attrs).length) g.attrs = attrs;
  // <mxPoint> children: sourcePoint / targetPoint / points
  const points: Point[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'mxPoint') continue;
    const px = attrNum(child, 'x') ?? 0;
    const py = attrNum(child, 'y') ?? 0;
    const childAs = child.getAttribute('as');
    if (childAs === 'sourcePoint') g.sourcePoint = { x: px, y: py };
    else if (childAs === 'targetPoint') g.targetPoint = { x: px, y: py };
    else points.push({ x: px, y: py });
  }
  if (points.length) g.points = points;
  return g;
}

function parseCell(el: Element): Cell {
  const cell: Cell = { id: el.getAttribute('id') ?? '' };
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    switch (a.name) {
      case 'id':
        break;
      case 'parent':
        cell.parent = a.value;
        break;
      case 'vertex':
        cell.vertex = a.value === '1';
        break;
      case 'edge':
        cell.edge = a.value === '1';
        break;
      case 'value':
        cell.value = a.value;
        break;
      case 'style':
        cell.style = a.value;
        break;
      case 'source':
        cell.source = a.value;
        break;
      case 'target':
        cell.target = a.value;
        break;
      default:
        attrs[a.name] = a.value;
    }
  }
  if (Object.keys(attrs).length) cell.attrs = attrs;
  const children: Cell[] = [];
  for (const child of Array.from(el.children)) {
    if (child.tagName === 'mxGeometry') {
      cell.geometry = parseGeometry(child);
    } else {
      children.push(parseCell(child));
    }
  }
  if (children.length) cell.children = children;
  return cell;
}

/** Parse a full draw.io XML document into a Model. Returns null if not parseable. */
export function parseXml(xml: string): Model | null {
  const doc = parseXmlString(xml);
  if (!doc) return null;
  return parseDocument(doc);
}

export interface ParsedPage {
  id: string;
  name: string;
  /** The raw <diagram> element serialized back to a string (lossless). */
  xml: string;
  model: Model;
}

function serializeElement(el: Element): string {
  if (typeof XMLSerializer !== 'undefined') {
    return new XMLSerializer().serializeToString(el);
  }
  return el.outerHTML;
}

/**
 * Parse a (possibly multi-page) draw.io document into pages.
 * Each page keeps its raw <diagram> element (lossless) plus a parsed Model.
 */
export function parseMultiPage(xml: string): ParsedPage[] | null {
  const doc = parseXmlString(xml);
  if (!doc) return null;
  const diagrams = Array.from(doc.getElementsByTagName('diagram'));
  if (diagrams.length === 0) {
    // plain <mxGraphModel> without <diagram> — wrap as one unnamed page
    const model = parseDocument(doc);
    if (model.cells.length === 0) return null;
    return [
      {
        id: 'page-1',
        name: model.title || '页面 1',
        xml: serializeDiagramElement(model),
        model,
      },
    ];
  }
  const pages: ParsedPage[] = diagrams.map((d, i) => {
    const name = d.getAttribute('name') || `页面 ${i + 1}`;
    const id = d.getAttribute('id') || `page-${i + 1}`;
    const xml = serializeElement(d);
    const model = parseXml(xml);
    return { id, name, xml, model: model ?? createBlankModel(name) };
  });
  return pages;
}

export function parseDocument(doc: Document): Model {
  const model: Model = { ...EMPTY_MODEL, diagramAttrs: {}, graphAttrs: {} };

  const mxfile = doc.getElementsByTagName('mxfile')[0];
  const diagram = doc.getElementsByTagName('diagram')[0];

  if (diagram) {
    model.title = diagram.getAttribute('name') || 'Page-1';
    const bg = diagram.getAttribute('background');
    if (bg) model.background = bg;
    for (const a of Array.from(diagram.attributes)) {
      if (a.name !== 'name' && a.name !== 'background') {
        model.diagramAttrs[a.name] = a.value;
      }
    }
    const graph = diagram.getElementsByTagName('mxGraphModel')[0];
    if (graph) {
      for (const a of Array.from(graph.attributes)) {
        model.graphAttrs[a.name] = a.value;
      }
      const root = graph.getElementsByTagName('root')[0];
      if (root) {
        const cells: Cell[] = [];
        for (const child of Array.from(root.children)) {
          if (child.tagName === 'mxCell') cells.push(parseCell(child));
        }
        model.cells = cells;
        // detect root + layers (in draw.io, layers are plain cells directly under root)
        const rootCell = cells.find((c) => c.id === '0');
        if (rootCell) model.rootId = '0';
        model.layerIds = cells
          .filter((c) => c.parent === '0' && c.id !== '0' && !c.edge)
          .map((c) => c.id);
        if (model.layerIds.length === 0) model.layerIds = ['1'];
      }
    }
  } else if (mxfile) {
    // mxfile without diagram tag is unusual; fall back to a blank model
    return { ...EMPTY_MODEL };
  } else {
    // Plain <mxGraphModel> (no mxfile wrapper) — used by some tools
    const graph = doc.getElementsByTagName('mxGraphModel')[0];
    if (graph) {
      const root = graph.getElementsByTagName('root')[0];
      if (root) {
        const cells: Cell[] = [];
        for (const child of Array.from(root.children)) {
          if (child.tagName === 'mxCell') cells.push(parseCell(child));
        }
        model.cells = cells;
        model.layerIds = cells
          .filter((c) => c.parent === '0' && c.id !== '0' && !c.edge)
          .map((c) => c.id);
        if (model.layerIds.length === 0) model.layerIds = ['1'];
      }
    }
  }

  return model;
}

/** Get a cell by id. */
export function findCell(model: Model, id: string): Cell | undefined {
  return model.cells.find((c) => c.id === id);
}

export function getVertexCells(model: Model): Cell[] {
  return model.cells.filter((c) => c.vertex && c.id !== '0' && c.parent && c.parent !== '0');
}

export function getEdgeCells(model: Model): Cell[] {
  return model.cells.filter((c) => c.edge);
}
