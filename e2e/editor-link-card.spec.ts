import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';
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

// The other half of criterion 4f. The published card omits the `<img>` entirely for a post with
// no image rather than leaving an empty frame, and the editor's card has to agree — a placeholder
// box here would be the editor showing a layout the reader never gets. `second-post` carries no
// thumbnail and no image in its body, so `resolveThumbnail` answers null for it; the case where
// there is one is measured in thumbnail.spec.ts, which can upload one first.
test('a card to a post with no image shows no image frame (4f)', async ({ page }) => {
  await openWithCard(page);
  // Wait for the lookup to land first: asserting on an empty card would pass before the answer
  // arrives, which is the same vacuous pass whichever way the code behaves.
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  await expect(card(page).locator('img')).toHaveCount(0);
});

// §13.1. The second line used to hold the reference itself, which said nothing a 20-hex slug can
// say — so it now appears only when something about the target needs saying. A published post the
// route matches is the state with nothing to report.
test('a card whose target is fine has no second line (4g)', async ({ page }) => {
  await openWithCard(page);
  // The title first: asserting the absence of a line before the lookup lands would pass whatever
  // the code does.
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  // Absent, not empty — an empty span still carries the line's top margin.
  await expect(card(page).locator('.link-card-meta')).toHaveCount(0);
});

test('a reference the route cannot match says so (4g)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<div class="link-card" data-href="/posts/nosuchpost"></div>\n\n本文\n');

  await expect(card(page).locator('.link-card-meta')).toHaveText('記事が見つかりません');
  // And the title degrades to the reference (§5.3): the author has to be able to see *which*
  // reference is the broken one.
  await expect(card(page).locator('.link-card-title')).toHaveText('/posts/nosuchpost');
});

// The note §10 listed as unmeasured until 2026-08-18. Every seeded post is published, so the draft
// is made here — an autosave is enough to create the row, and the slug it was given is reachable
// only through the same route the card itself asks.
test('a card to an unpublished post says so (4h)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const draftTitle = `未公開の参照先 ${Date.now()}`;
  await page.getByLabel('タイトル').fill(draftTitle);
  await expect(page.getByText(/保存済み/)).toBeVisible({ timeout: 20_000 });

  const slug = await page.evaluate(async (query: string) => {
    const res = await fetch(`/api/posts/search?q=${encodeURIComponent(query)}`);
    const rows = (await res.json()) as { slug: string; draft: boolean }[];
    const row = rows[0];
    return row?.draft ? row.slug : '';
  }, draftTitle);
  expect(slug).not.toBe('');

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);

  await expect(card(page).locator('.link-card-title')).toHaveText(draftTitle);
  // §5.2-4: on the published page this card falls back to a plain link, and this line is the only
  // place the author is told before it happens.
  await expect(card(page).locator('.link-card-meta')).toHaveText('未公開の記事');
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

// The external card in the editor (docs/link-card-requirements.md §14.9). `example.com` and
// `unreachable.example` have seeded `link_previews` rows (e2e/prepare-db.mts), so the route answers
// them from the table and nothing here reaches the network — which is also what the route does in
// production for any card drawn twice within a week (§14.3).
const EXTERNAL_HREF = 'https://example.com/article';
const EXTERNAL_TITLE = '外部ページの見出し';
const EXTERNAL_MD = `<div class="link-card" data-href="${EXTERNAL_HREF}"></div>`;

test('the picker takes a URL and makes an external card (14a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/リンクカード');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンクカード' }).click();

  // One field for both kinds: what was typed decides which (§14.6-1). A URL replaces the post
  // results with the single row that makes a reference out of it.
  const search = page.locator('.link-card-search');
  await search.fill(EXTERNAL_HREF);
  await page
    .locator('.link-card-results')
    .getByRole('button', { name: 'この URL をカードにする' })
    .click();

  await expect(card(page).locator('.link-card-title')).toHaveText(EXTERNAL_TITLE);
  // The provenance line, which an internal card does not have (§14.4).
  await expect(card(page).locator('.link-card-domain')).toHaveText('example.com');
  // The picture, and where it comes from: the editor draws the same signed same-origin path the
  // published page does, so what the author sees is what the reader gets and neither browser is
  // pointed at the target's CDN (§14.4).
  await expect(card(page).locator('img')).toHaveAttribute('src', /^\/api\/link-image\?url=/);
});

test('an external card stores the URL and none of the fetched text (14b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${EXTERNAL_MD}\n\n本文\n`);
  await expect(card(page).locator('.link-card-title')).toHaveText(EXTERNAL_TITLE);

  const saved = await markdown(page);
  expect(saved).toContain(EXTERNAL_MD);
  expect(saved).not.toContain(EXTERNAL_TITLE);

  // The round trip, the same way reopening the post arrives at it (§14.2 — the node, the class and
  // the attribute are the internal card's, so this is what says an absolute href survives them).
  await loadMarkdown(page, saved);
  expect(await docString(page)).toContain('linkCard');
  expect(await markdown(page)).toBe(saved);
});

test('an absolute href survives the round trip with its query and fragment (14a)', async ({
  page,
}) => {
  // §14.2 bet that §4.1's answer holds for absolute URLs without measuring it, and
  // `link-requirements.md` §2.2.2 is the reason to doubt the bet: a fragment-bearing markdown link
  // comes back percent-encoded. This is the raw-HTML attribute path instead — `escapeHref` writes
  // it and markdown-it parses it — so the `&` and the multibyte fragment are what to watch.
  const messy = 'https://example.com/a?b=1&c=2#見出し';
  const card = `<div class="link-card" data-href="${messy}"></div>`;
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${card}\n\n本文\n`);

  const saved = await markdown(page);
  // `&` is written as `&amp;` inside the attribute and read back as `&` — the stored string is the
  // reference, unchanged.
  expect(saved).toContain('data-href="https://example.com/a?b=1&amp;c=2#見出し"');
  await loadMarkdown(page, saved);
  expect(await markdown(page)).toBe(saved);
  expect(await docString(page)).toContain('linkCard');
});

test('a hand-written card to this blog’s own URL resolves as an internal card (14n)', async ({
  page,
}) => {
  // The third door (§14.5.1): `parseHTML` takes any `data-href`, so a body can carry this blog's
  // own published address even though neither entry point produces it. Without the rewrite in
  // `lookupCard` the card asks the preview route about this server, is refused there, and tells the
  // author their own post could not be read.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  const origin = await page.evaluate(() => window.location.origin);
  await loadMarkdown(
    page,
    `<div class="link-card" data-href="${origin}${CARD_HREF}"></div>\n\n本文\n`,
  );

  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  await expect(card(page).locator('.link-card-meta')).toHaveCount(0);
  // The stored reference is untouched — the rewrite decides which table answers, not what the body
  // says or where the card's link goes.
  expect(await markdown(page)).toContain(`data-href="${origin}${CARD_HREF}"`);
});

test('a URL that could not be read says so, and shows the URL (14k)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(
    page,
    '<div class="link-card" data-href="https://unreachable.example/x"></div>\n\n本文\n',
  );

  await expect(card(page).locator('.link-card-meta')).toHaveText('タイトルを取得できませんでした');
  // The title degrades to the reference (§5.3), which is the thing the author can act on. The host
  // line is not drawn — there is no resolved card to draw it from, and the URL already names it.
  await expect(card(page).locator('.link-card-title')).toHaveText('https://unreachable.example/x');
});

test('the bubble turns a line-alone link into a card (14.6-2)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `<${EXTERNAL_HREF}>\n\n本文\n`);

  // Caret into the link, which is what brings the bubble up (§5.5).
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: 'カードにする' }).click();

  await expect(card(page).locator('.link-card-title')).toHaveText(EXTERNAL_TITLE);
  // The paragraph is replaced, not emptied and followed: an empty paragraph left above the card
  // would be invisible in the markdown and real in the editor. Asserted as the whole document
  // rather than as a `toContain`, because what has to be absent is a line that serializes to
  // nothing — only the exact string can say it is not there.
  expect(await markdown(page)).toBe(`${EXTERNAL_MD}\n\n本文`);
});

test('the bubble offers no card for a link inside a sentence (14.6-2)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `詳しくは[この記事](${EXTERNAL_HREF})を参照。\n`);

  await page.locator('.ProseMirror a').first().click();
  // The bubble is up — otherwise the absence below would pass for the wrong reason.
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  // A card is a block (§5.2-1), so there is no card to make out of a link the sentence needs.
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
});

test('a bare URL alone on a line stays a plain link (14l)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  // Typed, autolinked, and left alone: §4.1 (a) priced the loss of this form too high to take, and
  // a paste-time conversion would have taken it (§14.6).
  await page.keyboard.type(`${EXTERNAL_HREF} `);
  await settle(page);
  expect(await docString(page)).not.toContain('linkCard');
  expect(await markdown(page)).not.toContain('link-card');
});

test('a row from an older version is not used, however fresh it is (14t)', async ({ page }) => {
  // §14.3.1. The failure this pins was measured on 2026-08-18: rows written in the hours before
  // the `image` column existed kept their week-long TTL, so the cards built from them had no
  // picture and no amount of reopening the post could shake them loose. Age was never the whole
  // question — what the row was written by is the other half.
  //
  // The seeded row (e2e/prepare-db.mts) is minutes old, `ok`, and carries a title. If age decided,
  // the card would show 「古い版の行」. It is at version 0, so it does not.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(
    page,
    '<div class="link-card" data-href="http://127.0.0.1/stale-row"></div>\n\n本文\n',
  );

  await expect(card(page).locator('.link-card-meta')).toHaveText('タイトルを取得できませんでした');
  await expect(card(page).locator('.link-card-title')).not.toHaveText('古い版の行');

  // And it was rewritten rather than merely ignored — the next render must not repeat the work.
  const db = new Database(TEST_DB_PATH, { readonly: true });
  const row = db
    .prepare('SELECT status, version FROM link_previews WHERE url = ?')
    .get('http://127.0.0.1/stale-row') as { status: string; version: number };
  db.close();
  expect(row).toEqual({ status: 'failed', version: 1 });
});

test('the bubble still offers the card after 適用 (14u)', async ({ page }) => {
  // Reported 2026-08-18: the button was there, the author edited the link, pressed 適用, and it was
  // gone from the row it came back to. `applyDraft` leaves the selection covering the link — as a
  // *range* — and the placement question being asked refused a range outright (§14.6-2). The
  // command replaces a textblock, so the question is whether the parent can hold a card in its
  // place, which a range answers as well as a caret does.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `[リンク](${EXTERNAL_HREF})\n\n本文\n`);

  await page.locator('.ProseMirror a').first().click();
  // The bubble is a floating card that arrives a frame or two later; counting before it is up
  // measures nothing, whichever way the code behaves.
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();

  await page.getByRole('button', { name: '編集' }).click();
  await page.getByRole('textbox', { name: 'リンク先' }).fill('https://example.com/other');
  await page.getByRole('button', { name: '適用' }).click();

  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the first paragraph of a list item is not offered as a card (14u)', async ({ page }) => {
  // `listItem` is `paragraph block*`, so replacing its first child with a card would leave the item
  // headless. The old question (may a block go *after* this textblock) said yes to exactly that.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `- [リンク](${EXTERNAL_HREF})\n`);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
});
