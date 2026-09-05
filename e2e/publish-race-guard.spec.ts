import { test, expect } from '@playwright/test';

// The third term of `publishDisabled` (components/PostEditor.tsx):
//
//   pending || (isPublished && !pendingPublish) || (!hasIdentity && autosaveState === 'saving')
//
// A brand-new post has no row until its first autosave creates one. Publishing inside that window
// submits an empty `id`, which app/actions/posts.ts answers with its create-and-publish path — a
// second row for the same post. The guard is what stops the click, and nothing measured it: the
// existing publish-flow spec drives the happy path, where the save has long since landed.
//
// The window is a few milliseconds against a local server, so it is held open here by stalling the
// autosave request rather than by racing it.
const TITLE = 'E2E race guard';

test('投稿 is refused while a brand-new post’s first autosave is still creating its row', async ({
  page,
}) => {
  // Typed with an initializer rather than `| null`: TypeScript does not track an assignment made
  // inside a Promise executor, so a nullable binding narrows to `never` and the call below fails
  // to compile.
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
  // The autosave debounce is 800ms; once it fires, the request is held above.
  await expect(publish).toBeDisabled({ timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/admin\/posts\/\d+\/edit$/); // no row yet

  // Try to publish anyway. A disabled submit must not reach the server.
  await publish.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/\/admin\/posts\/\d+\/edit$/);

  release();
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  await expect(publish).toBeEnabled();

  // Exactly one row carries this title.
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: TITLE, exact: true })).toHaveCount(1);
});
