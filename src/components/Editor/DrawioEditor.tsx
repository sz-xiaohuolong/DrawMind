import { useEffect, useRef, useState, useCallback } from 'react';
import { DrawioBridge } from '../../drawio/bridge';
import { buildEmbedUrl } from '../../drawio/messages';
import { useDiagramStore } from '../../store/diagramStore';

const EDITOR_CONFIG = {
  darkMode: 'dark',
  defaultFonts: ['Inter', 'PingFang SC', 'Microsoft YaHei'],
  customFonts: ['JetBrains Mono'],
  hideMenuItems: ['extrasThemes', 'help', 'openInNewWindow'],
  // Keep the host's grid/page settings out of the saved XML.
  preserveViewState: true,
  noResizers: false,
};

/**
 * Hosts the real draw.io editor (embed.diagrams.net) in an iframe and
 * connects it to the store over the official postMessage JSON protocol.
 */
export function DrawioEditor() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<DrawioBridge | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const bindBridge = useDiagramStore((s) => s.bindBridge);
  const setEditorReady = useDiagramStore((s) => s.setEditorReady);
  const setEditorError = useDiagramStore((s) => s.setEditorError);
  const handleAutosave = useDiagramStore((s) => s.handleEditorAutosave);
  const editorReady = useDiagramStore((s) => s.editorReady);
  const refreshProviderInfo = useDiagramStore((s) => s.refreshProviderInfo);
  const model = useDiagramStore((s) => s.model);

  useEffect(() => {
    refreshProviderInfo();
  }, [refreshProviderInfo]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const timer = setTimeout(() => {
      if (!bridgeRef.current) return;
      setTimedOut(true);
    }, 25_000);

    const bridge = new DrawioBridge(iframe, {
      config: EDITOR_CONFIG,
      onReady: () => {
        clearTimeout(timer);
        setTimedOut(false);
        setEditorReady(true);
      },
      onAutosave: (xml, currentPage) => handleAutosave(xml, currentPage),
      onError: (msg) => {
        console.warn('[drawio]', msg);
        if (msg === 'unknownMessage') return;
        setEditorError(msg);
      },
    });
    bridgeRef.current = bridge;
    bindBridge(bridge);

    return () => {
      clearTimeout(timer);
      bridge.destroy();
      bridgeRef.current = null;
      bindBridge(null);
      setEditorReady(false);
    };
    // reloadKey intentionally re-runs this effect to restart the editor
  }, [bindBridge, setEditorReady, setEditorError, handleAutosave, reloadKey]);

  const reload = useCallback(() => {
    setTimedOut(false);
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className="relative h-full w-full bg-canvas">
      <iframe
        key={`drawio-${reloadKey}`}
        ref={iframeRef}
        title="draw.io diagram editor"
        src={buildEmbedUrl()}
        className="h-full w-full border-0"
        allow="clipboard-write; clipboard-read"
      />
      {/* 覆盖编辑器自带的底部页签栏（本应用自己管理页面） */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 h-[38px] bg-canvas" />
      {!editorReady && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-canvas/95 backdrop-blur-sm">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <p className="text-sm text-muted">正在加载 draw.io 编辑器…</p>
          <p className="max-w-md text-center text-xs text-muted/60">
            编辑器从 embed.diagrams.net 加载，需要联网。
          </p>
          {timedOut && (
            <>
              <p className="text-xs text-red-400">
                编辑器未响应，可能被网络或防火墙拦截。
              </p>
              <button className="btn-ghost mt-2" onClick={reload}>
                重试
              </button>
            </>
          )}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-[42px] left-3 z-10 flex items-center gap-2 text-[11px] text-muted/50">
        <span className="pointer-events-auto rounded bg-panel2/80 px-2 py-0.5 backdrop-blur">
          {model.title || '未命名'}
        </span>
      </div>
    </div>
  );
}
