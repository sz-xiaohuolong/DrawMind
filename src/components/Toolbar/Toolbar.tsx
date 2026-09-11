import { useRef, useState } from 'react';
import { useDiagramStore } from '../../store/diagramStore';

type ExportFormat = 'drawio' | 'xml' | 'svg' | 'png';

export function Toolbar() {
  const undo = useDiagramStore((s) => s.undo);
  const redo = useDiagramStore((s) => s.redo);
  const exportDiagram = useDiagramStore((s) => s.exportDiagram);
  const importXml = useDiagramStore((s) => s.importXml);
  const addPage = useDiagramStore((s) => s.addPage);
  const versionIndex = useDiagramStore((s) => s.versionIndex);
  const versions = useDiagramStore((s) => s.versions);
  const busy = useDiagramStore((s) => s.busy);
  const statusLabel = useDiagramStore((s) => s.statusLabel);
  const panelOpen = useDiagramStore((s) => s.panelOpen);
  const setPanelOpen = useDiagramStore((s) => s.setPanelOpen);
  const editorReady = useDiagramStore((s) => s.editorReady);
  const pages = useDiagramStore((s) => s.pages);
  const activePageIndex = useDiagramStore((s) => s.activePageIndex);

  const [exportOpen, setExportOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canUndo = versionIndex > 0;
  const canRedo = versionIndex < versions.length - 1;
  const title = pages[activePageIndex]?.name ?? '未命名';

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      importXml(text, file.name);
    };
    reader.readAsText(file);
  };

  const doExport = async (format: ExportFormat) => {
    setExportOpen(false);
    await exportDiagram(format);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15 text-accent">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
            <path d="M10 6.5h7a3 3 0 0 1 3 3v4.5M6.5 10v7a3 3 0 0 0 3 3h4.5" />
          </svg>
        </div>
        <div className="mr-2">
          <h1 className="text-sm font-semibold leading-tight text-text">AI 绘图助手</h1>
          <p className="text-[10px] leading-tight text-muted/70">{title}</p>
        </div>
      </div>

      <div className="h-5 w-px bg-line" />

      <button className="btn-ghost" onClick={addPage} title="新建页面（保留当前所有页面）">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden lg:inline">新建页面</span>
      </button>

      <button className="btn-ghost" onClick={() => fileRef.current?.click()} title="导入 .drawio / .xml">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        <span className="hidden lg:inline">导入</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".drawio,.xml,application/xml,text/xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImportFile(f);
          e.target.value = '';
        }}
      />

      <div className="relative">
        <button
          className="btn-ghost"
          onClick={() => setExportOpen((o) => !o)}
          title="导出图表"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 15V3m0 0 4 4m-4-4L8 7M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          <span className="hidden lg:inline">导出</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {exportOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-line bg-panel2 shadow-xl">
              {(
                [
                  ['drawio', '.drawio — 可编辑 XML（全部页面）'],
                  ['xml', '.xml — 原始 XML'],
                  ['svg', '.svg — 矢量图'],
                  ['png', '.png — 位图'],
                ] as Array<[ExportFormat, string]>
              ).map(([fmt, label]) => (
                <button
                  key={fmt}
                  className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-panel3 hover:text-text"
                  onClick={() => void doExport(fmt)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="h-5 w-px bg-line" />

      <button className="btn-ghost" onClick={undo} disabled={!canUndo || busy} title="撤销（版本历史）">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
        </svg>
        <span className="hidden lg:inline">撤销</span>
      </button>
      <button className="btn-ghost" onClick={redo} disabled={!canRedo || busy} title="重做">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
        </svg>
        <span className="hidden lg:inline">重做</span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {busy && (
          <span className="hidden items-center gap-2 text-xs text-muted md:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {statusLabel ?? '工作中…'}
          </span>
        )}
        {!editorReady && <span className="text-xs text-muted/60">编辑器加载中…</span>}
        <button
          className="btn-ghost !px-2 !py-1"
          onClick={() => setPanelOpen(!panelOpen)}
          title={panelOpen ? '收起 AI 面板' : '展开 AI 面板'}
        >
          {panelOpen ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" />
            </svg>
          )}
          <span className="hidden lg:inline">AI</span>
        </button>
      </div>
    </header>
  );
}
