export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderChatOptions {
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderResult {
  content: string;
  reasoning?: string;
  model?: string;
}

export interface AIProvider {
  readonly name: string;
  readonly label: string;
  chat(messages: ProviderMessage[], options?: ProviderChatOptions): Promise<ProviderResult>;
}

/** Read the provider choice from the URL or environment (used mainly in tests/E2E). */
export function resolveProviderName(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('provider');
    if (p === 'mock' || p === 'deepseek') return p;
  }
  return (import.meta.env.VITE_AI_PROVIDER as string | undefined) || 'deepseek';
}
