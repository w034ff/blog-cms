import { test, expect } from '@playwright/test';
import { expectAutosaved } from './editor-authoring';

// The third term of `publishDisabled` (components/PostEditor.tsx):
//
//   pending || (isPublished && !pendingPublish) || (!hasIdentity && autosaveState === 'saving')
//
// Before the first autosave creates the row, a publish submits an empty `id`, which
// app/actions/posts.ts answers with create-and-publish: a second row. The window is held open by
// stalling the autosave request.
const TITLE = 'E2E race guard';

test('投稿 is refused while a brand-new post’s first autosave is still creating its row', async ({
  page,
}) => {
  // An initializer, not `| null`: TypeScript does not track assignment inside a Promise executor, so a
  // nullable binding narrows to `never`.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let drafts = 0;
  await page.route('**/api/drafts', async (route) => {
    drafts += 1;
    if (drafts === 1) await held; // hold only the first, which is the row-creating one
    await route.continue();
  });

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await page.getByLabel('タイトル').fill(TITLE);
  await editor.click();
  await page.keyboard.type('本文です。');

  const publish = page.getByRole('button', { name: '投稿' });
  // After the 800ms debounce the request is held.
  await expect(publish).toBeDisabled({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/admin\/posts\/\d+\/edit$/); // no row yet

  // A disabled submit must not reach the server.
  await publish.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/\/admin\/posts\/\d+\/edit$/);

  release();
  await expectAutosaved(page);
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expect(publish).toBeEnabled();

  // One row with this title.
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: TITLE, exact: true })).toHaveCount(1);
});
