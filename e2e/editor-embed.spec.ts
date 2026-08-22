import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, shot } from './editor-probe';

// The YouTube embed in the live editor (docs/embed-requirements.md §9). Browser-only for the usual
// reason and one of its own: the NodeView builds an `<iframe>` whose src is derived at runtime, and
// §7's pointer rule is a CSS claim about that iframe — the kind that is wrong for free until
// something measures it.
//
// The id is the one §9.2's table was measured against.
const ID = 'hDPybQwAuVo';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

async function openWith(page: Page, source: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading, for openWithCard's reason: setRange moves the selection, but keystrokes
  // go wherever the browser has focus.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, source);
}

function embed(page: Page) {
  return page.locator('.ProseMirror .embed-view');
}

test('the bubble offers an embed, not a card, for a video URL (§5)', async ({ page }) => {
  await openWith(page, `<${WATCH}>\n\n本文\n`);

  // Caret into the link, which is what brings the bubble up.
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  // One URL, one meaning: the card's own button is asked second and gets nothing (§5). Were the
  // order reversed, this link would be offered a card that publishes as a plain link (§9.1).
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await shot(page, '01-bubble-embed-button');

  await page.getByRole('button', { name: '埋め込みにする' }).click();

  await expect(embed(page)).toHaveCount(1);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', SRC);
  // The paragraph is replaced rather than emptied and followed — an empty paragraph above the
  // block would be invisible in the markdown and real in the editor. The whole document, because
  // what has to be absent is a line that serializes to nothing.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${WATCH}"></div>\n\n本文`);
  await shot(page, '02-editor-embed');
});

test('a URL naming no single video keeps the card (§9.4)', async ({ page }) => {
  await openWith(page, `<https://www.youtube.com/playlist?list=PLabc>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);
  // The card is still on offer, which is what makes the absence above mean what it says.
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the picker makes an embed out of a pasted video URL (§5-1)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type('/リンクカード');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンクカード' }).click();

  const search = page.locator('.link-card-search');
  await expect(search).toBeVisible();
  await search.fill(`https://youtu.be/${ID}?t=90`);
  // The row's label is the decision: the same field answers with a card for every other URL.
  await shot(page, '03-picker-embed-row');
  await page.getByRole('button', { name: 'この URL を埋め込みにする' }).click();

  // The card node is replaced outright, so one paste makes one block.
  await expect(page.locator('.ProseMirror .link-card-view')).toHaveCount(0);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
});

test('the block is one selection target, and the player is inert until it is (§7)', async ({
  page,
}) => {
  await openWith(page, `<div class="embed" data-href="${WATCH}"></div>\n\n本文\n`);

  const iframe = embed(page).locator('iframe');
  // Unselected, the iframe does not take the pointer — which is what leaves the drag handle's grab
  // and any selection dragged across the block reaching the editor instead of the player.
  await expect(iframe).toHaveCSS('pointer-events', 'none');

  // The click lands on the frame, which belongs to the NodeView, so ProseMirror makes a
  // NodeSelection — and that is what hands the pointer to the player.
  await embed(page).locator('.embed-frame').click();
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
  await expect(iframe).toHaveCSS('pointer-events', 'auto');
  // One handle, and it is the embed's: a plain paragraph gets none (block-drag-handle.ts's
  // DRAGGABLE_TYPES), so the count is what says the embed was added to that set — measured after a
  // first run expected two and found this.
  await expect(page.locator('.ProseMirror .block-drag-handle')).toHaveCount(1);
  await shot(page, '04-editor-embed-selected');
});

test('リンクに戻す hands the reference back verbatim', async ({ page }) => {
  const href = `${WATCH}&t=90`;
  await openWith(page, `<div class="embed" data-href="${href}"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);

  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(embed(page)).toHaveCount(0);
  // The URL the author wrote, start time and all — no fetch ran, so there is no title to put in
  // its place, and the reference is what they can act on.
  const link = page.locator('.ProseMirror a').first();
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveText(href);
});

test('the stored form survives the round trip (E1)', async ({ page }) => {
  // `&` is written as `&amp;` by the serializer and read back by markdown-it, which is the one
  // character in a reference that can be lost silently.
  const stored = `<div class="embed" data-href="${WATCH}&amp;t=90"></div>`;
  await openWith(page, `${stored}\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
  expect(await markdown(page)).toBe(`${stored}\n\n本文`);
});

test('a reference no provider claims says so rather than showing a player', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="https://example.com/a"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveCount(0);
  // The editor is the surface where this is fixable, so it is the surface that reports it — the
  // published page degrades it to a plain link instead (§6).
  await expect(embed(page).locator('.embed-note')).toContainText('https://example.com/a');
  await shot(page, '05-editor-embed-unresolved');
});

test('a link the block cannot hold an embed for is not offered one (E7)', async ({ page }) => {
  // The placement question `linkToEmbed` asks is "may this textblock be replaced by an embed",
  // which is the question linkToCard had to be corrected to ask (link-card-requirements.md §14.6):
  // a table cell holds `paragraph+`, and a list item's FIRST paragraph is its head — replacing
  // either leaves the structure short of something it requires.
  //
  // The accordion's title is not in this list and cannot be: it carries no marks at all, so a link
  // never exists there and the bubble never comes up. Nothing to refuse.
  for (const [name, md] of [
    ['table cell', `| A | B |\n| --- | --- |\n| [x](${WATCH}) | c2 |\n`],
    ['list item head', `- [x](${WATCH})\n`],
  ] as const) {
    await openWith(page, md);
    const link = page.locator('.ProseMirror a').first();
    // A dead-center click sits on the browser's caret tie-break boundary for this one-character
    // link: the identical click resolves the caret before or after "x" depending on run (measured
    // — same pixel, `parentOffset` 0 one run and 1 the next), and before it `linkAtCaret` correctly
    // reports no link, which was this test's flake. Bias right so the caret lands inside the link.
    const box = await link.boundingBox();
    await link.click({ position: { x: (box?.width ?? 0) - 1, y: (box?.height ?? 0) / 2 } });
    // The bubble is up — otherwise the absence below would pass for the wrong reason.
    await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
    await expect(page.getByRole('button', { name: '埋め込みにする' }), name).toHaveCount(0);
  }
});
