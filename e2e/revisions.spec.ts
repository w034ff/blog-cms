import { test, expect, type Page } from '@playwright/test';
import {
  expectAutosaved,
  expectPublishPending,
  expectPublished,
  openPostSettings,
} from './editor-authoring';
import { STORAGE_STATE } from './constants';

// docs/revision-requirements.md §8, rows 9-12: the wiring only a browser shows — the リビジョン履歴
// entry's gate, the preview route, and the restore's trip back into a freshly mounted editor. What gets kept and pruned is lib/revisions.test.ts's.

const editor = (page: Page) => page.locator('.ProseMirror');

// A new post with a row and a body, saved. Returns its edit URL.
async function newPost(page: Page, title: string, body: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(editor(page)).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await editor(page).click();
  await page.keyboard.type(body);
  await expectAutosaved(page);
  await expect(page).toHaveURL(/\/admin\/posts\/\d+\/edit$/);
  return new URL(page.url()).pathname;
}

// Opens a fresh editing session on the post and types at the end of the body.
async function appendInNewSession(page: Page, editPath: string, text: string): Promise<void> {
  await page.goto(editPath);
  await expect(editor(page)).toBeVisible();
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
  await expectAutosaved(page);
}

async function openHistory(page: Page): Promise<void> {
  await openPostSettings(page);
  await page.getByRole('button', { name: 'リビジョン履歴' }).click();
  await expect(page.getByRole('heading', { name: 'リビジョン履歴' })).toBeVisible();
}

test('a previous published version can be restored, without publishing it (row 9)', async ({
  page,
}) => {
  const editPath = await newPost(page, `E2E revision ${Date.now()}`, '最初の本文');
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await appendInNewSession(page, editPath, ' 追記');
  await page.getByRole('button', { name: '更新' }).click();
  await expectPublished(page);

  await openHistory(page);
  await page.getByRole('link', { name: /以前の公開記事/ }).click();
  await expect(page.getByRole('status')).toContainText('リビジョンのプレビュー');
  await expect(page.locator('#post-body')).toContainText('最初の本文');
  await expect(page.locator('#post-body')).not.toContainText('追記');

  await page.getByRole('button', { name: '復元する', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${editPath}$`));
  await expect(editor(page)).toContainText('最初の本文');
  await expect(editor(page)).not.toContainText('追記');
  // Restored into the working copy, not published: the live post still carries the update.
  await expectPublishPending(page);
});

test('リビジョン履歴 cannot be pressed while an edit is unsaved (row 10)', async ({ page }) => {
  await newPost(page, `E2E revision gate ${Date.now()}`, '本文');
  await openPostSettings(page);
  const history = page.getByRole('button', { name: 'リビジョン履歴' });
  await expect(history).toBeEnabled();

  // A field in the drawer arms autosave like the body does, and keeps the drawer open to watch.
  await page.getByLabel('タグ（カンマ区切り）').fill('gate');
  await expect(history).toBeDisabled();
  await expectAutosaved(page);
  await expect(history).toBeEnabled();
});

test('restoring the live version discards pending edits (row 11)', async ({ page }) => {
  const editPath = await newPost(page, `E2E revision discard ${Date.now()}`, '公開した本文');
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  await appendInNewSession(page, editPath, ' 未公開の追記');
  await expectPublishPending(page);

  await openHistory(page);
  // The same badge 記事一覧 uses marks the row while there is something to discard.
  const liveRow = page.getByRole('link', { name: /公開中の記事/ });
  await expect(liveRow.getByText('未公開の変更', { exact: true })).toBeVisible();
  await liveRow.click();
  await expect(page.locator('#post-body')).not.toContainText('未公開の追記');
  await page.getByRole('button', { name: '未公開の変更を破棄' }).click();

  await expect(page).toHaveURL(new RegExp(`${editPath}$`));
  await expectPublished(page);
  await expect(editor(page)).not.toContainText('未公開の追記');
  await expect(page.getByRole('button', { name: '更新' })).toBeDisabled();

  // What was discarded is itself a revision, so the discard can be undone.
  await openHistory(page);
  await expect(page.getByRole('link', { name: /復元する前/ })).toBeVisible();
});

test.describe('with no session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('?rev= is ignored and the live post is served (row 12)', async ({ page, browser }) => {
    const authed = await browser.newContext({ storageState: STORAGE_STATE });
    let publicPath: string;
    let revisionHref: string;
    try {
      const author = await authed.newPage();
      const editPath = await newPost(author, `E2E revision public ${Date.now()}`, '公開中の本文');
      await author.getByRole('button', { name: '投稿' }).click();
      await expectPublished(author);
      // An update is what keeps the previous published version as a revision.
      await appendInNewSession(author, editPath, ' 二回目');
      await author.getByRole('button', { name: '更新' }).click();
      await expectPublished(author);

      await openHistory(author);
      const href = await author.getByRole('link', { name: /以前の公開記事/ }).getAttribute('href');
      expect(href).toMatch(/^\/posts\/[0-9a-f]+\?rev=\d+$/);
      revisionHref = href as string;
      publicPath = revisionHref.split('?')[0];
    } finally {
      await authed.close();
    }

    for (const path of [revisionHref, `${publicPath}?rev=live`]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('#post-body')).toContainText('二回目');
      await expect(page.getByText('リビジョンのプレビュー')).toHaveCount(0);
    }
  });
});
