import type { AIProvider, ProviderChatOptions, ProviderMessage, ProviderResult } from './types';

/**
 * Resolve the API base: same origin in the browser, env override in tests/Node.
 * IMPORTANT: never reference bare `process` in the browser — guard with typeof.
 */
export function resolveApiBase(): string {
  if (typeof process !== 'undefined' && process.env?.API_BASE) {
    return process.env.API_BASE;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

/**
 * DeepSeek provider — talks to our own Express proxy (/api/chat).
 * The API key never leaves the server.
 */
export class DeepSeekProvider implements AIProvider {
  readonly name = 'deepseek';
  readonly label = 'DeepSeek V4.1 Flash';

  async chat(messages: ProviderMessage[], options: ProviderChatOptions = {}): Promise<ProviderResult> {
    const res = await fetch(`${resolveApiBase()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        jsonMode: options.jsonMode ?? false,
        temperature: options.temperature ?? 0.3,
        maxTokens: options.maxTokens ?? 8192,
      }),
      signal: options.signal,
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (!res.ok) {
      const msg =
        (body as { error?: string })?.error ??
        `Server error ${res.status}`;
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const data = body as {
      content?: string;
      model?: string;
      reasoning?: string;
    };
    return {
      content: data.content ?? '',
      model: data.model,
      reasoning: data.reasoning,
    };
  }
}

export async function fetchProviderConfig(): Promise<{
  provider: string;
  model: string;
  baseUrl: string;
  configured: boolean;
}> {
  const res = await fetch('/api/config');
  const data = (await res.json()) as {
    provider: string;
    model: string;
    baseUrl: string;
    configured: boolean;
  };
  return {
    provider: data.provider,
    model: data.model,
    baseUrl: data.baseUrl,
    configured: data.configured,
  };
}
