import type { AgentResult, DiagramOperation } from '../diagram/types';
import { isKnownOperation } from '../diagram/operations';

/**
 * Robust parsing of the model's structured output.
 * Handles code fences, stray prose, invalid JSON, partial objects.
 */

const VALID_INTENTS = new Set(['create', 'modify', 'query', 'other']);
const VALID_TYPES = new Set(['flowchart', 'architecture', 'mindmap', 'sequence', 'generic']);
const VALID_LAYOUTS = new Set(['auto', 'flowchart', 'architecture', 'mindmap', 'sequence', 'manual']);
const VALID_DIRECTIONS = new Set(['LR', 'TB', 'RL', 'BT']);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Extract the first balanced JSON object from a model response. */
export function extractJsonObject(text: string): unknown {
  if (!text) throw new ParseError('empty model response');

  // strip markdown code fences
  const fenced = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();

  const start = fenced.indexOf('{');
  if (start === -1) throw new ParseError('no JSON object found in response');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = fenced.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          throw new ParseError('JSON object found but not parseable');
        }
      }
    }
  }
  throw new ParseError('unbalanced JSON in response');
}

export function parseAgentResult(raw: unknown): AgentResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new ParseError('model output is not an object');
  }
  const obj = raw as Record<string, unknown>;

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim()
      ? obj.summary.trim().slice(0, 300)
      : 'Diagram updated.';
  const intent =
    typeof obj.intent === 'string' && VALID_INTENTS.has(obj.intent)
      ? (obj.intent as AgentResult['intent'])
      : 'modify';
  const diagramType =
    typeof obj.diagramType === 'string' && VALID_TYPES.has(obj.diagramType)
      ? (obj.diagramType as AgentResult['diagramType'])
      : 'architecture';

  let layoutMode: AgentResult['layout']['mode'] = 'auto';
  let layoutDirection: AgentResult['layout']['direction'] = 'LR';
  if (typeof obj.layout === 'object' && obj.layout !== null) {
    const l = obj.layout as Record<string, unknown>;
    if (typeof l.mode === 'string' && VALID_LAYOUTS.has(l.mode)) {
      layoutMode = l.mode as AgentResult['layout']['mode'];
    }
    if (typeof l.direction === 'string' && VALID_DIRECTIONS.has(l.direction)) {
      layoutDirection = l.direction as AgentResult['layout']['direction'];
    }
  }

  const operations: DiagramOperation[] = [];
  if (Array.isArray(obj.operations)) {
    for (const op of obj.operations) {
      if (isKnownOperation(op)) operations.push(op);
    }
  }

  return { summary, intent, diagramType, layout: { mode: layoutMode, direction: layoutDirection }, operations };
}

/** Parse + normalize in one step; throws ParseError on hard failure. */
export function parseAgentResponse(content: string): AgentResult {
  const raw = extractJsonObject(content);
  return parseAgentResult(raw);
}
