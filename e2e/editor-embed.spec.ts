import { test, expect, type Page } from '@playwright/test';
import {
  closeHistory,
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

// The YouTube embed in the live editor (docs/embed-requirements.md §9). Browser-only: the NodeView
// builds its `<iframe>` src at runtime, and §7's pointer rule is a CSS claim about that iframe.
// The id is the one §9.2's table was measured against.
const ID = 'hDPybQwAuVo';
const WATCH = `https://www.youtube.com/watch?v=${ID}`;
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

async function openWith(page: Page, source: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md).
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
  // One URL, one meaning: the card's button is asked second and gets nothing (§5); reversed, the link
  // would be offered a card that publishes as a plain link (§9.1).
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
  await shot(page, '01-bubble-embed-button');

  await page.getByRole('button', { name: '埋め込みにする' }).click();

  await expect(embed(page)).toHaveCount(1);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', SRC);
  // Replaced, not emptied: an empty paragraph serializes to nothing, so assert the whole document.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${WATCH}"></div>\n\n本文`);
  await shot(page, '02-editor-embed');
});

test('a URL naming no single video keeps the card (§9.4)', async ({ page }) => {
  await openWith(page, `<https://www.youtube.com/playlist?list=PLabc>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toHaveCount(0);
  // The card is still offered, which gives the absence above its meaning.
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the picker makes an embed out of a pasted video URL (§5-1)', async ({ page }) => {
  // 「変更」 is the door to the card's picker (§24.2; see `openPickerViaChange` in
  // editor-link-card.spec.ts).
  await openWith(page, '<div class="link-card" data-href="/posts/second-post"></div>\n\n本文\n');
  await page.locator('.ProseMirror .link-card-view').getByRole('button', { name: '変更' }).click();

  const search = page.locator('.link-card-search');
  await expect(search).toBeVisible();
  await search.fill(`https://youtu.be/${ID}?t=90`);
  // The row's label is the decision: every other URL gets a card.
  await shot(page, '03-picker-embed-row');
  await page.getByRole('button', { name: 'この URL を埋め込みにする' }).click();

  // The card node is replaced, so one paste makes one block.
  await expect(page.locator('.ProseMirror .link-card-view')).toHaveCount(0);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
});

test('the block is one selection target, and the player is inert until it is (§7)', async ({
  page,
}) => {
  await openWith(page, `<div class="embed" data-href="${WATCH}"></div>\n\n本文\n`);

  const iframe = embed(page).locator('iframe');
  // Unselected, the iframe ignores the pointer, so the drag handle and selections reach the editor.
  await expect(iframe).toHaveCSS('pointer-events', 'none');

  // The click lands on the NodeView's frame, so ProseMirror selects the node, which hands the
  // pointer to the player.
  await embed(page).locator('.embed-frame').click();
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
  await expect(iframe).toHaveCSS('pointer-events', 'auto');
  // One handle, the embed's (a paragraph gets none): the count says the embed is in
  // DRAGGABLE_TYPES.
  await expect(page.locator('.ProseMirror .block-drag-handle')).toHaveCount(1);
  await shot(page, '04-editor-embed-selected');
});

test('リンクに戻す hands the reference back verbatim', async ({ page }) => {
  const href = `${WATCH}&t=90`;
  await openWith(page, `<div class="embed" data-href="${href}"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
  await closeHistory(page);

  await page.getByRole('button', { name: 'リンクに戻す' }).click();
  await expect(embed(page)).toHaveCount(0);
  // The URL as written, start time and all: no fetch ran, so there is no title.
  const link = page.locator('.ProseMirror a').first();
  await expect(link).toHaveAttribute('href', href);
  await expect(link).toHaveText(href);
  // The button that held focus is gone; focus is back in the editor, so one Ctrl-Z undoes it (E20).
  await page.keyboard.press('Control+z');
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
});

// Icon and label, like the card's band and the code block's copy (link-card-requirements.md §7.4),
// but the row's only control keeps both at every width (§7.4 here).
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
  // `&` becomes `&amp;` and back: the one character a reference can lose silently.
  const stored = `<div class="embed" data-href="${WATCH}&amp;t=90"></div>`;
  await openWith(page, `${stored}\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', `${SRC}?start=90`);
  expect(await markdown(page)).toBe(`${stored}\n\n本文`);
});

test('a reference no provider claims says so rather than showing a player', async ({ page }) => {
  await openWith(page, `<div class="embed" data-href="https://example.com/a"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveCount(0);
  // Reported where it is fixable; the published page degrades it to a link (§6).
  await expect(embed(page).locator('.embed-note')).toContainText('https://example.com/a');
  await shot(page, '05-editor-embed-unresolved');
});

test('a link the block cannot hold an embed for is not offered one (E7)', async ({ page }) => {
  // `linkToEmbed` asks whether this textblock may be replaced by an embed, as linkToCard does
  // (link-card-requirements.md §14.6): a cell holds `paragraph+`, and a list item's first paragraph
  // is its head. The accordion title holds no marks, so no link, so nothing to refuse.
  for (const [name, md] of [
    ['table cell', `| A | B |\n| --- | --- |\n| [x](${WATCH}) | c2 |\n`],
    ['list item head', `- [x](${WATCH})\n`],
  ] as const) {
    await openWith(page, md);
    const link = page.locator('.ProseMirror a').first();
    // A centred click on a one-character link lands before or after it by run, and before it
    // `linkAtCaret` rightly finds no link. Bias right.
    const box = await link.boundingBox();
    await link.click({ position: { x: (box?.width ?? 0) - 1, y: (box?.height ?? 0) / 2 } });
    // The bubble is up, or the absence below passes vacuously.
    await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
    await expect(page.getByRole('button', { name: '埋め込みにする' }), name).toHaveCount(0);
  }
});

test('a provider that says nothing is not mistaken for a missing post (§10.6)', async ({
  page,
}) => {
  await openWith(page, `<div class="embed" data-href="${WATCH}"></div>\n\n本文\n`);
  await expect(embed(page).locator('iframe')).toHaveCount(1);

  // Elapsed time is the subject, so the wait is the measurement (as in editor-x-embed.spec.ts).
  // YouTube never speaks (lib/embed-message.ts), so no silence clock may be armed for it, or a working
  // player turns into 「取得できない投稿」. No stub needed: the clock is ours.
  await page.waitForTimeout(EMBED_SILENCE_MS + 1500);
  await expect(embed(page).locator('.embed-note')).toHaveCount(0);
  await expect(embed(page).locator('iframe')).toHaveCount(1);
});

// docs/embed-requirements.md §15.6, criterion F8: a Figma file with sharing off renders for the
// author (their browser has a session) and shows readers a login screen, so this line is the only
// signal without a fetch (§3.2).
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
  // Beside the player; the note state replaces the frame instead.
  await expect(view.locator('iframe')).toHaveCount(1);
  await expect(view.locator('.embed-hint')).toHaveText(/リンクを知っている全員/);

  // The reference changes without a rebuild, and the line must not survive onto a video.
  await loadMarkdown(page, `<${WATCH}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page).locator('iframe')).toHaveAttribute('src', SRC);
  await expect(embed(page).locator('.embed-hint')).toHaveCount(0);
});

// docs/embed-requirements.md §16.9, criteria SD10–SD12: the one paste that makes a block, so what is
// measured is mostly the pastes it must not claim. lib/speakerdeck-snippet.test.ts reads the
// snippet; this is what the editor does with it, the half that can eat text.
const SD_ID = '9de2f18094b14cbb91b07331eb085e4f';
const SD_HREF = `https://speakerdeck.com/player/${SD_ID}`;
const SD_IFRAME = `<iframe class="speakerdeck-iframe" frameborder="0" src="${SD_HREF}" title="deck" allowfullscreen="true" allow="web-share" style="width: 100%; height: auto; aspect-ratio: 560 / 315;" data-ratio="1.7777777777777777"></iframe>`;
const SD_SCRIPT = `<script defer class="speakerdeck-embed" data-id="${SD_ID}" data-ratio="1.7777777777777777" src="//speakerdeck.com/assets/embed.js"></script>`;

// A synthesized clipboard, `text/plain` only, as Speaker Deck's buttons write it.
// **The gesture must still be a range when the paste lands**: a Shift-arrow selection reaches state
// through the 20ms debounce (docs/editor-pitfalls.md §1.1), and the caret path would place the
// same embed, passing for the wrong reason.
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
    // **The blank line pasted on is consumed**, so assert the whole document.
    expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);
  }

  // **One undo takes the embed and leaves the typing**: the paste closes the history event, or
  // Ctrl+Z also removes what was typed just before. Same metas as link-paste-paragraph-guard.ts.
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
  // The end of a non-empty paragraph, which must survive whole, not be split around the embed.
  await page.keyboard.press('Control+End');
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);
});

test('a paste this is not stays exactly what it is today (SD12)', async ({ page }) => {
  // In a code block the snippet is being written about and stays text (§16.9).
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

  // A cell is `paragraph+`: `setEmbed` returns false and the paste must fall through, not be
  // swallowed. E7's answer, for this path.
  await openWith(page, '| A | B |\n| --- | --- |\n| c1 | c2 |\n');
  await page.locator('.ProseMirror td').first().click();
  await pasteText(page, SD_IFRAME);
  await expect(embed(page)).toHaveCount(0);
  expect(await markdown(page)).toContain('speakerdeck-iframe');

  // **A range in a cell is refused only after a deletion is staged**, so the staged deletion must be
  // thrown away (`preventDispatch`, speakerdeck-snippet-paste.ts). **The end state cannot show it**:
  // the fall-through replaces the selection either way. The count can: one, and two without the meta.
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
  // **The reported gesture**: dragging over the blank lines the embed should fill, then pasting.
  // `setEmbed` was caret-only, so the snippet landed as text.
  await openWith(page, '本文\n');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // Over both blank lines, the keyboard form of that drag.
  await page.keyboard.press('Shift+ArrowUp');
  await settle(page);
  await expectRange(page);
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  // **Both blank lines are consumed**: the deletion joins them before the embed replaces the rest.
  expect(await markdown(page)).toBe(`本文\n\n<div class="embed" data-href="${SD_HREF}"></div>`);

  // A selection with text is replaced, as any paste does.
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
  // **The reported gesture**: dragging the last line above the footnotes. The range ends at the first
  // definition's content start, crossing its isolating edge; unclamped, the deletion left the caret
  // in the definition, where no embed may go, and the paste landed as text.
  const source = '本文[^1]\n\n最終段落\n\n[^1]: 脚注の中身\n';
  const stored = `<div class="embed" data-href="${SD_HREF}"></div>`;

  await openWith(page, source);
  // Endpoints by position: which edge the range reaches must be exact.
  await page.locator('.ProseMirror > p').last().click();
  await page.keyboard.press('Home');
  await settle(page);
  const lineStart = await caretPos(page);
  const footnoteStart = await contentStartOf(page, 'footnoteDefinition');
  await setRange(page, lineStart, footnoteStart);
  await pasteText(page, SD_IFRAME);

  await expect(embed(page)).toHaveCount(1);
  // The footnote keeps every character: the clamp protects the join, not the text.
  expect(await markdown(page)).toBe(`本文[^1]\n\n${stored}\n\n[^1]: 脚注の中身`);

  // **A range reaching into the footnote text takes it, as a plain paste would**: compared against
  // one, and both lose the same two characters.
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
  // §16.10: the deck URL is the one reference whose missing button is the one the author meant, so
  // the hint appears there and nowhere else.
  const hint = page.locator('.link-bubble-deck-hint');
  // The title line, and so the href line, exist only with a title (§5.5.10). Stubbed: waiting on
  // speakerdeck.com would measure their uptime.
  await page.route('**/api/link-title**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'デッキ' }) }),
  );

  await openWith(page, '<https://speakerdeck.com/soudai/pgcon21j-tutorial>\n\n本文\n');
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(hint).toHaveText(/Copy iframe code/);
  await expect(page.locator('.link-bubble-href')).toBeVisible();
  // **Not the href line's colour**, which read as a third line of the reference (§16.10): the
  // difference is measured, not the value.
  const shades = await page.evaluate(() => ({
    hint: getComputedStyle(document.querySelector('.link-bubble-deck-hint')!).color,
    href: getComputedStyle(document.querySelector('.link-bubble-href')!).color,
  }));
  expect(shades.hint).not.toBe(shades.href);
  // Still convertible to a card, so the line is advice, not an error (§16.10).
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

// docs/embed-requirements.md §18, criterion G8. **§7's promise is at stake, not the gist**: the
// NodeView and the published stage build the same frame, and the gist's frame is a document.
// The report is delivered directly, as in public-embed.spec.ts: a frame sandboxed without
// `allow-same-origin` escapes Playwright's routing. **`source` is the frame's window**, which is
// how this surface authenticates; the id alone is copied with the element (§10.5).
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae?file=hello.rb';

// The name the NodeView minted, read from its document: the counter is not addressable here.
async function gistInstanceId(page: Page): Promise<string> {
  const id = await page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('.ProseMirror .embed-view iframe');
    return /,i="([^"]+)"/.exec(frame?.getAttribute('srcdoc') ?? '')?.[1] ?? null;
  });
  if (id === null) throw new Error('no instance id in the frame document');
  return id;
}

// A report as the frame's own under any name; the gist's origin is `"null"` (§18.5), so the
// window is all the NodeView can check.
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
  // The transition, not the pixel: the live gist re-measures once the box grows.
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(600);

  // 「リンクに戻す」 hands back the reference the author pasted, `?file=` and all.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${GIST}"></div>\n\n本文`);
});

test('a gist that drew nothing tells the author rather than degrading (G8)', async ({ page }) => {
  // §7.2: the editor says what happened, where the reference can be fixed, and says gist, not X's 投稿.
  await insertGist(page);
  await reportToEditor(page, 250, 0);

  await expect(page.locator('.ProseMirror .embed-unresolved')).toHaveCount(1);
  await expect(page.locator('.ProseMirror .embed-note')).toContainText('取得できない gist です');
  // The reference is still the author's, so it is still recoverable.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${GIST}"></div>\n\n本文`);
});

test('a video still gets scrolling="no" and neither new attribute (G8)', async ({ page }) => {
  // Both are the provider's answer, per render; this fails if either were set at construction.
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
  // **The first provider with both a `sandbox` and a real `src`**, so the two render stages could
  // most easily disagree (§4.3).
  await openWith(page, `<${CODESANDBOX}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: '埋め込みにする' })).toBeVisible();
  await page.getByRole('button', { name: '埋め込みにする' }).click();
  await expect(embed(page)).toHaveClass(/embed-codesandbox/);

  const iframe = embed(page).locator('iframe');
  // `runonclick=1`, which the author never wrote: the NodeView shows what a reader gets (§20.2,
  // §20.5).
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

// docs/embed-requirements.md §20.14: **CodeSandbox's content is an editor**, so where does a key go
// once the frame is live? At rest it is `pointer-events: none`; reaching inside takes a selecting
// click and a second click. **Focus decides, and the two clicks answer differently**, so both are
// measured. The sandbox is our stub; it is routable and addressable only because it keeps
// `allow-same-origin` (§20.7), unlike the gist's (§18.6).
const CS_STUB =
  '<!doctype html><title>stub</title><body style="margin:0"><textarea id="t" style="width:100%;height:400px"></textarea>';

async function openSandbox(page: Page): Promise<void> {
  await page.route('https://codesandbox.io/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: CS_STUB }),
  );
  await openWith(page, `<div class="embed" data-href="${CODESANDBOX}"></div>\n\n本文\n`);
  // **The wait is setup, and measured**: a click on a just-loaded embed does not select it; the same
  // click ~500ms later does (0-200ms fail, 500ms+ pass), and two clicks work, so the first is
  // swallowed, not mis-aimed. The node is not replaced, the class never set, focus stays in the
  // editor, the hit target is right; waiting on the iframe document or autosave is not enough. The
  // mechanism is unknown. Authors never meet it: the insert flow selects what it inserts.
  await page.waitForTimeout(600);
  // The §7 click: the frame is inert, so ProseMirror selects the node.
  await embed(page).locator('.embed-frame').click();
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
}

test('with the block selected, a keystroke still goes to the document (§20.14)', async ({
  page,
}) => {
  await openSandbox(page);
  expect(await docString(page)).toBe('doc(embed, paragraph("本文"))');

  // One click in, the editor has focus, so typing replaces the selected node, as for the card, and
  // undoably. The answer, not a bug: a guard would remove replacing a block by typing.
  await page.keyboard.type('X');
  expect(await docString(page)).toBe('doc(paragraph("X"), paragraph("本文"))');
});

test("once the frame has focus, the keys are the frame's (§20.14)", async ({ page }) => {
  await openSandbox(page);
  const intact = await docString(page);
  const textarea = page.frameLocator('.embed-view iframe').locator('#t');
  await textarea.click();

  await page.keyboard.type('Y');
  // **This is the discriminator**: had the click not reached inside, the key would have replaced the
  // node, and the document assertion would describe the harness (CDP input, criterion E12).
  await expect(textarea).toHaveValue('Y');
  expect(await docString(page)).toBe(intact);

  // Backspace too: §7.3's one-press atom delete does not fire, since the editor never sees the key.
  await page.keyboard.press('Backspace');
  await expect(textarea).toHaveValue('');
  expect(await docString(page)).toBe(intact);

  // **The ring stays up**: focus left the editor, the selection did not, so the ring does not say
  // where a key goes.
  await expect(embed(page)).toHaveClass(/ProseMirror-selectednode/);
});

// docs/embed-requirements.md §5 inferred no new slice guard was needed: the embed is a block atom
// like the card, covered by `titleAcceptsSlice` and `carriesNonParagraphBlock`
// (embed-placement.test.ts). That test cannot see the hop before them (the guard reads `$from`), so
// one route runs end to end through the real clipboard: the accordion title, where the failure is
// a tear, not a refusal (docs/accordion-requirements.md §6.6).
const TITLE_NO_BLOCKS = 'アコーディオンのタイトルには段落やブロックを入れられません';

const WITH_ACCORDION = `<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n\n<div class="embed" data-href="${WATCH}"></div>\n`;

// From the state, not a click: a click's caret reaches state ~20ms late, and the guard reads state.
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

  // A NodeSelection, as the drag handle makes: a slice closed on both sides, the unit test's shape.
  await selectNode(page, 'embed');
  await page.keyboard.press('Control+c');
  await setRange(page, await firstPos(page, 'detailsSummary'));
  await page.keyboard.press('Control+v');

  const toast = page.getByRole('status');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(TITLE_NO_BLOCKS);
  // The whole document: the symptom is a second accordion, and a message-only check would also pass
  // if the refusal ate the title.
  expect(await docString(page)).toBe(intact);
});

// **The control is required**: `titleAcceptsSlice` also refuses an empty slice, so the refusal
// passes with a broken clipboard. The accordion's body (`block+`) makes the refusal title-specific.
test('the same copy still lands as an embed where one may go', async ({ page }) => {
  await openWith(page, WITH_ACCORDION);
  await selectNode(page, 'embed');
  await page.keyboard.press('Control+c');
  // +1 past `detailsContent`: its first paragraph's start.
  await setRange(page, (await firstPos(page, 'detailsContent')) + 1);
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(embed(page)).toHaveCount(2);
  expect(await docString(page)).toContain('detailsContent(embed, paragraph("本文"))');
});

// docs/embed-requirements.md §8.4, the gist half of E17: a reorder rebuilds the NodeView, resetting
// its state and minting a new `instanceId`, so a gist that did not report under the new name would
// fail eight seconds later. **Only the parent's half**: GitHub's script cannot be stubbed in the
// frame (§18.6), and the real answer would test GitHub's uptime. The two reports differ only in id,
// with opposite outcomes.
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

  // The gate (§8.4 row 1): surviving stamps would mean no rebuild.
  await expect(embed(page).locator('[data-mark]')).toHaveCount(0);
  const secondId = await gistInstanceId(page);
  expect(secondId).not.toBe(firstId);

  // The retired name is rejected; `files: 0` draws the note, so acceptance would show. The dispatch
  // is synchronous.
  await reportAs(page, firstId, 250, 0);
  await expect(page.locator('.ProseMirror .embed-note')).toHaveCount(0);

  // The same report under the new name lands.
  await reportAs(page, secondId, 250, 0);
  await expect(page.locator('.ProseMirror .embed-note')).toContainText('取得できない gist です');
});

// docs/embed-requirements.md §8.1's last open item: the native drag path, which does not set
// `body.block-dragging`. **Closed by the two states below without it.** The computed
// `pointer-events` is asserted, for E12's reason (CDP bypasses frame hit-testing).
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

// Read from a listener after prosemirror-view's own; the guard's is on `view.dom`.
type DragStartProbe = { fired: boolean; prevented: boolean };
type ProbeWindow = Window & { __dragStartProbe?: DragStartProbe };

function armDragStartProbe(page: Page): Promise<void> {
  return page.evaluate(() => {
    const probe: DragStartProbe = { fired: false, prevented: false };
    (window as ProbeWindow).__dragStartProbe = probe;
    document.addEventListener('dragstart', (event) => {
      probe.fired = true;
      probe.prevented = event.defaultPrevented;
    });
  });
}

function readDragStartProbe(page: Page): Promise<DragStartProbe | null> {
  return page.evaluate(() => (window as ProbeWindow).__dragStartProbe ?? null);
}

test('a native drag on the embed’s body is refused, ringed or not (§7.7)', async ({ page }) => {
  // The third type the dragstart guard covers; editor-block-drag-handle.spec.ts leaves it here for
  // the X stub. The press itself is refused (docs/link-card-requirements.md §7.7), so nothing is
  // picked up.
  await openWith(page, NATIVE_DRAG_MD);
  const before = await page.locator('input[name="body"]').inputValue();
  const box = (await embed(page).boundingBox())!;
  const last = (await page.locator('.ProseMirror p').last().boundingBox())!;
  await armDragStartProbe(page);

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

  // **The gate is the gesture**: a drag that never starts and a press CDP never delivered look the
  // same, so `dragstart` must reach the document already cancelled.
  const probe = await readDragStartProbe(page);
  expect(probe?.fired).toBe(true);
  expect(probe?.prevented).toBe(true);

  // Nothing picked up, and nothing moved.
  expect(seen?.carried).toBeNull();
  expect(await page.locator('input[name="body"]').inputValue()).toBe(before);

  // Unringed, so the frame is inert: the same refusal from `none` here and `auto` below.
  expect(seen?.selected).toBe(false);
  expect(seen?.pointerEvents).toBe('none');
  // Not §8.1's fix: that class is the handle's.
  expect(seen?.blockDragging).toBe(false);
});

test('a selected embed cannot start a native drag at all (§8.1)', async ({ page }) => {
  // Selected, the frame is live (§7), so the press lands inside the iframe and the parent never
  // sees it: no `dragstart`, no drag.
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
  // Nothing picked up, so the live frame is harmless.
  expect(seen.carried).toBeNull();
});

// docs/embed-requirements.md §21. The pen page URL an author pastes from the address bar.
const CODEPEN = 'https://codepen.io/flatsato/pen/VwqprLp';

test('the editor builds the same pen frame the reader gets (P6)', async ({ page }) => {
  // Routed for §21.13: real pens would spend this IP's budget with CodePen's rate challenge.
  await page.route('https://codepen.io/*/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  await openWith(page, `<${CODEPEN}>\n\n本文\n`);
  await page.locator('.ProseMirror a').first().click();
  const offer = page.getByRole('button', { name: '埋め込みにする' });
  await expect(offer).toBeVisible();
  // **§14.8's trap**: a provider with no `embedMarkShapes` branch silently gets the play frame, so
  // assert the cube (the play mark has a `rect`).
  await expect(offer.locator('svg rect')).toHaveCount(0);
  await expect(offer.locator('svg path')).toHaveAttribute('d', /^M 12 22\.747/);
  await offer.click();
  await expect(embed(page)).toHaveClass(/embed-codepen/);

  const iframe = embed(page).locator('iframe');
  // **The author sees the reader's frame**: the bare src (§21.5), the same attributes (§21.7).
  await expect(iframe).toHaveAttribute('src', 'https://codepen.io/flatsato/embed/VwqprLp');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('allow', '');
  expect(await iframe.getAttribute('srcdoc')).toBeNull();

  // Chosen, not computed (§21.6): 300px narrow, 450px from 48rem; the viewport is above that
  // line, as in public-embed.spec.ts (P7).
  const frame = embed(page).locator('.embed-frame');
  expect((await frame.boundingBox())!.height).toBeCloseTo(450, 0);

  // 「リンクに戻す」 hands back the page URL the author pasted, not the embed form built from it.
  expect(await markdown(page)).toBe(`<div class="embed" data-href="${CODEPEN}"></div>\n\n本文`);
});
