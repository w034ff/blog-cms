import { test, expect, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import { loadMarkdown, selectInside, setRange } from './editor-authoring';

// The link card (components/editor/LinkBubble.tsx, docs/link-requirements.md §5.5): the editor's
// only link UI. It answers two measured holes — there was no way to make an internal link at all
// (§2.1.1), and `openOnClick: false` (§3) had removed "open this link" — so the cases below are
// mostly about what an author can now *do*, not about a regression.
//
// Positions are set programmatically rather than by clicking: a caret-placing click reaches
// `state.selection` a debounce later (§5.5.4-6), and these tests care about the exact caret, not
// about where a click lands. The one click-driven case polls instead of reading once.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」— doc positions: 2 is the link's left edge, 3..4 inside it, 5 its right edge.
const IN_LINK = 3;
const LINK_RIGHT_EDGE = 5;
const OUTSIDE_LINK = 1;

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}

// Every case in this file watches for a thrown error, because one of them hid here: the event this
// menu hands a prop callback is `Object.create(realEvent)`, so reading `.key` off it threw
// "Illegal invocation" on every keystroke inside the card — and a throw inside a DOM handler looks
// exactly like nothing happening. The card kept working, so no assertion about the document would
// ever have caught it. Follows publish-flow.spec.ts, which watches console errors too (render-phase
// violations arrive that way in dev).
const pageErrors: string[] = [];
test.beforeEach(({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /Cannot update|Maximum update depth/.test(message.text())) {
      pageErrors.push(message.text());
    }
  });
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

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
}

test('the card appears with the href when the caret is in a link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  // Seeing where a link points is the half of this the `openOnClick: false` trade took away.
  // Asserted on the line itself rather than on the card: the hover tooltip holds the raw href, so
  // `toContainText` against the whole card would go on passing however the line was drawn.
  await expect(card(page).getByRole('button', { name: 'リンク先を開く' })).toContainText(
    'example.com',
  );
});

test('the card stays away when the caret is outside a link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, OUTSIDE_LINK);
  await settle(page);
  await expect(card(page)).toBeHidden();
});

test('the card appears with the caret at a link right edge', async ({ page }) => {
  // Where a click most often lands. It works because the mark is inclusive, which it is only
  // because §4 kept `autolink: true` — the coupling is worth pinning.
  await openEditor(page);
  await setRange(page, LINK_RIGHT_EDGE);
  await expect(card(page)).toBeVisible();
});

test('解除 removes the link from the right edge too', async ({ page }) => {
  await openEditor(page);
  await setRange(page, LINK_RIGHT_EDGE);
  await card(page).getByRole('button', { name: '解除' }).click();
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前リンク後"))');
  await expect(card(page)).toBeHidden();
});

test('編集 changes the href and keeps the title', async ({ page }) => {
  // The one real link in the corpus carries a `title`, and the public sanitizer keeps it — losing
  // it while fixing a URL would be a silent edit of a published post (§5.3-3).
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await field.fill('https://changed.example');
  await field.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://changed.example "タイトル")後');
});

test('the href itself opens the link in a new tab', async ({ page }) => {
  // The href display *is* the open button (§5.5.6), so this asks for it by the accessible name the
  // card sets on it rather than by its visible text, which is the URL.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: 'リンク先を開く' }).click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []),
  ).toEqual(['https://example.com']);
});

test('Mod-k over a selection makes an internal link', async ({ page }) => {
  // §2.1.1: no path in this editor could produce one. linkifyjs finds neither a fragment nor a
  // relative path, and typed `[]()` is escaped on save before the parser ever sees it (§2.2.1).
  await openEditor(page);
  await loadMarkdown(page, 'ここを見出しにつなぐ\n');
  await setRange(page, 1, 3); // 「ここ」
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await field.fill('#見出し');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(link("ここ"), "を見出しにつなぐ"))');
  expect(await markdown(page)).toBe('[ここ](#見出し)を見出しにつなぐ');
});

test('Mod-k with an empty selection says what to do instead of making an empty link', async ({
  page,
}) => {
  await openEditor(page);
  await setRange(page, OUTSIDE_LINK);
  await page.keyboard.press('Control+k');
  await expect(page.getByText('リンクにするテキストを選択してください')).toBeVisible();
  await expect(card(page)).toBeHidden();
});

test('the URL field refuses a scheme publishing would drop', async ({ page }) => {
  // The same subtraction the paste paths answer (editor/link-protocols.ts). A refused setLink
  // changes nothing, so without the notice the button would look broken.
  await openEditor(page);
  await loadMarkdown(page, '電話をかける\n');
  await setRange(page, 1, 3);
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('tel:+81312345678');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("電話をかける"))');
  await expect(page.getByText('このリンク先は公開できないため設定していません')).toBeVisible();
  // The field stays open and keeps the caret: a refusal is something to correct, not to start over
  // from. (A `.focus()` in the same chain as the refused command would have moved it — a chain
  // still dispatches whatever ran before the refusal.)
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('tel:+81312345678');
});

test('the card says so where the schema will not hold a link', async ({ page }) => {
  // `detailsSummary` and `codeBlock` both declare `marks: ''`. setMark reports success and the
  // schema drops the mark, so without this check the field would close on a link that was never
  // made — the shape §2.4/§2.5 exist to prevent. (The accordion and the footnote already collided
  // once for want of asking this kind of question — see docs/accordion-requirements.md.)
  await openEditor(page);
  await loadMarkdown(page, '<details><summary>たたみ見出し</summary>\n\n中身\n\n</details>\n');
  await selectInside(page, 'detailsSummary');
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toContain('detailsSummary("たたみ見出し")');
  expect(await docString(page)).not.toContain('link(');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
  await expect(field).toBeFocused();
});

test('the same inside a code block', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '```js\nconst a = 1;\n```\n');
  await selectInside(page, 'codeBlock');
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).not.toContain('link(');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
});

test('the same over an inline code span', async ({ page }) => {
  // A different mechanism reaching the same refusal: the node here allows marks, but the `code`
  // mark excludes every other one. canSetMark covers both, which is why one message serves.
  await openEditor(page);
  await loadMarkdown(page, '`const a` のこと\n');
  await setRange(page, 1, 8);
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://example.com');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph(code("const a"), " のこと"))');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
});

test('an emptied URL field removes the link', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('');
  await field.press('Enter');
  await settle(page);
  expect(await docString(page)).toBe('doc(paragraph("前リンク後"))');
});

test('Escape closes the card and the caret stays where it was', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await page.locator('.ProseMirror').press('Escape');
  await expect(card(page)).toBeHidden();
  // Dismissal is scoped to this visit: leaving the link and coming back brings the card back.
  await setRange(page, OUTSIDE_LINK);
  await settle(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
});

test('Escape leaves the URL field without applying it', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://not-applied.example');
  await field.press('Escape');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('a link inside a table cell hides the table toolbar', async ({ page }) => {
  // §5.5.4-2: both menus' shouldShow are satisfied at once inside a cell, and the decision is that
  // the link card wins there.
  await openEditor(page);
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| [ここ](https://example.com) | y |\n');
  await page.locator('.ProseMirror td a').click();
  await expect(card(page)).toBeVisible();
  // Two assertions for one fact, on purpose. The class is the mechanism (LinkBubble sets it from
  // the bubble menu's onShow); `toBeHidden` is what an author would see. While this file was being
  // written, the second one failed reliably here for its whole timeout — and stopped once the file
  // grew, with no change to either component. What the page looked like during those runs was never
  // captured, so which of the two was untrue then is unknown. If this goes red again, the pair says
  // which half broke instead of leaving that to be re-derived.
  await expect(page.locator('body')).toHaveClass(/link-menu-open/);
  await expect(page.locator('.table-toolbar')).toBeHidden();

  // And the table controls come back once the caret leaves the link — the other half of the
  // decision, which a one-way suppression would fail.
  await page.locator('.ProseMirror td', { hasText: 'y' }).click();
  await expect(card(page)).toBeHidden();
  await expect(page.locator('.table-toolbar')).toBeVisible();
});

// The tint that says which text the card is about (§5.5.7). `highlight` is the decoration
// link-highlight-extension.ts paints; it exists only while the card is up.
function highlight(page: Page) {
  return page.locator('.link-bubble-target');
}

test('the link the card is about is tinted, and only while the card is up', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(highlight(page)).toHaveText('リンク');
  // Escape is the case a document-derived highlight would get wrong: the caret is still inside the
  // link, so the mark is still active — what changed is only that the card is gone.
  await page.locator('.ProseMirror').press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
});

test('a blur that takes the card away takes the tint with it', async ({ page }) => {
  // The plugin hides the card when the editor loses focus to nothing, and it re-asks `shouldShow`
  // only on a selection- or document-changing transaction. Clicking the page margin is neither, so
  // a tint derived from `shouldShow` alone stayed lit under no card at all until some later edit
  // cleared it — measured before the fix. The tint follows the plugin's own onShow/onHide instead.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(highlight(page)).toHaveText('リンク');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
  // And coming back lights it again, rather than leaving the card over untinted text.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('the tint is present with the caret at the link right edge', async ({ page }) => {
  // Where a click most often lands, and where `getMarkRange` resolves to nothing (§5.5.2's table)
  // while `isActive` still reads true. A range taken from a single `getMarkRange` would leave the
  // card showing over untinted text at exactly the position authors reach first.
  await openEditor(page);
  await setRange(page, LINK_RIGHT_EDGE);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('the tint follows the caret from one link to the next', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '[AAA](https://a.example)と[BBB](https://b.example)。\n');
  await setRange(page, 2);
  await expect(highlight(page)).toHaveText('AAA');
  await setRange(page, 6);
  await expect(highlight(page)).toHaveText('BBB');
  // One tint at a time — the previous link's must be taken down, not merely added to.
  await expect(highlight(page)).toHaveCount(1);
});

test('Mod-k tints the selection that is about to become a link', async ({ page }) => {
  // No link exists yet here, so the range cannot come from the mark. Focus is in the URL field, so
  // ProseMirror is not drawing its own selection either — without this the author is typing a URL
  // with nothing on screen saying what it will be attached to.
  await openEditor(page);
  await loadMarkdown(page, 'ここを見出しにつなぐ\n');
  await setRange(page, 1, 3);
  await page.keyboard.press('Control+k');
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
  await expect(highlight(page)).toHaveText('ここ');
});

test('clicking elsewhere closes the URL field and applies nothing', async ({ page }) => {
  // §5.5.7. Before this, the open field stayed up and re-anchored to wherever the caret had gone —
  // it slid down the line while still claiming to be editing the link it was opened on.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://not-applied.example');
  // Far along the same paragraph, well outside the link.
  await page
    .locator('.ProseMirror p')
    .first()
    .click({ position: { x: 300, y: 8 } });
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('clicking inside the card does not close the URL field', async ({ page }) => {
  // The dismissal listener is on the document and the card is portalled to <body>, so it sees the
  // card's own clicks too. Reaching for the field after clicking its label-side padding must not
  // count as leaving.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://kept.example');
  await field.click();
  await expect(field).toBeFocused();
  await field.press('Enter');
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://kept.example "タイトル")後');
});

// The favicon of the origin a link points at (§5.5.8). None of these reaches the internet: the
// success case asks this blog's own origin, which serves `app/favicon.ico`, and the failure case
// asks a port nothing is listening on.
function favicon(page: Page) {
  return page.locator('.link-bubble img');
}

test('an internal link shows this blog own favicon', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '[記事](/posts/hello)へ。\n');
  await setRange(page, 2);
  await expect(card(page)).toBeVisible();
  await expect(favicon(page)).toBeVisible();
  await expect(favicon(page)).toHaveAttribute('src', /^https?:\/\/[^/]+\/favicon\.ico$/);
});

test('a favicon that will not load leaves the card as it was', async ({ page }) => {
  // A reserved-but-empty box would read as a broken image, so on failure nothing is drawn at all
  // and the href keeps the left of the card. Both corpus hosts do in fact serve their icon to a
  // browser, so this is pinned against a dead port rather than a real site — and pinned at all
  // because the failure path is the one that decides how the card behaves for the sites that
  // declare an icon only in HTML, which no offline test can supply.
  await openEditor(page);
  await loadMarkdown(page, '[落ちる](http://127.0.0.1:1/x)へ。\n');
  await setRange(page, 2);
  await expect(card(page)).toBeVisible();
  await expect(favicon(page)).toBeHidden();
  await expect(card(page)).toContainText('http://127.0.0.1:1/x');
});

test('a scheme with no origin asks for no favicon at all', async ({ page }) => {
  // `mailto:` has no host to ask, so there must be no <img> at all — not a hidden one that has
  // already fired a request at something. (`tel:` would be the other example, but §2.4 refuses it:
  // it dies on publish, so no link forms and there is no card to look at.)
  await openEditor(page);
  await loadMarkdown(page, '[宛先](mailto:a@example.com)へ。\n');
  await setRange(page, 2);
  await expect(card(page)).toBeVisible();
  await expect(favicon(page)).toHaveCount(0);
});

test('the favicon follows the caret from one link to the next', async ({ page }) => {
  // `loaded` is per-link state, reset by remounting under a key rather than by an effect. Without
  // that, a link whose icon loaded would lend its "shown" state to the next link's failure.
  await openEditor(page);
  await loadMarkdown(page, '[内側](/posts/hello)と[外側](http://127.0.0.1:1/x)。\n');
  await setRange(page, 2);
  await expect(favicon(page)).toBeVisible();
  await setRange(page, 6);
  await expect(card(page)).toContainText('127.0.0.1');
  await expect(favicon(page)).toBeHidden();
});

// Where the card sits (§5.5.10). It is above the link, so what it covers is text already read
// rather than text coming next — which only became worth deciding once the title line made the
// card tall enough to cover a whole paragraph.
async function rects(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    };
    return {
      cardBox: box(document.querySelector('.link-bubble')),
      linkBox: box(document.querySelector('.ProseMirror a')),
      toolbarBox: box(document.querySelector('.sticky')),
    };
  });
}

test('the card sits above the link it is about', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(
    page,
    '一行目。\n\n二行目。\n\n前[リンク](https://example.com)後\n\n四行目。\n',
  );
  await setRange(page, 15); // inside the link in the third paragraph
  await expect(card(page)).toBeVisible();
  await settle(page);
  const { cardBox, linkBox } = await rects(page);
  expect(cardBox && linkBox && cardBox.bottom).toBeLessThanOrEqual(linkBox!.top);
});

test('a link in the first line puts the card clear of the toolbar', async ({ page }) => {
  // Above-placement's one hazard, and `flip` alone does not answer it: the toolbar is
  // `sticky top-0 z-30` right over the content, so the first line has viewport room above it and
  // none that is free. Measured before the boundary was set — the card was placed there and, at
  // z-20, rendered underneath the toolbar: on screen and invisible.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](https://example.com)後の一行目。\n\n二行目。\n');
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await settle(page);
  const { cardBox, toolbarBox } = await rects(page);
  expect(toolbarBox).not.toBeNull();
  expect(cardBox!.top).toBeGreaterThanOrEqual(toolbarBox!.bottom);
});

// The card's title line (§5.5.10). Only the internal case is measurable offline: a link to this
// blog is answered from the database rather than fetched, which is what makes it deterministic —
// and is also the security property that keeps the server from requesting its own public URL.
test('a link to this blog shows the post title above the URL', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '前[記事](/posts/hello-world)後\n');
  await setRange(page, 3);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('ブログ開設のお知らせ');
  // The URL never leaves: §5.5.1-1 makes "where does this go" the reason the card exists, and a
  // title answers what a page is, not where it goes.
  await expect(card(page)).toContainText('/posts/hello-world');
});

test('the top line is what opens the link, and the URL line under it is only text', async ({
  page,
}) => {
  // The rule is positional. With a title the URL becomes display text, and the title takes over as
  // the control — so the card still has exactly one thing to press, and it is still drawn in the
  // link colour.
  await openEditor(page);
  await loadMarkdown(page, '前[記事](/posts/hello-world)後\n');
  await setRange(page, 3);
  await expect(card(page)).toContainText('ブログ開設のお知らせ');
  const open = card(page).getByRole('button', { name: 'リンク先を開く' });
  await expect(open).toHaveText('ブログ開設のお知らせ');
  // The URL is present, and pressing where it sits opens nothing — there is no control there.
  await expect(card(page)).toContainText('/posts/hello-world');
  await expect(card(page).getByRole('button')).toHaveCount(4); // open + copy + edit + unlink
  // Each line's hover tooltip carries its own line untruncated, and only its own: the URL is not
  // repeated onto the title's, because it has a line and a tooltip of its own right below. These
  // are the editor's own tooltips, not the native `title` attribute — which is why they can be
  // read here at all, and why they look like the toolbar's.
  const tips = card(page).locator('.editor-tooltip');
  await expect(tips.nth(0)).toHaveText('ブログ開設のお知らせ');
  await expect(tips.nth(1)).toHaveText('/posts/hello-world');
  await expect(card(page).locator('[title]')).toHaveCount(0);
  await card(page).locator('.link-bubble-href').click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []),
  ).toEqual([]);
});

test('https:// is dropped from the line but from nothing else', async ({ page }) => {
  // Display only. Chrome's address bar makes the same trade, and the tooltip is where the raw form
  // stays reachable — so this asserts both halves, since a strip that also reached the href would
  // be a silent edit of what the post stores.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](https://example.com/a/b)後\n');
  await setRange(page, 3);
  const open = card(page).getByRole('button', { name: 'リンク先を開く' });
  await expect(open).toHaveText('example.com/a/b');
  await expect(card(page).locator('.editor-tooltip').first()).toHaveText('https://example.com/a/b');
  // What it opens, and what the document keeps, are the href untouched.
  await open.click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []),
  ).toEqual(['https://example.com/a/b']);
  expect(await markdown(page)).toBe('前[リンク](https://example.com/a/b)後');
});

test('http:// is left where it is', async ({ page }) => {
  // The reason dropping the scheme is safe at all: with only the default one hidden, a link that
  // is not encrypted is the one that shows its scheme. A strip that took both would invert that.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](http://example.com/a/b)後\n');
  await setRange(page, 3);
  await expect(card(page).getByRole('button', { name: 'リンク先を開く' })).toHaveText(
    'http://example.com/a/b',
  );
});

test('a link with no obtainable title is the card as it was', async ({ page }) => {
  // A dead port, so this runs offline. The failure has to be quiet: no title is the resting state,
  // not an error state.
  await openEditor(page);
  await loadMarkdown(page, '前[記事](http://127.0.0.1:1/x)後\n');
  await setRange(page, 3);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('http://127.0.0.1:1/x');
  await settle(page);
  await expect(card(page).getByRole('button', { name: 'リンク先を開く' })).toHaveText(
    'http://127.0.0.1:1/x',
  );
});

test('a scheme with no page behind it asks for no title', async ({ page }) => {
  // Measured as a difference rather than as "no requests were seen": an empty list is also what a
  // listener attached to the wrong thing produces, and this file has been bitten by an assertion
  // that held because nothing was happening at all. So an http link is visited first to prove the
  // instrument reports something, and the mailto is then asserted to add nothing to it.
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/link-title')) asked.push(r.url());
  });
  await openEditor(page);
  await loadMarkdown(page, '前[記事](/posts/hello-world)後\n');
  await setRange(page, 3);
  await expect(card(page)).toContainText('ブログ開設のお知らせ');
  expect(asked).toHaveLength(1);

  await loadMarkdown(page, '前[宛先](mailto:a@example.com)後\n');
  await setRange(page, 3);
  await expect(card(page)).toBeVisible();
  await settle(page);
  expect(asked).toHaveLength(1);
});

test('a control outside the editor takes the display card away, and coming back restores it', async ({
  page,
}) => {
  // Reported as buttons that leave the card floating: the click dispatches no transaction, so the
  // plugin never re-asks `shouldShow` and the card simply stays. The post's own form controls are
  // one half of the report (§5.5.9).
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await page
    .getByRole('textbox', { name: /タイトル/ })
    .first()
    .click();
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
  // Not a permanent dismissal — unlike Escape, this one is cleared by focus returning.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('a link card button inside the editor takes the display card away too', async ({ page }) => {
  // The other half of the report, and the reason the rule is about focus rather than about being
  // outside the editor's DOM: this button is inside it.
  await openEditor(page);
  await loadMarkdown(
    page,
    '<div class="link-card" data-href="/posts/hello"></div>\n\n前[リンク](https://example.com)後\n',
  );
  await setRange(page, 4); // inside the link, one block after the card
  await expect(card(page)).toBeVisible();
  await page.locator('.ProseMirror').getByRole('button', { name: /変更/ }).first().click();
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
});

test('a toolbar button leaves the display card alone', async ({ page }) => {
  // The exemption, and the case that would regress if the rule were "hide on blur". A toolbar
  // command emits blur *and* focus — it chains `.focus()` — while the reported buttons emit blur
  // alone. The toolbar is also the one place outside the editor that acts on the very selection
  // the card is describing, so keeping the card is right rather than merely tolerable.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: /太字/ }).click();
  await settle(page);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('leaving the card for the page around it closes the URL field', async ({ page }) => {
  // Not every departure is a click into the document: the post's own fields are outside both the
  // editor and the card. The whole card goes, not just the field — leaving the display card behind
  // would be the complaint §5.5.9 answers, reached by another route. It cannot ride on the blur
  // rule either: the editor lost focus when the field took it, so leaving the field for a third
  // place fires no blur of its own.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
  await page
    .getByRole('textbox', { name: /タイトル/ })
    .first()
    .click();
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
  // Returning to the link brings it back, in display mode.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toHaveCount(0);
});

test('tabbing out of the card closes the URL field', async ({ page }) => {
  // The card is portalled to the end of <body>, so there is no next control after its last button:
  // focus leaves for nothing. Measured before the fix — the field stayed mounted and unfocused
  // until some later click happened to close it.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await page.keyboard.press('Tab'); // 保存
  await page.keyboard.press('Tab'); // やめる
  await page.keyboard.press('Tab'); // out
  await settle(page);
  await expect(field).toHaveCount(0);
  // Opening the field is itself a focusout — the 編集 button focus was on is unmounted by it — so
  // an implementation reading the event's relatedTarget instead of the settled focus would close
  // the field the instant it opened. That this test had a field to tab out of is that assertion.
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('the URL field survives an autosave', async ({ page }) => {
  // §5.3-2: a server action's form reset blanked a NodeView's <input> once before. This one is
  // portalled to <body>, outside PostEditor's single <form>, so it should never be associated with
  // it — measured rather than assumed, since "open the field and think about the URL" is exactly
  // the pause an autosave lands in.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://slowly-typed.example');
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });
  await expect(field).toHaveValue('https://slowly-typed.example');
});
