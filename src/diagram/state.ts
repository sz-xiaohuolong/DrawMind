import type { Cell, DiagramState, EdgeView, GroupView, Model, NodeKind, NodeView } from './types';
import { detectKind } from './styles';

/**
 * Build the semantic DiagramState that the AI sees from the lossless Model.
 * Invisible helper cells (ids starting with '_anchor_') are excluded.
 */

const LAYER_STYLE = 'swimlane;collapsible=0;';

export function isHelperCell(cell: Cell): boolean {
  return cell.id.startsWith('_anchor_') || cell.id.startsWith('_helper_');
}

export function isGroupCell(cell: Cell, model: Model): boolean {
  if (!cell.vertex) return false;
  const style = cell.style || '';
  if (style.includes('container=1') || style.includes('shape=swimlane')) return true;
  // A vertex is a group when other vertices point at it as parent
  return model.cells.some((c) => c.parent === cell.id && c.vertex && c.id !== cell.id);
}

function getKind(cell: Cell): NodeKind {
  const attrs = cell.attrs || {};
  if (attrs.dmKind) {
    const k = attrs.dmKind as NodeKind;
    if (k in KIND_SET) return k;
  }
  return detectKind(cell.style, cell.value ?? '');
}

const KIND_SET: Record<string, boolean> = {
  user: true,
  client: true,
  gateway: true,
  service: true,
  agent: true,
  'ai-model': true,
  database: true,
  'vector-db': true,
  cache: true,
  queue: true,
  tool: true,
  external: true,
  storage: true,
  process: true,
  decision: true,
  start: true,
  end: true,
  generic: true,
};

export function buildDiagramState(model: Model): DiagramState {
  const nodes: NodeView[] = [];
  const edges: EdgeView[] = [];
  const groups: GroupView[] = [];

  const groupIds = new Set<string>();
  const parentOf = new Map<string, string>();

  const groupCellMap = new Map<string, Cell>();
  for (const cell of model.cells) {
    if (cell.vertex && isGroupCell(cell, model)) {
      groupIds.add(cell.id);
      groupCellMap.set(cell.id, cell);
    }
  }
  for (const cell of model.cells) {
    if (cell.parent && groupIds.has(cell.parent)) parentOf.set(cell.id, cell.parent);
  }

  for (const cell of model.cells) {
    if (isHelperCell(cell)) continue;
    if (cell.vertex && groupIds.has(cell.id)) {
      const members = model.cells
        .filter((c) => c.parent === cell.id && c.vertex)
        .map((c) => c.id);
      groups.push({ id: cell.id, label: cell.value ?? '', memberIds: members });
      continue;
    }
    if (cell.vertex) {
      // Direct layer child or member of a group — both are visible semantic nodes.
      const g = cell.geometry;
      const parentGId = parentOf.get(cell.id);
      const parentGroup = parentGId ? groupCellMap.get(parentGId) : undefined;
      const groupOffsetX = parentGroup?.geometry?.x ?? 0;
      const groupOffsetY = parentGroup?.geometry?.y ?? 0;

      nodes.push({
        id: cell.id,
        label: cell.value ?? '',
        kind: getKind(cell),
        x: (g?.x ?? 0) + groupOffsetX,
        y: (g?.y ?? 0) + groupOffsetY,
        w: g?.width ?? 120,
        h: g?.height ?? 54,
        style: cell.style ?? '',
        groupId: parentGId,
      });
    } else if (cell.edge) {
      edges.push({
        id: cell.id,
        source: cell.source ?? '',
        target: cell.target ?? '',
        label: cell.value || undefined,
        style: cell.style ?? '',
      });
    }
  }

  return {
    type: inferType(nodes, edges),
    title: model.title,
    background: model.background,
    nodes,
    edges,
    groups,
  };
}

function inferType(nodes: NodeView[], edges: EdgeView[]): DiagramState['type'] {
  const kinds = nodes.map((n) => n.kind);
  const has = (k: string) => kinds.includes(k as NodeKind);
  const db = has('database') || has('vector-db') || has('storage') || has('cache');
  const ai = has('ai-model') || has('agent');
  const client = has('client') || has('user');
  if (db && ai && client && nodes.length >= 4) return 'architecture';
  if (nodes.length >= 4 && edges.length > 0 && edges.length >= nodes.length - 1) {
    // tree-ish → mindmap only when the model says so; keep heuristic conservative
    return 'generic';
  }
  return 'generic';
}

export { LAYER_STYLE };
