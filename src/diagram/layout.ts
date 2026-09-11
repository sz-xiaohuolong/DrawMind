import type { Cell, LayoutDirection, LayoutMode, Model, Point } from './types';
import { detectKind, sizeForKind } from './styles';
import { buildDiagramState } from './state';

/**
 * Deterministic auto-layout (zero runtime dependencies).
 *  - flowchart / architecture: longest-path layered layout (TB / LR)
 *  - mindmap: tree layout from the root, children to the right
 *  - sequence: participant lifelines + staggered message rows
 *
 * Nodes marked dmManual=1 (user or AI moved them) are kept in place
 * unless force=true.
 */

export interface LayoutOpts {
  /** 'manual' = keep current positions (no-op). */
  mode: LayoutMode;
  direction?: LayoutDirection;
  force?: boolean;
}

export const LAYOUT_GAP = 60;
export const COLUMN_GAP = 100;
export const MARGIN = 60;
export const COMPONENT_GAP = 80;
export const GROUP_EXTRA_GAP = 45;

interface Bounds {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function cellBounds(cell: Cell): Bounds {
  const g = cell.geometry;
  const size = sizeForKind(detectKind(cell.style, cell.value ?? ''));
  return {
    id: cell.id,
    x: g?.x ?? 0,
    y: g?.y ?? 0,
    w: g?.width ?? size.w,
    h: g?.height ?? size.h,
  };
}

function setCellPosition(cell: Cell, x: number, y: number): Cell {
  const geometry = cell.geometry ? { ...cell.geometry } : {};
  geometry.x = Math.round(x);
  geometry.y = Math.round(y);
  if (!geometry.relative) {
    geometry.width = geometry.width ?? sizeForKind(detectKind(cell.style, cell.value ?? '')).w;
    geometry.height = geometry.height ?? sizeForKind(detectKind(cell.style, cell.value ?? '')).h;
  }
  return { ...cell, geometry };
}

function isManual(cell: Cell): boolean {
  return (cell.attrs?.dmManual ?? '0') === '1';
}

export function isGroupCell(cell: Cell): boolean {
  return (
    (cell.attrs?.dmGroup === '1') ||
    (cell.style ?? '').includes('swimlane') ||
    (cell.style ?? '').includes('container=1')
  );
}

/**
 * Longest-path layering for DAGs:
 * layer[v] = max(layer[u] + 1) over in-edges (u -> v).
 * Strictly preserves topological order and prevents reverse/intra-layer edges.
 */
function layerize(nodes: Bounds[], edges: { source: string; target: string }[]): Map<string, number> {
  const layer = new Map<string, number>();
  const inEdges = new Map<string, string[]>();
  for (const n of nodes) {
    layer.set(n.id, 0);
    inEdges.set(n.id, []);
  }
  for (const e of edges) {
    if (!inEdges.has(e.source) || !inEdges.has(e.target)) continue;
    inEdges.get(e.target)!.push(e.source);
  }
  let changed = true;
  let iter = 0;
  const maxIter = Math.min(nodes.length * 2 + 10, 60);
  while (changed && iter < maxIter) {
    changed = false;
    iter++;
    for (const n of nodes) {
      const parents = inEdges.get(n.id) ?? [];
      if (parents.length === 0) continue;
      let maxParentLayer = -1;
      for (const p of parents) {
        const lp = layer.get(p) ?? 0;
        if (lp > maxParentLayer) maxParentLayer = lp;
      }
      const targetLayer = maxParentLayer + 1;
      if (targetLayer > (layer.get(n.id) ?? 0)) {
        layer.set(n.id, targetLayer);
        changed = true;
      }
    }
  }
  return layer;
}

/** Layout a single connected component with barycenter node ordering */
function layoutComponent(
  nodes: Bounds[],
  edges: { source: string; target: string }[],
  direction: LayoutDirection,
  originMain: number,
  originCross: number,
  nodeToGroup: Map<string, string>,
): { positions: Map<string, Point>; mainSize: number; crossSize: number } {
  const layer = layerize(nodes, edges);
  const hasEdge = (id: string) => edges.some((e) => e.source === id || e.target === id);
  let maxLayer = 0;
  for (const v of layer.values()) maxLayer = Math.max(maxLayer, v);
  for (const n of nodes) {
    if (!hasEdge(n.id)) layer.set(n.id, ++maxLayer);
  }

  const byLayer = new Map<number, Bounds[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const arr = byLayer.get(l) ?? [];
    arr.push(n);
    byLayer.set(l, arr);
  }

  const inMap = new Map<string, string[]>();
  for (const n of nodes) inMap.set(n.id, []);
  for (const e of edges) {
    if (inMap.has(e.target)) inMap.get(e.target)!.push(e.source);
  }

  const positions = new Map<string, Point>();
  const isLR = direction === 'LR' || direction === 'RL';
  const layersArr = [...byLayer.entries()].sort((a, b) => a[0] - b[0]);

  let cursorMain = originMain;
  let maxCrossSeen = 0;

  for (let idx = 0; idx < layersArr.length; idx++) {
    const [, arr] = layersArr[idx];

    // Sort nodes in this layer by their incoming parents' average cross position
    if (idx > 0) {
      arr.sort((a, b) => {
        const pA = inMap.get(a.id) ?? [];
        const pB = inMap.get(b.id) ?? [];
        const avgA =
          pA.length > 0
            ? pA.reduce((sum, pid) => sum + (isLR ? (positions.get(pid)?.y ?? 0) : (positions.get(pid)?.x ?? 0)), 0) /
              pA.length
            : Infinity;
        const avgB =
          pB.length > 0
            ? pB.reduce((sum, pid) => sum + (isLR ? (positions.get(pid)?.y ?? 0) : (positions.get(pid)?.x ?? 0)), 0) /
              pB.length
            : Infinity;
        return avgA - avgB;
      });
    }

    const colWidth = Math.max(...arr.map((n) => (isLR ? n.w : n.h)));
    let currentCross = originCross;
    let prevGroupId: string | undefined;

    for (const n of arr) {
      const currGroupId = nodeToGroup.get(n.id);
      if (prevGroupId !== undefined && currGroupId !== prevGroupId) {
        currentCross += GROUP_EXTRA_GAP;
      }
      prevGroupId = currGroupId;

      const parents = inMap.get(n.id) ?? [];
      let desiredCross = currentCross;
      if (parents.length > 0) {
        const parentCrosses = parents
          .map((pid) => (isLR ? positions.get(pid)?.y : positions.get(pid)?.x))
          .filter((v): v is number => v !== undefined);
        if (parentCrosses.length > 0) {
          const avg = parentCrosses.reduce((s, v) => s + v, 0) / parentCrosses.length;
          desiredCross = Math.max(currentCross, avg);
        }
      }
      const crossPos = desiredCross;

      if (isLR) {
        positions.set(n.id, { x: cursorMain, y: crossPos });
        currentCross = crossPos + n.h + LAYOUT_GAP;
        maxCrossSeen = Math.max(maxCrossSeen, currentCross - originCross);
      } else {
        positions.set(n.id, { x: crossPos, y: cursorMain });
        currentCross = crossPos + n.w + LAYOUT_GAP;
        maxCrossSeen = Math.max(maxCrossSeen, currentCross - originCross);
      }
    }

    cursorMain += colWidth + (isLR ? COLUMN_GAP : LAYOUT_GAP);
  }

  const mainSize = cursorMain - originMain;
  const crossSize = maxCrossSeen;
  return { positions, mainSize, crossSize };
}

function findWeaklyConnectedComponents(
  nodes: Bounds[],
  edges: { source: string; target: string }[],
  nodeToGroup: Map<string, string>,
): Bounds[][] {
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.add(e.target);
      adj.get(e.target)!.add(e.source);
    }
  }
  // Nodes in the same group must belong to the same component
  const groupMembers = new Map<string, string[]>();
  for (const [nId, gId] of nodeToGroup.entries()) {
    const arr = groupMembers.get(gId) ?? [];
    arr.push(nId);
    groupMembers.set(gId, arr);
  }
  for (const members of groupMembers.values()) {
    for (let i = 0; i < members.length - 1; i++) {
      const a = members[i],
        b = members[i + 1];
      if (adj.has(a) && adj.has(b)) {
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
  }

  const visited = new Set<string>();
  const components: Bounds[][] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const comp: Bounds[] = [];
    const queue = [n.id];
    visited.add(n.id);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(nodeMap.get(curr)!);
      for (const neighbor of adj.get(curr) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(comp);
  }

  return components;
}

/** Layered layout; columns for LR, rows for TB. Separates independent subgraphs into distinct bands. */
function layered(
  nodes: Bounds[],
  edges: { source: string; target: string }[],
  direction: LayoutDirection,
  nodeToGroup: Map<string, string>,
): Map<string, Point> {
  const components = findWeaklyConnectedComponents(nodes, edges, nodeToGroup);
  const allPositions = new Map<string, Point>();
  let currentCross = MARGIN;

  for (const comp of components) {
    const compIds = new Set(comp.map((n) => n.id));
    const compEdges = edges.filter((e) => compIds.has(e.source) && compIds.has(e.target));
    const { positions, crossSize } = layoutComponent(
      comp,
      compEdges,
      direction,
      MARGIN,
      currentCross,
      nodeToGroup,
    );
    for (const [id, pt] of positions.entries()) {
      allPositions.set(id, pt);
    }
    currentCross += crossSize + COMPONENT_GAP;
  }

  return allPositions;
}

/** Mind map: tree from root, root at left, children fan out right. */
function mindmap(nodes: Bounds[], edges: { source: string; target: string }[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  const out = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    out.set(n.id, []);
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (!out.has(e.source) || !out.has(e.target)) continue;
    out.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  let root = nodes.find((n) => (inDegree.get(n.id) ?? 0) === 0);
  if (!root) root = nodes[0];
  if (!root) return positions;

  const H_GAP = 90;
  const V_GAP = 24;

  // subtree height by post-order DFS (cycle-safe)
  const subH = new Map<string, number>();
  const visited = new Set<string>();
  const stack: string[] = [root.id];
  const order: string[] = [];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const c of out.get(id) ?? []) stack.push(c);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const children = (out.get(id) ?? []).filter((c) => visited.has(c));
    if (children.length === 0) {
      subH.set(id, nodes.find((n) => n.id === id)?.h ?? 54);
    } else {
      const sum = children.reduce((acc, c) => acc + (subH.get(c) ?? 54) + V_GAP, 0) - V_GAP;
      subH.set(id, Math.max(sum, nodes.find((n) => n.id === id)?.h ?? 54));
    }
  }

  const totalH = subH.get(root.id) ?? 54;
  const rootNode = nodes.find((n) => n.id === root.id)!;
  positions.set(root.id, { x: MARGIN, y: MARGIN + (totalH - rootNode.h) / 2 });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const assign = (id: string, x: number, topY: number): number => {
    const node = byId.get(id);
    if (!node) return topY;
    const children = (out.get(id) ?? []).filter((c) => visited.has(c) && !positions.has(c));
    if (children.length === 0) {
      positions.set(id, { x, y: topY });
      return topY + node.h + V_GAP;
    }
    let childTop = topY;
    for (const c of children) {
      childTop = assign(c, x + node.w + H_GAP, childTop);
    }
    const blockH = childTop - topY - V_GAP;
    positions.set(id, { x, y: topY + (blockH - node.h) / 2 });
    return childTop;
  };
  assign(root.id, MARGIN, MARGIN + (totalH - rootNode.h) / 2);

  // Unreachable nodes: stack to the right of the tree.
  const placed = new Set(positions.keys());
  const treeW = Math.max(...nodes.filter((n) => placed.has(n.id)).map((n) => (positions.get(n.id)?.x ?? 0) + n.w), 0);
  let yy = MARGIN;
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    positions.set(n.id, { x: treeW + COLUMN_GAP, y: yy });
    yy += n.h + LAYOUT_GAP;
  }
  return positions;
}

/** Sequence: participant boxes on top, staggered message rows, lifelines. */
export function layoutSequence(
  model: Model,
  nodes: Bounds[],
  edges: { id: string; source: string; target: string }[],
): { positions: Map<string, Point>; edgeStyles: Map<string, string>; anchors: Cell[]; anchorEdges: Cell[] } {
  const positions = new Map<string, Point>();
  const edgeStyles = new Map<string, string>();
  const anchors: Cell[] = [];
  const anchorEdges: Cell[] = [];
  if (nodes.length === 0) return { positions, edgeStyles, anchors, anchorEdges };

  const HEAD_H = 54;
  const gapX = 150;
  let x = MARGIN;
  const laneX = new Map<string, number>();
  for (const n of nodes) {
    laneX.set(n.id, x);
    positions.set(n.id, { x, y: MARGIN });
    x += n.w + gapX;
  }

  const rowY = (idx: number) => MARGIN + HEAD_H + 90 + idx * 64;
  edges.forEach((e, idx) => {
    const sy = rowY(idx) - (MARGIN + HEAD_H);
    edgeStyles.set(
      e.id,
      `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#7C8DB0;strokeWidth=1.5;fontColor=#94A3B8;fontSize=12;exitX=0.5;exitY=1;exitDx=0;exitDy=${sy};entryX=0.5;entryY=1;entryDx=0;entryDy=${sy};`,
    );
  });

  const bottomY = (edges.length > 0 ? rowY(edges.length - 1) : MARGIN + HEAD_H) + 100;
  for (const n of nodes) {
    const cx = (laneX.get(n.id) ?? 0) + n.w / 2;
    const anchorId = `_anchor_${n.id}`;
    anchors.push({
      id: anchorId,
      parent: model.layerIds[0] ?? '1',
      vertex: true,
      style: 'opacity=0;fillColor=none;strokeColor=none;pointerEvents=0;',
      geometry: { x: cx - 4, y: bottomY, width: 8, height: 8 },
      attrs: { dmHelper: '1' },
    });
    anchorEdges.push({
      id: `_lifeline_${n.id}`,
      parent: model.layerIds[0] ?? '1',
      edge: true,
      source: n.id,
      target: anchorId,
      style:
        'endArrow=none;dashed=1;html=1;strokeColor=#3B4A66;strokeWidth=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;',
      geometry: { relative: true },
      attrs: { dmHelper: '1' },
    });
  }
  return { positions, edgeStyles, anchors, anchorEdges };
}

export function postProcessGroups(
  model: Model,
  absolutePositions: Map<string, Point>,
  movableIds: Set<string>,
): Model {
  const groups = model.cells.filter((c) => c.vertex && isGroupCell(c));
  const groupDim = new Map<string, { x: number; y: number; w: number; h: number }>();
  const relPositions = new Map<string, Point>(absolutePositions);

  for (const g of groups) {
    const members = model.cells.filter((c) => c.parent === g.id && c.vertex);
    if (members.length === 0) continue;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const m of members) {
      const p = absolutePositions.get(m.id) ?? { x: m.geometry?.x ?? 0, y: m.geometry?.y ?? 0 };
      const b = cellBounds(m);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + b.w);
      maxY = Math.max(maxY, p.y + b.h);
    }
    const padX = 25;
    const padTop = 35;
    const padBottom = 20;
    const gx = Math.round(minX - padX);
    const gy = Math.round(minY - padTop);
    const gw = Math.round(maxX - minX + 2 * padX);
    const gh = Math.round(maxY - minY + padTop + padBottom);
    groupDim.set(g.id, { x: gx, y: gy, w: gw, h: gh });

    for (const m of members) {
      const p = absolutePositions.get(m.id) ?? { x: m.geometry?.x ?? 0, y: m.geometry?.y ?? 0 };
      relPositions.set(m.id, { x: p.x - gx, y: p.y - gy });
    }
  }

  const cells = model.cells.map((cell) => {
    if (groupDim.has(cell.id)) {
      const d = groupDim.get(cell.id)!;
      const g = cell.geometry ? { ...cell.geometry } : {};
      g.x = d.x;
      g.y = d.y;
      g.width = d.w;
      g.height = d.h;
      return { ...cell, geometry: g };
    }
    const p = relPositions.get(cell.id);
    if (p && cell.vertex && movableIds.has(cell.id)) {
      return setCellPosition(cell, p.x, p.y);
    }
    return cell;
  });

  return { ...model, cells };
}

/**
 * Full layout of a model. Returns a new model with positioned cells.
 * Nodes marked dmManual=1 are untouched unless force=true.
 */
export function layoutModel(model: Model, opts: LayoutOpts): Model {
  if (opts.mode === 'manual') return model;
  const groups = model.cells.filter((c) => c.vertex && isGroupCell(c));
  const nodes = model.cells.filter(
    (c) =>
      c.vertex &&
      c.parent &&
      c.parent !== '0' &&
      !isGroupCell(c) &&
      !c.id.startsWith('_anchor_') &&
      !c.id.startsWith('_lifeline_'),
  );
  const edges = model.cells.filter((c) => c.edge && !c.id.startsWith('_lifeline_'));
  const mode = opts.mode === 'auto' ? 'flowchart' : opts.mode;
  const direction = opts.direction ?? (mode === 'architecture' ? 'LR' : mode === 'mindmap' ? 'LR' : 'TB');

  const bounds = nodes.map(cellBounds);
  const edgeRefs = edges.map((e) => ({ id: e.id, source: e.source ?? '', target: e.target ?? '' }));
  const movable = nodes.filter((n) => opts.force || !isManual(n));
  const movableIds = new Set(movable.map((n) => n.id));

  const nodeToGroup = new Map<string, string>();
  for (const g of groups) {
    for (const c of model.cells) {
      if (c.parent === g.id && c.vertex) {
        nodeToGroup.set(c.id, g.id);
      }
    }
  }

  let positions = new Map<string, Point>();
  let edgeStyles = new Map<string, string>();
  let anchors: Cell[] = [];
  let anchorEdges: Cell[] = [];

  if (mode === 'mindmap') {
    positions = mindmap(bounds, edgeRefs);
  } else if (mode === 'sequence') {
    const r = layoutSequence(model, bounds, edgeRefs);
    positions = r.positions;
    edgeStyles = r.edgeStyles;
    anchors = r.anchors;
    anchorEdges = r.anchorEdges;
  } else {
    positions = layered(bounds, edgeRefs, direction, nodeToGroup);
  }

  let nextModel: Model = {
    ...model,
    cells: model.cells.map((cell) => {
      if (cell.edge) {
        const style = edgeStyles.get(cell.id);
        if (style) return { ...cell, style };
        if (mode === 'mindmap' && cell.source && cell.target) {
          return { ...cell, style: MINDMAP_SIDE_EDGE_STYLE };
        }
      }
      return cell;
    }),
  };

  nextModel = postProcessGroups(nextModel, positions, movableIds);

  if (mode === 'sequence') {
    nextModel = { ...nextModel, cells: [...nextModel.cells, ...anchors, ...anchorEdges] };
  }
  return nextModel;
}

const MINDMAP_SIDE_EDGE_STYLE =
  'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#64748B;strokeWidth=1.5;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;';

/**
 * Place newly added nodes without moving existing ones (incremental edit).
 * New node with edges → next to its source (or before its target).
 * Isolated new node → appended to the right, top-aligned to the last row.
 */
export function layoutNewNodes(model: Model, newNodeIds: string[], direction: LayoutDirection = 'LR'): Model {
  if (newNodeIds.length === 0) return model;
  const edges = model.cells.filter((c) => c.edge);

  // Use buildDiagramState to get absolute coordinates for existing nodes
  const state = buildDiagramState(model);
  const byId = new Map(state.nodes.map((n) => [n.id, { ...n }]));

  const occupied: Array<{ x: number; y: number; w: number; h: number }> = state.nodes
    .filter((b) => !newNodeIds.includes(b.id))
    .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));

  const collides = (x: number, y: number, w: number, h: number) =>
    occupied.some(
      (o) => x < o.x + o.w + 20 && x + w + 20 > o.x && y < o.y + o.h + 20 && y + h + 20 > o.y,
    );

  const place = (desiredX: number, desiredY: number, w: number, h: number) => {
    let x = Math.max(MARGIN, Math.round(desiredX));
    let y = Math.max(MARGIN, Math.round(desiredY));
    let attempts = 0;
    while (collides(x, y, w, h) && attempts < 100) {
      attempts++;
      if (attempts % 4 === 0) {
        x += w + 40;
        y = Math.max(MARGIN, desiredY);
      } else {
        y += h + 30;
      }
    }
    occupied.push({ x, y, w, h });
    return { x, y };
  };

  const maxX = Math.max(MARGIN, ...occupied.map((b) => b.x + b.w));
  const maxY = Math.max(MARGIN, ...occupied.map((b) => b.y + b.h));

  const positions = new Map<string, Point>();
  const isLR = direction === 'LR' || direction === 'RL';

  for (const id of newNodeIds) {
    const rawCell = model.cells.find((c) => c.id === id);
    const b = byId.get(id) ?? (rawCell ? cellBounds(rawCell) : { id, x: 0, y: 0, w: 140, h: 54 });
    const incident = edges.filter((e) => e.source === id || e.target === id);

    const incomingEdge = incident.find(
      (e) => e.target === id && e.source && byId.has(e.source) && !newNodeIds.includes(e.source),
    );
    const outgoingEdge = incident.find(
      (e) => e.source === id && e.target && byId.has(e.target) && !newNodeIds.includes(e.target),
    );
    const anyEdge = incident[0];

    let desired: Point;
    if (incomingEdge && incomingEdge.source && byId.get(incomingEdge.source)) {
      const src = byId.get(incomingEdge.source)!;
      desired = isLR ? { x: src.x + src.w + 60, y: src.y } : { x: src.x, y: src.y + src.h + 60 };
    } else if (outgoingEdge && outgoingEdge.target && byId.get(outgoingEdge.target)) {
      const tgt = byId.get(outgoingEdge.target)!;
      desired = isLR ? { x: tgt.x - b.w - 60, y: tgt.y } : { x: tgt.x, y: tgt.y - b.h - 60 };
    } else if (anyEdge) {
      const otherId = anyEdge.source === id ? anyEdge.target : anyEdge.source;
      const other = otherId ? byId.get(otherId) : undefined;
      if (other && (other.x > 0 || other.y > 0)) {
        desired = isLR ? { x: other.x + other.w + 60, y: other.y } : { x: other.x, y: other.y + other.h + 60 };
      } else {
        desired = isLR ? { x: maxX + 80, y: MARGIN } : { x: MARGIN, y: maxY + 80 };
      }
    } else {
      desired = isLR ? { x: maxX + 80, y: MARGIN } : { x: MARGIN, y: maxY + 80 };
    }

    const placed = place(desired.x, desired.y, b.w, b.h);
    positions.set(id, placed);
    byId.set(id, {
      id,
      label: rawCell?.value ?? id,
      kind: 'generic',
      style: rawCell?.style ?? '',
      x: placed.x,
      y: placed.y,
      w: b.w,
      h: b.h,
    });
  }

  // Populate all existing node absolute positions into positions map for postProcessGroups
  for (const n of state.nodes) {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: n.x, y: n.y });
    }
  }

  return postProcessGroups(model, positions, new Set(newNodeIds));
}

export { cellBounds, isManual };
export type { Bounds };
