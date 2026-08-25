import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, shot } from './editor-probe';
import { EMBED_SILENCE_MS } from '../lib/embed-message';

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

test('a provider that says nothing is not mistaken for a missing post (§10.6)', async ({
  page,
}) => {
  await openWith(page, `<div class="embed" data-href="${WATCH}"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveCount(1);

  // Elapsed time is the subject, so the wait is the measurement rather than a smell — the same
  // shape `e2e/editor-x-embed.spec.ts` uses to watch the clock actually fire. A YouTube player
  // holds its own ratio and never speaks (`lib/embed-message.ts`), so the editor's silence clock
  // must not be armed for it at all: armed, it replaces a working player with 「取得できない投稿」
  // eight seconds after the author scrolls to it. No stub is needed — the clock is ours, and it
  // expires whether or not youtube-nocookie.com answers.
  await page.waitForTimeout(EMBED_SILENCE_MS + 1500);
  await expect(embed(page).locator('.embed-note')).toHaveCount(0);
  await expect(embed(page).locator('iframe')).toHaveCount(1);
});

// docs/embed-requirements.md §15.6, criterion F8. The line the author gets instead of a check: a
// Figma file whose sharing is off renders in this very NodeView (the author's browser carries a
// Figma session) and shows the reader a login screen, so this is the one embed where what the
// author sees is not what the reader gets — and the only signal available without a fetch (§3.2).
const FIGMA = 'https://www.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe/Figma-sample?node-id=0-1';

test('a Figma embed carries the sharing line, and nothing else does (F8)', async ({ page }) => {
  await page.route('https://embed.figma.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  await openWith(page, `<${FIGMA}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();

  const view = embed(page);
  await expect(view).toHaveCount(1);
  // Beside the player, not in place of it — the frame is what the note state replaces.
  await expect(view.locator('iframe')).toHaveCount(1);
  await expect(view.locator('.embed-hint')).toHaveText(/リンクを知っている全員/);

  // The reference is replaced rather than the block rebuilt, which is what the line has to survive
  // — and a video is not something the line applies to.
  await loadMarkdown(page, `<${WATCH}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', SRC);
  await expect(embed(page).locator('.embed-hint')).toHaveCount(0);
});

// docs/embed-requirements.md §16.9, criteria SD10–SD12. The one paste in this editor that makes a
// block, and the exception §5 otherwise refuses — so what is measured here is mostly the pastes it
// must NOT claim. `lib/speakerdeck-snippet.test.ts` measures the reading of the snippet itself;
// this measures what the editor does with the answer, which is the half that can eat an author's
// text.
const SD_ID = '9de2f18094b14cbb91b07331eb085e4f';
const SD_HREF = `https://speakerdeck.com/player/${SD_ID}`;
const SD_IFRAME = `<iframe class="speakerdeck-iframe" frameborder="0" src="${SD_HREF}" title="deck" allowfullscreen="true" allow="web-share" style="width: 100%; height: auto; aspect-ratio: 560 / 315;" data-ratio="1.7777777777777777"></iframe>`;
const SD_SCRIPT = `<script defer class="speakerdeck-embed" data-id="${SD_ID}" data-ratio="1.7777777777777777" src="//speakerdeck.com/assets/embed.js"></script>`;

// The clipboard is synthesised rather than driven through the OS, the way e2e/editor-vscode-paste.ts
// does it. `text/plain` alone is what Speaker Deck's own buttons put there (`data-clipboard-text`,
// measured 2026-08-26), so that is what these carry.
async function pasteText(page: Page, text: string): Promise<void> {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', data);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, text);
}

test('pasting either Speaker Deck snippet makes the embed (SD10)', async ({ page }) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  for (const snippet of [SD_IFRAME, SD_SCRIPT]) {
    await openWith(page, '本文\n');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await pasteText(page, snippet);

    await expect(embed(page)).toHaveCount(1);
    await expect(embed(page).locator('iframe')).toHaveAttribute('src', SD_HREF);
    // **The blank line the author pasted on is consumed, not left above the block.** An empty
    // paragraph there is invisible in the editor and real in the markdown, so the whole document is
    // asserted rather than just the block.
    expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);
  }

  // **One undo takes the embed and leaves the typing.** A paste has to close the history event it
  // lands after, or prosemirror-history groups it with whatever was typed in the half-second before
  // and Ctrl+Z removes both — in an editor that autosaves, that is a word the author never gets a
  // second chance to notice is gone. `link-paste-paragraph-guard.ts` sets the same metas.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.type('追記');
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toBe('本文追記');
});

test('a snippet pasted mid-sentence keeps the sentence (SD11)', async ({ page }) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  await openWith(page, '本文\n');
  // Caret at the end of the paragraph, which is not an empty block — the paragraph has to survive
  // whole rather than being split around the embed.
  await page.keyboard.press('Control+End');
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);
});

test('a paste this is not stays exactly what it is today (SD12)', async ({ page }) => {
  // A code block is where "I am writing about this snippet" lives, and the snippet has to survive
  // there as text (§16.9).
  await openWith(page, '```\n\n```\n');
  await page.locator('.ProseMirror pre').click();
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toContain('speakerdeck-iframe');

  // A snippet naming another host is not a Speaker Deck deck, and must not become one.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await pasteText(page, `<iframe src="https://evil.example/player/${SD_ID}"></iframe>`);
  await expect(embed(page)).toHaveCount(0);

  // Prose that merely quotes a snippet keeps every word of it.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await pasteText(page, `埋め込みコードは ${SD_IFRAME} です`);
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toContain('埋め込みコードは');

  // A table cell is `paragraph+`, so no block may be placed there — `setEmbed` returns false and
  // the paste has to fall through rather than be swallowed. The same answer E7 measures for the
  // bubble's path, asked of this one.
  await openWith(page, '| A | B |\n| --- | --- |\n| c1 | c2 |\n');
  await page.locator('.ProseMirror td').first().click();
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toContain('speakerdeck-iframe');

  // A snippet pasted over a selection is not a caret asking for a block either, and `setEmbed`
  // refuses it: the selection is replaced with the text, which is what pasting anything else does.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+a');
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(0);
});

test('the deck page URL is told which Copy button it wanted (SD14)', async ({ page }) => {
  // §16.10. The line only exists because this is the one reference whose missing button is the one
  // the author meant to press — so what is measured is that it appears there and nowhere else.
  const hint = page.locator('.link-bubble-deck-hint');
  // The title line, and therefore the href line under it, only exist once a title is known
  // (§5.5.10). Stubbed rather than fetched: the colour comparison below needs that line present,
  // and a spec that waits on speakerdeck.com to answer is measuring their uptime.
  await page.route('**/api/link-title**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'デッキ' }) }),
  );

  await openWith(page, '<https://speakerdeck.com/soudai/pgcon21j-tutorial>\n\n本文\n');
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(hint).toHaveText(/Copy iframe code/);
  await expect(page.locator('.link-bubble-href')).toBeVisible();
  // **Not the href line's colour.** It had exactly that grey and read as a third line of the
  // reference rather than as advice (§16.10) — so what is measured is the difference, not the value.
  const shades = await page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector('.link-bubble-deck-hint')!).color,
    href: getComputedStyle(document.querySelector('.link-bubble-href')!).color,
  }));
  expect(shades.hint).not.toBe(shades.href);
  // The card is still what this reference can become, which is what makes the line advice rather
  // than an error (§16.10).
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);

  // A player URL is already an embed and needs no advice.
  await openWith(page, `<${SD_HREF}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await expect(hint).toHaveCount(0);

  // And no other provider carries it.
  await openWith(page, `<${WATCH}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await expect(hint).toHaveCount(0);
});
