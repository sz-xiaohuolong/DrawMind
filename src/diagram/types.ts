/**
 * Core domain types for the diagram pipeline:
 * User prompt → Diagram Operations → lossless Cell model → draw.io XML.
 */

export type DiagramType = 'flowchart' | 'architecture' | 'mindmap' | 'sequence' | 'generic';

export type LayoutMode = 'auto' | 'flowchart' | 'architecture' | 'mindmap' | 'sequence' | 'manual';
export type LayoutDirection = 'LR' | 'TB' | 'RL' | 'BT';

/** Semantic node kinds — each maps to a visual style preset. */
export type NodeKind =
  | 'user'
  | 'client'
  | 'gateway'
  | 'service'
  | 'agent'
  | 'ai-model'
  | 'database'
  | 'vector-db'
  | 'cache'
  | 'queue'
  | 'tool'
  | 'external'
  | 'storage'
  | 'process'
  | 'decision'
  | 'start'
  | 'end'
  | 'generic';

/** Lossless mirror of an mxCell — every attribute is preserved. */
export interface Cell {
  id: string;
  /** Parent cell id (layer or group or root). */
  parent?: string;
  vertex?: boolean;
  edge?: boolean;
  /** Cell label. May contain XML-escaped HTML when html=1 in style. */
  value?: string;
  style?: string;
  /** Edge endpoints. */
  source?: string;
  target?: string;
  /** Any extra attributes (connectable, editable, dmKind, ...) preserved verbatim. */
  attrs?: Record<string, string>;
  geometry?: Geometry;
  /** Child cells (e.g. group members live as parent=groupId; nested children kept too). */
  children?: Cell[];
}

export interface Point {
  x: number;
  y: number;
}

/** Lossless mirror of mxGeometry. */
export interface Geometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  relative?: boolean;
  as?: string;
  /** Edge waypoints (as="points"). */
  points?: Point[];
  sourcePoint?: Point;
  targetPoint?: Point;
  attrs?: Record<string, string>;
}

/** Top-level model = list of all cells (root, layers, nodes, edges, groups). */
export interface Model {
  cells: Cell[];
  rootId: string;
  layerIds: string[];
  title: string;
  background?: string;
  /** Extra <diagram> attributes preserved verbatim. */
  diagramAttrs: Record<string, string>;
  /** Extra <mxGraphModel> attributes preserved verbatim. */
  graphAttrs: Record<string, string>;
}

export interface NodeView {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
  /** id of the group this node belongs to, if any. */
  groupId?: string;
}

export interface EdgeView {
  id: string;
  source: string;
  target: string;
  label?: string;
  style: string;
}

export interface GroupView {
  id: string;
  label: string;
  memberIds: string[];
}

/** Semantic snapshot of the diagram — what the AI "sees". */
export interface DiagramState {
  type: DiagramType;
  title: string;
  background?: string;
  nodes: NodeView[];
  edges: EdgeView[];
  groups: GroupView[];
}

/* ------------------------------------------------------------------ */
/* Diagram Operations (the incremental change vocabulary)              */
/* ------------------------------------------------------------------ */

export interface AddNodeOp {
  operation: 'add_node';
  id: string;
  label: string;
  kind?: NodeKind;
  style?: string;
  /** Optional group id to place the node into. */
  group?: string;
}

export interface DeleteNodeOp {
  operation: 'delete_node';
  id: string;
}

export interface UpdateNodeOp {
  operation: 'update_node';
  id: string;
  label?: string;
  kind?: NodeKind;
  style?: string;
}

export interface RenameNodeOp {
  operation: 'rename_node';
  id: string;
  label: string;
}

export interface MoveNodeOp {
  operation: 'move_node';
  id: string;
  x: number;
  y: number;
}

export interface AddEdgeOp {
  operation: 'add_edge';
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface DeleteEdgeOp {
  operation: 'delete_edge';
  id: string;
}

export interface UpdateEdgeOp {
  operation: 'update_edge';
  id: string;
  source?: string;
  target?: string;
  label?: string;
}

export interface ChangeStyleOp {
  operation: 'change_style';
  id: string;
  style: string;
}

export interface ChangeLayoutOp {
  operation: 'change_layout';
  /** auto = infer from current diagram type. */
  layout?: LayoutMode;
  direction?: LayoutDirection;
  /** true = also move manually positioned nodes (default false). */
  force?: boolean;
}

export interface AddGroupOp {
  operation: 'add_group';
  id: string;
  label: string;
  memberIds?: string[];
}

export interface AddNodeToGroupOp {
  operation: 'add_node_to_group';
  groupId: string;
  nodeId: string;
}

export interface SetTitleOp {
  operation: 'set_title';
  title: string;
}

export interface SetBackgroundOp {
  operation: 'set_background';
  color: string;
}

export interface ClearOp {
  operation: 'clear';
}

export type DiagramOperation =
  | AddNodeOp
  | DeleteNodeOp
  | UpdateNodeOp
  | RenameNodeOp
  | MoveNodeOp
  | AddEdgeOp
  | DeleteEdgeOp
  | UpdateEdgeOp
  | ChangeStyleOp
  | ChangeLayoutOp
  | AddGroupOp
  | AddNodeToGroupOp
  | SetTitleOp
  | SetBackgroundOp
  | ClearOp;

/** Structured output produced by the LLM. */
export interface AgentResult {
  summary: string;
  intent: 'create' | 'modify' | 'query' | 'other';
  diagramType: DiagramType;
  layout: { mode: LayoutMode; direction: LayoutDirection };
  operations: DiagramOperation[];
}

export type ApplyOutcome =
  | { status: 'ok'; message: string }
  | { status: 'partial'; message: string; rejected: string[] }
  | { status: 'noop'; message: string };

/** One entry in the version (undo/redo) history. */
export interface DiagramVersion {
  index: number;
  label: string;
  model: Model;
  xml: string;
  ts: number;
}
