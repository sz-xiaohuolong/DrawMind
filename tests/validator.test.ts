import { describe, it, expect } from 'vitest';
import { createBlankModel, serializeModel } from '../src/diagram/generator';
import { validateModel, validateXml, repairModel, validateAndRepair, isSafeForEditor } from '../src/diagram/validator';
import type { Cell } from '../src/diagram/types';

function node(id: string, opts: Partial<Cell> = {}): Cell {
  return {
    id,
    parent: '1',
    vertex: true,
    value: id,
    style: 'rounded=1;',
    geometry: { x: 0, y: 0, width: 100, height: 50 },
    ...opts,
  };
}

describe('Model validator', () => {
  it('accepts a healthy model', () => {
    const model = createBlankModel();
    model.cells.push(node('a'), node('b'));
    model.cells.push({
      id: 'e', parent: '1', edge: true, source: 'a', target: 'b',
      geometry: { relative: true },
    });
    const r = validateModel(model);
    expect(r.ok).toBe(true);
  });

  it('catches duplicate ids', () => {
    const model = createBlankModel();
    model.cells.push(node('a'), node('a'));
    const r = validateModel(model);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('catches dangling edge endpoints', () => {
    const model = createBlankModel();
    model.cells.push(node('a'));
    model.cells.push({ id: 'e', parent: '1', edge: true, source: 'a', target: 'ghost', geometry: { relative: true } });
    const r = validateModel(model);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('missing target'))).toBe(true);
  });

  it('catches invalid geometry', () => {
    const model = createBlankModel();
    model.cells.push(node('a', { geometry: { x: 0, y: 0, width: -5, height: 50 } }));
    const r = validateModel(model);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('width'))).toBe(true);
  });

  it('validates raw XML strings', () => {
    const good = serializeModel(createBlankModel('x'));
    expect(validateXml(good).ok).toBe(true);
    expect(validateXml('<broken><unclosed').ok).toBe(false);
    expect(validateXml('<mxfile></mxfile>').ok).toBe(false); // no mxGraphModel
  });
});

describe('Repair pipeline', () => {
  it('drops dangling edges and fixes duplicates', () => {
    const model = createBlankModel();
    model.cells.push(node('a'), node('a'));
    model.cells.push({
      id: 'e1', parent: '1', edge: true, source: 'a', target: 'nope', geometry: { relative: true },
    });
    const { model: repaired, fixes } = repairModel(model);
    expect(fixes.length).toBeGreaterThan(0);
    const ids = repaired.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(repaired.cells.find((c) => c.id === 'e1')).toBeUndefined();
    expect(validateModel(repaired).ok).toBe(true);
  });

  it('repairs a broken XML string end-to-end', () => {
    const model = createBlankModel();
    model.cells.push(node('a'));
    model.cells.push({ id: 'bad', parent: '1', edge: true, source: 'a', target: 'missing', geometry: { relative: true } });
    const xml = serializeModel(model);
    const r = validateAndRepair(xml);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBeLessThanOrEqual(3);
    expect(r.fixes.length).toBeGreaterThan(0);
  });

  it('fails gracefully on garbage input', () => {
    const r = validateAndRepair('### not xml');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('blocks unsafe content from reaching the editor', () => {
    expect(isSafeForEditor('<mxfile><script>alert(1)</script></mxfile>')).toBe(false);
    expect(isSafeForEditor('<mxfile><object data="x"></object></mxfile>')).toBe(false);
    expect(isSafeForEditor(serializeModel(createBlankModel()))).toBe(true);
  });
});
