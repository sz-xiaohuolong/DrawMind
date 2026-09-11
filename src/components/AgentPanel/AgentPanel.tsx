import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/diagramStore';
import { EXAMPLE_PROMPTS } from '../../agent/prompts';

const STATUS_DOTS = ['thinking', 'planning', 'generating', 'validating', 'layout', 'rendering'];

export function AgentPanel() {
  const messages = useDiagramStore((s) => s.messages);
  const busy = useDiagramStore((s) => s.busy);
  const statusLabel = useDiagramStore((s) => s.statusLabel);
  const status = useDiagramStore((s) => s.status);
  const provider = useDiagramStore((s) => s.provider);
  const providerConfigured = useDiagramStore((s) => s.providerConfigured);
  const providerModel = useDiagramStore((s) => s.providerModel);
  const sendPrompt = useDiagramStore((s) => s.sendPrompt);
  const stop = useDiagramStore((s) => s.stop);
  const retryLast = useDiagramStore((s) => s.retryLast);
  const setPanelOpen = useDiagramStore((s) => s.setPanelOpen);
  const lastError = useDiagramStore((s) => s.lastError);

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, statusLabel, busy]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void sendPrompt(text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const showExamples = messages.length === 0;

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-line bg-panel">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
              <path d="M10 6.5h7a3 3 0 0 1 3 3v4.5M6.5 10v7a3 3 0 0 0 3 3h4.5" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text">AI 绘图助手</h2>
            <p className="text-[11px] text-muted/80">
              {providerConfigured ? providerModel : provider.label}
            </p>
          </div>
        </div>
        <button
          className="btn-ghost !px-2 !py-1"
          onClick={() => setPanelOpen(false)}
          title="收起面板"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {showExamples && (
          <div className="mb-4">
            <p className="mb-2 px-1 text-xs text-muted/80">
              用自然语言描述你想画的图（流程图 / 架构图 / 思维导图 / 时序图…），AI 会生成可编辑的 draw.io 图表，并支持多轮修改。
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  className="rounded-lg border border-line bg-panel2 px-3 py-2 text-left text-xs text-muted transition-colors hover:border-accent/50 hover:text-text"
                  onClick={() => {
                    setInput(p);
                    textareaRef.current?.focus();
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className="mb-3">
            {m.role === 'user' && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-sm text-text">
                  {m.content}
                </div>
              </div>
            )}
            {m.role === 'assistant' && (
              <div className="flex justify-start">
                <div
                  className={`max-w-[92%] whitespace-pre-wrap rounded-xl rounded-bl-sm px-3 py-2 text-sm ${
                    m.kind === 'error'
                      ? 'border border-red-900/60 bg-red-950/40 text-red-200'
                      : 'bg-panel2 text-text'
                  }`}
                >
                  {m.content}
                  {m.kind === 'error' && lastError && (
                    <button
                      className="btn-primary mt-2 !py-1 text-xs"
                      onClick={() => void retryLast()}
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            )}
            {m.role === 'system' && (
              <div className="flex justify-center">
                <span className="rounded bg-panel2/70 px-2 py-1 text-[11px] text-muted/70">{m.content}</span>
              </div>
            )}
          </div>
        ))}

        {/* live status */}
        {busy && (
          <div className="flex items-center gap-2 px-1 text-xs text-muted">
            {STATUS_DOTS.includes(status ?? '') ? (
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:240ms]" />
              </span>
            ) : (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            )}
            {statusLabel ?? 'Working...'}
          </div>
        )}
      </div>

      {/* input */}
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-panel2 p-2 focus-within:border-accent/50">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(4, Math.max(1, input.split('\n').length))}
            placeholder="描述你想画的图…"
            className="max-h-32 flex-1 resize-none bg-transparent text-sm text-text placeholder:text-muted/50 outline-none"
          />
          {busy ? (
            <button className="btn-ghost shrink-0" onClick={stop} title="停止生成">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span className="hidden sm:inline">停止</span>
            </button>
          ) : (
            <button
              className="btn-primary shrink-0"
              onClick={submit}
              disabled={!input.trim()}
              title="发送（Enter）"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              <span className="hidden sm:inline">发送</span>
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-muted/70">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </aside>
  );
}
