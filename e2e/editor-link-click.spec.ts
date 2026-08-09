import { test, expect, type Page } from '@playwright/test';
import { caret, docString, markdown } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The link mark comes from StarterKit with its defaults, one of which — `openOnClick: true` — sent
// a left click on a link straight to window.open. Inside an editor that meant the caret could never
// be placed in a link's text, so the text could not be edited and (there being no toolbar control
// for links) the link could not be removed either. PostEditor now passes
// `link: { openOnClick: false }`. See docs/link-requirements.md §3 and §8.
//
// window.open is stubbed rather than watched for a popup: a click that does nothing is indis-
// tinguishable from a popup that has not opened yet, and "wait and see if a tab appears" is exactly
// the shape of assertion that passes for the wrong reason.

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

  // state.selection lags a caret-placing click, so this polls the editor's own selection rather
  // than reading the DOM's once (the same trap the table cell-selection work hit in 2026-07-29).
  // 「前リンク後」: offsets 1..4 are inside the link's text.
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
  // The one real link in the seeded corpus carries a title, and the public sanitizer keeps `title`
  // on an <a>, so losing it here would be a silent edit of a published post.
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('typing a URL still autolinks', async ({ page }) => {
  await openEditor(page);
  await setRange(page, 1);
  await page.keyboard.type('https://example.org ');

  // Guards the option merge rather than autolink itself: `StarterKit.configure({ link: { … } })`
  // has to leave the other link defaults alone, or turning off openOnClick would quietly turn off
  // autolink too — which docs/link-requirements.md §4 decided to keep.
  expect(await docString(page)).toContain('link("https://example.org")');
});
