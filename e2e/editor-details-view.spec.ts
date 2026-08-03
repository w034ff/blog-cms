import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, docString } from './editor-probe';

// The accordion's editor chrome (docs/accordion-requirements.md §5.1, §7.3, §8.2): the toggle's
// Japanese label, the untitled placeholder, and the rule that folding is a view action — it must
// not touch the document, or every collapse would mark the post dirty and fire autosave.

const DETAILS = '.ProseMirror [data-type="details"]';

test('the toggle carries a Japanese label and folds without touching the document', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  const toggle = page.locator(`${DETAILS} > button`);
  const body = page.locator(`${DETAILS} [data-type="detailsContent"]`);

  // Closed to begin with, as the public page renders it.
  await expect(toggle).toHaveAttribute('aria-label', '折りたたみを開く');
  await expect(body).toBeHidden();

  const before = await markdown(page);
  const docBefore = await docString(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', '折りたたみを閉じる');
  await expect(body).toBeVisible();

  // The open state lives in the NodeView, not in the document: same doc, same markdown, so
  // nothing marks the post dirty.
  expect(await docString(page)).toBe(docBefore);
  expect(await markdown(page)).toBe(before);

  await toggle.click();
  await expect(body).toBeHidden();
  expect(await markdown(page)).toBe(before);
});

// The placeholder is a ::before, which is not reachable through toHaveCSS — that reports the
// element's own computed style.
function summaryMarker(page: Page): Promise<string> {
  return page.evaluate(() => {
    const summary = document.querySelector('.ProseMirror summary');
    if (!summary) throw new Error('no summary in the editor');
    return getComputedStyle(summary, '::before').content;
  });
}

test('an untitled accordion shows a placeholder but still saves', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  expect(await summaryMarker(page)).toContain('タイトル');

  // §5.1: an empty title is allowed through save and publish — the placeholder is the whole of
  // the safeguard, so the markdown must still be produced.
  expect(await markdown(page)).toBe('<details>\n<summary></summary>\n\n</details>');

  await page.keyboard.type('題名');
  expect(await summaryMarker(page)).not.toContain('タイトル');
});

test('the published page folds and unfolds', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('accordion-public');
  await loadMarkdown(page, '<details>\n<summary>詳細</summary>\n\n畳まれた本文\n\n</details>\n');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '投稿' }).click();
  await expect(page.getByText('公開済み（最新）')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('link', { name: '表示' }).click();
  await page.waitForURL(/\/posts\//);

  const details = page.locator('article details');
  await expect(details).toHaveCount(1);
  await expect(page.getByText('畳まれた本文')).toBeHidden();

  await details.getByText('詳細').click();
  await expect(page.getByText('畳まれた本文')).toBeVisible();
});
