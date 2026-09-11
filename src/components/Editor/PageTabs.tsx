import { useEffect, useRef, useState } from 'react';
import { useDiagramStore } from '../../store/diagramStore';

/**
 * 页面页签栏：本应用自己管理多页面（编辑器始终加载当前页）。
 * 支持：点击切换、双击重命名、删除（至少保留一页）、+ 新建页面。
 */
export function PageTabs() {
  const pages = useDiagramStore((s) => s.pages);
  const activePageIndex = useDiagramStore((s) => s.activePageIndex);
  const switchPage = useDiagramStore((s) => s.switchPage);
  const addPage = useDiagramStore((s) => s.addPage);
  const renamePage = useDiagramStore((s) => s.renamePage);
  const deletePage = useDiagramStore((s) => s.deletePage);

  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing !== null) inputRef.current?.select();
  }, [editing]);

  const commitRename = () => {
    if (editing !== null) {
      renamePage(editing, draft);
      setEditing(null);
    }
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2">
      {pages.map((p, i) => {
        const active = i === activePageIndex;
        return (
          <div
            key={p.id}
            className={`group flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-3 text-xs transition-colors ${
              active ? 'bg-accent/15 text-accent ring-1 ring-accent/40' : 'text-muted hover:bg-panel3 hover:text-text'
            }`}
            onClick={() => switchPage(i)}
            onDoubleClick={() => {
              setEditing(i);
              setDraft(p.name);
            }}
            title="双击重命名"
          >
            {editing === i ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-24 rounded bg-panel2 px-1 text-xs text-text outline-none ring-1 ring-accent/50"
              />
            ) : (
              <>
                <span className="max-w-[10rem] truncate">{p.name}</span>
                {pages.length > 1 && (
                  <button
                    className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                    title="删除页面"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePage(i);
                    }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}
      <button
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2.5 text-xs text-muted transition-colors hover:bg-panel3 hover:text-text"
        onClick={addPage}
        title="新建页面"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        新建页面
      </button>
    </div>
  );
}
