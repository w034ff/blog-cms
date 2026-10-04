import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved } from './editor-authoring';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';

// A fragment link's stored form across open/close (§2.2.2). `normalizeLink('#見出し')` gives
// `#%E8%A6%8B%E5%87%BA%E3%81%97` (idempotent), the mark keeps that, and tiptap-markdown serializes
// it. Unmeasured until here: whether the app's autosave rewrites a saved body, and when. Three
// separate observations, so a reader can tell which moved.
//
// **`posts.body`**: a draft's autosave writes `body` (`draft` 1); `draft_content` is a published
// post's working copy. The heading is there so the fragment resolves, which the encoding ignores.

const HEADING = '見出し';
const READABLE = '#見出し';
const ENCODED = '#%E8%A6%8B%E5%87%BA%E3%81%97';

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

function storedBody(id: number): string {
  const db = new Database(TEST_DB_PATH, { readonly: true });
  const row = db.prepare('SELECT body, draft FROM posts WHERE id = ?').get(id) as {
    body: string;
    draft: number;
  };
  db.close();
  if (!row) throw new Error(`no post ${id}`);
  // Guards the column choice: a non-draft's `body` is the published text.
  expect(row.draft).toBe(1);
  return row.body;
}

// Typed through the `[]()` rule (§5.4), so markdown-it has not read it yet.
async function writeFragmentPost(page: Page): Promise<number> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('fragment encode');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`## ${HEADING}\n`);
  await page.keyboard.type(`[断片](${READABLE})`);
  await expectAutosaved(page);
  await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
  return Number(/\/admin\/posts\/(\d+)\/edit/.exec(page.url())?.[1]);
}

test('what the author typed is what gets stored (15a)', async ({ page }) => {
  // The first save keeps the readable form.
  const id = await writeFragmentPost(page);
  expect(storedBody(id)).toContain(`[断片](${READABLE})`);
});

test('reopening and touching nothing does not rewrite the stored body (15b)', async ({ page }) => {
  // §2.2.2's guess: autosave arms on an edit (`onDirty` → `markEdited`), and a load is not one.
  // **No spontaneous rewrite**, well past the 800ms debounce.
  const id = await writeFragmentPost(page);
  const before = storedBody(id);

  await page.goto(`/admin/posts/${id}/edit`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);
  await page.waitForTimeout(2500);

  expect(storedBody(id)).toBe(before);
  expect(storedBody(id)).toContain(`[断片](${READABLE})`);
});

test('the next unrelated edit carries the rewrite with it (15c)', async ({ page }) => {
  // An edit below the link rewrites the whole body, encoding the untouched line: a diff line the
  // author never edited, why §2.2.2 exists.
  const id = await writeFragmentPost(page);

  await page.goto(`/admin/posts/${id}/edit`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('追記');
  await expectAutosaved(page);

  const after = storedBody(id);
  expect(after).toContain('追記');
  expect(after).toContain(`[断片](${ENCODED})`);
  expect(after).not.toContain(READABLE);
});
