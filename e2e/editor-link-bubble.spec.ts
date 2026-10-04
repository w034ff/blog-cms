import { test, expect, devices, type Page } from '@playwright/test';
import { docString, markdown, settle } from './editor-probe';
import {
  caretAtStartOf,
  expectAutosaved,
  loadMarkdown,
  selectInside,
  setRange,
} from './editor-authoring';

// The link card (components/editor/LinkBubble.tsx, docs/link-requirements.md §5.5), the editor's
// only link UI. Positions are set programmatically: a click's caret reaches `state.selection` a
// debounce later (§5.5.4-6), and these tests are about the exact caret. The one click case polls.

const MD = '前[リンク](https://example.com "タイトル")後\n';
// 「前リンク後」— doc positions: 2 is the link's left edge, 3..4 inside it, 5 its right edge.
const IN_LINK = 3;
const LINK_RIGHT_EDGE = 5;
const OUTSIDE_LINK = 1;

function card(page: Page) {
  return page.getByRole('group', { name: 'リンク' });
}

// Every case watches for thrown errors (docs/editor-pitfalls.md): the menu hands callbacks an
// `Object.create(realEvent)`, so reading `.key` threw "Illegal invocation" on every keystroke, and a
// throw in a DOM handler looks like nothing happening. As in publish-flow.spec.ts.
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
  // No title, stubbed: example.com answers online, and a title takes the top line (§5.5.10);
  // editor-link-text-field.spec.ts records the same trap. Scoped to this case, since /posts/ links
  // are answered from the database through this route.
  await page.route('**/api/link-title**', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: null }) }),
  );
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  // Seeing where a link points, which `openOnClick: false` took away. Asserted on the line: the
  // card's hover tooltip holds the raw href, so the whole card would pass regardless.
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
  // Where a click most often lands; works because the mark is inclusive, which §4's
  // `autolink: true` makes it.
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
  // Losing the `title` while fixing a URL would silently edit a published post (§5.3-3).
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
  // §5.5.16: the edit mode has one button, which commits; leaving without applying is a gesture. A
  // second button (取り消し) had an ✕ indistinguishable from 解除.
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
  // The href display is the open button (§5.5.6); asked for by its accessible name, not the URL.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: 'リンク先を開く' }).click();
  expect(
    await page.evaluate(() => (window as Window & { __opened?: string[] }).__opened ?? []),
  ).toEqual(['https://example.com']);
});

test('Mod-k over a selection makes an internal link', async ({ page }) => {
  // §2.1.1: no other path produces one: linkifyjs finds neither a fragment nor a relative path, and
  // typed `[]()` is escaped on save (§2.2.1).
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
  // As on the paste paths (editor/link-protocols.ts); a refused setLink changes nothing, so the notice
  // keeps the button from looking broken.
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
  // The field keeps the caret: a refusal is to be corrected. A `.focus()` chained with the refused
  // command would still have moved it.
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('tel:+81312345678');
});

// Said at `Mod-k`, before the field opens, so a refused place costs no typing. `detailsSummary` and
// `codeBlock` declare `marks: ''`: setMark would report success and the schema drop the mark, so
// without the check the field would close on a link never made (§2.4/§2.5).
async function expectRefusedAtModK(page: Page, doc: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await expect(page.getByText('ここにはリンクを付けられません')).toBeVisible();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toHaveCount(0);
  await settle(page);
  expect(await docString(page)).toBe(doc);
}

test('Mod-k says so where the schema will not hold a link', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '<details><summary>たたみ見出し</summary>\n\n中身\n\n</details>\n');
  await selectInside(page, 'detailsSummary');
  await expectRefusedAtModK(
    page,
    'doc(details(detailsSummary("たたみ見出し"), detailsContent(paragraph("中身"))), paragraph)',
  );
});

test('the same inside a code block, where a caret alone is refused rather than asked to select', async ({
  page,
}) => {
  // Selecting would not help here, so the place is answered before the empty selection is.
  await openEditor(page);
  await loadMarkdown(page, '```js\nconst a = 1;\n```\n');
  await caretAtStartOf(page, 'codeBlock');
  await expectRefusedAtModK(page, 'doc(codeBlock("const a = 1;\\n"), paragraph)');
  await expect(page.getByText('リンクにするテキストを選択してください')).toHaveCount(0);
});

test('the same over an inline code span', async ({ page }) => {
  // Here the `code` mark excludes every other; canSetMark covers both cases.
  await openEditor(page);
  await loadMarkdown(page, '`const a` のこと\n');
  await setRange(page, 1, 8);
  await expectRefusedAtModK(page, 'doc(paragraph(code("const a"), " のこと"))');
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
  // §5.5.4-2: both menus want to show in a cell; the link card wins.
  await openEditor(page);
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| [ここ](https://example.com) | y |\n');
  await page.locator('.ProseMirror td a').click();
  await expect(card(page)).toBeVisible();
  // Two assertions for one fact, on purpose: the class is the mechanism, `toBeHidden` what an author
  // sees. The second once failed reliably here and then stopped with no component change; if it goes
  // red again, the pair says which half broke.
  await expect(page.locator('body')).toHaveClass(/link-menu-open/);
  await expect(page.locator('.table-toolbar')).toBeHidden();

  // The table controls return once the caret leaves the link; a one-way suppression would fail.
  await page.locator('.ProseMirror td', { hasText: 'y' }).click();
  await expect(card(page)).toBeHidden();
  await expect(page.locator('.table-toolbar')).toBeVisible();
});

// The tint (§5.5.7), link-highlight-extension.ts's decoration, present only while the card is up.
function highlight(page: Page) {
  return page.locator('.link-bubble-target');
}

test('the link the card is about is tinted, and only while the card is up', async ({ page }) => {
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(highlight(page)).toHaveText('リンク');
  // After Escape the caret is still in the link, so a document-derived tint would stay.
  await page.locator('.ProseMirror').press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
});

test('a blur that takes the card away takes the tint with it', async ({ page }) => {
  // Focus lost to nothing hides the card, but `shouldShow` is re-asked only on a selection or doc
  // change, so a tint derived from it stayed lit. It follows the plugin's onShow/onHide.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(highlight(page)).toHaveText('リンク');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
  // Coming back relights it.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('the tint is present with the caret at the link right edge', async ({ page }) => {
  // At the edge `getMarkRange` resolves to nothing (§5.5.2) while `isActive` is true; a single
  // `getMarkRange` would leave the card over untinted text.
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
  // One tint at a time: the previous one is taken down.
  await expect(highlight(page)).toHaveCount(1);
});

test('Mod-k tints the selection that is about to become a link', async ({ page }) => {
  // No link yet and focus in the URL field, so nothing else shows what the URL will attach to.
  await openEditor(page);
  await loadMarkdown(page, 'ここを見出しにつなぐ\n');
  await setRange(page, 1, 3);
  await page.keyboard.press('Control+k');
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeFocused();
  await expect(highlight(page)).toHaveText('ここ');
});

test('clicking elsewhere closes the URL field and applies nothing', async ({ page }) => {
  // §5.5.7: the open field followed the caret down the line while still editing the first link.
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
  // §5.5.15: the field folds into the display card synchronously, and the card was painted over the
  // link just left for a few frames. Sampled per frame in the page, the only place that state exists.
  // **Throttled, because at full speed this cannot fail**: `shouldShow` answers `true` about the old
  // link on every departure, and only a slow frame lets that reach a paint. 8x is reliable; the rate
  // is restored before the assertions.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toBeVisible();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
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
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  expect(seen).not.toContain('display');
  // The window must contain the departure, or a sampler that finished early sees only the field and
  // passes.
  expect(seen).toContain('field');
  expect(seen).toContain('gone');
  await settle(page);
  await expect(card(page)).toBeHidden();
});

test('a press inside the same link keeps the card', async ({ page }) => {
  // A press inside the link the card is about does not close the card.
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
  // The dismissal listener sees the portalled card's own clicks; reaching for its field is not leaving.
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

// The favicon (§5.5.8), offline: this blog's own `app/favicon.ico`, and a dead port for failure.
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
  // On failure nothing is drawn (an empty box reads as a broken image). Pinned on a dead port: the
  // failure path decides the card for sites declaring an icon only in HTML.
  await openEditor(page);
  await loadMarkdown(page, '[落ちる](http://127.0.0.1:1/x)へ。\n');
  await setRange(page, 2);
  await expect(card(page)).toBeVisible();
  await expect(favicon(page)).toBeHidden();
  await expect(card(page)).toContainText('http://127.0.0.1:1/x');
});

test('a scheme with no origin asks for no favicon at all', async ({ page }) => {
  // `mailto:` has no host: no <img> at all, not a hidden one that already fired a request. (`tel:` is
  // refused by §2.4.)
  await openEditor(page);
  await loadMarkdown(page, '[宛先](mailto:a@example.com)へ。\n');
  await setRange(page, 2);
  await expect(card(page)).toBeVisible();
  await expect(favicon(page)).toHaveCount(0);
});

test('the favicon follows the caret from one link to the next', async ({ page }) => {
  // `loaded` resets by remounting under a key, or a loaded icon would lend "shown" to the next link.
  await openEditor(page);
  await loadMarkdown(page, '[内側](/posts/hello)と[外側](http://127.0.0.1:1/x)。\n');
  await setRange(page, 2);
  await expect(favicon(page)).toBeVisible();
  await setRange(page, 6);
  await expect(card(page)).toContainText('127.0.0.1');
  await expect(favicon(page)).toBeHidden();
});

// The card sits above the link (§5.5.10), covering text already read.
async function rects(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    // Asked of the editor, since the card is placed against `state.selection`.
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
  // Above-placement's hazard, which `flip` misses: the `sticky top-0 z-30` toolbar covers the space
  // above the first line, and the `z-20` card rendered under it, invisible.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](https://example.com)後の一行目。\n\n二行目。\n');
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await settle(page);
  const { cardBox, toolbarBox } = await rects(page);
  expect(toolbarBox).not.toBeNull();
  expect(cardBox!.top).toBeGreaterThanOrEqual(toolbarBox!.bottom);
});

// Placement when `Mod-k` opens the card (§5.5.11): that path asks by meta and placed the card
// before it was on screen. None of these faults shows in the document. A tall document puts the
// first line off screen; the heading is selected by type.
const TALL = (lead: string) => `${lead}${'埋め草の段落。\n\n'.repeat(20)}## ここをリンクにする\n`;

test('Mod-k after the card has been at another link opens the field on the selection', async ({
  page,
}) => {
  // A hidden card keeps its coordinates, and `meta === 'show'` runs `updatePosition()` (which starts
  // `if (!this.isVisible) return`) before `show()`, so it came back at the last link.
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
  // Against the selection's rect: the card must be at the selection.
  expect(selectionBox.top - cardBox!.bottom).toBeLessThan(24);
});

test('the first Mod-k of a session leaves the scroll where it was', async ({ page }) => {
  // Never placed, the card sat at the document's top-left, and focusing its field scrolled to the top.
  // No link in this document, or this would measure the stale case above.
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
  // `linkElementAt` asks `from - 1` first, for a caret at a link's right edge; a selection starting
  // there has no link yet, but was anchored to the neighbour.
  await openEditor(page);
  await loadMarkdown(page, '前[リンク](https://example.com)後の段落。\n');
  await setRange(page, LINK_RIGHT_EDGE, LINK_RIGHT_EDGE + 4); // 「後の段落」
  await page.keyboard.press('Control+k');
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  // Empty: an assignment, not an edit of the neighbouring link.
  await expect(field).toHaveValue('');
  await settle(page);
  const { cardBox, linkBox, selectionBox } = await rects(page);
  expect(cardBox!.left).toBeGreaterThanOrEqual(linkBox!.right - 2);
  expect(Math.abs(cardBox!.left - selectionBox.left)).toBeLessThan(2);
});

// The title line (§5.5.10), measurable offline only for internal links, which are answered from
// the database; that is also what keeps the server from requesting its own URL.
test('a link to this blog shows the post title above the URL', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '前[記事](/posts/hello-world)後\n');
  await setRange(page, 3);
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('ブログ開設のお知らせ');
  // The URL stays (§5.5.1-1): a title says what a page is, not where it goes.
  await expect(card(page)).toContainText('/posts/hello-world');
});

test('the top line is what opens the link, and the URL line under it is only text', async ({
  page,
}) => {
  // Positional: with a title, the title is the control and the URL display text, so there is still
  // one thing to press, in link colour.
  await openEditor(page);
  await loadMarkdown(page, '前[記事](/posts/hello-world)後\n');
  await setRange(page, 3);
  await expect(card(page)).toContainText('ブログ開設のお知らせ');
  const open = card(page).getByRole('button', { name: 'リンク先を開く' });
  await expect(open).toHaveText('ブログ開設のお知らせ');
  // The URL line is not a control.
  await expect(card(page)).toContainText('/posts/hello-world');
  await expect(card(page).getByRole('button')).toHaveCount(4); // open + copy + edit + unlink
  // Each line's tooltip holds only its own text, untruncated. The editor's tooltips, not `title`,
  // which is why they are readable here.
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
  // Display only, as Chrome's address bar; the tooltip keeps the raw form. Both halves asserted, since
  // stripping the href itself would edit what the post stores.
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

test('a link with no obtainable title is the card as it was', async ({ page }) => {
  // A dead port, offline. No title is the resting state, not an error.
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
  // A difference, not "no requests": an empty list is also what a misattached listener produces. An
  // http link first proves the instrument works.
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
  // A click on the post's own controls dispatches no transaction, so the card stayed (§5.5.9).
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
  // Unlike Escape, cleared when focus returns.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('a link card button inside the editor takes the display card away too', async ({ page }) => {
  // The rule is about focus, not the editor's DOM: this button is inside it.
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
  // The exemption a "hide on blur" rule would break: a toolbar command blurs and refocuses (it chains
  // `.focus()`), and acts on the very selection the card describes.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: /太字/ }).click();
  await settle(page);
  await expect(card(page)).toBeVisible();
  await expect(highlight(page)).toHaveText('リンク');
});

test('leaving the card for the page around it closes the URL field', async ({ page }) => {
  // Leaving the field for the post's own fields removes the whole card (§5.5.9). The editor already
  // lost focus to the field, so no blur fires.
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
  // Back to the link: the card returns, in display mode.
  await page.locator('.ProseMirror').click();
  await setRange(page, IN_LINK);
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole('textbox', { name: 'リンク先' })).toHaveCount(0);
});

test('tabbing out of the card closes the URL field', async ({ page }) => {
  // Portalled to the end of <body>, so Tab past its last button goes nowhere; the field stayed open.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await expect(field).toBeFocused();
  await page.keyboard.press('Tab'); // 適用
  await page.keyboard.press('Tab'); // out
  await settle(page);
  await expect(field).toHaveCount(0);
  // Opening the field is a focusout (the 編集 button unmounts), so reading `relatedTarget` rather than
  // the settled focus would close it at once; tabbing out here proves it stayed.
  expect(await markdown(page)).toBe('前[リンク](https://example.com "タイトル")後');
});

test('the URL field survives an autosave', async ({ page }) => {
  // §5.3-2: a form reset once blanked a NodeView input. This one is portalled outside PostEditor's
  // <form>; measured across an autosave, which lands during exactly this pause.
  await openEditor(page);
  await setRange(page, IN_LINK);
  await card(page).getByRole('button', { name: '編集' }).click();
  const field = card(page).getByRole('textbox', { name: 'リンク先' });
  await field.fill('https://slowly-typed.example');
  await expectAutosaved(page);
  await expect(field).toHaveValue('https://slowly-typed.example');
});

// A press longer than one frame, as a person's is: `.click()` sends mousedown and mouseup in one task.
// Mousedown moved focus to the button, the blur rule hid the card, and mouseup missed. Placed down
// the document so the `z-20` card is not under the `sticky z-30` toolbar; asserting visibility
// mid-press tells the two apart.
const DEEP_MD = `あ\n\nい\n\nう\n\n${MD}`;
const DEEP_IN_LINK = 12;

async function pressSlowly(page: Page, name: string): Promise<void> {
  const button = card(page).getByRole('button', { name });
  await expect(button).toBeVisible();
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(150);
  // The card stays under the finger.
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
  // After a press, focus is on a card button with the editor blurred, so leaving from there must also
  // hide the card (§5.5.9).
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page);
  await loadMarkdown(page, DEEP_MD);
  await setRange(page, DEEP_IN_LINK);
  await pressSlowly(page, 'コピー');
  await expect(page.getByText('リンク先をコピーしました')).toBeVisible();
  // The raw href, not the stripped display (§5.5.10).
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com');
  await expect(card(page)).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await settle(page);
  await expect(card(page)).toBeHidden();
  await expect(highlight(page)).toHaveCount(0);
});

// Phone-only: the fix lives behind `isiOS() || isAndroid()` in @tiptap/core's `focus`, chosen by
// `navigator.userAgent`, so desktop passes with the bug. The soft keyboard's own scroll is not
// reachable here (§5.5.21).
test.describe('on a phone', () => {
  // Emulation fields only: spreading the descriptor forces a new worker.
  const phone = devices['Pixel 7'];
  test.use({
    viewport: phone.viewport,
    userAgent: phone.userAgent,
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: phone.isMobile,
    hasTouch: phone.hasTouch,
  });

  test('適用 leaves the scroll where it was', async ({ page }) => {
    // A tall document, so scrolling to the top and to the selection are distinguishable.
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
    // Past two frames: one removed scroll was synchronous, the other a frame later.
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await markdown(page)).toContain('[リンク](https://example.org/changed)');
    // Focus returns and the card stays, the point of 適用 over Escape (§5.5.9).
    await expect(card(page)).toBeVisible();
  });

  test('an emptied field applied on a phone leaves the scroll where it was too', async ({
    page,
  }) => {
    // An empty field removes the link (§5.5.16) through `close()`, where the card goes away.
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
