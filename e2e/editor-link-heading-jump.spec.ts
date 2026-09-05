import { test, expect, type Page } from '@playwright/test';
import { caret, caretPos, settle } from './editor-probe';
import { loadMarkdown } from './editor-authoring';

// The card's top line for a link that points at a heading in this same document (docs/
// link-requirements.md §5.5.18). `window.open('#導入')` resolved against the editor's own URL and
// opened a second copy of the editor at a fragment nothing there answers to — the ids belong to the
// published page — so the press did nothing an author could see. Going to the heading is the
// operation that exists here, and it doubles as the only check on a fragment that has gone stale:
// renaming a heading breaks every link already pointing at it, silently, on both surfaces.

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
  // The target sits in the middle of the document, with filler on both sides. As the first node it
  // could not be centred — the page would run out of document above it and clamp — and the
  // placement assertions below would then be measuring the clamp rather than the scroll.
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

  // Where it landed, not just that it moved. The transaction's own scroll is the minimum one and
  // knows nothing about the toolbar, which is `sticky top-0` and painted over the top of the
  // scrollport — measured before this was fixed, the heading sat at y=5 under a toolbar whose lower
  // edge was y=29, so the jump "worked" and the line could not be read (§5.5.18).
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
  // Centred rather than merely clear of the toolbar: it is a line the author has jumped to in order
  // to look at it, so it comes with the paragraphs on both sides of it.
  expect(placement.headingTop).toBeGreaterThan(placement.viewportHeight / 4);
  // The caret left the link, so the card takes itself away — nothing closes it by hand.
  await expect(card(page)).toBeHidden();
  // And no tab was opened on the way.
  expect(await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual(
    [],
  );
});

test('a fragment naming no heading says so and moves nothing', async ({ page }) => {
  // The shape a renamed heading leaves behind, which is the case this button exists to catch.
  await openEditor(page, ['## 導入', '', ...FILLER, '前[リンク](#はじめに)後', ''].join('\n'));
  await caretInLink(page, 'リンク');
  const before = await caretPos(page);

  await card(page).getByRole('button', { name: '見出しへ移動' }).click();
  await expect(page.getByText('この文書にその見出しはありません')).toBeVisible();
  expect(await caretPos(page)).toBe(before);
  await expect(card(page)).toBeVisible();
});

test('a heading inside a folded accordion says so rather than moving into it', async ({ page }) => {
  // Reachable for a reader — the published page's <details> opens itself for a fragment inside it —
  // so the link is not broken. It is the *preview* that cannot go there: a caret in a
  // `display: none` subtree scrolls nowhere, and the press would look like nothing happening.
  // Nothing is unfolded here on the author's behalf (§5.5.18).
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
  // The accordion loads folded, the way a reader gets it (docs/accordion-requirements.md §5).
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
  await caretInLink(page, 'リンク');
  const before = await caretPos(page);

  await card(page).getByRole('button', { name: '見出しへ移動' }).click();
  await expect(page.getByText('折りたたまれた中にあるため移動できません')).toBeVisible();
  expect(await caretPos(page)).toBe(before);
  await expect(page.locator('.ProseMirror [data-type="detailsContent"]')).toBeHidden();
});

test('a link that is not a fragment still opens in a new tab', async ({ page }) => {
  // The branch is on the href, so the other side of it has to be measured too — this is §5.5.6-2's
  // behaviour, and it is what the criterion 4e already holds for the URL case.
  await openEditor(page, ['## 導入', '', '前[外部リンク](https://example.com)後', ''].join('\n'));
  await caretInLink(page, '外部リンク');
  await expect(card(page).getByRole('button', { name: '見出しへ移動' })).toHaveCount(0);
  await card(page).getByRole('button', { name: 'リンク先を開く' }).click();
  expect(await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened)).toEqual([
    'https://example.com',
  ]);
});
