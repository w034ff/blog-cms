import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { expectAutosaved } from './editor-authoring';

// The ⋯ on a 記事一覧 row (app/admin/(list)/PostRowMenu.tsx).

async function draftTitled(page: Page, title: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文です。');
  await expectAutosaved(page);
}

function rowFor(page: Page, title: string): Locator {
  return page.locator('li', { has: page.getByRole('link', { name: title, exact: true }) });
}

// Deleting takes a second, deliberate click: nothing brings a post back. The first click must not delete, やめる must leave the row, and only
// 削除する removes it.
test('a post is deleted from 記事一覧 only after 削除する', async ({ page }) => {
  const title = `E2E delete ${Date.now()}`;
  await draftTitled(page, title);

  await page.goto('/admin');
  const row = rowFor(page, title);
  const more = row.getByRole('button', { name: 'その他の操作' });

  await more.click();
  await row.getByRole('button', { name: '削除', exact: true }).click();
  // The safe answer holds focus, so an Enter right after 削除 does not delete.
  await expect(row.getByRole('button', { name: 'やめる' })).toBeFocused();
  await row.getByRole('button', { name: 'やめる' }).click();
  await expect(row.getByRole('button', { name: '削除する' })).toHaveCount(0);
  await expect(more).toBeFocused();

  await page.reload();
  await expect(row).toHaveCount(1);

  await more.click();
  await row.getByRole('button', { name: '削除', exact: true }).click();
  await row.getByRole('button', { name: '削除する' }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(row).toHaveCount(0);
});

// The file is the stored markdown under the importer's frontmatter (lib/post-markdown.ts), named
// after the title — the Japanese reaches the browser through `filename*`.
test('Markdown をダウンロード saves the post as a .md named after its title', async ({ page }) => {
  const title = `E2E 書き出し ${Date.now()}`;
  await draftTitled(page, title);

  await page.goto('/admin');
  const row = rowFor(page, title);
  await row.getByRole('button', { name: 'その他の操作' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    row.getByRole('link', { name: 'Markdown をダウンロード' }).click(),
  ]);

  expect(download.suggestedFilename()).toBe(`${title}.md`);
  const text = await readFile(await download.path(), 'utf8');
  expect(text).toContain(`title: ${title}`);
  expect(text).toContain('draft: true');
  expect(text).toContain('本文です。');
  // The list is still there: the link downloads rather than navigating.
  await expect(page).toHaveURL(/\/admin$/);
});
