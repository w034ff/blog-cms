import { test, expect, type Page } from '@playwright/test';
import {
  closeHistory,
  collapseToEnd,
  loadMarkdown,
  selectInside,
  setRange,
} from './editor-authoring';
import { docString, historyState, markdown, settle } from './editor-probe';

// The link card in the live editor (docs/link-card-requirements.md §9). Browser-only for the usual
// reason plus one of its own: the card's NodeView fetches its title over `/api/posts/search`, so
// what it shows exists only at runtime, in a page with a session.
//
// The seeded posts come from the real `data/blog.db` copy (e2e/prepare-db.mts): `second-post` is
// 「React Server Components を学ぶよ」and `hello-world` is 「ブログ開設のお知らせ」.

const CARD_HREF = '/posts/second-post';
const CARD_TITLE = 'React Server Components を学ぶよ';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;

// A card the author would have inserted, arrived at the way opening a saved post arrives at one.
async function openWithCard(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${CARD_MD}\n\n本文\n`);
}

function card(page: Page) {
  return page.locator('.ProseMirror .link-card-view');
}

test('the slash menu inserts a card, and the card searches for the post (1a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/リンクカード');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンクカード' }).click();

  // Inserted unresolved: the card is on the page with its own search box, rather than a popup
  // having appeared over the document (§5.2-3).
  await expect(card(page)).toBeVisible();
  const search = page.locator('.link-card-search');
  await expect(search).toBeFocused();

  await search.fill('React');
  await page.locator('.link-card-results').getByRole('button', { name: CARD_TITLE }).click();

  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  expect(await docString(page)).toContain('linkCard');
});

test('a card stores the reference and none of the display text (1b)', async ({ page }) => {
  await openWithCard(page);

  // The whole of §4.2 in one assertion: what is saved names the post and says nothing a reader
  // sees. A renamed post therefore needs no rewrite of any body that links to it.
  const saved = await markdown(page);
  expect(saved).toContain(CARD_MD);
  expect(saved).not.toContain(CARD_TITLE);
});

test('a card survives the markdown round trip (1a)', async ({ page }) => {
  await openWithCard(page);
  const first = await markdown(page);

  // Re-parse what was saved, the way reopening the post does. A node whose serializer or parser
  // is missing degrades here — into raw HTML text, or into nothing at all.
  await loadMarkdown(page, first);
  expect(await docString(page)).toContain('linkCard');
  expect(await markdown(page)).toBe(first);
});

test('the card shows the current title, fetched rather than stored (1c)', async ({ page }) => {
  await openWithCard(page);
  // Nothing in the document holds this string — it can only have come from the route.
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
});

test('the caret cannot enter a card, and the link bubble stays away (4a)', async ({ page }) => {
  await openWithCard(page);

  // Clicking a card selects the node rather than placing a caret inside it: it is an atom, so
  // there is no position within it to hold one.
  await card(page).click();
  await settle(page);
  expect(
    await page.evaluate(() => document.querySelectorAll('.ProseMirror-selectednode').length),
  ).toBeGreaterThan(0);

  // §7-1: with no caret inside, `isActive('link')` is never true here, so the bubble needs no rule
  // of its own to stay away. This is the assertion that pins that reasoning.
  await expect(page.getByRole('group', { name: 'リンク' })).toHaveCount(0);
});

test('a card can be turned back into a text link (4b)', async ({ page }) => {
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

  await card(page).getByRole('button', { name: 'リンクに戻す' }).click();

  // §7-3: the reference survives and the text reads like something an author would have written.
  expect(await docString(page)).not.toContain('linkCard');
  expect(await markdown(page)).toContain(`[${CARD_TITLE}](${CARD_HREF})`);
});

// §7.3, and the answer to what §10 used to list as unmeasured. A card is an atom, so
// prosemirror-commands deletes it whole from the edge of the neighbouring textblock in one press —
// its `joinBackward` has an explicit branch for it (dist: `// If the node before is an atom, delete
// it`, guarded by `before.isAtom && $cut.depth == $cursor.depth - 1`), and `joinForward` has the
// twin (`after.isAtom`). Nothing in this repo binds Backspace for the card, so that branch is what
// runs, and `selectNodeBackward` — the "select it first, delete on the second press" step — is never
// reached because joinBackward already returned true.
//
// The behavior is kept (same as `image`, the other atom block), so what has to hold is the way back:
// undo must return the card *with its reference*, since a card that came back pointing nowhere would
// be the §7.1 failure by another route. That is the half this spec exists for — the deletion itself
// is upstream's and would pass without any of this file's code.
for (const gesture of ['Backspace', 'Delete'] as const) {
  test(`${gesture} at a card's edge deletes it, and undo restores the reference (4e)`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    // The card sits on the side the gesture reaches: before the paragraph for Backspace, after it
    // for Delete. `本文` is the document's first paragraph either way.
    await loadMarkdown(
      page,
      gesture === 'Backspace' ? `${CARD_MD}\n\n本文\n` : `本文\n\n${CARD_MD}\n`,
    );
    await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

    if (gesture === 'Backspace') {
      await setRange(page, await firstPos(page, 'paragraph'));
    } else {
      await selectInside(page, 'paragraph');
      await collapseToEnd(page);
    }

    // `loadMarkdown` is one history event (setContent), and a deletion that groups with it is undone
    // together with the whole document — an undo that says nothing about what the deletion cost.
    // The break is stated outright and the events are counted, so the case no longer depends on any
    // duration: this used to be a 700ms pause waiting out `newGroupDelay` (default 500), which left
    // 200ms of margin and is the one mechanism that could explain the unexplained double failure of
    // 2026-08-16 (docs/link-requirements.md §5.5.10).
    await closeHistory(page);
    const before = (await historyState(page)).undoDepth;

    await page.keyboard.press(gesture);
    expect(await docString(page)).not.toContain('linkCard');
    // One event of its own — the assertion the pause used to buy, except that a slow test cannot
    // satisfy this one by accident.
    expect((await historyState(page)).undoDepth).toBe(before + 1);

    await page.keyboard.press('Control+z');
    expect(await docString(page)).toContain('linkCard');
    // The reference, not just the node: this is what makes the one-press deletion acceptable.
    expect(await markdown(page)).toContain(CARD_MD);
    // Exactly one event undone. A stray transaction joining the deletion's group would leave the
    // document looking right here while the press had in fact cost more than the deletion.
    expect((await historyState(page)).undoDepth).toBe(before);
  });
}

// §5.4, the gesture half. `available` reads the same predicate `setLinkCard` runs, so a context
// where the card cannot be placed drops the row — and where it is the only row left, `hasAnyItem`
// declines the trigger and `/` stays an ordinary character.
test('the slash row is absent in a table cell (3b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| A | B |\n| --- | --- |\n| x | y |\n');
  await setRange(page, await firstPos(page, 'tableCell'));

  await page.keyboard.type('/');
  // A cell refuses every row the menu has, so the trigger itself declines.
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
});

test('the slash row is absent in an accordion title (3b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await page.keyboard.type('/');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
});

// §5.4, the slice half, and the finding it records: no new guard was written for the card, because
// both existing guards are keyed on what the destination accepts rather than on a list of node
// types. These are the end-to-end half of link-card-placement.test.ts — they measure that a card
// really does land on the covered side of that line, through the real paste path.
test('a pasted card is refused in an accordion title, leaving it intact (6a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await pasteHtml(page, `<div class="link-card" data-href="${CARD_HREF}"></div>`);

  await expect(page.getByRole('status')).toBeVisible();
  // The accordion is whole — the 2026-08-08 failure was one accordion becoming two.
  expect(await docString(page)).toBe(
    'doc(details(detailsSummary("タイトル"), detailsContent(paragraph("本文"))), paragraph)',
  );
  expect(await docString(page)).not.toContain('linkCard');
});

test('a pasted card is refused in a table cell, leaving the table intact (6b)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| A | B |\n| --- | --- |\n| x | y |\n');
  // Not `firstPos(…, 'tableCell') `: a cell holds a paragraph, so the position just inside the cell
  // is *before* that paragraph, and prosemirror-state warns that the endpoint points at no inline
  // content. selectInside resolves the cell's textblock; collapseToEnd makes it a caret.
  await selectInside(page, 'tableCell');
  await collapseToEnd(page);

  await pasteHtml(page, `<div class="link-card" data-href="${CARD_HREF}"></div>`);

  // One table, not two: a block beside the paragraph splits a `paragraph+` cell's table around it.
  expect(await page.locator('.ProseMirror table').count()).toBe(1);
  expect(await docString(page)).not.toContain('linkCard');
});

// A card may sit in a quote or a list item — those are `block+` and nothing refuses it there. Pinned
// because §5.4 names only the two places that refuse, and "everywhere else works" is the other half
// of that claim.
test('a card is allowed inside a blockquote (3a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus before loading: setRange moves the *selection*, but keyboard.type goes to whatever the
  // browser has focused, and without this the keystrokes never reach the editor at all — which
  // makes an "the menu does not open" assertion pass for the wrong reason. Same order as
  // editor-details-title-guard.ts's openWithAccordion.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '> 引用\n');
  await setRange(page, await firstPos(page, 'blockquote'));

  await page.keyboard.type('/リンクカード');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンクカード' }).click();
  expect(await docString(page)).toContain('blockquote(paragraph("引用"), linkCard)');
});

// A second click meant for the result row must not reach the resolved card's buttons.
//
// This is a regression spec, and the defect it pins shipped: the buttons rendered within 3px of
// where the first result row had been, so a double-click on a result cleared the card (「変更」,
// at the row's left edge) or dissolved it into a text link (「リンクに戻す」, just right of it).
// Recovered from data/blog.db-wal, where a card the author had just made went
// `data-href="/posts/…"` → `data-href=""` → `[タイトル](/posts/…)` inside one autosave window, and
// then reproduced here. The 12 specs above all stayed green throughout: every one of them clicks
// once, and Playwright's default click lands on the row's horizontal *centre*, which is the one
// part of that band the buttons never covered.
//
// Swept across the row rather than taken at a single point, because the two buttons sat at
// different offsets and a spec aimed at one of them would have passed while the other was live.
// Offsets are from the row's left edge — where the title text is, i.e. where a person actually
// clicks, not where Playwright does.
//
// Two spaced clicks rather than `dblclick()`, and the gap is the whole point. Playwright's
// `dblclick` delivers both clicks inside one animation frame, which the deferral in `setHref`
// swallows on its own — so a spec written that way passed with the *geometry still broken*, and
// would have certified the layout fix while measuring the frame timing instead. Measured: with the
// buttons put back at the foot of the card, the `dblclick` form stayed green and this one goes red
// at x=24. A person's second click arrives long after that frame, so it has to meet the layout.
test('a second click on a result row a moment later leaves the card resolved (4b)', async ({
  page,
}) => {
  for (const x of [24, 60, 100, 140, 200]) {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('/リンクカード');
    await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンクカード' }).click();
    await expect(page.locator('.link-card-search')).toBeFocused();

    const row = page.locator('.link-card-results').getByRole('button', { name: CARD_TITLE });
    const box = await row.boundingBox();
    if (!box) throw new Error('the result row has no box');
    const point = { x: box.x + x, y: box.y + box.height / 2 };
    await page.mouse.click(point.x, point.y);
    // Long enough to be a second click rather than one gesture, and long enough for the fetched
    // title to be in the cache — which is what made the stored link read as the post's title.
    await page.waitForTimeout(250);
    await page.mouse.click(point.x, point.y);
    await settle(page);

    // Both halves matter: the node has to survive *and* keep its reference. Clearing it back to
    // `data-href=""` left a card in the document too, and that is what the first failure looked
    // like — a card that had silently forgotten which post it pointed at.
    expect(await docString(page), `second click at x=${x}`).toContain('linkCard');
    expect(await markdown(page), `second click at x=${x}`).toContain(CARD_MD);
  }
});

// The start of the *inline content* of the first node of `typeName` — the offset-0 caret every
// case above needs, because `startOfLine` is what decides whether `/` opens the menu at all.
//
// Resolved down to the first textblock rather than taken as `pos + 1`. That shortcut is right only
// where the node is itself a textblock (`detailsSummary`) and wrong for a `tableCell`, which holds
// a paragraph: `pos + 1` lands *before* that paragraph, prosemirror-state warns the endpoint points
// at no inline content, and the caret ends up somewhere this file never named. Collapsing a
// `selectInside` range to its end is wrong in the other direction — it puts the caret *after* the
// cell's text, where `startOfLine` is false and `/` never triggers, so the menu stays shut for a
// reason unrelated to the rule under test. Both were measured; the second is worse, because it
// made the table-cell case pass while the row was forced available.
function firstPos(page: Page, typeName: string): Promise<number> {
  return page.evaluate((name) => {
    type Probe = Element & {
      editor?: {
        state: {
          doc: {
            descendants(
              visit: (node: { type: { name: string }; isTextblock: boolean }, pos: number) => void,
            ): void;
          };
        };
      };
    };
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let start = -1;
    let target = -1;
    el.editor.state.doc.descendants((node, pos) => {
      if (start === -1 && node.type.name === name) {
        start = pos;
        // A node that is its own textblock answers immediately; anything else waits for the first
        // textblock found inside it.
        if (node.isTextblock) target = pos;
        return;
      }
      if (start !== -1 && target === -1 && pos > start && node.isTextblock) target = pos;
    });
    if (start === -1) throw new Error(`no ${name} in the document`);
    if (target === -1) throw new Error(`no textblock inside ${name}`);
    return target + 1;
  }, typeName);
}

// The clipboard path, synthesized the way the accordion and link-protocol specs do it: Playwright
// cannot put HTML on the real clipboard, and this is the event ProseMirror's own handler reads.
function pasteHtml(page: Page, html: string): Promise<void> {
  return page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/html', value);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, html);
}
