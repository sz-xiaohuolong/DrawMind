import { test, expect, type Page } from '@playwright/test';

/**
 * 多页面：点击「新建页面」在下方新增一页，保留已有页面；AI 只修改当前页。
 */

async function getXml(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __drawmind?: { getState: () => { xml: string } } }).__drawmind?.getState().xml ?? '',
  );
}

test('新建页面：新增一页并保留已有页面，AI 只修改当前页', async ({ page }) => {
  await page.goto('/?provider=mock');
  await page.getByText('正在加载 draw.io 编辑器…').waitFor({ state: 'hidden', timeout: 60_000 });

  // 第 1 页生成架构图
  await page.getByPlaceholder('描述你想画的图…').fill('Create a RAG architecture with User, API Gateway, Agent, Embedding Model, Milvus, LLM and PostgreSQL');
  await page.getByRole('button', { name: '发送' }).click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().xml.includes('Milvus'), null, { timeout: 30000 });

  // 点击「新建页面」→ 出现第 2 页，自动切到第 2 页（空白）
  await page.getByRole('button', { name: '新建页面' }).first().click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().pages.length === 2, null, { timeout: 15000 });
  let xml = await getXml(page);
  expect(xml).not.toContain('Milvus');

  // 第 1 页内容保留
  const pages1 = await page.evaluate(() => (window as any).__drawmind.getState().pages);
  expect(pages1[0].xml).toContain('Milvus');
  expect(pages1[0].name).toBe('页面 1');
  expect(pages1[1].name).toBe('页面 2');

  // 切回第 1 页 → 图还在
  await page.getByText('页面 1', { exact: true }).click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().activePageIndex === 0, null, { timeout: 15000 });
  xml = await getXml(page);
  expect(xml).toContain('Milvus');

  // 第 2 页上让 AI 画流程图 → 只改第 2 页
  await page.getByText('页面 2', { exact: true }).click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().activePageIndex === 1, null, { timeout: 15000 });
  await page.getByPlaceholder('描述你想画的图…').fill('画一个用户登录流程');
  await page.getByRole('button', { name: '发送' }).click();
  await page.waitForFunction(
    () =>
      (window as any).__drawmind.getState().pages[1].xml.includes('登录') ||
      (window as any).__drawmind.getState().pages[1].xml.includes('Start'),
    null,
    { timeout: 30000 },
  );
  // 第 1 页仍是 RAG 架构
  const pages2 = await page.evaluate(() => (window as any).__drawmind.getState().pages);
  expect(pages2[0].xml).toContain('Milvus');
  expect(pages2[0].xml).not.toContain('登录');
});

test('重命名与删除页面', async ({ page }) => {
  await page.goto('/?provider=mock');
  await page.getByText('正在加载 draw.io 编辑器…').waitFor({ state: 'hidden', timeout: 60_000 });
  await page.getByRole('button', { name: '新建页面' }).first().click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().pages.length === 2, null, { timeout: 15000 });

  // 双击重命名
  await page.locator('div[title="双击重命名"]').filter({ hasText: '页面 2' }).dblclick();
  await page.keyboard.type('架构图');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as any).__drawmind.getState().pages[1].name === '架构图', null, { timeout: 10000 });

  // 删除第 2 页 → 回到第 1 页
  await page.locator('div[title="双击重命名"]').filter({ hasText: '架构图' }).hover();
  await page.locator('button[title="删除页面"]').first().click();
  await page.waitForFunction(() => (window as any).__drawmind.getState().pages.length === 1, null, { timeout: 10000 });
  expect(await page.evaluate(() => (window as any).__drawmind.getState().activePageIndex)).toBe(0);
});
