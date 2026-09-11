import type { NodeKind } from './types';

/**
 * Visual style presets per node kind.
 *
 * Design: "light card on dark canvas" — light fills with dark text and a
 * single saturated role color for the border. Renders exactly as specified
 * in the light editor chrome (no dark-mode color transformation), reads well
 * on the dark canvas, and exports cleanly to light-mode diagrams.net.
 */

const base = (fill: string, stroke: string): string =>
  `html=1;whiteSpace=wrap;rounded=1;arcSize=10;verticalAlign=middle;align=center;fontSize=13;fontColor=#0B1320;strokeColor=${stroke};strokeWidth=1.5;spacing=6;fillColor=${fill};`;

export const KIND_STYLES: Record<NodeKind, string> = {
  user: 'html=1;whiteSpace=wrap;rounded=1;arcSize=14;verticalAlign=middle;align=center;fontSize=13;fontColor=#241703;fillColor=#F5A623;strokeColor=#C98A1B;strokeWidth=1.5;spacing=6;',
  client: base('#FEF3E2', '#D97706'),
  gateway: base('#E0F2FE', '#0284C7'),
  service: base('#F1F5F9', '#64748B'),
  agent: base('#DBEAFE', '#2563EB'),
  'ai-model': base('#EDE9FE', '#7C3AED'),
  database: `shape=cylinder3;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#0B1320;fillColor=#DCFCE7;strokeColor=#16A34A;strokeWidth=1.5;spacing=6;boundedLbl=1;backgroundOutline=1;size=14;`,
  'vector-db': `shape=cylinder3;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#0B1320;fillColor=#CCFBF1;strokeColor=#0D9488;strokeWidth=1.5;spacing=6;boundedLbl=1;backgroundOutline=1;size=14;`,
  cache: base('#FEF3C7', '#D97706'),
  queue: `shape=parallelogram;perimeter=parallelogramPerimeter;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#0B1320;fillColor=#FFE4E6;strokeColor=#E11D48;strokeWidth=1.5;spacing=6;`,
  tool: base('#FCE7F3', '#DB2777'),
  external: base('#F8FAFC', '#94A3B8') + 'dashed=1;',
  storage: base('#DCFCE7', '#16A34A'),
  process: base('#F1F5F9', '#64748B'),
  decision: `shape=rhombus;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#0B1320;fillColor=#FEF3C7;strokeColor=#D97706;strokeWidth=1.5;spacing=6;`,
  start: `shape=ellipse;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#052e16;fillColor=#34D399;strokeColor=#059669;strokeWidth=1.5;`,
  end: `shape=ellipse;html=1;whiteSpace=wrap;verticalAlign=middle;align=center;fontSize=13;fontColor=#450a0a;fillColor=#F87171;strokeColor=#DC2626;strokeWidth=1.5;`,
  generic: base('#F1F5F9', '#94A3B8'),
};

/** Default node sizes per kind (width x height). */
export const KIND_SIZES: Record<NodeKind, { w: number; h: number }> = {
  user: { w: 130, h: 54 },
  client: { w: 130, h: 54 },
  gateway: { w: 150, h: 56 },
  service: { w: 150, h: 56 },
  agent: { w: 150, h: 56 },
  'ai-model': { w: 160, h: 60 },
  database: { w: 130, h: 70 },
  'vector-db': { w: 130, h: 70 },
  cache: { w: 130, h: 54 },
  queue: { w: 140, h: 54 },
  tool: { w: 140, h: 56 },
  external: { w: 150, h: 56 },
  storage: { w: 130, h: 70 },
  process: { w: 150, h: 56 },
  decision: { w: 150, h: 90 },
  start: { w: 90, h: 48 },
  end: { w: 90, h: 48 },
  generic: { w: 140, h: 54 },
};

export const EDGE_STYLE =
  'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#7C8DB0;strokeWidth=1.5;fontColor=#94A3B8;fontSize=12;';

export const MINDMAP_EDGE_STYLE =
  'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#7C8DB0;strokeWidth=1.5;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;';

/** Heuristic: map a style string back to a kind (for imported / hand-edited cells). */
export function detectKind(style: string | undefined, label: string): NodeKind {
  const s = style || '';
  if (s.includes('shape=cylinder3')) {
    return s.includes('#0D9488') ? 'vector-db' : 'database';
  }
  if (s.includes('shape=rhombus')) return 'decision';
  if (s.includes('shape=ellipse')) {
    return s.includes('#34D399') ? 'start' : s.includes('#F87171') ? 'end' : 'start';
  }
  if (s.includes('shape=parallelogram')) return 'queue';
  const lower = label.toLowerCase();
  if (/(llm|gpt|model|claude|deepseek|qwen)/.test(lower)) return 'ai-model';
  if (/(user|用户)/.test(lower)) return 'user';
  if (/(client|web|frontend|app|前端)/.test(lower)) return 'client';
  if (/(gateway|api gateway|入口|网关)/.test(lower)) return 'gateway';
  if (/(vector|pgvector|milvus|faiss|weaviate|chroma|redis)/.test(lower)) return 'vector-db';
  if (/(db|database|mysql|postgres|mongo|数据库)/.test(lower)) return 'database';
  if (/(cache|缓存)/.test(lower)) return 'cache';
  if (/(queue|kafka|mq|消息)/.test(lower)) return 'queue';
  if (/(tool|server|服务|service|后端|backend|api)/.test(lower)) return 'service';
  if (/(external|outside|外部|third|三方)/.test(lower)) return 'external';
  return 'generic';
}

export function styleForKind(kind: NodeKind): string {
  return KIND_STYLES[kind] || KIND_STYLES.generic;
}

export function sizeForKind(kind: NodeKind): { w: number; h: number } {
  return KIND_SIZES[kind] || KIND_SIZES.generic;
}
