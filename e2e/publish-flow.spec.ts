import { test, expect } from '@playwright/test';
import {
  expectAutosaved,
  expectDraft,
  expectPublishPending,
  expectPublished,
} from './editor-authoring';
import { publishedPath } from './published-post';

// The full publish lifecycle over the isolated DB: create → autosave materializes
// the row (URL sync) → 投稿 → edit the live post (pending changes) → 更新.
// This is the path that adopts the action result during render (acceptSaved in
// the useAutosave hook), so a regression there surfaces as a React render-phase
// error or a stuck status line — both asserted here.
test('a new post autosaves, publishes, and takes further edits', async ({ page }) => {
  // Render-phase violations ("Cannot update a component…", "Maximum update
  // depth…") arrive as console errors in dev, not page errors — watch both.
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

  // The first autosave materializes the row: the indicator flips to 保存済み ✓
  // and the address bar syncs to the new row's edit URL without a navigation.
  await expectAutosaved(page);
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expectDraft(page);

  // Publish. The editor adopts the action result in place: the row's publish state flips to
  // published-current and the button relabels to 更新.
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await expect(page.getByRole('button', { name: '更新' })).toBeVisible();

  // The post's public address. Read from the row rather than from the screen: the editor never
  // showed the slug, and the 表示 link that used to carry it here has moved to the 記事一覧 row
  // (checked at the end of this test, once the post is in its final state). The slug itself came
  // from the autosave above — app/api/drafts/route.ts assigns one at row creation — so what
  // publishing changes is that the address now serves.
  const published = await publishedPath(page);
  expect(published).toMatch(/^\/posts\/[0-9a-f]+$/);

  // Editing the live post flags it as ahead of the public version and dirty.
  await editor.click();
  await page.keyboard.type(' More.');
  await expectPublishPending(page);
  await expect(page.getByText(/保存中/)).toBeVisible();

  // 更新 while the edit is still unsaved: submitting cancels the queued autosave
  // and the publish result itself must settle the dirty state (acceptSaved) —
  // the indicator flips to 保存済み ✓ without an autosave round-trip.
  await page.getByRole('button', { name: '更新' }).click();
  await expectPublished(page);
  await expectAutosaved(page);

  // Where 表示 lives now. Its two gates are a slug (assigned above) and the post not being a
  // draft, so this row — a post that has been through publish and 更新 — is the state it is for.
  await page.goto('/admin');
  // Pinned by the row's own title link rather than by hasText: every spec in the run publishes
  // into this list, and a substring match would go ambiguous the moment two titles overlap.
  const row = page.locator('li', {
    has: page.getByRole('link', { name: 'E2E publish flow', exact: true }),
  });
  await expect(row.getByRole('link', { name: '表示' })).toHaveAttribute('href', published);

  // 未公開の変更 is the only place this state can be noticed once the editor is closed — inside
  // it the same thing is the publish button being pressable. The post was just 更新'd, so the
  // list has nothing to report about it yet.
  await expect(row.getByText('未公開の変更')).toHaveCount(0);

  // Edit it again and leave without publishing. The badge is derived from draft_content, which
  // is autosave's doing, so 保存済み is the thing to wait for — not a publish.
  await row.getByRole('link', { name: 'E2E publish flow', exact: true }).click();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' Left unpublished.');
  await expectAutosaved(page);
  await page.goto('/admin');
  await expect(row.getByText('未公開の変更')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

// 保存済み ✓ is a confirmation, not a status: `savedAt` never returns to null, so left alone the
// notice became permanent furniture after the first save of the session. It now goes away, while
// the state behind it stays — which is the split this asserts, and the reason every wait in the
// suite reads the attribute instead of the words.
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

  // The next save raises it again — a faded notice is not a spent one.
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(' More.');
  await expect(notice).toBeVisible({ timeout: 20_000 });
});

// Placing the caret is not an edit, and it took a fix to stay that way. TrailingNode appends its
// empty paragraph on the first transaction after load rather than at load, because it has none to
// ride until then — so on a post whose last block is a list, heading, table or fence, the click
// that placed the caret carried the append, @tiptap emitted `update` for the round, and autosave
// ran. Measured 2026-09-13: the stored markdown was identical (an empty trailing paragraph does
// not serialize) but a `draft_content` row appeared, so a published post read as carrying changes
// nobody made — and after the 未公開の変更 badge, said so in the list.
//
// The body deliberately ends in a list: end it with a paragraph and there is nothing to append,
// and the case passes without testing anything.
test('placing the caret does not arm autosave', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('E2E caret is not an edit');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('Intro.\n');
  await page.keyboard.type('- one\n');
  await page.keyboard.type('two');
  await expectAutosaved(page);
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

  // And nothing reached the list either.
  await page.goto('/admin');
  const listRow = page.locator('li', {
    has: page.getByRole('link', { name: 'E2E caret is not an edit', exact: true }),
  });
  await expect(listRow).toHaveCount(1);
  await expect(listRow.getByText('未公開の変更')).toHaveCount(0);
});
