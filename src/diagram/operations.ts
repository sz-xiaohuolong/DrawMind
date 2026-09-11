import type {
  Cell,
  DiagramOperation,
  DiagramType,
  Model,
  NodeKind,
  LayoutMode,
  LayoutDirection,
} from './types';
import { styleForKind, sizeForKind, EDGE_STYLE } from './styles';
import { createBlankModel } from './generator';

/**
 * Operation validator + applier.
 *
 * The LLM never emits raw XML or coordinates for the whole graph — it emits a
 * small, validated set of incremental operations. This module:
 *   1. validates each op against the current model (ids, refs, injection guards)
 *   2. applies them to the lossless Cell model without touching unrelated cells
 *   3. reports which ops were applied / rejected
 */

export interface ApplyResult {
  model: Model;
  applied: string[];
  rejected: string[];
  addedNodeIds: string[];
  changedCellIds: string[];
  hasLayoutOp: boolean;
  layoutOp?: { mode: LayoutMode; direction: LayoutDirection; force: boolean };
  title?: string;
  background?: string;
  cleared: boolean;
}

const MAX_LABEL = 240;
const VALID_OPERATIONS = new Set([
  'add_node',
  'delete_node',
  'update_node',
  'rename_node',
  'move_node',
  'add_edge',
  'delete_edge',
  'update_edge',
  'change_style',
  'change_layout',
  'add_group',
  'add_node_to_group',
  'set_title',
  'set_background',
  'clear',
]);

const VALID_KINDS = new Set([
  'user',
  'client',
  'gateway',
  'service',
  'agent',
  'ai-model',
  'database',
  'vector-db',
  'cache',
  'queue',
  'tool',
  'external',
  'storage',
  'process',
  'decision',
  'start',
  'end',
  'generic',
]);

const VALID_LAYOUT_MODES = new Set(['auto', 'flowchart', 'architecture', 'mindmap', 'sequence', 'manual']);
const VALID_DIRECTIONS = new Set(['LR', 'TB', 'RL', 'BT']);

function safeLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const cleaned = String(label)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (cleaned.length === 0) return undefined;
  return cleaned.slice(0, MAX_LABEL);
}

function normalizeId(id: string | undefined, fallback: string): string {
  const s = (id || '').trim();
  if (!s) return fallback;
  // keep kebab-case ids, sanitize everything else
  return s.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let i = 1;
  while (used.has(id)) {
    id = `${base}-${i}`;
    i++;
  }
  return id;
}

export function isKnownOperation(op: unknown): op is DiagramOperation {
  return (
    typeof op === 'object' &&
    op !== null &&
    VALID_OPERATIONS.has((op as DiagramOperation).operation)
  );
}

export interface ValidationOutcome {
  ops: DiagramOperation[];
  rejected: string[];
  warnings: string[];
}

/** Validate a batch of operations against the current model. */
export function validateOperations(ops: DiagramOperation[], model: Model): ValidationOutcome {
  const accepted: DiagramOperation[] = [];
  const rejected: string[] = [];
  const warnings: string[] = [];

  const existingIds = new Set(model.cells.map((c) => c.id));
  const newIds = new Set<string>();

  const record = (op: DiagramOperation, reason: string) => {
    rejected.push(`${op.operation}(${(op as { id?: string }).id ?? ''}): ${reason}`);
  };

  for (const raw of ops) {
    if (!isKnownOperation(raw)) {
      rejected.push(`${String((raw as { operation?: string }).operation ?? 'unknown')}: unsupported operation`);
      continue;
    }
    const op = raw;

    switch (op.operation) {
      case 'add_node': {
        const label = safeLabel(op.label);
        if (!label) {
          record(op, 'label is empty');
          continue;
        }
        const id = normalizeId(op.id, `node-${existingIds.size + newIds.size + 1}`);
        if (existingIds.has(id) || newIds.has(id)) {
          warnings.push(`add_node(${id}): id already exists, renaming`);
        }
        if (op.kind && !VALID_KINDS.has(op.kind)) {
          warnings.push(`add_node(${id}): unknown kind "${op.kind}", using generic`);
        }
        newIds.add(id);
        accepted.push({ ...op, id, label, kind: op.kind && VALID_KINDS.has(op.kind) ? op.kind : 'generic' });
        break;
      }
      case 'add_edge': {
        const src = normalizeId(op.source, '');
        const tgt = normalizeId(op.target, '');
        const sourceExists = existingIds.has(src) || newIds.has(src);
        const targetExists = existingIds.has(tgt) || newIds.has(tgt);
        if (!sourceExists || !targetExists) {
          record(op, `source "${op.source}" or target "${op.target}" does not exist`);
          continue;
        }
        const id = normalizeId(op.id, `edge-${existingIds.size + newIds.size + 1}`);
        if (existingIds.has(id) || newIds.has(id)) {
          warnings.push(`add_edge(${id}): id already exists, renaming`);
        }
        newIds.add(id);
        accepted.push({ ...op, id, source: src, target: tgt, label: safeLabel(op.label) });
        break;
      }
      case 'delete_node':
      case 'update_node':
      case 'rename_node':
      case 'move_node':
      case 'change_style':
      case 'delete_edge':
      case 'update_edge': {
        const id = normalizeId(op.id, '');
        if (!existingIds.has(id)) {
          record(op, `id "${op.id}" does not exist`);
          continue;
        }
        if (op.operation === 'rename_node' || op.operation === 'update_node') {
          if (op.operation === 'rename_node' && !safeLabel(op.label)) {
            record(op, 'label is empty');
            continue;
          }
          if (op.operation === 'update_node' && op.label !== undefined && !safeLabel(op.label)) {
            record(op, 'label is empty');
            continue;
          }
        }
        if (op.operation === 'move_node' && (!Number.isFinite(op.x) || !Number.isFinite(op.y))) {
          record(op, 'invalid coordinates');
          continue;
        }
        if (op.operation === 'change_style' && !op.style) {
          record(op, 'style is empty');
          continue;
        }
        if (op.operation === 'update_edge' && op.source !== undefined && !existingIds.has(op.source)) {
          record(op, `new source "${op.source}" does not exist`);
          continue;
        }
        if (op.operation === 'update_edge' && op.target !== undefined && !existingIds.has(op.target)) {
          record(op, `new target "${op.target}" does not exist`);
          continue;
        }
        accepted.push(op);
        break;
      }
      case 'change_layout': {
        const mode = op.layout && VALID_LAYOUT_MODES.has(op.layout) ? op.layout : 'auto';
        const direction = op.direction && VALID_DIRECTIONS.has(op.direction) ? op.direction : undefined;
        accepted.push({ ...op, layout: mode, direction });
        break;
      }
      case 'add_group': {
        const id = normalizeId(op.id, `group-${existingIds.size + newIds.size + 1}`);
        if (existingIds.has(id) || newIds.has(id)) {
          warnings.push(`add_group(${id}): id already exists, renaming`);
        }
        newIds.add(id);
        accepted.push({ ...op, id, label: safeLabel(op.label) ?? 'Group', memberIds: op.memberIds ?? [] });
        break;
      }
      case 'add_node_to_group': {
        if (!existingIds.has(op.groupId) && !newIds.has(op.groupId)) {
          record(op, `group "${op.groupId}" does not exist`);
          continue;
        }
        if (!existingIds.has(op.nodeId) && !newIds.has(op.nodeId)) {
          record(op, `node "${op.nodeId}" does not exist`);
          continue;
        }
        accepted.push(op);
        break;
      }
      case 'set_title': {
        const t = safeLabel(op.title);
        if (!t) {
          record(op, 'title is empty');
          continue;
        }
        accepted.push({ ...op, title: t });
        break;
      }
      case 'set_background': {
        if (!/^#[0-9a-fA-F]{3,8}$/.test(op.color)) {
          record(op, `invalid color "${op.color}"`);
          continue;
        }
        accepted.push(op);
        break;
      }
      case 'clear':
        accepted.push(op);
        break;
    }
  }

  return { ops: accepted, rejected, warnings };
}

function createNodeCell(
  id: string,
  label: string,
  kind: NodeKind,
  style: string | undefined,
  parent: string,
  group?: string,
): Cell {
  const size = sizeForKind(kind);
  const cell: Cell = {
    id,
    parent: group ?? parent,
    vertex: true,
    value: label,
    style: style && style.trim() ? style : styleForKind(kind),
    geometry: { x: 0, y: 0, width: size.w, height: size.h },
    attrs: { dmKind: kind },
  };
  return cell;
}

const GROUP_STYLE =
  'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#2C3D5C;dashed=1;verticalAlign=top;align=left;fontColor=#AEBBD0;fontSize=12;container=1;collapsible=0;';

/** Apply a validated batch of operations. Assumes ops were already validated. */
export function applyOperations(model: Model, ops: DiagramOperation[]): ApplyResult {
  let cells = [...model.cells];
  const applied: string[] = [];
  const rejected: string[] = [];
  const addedNodeIds: string[] = [];
  const changedCellIds = new Set<string>();
  const layerId = model.layerIds[0] ?? '1';
  let hasLayoutOp = false;
  let layoutOp: ApplyResult['layoutOp'];
  let title = model.title;
  let background = model.background;
  let cleared = false;

  const used = new Set(cells.map((c) => c.id));
  const find = (id: string) => cells.find((c) => c.id === id);

  const addCell = (cell: Cell) => {
    cell.id = uniqueId(cell.id, used);
    used.add(cell.id);
    cells.push(cell);
    return cell;
  };

  // Pass 1: structural additions (nodes, groups)
  for (const op of ops) {
    if (op.operation === 'add_node') {
      const cell = createNodeCell(op.id, op.label, op.kind ?? 'generic', op.style, layerId, op.group);
      const created = addCell(cell);
      addedNodeIds.push(created.id);
      changedCellIds.add(created.id);
      applied.push(`add_node(${created.id})`);
    } else if (op.operation === 'add_group') {
      const gid = uniqueId(op.id, used);
      used.add(gid);
      const group: Cell = {
        id: gid,
        parent: layerId,
        vertex: true,
        value: op.label,
        style: GROUP_STYLE,
        geometry: { x: 0, y: 0, width: 300, height: 200 },
        attrs: { dmKind: 'generic', dmGroup: '1' },
      };
      cells.push(group);
      changedCellIds.add(gid);
      applied.push(`add_group(${gid})`);
      for (const memberId of op.memberIds ?? []) {
        const member = find(memberId);
        if (member && member.vertex) {
          cells = cells.map((c) => (c.id === memberId ? { ...c, parent: gid } : c));
          changedCellIds.add(memberId);
        }
      }
    }
  }

  // Pass 2: edges
  for (const op of ops) {
    if (op.operation === 'add_edge') {
      const edge: Cell = {
        id: op.id,
        parent: layerId,
        edge: true,
        source: op.source,
        target: op.target,
        value: op.label,
        style: EDGE_STYLE,
        geometry: { relative: true },
        attrs: op.label ? { dmEdgeLabel: '1' } : undefined,
      };
      const created = addCell(edge);
      changedCellIds.add(created.id);
      applied.push(`add_edge(${created.id})`);
    }
  }

  // Pass 3: everything else, in order
  for (const op of ops) {
    switch (op.operation) {
      case 'delete_node': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`delete_node(${op.id}): not found`);
          break;
        }
        cells = cells.filter(
          (c) =>
            c.id !== op.id &&
            !(c.edge && (c.source === op.id || c.target === op.id)) &&
            c.parent !== op.id,
        );
        changedCellIds.add(op.id);
        applied.push(`delete_node(${op.id})`);
        break;
      }
      case 'update_node': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`update_node(${op.id}): not found`);
          break;
        }
        const next: Cell = { ...target };
        if (op.label !== undefined) next.value = op.label;
        if (op.kind && VALID_KINDS.has(op.kind)) {
          next.style = styleForKind(op.kind);
          next.attrs = { ...(next.attrs || {}), dmKind: op.kind };
        }
        if (op.style !== undefined && op.style.trim()) next.style = op.style.trim();
        cells = cells.map((c) => (c.id === op.id ? next : c));
        changedCellIds.add(op.id);
        applied.push(`update_node(${op.id})`);
        break;
      }
      case 'rename_node': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`rename_node(${op.id}): not found`);
          break;
        }
        cells = cells.map((c) => (c.id === op.id ? { ...c, value: op.label } : c));
        changedCellIds.add(op.id);
        applied.push(`rename_node(${op.id})`);
        break;
      }
      case 'move_node': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`move_node(${op.id}): not found`);
          break;
        }
        const geometry = { ...(target.geometry || {}) };
        geometry.x = op.x;
        geometry.y = op.y;
        cells = cells.map((c) =>
          c.id === op.id
            ? { ...c, geometry, attrs: { ...(c.attrs || {}), dmManual: '1' } }
            : c,
        );
        changedCellIds.add(op.id);
        applied.push(`move_node(${op.id})`);
        break;
      }
      case 'delete_edge': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`delete_edge(${op.id}): not found`);
          break;
        }
        cells = cells.filter((c) => c.id !== op.id);
        changedCellIds.add(op.id);
        applied.push(`delete_edge(${op.id})`);
        break;
      }
      case 'update_edge': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`update_edge(${op.id}): not found`);
          break;
        }
        const next: Cell = { ...target };
        if (op.source !== undefined) next.source = op.source;
        if (op.target !== undefined) next.target = op.target;
        if (op.label !== undefined) next.value = op.label;
        cells = cells.map((c) => (c.id === op.id ? next : c));
        changedCellIds.add(op.id);
        applied.push(`update_edge(${op.id})`);
        break;
      }
      case 'change_style': {
        const target = find(op.id);
        if (!target) {
          rejected.push(`change_style(${op.id}): not found`);
          break;
        }
        cells = cells.map((c) => (c.id === op.id ? { ...c, style: op.style } : c));
        changedCellIds.add(op.id);
        applied.push(`change_style(${op.id})`);
        break;
      }
      case 'add_node_to_group': {
        const member = find(op.nodeId);
        const group = find(op.groupId);
        if (!member || !group) {
          rejected.push(`add_node_to_group(${op.nodeId}->${op.groupId}): missing cell`);
          break;
        }
        cells = cells.map((c) => (c.id === op.nodeId ? { ...c, parent: op.groupId } : c));
        changedCellIds.add(op.nodeId);
        applied.push(`add_node_to_group(${op.nodeId}->${op.groupId})`);
        break;
      }
      case 'set_title': {
        title = op.title;
        applied.push(`set_title(${op.title})`);
        break;
      }
      case 'set_background': {
        background = op.color;
        applied.push(`set_background(${op.color})`);
        break;
      }
      case 'clear': {
        cells = createBlankModel(model.title).cells;
        cleared = true;
        applied.push('clear');
        break;
      }
      case 'change_layout': {
        hasLayoutOp = true;
        layoutOp = {
          mode: op.layout ?? 'auto',
          direction: op.direction ?? 'LR',
          force: op.force ?? false,
        };
        applied.push(`change_layout(${op.layout ?? 'auto'},${op.direction ?? 'LR'})`);
        break;
      }
      default:
        break;
    }
  }

  // Expand group geometry to cover members after all membership changes
  cells = expandGroups(cells);

  return {
    model: { ...model, cells, title, background },
    applied,
    rejected,
    addedNodeIds,
    changedCellIds: [...changedCellIds],
    hasLayoutOp,
    layoutOp,
    title,
    background,
    cleared,
  };
}

/** Resize container cells to the bounding box of their members. */
function expandGroups(cells: Cell[]): Cell[] {
  const groups = cells.filter((c) => c.vertex && (c.attrs?.dmGroup === '1' || (c.style ?? '').includes('container=1')));
  if (groups.length === 0) return cells;
  let next = [...cells];
  for (const group of groups) {
    const members = next.filter((c) => c.parent === group.id && c.vertex);
    if (members.length === 0) continue;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let hasGeo = false;
    for (const m of members) {
      const g = m.geometry;
      if (!g || g.x === undefined || g.y === undefined || !g.width || !g.height) continue;
      hasGeo = true;
      minX = Math.min(minX, g.x);
      minY = Math.min(minY, g.y);
      maxX = Math.max(maxX, g.x + g.width);
      maxY = Math.max(maxY, g.y + g.height);
    }
    if (!hasGeo) continue;
    const pad = 40;
    next = next.map((c) =>
      c.id === group.id
        ? {
            ...c,
            geometry: {
              x: Math.floor(minX - pad),
              y: Math.floor(minY - pad - 16),
              width: Math.ceil(maxX - minX + pad * 2),
              height: Math.ceil(maxY - minY + pad * 2 + 16),
            },
          }
        : c,
    );
  }
  return next;
}

/** Resolve 'auto' layout mode using the diagram type. */
export function resolveAutoMode(mode: LayoutMode, diagramType: DiagramType): Exclude<LayoutMode, 'auto'> {
  if (mode !== 'auto') return mode as Exclude<LayoutMode, 'auto'>;
  switch (diagramType) {
    case 'architecture':
      return 'architecture';
    case 'mindmap':
      return 'mindmap';
    case 'sequence':
      return 'sequence';
    case 'flowchart':
      return 'flowchart';
    default:
      return 'flowchart';
  }
}

export { safeLabel, normalizeId };
