import { test, expect, type Page } from '@playwright/test';
import {
  contentStartOf,
  loadMarkdown,
  moveBlockAbove,
  selectNode,
  setRange,
} from './editor-authoring';
import {
  caretPos,
  countDocChanges,
  docString,
  markdown,
  selectionSpan,
  settle,
  shot,
} from './editor-probe';
import { cdpNativeDrag } from './native-drag';
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
  // A fresh insert no longer lands on the card's own picker (docs/embed-requirements.md §24.2) —
  // 「変更」 on an already-resolved card is the surviving door to it (editor-link-card.spec.ts's
  // `openPickerViaChange` documents why that still measures the same thing).
  await openWith(page, '<div class="link-card" data-href="/posts/second-post"></div>\n\n本文\n');
  await page.locator('.ProseMirror .link-card-view').getByRole('button', { name: '変更' }).click();

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

// 「リンクに戻す」 carries an icon and a label both, matching the link card's band and the code
// block's own copy of the same button (link-card-requirements.md §7.4) — but not their width rule.
// This is the row's only control, so unlike those two it keeps both at every width (§7.4 in this
// document): measured 2026-09-04, the head still has far more room than the button needs at 320px.
test('リンクに戻す carries its icon and label at every width (E19)', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="${WATCH}"></div>\n\n本文\n`);
  const button = () => embed(page).getByRole('button', { name: 'リンクに戻す' });
  await expect(button()).toBeVisible();
  const iconDisplay = () =>
    embed(page).evaluate((el) => getComputedStyle(el.querySelector('.embed-head svg')!).display);
  expect(await iconDisplay()).toBe('block');

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(button()).toBeVisible();
  expect(await iconDisplay()).toBe('block');
  const labelWidth = await embed(page).evaluate(
    (el) => el.querySelector('.embed-to-link-label')!.getBoundingClientRect().width,
  );
  expect(labelWidth).toBeGreaterThan(2);
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
// **The gesture has to still be a range when the paste lands.** A Shift-arrow selection reaches
// ProseMirror's state through the 20ms DOM-sync debounce, and a synthetic paste dispatched in the
// same tick would be read against the caret the click left — which passes for the wrong reason,
// since the caret path places the same embed in the blank-line case.
async function expectRange(page: Page): Promise<void> {
  const [from, to] = await selectionSpan(page);
  expect(to).toBeGreaterThan(from);
}

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

  // **A range in the same cell is refused only after a deletion has been staged**, so what has to
  // be measured is that the staged deletion is thrown away rather than dispatched on its own
  // (`preventDispatch`, speakerdeck-snippet-paste.ts). **The end state cannot show it**: the
  // fall-through paste replaces the selection either way, so the cell reads the same in both
  // stories. The count of document-changing transactions can — one, the fall-through paste.
  // Removing the meta makes it two (measured 2026-09-03), which is the negative control this
  // number exists for.
  await openWith(page, '| A | B |\n| --- | --- |\n| c1 | c2 |\n');
  const cell = page.locator('.ProseMirror td').first();
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ArrowLeft');
  await settle(page);
  await expectRange(page);
  const changes = await countDocChanges(page, () => pasteText(page, SD_IFRAME));
  await expect(embed(page)).toHaveCount(0);
  expect(changes).toBe(1);
  await expect(cell).toContainText('c<iframe');
});

test('a snippet pasted over a selection replaces it (SD15)', async ({ page }) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  // **The gesture that reported this** (2026-09-03): the author drags over the blank lines the
  // embed is meant to fill and pastes onto them. `setEmbed` is caret-only, so before this the
  // snippet landed there as text — §16.9's own table said 「今までどおり」, and that was the bug.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // From the second blank line back over the first — the keyboard equivalent of that drag.
  await page.keyboard.press('Shift+ArrowUp');
  await settle(page);
  await expectRange(page);
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  // **Both blank lines are consumed, not one**: the deletion joins them before the embed replaces
  // what is left, so no empty paragraph survives in the markdown (SD10's rule, reached the other
  // way — an empty paragraph is invisible in the editor and real in the file).
  expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);

  // A selection carrying text is replaced too, which is what pasting anything else over it does.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+a');
  await expectRange(page);
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(1);
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${SD_HREF}"></div>`);
});

test('a range reaching into the footnotes still makes the embed (SD16)', async ({ page }) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  // **The gesture that reported this** (2026-09-03): the last line above the footnotes, dragged.
  // Its selection ends at the first definition's content start — one line is highlighted, and
  // nothing of the footnote is inside the range — but the range does cross the definition's
  // isolating edge, and an unclamped deletion left the caret inside the definition, where no embed
  // may go. The paste fell through and landed as text.
  const source = '本文[^1]\n\n最終段落\n\n[^1]: 脚注の中身\n';
  const stored = `<div class="embed" data-href="${SD_HREF}"></div>`;

  await openWith(page, source);
  // Endpoints by position, not by pixels: the drag's own end is decided by font metrics, and what
  // has to be exact here is *which* edge the range reaches.
  await page.locator('.ProseMirror > p').last().click();
  await page.keyboard.press('Home');
  await settle(page);
  const lineStart = await caretPos(page);
  const footnoteStart = await contentStartOf(page, 'footnoteDefinition');
  await setRange(page, lineStart, footnoteStart);
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  // The footnote keeps every character, because none of them was in the range — what the clamp
  // protects is the join, not the text.
  expect(await markdown(page)).toBe(`本文[^1]\n\n${stored}\n\n[^1]: 脚注の中身`);

  // **A range that really does reach into the footnote text takes it, exactly as any other paste
  // over the same range does.** Measured against a plain paste rather than asserted from the
  // clamp's rules: two characters of the definition are inside the range, and both stories lose
  // the same two.
  await openWith(page, source);
  await page.locator('.ProseMirror > p').last().click();
  await page.keyboard.press('Home');
  await settle(page);
  await setRange(
    page,
    await caretPos(page),
    (await contentStartOf(page, 'footnoteDefinition')) + 2,
  );
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(1);
  expect(await markdown(page)).toBe(`本文[^1]\n\n${stored}\n\n[^1]: の中身`);

  await openWith(page, source);
  await page.locator('.ProseMirror > p').last().click();
  await page.keyboard.press('Home');
  await settle(page);
  await setRange(
    page,
    await caretPos(page),
    (await contentStartOf(page, 'footnoteDefinition')) + 2,
  );
  await pasteText(page, 'ただの文字');
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toBe('本文[^1]\n\nただの文字\n\n[^1]: の中身');
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

// docs/embed-requirements.md §18, criterion G8. **§7's promise is what is at stake, not the gist**:
// the NodeView and the published stage build the same frame from the same `EmbedTarget`, and the
// gist is the first provider whose frame is a document rather than a URL.
//
// The report is delivered directly, as `e2e/public-embed.spec.ts` delivers it and for the same
// reason — a frame sandboxed without `allow-same-origin` does not pass through Playwright's routing,
// so GitHub cannot be stubbed in place (measured 2026-08-29). **`source` is the frame's own window**,
// because this surface authenticates by it: the id alone names a placement, and anything that copies
// the element copies the name with it (§10.5's clone).
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae?file=hello.rb';

// The name the NodeView minted for this placement, read back out of the document it built rather
// than guessed: the editor's counter is not addressable from here.
async function gistInstanceId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('.ProseMirror .embed-view iframe');
    return /,i="([^"]+)"/.exec(frame?.getAttribute('srcdoc') ?? '')?.[1] ?? null;
  });
  if (id === null) throw new Error('no instance id in the frame document');
  return id;
}

// A report delivered as the frame's own, under whichever name the caller names. `source` is the
// frame's window because that is what the NodeView authenticates by — the gist's origin is the
// string `"null"` (§18.5), so there is nothing else to check.
async function reportAs(page: Page, id: string, height: number, files: number): Promise<void> {
  await page.evaluate(
    ([name, h, n]) => {
      const frame = document.querySelector<HTMLIFrameElement>('.ProseMirror .embed-view iframe');
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'gist-embed', id: name, height: h, files: n },
          source: frame?.contentWindow ?? undefined,
        }),
      );
    },
    [id, height, files] as const,
  );
}

async function reportToEditor(page: Page, height: number, files: number): Promise<void> {
  await reportAs(page, await gistInstanceId(page), height, files);
}

async function insertGist(page: Page): Promise<void> {
  await openWith(page, `<${GIST}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page)).toHaveClass(/embed-gist/);
}

test('the editor frames a gist in the same document the reader gets (G8)', async ({ page }) => {
  await insertGist(page);

  const iframe = embed(page).locator('iframe');
  expect(await iframe.getAttribute('src')).toBeNull();
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  const srcdoc = (await iframe.getAttribute('srcdoc'))!;
  expect(srcdoc).toContain(
    'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae.js?file=hello.rb',
  );

  const frame = embed(page).locator('.embed-frame');
  expect((await frame.boundingBox())!.height).toBeLessThan(400);
  await reportToEditor(page, 612, 1);
  // The transition rather than the pixel, for the reason public-embed.spec.ts states: the real gist
  // is live in the frame and re-measures itself once the box grows.
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(600);

  // 「リンクに戻す」 hands back the reference the author pasted, `?file=` and all.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${GIST}"></div>\n\n本文`);
});

test('a gist that drew nothing tells the author rather than degrading (G8)', async ({ page }) => {
  // §7.2's position: the published page turns this into a link, but the editor is the surface where
  // the reference can still be corrected, so it says what happened instead — and it says gist rather
  // than 投稿, which is X's word.
  await insertGist(page);
  await reportToEditor(page, 250, 0);

  await expect(page.locator('.ProseMirror .embed-unresolved')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .embed-note')).toContainText('取得できない gist です');
  // The reference is still the author's, so it is still recoverable.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${GIST}"></div>\n\n本文`);
});

test('a video still gets scrolling="no" and neither new attribute (G8)', async ({ page }) => {
  // The counterpart: both are the provider's answer, and this is the assertion that would fail if
  // either were written once at construction rather than per render.
  await openWith(page, `<${WATCH}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  const video = embed(page).locator('iframe');
  await expect(video).toHaveAttribute('scrolling', 'no');
  expect(await video.getAttribute('sandbox')).toBeNull();
  expect(await video.getAttribute('srcdoc')).toBeNull();
});

// docs/embed-requirements.md §20. The sandbox page URL an author pastes from the address bar.
const CODESANDBOX = 'https://codesandbox.io/p/sandbox/react-example-xgzdk';

test('the editor builds the same sandbox frame the reader gets (C6)', async ({ page }) => {
  // **The first provider with a `sandbox` AND a real `src`** — the gist above has a sandbox but no
  // src, and every other provider has a src but no sandbox. So this is the placement where the two
  // render stages could most easily disagree, which is §4.3's whole concern.
  await openWith(page, `<${CODESANDBOX}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page)).toHaveClass(/embed-codesandbox/);

  const iframe = embed(page).locator('iframe');
  // The whole segment, and `runonclick=1` — which the author never wrote, so the author sees in
  // their own NodeView exactly what a reader gets: code now, a click to run it (§20.2, §20.5).
  await expect(iframe).toHaveAttribute(
    'src',
    'https://codesandbox.io/embed/react-example-xgzdk?runonclick=1',
  );
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('allow', '');
  expect(await iframe.getAttribute('srcdoc')).toBeNull();

  // Fixed, and it does not move: there is no report to wait for and none is wanted (§20.6).
  const frame = embed(page).locator('.embed-frame');
  expect((await frame.boundingBox())!.height).toBeCloseTo(500, 0);

  // 「リンクに戻す」 hands back the page URL the author pasted, not the embed form it was built into.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${CODESANDBOX}"></div>\n\n本文`);
});

// docs/embed-requirements.md §20.14: **CodeSandbox is the first embed whose content is itself an
// editor**, so the question §7 leaves open is where a keystroke goes once the frame is live.
//
// §7 already narrows it to one state. The frame is `pointer-events: none` at rest, so the author
// cannot fall into the sandbox's CodeMirror by accident — reaching it takes a click that selects
// the block and a second one that lands inside. **Focus is what decides, and the two clicks give
// two different answers**, which is why both are measured here rather than only the state §20.14
// named.
//
// The sandbox is a stub of our own: what is measured is where the key went, not CodeSandbox. That
// this is measurable at all is §20.7's doing — the sandbox keeps `allow-same-origin`, so the frame
// is not opaque and Playwright can both route it and address what is inside, which is exactly what
// the gist's frame refuses (§18.6, `e2e/public-embed.spec.ts`).
const CS_STUB =
  '<!doctype html><title>stub</title><body style="margin:0"><textarea id="t" style="width:100%;height:400px"></textarea>';

async function openSandbox(page: Page): Promise<void> {
  await page.route('https://codesandbox.io/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: CS_STUB }),
  );
  await openWith(page, `<div class="embed" data-href="${CODESANDBOX}"></div>\n\n本文\n`);
  // The click the §7 test already pins: it lands on the frame, which is inert, so ProseMirror makes
  // the NodeSelection instead.
  await embed(page).locator('.embed-frame').click();
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
}

test('with the block selected, a keystroke still goes to the document (§20.14)', async ({
  page,
}) => {
  await openSandbox(page);
  expect(await docString(page)).toBe('doc(embed, paragraph("本文"))');

  // One click in, the editor keeps focus, so this is ordinary NodeSelection handling: the typed
  // character replaces the selected node. Shared with the link card, and undoable. Recorded as the
  // answer rather than guarded against — a keydown guard here would take away the only way to
  // replace a block by typing over it.
  await page.keyboard.type('X');
  expect(await docString(page)).toBe('doc(paragraph("X"), paragraph("本文"))');
});

test("once the frame has focus, the keys are the frame's (§20.14)", async ({ page }) => {
  await openSandbox(page);
  const intact = await docString(page);
  const textarea = page.frameLocator('.embed-view iframe').locator('#t');
  await textarea.click();

  await page.keyboard.type('Y');
  // **This assertion is the discriminator, not a control.** If the click never landed inside the
  // frame, focus stayed in the editor and the keystroke would have replaced the node — the test
  // above's outcome — and the document assertion below would then be reporting the harness rather
  // than the browser. CDP input is what bypasses out-of-process frame hit-testing (criterion E12),
  // so this has to be checked before anything is concluded from the document.
  await expect(textarea).toHaveValue('Y');
  expect(await docString(page)).toBe(intact);

  // Backspace too, which is the one that could have cost the author the block: §7.3's one-press
  // atom delete does not fire, because the editor never sees the key.
  await page.keyboard.press('Backspace');
  await expect(textarea).toHaveValue('');
  expect(await docString(page)).toBe(intact);

  // **The ring stays up the whole time.** The block is still the ProseMirror selection — focus left
  // the editor, the selection did not — so the outline is not a signal of where a key will go.
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
});

// docs/embed-requirements.md §5, and the first item §12 listed as unmeasured: **§5 decided that no
// new slice guard was needed**, on the inference that the embed is a block atom like the card and
// so is covered by the accordion title's `titleAcceptsSlice` and the table cell's
// `carriesNonParagraphBlock`. `components/editor/embed-placement.test.ts` measures both predicates
// against slices taken from real selections; what it cannot see is the hop before them — the guard
// reads `$from` from `state`, and a paste is the gesture §12 named. So one route is driven end to
// end here, through the browser's own clipboard.
//
// The accordion title is the one worth driving: the table cell adds no mechanism over it, and this
// is the destination whose failure is not a refusal but a *tear* — ProseMirror does not decline
// what will not fit into a `text*` title, it splits the accordion in two around the intruder
// (docs/accordion-requirements.md §6.6).
const TITLE_NO_BLOCKS = 'アコーディオンのタイトルには段落やブロックを入れられません';

const WITH_ACCORDION = `<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n\n<div class="embed" data-href="${WATCH}"></div>\n`;

// The first position inside the first node of `typeName`, read from the state rather than clicked:
// a click places the DOM caret ~20ms ahead of the state, and the guard reads the state.
async function firstPos(page: Page, typeName: string): Promise<number> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as {
      editor?: {
        state: {
          doc: { descendants(f: (n: { type: { name: string } }, pos: number) => void): void };
        };
      };
    } | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let pos = -1;
    el.editor.state.doc.descendants((node, at) => {
      if (pos === -1 && node.type.name === name) pos = at;
    });
    if (pos === -1) throw new Error(`no ${name} in the document`);
    return pos + 1;
  }, typeName);
}

test('an embed copied and pasted into an accordion title is refused, and the accordion is intact', async ({
  page,
}) => {
  await openWith(page, WITH_ACCORDION);
  const intact = await docString(page);
  expect(intact).toContain('detailsSummary("タイトル")');
  expect(intact).toContain('embed');

  // A NodeSelection is what the block drag handle makes and what copies a whole block — the slice
  // arrives closed on both sides, which is the shape the unit test pins.
  await selectNode(page, 'embed');
  await page.keyboard.press('Control+c');
  await setRange(page, await firstPos(page, 'detailsSummary'));
  await page.keyboard.press('Control+v');

  const toast = page.getByRole('status');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(TITLE_NO_BLOCKS);
  // Whole-document, not `toContain`: the defect's symptom is a *second* accordion appearing, and a
  // message-only assertion would also pass if the refusal had eaten the title's text.
  expect(await docString(page)).toBe(intact);
});

// The control, and it is not optional: `titleAcceptsSlice` returns false for an *empty* slice too,
// so the refusal above fires just as well when the copy never happened — leaving a test that passes
// with a broken clipboard. This proves the same copy really carried an embed.
//
// The paste goes into the accordion's own body (`block+`, so an embed is legal there) rather than a
// top-level paragraph, which makes the refusal above specific to the title rather than to the
// accordion.
test('the same copy still lands as an embed where one may go', async ({ page }) => {
  await openWith(page, WITH_ACCORDION);
  await selectNode(page, 'embed');
  await page.keyboard.press('Control+c');
  // +1 past `detailsContent` itself: the start of the body's first paragraph.
  await setRange(page, (await firstPos(page, 'detailsContent')) + 1);
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(embed(page)).toHaveCount(2);
  expect(await docString(page)).toContain('detailsContent(embed, paragraph("本文"))');
});

// docs/embed-requirements.md §8.4 and §12, the gist half of criterion E17. A reorder rebuilds the
// NodeView, and the rebuild resets `answered`, `visible` and the silence clock while minting a new
// `instanceId` into the `srcdoc` — so a gist that did not report again under the *new* name would
// become 「取得できない gist です」 eight seconds later, on a block the author had already seen.
//
// **Only the parent's half is pinned here, deliberately.** GitHub's script cannot be substituted
// inside this frame — it is sandboxed without `allow-same-origin`, so Playwright's routing does not
// reach it (§18.6) — and a spec that asserted the real frame's answer would be asserting GitHub's
// uptime, which `x-embed-stub.ts` states this suite must not do. What is asserted instead is what a
// bug here would actually break: that the rebuilt NodeView is listening, and that it authenticates
// by the id it has just minted rather than the one it retired. The frame's own half is recorded in
// §8.4 as a live observation, not as a spec.
//
// The two reports below are identical but for the id, and their outcomes are opposite. That is what
// makes this a measurement rather than an assertion that nothing happened.
test('a rebuilt gist frame is heard under its new id, and only that one (E17)', async ({
  page,
}) => {
  await insertGist(page);
  const firstId = await gistInstanceId(page);

  await page.evaluate(() => {
    document.querySelector('.embed-view iframe')?.setAttribute('data-mark', '1');
    document.querySelector('.embed-view .embed-frame')?.setAttribute('data-mark', '1');
  });
  await moveBlockAbove(page, '本文', 'embed');

  // The gate: row 1 of §8.4's table rebuilds the jumped-over embed. If the stamps survived, the
  // NodeView was never rebuilt and everything below would be measuring the original one.
  await expect(embed(page).locator('[data-mark]')).toHaveCount(0);
  const secondId = await gistInstanceId(page);
  expect(secondId).not.toBe(firstId);

  // The retired name is not this frame's any more. `files: 0` is the loudest thing a report can
  // say — it is what draws the note — so if the old id were still accepted, this would show. The
  // dispatch is synchronous, so by the time `evaluate` returns the NodeView has already had it.
  await reportAs(page, firstId, 250, 0);
  await expect(page.locator('.ProseMirror .embed-note')).toHaveCount(0);

  // The same report under the name the rebuild minted, and now it lands.
  await reportAs(page, secondId, 250, 0);
  await expect(page.locator('.ProseMirror .embed-note')).toContainText('取得できない gist です');
});

// docs/embed-requirements.md §8.1's last paragraph, and the item §12 listed as unmeasured. §8.1
// fixed the *handle* path, where the hole was the embed being dragged: grabbing a block is what
// selects it, and `.ProseMirror-selectednode.embed-view … iframe` hands the selected block's frame
// the pointer back — so the one frame guaranteed to be live during a handle drag was the one whose
// box the pointer was crossing. `body.block-dragging` is what closed that, and it is not set on the
// native path, which is why the question stayed open.
//
// **It is closed by the two states below, and neither needs `body.block-dragging`.** What is
// asserted is the computed `pointer-events`, for criterion E12's reason — CDP input bypasses
// out-of-process frame hit-testing, so the freeze itself is not observable here. The value is what
// decides whether the frame is a hit target at all, and it is the same value §8.1 measured
// directly (32 moves across a live frame reached the parent 0 times; inert, 32/32).
const NATIVE_DRAG_MD = `前の段落\n\n<div class="embed" data-href="${WATCH}"></div>\n\n後の段落\n`;

type DragSnapshot = {
  selected: boolean;
  blockDragging: boolean;
  pointerEvents: string | null;
  carried: string[] | null;
};

function dragSnapshot(page: Page): Promise<DragSnapshot> {
  return page.evaluate(() => {
    const view = document.querySelector('.ProseMirror .embed-view');
    const frame = view?.querySelector('iframe') ?? null;
    const editor = (
      document.querySelector('.ProseMirror') as {
        editor?: {
          view: {
            dragging: {
              slice: { content: { forEach(f: (n: { type: { name: string } }) => void): void } };
            } | null;
          };
        };
      } | null
    )?.editor;
    const dragging = editor?.view.dragging ?? null;
    let carried: string[] | null = null;
    if (dragging) {
      const names: string[] = [];
      dragging.slice.content.forEach((node) => names.push(node.type.name));
      carried = names;
    }
    return {
      selected: view?.classList.contains('ProseMirror-selectednode') ?? false,
      blockDragging: document.body.classList.contains('block-dragging'),
      pointerEvents: frame ? getComputedStyle(frame).pointerEvents : null,
      carried,
    };
  });
}

test('a natively dragged embed never gives its own frame the pointer (§8.1)', async ({ page }) => {
  await openWith(page, NATIVE_DRAG_MD);
  const box = (await embed(page).boundingBox())!;
  const last = (await page.locator('.ProseMirror p').last().boundingBox())!;

  let during: DragSnapshot | null = null;
  await cdpNativeDrag(
    page,
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    { x: last.x + 10, y: last.y + last.height / 2 },
    async () => {
      during = await dragSnapshot(page);
    },
  );
  const seen = during as DragSnapshot | null;

  // **The gate.** Without this the assertions below are the resting state, which §7 already pins:
  // the press has to have started a real drag that picked the embed up.
  expect(seen?.carried).toEqual(['embed']);
  // **Grabbing does not select on this path** — the selection stays where the caret was, so the
  // rule that hands a selected block's frame the pointer never applies. This is the whole
  // difference from the handle path, and it is why nothing had to be added here.
  expect(seen?.selected).toBe(false);
  expect(seen?.pointerEvents).toBe('none');
  // And it is not §8.1's fix doing it: that class belongs to the handle's controller.
  expect(seen?.blockDragging).toBe(false);
});

test('a selected embed cannot start a native drag at all (§8.1)', async ({ page }) => {
  // The other state, and the one that would freeze if it were reachable. It is not: the frame is
  // live precisely because the block is selected (§7), so the press lands *inside the iframe* and
  // the parent document never sees it. No `dragstart`, no drag.
  await openWith(page, NATIVE_DRAG_MD);
  await embed(page).locator('.embed-frame').click();
  await expect(embed(page).locator('iframe')).toHaveCSS('pointer-events', 'auto');

  const box = (await embed(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 6 });
  const seen = await dragSnapshot(page);
  await page.mouse.up();

  expect(seen.selected).toBe(true);
  expect(seen.pointerEvents).toBe('auto');
  // Nothing was picked up, which is what makes the live frame harmless here.
  expect(seen.carried).toBeNull();
});

// docs/embed-requirements.md §21. The pen page URL an author pastes from the address bar.
const CODEPEN = 'https://codepen.io/flatsato/pen/VwqprLp';

test('the editor builds the same pen frame the reader gets (P6)', async ({ page }) => {
  // Routed for §21.13's reason rather than for speed: a suite that loaded real pens would be
  // spending this IP's budget with CodePen's rate challenge, and a run that tripped it would fail
  // here saying something about Cloudflare rather than about this project.
  await page.route('https://codepen.io/*/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  await openWith(page, `<${CODEPEN}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  const offer = page.getByRole('button', { name: '埋め込みにする' });
  await expect(offer).toBeVisible();
  // **The mark, which is where §14.8's trap bites**: a provider with no branch in
  // `embedMarkShapes` gets the default play frame instead, silently. So this asserts the cube is
  // drawn rather than that some icon is — the play mark has a `rect` and no path but the triangle.
  await expect(offer.locator('svg rect')).toHaveCount(0);
  await expect(offer.locator('svg path')).toHaveAttribute('d', /^M 12 22\.747/);
  await offer.click();
  await expect(embed(page)).toHaveClass(/embed-codepen/);

  const iframe = embed(page).locator('iframe');
  // **The author sees the reader's frame** — same user segment, same bare src with no parameter of
  // ours appended (§21.5), same pair of attributes as the published side (§21.7).
  await expect(iframe).toHaveAttribute('src', 'https://codepen.io/flatsato/embed/VwqprLp');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('allow', '');
  expect(await iframe.getAttribute('srcdoc')).toBeNull();

  // Chosen rather than computed: the frame reports no height and none is waited for, so §21.6
  // picks the number — 300px on a narrow column, 450px from 48rem. The default viewport is above
  // that line, which is the same box public-embed.spec.ts measures on the reader's side (P7).
  const frame = embed(page).locator('.embed-frame');
  expect((await frame.boundingBox())!.height).toBeCloseTo(450, 0);

  // 「リンクに戻す」 hands back the page URL the author pasted, not the embed form built from it.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${CODEPEN}"></div>\n\n本文`);
});
