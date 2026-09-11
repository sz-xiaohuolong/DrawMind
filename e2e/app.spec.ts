import { test, expect, type Page } from '@playwright/test';

/**
 * End-to-end: the full loop
 *   natural language → (mock) agent → ops → XML → draw.io editor
 *   → user edits in the editor → autosave → host model → next AI turn
 * State is observed via the store exposed at window.__drawmind.
 */

const MOCK_URL = '/?provider=mock';

async function waitForXml(page: Page, matcher: (xml: string) => boolean, timeout = 60_000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const xml = await page.evaluate(() => {
      const s = (window as unknown as { __drawmind?: { getState: () => { xml: string } } }).__drawmind;
      return s?.getState().xml ?? '';
    });
    if (matcher(xml)) return xml;
    await page.waitForTimeout(400);
  }
  throw new Error('timeout waiting for diagram XML');
}

function labelsFromXml(xml: string): string[] {
  const labels: string[] = [];
  const re = /<mxCell\b[^>]*\bvalue="([^"]*)"[^>]*vertex="1"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const label = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    if (label && !label.includes('mxfile')) labels.push(label);
  }
  return labels;
}

async function sendPrompt(page: Page, text: string) {
  await page.getByPlaceholder('描述你想画的图…').fill(text);
  await page.getByRole('button', { name: '发送' }).click();
  // the assistant reply with the prompt text appears once the turn completes
  await expect(page.locator('aside').getByText(text, { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(MOCK_URL);
  // editor (embed.diagrams.net) must come up
  await page.getByText('正在加载 draw.io 编辑器…').waitFor({ state: 'hidden', timeout: 60_000 });
});

test('creates a RAG architecture and keeps it editable', async ({ page }) => {
  await sendPrompt(
    page,
    'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
  );
  const xml = await waitForXml(page, (x) => x.includes('Milvus') && x.includes('LLM'));
  const labels = labelsFromXml(xml);
  expect(labels).toContain('Milvus');
  expect(labels).toContain('LLM');
  expect(labels).toContain('PostgreSQL');
  expect(xml).toContain('<mxGraphModel');
  expect(xml).toContain('mxGeometry');
  // the canvas really shows the nodes
  const frame = page.frames().find((f) => f.url().includes('diagrams.net'))!;
  await expect(frame.getByText('Milvus', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});

test('multi-turn editing: replace node, then add a node — same diagram', async ({ page }) => {
  await sendPrompt(
    page,
    'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
  );
  const v1 = await waitForXml(page, (x) => x.includes('Milvus'));
  const countV1 = labelsFromXml(v1).length;

  await sendPrompt(page, 'Replace Milvus with pgvector');
  const v2 = await waitForXml(page, (x) => x.includes('pgvector') && !x.includes('Milvus'));
  expect(labelsFromXml(v2).length).toBe(countV1);

  await sendPrompt(page, 'Add Redis but keep my current layout');
  const v3 = await waitForXml(page, (x) => x.includes('Redis'));
  const labels3 = labelsFromXml(v3);
  expect(labels3).toContain('Redis');
  expect(labels3).toContain('pgvector');
  expect(labels3.length).toBe(countV1 + 1);
});

test('user edits in the editor sync back to the AI (Editor → AI)', async ({ page }) => {
  await sendPrompt(
    page,
    'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
  );
  await waitForXml(page, (x) => x.includes('Milvus'));
  const frame = page.frames().find((f) => f.url().includes('diagrams.net'))!;

  // select the Milvus node on the canvas and delete it with the keyboard
  const node = frame.getByText('Milvus', { exact: true }).first();
  await expect(node).toBeVisible({ timeout: 15_000 });
  const box = await node.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.press('Delete');

  // autosave → store model drops the node → AI now sees the current diagram
  await waitForXml(page, (x) => x.includes('Milvus') === false, 30_000);
  // and the next AI turn understands the change
  await sendPrompt(page, 'What is in my diagram now?');
  await expect(page.locator('aside').getByText(/current|diagram|contains/i).first()).toBeVisible({ timeout: 30_000 });
});

test('undo/redo restores previous diagram versions', async ({ page }) => {
  await sendPrompt(
    page,
    'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
  );
  await waitForXml(page, (x) => x.includes('Milvus'));
  await sendPrompt(page, 'Replace Milvus with pgvector');
  await waitForXml(page, (x) => x.includes('pgvector'));

  await page.getByRole('button', { name: '撤销' }).click();
  const undone = await waitForXml(page, (x) => x.includes('Milvus') && !x.includes('pgvector'));
  expect(undone).toContain('Milvus');

  await page.getByRole('button', { name: '重做' }).click();
  const redone = await waitForXml(page, (x) => x.includes('pgvector') && !x.includes('Milvus'));
  expect(redone).toContain('pgvector');
});

test('export .drawio then re-import — structure preserved', async ({ page }) => {
  await sendPrompt(
    page,
    'Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL',
  );
  const xml = await waitForXml(page, (x) => x.includes('Milvus'));

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出' }).click();
  await page.getByRole('button', { name: '.drawio — 可编辑 XML（全部页面）' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();

  const fs = await import('node:fs/promises');
  const content = await fs.readFile(path!);
  expect(content.toString('utf-8')).toContain('<mxfile');
  expect(content.toString('utf-8')).toContain('Milvus');

  await page.locator('input[type=file]').setInputFiles({
    name: 'exported.drawio',
    mimeType: 'application/octet-stream',
    buffer: content,
  });
  const imported = await waitForXml(page, (x) => x.includes('Milvus') && x.includes('PostgreSQL'));
  expect(labelsFromXml(imported).sort()).toEqual(labelsFromXml(xml).sort());
});

test('mindmap and sequence diagrams render', async ({ page }) => {
  await sendPrompt(page, 'Create a Java interview mind map');
  const mind = await waitForXml(page, (x) => x.includes('Java'));
  expect(labelsFromXml(mind).length).toBeGreaterThanOrEqual(3);

  await sendPrompt(
    page,
    'Draw an AI Agent tool calling sequence diagram with User, Agent, LLM, Tool and Database',
  );
  const seq = await waitForXml(page, (x => x.includes('User') && x.includes('LLM') && x.includes('exitDy=')));
  expect(seq).toContain('exitDy=');
});
