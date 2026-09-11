import type { AIProvider } from '../providers/types';
import type { AgentResult, Model, DiagramType, LayoutMode } from '../diagram/types';
import { buildDiagramContext, buildMessages } from './prompts';
import { parseAgentResponse, ParseError } from './planner';
import { validateOperations, applyOperations, resolveAutoMode } from '../diagram/operations';
import { layoutModel, layoutNewNodes, isManual } from '../diagram/layout';
import { buildDiagramState } from '../diagram/state';
import { validateAndRepair, validateModel } from '../diagram/validator';
import { serializeModel } from '../diagram/generator';
import { createBlankModel } from '../diagram/generator';
import { parseXml } from '../diagram/parser';

export interface AgentContext {
  model: Model;
  diagramType: DiagramType;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  onStatus?: (label: string) => void;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  agentResult: AgentResult;
  model: Model;
  xml: string;
  diagramType: DiagramType;
  applied: string[];
  rejected: string[];
  warnings: string[];
  fixes: string[];
  changed: boolean;
  incremental: boolean;
  summary: string;
}

const MAX_RETRIES = 2;

function throwAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/**
 * The AI diagram agent pipeline:
 *   prompt → LLM (structured ops) → validate ops → apply to model →
 *   layout → XML → validate/repair → ready for the editor.
 */
export async function runDiagramAgent(provider: AIProvider, prompt: string, ctx: AgentContext): Promise<AgentRunResult> {
  const { model, diagramType, history, onStatus, signal } = ctx;
  throwAborted(signal);
  onStatus?.('思考中…');

  const state = buildDiagramState(model);
  const contextJson = buildDiagramContext(state);
  const messages = buildMessages(history, contextJson, prompt);

  // 1) Ask the LLM for structured operations (json_object), with retries on bad JSON.
  let agentResult: AgentResult | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    throwAborted(signal);
    if (attempt > 0) onStatus?.(`正在重试（JSON 无效，第 ${attempt + 1} 次）…`);
    else onStatus?.('正在规划图表…');

    const msgList =
      attempt > 0
        ? [
            ...messages,
            {
              role: 'user' as const,
              content:
                'Your previous response was not valid structured JSON. Reply with ONLY the JSON object described in the system prompt, no code fences, no prose.',
            },
          ]
        : messages;

    try {
      const res = await provider.chat(msgList, { jsonMode: true, temperature: 0.2, signal });
      onStatus?.('正在生成 XML…');
      agentResult = parseAgentResponse(res.content);
      break;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastError = err instanceof Error ? err.message : String(err);
      if (err instanceof ParseError) continue; // retry
      throw err; // network/provider errors are not retried with junk
    }
  }
  if (!agentResult) {
    throw new Error(lastError || '模型没有返回有效响应。');
  }
  throwAborted(signal);

  // 2) Validate operations against the current model.
  onStatus?.('正在校验操作…');
  const { ops, rejected, warnings } = validateOperations(agentResult.operations, model);
  if (ops.length === 0 && agentResult.intent !== 'query') {
    if (rejected.length > 0) {
      throw new Error(`无法应用此图表更新（${rejected[0]}）。`);
    }
    throw new Error('模型没有返回可用的图表变更。');
  }

  // 3) Apply operations to the lossless model.
  let nextModel = model;
  let addedNodeIds: string[] = [];
  let applied: string[] = [];
  let rejectedAll: string[] = [];
  let hasLayoutOp = false;
  let layoutOp: { mode: string; direction: string; force: boolean } | undefined;
  let cleared = false;

  if (ops.length > 0) {
    const result = applyOperations(nextModel, ops);
    nextModel = result.model;
    addedNodeIds = result.addedNodeIds;
    applied = result.applied;
    rejectedAll = result.rejected;
    hasLayoutOp = result.hasLayoutOp;
    layoutOp = result.layoutOp;
    cleared = result.cleared;
  }

  // 4) Layout: explicit change_layout / initial creation / incremental placement.
  onStatus?.('正在计算布局…');
  if (hasLayoutOp && layoutOp) {
    nextModel = layoutModel(nextModel, {
      mode: resolveAutoMode(layoutOp.mode as LayoutMode, agentResult.diagramType),
      direction: layoutOp.direction as 'LR' | 'TB' | 'RL' | 'BT',
      force: layoutOp.force,
    });
  } else if (addedNodeIds.length > 0) {
    const totalNodes = buildDiagramState(nextModel).nodes.length;
    const hadNodes = totalNodes > addedNodeIds.length;
    const hasManualNodes = nextModel.cells.some((c) => isManual(c));
    if (!hadNodes || !hasManualNodes || addedNodeIds.length >= 3) {
      if (agentResult.layout.mode !== 'manual') {
        const mode = resolveAutoMode(agentResult.layout.mode, agentResult.diagramType);
        nextModel = layoutModel(nextModel, { mode, direction: agentResult.layout.direction });
      } else {
        nextModel = layoutNewNodes(nextModel, addedNodeIds, agentResult.layout.direction ?? 'LR');
      }
    } else {
      nextModel = layoutNewNodes(nextModel, addedNodeIds, agentResult.layout.direction ?? 'LR');
    }
  } else if (cleared) {
    nextModel = createBlankModel(nextModel.title);
  }

  const nextDiagramType: DiagramType = agentResult.intent === 'create' ? agentResult.diagramType : diagramType;

  // 5) Serialize + validate/repair XML.
  onStatus?.('正在校验 XML…');
  let xml = serializeModel(nextModel);
  const check = validateAndRepair(xml, 3);
  xml = check.xml;
  if (!check.ok) {
    throw new Error('生成的图表在修复后仍无法通过校验。');
  }
  if (!validateModel(nextModel).ok) {
    // repair changed the model — re-parse the repaired XML to keep them in sync
    const reparsed = parseXml(xml);
    if (reparsed) nextModel = reparsed;
  }

  onStatus?.('正在渲染…');
  return {
    agentResult,
    model: nextModel,
    xml,
    diagramType: nextDiagramType,
    applied,
    rejected: rejectedAll,
    warnings,
    fixes: check.fixes,
    changed: ops.length > 0 && applied.length > 0,
    incremental: !(cleared || addedNodeIds.length === buildDiagramState(nextModel).nodes.length),
    summary: agentResult.summary,
  };
}

export { ParseError };
