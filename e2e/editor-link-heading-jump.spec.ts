import { test, expect, type Page } from '@playwright/test';
import { caret, caretPos, settle } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// The card's top line for a link to a heading in this document (docs/link-requirements.md §5.5.18).
// `window.open('#導入')` opened a second editor at a fragment nothing there answers, so going to the
// heading is the operation, and the only check on a fragment gone stale after a rename.

const FILLER = Array.from({ length: 25 }, (_, i) => `段落 ${i + 1} — 本文の行。\n`);

const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}

async function openEditor(page: Page, md: string) {
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
  await loadMarkdown(page, md);
}

// The caret into the link whose text is `text`, which brings the card up over it.
async function caretInLink(page: Page, text: string) {
  await page.locator('.ProseMirror a', { hasText: text }).click();
  await expect(card(page)).toBeVisible();
}

test('the top line goes to the heading and scrolls to it', async ({ page }) => {
  // Mid-document: as the first node it could not be centred, and the checks would measure the clamp.
  await openEditor(
    page,
    [...FILLER, '## 導入', '', ...FILLER, '前[リンク](#導入)後', ''].join('\n'),
  );
  await caretInLink(page, 'リンク');
  const scrolledTo = await page.evaluate(() => window.scrollY);
  expect(scrolledTo).toBeGreaterThan(0); // the link is far enough down for "scrolled up" to mean something

  await card(page).getByRole('button', { name: '見出しへ移動' }).click();
  await settle(page);

  // At the start of the heading's own line.
  expect(await caret(page)).toBe('導入@0');
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(scrolledTo);

  // Where it landed: the transaction's minimal scroll ignores the `sticky top-0` toolbar, which covered
  // the heading (§5.5.18).
  const placement = await page.evaluate(() => {
    const heading = document.querySelector('.ProseMirror h2')!.getBoundingClientRect();
    const toolbar = document.querySelector('.sticky.top-0')!.getBoundingClientRect();
    return {
      headingTop: heading.top,
      headingBottom: heading.bottom,
      toolbarBottom: toolbar.bottom,
      viewportHeight: window.innerHeight,
    };
  });
  expect(placement.headingTop).toBeGreaterThan(placement.toolbarBottom);
  expect(placement.headingBottom).toBeLessThan(placement.viewportHeight);
  // Centred, with the paragraphs around it.
  expect(placement.headingTop).toBeGreaterThan(placement.viewportHeight / 4);
  // The caret left the link, so the card went by itself.
  await expect(card(page)).toBeHidden();
  // And no tab was opened on the way.
  expect(await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual(
    [],
  );
});

test('a fragment naming no heading says so and moves nothing', async ({ page }) => {
  // What a renamed heading leaves behind.
  await openEditor(page, ['## 導入', '', ...FILLER, '前[リンク](#はじめに)後', ''].join('\n'));
  await caretInLink(page, 'リンク');
  const before = await caretPos(page);

  await card(page).getByRole('button', { name: '見出しへ移動' }).click();
  await expect(page.getByText('この文書にその見出しはありません')).toBeVisible();
  expect(await caretPos(page)).toBe(before);
  await expect(card(page)).toBeVisible();
});

test('a heading inside a folded accordion says so rather than moving into it', async ({ page }) => {
  // A reader's <details> opens for its fragment, so the link works; the preview cannot go there (a
  // caret in `display: none` scrolls nowhere), and nothing is unfolded for the author (§5.5.18).
  await openEditor(
    page,
    [
      '<details>',
      '<summary>タイトル</summary>',
      '',
      '## 畳んだ見出し',
      '',
      '</details>',
      '',
      ...FILLER,
      '前[リンク](#畳んだ見出し)後',
      '',
    ].join('\n'),
  );
  // Loaded folded, as a reader gets it (docs/accordion-requirements.md §5).
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
  await caretInLink(page, 'リンク');
  const before = await caretPos(page);

  await card(page).getByRole('button', { name: '見出しへ移動' }).click();
  await expect(page.getByText('折りたたまれた中にあるため移動できません')).toBeVisible();
  expect(await caretPos(page)).toBe(before);
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
});

test('a link that is not a fragment still opens in a new tab', async ({ page }) => {
  // The branch is on the href, so the URL side is measured too (§5.5.6-2, criterion 4e).
  await openEditor(page, ['## 導入', '', '前[外部リンク](https://example.com)後', ''].join('\n'));
  await caretInLink(page, '外部リンク');
  await expect(card(page).getByRole('button', { name: '見出しへ移動' })).toHaveCount(0);
  await card(page).getByRole('button', { name: 'リンク先を開く' }).click();
  expect(await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual([
    'https://example.com',
  ]);
});
