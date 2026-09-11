import type { Cell, Geometry, Model } from './types';
import { parseDocument, parseXmlString } from './parser';
import { serializeModel } from './generator';

/**
 * XML / Model validation with a bounded auto-repair pipeline.
 * Never lets malformed content reach the editor or crash the page.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateGeometry(g: Geometry | undefined, errors: string[], where: string): void {
  if (!g) return;
  const nums = [g.x, g.y, g.width, g.height];
  for (const n of nums) {
    if (n !== undefined && !Number.isFinite(n)) {
      errors.push(`${where}: geometry contains non-finite number`);
      return;
    }
  }
  if (g.relative !== true) {
    if (g.width !== undefined && g.width <= 0) errors.push(`${where}: width must be > 0`);
    if (g.height !== undefined && g.height <= 0) errors.push(`${where}: height must be > 0`);
  }
  for (const p of [...(g.points || []), ...(g.sourcePoint ? [g.sourcePoint] : []), ...(g.targetPoint ? [g.targetPoint] : [])]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      errors.push(`${where}: edge point contains non-finite number`);
      return;
    }
  }
}

/** Validate model invariants. */
export function validateModel(model: Model): ValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();
  const vertexIds = new Set<string>();

  for (const cell of model.cells) {
    if (!cell.id) {
      errors.push('cell without id found');
      continue;
    }
    if (ids.has(cell.id)) {
      errors.push(`duplicate cell id "${cell.id}"`);
    }
    ids.add(cell.id);
    if (cell.vertex) vertexIds.add(cell.id);
  }

  if (!ids.has('0')) errors.push('missing root cell id=0');
  if (model.layerIds.length === 0) errors.push('missing layer cells');

  for (const cell of model.cells) {
    if (cell.edge) {
      if (!cell.source || !vertexIds.has(cell.source)) {
        errors.push(`edge "${cell.id}" has missing source "${cell.source}"`);
      }
      if (!cell.target || !vertexIds.has(cell.target)) {
        errors.push(`edge "${cell.id}" has missing target "${cell.target}"`);
      }
      if (cell.source && cell.target && cell.source === cell.target) {
        errors.push(`edge "${cell.id}" is a self-loop`);
      }
    }
    validateGeometry(cell.geometry, errors, `cell "${cell.id}"`);
  }

  return { ok: errors.length === 0, errors };
}

/** Validate a raw XML string (syntax + structure). */
export function validateXml(xml: string): ValidationResult {
  const doc = parseXmlString(xml);
  if (!doc) return { ok: false, errors: ['XML syntax error'] };
  const graph = doc.getElementsByTagName('mxGraphModel')[0];
  if (!graph) return { ok: false, errors: ['missing <mxGraphModel>'] };
  const model = parseDocument(doc);
  return validateModel(model);
}

/** Deterministic repair pass over a model. */
export function repairModel(model: Model): { model: Model; fixes: string[] } {
  const fixes: string[] = [];
  const seen = new Map<string, number>();
  const cells: Cell[] = model.cells.map((cell) => {
    const id = cell.id || 'cell';
    const count = seen.get(id) || 0;
    seen.set(id, count + 1);
    if (count > 0) {
      fixes.push(`renamed duplicate id "${id}" -> "${id}-${count}"`);
      return { ...cell, id: `${id}-${count}` };
    }
    return cell;
  });

  const idSet = new Set(cells.map((c) => c.id));
  const vertexIds = new Set(cells.filter((c) => c.vertex).map((c) => c.id));

  let repaired = cells.filter((c) => {
    if (c.edge && (!c.source || !vertexIds.has(c.source) || !c.target || !vertexIds.has(c.target))) {
      fixes.push(`dropped dangling edge "${c.id}"`);
      return false;
    }
    return true;
  });

  repaired = repaired.map((c) => {
    const cell = { ...c, geometry: c.geometry ? { ...c.geometry } : undefined };
    if (cell.geometry && !cell.geometry.relative) {
      if (cell.geometry.width !== undefined && cell.geometry.width <= 0) {
        cell.geometry.width = 100;
        fixes.push(`fixed width of "${cell.id}"`);
      }
      if (cell.geometry.height !== undefined && cell.geometry.height <= 0) {
        cell.geometry.height = 50;
        fixes.push(`fixed height of "${cell.id}"`);
      }
    }
    return cell;
  });

  // Ensure root + at least one layer exist
  const hasRoot = repaired.some((c) => c.id === '0');
  if (!hasRoot) {
    repaired = [{ id: '0' }, ...repaired];
    fixes.push('added missing root cell');
  }
  let layerIds = model.layerIds.filter((id) => idSet.has(id));
  if (layerIds.length === 0) {
    const layerId = '1';
    if (!repaired.some((c) => c.id === layerId)) {
      repaired = [repaired[0], { id: layerId, parent: '0' }, ...repaired.slice(1)];
    }
    layerIds = [layerId];
    fixes.push('added missing layer');
  }
  // reparent layer cells under root
  repaired = repaired.map((c) =>
    layerIds.includes(c.id) ? { ...c, parent: '0' } : c,
  );

  return {
    model: { ...model, cells: repaired, rootId: '0', layerIds },
    fixes,
  };
}

/** Repair an XML string: parse → repair → re-serialize. Returns null when unrecoverable. */
export function repairXml(xml: string): { xml: string; fixes: string[] } | null {
  const doc = parseXmlString(xml);
  if (!doc) return null;
  const graph = doc.getElementsByTagName('mxGraphModel')[0];
  if (!graph) return null;
  const model = parseDocument(doc);
  const { model: repaired, fixes } = repairModel(model);
  return { xml: serializeModel(repaired), fixes };
}

/** Validate-and-repair pipeline with a bounded retry budget. */
export function validateAndRepair(
  xml: string,
  maxAttempts = 3,
): { xml: string; ok: boolean; attempts: number; fixes: string[]; errors: string[] } {
  let current = xml;
  let fixes: string[] = [];
  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    const result = validateXml(current);
    if (result.ok) {
      return { xml: current, ok: true, attempts, fixes, errors: [] };
    }
    const repaired = repairXml(current);
    if (!repaired) break;
    fixes = fixes.concat(repaired.fixes);
    current = repaired.xml;
  }
  const final = validateXml(current);
  return {
    xml: current,
    ok: final.ok,
    attempts,
    fixes,
    errors: final.errors,
  };
}

/** Sanity check used before handing XML to the editor. */
export function isSafeForEditor(xml: string): boolean {
  if (xml.length > 10_000_000) return false; // sanity cap
  const doc = parseXmlString(xml);
  if (!doc) return false;
  const scripts = doc.getElementsByTagName('script');
  if (scripts.length > 0) return false;
  const objects = doc.getElementsByTagName('object');
  if (objects.length > 0) return false;
  return true;
}
