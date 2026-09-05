import { test, expect, devices, type Page } from '@playwright/test';
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
  // No title, stubbed rather than assumed. `https://example.com` really answers, and a title takes
  // the top line over (§5.5.10) — so this read "Example Domain" on a machine with a network and the
  // URL on one without; editor-link-text-field.spec.ts records the same trap, solved there by an
  // href nothing can answer for. Scoped to this case rather than to openEditor, because a /posts/
  // link is answered from the database through this same route, which is what the title cases
  // below measure.
  await page.route('**/api/link-title**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: null }) }),
  );
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

test('適用 is the only button of the edit mode, and pressing it applies', async ({ page }) => {
  // §5.5.16. The edit mode carries one button and it commits; every way of leaving without
  // applying is a gesture, not a control (Escape and the two cases above). The count is asserted
  // because that is the decision — a second button here was 取り消し, and its ✕ could not be told
  // from the display card's 解除.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(card(page).getByRole('button')).toHaveCount(1);
  await field.fill('https://applied.example');
  await card(page).getByRole('button', { name: '適用' }).click();
  await settle(page);
  expect(await markdown(page)).toBe('前[リンク](https://applied.example "タイトル")後');
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

test('the card is not seen collapsing on the way out', async ({ page }) => {
  // §5.5.15. The field folds into the display card synchronously, and the card used to be taken
  // away only when the caret's own transaction arrived — so the display card was painted over the
  // link the author had just left. Reported as a flash, and it was 3 frames of one (measured).
  //
  // Sampled per frame from inside the page, because that is the only place the intermediate state
  // exists: it is gone long before any assertion could be evaluated over the protocol.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeVisible();
  const samples = page.evaluate(async () => {
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const el = document.querySelector<HTMLElement>('.link-bubble');
      if (!el || getComputedStyle(el).visibility === 'hidden') seen.push('gone');
      else seen.push(el.querySelector('input') ? 'field' : 'display');
    }
    return seen;
  });
  await page
    .locator('.ProseMirror p')
    .first()
    .click({ position: { x: 300, y: 8 } });
  const seen = await samples;
  expect(seen).not.toContain('display');
  // The window has to contain the departure itself, or the assertion above is about nothing: a
  // sampler that ran out before `click()` dispatched its mousedown would see the open field for
  // all 30 frames and pass. Both ends being present is what proves it watched the transition.
  expect(seen).toContain('field');
  expect(seen).toContain('gone');
  await settle(page);
  await expect(card(page)).toBeHidden();
});

test('a press inside the same link keeps the card', async ({ page }) => {
  // The other side of the rule above: the press that closes the field decides whether the card is
  // going away, and a press inside the link the card is about is not one of those. Nothing here
  // may hide it, since the caret lands back inside the very link it describes.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeVisible();
  await page.locator('.ProseMirror a').first().click();
  await settle(page);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('button', { name: '編集' })).toBeVisible();
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
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    // Where the selection is on screen, asked of the editor rather than of the DOM selection: the
    // card is placed against `state.selection`, so the assertions have to be about the same thing.
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            state: { selection: { from: number } };
            view: { coordsAtPos(pos: number): { top: number; bottom: number; left: number } };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const { top, bottom, left } = el.editor.view.coordsAtPos(el.editor.state.selection.from);
    return {
      cardBox: box(document.querySelector('.link-bubble')),
      linkBox: box(document.querySelector('.ProseMirror a')),
      toolbarBox: box(document.querySelector('.sticky')),
      selectionBox: { top, bottom, left },
      scrollY: window.scrollY,
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

// Where the card sits when `Mod-k` is what opened it (§5.5.11). That path does not go through the
// plugin's own show-and-place; it asks by meta, and the meta places the card *before* it is on
// screen, which is one instruction too early. All three cases below were the same card in the wrong
// place, and none of them is visible to an assertion about the document.
//
// A document tall enough that its own first line goes off screen. The text to be linked is a heading
// so the selection can be taken by node type instead of by counting positions through the filler.
const TALL = (lead: string) => `${lead}${'埋め草の段落。\n\n'.repeat(20)}## ここをリンクにする\n`;

test('Mod-k after the card has been at another link opens the field on the selection', async ({
  page,
}) => {
  // The card keeps its coordinates when it is hidden (only visibility and opacity are cleared), and
  // `meta === 'show'` runs `updatePosition()` — which begins `if (!this.isVisible) return` — before
  // `show()`. So the card came back at the link it was last at, a screenful above the text the
  // author had selected.
  await openEditor(page);
  await loadMarkdown(page, TALL('前[リンク](https://example.com)後\n\n'));
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await settle(page);
  await selectInside(page, 'heading');
  await settle(page);
  await expect(card(page)).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
  await settle(page);
  const { cardBox, selectionBox } = await rects(page);
  expect(cardBox!.bottom).toBeLessThanOrEqual(selectionBox.top);
  // Against the selection's own rect, not a pixel constant: what is being pinned is that the card
  // is *at* the selection — one offset away — rather than wherever it happened to be before.
  expect(selectionBox.top - cardBox!.bottom).toBeLessThan(24);
});

test('the first Mod-k of a session leaves the scroll where it was', async ({ page }) => {
  // The same fault with nothing to be stale: a card that has never been placed has no `left`/`top`
  // at all, so `position: absolute` left it at the document's top-left — and focusing the URL field
  // there sent the whole page to the top, away from what the author was editing.
  //
  // No link anywhere in this document, which is what keeps the case honest: one earlier caret in a
  // link and this would be measuring the stale-coordinates case above instead.
  await openEditor(page);
  await loadMarkdown(page, TALL(''));
  await selectInside(page, 'heading');
  await page.locator('.ProseMirror h2').scrollIntoViewIfNeeded();
  await settle(page);
  const before = await rects(page);
  expect(before.scrollY).toBeGreaterThan(0); // otherwise there is no scroll position to lose
  await page.keyboard.press('Control+k');
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
  await settle(page);
  const after = await rects(page);
  expect(after.scrollY).toBe(before.scrollY);
  expect(after.cardBox!.bottom).toBeLessThanOrEqual(after.selectionBox.top);
});

test('Mod-k on the text right after a link places the card on the selection, not on that link', async ({
  page,
}) => {
  // `linkElementAt` asks `from - 1` first, which is what makes a caret at a link's right edge show
  // the card. A selection that *starts* at that edge is a different thing entirely — there is no
  // link on it yet — and the card was anchored to the neighbouring link all the same.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](https://example.com)後の段落。\n');
  await setRange(page, LINK_RIGHT_EDGE, LINK_RIGHT_EDGE + 4); // 「後の段落」
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  // Empty, i.e. this is an assignment and not the neighbouring link being edited. Were the mark
  // active over this range, anchoring to that link would be the right answer rather than the bug.
  await expect(field).toHaveValue('');
  await settle(page);
  const { cardBox, linkBox, selectionBox } = await rects(page);
  expect(cardBox!.left).toBeGreaterThanOrEqual(linkBox!.right - 2);
  expect(Math.abs(cardBox!.left - selectionBox.left)).toBeLessThan(2);
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
  await page.keyboard.press('Tab'); // 適用
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

// A press held for longer than one frame — which is every press a person makes, and none that
// `.click()` makes: Playwright dispatches mousedown and mouseup inside a single task, so the whole
// file above could stay green while the three icon buttons were unreachable by hand (reported
// 2026-08-16). Mousedown moves focus out of the editor and onto the button; the display card's blur
// rule then hid the card before mouseup, and a click whose target left the page never lands.
//
// The link is placed well down the document on purpose. A card near the first line could be
// unreachable for an unrelated reason — it is `z-20` under a `sticky z-30` toolbar — and asserting
// the card is still *visible* mid-press, rather than only that the click worked, is what tells the
// two apart.
const DEEP_MD = `あ\n\nい\n\nう\n\n${MD}`;
const DEEP_IN_LINK = 12;

async function pressSlowly(page: Page, name: string): Promise<void> {
  const button = card(page).getByRole('button', { name });
  await expect(button).toBeVisible();
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  // The mechanism, not just the outcome: the card must still be on screen under the finger.
  await expect(card(page)).toBeVisible();
  await page.mouse.up();
}

test('a slowly pressed 編集 still opens the URL field', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, DEEP_MD);
  await setRange(page, DEEP_IN_LINK);
  await pressSlowly(page, '編集');
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
});

test('a slowly pressed 解除 still removes the link', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, DEEP_MD);
  await setRange(page, DEEP_IN_LINK);
  await pressSlowly(page, '解除');
  await settle(page);
  expect(await markdown(page)).toBe('あ\n\nい\n\nう\n\n前リンク後');
});

test('コピー reaches the clipboard, and the card goes when the author leaves from it', async ({
  page,
  context,
}) => {
  // The third button, and the state the fix above creates: after a press, focus is parked on a card
  // button with the editor already blurred. Leaving from *there* fires no editor blur, so the rule
  // that hides the card has to be reachable from the card as well — otherwise the fix would trade
  // the reported bug for the one §5.5.9 was written to kill.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page);
  await loadMarkdown(page, DEEP_MD);
  await setRange(page, DEEP_IN_LINK);
  await pressSlowly(page, 'コピー');
  await expect(page.getByText('リンク先をコピーしました')).toBeVisible();
  // The raw href, not the line's stripped form (§5.5.10).
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com');
  await expect(card(page)).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
});

// The two cases in this file that are not a desktop browser, and they have to be: what they pin
// lives behind `isiOS() || isAndroid()` inside @tiptap/core's `focus` command, so a Desktop Chrome
// run takes the other branch and passes with the bug in place (measured — the desktop run of this
// same gesture never moves the scroll). The emulation reaches that branch because it is chosen from
// `navigator.userAgent`. What it does not reach is the soft keyboard: the press blurs the URL field
// on a real phone, and that keyboard leaving and coming back can move the scroll on its own. Not
// measured, and not measurable here (§5.5.21).
test.describe('on a phone', () => {
  // The device's emulation fields only. `defaultBrowserType` and `channel` are worker-scoped, and
  // spreading the whole descriptor into a describe is refused for that reason ("forces a new
  // worker") — the browser stays the project's own Chrome, which is what the run needs anyway.
  const phone = devices['Pixel 7'];
  test.use({
    viewport: phone.viewport,
    userAgent: phone.userAgent,
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: phone.isMobile,
    hasTouch: phone.hasTouch,
  });

  test('適用 leaves the scroll where it was', async ({ page }) => {
    // A document tall enough that the link is nowhere near either end, so a scroll to the editor's
    // top and a scroll to the selection are both visible as a change and are distinguishable.
    await openEditor(page);
    await loadMarkdown(
      page,
      `${'埋め草の段落。\n\n'.repeat(20)}前[リンク](https://example.com)後\n\n${'あとの段落。\n\n'.repeat(20)}`,
    );
    await page.locator('.ProseMirror a').scrollIntoViewIfNeeded();
    await page.locator('.ProseMirror a').click();
    await expect(card(page)).toBeVisible();
    await settle(page);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0); // otherwise there is no scroll position to lose

    await card(page).getByRole('button', { name: '編集' }).click();
    const field = card(page).getByRole('textbox', { name: 'リンク先' });
    await field.fill('https://example.org/changed');
    await card(page).getByRole('button', { name: '適用' }).click();
    await settle(page);
    // Settled past two frames, because the scrolls the fix removed did not land at once: the
    // editor element's own was synchronous and the selection's came a frame later.
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await markdown(page)).toContain('[リンク](https://example.org/changed)');
    // Focus goes back to the editor and the card stays — the point of pressing 適用 rather than
    // pressing Escape (§5.5.9).
    await expect(card(page)).toBeVisible();
  });

  test('an emptied field applied on a phone leaves the scroll where it was too', async ({
    page,
  }) => {
    // The other half of the same button. An empty field means "remove this link" (§5.5.16) and goes
    // out through `close()`, so it reaches the focus by a different route — and there the card is
    // meant to go away, which is one more thing the scroll assertion has to survive.
    await openEditor(page);
    await loadMarkdown(
      page,
      `${'埋め草の段落。\n\n'.repeat(20)}前[リンク](https://example.com)後\n\n${'あとの段落。\n\n'.repeat(20)}`,
    );
    await page.locator('.ProseMirror a').scrollIntoViewIfNeeded();
    await page.locator('.ProseMirror a').click();
    await expect(card(page)).toBeVisible();
    await settle(page);
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);

    await card(page).getByRole('button', { name: '編集' }).click();
    await card(page).getByRole('textbox', { name: 'リンク先' }).fill('');
    await card(page).getByRole('button', { name: '適用' }).click();
    await settle(page);
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await markdown(page)).toContain('前リンク後');
    await expect(card(page)).toBeHidden();
  });
});
