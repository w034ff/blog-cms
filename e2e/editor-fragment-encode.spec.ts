import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';

// What the stored markdown of a fragment link looks like across an open/close (§2.2.2, and the
// last unmeasured item §9 carried for it).
//
// markdown-it normalizes an href as it parses: `normalizeLink('#見出し')` returns
// `#%E8%A6%8B%E5%87%BA%E3%81%97`, and running it again returns the same string. The mark therefore
// holds the *normalized* value from the first read onward, and tiptap-markdown serializes the mark's
// attribute — so what comes back out is not what the author typed. §2.2.1 measured that at the
// `setContent` → `getMarkdown` level. What was never measured is the storage layer: whether the
// autosave that actually runs in the app rewrites a saved post's body, and whether it needs the
// author to touch anything first.
//
// The three cases below are three separate observations on purpose. The middle one is the one the
// document guessed at, and a reader has to be able to tell which half moved.
//
// **`posts.body`, because that is where a draft's autosave puts it.** Measured 2026-08-27:
// `/api/drafts` writes `body` directly while `draft` is 1, and `draft_content` stays null — that
// column holds the pending working copy of an *already published* post, which is a different route
// and out of scope here.
//
// The document has a real `## 見出し` above the link so that the fragment resolves. Resolvability
// has nothing to do with the encoding — normalizeLink never sees the document — but a reader
// should not be left wondering whether it does.

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
  // Guards the column choice above: if a post under test ever stopped being a draft, `body` would
  // be the published text and this file would be reading the wrong thing without saying so.
  expect(row.draft).toBe(1);
  return row.body;
}

// A post whose body holds a heading and a link to it, typed the way an author types them: the
// `[]()` input rule (§5.4) makes the link, so nothing has been through markdown-it yet.
async function writeFragmentPost(page: Page): Promise<number> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill('fragment encode');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`## ${HEADING}\n`);
  await page.keyboard.type(`[断片](${READABLE})`);
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
  return Number(/\/admin\/posts\/(\d+)\/edit/.exec(page.url())?.[1]);
}

test('what the author typed is what gets stored (15a)', async ({ page }) => {
  // The readable form survives the first save: this body has not been read by markdown-it yet.
  const id = await writeFragmentPost(page);
  expect(storedBody(id)).toContain(`[断片](${READABLE})`);
});

test('reopening and touching nothing does not rewrite the stored body (15b)', async ({ page }) => {
  // The half §2.2.2 guessed at. Autosave arms on an edit (`onDirty` → `markEdited`), and loading a
  // document into the editor is not one — so the encoded form the editor now holds stays in the
  // editor. **The rewrite is not spontaneous.** Waited well past the 800ms debounce.
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
  // The consequence that does land. The author adds a paragraph *below* the link; the save that
  // follows writes back the whole body, and the untouched line above it comes out percent-encoded.
  // A diff of that save shows a change to a line the author did not edit — which is the whole of
  // why §2.2.2 is written down.
  const id = await writeFragmentPost(page);

  await page.goto(`/admin/posts/${id}/edit`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.locator('.ProseMirror a')).toHaveCount(1);
  await page.locator('.ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('追記');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

  const after = storedBody(id);
  expect(after).toContain('追記');
  expect(after).toContain(`[断片](${ENCODED})`);
  expect(after).not.toContain(READABLE);
});
