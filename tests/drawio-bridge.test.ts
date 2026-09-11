import { describe, it, expect, vi } from 'vitest';
import { DrawioBridge } from '../src/drawio/bridge';
import { buildEmbedUrl } from '../src/drawio/messages';

function createFrame(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  return iframe;
}

function post(iframe: HTMLIFrameElement, msg: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify(msg),
      source: iframe.contentWindow as Window,
    }),
  );
}

describe('DrawioBridge', () => {
  it('parses string-encoded editor messages (configure → init → autosave)', () => {
    const iframe = createFrame();
    const onReady = vi.fn();
    const onAutosave = vi.fn();
    const onConfigure = vi.fn();
    const bridge = new DrawioBridge(iframe, {
      config: { darkMode: 'dark' },
      onReady,
      onAutosave,
      onConfigure,
    });

    // editor asks for config
    post(iframe, { event: 'configure' });
    expect(onConfigure).toHaveBeenCalled();
    // our response must be a string postMessage to the frame — capture it
    const posts: string[] = [];
    const origPost = iframe.contentWindow!.postMessage.bind(iframe.contentWindow);
    (iframe.contentWindow as unknown as { postMessage: unknown }).postMessage = (
      data: string,
      _o: string,
    ) => {
      posts.push(data);
      return origPost(data, '*');
    };
    bridge.configure({ darkMode: 'dark' });
    expect(posts.length).toBeGreaterThan(0);
    expect(JSON.parse(posts[0])).toMatchObject({ action: 'configure' });

    // editor is ready
    post(iframe, { event: 'init' });
    expect(onReady).toHaveBeenCalled();
    // queued load is flushed after init
    bridge.load('<mxfile/>', { fit: true });
    expect(posts.some((p) => JSON.parse(p).action === 'load')).toBe(true);

    // user edit → autosave
    post(iframe, { event: 'autosave', xml: '<mxfile><diagram/></mxfile>' });
    expect(onAutosave).toHaveBeenCalledTimes(1);
    expect(onAutosave.mock.calls[0][0]).toBe('<mxfile><diagram/></mxfile>');

    bridge.destroy();
    iframe.remove();
  });

  it('ignores messages from other windows and non-JSON payloads', () => {
    const iframe = createFrame();
    const onAutosave = vi.fn();
    const bridge = new DrawioBridge(iframe, { onAutosave });
    // wrong source
    window.dispatchEvent(
      new MessageEvent('message', { data: JSON.stringify({ event: 'autosave', xml: 'x' }) }),
    );
    // malformed JSON
    window.dispatchEvent(new MessageEvent('message', { data: 'not json', source: iframe.contentWindow as Window }));
    // not a protocol message
    window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ foo: 1 }), source: iframe.contentWindow as Window }));
    expect(onAutosave).not.toHaveBeenCalled();
    bridge.destroy();
    iframe.remove();
  });

  it('queues actions until init and supports export', async () => {
    const iframe = createFrame();
    const bridge = new DrawioBridge(iframe, {});
    const sent: unknown[] = [];
    (iframe.contentWindow as unknown as { postMessage: unknown }).postMessage = (data: string) => {
      sent.push(JSON.parse(data));
    };
    bridge.load('<mxfile/>', { fit: true });
    // queued because not ready
    expect(sent.length).toBe(0);
    post(iframe, { event: 'init' });
    expect(sent.some((m) => (m as { action?: string }).action === 'load')).toBe(true);

    // export: fire an export event after the action
    const exportPromise = bridge.export('xml');
    post(iframe, { event: 'export', format: 'xml', xml: '<mxfile/>' });
    const result = await exportPromise;
    expect(result.xml).toBe('<mxfile/>');
    bridge.destroy();
    iframe.remove();
  });

  it('builds a valid embed URL', () => {
    const url = buildEmbedUrl();
    expect(url).toContain('embed=1');
    expect(url).toContain('proto=json');
    expect(url.startsWith('https://embed.diagrams.net/')).toBe(true);
  });
});
