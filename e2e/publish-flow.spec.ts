import { test, expect } from '@playwright/test';
import {
  expectAutosaved,
  expectDraft,
  expectPublishPending,
  expectPublished,
  ensureCategory,
} from './editor-authoring';
import { publishedPath } from './published-post';

// The publish lifecycle: autosave creates the row (URL sync) → 投稿 → edit → 更新. The action result
// is adopted during render (useAutosave's acceptSaved), so a regression shows as a render-phase
// error or a stuck status.
test('a new post autosaves, publishes, and takes further edits', async ({ page }) => {
  // Render-phase violations arrive in dev as console errors, not page errors: watch both.
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Cannot update|Maximum update depth/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('E2E publish flow');
  await editor.click();
  await page.keyboard.type('Publish me.');

  // The first autosave creates the row; the address syncs to its edit URL without navigating.
  await expectAutosaved(page);
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expectDraft(page);

  // Published in place: published-current, and the button reads 更新.
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await expect(page.getByRole('button', { name: '更新' })).toBeVisible();

  // The public address from the row: the editor never shows the slug, assigned by the first autosave
  // (app/api/drafts/route.ts). Publishing makes it serve.
  const published = await publishedPath(page);
  expect(published).toMatch(/^\/posts\/[0-9a-f]+$/);

  // Editing the live post marks it ahead of the public one.
  await editor.click();
  await page.keyboard.type(' More.');
  await expectPublishPending(page);
  await expect(page.getByText(/保存中/)).toBeVisible();

  // 更新 with the edit unsaved: the queued autosave is cancelled and the publish result settles it
  // (acceptSaved).
  await page.getByRole('button', { name: '更新' }).click();
  await expectPublished(page);
  await expectAutosaved(page);

  // 表示 is on the list row, shown for a published post with a slug.
  await page.goto('/admin');
  // By the row's title link: other specs' titles could overlap a substring.
  const row = page.locator('li', {
    has: page.getByRole('link', { name: 'E2E publish flow', exact: true }),
  });
  await expect(row.getByRole('link', { name: '表示' })).toHaveAttribute('href', published);

  // 未公開の変更 is where this state shows outside the editor; just updated, nothing to report.
  await expect(row.getByText('未公開の変更')).toHaveCount(0);

  // Edit and leave unpublished: the badge comes from draft_content, autosave's doing.
  await row.getByRole('link', { name: 'E2E publish flow', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' Left unpublished.');
  await expectAutosaved(page);
  await page.goto('/admin');
  await expect(row.getByText('未公開の変更')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

// 保存済み ✓ is a confirmation that fades; the state behind it stays, which is why the suite waits on
// the attribute.
test('保存済み ✓ fades, and the state behind it does not', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E saved notice');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Body.');

  const notice = page.getByText('保存済み ✓');
  await expect(notice).toBeVisible({ timeout: 20_000 });
  await expect(notice).toBeHidden({ timeout: 10_000 });
  await expectAutosaved(page);

  // The next save raises it again.
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' More.');
  await expect(notice).toBeVisible({ timeout: 20_000 });
});

// Placing the caret is not an edit: TrailingNode appends on the first transaction after load, so on
// a post ending in a list the placing click carried it, @tiptap emitted `update`, and autosave made
// a `draft_content` row, so the post showed changes nobody made. The body ends in a list, or there
// is nothing to append.
test('placing the caret does not arm autosave', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E caret is not an edit');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Intro.\n');
  await page.keyboard.type('- one\n');
  await page.keyboard.type('two');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror li')).not.toHaveCount(0);
  const row = page.locator('[data-autosave-state]');
  await expect(row).toHaveAttribute('data-autosave-state', 'idle');

  await page.locator('.ProseMirror p').first().click();
  await page.waitForTimeout(2500); // well past AUTOSAVE_DELAY_MS (800)
  await expect(row).toHaveAttribute('data-autosave-state', 'idle');
  await expect(page.locator('[data-publish-state]')).toHaveAttribute(
    'data-publish-state',
    'published-current',
  );

  // Nothing reached the list.
  await page.goto('/admin');
  const listRow = page.locator('li', {
    has: page.getByRole('link', { name: 'E2E caret is not an edit', exact: true }),
  });
  await expect(listRow).toHaveCount(1);
  await expect(listRow.getByText('未公開の変更')).toHaveCount(0);
});
