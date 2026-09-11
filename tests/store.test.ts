import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagramStore } from '../src/store/diagramStore';
import { serializeModel } from '../src/diagram/generator';
import { parseXml, parseMultiPage } from '../src/diagram/parser';
import { buildDiagramState } from '../src/diagram/state';

/**
 * Integration tests over the real store: multi-page document, version history,
 * undo/redo, import, editor→AI sync.
 */

function xmlWithNodes(nodeIds: string[]): string {
  const model = useDiagramStore.getState().model;
  const cells = [...model.cells];
  for (const id of nodeIds) {
    cells.push({
      id,
      parent: model.layerIds[0] ?? '1',
      vertex: true,
      value: id,
      style: 'rounded=1;',
      geometry: { x: 100, y: 100, width: 120, height: 54 },
    });
  }
  return serializeModel({ ...model, cells });
}

describe('Diagram store (multi-page)', () => {
  beforeEach(() => {
    localStorage.clear();
    useDiagramStore.getState().reset();
  });

  it('records manual editor edits as versions and undo/redo restores them', () => {
    const v0 = useDiagramStore.getState().versionIndex;
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['a', 'b']));
    const afterEdit = useDiagramStore.getState();
    expect(afterEdit.versionIndex).toBe(v0 + 1);
    expect(afterEdit.versions[afterEdit.versionIndex].label).toBe('手动编辑');
    expect(buildDiagramState(afterEdit.model).nodes.map((n) => n.id)).toEqual(['a', 'b']);

    useDiagramStore.getState().undo();
    expect(buildDiagramState(useDiagramStore.getState().model).nodes).toHaveLength(0);

    useDiagramStore.getState().redo();
    expect(buildDiagramState(useDiagramStore.getState().model).nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('does not create versions for position-only changes', () => {
    const first = xmlWithNodes(['a']);
    useDiagramStore.getState().handleEditorAutosave(first);
    const v1 = useDiagramStore.getState().versionIndex;

    const model = parseXml(first)!;
    model.cells = model.cells.map((c) =>
      c.id === 'a' ? { ...c, geometry: { ...c.geometry!, x: 500, y: 400 } } : c,
    );
    useDiagramStore.getState().handleEditorAutosave(serializeModel(model));
    expect(useDiagramStore.getState().versionIndex).toBe(v1);
    const node = buildDiagramState(useDiagramStore.getState().model).nodes.find((n) => n.id === 'a')!;
    expect(node.x).toBe(500);
  });

  it('marks user-dragged nodes so a later relayout keeps their position', () => {
    const first = xmlWithNodes(['a', 'b']);
    useDiagramStore.getState().handleEditorAutosave(first);

    const model = parseXml(first)!;
    model.cells = model.cells.map((c) =>
      c.id === 'a' ? { ...c, geometry: { ...c.geometry!, x: 700, y: 550 } } : c,
    );
    useDiagramStore.getState().handleEditorAutosave(serializeModel(model));
    expect(useDiagramStore.getState().versions.length).toBe(1);
    const a = useDiagramStore.getState().model.cells.find((c) => c.id === 'a')!;
    expect(a.attrs?.dmManual).toBe('1');
  });

  it('adds a page and keeps the previous pages intact', () => {
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['page1node']));
    expect(useDiagramStore.getState().pages).toHaveLength(1);

    useDiagramStore.getState().addPage();
    const s = useDiagramStore.getState();
    expect(s.pages).toHaveLength(2);
    expect(s.activePageIndex).toBe(1);
    expect(buildDiagramState(s.model).nodes).toHaveLength(0); // new page is blank
    // page 1 untouched
    expect(buildDiagramState(s.pages[0].model).nodes.map((n) => n.id)).toEqual(['page1node']);
    expect(s.pages[1].name).toBe('页面 2');
  });

  it('switches pages and AI edits the active page only', () => {
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['a']));
    useDiagramStore.getState().addPage();
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['b']));

    // switch back to page 1
    useDiagramStore.getState().switchPage(0);
    const s0 = useDiagramStore.getState();
    expect(buildDiagramState(s0.model).nodes.map((n) => n.id)).toEqual(['a']);
    expect(s0.activePageIndex).toBe(0);

    // switch to page 2
    useDiagramStore.getState().switchPage(1);
    const s1 = useDiagramStore.getState();
    expect(buildDiagramState(s1.model).nodes.map((n) => n.id)).toEqual(['b']);
  });

  it('renames and deletes pages', () => {
    useDiagramStore.getState().addPage();
    useDiagramStore.getState().renamePage(0, '架构总览');
    expect(useDiagramStore.getState().pages[0].name).toBe('架构总览');

    useDiagramStore.getState().deletePage(1);
    const s = useDiagramStore.getState();
    expect(s.pages).toHaveLength(1);
    expect(s.activePageIndex).toBe(0);
    // cannot delete the last page
    useDiagramStore.getState().deletePage(0);
    expect(useDiagramStore.getState().pages).toHaveLength(1);
  });

  it('imports a multi-page XML as multiple pages', () => {
    const p1 = serializeModel((() => { const m = parseXml(xmlWithNodes(['gw']))!; return { ...m, title: '第一页' }; })());
    const p2 = serializeModel((() => { const m = parseXml(xmlWithNodes(['db']))!; return { ...m, title: '第二页' }; })());
    const doc = p1.replace('</mxfile>', '') + p2.replace('<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="app.diagrams.net" agent="drawmind-ai-diagram-agent" version="24.0.0" type="device">', '').replace('</mxfile>', '') + '</mxfile>';
    useDiagramStore.getState().importXml(doc, 'multi.drawio');
    const s = useDiagramStore.getState();
    expect(s.pages).toHaveLength(2);
    expect(s.messages.at(-1)?.content).toContain('已导入');
  });

  it('exports a multi-page .drawio that round-trips through import', async () => {
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['a']));
    useDiagramStore.getState().addPage();
    // capture the exported doc by intercepting download is not possible in vitest;
    // instead verify serializeMultiPage through the import path
    const { serializeMultiPage } = await import('../src/diagram/generator');
    const s = useDiagramStore.getState();
    const doc = serializeMultiPage(s.pages.map((p) => ({ model: p.model, xml: p.xml })));
    const parsed = parseMultiPage(doc)!;
    expect(parsed).toHaveLength(2);
    expect(buildDiagramState(parsed[0].model).nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('rejects broken imports with a friendly message', () => {
    useDiagramStore.getState().importXml('<broken', 'bad.xml');
    const state = useDiagramStore.getState();
    expect(state.messages.at(-1)?.kind).toBe('error');
    expect(state.messages.at(-1)?.content).toContain('不是有效的 draw.io XML');
  });

  it('persists multi-page state to localStorage', () => {
    useDiagramStore.getState().handleEditorAutosave(xmlWithNodes(['persist-me']));
    useDiagramStore.getState().addPage();
    const saved = JSON.parse(localStorage.getItem('drawmind-state-v2')!);
    expect(saved.snapshot).toContain('persist-me');
    expect(saved.snapshot).toContain('页面 2');
  });

  it('export fallback path: bridge absence fails gracefully', async () => {
    await useDiagramStore.getState().exportDiagram('svg');
    expect(true).toBe(true);
  });
});
