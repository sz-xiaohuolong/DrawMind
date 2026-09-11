import { create } from 'zustand';
import type { AIProvider } from '../providers/types';
import { DeepSeekProvider, fetchProviderConfig } from '../providers/deepseek';
import { MockProvider } from '../providers/mock';
import { resolveProviderName } from '../providers/types';
import type { DrawioBridge } from '../drawio/bridge';
import type { DiagramType, Model } from '../diagram/types';
import { parseXml, parseMultiPage } from '../diagram/parser';
import { serializeModel, createBlankModel } from '../diagram/generator';
import { isSafeForEditor } from '../diagram/validator';
import { buildDiagramState } from '../diagram/state';
import { runDiagramAgent } from '../agent/diagramAgent';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  kind?: 'normal' | 'error' | 'info';
}

/** One page of the document. `xml` is the serialized single-page doc (lossless). */
export interface PageInfo {
  id: string;
  name: string;
  model: Model;
  xml: string;
}

export interface VersionEntry {
  label: string;
  /** JSON snapshot of {active, pages:[{id,name,xml}]}. */
  snapshot: string;
  ts: number;
}

const STORAGE_KEY = 'drawmind-state-v2';

function blankPage(name = '页面 1'): PageInfo {
  const model = createBlankModel(name);
  return { id: `page-${Date.now()}-${Math.floor(Math.random() * 1000)}`, name, model, xml: serializeModel(model) };
}

function snapshotOf(pages: PageInfo[], active: number): string {
  return JSON.stringify({
    active,
    pages: pages.map((p) => ({ id: p.id, name: p.name, xml: p.xml })),
  });
}

function restoreFromSnapshot(snapshot: string): { pages: PageInfo[]; active: number } | null {
  try {
    const data = JSON.parse(snapshot) as { active: number; pages: Array<{ id: string; name: string; xml: string }> };
    if (!Array.isArray(data.pages) || data.pages.length === 0) return null;
    const pages = data.pages.map((p) => {
      const model = parseXml(p.xml) ?? createBlankModel(p.name);
      return { id: p.id, name: p.name, model, xml: p.xml };
    });
    const active = Math.min(Math.max(0, data.active ?? 0), pages.length - 1);
    return { pages, active };
  } catch {
    return null;
  }
}

interface PersistedState {
  xml: string;
  diagramType: DiagramType;
  versions: VersionEntry[];
  messages: ChatItem[];
}

function loadPersisted(): { pages: PageInfo[]; active: number; diagramType: DiagramType; versions: VersionEntry[]; messages: ChatItem[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedState & { snapshot?: string; active?: number };
    if (typeof data.snapshot === 'string') {
      const restored = restoreFromSnapshot(data.snapshot);
      if (restored) {
        return {
          pages: restored.pages,
          active: restored.active,
          diagramType: data.diagramType ?? 'architecture',
          versions: data.versions ?? [],
          messages: data.messages ?? [],
        };
      }
    }
    // legacy v1: single-page {xml, versions:[{label,xml}]}
    if (typeof data.xml === 'string' && data.xml.includes('<mxGraphModel')) {
      const page = parseXml(data.xml);
      if (page) {
        const pages: PageInfo[] = [{ id: `page-${Date.now()}`, name: page.title || '页面 1', model: page, xml: data.xml }];
        const legacy = data as unknown as { versions?: Array<{ label: string; ts: number; xml: string }> };
        const legacyVersions = legacy.versions ?? [];
        const versions: VersionEntry[] = legacyVersions.map((v) => ({
          label: v.label,
          ts: v.ts,
          snapshot: JSON.stringify({ active: 0, pages: [{ id: pages[0].id, name: pages[0].name, xml: v.xml }] }),
        }));
        return { pages, active: 0, diagramType: data.diagramType ?? 'architecture', versions, messages: data.messages ?? [] };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function persist(state: {
  pages: PageInfo[];
  active: number;
  diagramType: DiagramType;
  versions: VersionEntry[];
  messages: ChatItem[];
}): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        snapshot: snapshotOf(state.pages, state.active),
        diagramType: state.diagramType,
        versions: state.versions,
        messages: state.messages,
      }),
    );
  } catch {
    // non-fatal
  }
}

/** Structural signature of one page's xml: excludes geometry + bookkeeping attrs. */
function structureSig(xml: string): string {
  const model = parseXml(xml);
  if (!model) return '';
  const rows = model.cells
    .map((c) => {
      let attrs = c.attrs ? { ...c.attrs } : undefined;
      if (attrs) {
        delete attrs.dmManual;
        delete attrs.dmHelper;
        if (Object.keys(attrs).length === 0) attrs = undefined;
      }
      return JSON.stringify({
        i: c.id,
        p: c.parent,
        v: c.vertex ? 1 : 0,
        e: c.edge ? 1 : 0,
        val: c.value,
        s: c.style,
        src: c.source,
        tgt: c.target,
        a: attrs,
      });
    })
    .sort();
  return rows.join('|');
}

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'generating'
  | 'validating'
  | 'layout'
  | 'rendering'
  | 'error';

export interface DiagramStore {
  // --- multi-page document ---
  pages: PageInfo[];
  activePageIndex: number;
  /** Active page model (what the AI sees / edits). */
  model: Model;
  /** Active page single-page xml (loaded into the editor). */
  xml: string;
  diagramType: DiagramType;

  // --- editor ---
  editorReady: boolean;
  editorError: string | null;
  loadingEditor: boolean;

  // --- version history ---
  versions: VersionEntry[];
  versionIndex: number;

  // --- conversation ---
  messages: ChatItem[];
  status: AgentStatus | null;
  statusLabel: string | null;
  busy: boolean;
  provider: AIProvider;
  providerConfigured: boolean;
  providerModel: string;
  providerBaseUrl: string;

  // --- ui ---
  panelOpen: boolean;
  lastPrompt: string | null;
  lastError: string | null;

  // --- actions ---
  bindBridge: (bridge: DrawioBridge | null) => void;
  handleEditorAutosave: (xml: string, currentPage?: number) => void;
  setEditorReady: (ready: boolean) => void;
  setEditorError: (error: string | null) => void;
  sendPrompt: (text: string) => Promise<void>;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  switchPage: (index: number) => void;
  addPage: () => void;
  renamePage: (index: number, name: string) => void;
  deletePage: (index: number) => void;
  importXml: (xml: string, name: string) => void;
  exportDiagram: (format: 'xml' | 'drawio' | 'svg' | 'png') => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  retryLast: () => Promise<void>;
  refreshProviderInfo: () => Promise<void>;
  resetConversation: () => void;
  reset: () => void;
}

let bridge: DrawioBridge | null = null;
let abortController: AbortController | null = null;

/** Load the active page (single-page doc) into the editor. */
function loadActiveIntoEditor(get: () => DiagramStore): void {
  const s = get();
  const page = s.pages[s.activePageIndex];
  if (!page || !bridge) return;
  bridge.load(page.xml, { fit: true, autosave: true, title: page.name, background: '#101B2D' });
  window.setTimeout(() => bridge?.fit(28, 1.5), 350);
}

export const useDiagramStore = create<DiagramStore>((set, get) => {
  const persisted = loadPersisted();
  const initialPages = persisted?.pages ?? [blankPage()];
  const initialActive = persisted?.active ?? 0;
  const initialPage = initialPages[initialActive];
  const initialModel = initialPage.model;
  const initialXml = initialPage.xml;

  const pushVersion = (label: string, pages: PageInfo[], active: number): void => {
    const state = get();
    const versions = [...state.versions.slice(-59), { label, snapshot: snapshotOf(pages, active), ts: Date.now() }];
    const versionIndex = versions.length - 1;
    set({ versions, versionIndex });
    persist({ pages, active, diagramType: state.diagramType, versions, messages: state.messages });
  };

  return {
    pages: initialPages,
    activePageIndex: initialActive,
    model: initialModel,
    xml: initialXml,
    diagramType: persisted?.diagramType ?? 'architecture',
    editorReady: false,
    editorError: null,
    loadingEditor: true,
    versions: persisted?.versions ?? [],
    versionIndex: persisted ? (persisted.versions.length - 1) : -1,
    messages: persisted?.messages ?? [],
    status: null,
    statusLabel: null,
    busy: false,
    provider: resolveProviderName() === 'mock' ? new MockProvider() : new DeepSeekProvider(),
    providerConfigured: true,
    providerModel: 'deepseek-v4-flash',
    providerBaseUrl: '',
    panelOpen: true,
    lastPrompt: null,
    lastError: null,

    refreshProviderInfo: async () => {
      try {
        const info = await fetchProviderConfig();
        const useMock = resolveProviderName() === 'mock' || !info.configured;
        set({
          providerConfigured: info.configured,
          providerModel: info.model,
          providerBaseUrl: info.baseUrl,
          provider: useMock ? new MockProvider() : new DeepSeekProvider(),
        });
        if (!info.configured && resolveProviderName() !== 'mock') {
          const msgs = get().messages;
          if (!msgs.some((m) => m.kind === 'info' && m.content.includes('DEEPSEEK_API_KEY'))) {
            set({
              messages: [
                ...msgs,
                {
                  id: `sys-${Date.now()}`,
                  role: 'system',
                  kind: 'info',
                  content:
                    '服务器未配置 DEEPSEEK_API_KEY，当前使用离线模拟模式。请在 .env 中配置并重启服务以使用 DeepSeek V4.1 Flash。',
                  ts: Date.now(),
                },
              ],
            });
          }
        }
      } catch {
        set({ providerConfigured: false });
      }
    },

    bindBridge: (b) => {
      bridge = b;
      if (b) {
        const s = get();
        const page = s.pages[s.activePageIndex];
        b.load(page.xml, { fit: true, autosave: true, title: page.name, background: '#101B2D' });
      }
    },

    setEditorReady: (ready) => {
      set({ editorReady: ready, loadingEditor: !ready });
    },

    setEditorError: (error) => set({ editorError: error, loadingEditor: false }),

    handleEditorAutosave: (xml, currentPage) => {
      if (!xml || !isSafeForEditor(xml)) return;
      const parsedPages = parseMultiPage(xml);
      if (!parsedPages) return;

      if (parsedPages.length === 1) {
        // update the ACTIVE page with the editor's serialization
        const state = get();
        const idx = state.activePageIndex;
        const cur = state.pages[idx];
        const parsed = parsedPages[0];
        const prevModel = cur.model;

        // mark user-moved nodes as manual (keep hand-tuned layout)
        const prevPos = new Map<string, [number | undefined, number | undefined]>();
        for (const c of prevModel.cells) {
          if (c.vertex && c.id) prevPos.set(c.id, [c.geometry?.x, c.geometry?.y]);
        }
        parsed.model.cells = parsed.model.cells.map((c) => {
          if (!c.vertex || !c.id) return c;
          const p = prevPos.get(c.id);
          if (p && c.geometry && (c.geometry.x !== p[0] || c.geometry.y !== p[1])) {
            return { ...c, attrs: { ...(c.attrs || {}), dmManual: '1' } };
          }
          return c;
        });
        const nextXml = serializeModel(parsed.model);

        const sigBefore = structureSig(cur.xml);
        const sigAfter = structureSig(nextXml);
        if (sigAfter !== sigBefore) {
          const pages = [...state.pages];
          pages[idx] = { ...cur, model: parsed.model, xml: nextXml };
          pushVersion('手动编辑', pages, idx);
          set({ pages, model: parsed.model, xml: nextXml });
        } else {
          const pages = [...state.pages];
          pages[idx] = { ...cur, model: parsed.model, xml: nextXml };
          set({ pages, model: parsed.model, xml: nextXml });
        }
      } else {
        // multi-page doc (e.g. imported via editor's "+") — adopt all pages
        const pages: PageInfo[] = parsedPages.map((p) => ({
          id: p.id,
          name: p.name,
          model: p.model,
          xml: p.xml,
        }));
        const active = Math.min(Math.max(0, currentPage ?? 0), pages.length - 1);
        pushVersion('页面变更', pages, active);
        set({
          pages,
          activePageIndex: active,
          model: pages[active].model,
          xml: pages[active].xml,
        });
      }
    },

    sendPrompt: async (text) => {
      const trimmed = text.trim();
      if (!trimmed || get().busy) return;
      set({
        busy: true,
        status: 'thinking',
        statusLabel: '思考中…',
        lastPrompt: trimmed,
        lastError: null,
        messages: [
          ...get().messages,
          { id: `u-${Date.now()}`, role: 'user', content: trimmed, ts: Date.now() },
        ],
      });
      abortController = new AbortController();
      const signal = abortController.signal;
      const state = get();
      const history = state.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const onStatus = (label: string) => {
        const map: Record<string, AgentStatus> = {
          '思考中…': 'thinking',
          '正在规划图表…': 'planning',
          '正在生成 XML…': 'generating',
          '正在校验操作…': 'validating',
          '正在校验 XML…': 'validating',
          '正在计算布局…': 'layout',
          '正在渲染…': 'rendering',
        };
        set({ status: map[label] ?? 'thinking', statusLabel: label });
      };

      try {
        const result = await runDiagramAgent(get().provider, trimmed, {
          model: get().model,
          diagramType: get().diagramType,
          history,
          onStatus,
          signal,
        });

        if (!result.changed) {
          set({
            status: 'idle',
            statusLabel: null,
            busy: false,
            messages: [
              ...get().messages,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                content: result.summary || '图表已经是最新状态。',
                ts: Date.now(),
              },
            ],
          });
          return;
        }

        // update the ACTIVE page
        const state2 = get();
        const idx = state2.activePageIndex;
        const pages = [...state2.pages];
        const nextPage: PageInfo = {
          ...pages[idx],
          name: pages[idx].name,
          model: result.model,
          xml: result.xml,
        };
        pages[idx] = nextPage;
        pushVersion(result.summary || 'AI 更新', pages, idx);
        set({
          pages,
          model: result.model,
          xml: result.xml,
          diagramType: result.diagramType,
          status: 'rendering',
          statusLabel: '正在渲染…',
        });

        const detail: string[] = [];
        if (result.rejected.length > 0) {
          detail.push(`已跳过：${result.rejected.slice(0, 3).join('；')}`);
        }
        if (result.fixes.length > 0) {
          detail.push(`已自动修复：${result.fixes.slice(0, 3).join('；')}`);
        }
        const content = [result.summary, ...detail].filter(Boolean).join('\n\n');
        set({
          messages: [
            ...get().messages,
            { id: `a-${Date.now()}`, role: 'assistant', content, ts: Date.now() },
          ],
        });
        loadActiveIntoEditor(get);
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        const message = aborted
          ? '已停止生成。'
          : err instanceof Error
            ? err.message
            : String(err);
        set({
          status: aborted ? 'idle' : 'error',
          statusLabel: aborted ? null : '生成失败',
          busy: false,
          lastError: aborted ? null : message,
          messages: [
            ...get().messages,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              kind: 'error',
              content: aborted
                ? '已停止生成。'
                : `无法应用此图表更新。\n${message}\n\n请重试。`,
              ts: Date.now(),
            },
          ],
        });
      } finally {
        abortController = null;
        if (get().busy) set({ busy: false });
        if (get().status !== 'error') set({ status: 'idle', statusLabel: null });
      }
    },

    stop: () => {
      abortController?.abort();
      set({ status: 'idle', statusLabel: null, busy: false });
    },

    undo: () => {
      const { versions, versionIndex } = get();
      if (versionIndex < 0) return;
      const idx = versionIndex - 1;
      if (idx < 0) {
        // initial blank state
        const pages = [blankPage()];
        set({ versions, versionIndex: -1, pages, activePageIndex: 0, model: pages[0].model, xml: pages[0].xml });
        loadActiveIntoEditor(get);
        return;
      }
      const restored = restoreFromSnapshot(versions[idx].snapshot);
      if (!restored) return;
      const active = restored.active;
      set({
        versions,
        versionIndex: idx,
        pages: restored.pages,
        activePageIndex: active,
        model: restored.pages[active].model,
        xml: restored.pages[active].xml,
      });
      loadActiveIntoEditor(get);
    },

    redo: () => {
      const { versions, versionIndex } = get();
      if (versionIndex >= versions.length - 1) return;
      const idx = versionIndex + 1;
      const restored = restoreFromSnapshot(versions[idx].snapshot);
      if (!restored) return;
      const active = restored.active;
      set({
        versions,
        versionIndex: idx,
        pages: restored.pages,
        activePageIndex: active,
        model: restored.pages[active].model,
        xml: restored.pages[active].xml,
      });
      loadActiveIntoEditor(get);
    },

    switchPage: (index) => {
      const state = get();
      if (index === state.activePageIndex || index < 0 || index >= state.pages.length) return;
      const page = state.pages[index];
      set({ activePageIndex: index, model: page.model, xml: page.xml });
      loadActiveIntoEditor(get);
    },

    addPage: () => {
      const state = get();
      const idx = state.pages.length;
      const page = blankPage(`页面 ${idx + 1}`);
      const pages = [...state.pages, page];
      pushVersion('新建页面', pages, idx);
      set({ pages, activePageIndex: idx, model: page.model, xml: page.xml });
      loadActiveIntoEditor(get);
    },

    renamePage: (index, name) => {
      const s = get();
      const clean = (name || '').trim().slice(0, 40);
      if (!clean || index < 0 || index >= s.pages.length) return;
      const pages = [...s.pages];
      pages[index] = { ...pages[index], name: clean, model: { ...pages[index].model, title: clean }, xml: pages[index].xml };
      set({ pages });
      if (index === s.activePageIndex) loadActiveIntoEditor(get);
    },

    deletePage: (index) => {
      const s = get();
      if (s.pages.length <= 1) return;
      const pages = s.pages.filter((_, i) => i !== index);
      const active = s.activePageIndex === index ? Math.max(0, index - 1) : (s.activePageIndex > index ? s.activePageIndex - 1 : s.activePageIndex);
      const page = pages[active];
      pushVersion('删除页面', pages, active);
      set({ pages, activePageIndex: active, model: page.model, xml: page.xml });
      loadActiveIntoEditor(get);
    },

    importXml: (xml, name) => {
      const parsedPages = parseMultiPage(xml);
      if (!parsedPages) {
        set({
          messages: [
            ...get().messages,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              kind: 'error',
              content: `无法导入“${name}”：不是有效的 draw.io XML。`,
              ts: Date.now(),
            },
          ],
        });
        return;
      }
      const pages: PageInfo[] = parsedPages.map((p) => ({ id: p.id, name: p.name, model: p.model, xml: p.xml }));
      const title = name.replace(/\.(drawio|xml)$/i, '');
      if (pages.length === 1) pages[0].name = title || pages[0].name;
      const active = 0;
      pushVersion(`导入“${title}”`, pages, active);
      set({
        pages,
        activePageIndex: active,
        model: pages[0].model,
        xml: pages[0].xml,
        messages: [
          ...get().messages,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            content: `已导入“${title}”（${pages.length} 页）。你可以让我继续修改，例如“加一个 Redis 缓存层”。`,
            ts: Date.now(),
          },
        ],
      });
      loadActiveIntoEditor(get);
    },

    exportDiagram: async (format) => {
      const s = get();
      const name = s.pages[s.activePageIndex].name.replace(/[^\w\u4e00-\u9fa5-]+/g, '-') || 'diagram';
      try {
        if (format === 'xml' || format === 'drawio') {
          // export the whole document (all pages)
          const { serializeMultiPage } = await import('../diagram/generator');
          const doc = serializeMultiPage(s.pages);
          downloadText(doc, `${name}.${format === 'drawio' ? 'drawio' : 'xml'}`);
        } else if (format === 'svg') {
          const res = await bridge?.export('svg', { scale: 1, border: 16, background: '#ffffff' });
          if (res?.data) downloadDataUri(res.data, `${name}.svg`);
        } else if (format === 'png') {
          const res = await bridge?.export('png', {
            scale: 2,
            border: 16,
            background: '#ffffff',
            spinKey: 'exporting',
            message: '正在导出 PNG…',
          });
          if (res?.data) downloadDataUri(res.data, `${name}.png`);
        }
      } catch (err) {
        set({
          messages: [
            ...get().messages,
            {
              id: `a-${Date.now()}`,
              role: 'assistant',
              kind: 'error',
              content: `导出失败：${err instanceof Error ? err.message : '未知错误'}`,
              ts: Date.now(),
            },
          ],
        });
      }
    },

    setPanelOpen: (open) => set({ panelOpen: open }),

    retryLast: async () => {
      const last = get().lastPrompt;
      if (last) await get().sendPrompt(last);
    },

    resetConversation: () => {
      set({ messages: [], lastPrompt: null, lastError: null });
    },

    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      const pages = [blankPage()];
      set({
        pages,
        activePageIndex: 0,
        model: pages[0].model,
        xml: pages[0].xml,
        diagramType: 'architecture',
        editorReady: false,
        editorError: null,
        loadingEditor: true,
        versions: [],
        versionIndex: -1,
        messages: [],
        status: null,
        statusLabel: null,
        busy: false,
        panelOpen: true,
        lastPrompt: null,
        lastError: null,
      });
    },
  };
});

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadDataUri(dataUri: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUri;
  a.download = filename;
  a.click();
}

export { buildDiagramState };
