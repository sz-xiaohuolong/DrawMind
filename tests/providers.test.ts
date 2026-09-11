import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiBase } from '../src/providers/deepseek';

/**
 * Regression: the browser bundle must never touch the bare `process` global
 * (Vite does not polyfill it) — that caused "process is not defined" for the
 * real DeepSeek provider in the browser.
 */
describe('resolveApiBase (browser-safe)', () => {
  const originalProcess = (globalThis as Record<string, unknown>).process;

  afterEach(() => {
    if (originalProcess === undefined) {
      delete (globalThis as Record<string, unknown>).process;
    } else {
      (globalThis as Record<string, unknown>).process = originalProcess;
    }
  });

  it('does not throw when `process` is undefined (real browser)', () => {
    delete (globalThis as Record<string, unknown>).process;
    expect(typeof process).toBe('undefined');
    // In jsdom, window.location.origin is http://localhost:3000
    const base = resolveApiBase();
    expect(base).toContain('localhost');
    expect(base.endsWith('/')).toBe(false);
  });

  it('returns the API_BASE override when running under Node with the env set', () => {
    (globalThis as Record<string, unknown>).process = {
      env: { API_BASE: 'http://127.0.0.1:9999' },
    } as unknown as NodeJS.Process;
    expect(resolveApiBase()).toBe('http://127.0.0.1:9999');
  });

  it('falls back to the default when neither process nor window exist', () => {
    delete (globalThis as Record<string, unknown>).process;
    const win = (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).window;
    try {
      expect(resolveApiBase()).toBe('http://localhost:3001');
    } finally {
      (globalThis as Record<string, unknown>).window = win;
    }
  });
});
