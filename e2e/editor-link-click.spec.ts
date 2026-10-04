import { test, expect, type Page } from '@playwright/test';
import { caret, docString, markdown } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// StarterKit's `openOnClick: true` sent a click on a link to window.open, so its text could not be
// edited or the link removed; PostEditor passes `openOnClick: false` (docs/link-requirements.md §3,
// §8). window.open is stubbed: a no-op click looks like a popup not yet opened.

const MD = '前[リンク](https://example.com "タイトル")後\n';
const DOC = 'doc(paragraph("前", link("リンク"), "後"))';

async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as Window & { __opened?: string[] };
    w.__opened = [];
    window.open = (url?: string | URL) => {
      w.__opened?.push(String(url ?? ''));
      return null;
    };
  });
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
  expect(await docString(page)).toBe(DOC);
}

function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []);
}

test('clicking a link in the editor does not open it', async ({ page }) => {
  await openEditor(page);
  await page.locator('.ProseMirror a').click();
  expect(await openedUrls(page)).toEqual([]);
});

test('clicking a link in the editor places the caret in it', async ({ page }) => {
  await openEditor(page);
  await page.locator('.ProseMirror a').click();

  // Polls the editor's selection, which lags a click. Offsets 1..4 are inside 「リンク」.
  await expect
    .poll(async () => {
      const at = await caret(page);
      const offset = Number(at.split('@')[1]);
      return at.startsWith('前リンク後@') && offset >= 1 && offset <= 4;
    })
    .toBe(true);
});

test('a link survives the markdown round trip with its title', async ({ page }) => {
  await openEditor(page);
  // Losing `title` would silently edit a published post.
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('typing a URL still autolinks', async ({ page }) => {
  await openEditor(page);
  await setRange(page, 1);
  await page.keyboard.type('https://example.org ');

  // The merge must leave the other defaults: autolink stays on (§4).
  expect(await docString(page)).toContain('link("https://example.org")');
});
