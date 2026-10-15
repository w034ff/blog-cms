import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import {
  closePostSettings,
  expectAutosaved,
  expectPublished,
  openPostSettings,
} from './editor-authoring';
import { TEST_DB_PATH } from './constants';
import { tabTitle } from '../app/shared-metadata';

// Reads a post row directly from the harness's SQLite DB copy (e2e/published-post.ts).
function readDbPost(id: number): { kind: string; draft: number; slug: string } {
  const db = new Database(TEST_DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT kind, draft, slug FROM posts WHERE id = ?').get(id) as
      { kind: string; draft: number; slug: string } | undefined;
    expect(row, `no post row with id ${id}`).toBeTruthy();
    return row as { kind: string; draft: number; slug: string };
  } finally {
    db.close();
  }
}

async function rowId(page: Page): Promise<number> {
  const raw = await page.locator('input[name="id"]').inputValue();
  expect(raw, 'the editor has no row id yet').toMatch(/^\d+$/);
  return Number(raw);
}

test('scribble authoring, listing, settings, and publish flow', async ({ page }) => {
  // 1. Navigate from left menu to /admin/scribbles and open scribble editor via SiteHeader
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();

  const scribbleNav = page
    .getByRole('navigation', { name: '管理' })
    .getByRole('link', { name: '走り書き' });
  await scribbleNav.click();
  await expect(page).toHaveURL(/\/admin\/scribbles$/);
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();

  await page.getByRole('button', { name: '投稿する' }).click();
  await page
    .getByRole('navigation', { name: 'アカウント' })
    .getByRole('link', { name: '走り書き' })
    .click();
  await expect(page).toHaveURL(/\/admin\/posts\/new\?kind=scribble$/);
  await expect(page).toHaveTitle(tabTitle('新しい走り書き'));

  const backLink = page.locator('.editor-back-link');
  await expect(backLink).toHaveAttribute('href', '/admin/scribbles');
  await expect(backLink).toHaveAttribute('aria-label', '走り書き');

  // 2. Settings panel check on scribble: no category or thumbnail, tag field exists
  const toggle = page.getByRole('button', { name: '記事の設定' });
  await toggle.click();
  const scribblePanel = page.locator('#post-settings-panel');
  await expect(scribblePanel).toBeVisible();
  await expect(scribblePanel.getByText('カテゴリ')).toHaveCount(0);
  await expect(scribblePanel.locator('input[name="category"]')).toHaveCount(0);
  await expect(scribblePanel.getByText('サムネイル')).toHaveCount(0);
  await expect(scribblePanel.locator('input[type="file"]')).toHaveCount(0);
  await expect(scribblePanel.getByText('タグ')).toBeVisible();
  await closePostSettings(page);

  // Compare with article editor settings panel (§8 row 9): has all 3 fields
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await openPostSettings(page);
  const articlePanel = page.locator('#post-settings-panel');
  await expect(articlePanel.getByText('カテゴリ')).toBeVisible();
  await expect(articlePanel.locator('input[name="category"]').first()).toBeAttached();
  await expect(articlePanel.getByText('サムネイル')).toBeVisible();
  await expect(articlePanel.getByText('タグ')).toBeVisible();
  await closePostSettings(page);

  // Return to new scribble editor
  await page.goto('/admin/posts/new?kind=scribble');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // 3. Write title and body: autosave creates a scribble row
  const title = `E2E 走り書き ${Date.now()}`;
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('これは走り書きの本文です。');
  await expectAutosaved(page);

  const id = await rowId(page);
  const initialRow = readDbPost(id);
  expect(initialRow.kind).toBe('scribble');
  expect(initialRow.draft).toBe(1);

  // Check scribble list shows the draft, article list does not (§8 row 8)
  await page.goto('/admin/scribbles');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();
  const draftRow = page.locator('li', {
    has: page.getByRole('link', { name: title, exact: true }),
  });
  await expect(draftRow).toBeVisible();
  await expect(draftRow.getByText('下書き')).toBeVisible();

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '記事一覧' })).toBeVisible();
  await expect(page.getByRole('link', { name: title, exact: true })).toHaveCount(0);

  // 4. Publish without category: succeeds and row becomes draft = 0
  await page.goto(`/admin/posts/${id}/edit`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  const publishedRow = readDbPost(id);
  expect(publishedRow.kind).toBe('scribble');
  expect(publishedRow.draft).toBe(0);

  // 5. Listing and 表示 link: points to /scribbles/<slug>
  await page.goto('/admin/scribbles');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();
  const publishedListRow = page.locator('li', {
    has: page.getByRole('link', { name: title, exact: true }),
  });
  await expect(publishedListRow).toBeVisible();

  const viewLink = publishedListRow.getByRole('link', { name: '表示' });
  await expect(viewLink).toHaveAttribute('href', `/scribbles/${publishedRow.slug}`);

  // PostRowMenu 表示 link (sm:hidden, shown on mobile) also points to /scribbles/<slug>
  await publishedListRow.getByRole('button', { name: 'その他の操作' }).click();
  const menuViewLink = publishedListRow
    .locator('.admin-popup')
    .getByRole('link', { name: '表示', includeHidden: true });
  await expect(menuViewLink).toHaveAttribute('href', `/scribbles/${publishedRow.slug}`);

  // 6. Category query param is ignored on scribble list (§6): ?category=tech still shows the scribble
  await page.goto('/admin/scribbles?category=tech');
  await expect(page.getByRole('heading', { name: '走り書き' })).toBeVisible();
  const categorizedListRow = page.locator('li', {
    has: page.getByRole('link', { name: title, exact: true }),
  });
  await expect(categorizedListRow).toBeVisible();
});
