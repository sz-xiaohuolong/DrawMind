/**
 * Server-side proxy to the DeepSeek / Volcengine Ark OpenAI-compatible API.
 * The API key lives only here (server side), never in the browser.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Ask the model for a JSON object (response_format=json_object). */
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  reasoning?: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const BASE_URL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const API_KEY = process.env.DEEPSEEK_API_KEY || '';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

export async function createChatProxy(body: ChatRequest): Promise<ChatResponse> {
  if (!API_KEY) {
    const err = new Error('DEEPSEEK_API_KEY is not configured on the server (.env).');
    (err as { status?: number }).status = 500;
    throw err;
  }
  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    const err = new Error('messages is required');
    (err as { status?: number }).status = 400;
    throw err;
  }

  const payload: Record<string, unknown> = {
    model: MODEL,
    messages: body.messages,
    temperature: body.temperature ?? 0.3,
    max_tokens: body.maxTokens ?? 8192,
    stream: false,
  };
  if (body.jsonMode) {
    // DeepSeek / Ark support JSON object mode; also enforced by system prompt.
    payload.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`AI provider error ${res.status}: ${text.slice(0, 300)}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }

    const data = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
      }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (!content) {
      throw new Error('AI provider returned empty content');
    }
    return {
      content,
      reasoning: choice?.message?.reasoning_content,
      model: data.model ?? MODEL,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      const e = new Error('AI request timed out after 120s');
      (e as { status?: number }).status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
