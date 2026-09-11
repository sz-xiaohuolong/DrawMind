import type {
  EditorConfig,
  EditorEvent,
  HostMessage,
} from './messages';
import { isEditorMessage } from './messages';

export interface DrawioBridgeOptions {
  onReady?: () => void;
  onConfigure?: () => void;
  onAutosave?: (xml: string, currentPage?: number) => void;
  onSave?: (xml: string) => void;
  onExport?: (msg: { format: string; data?: string; xml?: string }) => void;
  onError?: (msg: string) => void;
  /** Post-configuration editor config (applied before init). */
  config?: EditorConfig;
}

/**
 * Thin, typed wrapper around the draw.io embed JSON protocol.
 * Queues host actions until the editor signals init.
 */
export class DrawioBridge {
  private iframe: HTMLIFrameElement;
  private opts: DrawioBridgeOptions;
  private ready = false;
  private configured = false;
  private queue: HostMessage[] = [];
  private messageHandler: (evt: MessageEvent) => void;

  constructor(iframe: HTMLIFrameElement, opts: DrawioBridgeOptions) {
    this.iframe = iframe;
    this.opts = opts;
    this.messageHandler = (evt: MessageEvent) => this.onMessage(evt);
    window.addEventListener('message', this.messageHandler);
  }

  private onMessage(evt: MessageEvent): void {
    // Only accept messages from our embedded editor.
    if (evt.source !== this.iframe.contentWindow) return;
    let data: unknown;
    try {
      data = JSON.parse(String(evt.data));
    } catch {
      return; // non-JSON — not a protocol message
    }
    if (!isEditorMessage(data)) return;
    this.handle(data as EditorEvent);
  }

  private handle(msg: EditorEvent): void {
    const event = (msg as { event?: string }).event;
    switch (event) {
      case 'configure': {
        this.configured = true;
        this.opts.onConfigure?.();
        if (this.opts.config) {
          this.post({ action: 'configure', config: this.opts.config });
        }
        break;
      }
      case 'init': {
        this.ready = true;
        this.opts.onReady?.();
        this.flush();
        break;
      }
      case 'autosave': {
        const xml = (msg as { xml?: string }).xml;
        const currentPage = (msg as { currentPage?: number }).currentPage;
        if (xml) this.opts.onAutosave?.(xml, currentPage);
        break;
      }
      case 'save': {
        const xml = (msg as { xml?: string }).xml;
        if (xml) this.opts.onSave?.(xml);
        break;
      }
      case 'export': {
        this.opts.onExport?.(msg as { format: string; data?: string; xml?: string });
        break;
      }
      default: {
        const err = (msg as { error?: string }).error;
        if (err) this.opts.onError?.(err);
      }
    }
  }

  private post(msg: HostMessage): void {
    this.iframe.contentWindow?.postMessage(JSON.stringify(msg), '*');
  }

  private flush(): void {
    const pending = this.queue;
    this.queue = [];
    for (const msg of pending) this.post(msg);
  }

  private send(msg: HostMessage): void {
    if (this.ready) this.post(msg);
    else this.queue.push(msg);
  }

  /** Configure must be answered before init; send it immediately. */
  configure(config: EditorConfig): void {
    this.opts.config = config;
    if (this.configured) this.post({ action: 'configure', config });
  }

  load(
    xml: string,
    opts: { fit?: boolean; autosave?: boolean; title?: string; background?: string } = {},
  ): void {
    this.send({
      action: 'load',
      xml,
      autosave: opts.autosave === false ? 0 : 1,
      fit: opts.fit ? 1 : 0,
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.background ? { background: opts.background } : {}),
    });
  }

  merge(xml: string): void {
    this.send({ action: 'merge', xml });
  }

  export(format: string, extra: Partial<Record<string, unknown>> = {}): Promise<{ format: string; data?: string; xml?: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
        cleanup();
      };
      const listener = (evt: MessageEvent) => {
        if (evt.source !== this.iframe.contentWindow) return;
        let data: unknown;
        try {
          data = JSON.parse(String(evt.data));
        } catch {
          return;
        }
        if (!isEditorMessage(data)) return;
        const event = (data as EditorEvent & { event?: string }).event;
        if (event === 'export') {
          done(() => resolve(data as { format: string; data?: string; xml?: string }));
        } else if (event === 'exit') {
          done(() => reject(new Error('editor closed during export')));
        }
      };
      const timeout = setTimeout(() => done(() => reject(new Error('export timed out'))), 30_000);
      const cleanup = () => {
        clearTimeout(timeout);
        window.removeEventListener('message', listener);
      };
      window.addEventListener('message', listener);
      this.send({ action: 'export', format, ...extra } as HostMessage);
    });
  }

  fit(border = 24, maxScale = 1.2): void {
    this.send({ action: 'fit', border, maxScale });
  }

  status(message: string): void {
    this.send({ action: 'status', message });
  }

  showSpinner(show: boolean, message = 'Working...'): void {
    this.send({ action: 'spinner', show, ...(show ? { message } : {}) });
  }

  invokeAction(actionName: string): void {
    this.send({ action: 'invokeAction', actionName });
  }

  destroy(): void {
    window.removeEventListener('message', this.messageHandler);
  }
}
