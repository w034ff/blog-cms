import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { BASE_URL, TEST_DB_PATH } from './constants';
import { postSlug } from './published-post';
import {
  closeHistory,
  closePostSettings,
  collapseToEnd,
  expectAutosaved,
  loadMarkdown,
  openPostSettings,
  selectInside,
  setRange,
} from './editor-authoring';
import { docString, historyState, markdown, settle } from './editor-probe';

// The link card in the live editor (docs/link-card-requirements.md §9). Browser-only: the NodeView
// fetches its title over `/api/posts/search`, so what it shows exists only in a page with a session.
// Seeded posts (e2e/prepare-db.mts): `second-post` is 「React Server Components を学ぶよ」,
// `hello-world` 「ブログ開設のお知らせ」.

const CARD_HREF = '/posts/second-post';
const CARD_TITLE = 'React Server Components を学ぶよ';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;

// A card the author would have inserted, arrived at the way opening a saved post arrives at one.
async function openWithCard(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${CARD_MD}\n\n本文\n`);
}

function card(page: Page) {
  return page.locator('.ProseMirror .link-card-view');
}

// The slash menu opens the shared insert dialog (docs/embed-requirements.md §24.2,
// docs/link-card-requirements.md §21); picking a post on 「記事から選ぶ」 lands a resolved card.
test('the slash menu opens the shared dialog, and its 記事から選ぶ tab makes a card (1a)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/リンク');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: '記事から選ぶ' }).click();
  await dialog.getByPlaceholder('記事のタイトルで検索…').fill('React');
  await dialog.getByRole('button', { name: CARD_TITLE }).click();

  // The card lands resolved, never an unresolved card with its picker on screen (§24.2).
  await expect(dialog).toHaveCount(0);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  expect(await docString(page)).toContain('linkCard');
});

test('a card stores the reference and none of the display text (1b)', async ({ page }) => {
  await openWithCard(page);

  // §4.2: what is saved names the post and says nothing a reader sees, so a renamed post needs no
  // rewrite of bodies that link to it.
  const saved = await markdown(page);
  expect(saved).toContain(CARD_MD);
  expect(saved).not.toContain(CARD_TITLE);
});

test('a card survives the markdown round trip (1a)', async ({ page }) => {
  await openWithCard(page);
  const first = await markdown(page);

  // Re-parse what was saved, as reopening does; a missing serializer or parser degrades here.
  await loadMarkdown(page, first);
  expect(await docString(page)).toContain('linkCard');
  expect(await markdown(page)).toBe(first);
});

test('the card shows the current title, fetched rather than stored (1c)', async ({ page }) => {
  await openWithCard(page);
  // Nothing in the document holds this string — it can only have come from the route.
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
});

// The other half of criterion 4f, §17's editor half: a card to an own post always carries a
// picture, the house mark when the post has none, and the editor must show what the reader gets
// (§13). `second-post` has no image; the own-picture case is in thumbnail.spec.ts.
test('a card to a post with no image shows this site’s mark (4f/17b)', async ({ page }) => {
  await openWithCard(page);
  // Wait for the lookup first, or the assertion passes whatever the code does.
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  const image = card(page).locator('img.link-card-image');
  await expect(image).toHaveAttribute('src', '/link-card-placeholder.svg');
  // The second class draws it as a mark on a tint, and is set on every draw (§17).
  await expect(image).toHaveClass(/link-card-placeholder/);
  await expect(image).toHaveAttribute('alt', '');
  // The dark file rides in the NodeView's `<picture>`, as on the published card (§13).
  await expect(card(page).locator('picture source')).toHaveAttribute(
    'srcset',
    '/link-card-placeholder-dark.svg',
  );
});

// §13.1: the second line appears only when something about the target needs saying.
test('a card whose target is fine has no second line (4g)', async ({ page }) => {
  await openWithCard(page);
  // The title first, or the absence below passes whatever the code does.
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
  // The title degrades to the reference (§5.3), so the author sees which one is broken.
  await expect(card(page).locator('.link-card-title')).toHaveText('/posts/nosuchpost');
});

// Every seeded post is published, so the draft is made here; autosave creates the row.
test('a card to an unpublished post says so (4h)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const draftTitle = `未公開の参照先 ${Date.now()}`;
  await page.getByLabel('タイトル').fill(draftTitle);
  await expectAutosaved(page);

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
  // §5.2-4: the published page falls back to a plain link, and this line is the only warning.
  await expect(card(page).locator('.link-card-meta')).toHaveText('未公開の記事');
});

test('the caret cannot enter a card, and the link bubble stays away (4a)', async ({ page }) => {
  await openWithCard(page);

  // An atom: a click selects the node, with no position inside for a caret.
  await card(page).click();
  await settle(page);
  expect(
    await page.evaluate(() => document.querySelectorAll('.ProseMirror-selectednode').length),
  ).toBeGreaterThan(0);

  // §7-1: with no caret inside, `isActive('link')` is never true, so the bubble needs no rule.
  await expect(page.getByRole('group', { name: 'リンク' })).toHaveCount(0);
});

test('a card can be turned back into a text link (4b)', async ({ page }) => {
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  await closeHistory(page);

  await card(page).getByRole('button', { name: 'リンクに戻す' }).click();

  // §7-3: the reference survives and the text reads like something an author would have written.
  expect(await docString(page)).not.toContain('linkCard');
  expect(await markdown(page)).toContain(`[${CARD_TITLE}](${CARD_HREF})`);
  // Focus is back in the editor, so one Ctrl-Z brings the card back (4s).
  await page.keyboard.press('Control+z');
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
});

// §7.4. Not that a tab opens (`window.open` is the browser's), but that pressing a control beside
// two node-rewriting buttons leaves the document untouched.
test('the card can be opened, and opening it leaves the card alone (4i)', async ({
  page,
  context,
}) => {
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    card(page).getByRole('button', { name: '開く' }).click(),
  ]);
  await popup.waitForURL(new RegExp(`${CARD_HREF}$`));

  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  expect(await docString(page)).toContain('linkCard');
  expect(await markdown(page)).toContain(`data-href="${CARD_HREF}"`);
});

// §7.4's other half: below 30rem the band shows icons only, and the hidden label is the
// accessible name every test here selects by. `display: none` would look the same and drop it, which
// a wide-viewport spec cannot see.
test('the band keeps its names when it shows icons (4j)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

  for (const name of ['開く', '変更', 'リンクに戻す']) {
    await expect(card(page).getByRole('button', { name })).toBeVisible();
  }
  const band = await card(page).evaluate((el) => {
    const buttons = [...el.querySelectorAll('.link-card-head button')];
    const label = el.querySelector('.link-card-action-label') as HTMLElement;
    const danger = el.querySelector('.link-card-action-danger') as HTMLElement;
    return {
      icons: buttons.filter((b) => getComputedStyle(b.querySelector('svg')!).display === 'block')
        .length,
      labelWidth: label.getBoundingClientRect().width,
      dangerColor: getComputedStyle(danger).color,
      plainColor: getComputedStyle(buttons[0]).color,
    };
  });
  expect(band.icons).toBe(3);
  // Hidden by size, not by `display` — which is what keeps it in the accessibility tree.
  expect(band.labelWidth).toBeLessThan(2);
  // The destructive control is the only one wearing a colour of its own.
  expect(band.dangerColor).not.toBe(band.plainColor);
});

// Above 30rem both the icon and the label show.
test('the wide band shows icons alongside its labels', async ({ page }) => {
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

  for (const name of ['開く', '変更', 'リンクに戻す']) {
    await expect(card(page).getByRole('button', { name })).toBeVisible();
  }
  const band = await card(page).evaluate((el) => {
    const buttons = [...el.querySelectorAll('.link-card-head button')];
    const label = el.querySelector('.link-card-action-label') as HTMLElement;
    return {
      icons: buttons.filter((b) => getComputedStyle(b.querySelector('svg')!).display === 'block')
        .length,
      labelWidth: label.getBoundingClientRect().width,
    };
  });
  expect(band.icons).toBe(3);
  expect(band.labelWidth).toBeGreaterThan(2);
});

// The 40rem fallback (app/globals.css, `:has(.link-card-image)`): at 550px a card with a picture is
// short of room for three labels, so the band must go icon-only rather than ellipsize, and its
// height must still match the picker's (§7.1).
test('a card with a picture falls back to icons before its labels squeeze (4n)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 550, height: 800 });
  await openWithCard(page);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  await expect(card(page).locator('.link-card-image')).toBeVisible();

  for (const name of ['開く', '変更', 'リンクに戻す']) {
    await expect(card(page).getByRole('button', { name })).toBeVisible();
  }
  const band = await card(page).evaluate((el) => {
    const buttons = [...el.querySelectorAll('.link-card-head button')];
    const label = el.querySelector('.link-card-action-label') as HTMLElement;
    return {
      icons: buttons.filter((b) => getComputedStyle(b.querySelector('svg')!).display === 'block')
        .length,
      labelWidth: label.getBoundingClientRect().width,
      headHeight: el.querySelector('.link-card-head')!.getBoundingClientRect().height,
    };
  });
  expect(band.icons).toBe(3);
  // Hidden by size, not by `display` — same reasoning as 4j, at this narrower width.
  expect(band.labelWidth).toBeLessThan(2);

  await openWithCard(page);
  await openPickerViaChange(page);
  const picker = card(page);
  await expect(picker.locator('.link-card-search')).toBeVisible();
  const pickerHeadHeight = await picker
    .locator('.link-card-head')
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(pickerHeadHeight).toBeCloseTo(band.headHeight, 0);
});

// §7.3. A card is an atom, so prosemirror-commands' `joinBackward` deletes it whole in one press
// (`before.isAtom && $cut.depth == $cursor.depth - 1`; `joinForward` has `after.isAtom`), as for
// `image`. What this spec owns is the way back: undo must return the card with its reference.
for (const gesture of ['Backspace', 'Delete'] as const) {
  test(`${gesture} at a card's edge deletes it, and undo restores the reference (4e)`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    // The card sits on the side the gesture reaches; `本文` is the first paragraph either way.
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

    // Break the history so the deletion is not undone with the whole document, and count events rather
    // than wait out `newGroupDelay` (e2e/README.md).
    await closeHistory(page);
    const before = (await historyState(page)).undoDepth;

    await page.keyboard.press(gesture);
    expect(await docString(page)).not.toContain('linkCard');
    // One event of its own, which a slow test cannot satisfy by accident.
    expect((await historyState(page)).undoDepth).toBe(before + 1);

    await page.keyboard.press('Control+z');
    expect(await docString(page)).toContain('linkCard');
    // The reference, not just the node: what makes the one-press deletion acceptable.
    expect(await markdown(page)).toContain(CARD_MD);
    // Exactly one event undone; a stray transaction in the group would cost more than the deletion.
    expect((await historyState(page)).undoDepth).toBe(before);
  });
}

// §5.4, the gesture half. `available` reads `setLinkCard`'s predicate, so where the card cannot go
// the row drops, and with no row left `hasAnyItem` declines and `/` stays a character.
test('the slash row is absent in a table cell (3b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
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
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await page.keyboard.type('/');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
});

// §5.4, the slice half: both existing guards key on what the destination accepts, so no new guard
// was written. The end-to-end half of link-card-placement.test.ts, through the real paste path.
test('a pasted card is refused in an accordion title, leaving it intact (6a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await pasteHtml(page, `<div class="link-card" data-href="${CARD_HREF}"></div>`);

  await expect(page.getByRole('status')).toBeVisible();
  // The accordion is whole, not split in two.
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
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| A | B |\n| --- | --- |\n| x | y |\n');
  // A cell's first position is before its paragraph; selectInside finds the textblock.
  await selectInside(page, 'tableCell');
  await collapseToEnd(page);

  await pasteHtml(page, `<div class="link-card" data-href="${CARD_HREF}"></div>`);

  // One table, not two: a block beside the paragraph splits a `paragraph+` cell's table around it.
  expect(await page.locator('.ProseMirror table').count()).toBe(1);
  expect(await docString(page)).not.toContain('linkCard');
});

// Quotes and list items are `block+`, so nothing refuses a card there: §5.4's other half.
test('a card is allowed inside a blockquote (3a)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  // Focus first: loadMarkdown does not focus the editor (e2e/README.md), and unfocused keystrokes
  // would make "the menu does not open" pass vacuously.
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '> 引用\n');
  await setRange(page, await firstPos(page, 'blockquote'));

  await page.keyboard.type('/リンク');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'リンク' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: '記事から選ぶ' }).click();
  await dialog.getByRole('button', { name: CARD_TITLE }).click();
  expect(await docString(page)).toContain('blockquote(paragraph("引用"), linkCard)');
});

// A second click meant for a result row must not reach the resolved card's buttons. Regression: the
// buttons rendered where the first row had been, so a double-click cleared or dissolved the card;
// single-click specs stayed green, since Playwright clicks a row's centre.
//
// Swept across the row from its left edge, where a person clicks, since the buttons sat at
// different offsets. Two spaced clicks, not `dblclick()`: that lands both in one frame, which
// `setHref`'s deferral swallows, and passed with the geometry still broken.
test('a second click on a result row a moment later leaves the card resolved (4b)', async ({
  page,
}) => {
  for (const x of [24, 60, 100, 140, 200]) {
    await openWithCard(page);
    await openPickerViaChange(page);

    const row = page.locator('.link-card-results').getByRole('button', { name: CARD_TITLE });
    // Scroll first: `boundingBox()` answers for a clipped row too, and the list is a `max-height`,
    // `overflow-y: auto` box (app/globals.css) that other specs' drafts overflow.
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    if (!box) throw new Error('the result row has no box');
    const point = { x: box.x + x, y: box.y + box.height / 2 };
    await page.mouse.click(point.x, point.y);
    // A second click rather than one gesture, with the fetched title already cached.
    await page.waitForTimeout(250);
    await page.mouse.click(point.x, point.y);
    await settle(page);

    // The node must survive and keep its reference: the first failure left a card with `data-href=""`.
    expect(await docString(page), `second click at x=${x}`).toContain('linkCard');
    expect(await markdown(page), `second click at x=${x}`).toContain(CARD_MD);
  }
});

// The inline-content start of the first `typeName`: `startOfLine` decides whether `/` opens the
// menu. Not `pos + 1` (before a cell's paragraph) nor a collapsed `selectInside` (after the text,
// where `/` never triggers, which let the table case pass with the row forced available).
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
        // A textblock answers at once; otherwise the first textblock inside.
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

// Synthesized paste: Playwright cannot put HTML on the clipboard, and this is the event
// ProseMirror reads.
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

// The external card (docs/link-card-requirements.md §14.9). Seeded `link_previews` rows
// (e2e/prepare-db.mts) answer, so nothing reaches the network (§14.3).
const EXTERNAL_HREF = 'https://example.com/article';
const EXTERNAL_TITLE = '外部ページの見出し';
const EXTERNAL_MD = `<div class="link-card" data-href="${EXTERNAL_HREF}"></div>`;

// The failure note names the two buttons that forget the 30-minute row (§14.3.2).
const RETRY_NOTE = 'タイトルを取得できませんでした（リンクに戻してカードにし直すと再取得します）';

test('the picker takes a URL and makes an external card (14a)', async ({ page }) => {
  await openWithCard(page);
  const search = await openPickerViaChange(page);

  // One field for both kinds (§14.6-1): a URL yields the single row that makes a reference.
  await search.fill(EXTERNAL_HREF);
  await page
    .locator('.link-card-results')
    .getByRole('button', { name: 'この URL をカードにする' })
    .click();

  await expect(card(page).locator('.link-card-title')).toHaveText(EXTERNAL_TITLE);
  // The provenance line, which an internal card does not have (§14.4).
  await expect(card(page).locator('.link-card-domain')).toHaveText('example.com');
  // The signed same-origin path the published page draws too, never the target's CDN (§14.4).
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

  // The round trip (§14.2): an absolute href survives the internal card's node and attribute.
  await loadMarkdown(page, saved);
  expect(await docString(page)).toContain('linkCard');
  expect(await markdown(page)).toBe(saved);
});

test('an absolute href survives the round trip with its query and fragment (14a)', async ({
  page,
}) => {
  // §14.2 assumed §4.1 holds for absolute URLs; link-requirements.md §2.2.2 is the reason to doubt
  // it. This is the raw-HTML attribute path (`escapeAttribute` writes, markdown-it parses): watch
  // the `&` and the multibyte fragment.
  const messy = 'https://example.com/a?b=1&c=2#見出し';
  const card = `<div class="link-card" data-href="${messy}"></div>`;
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${card}\n\n本文\n`);

  const saved = await markdown(page);
  // `&amp;` in the attribute, `&` read back: the stored reference is unchanged.
  expect(saved).toContain('data-href="https://example.com/a?b=1&amp;c=2#見出し"');
  await loadMarkdown(page, saved);
  expect(await markdown(page)).toBe(saved);
  expect(await docString(page)).toContain('linkCard');
});

test('a hand-written card to this blog’s own URL resolves as an internal card (14n)', async ({
  page,
}) => {
  // The third door (§14.5.1): `parseHTML` takes any `data-href`, so a body can carry this blog's own
  // address. Without `lookupCard`'s rewrite the preview route refuses it and the card reports the
  // author's own post as unreadable.
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
  // The stored reference is untouched: the rewrite picks the table, not the body or the link.
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

  await expect(card(page).locator('.link-card-meta')).toHaveText(RETRY_NOTE);
  // The title degrades to the reference (§5.3); no host line without a resolved card.
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
  // The paragraph is replaced, not emptied: an empty paragraph serializes to nothing, so only the
  // exact string proves it is absent.
  expect(await markdown(page)).toBe(`${EXTERNAL_MD}\n\n本文`);
});

test('the bubble offers no card for a link inside a sentence (14.6-2)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `詳しくは[この記事](${EXTERNAL_HREF})を参照。\n`);

  await page.locator('.ProseMirror a').first().click();
  // The bubble is up, or the absence below passes vacuously.
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  // A card is a block (§5.2-1), so there is no card to make out of a link the sentence needs.
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
});

test('a bare URL alone on a line stays a plain link (14l)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();

  // Typed, autolinked, left alone: §4.1 (a) and §14.6.
  await page.keyboard.type(`${EXTERNAL_HREF} `);
  await settle(page);
  expect(await docString(page)).not.toContain('linkCard');
  expect(await markdown(page)).not.toContain('link-card');
});

test('a row from an older version is not used, however fresh it is (14t)', async ({ page }) => {
  // §14.3.1: which version wrote a row matters, not only its age. The seeded row (prepare-db.mts)
  // is fresh, `ok` and titled 「古い版の行」, but at version 0, so the card must not show it.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(
    page,
    '<div class="link-card" data-href="http://127.0.0.1/stale-row"></div>\n\n本文\n',
  );

  await expect(card(page).locator('.link-card-meta')).toHaveText(RETRY_NOTE);
  await expect(card(page).locator('.link-card-title')).not.toHaveText('古い版の行');

  // Rewritten, not just ignored, so the next render does not repeat the work.
  const db = new Database(TEST_DB_PATH, { readonly: true });
  const row = db
    .prepare('SELECT status, version FROM link_previews WHERE url = ?')
    .get('http://127.0.0.1/stale-row') as { status: string; version: number };
  db.close();
  expect(row).toEqual({ status: 'failed', version: 1 });
});

test('the bubble still offers the card after 適用 (14u)', async ({ page }) => {
  // After 適用 the selection covers the link as a range, and the placement check refused ranges
  // (§14.6-2). The command replaces a textblock, so the question is whether the parent can hold a
  // card there, which a range answers as well as a caret.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `[リンク](${EXTERNAL_HREF})\n\n本文\n`);

  await page.locator('.ProseMirror a').first().click();
  // The bubble arrives a frame or two later; counting before it is up measures nothing.
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();

  await page.getByRole('button', { name: '編集' }).click();
  await page.getByRole('textbox', { name: 'リンク先' }).fill('https://example.com/other');
  await page.getByRole('button', { name: '適用' }).click();

  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('the first paragraph of a list item is not offered as a card (14u)', async ({ page }) => {
  // `listItem` is `paragraph block*`: replacing its first child with a card would leave it headless.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `- [リンク](${EXTERNAL_HREF})\n`);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);
});

// §18: a post cannot be made into a card of itself. Each door is measured here; the predicate
// alone is unit-tested (lib/link-card-href.test.ts). A post of its own: create mode is what the
// wiring is for (the slug arrives with the first autosave, through the editor's storage), and a
// seeded post would keep this spec's working copy for every later spec.
async function openOwnPost(page: Page, title: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('本文');
  // Autosave creates the row and the slug; the URL swap says the editor adopted it.
  await expectAutosaved(page);
  await page.waitForURL(/\/admin\/posts\/\d+\/edit/);
  return postSlug(page);
}

// 「変更」 is the only door back to the picker (§24.2, §21); it flips the same `editing` flag a
// never-resolved card starts with, so the picker under test is unchanged.
async function openPickerViaChange(page: Page) {
  await card(page).getByRole('button', { name: '変更' }).click();
  const search = page.locator('.link-card-search');
  await expect(search).toBeFocused();
  return search;
}

async function openPicker(page: Page) {
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `${CARD_MD}\n\n本文\n`);
  return openPickerViaChange(page);
}

test('the picker drops the post being edited, and says why when nothing is left (18a)', async ({
  page,
}) => {
  const title = `自参照テスト ${Date.now()}`;
  const slug = await openOwnPost(page, title);
  const search = await openPicker(page);
  const results = page.locator('.link-card-results');

  // The others are listed, so the absence below is not a picker listing nothing. Counted, not
  // named: `LIMIT = 20` newest-first (app/api/posts/search/route.ts) depends on other specs.
  await expect(results.locator('.link-card-result')).not.toHaveCount(0);
  await expect(results.getByText(title)).toHaveCount(0);

  // This post is the only match, the one case where dropping the row says something untrue.
  await search.fill(title);
  await expect(results.getByText('この記事自身は参照できません')).toBeVisible();
  await expect(results.getByText('一致する記事がありません')).toHaveCount(0);

  // A query that matches nothing still says so — the two messages answer different questions.
  await search.fill('該当しない題名の断片');
  await expect(results.getByText('一致する記事がありません')).toBeVisible();

  // A query that matches another post is unaffected.
  await search.fill('React');
  await expect(results.getByRole('button', { name: CARD_TITLE })).toBeVisible();

  // The paste door (§14.5.1): this post's own public URL.
  await search.fill(`${BASE_URL}/posts/${slug}`);
  await expect(results.getByText('この記事自身は参照できません')).toBeVisible();
  await expect(results.getByRole('button', { name: 'この URL をカードにする' })).toHaveCount(0);

  // Another post's URL still becomes a card: the refusal is about this post, not own-origin URLs.
  await search.fill(`${BASE_URL}${CARD_HREF}`);
  await expect(results.getByRole('button', { name: 'この URL をカードにする' })).toBeVisible();
});

test('a link to the post being edited is not offered 「カードにする」 (18b)', async ({ page }) => {
  const slug = await openOwnPost(page, `自参照リンク ${Date.now()}`);
  // Edit mode: the slug is known before the editor exists. 18a covers create mode.
  await page.reload();
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, `[この記事](/posts/${slug})\n\n[別の記事](${CARD_HREF})\n`);
  // setContent leaves the caret in the second link, whose bubble covers the link to click.
  await setRange(page, 1);
  await expect(page.locator('.link-bubble')).toHaveCount(0);

  await page.locator('.ProseMirror a').first().click();
  await expect(page.getByRole('button', { name: 'コピー' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'カードにする' })).toHaveCount(0);

  // The link is untouched: §18 is about cards, not linking to yourself in text.
  expect(await markdown(page)).toContain(`[この記事](/posts/${slug})`);

  // The other post's link, with the same guard against the bubble.
  await setRange(page, 1);
  await expect(page.locator('.link-bubble')).toHaveCount(0);
  await page.locator('.ProseMirror a').nth(1).click();
  await expect(page.getByRole('button', { name: 'カードにする' })).toBeVisible();
});

test('a card that already points at this post says so (18c)', async ({ page }) => {
  const slug = await openOwnPost(page, `自参照カード ${Date.now()}`);
  await page.locator('.ProseMirror').click();
  // A body already carrying the reference (older, or pasted as raw HTML) resolves to a refusal.
  await loadMarkdown(page, `<div class="link-card" data-href="/posts/${slug}"></div>\n\n本文\n`);

  await expect(card(page).locator('.link-card-meta')).toHaveText('この記事自身は参照できません');
  await expect(card(page).locator('.link-card-title')).toHaveText(`/posts/${slug}`);
  // Still a card with its reference: the author decides (「変更」 or 「リンクに戻す」).
  expect(await markdown(page)).toContain(`data-href="/posts/${slug}"`);
});

test('カードにする asks the page again; an ordinary render does not (14.3.2)', async ({ page }) => {
  // §14.3.2: after fixing the other side, the author presses again. **Both halves**: the explicit
  // conversion re-asks, and the render after it does not, or the automatic path would hit the
  // network the row exists to keep it off.
  const HREF = 'https://unreachable.example/force-refresh';
  const MD = `<div class="link-card" data-href="${HREF}"></div>\n\n本文\n`;
  // The client's requests: which one carries the flag is under test.
  const asked: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.pathname === '/api/link-preview') asked.push(url.search);
  });
  const fetchedAt = (): number | null => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const row = db.prepare('SELECT fetched_at AS at FROM link_previews WHERE url = ?').get(HREF) as
      | { at: number }
      | undefined;
    db.close();
    return row?.at ?? null;
  };

  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, MD);

  // ① The NodeView's own lookup never forces.
  await expect(card(page).locator('.link-card-meta')).toHaveText(RETRY_NOTE);
  expect(asked.every((search) => !search.includes('force=1'))).toBe(true);
  await expect.poll(fetchedAt).not.toBeNull();
  const first = fetchedAt();

  // ② 「リンクに戻す」 gives back a link titled with the reference; 「カードにする」 over it.
  await card(page).getByRole('button', { name: 'リンクに戻す' }).click();
  await page.locator('.ProseMirror a').first().click();
  await page.getByRole('button', { name: 'カードにする' }).click();

  await expect(card(page).locator('.link-card-meta')).toHaveText(RETRY_NOTE);
  expect(asked.filter((search) => search.includes('force=1'))).toHaveLength(1);
  // The row was rewritten: the server skipped a row it would have answered from.
  await expect.poll(fetchedAt).toBeGreaterThan(first!);
  const second = fetchedAt();

  // ③ The flag is spent by that one lookup even though the page failed again; a fresh NodeView is
  // back behind the TTL. Reloading the same markdown is not a fresh mount: ProseMirror keeps the
  // NodeView for an unchanged node.
  const before = asked.length;
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, MD);
  await expect(card(page).locator('.link-card-meta')).toHaveText(RETRY_NOTE);
  await expect.poll(() => asked.length).toBeGreaterThan(before);
  expect(asked.slice(before).every((search) => !search.includes('force=1'))).toBe(true);
  expect(fetchedAt()).toBe(second);
});

// The insert search's rows (§5.2-5 / §20): the assertions are on a row's parts.
async function openPickerOnNewPost(page: Page): Promise<void> {
  await openWithCard(page);
  await openPickerViaChange(page);
}

type RowShape = {
  label: string | null;
  height: number;
  hasImage: boolean;
  loaded: boolean;
  placeholder: boolean;
  category: string | null;
  badge: string | null;
};

function rowShapes(page: Page): Promise<RowShape[]> {
  return page.locator('.link-card-result').evaluateAll((els) =>
    els.map((el) => {
      const img = el.querySelector('img');
      return {
        label: el.getAttribute('aria-label'),
        height: Math.round(el.getBoundingClientRect().height),
        hasImage: img !== null,
        // `naturalWidth`, not `src`: a 404 keeps the attribute (§17).
        loaded: img !== null && img.naturalWidth > 0,
        placeholder: img?.classList.contains('link-card-result-placeholder') ?? false,
        category: el.querySelector('.link-card-result-category')?.textContent ?? null,
        badge: el.querySelector('.link-card-result-badge')?.textContent ?? null,
      };
    }),
  );
}

// `resolveThumbnail` falls back to the body's first image, so no upload is needed; this file is
// already in data/uploads (the one e2e/image-layout.spec.ts measures).
const BODY_IMAGE = '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';

// Drafts are listed (§5.2-4), so autosave is enough.
async function draftPost(page: Page, title: string, body: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, body);
  await expectAutosaved(page);
}

test('every insert-search row carries a picture, and they are all one height (20a, 20d)', async ({
  page,
}) => {
  // Two posts of this test's own, found by a shared stamp: seeded posts fall off the 20-row
  // default list once enough specs publish, and the search filters before the cap.
  const stamp = `行そろえ ${Date.now()}`;
  await draftPost(page, `${stamp} 絵あり`, `![](${BODY_IMAGE})\n\n本文\n`);
  await draftPost(page, `${stamp} 絵なし`, '本文\n');

  await openPickerOnNewPost(page);
  await page.locator('.link-card-search').fill(stamp);
  await expect(page.locator('.link-card-result')).toHaveCount(2);
  const rows = await rowShapes(page);
  expect(rows.length).toBeGreaterThan(1);

  for (const row of rows) {
    expect(row.hasImage, row.label ?? '').toBe(true);
    expect(row.loaded, row.label ?? '').toBe(true);
  }
  // Both kinds on screen, or the loop says nothing about the house-mark fallback (§17).
  expect(rows.some((row) => row.placeholder)).toBe(true);
  expect(rows.some((row) => !row.placeholder)).toBe(true);

  // One height for every row, which the `<picture>` margin broke (§20); uneven rows would also
  // misplace 4b's sweep.
  expect([...new Set(rows.map((row) => row.height))]).toHaveLength(1);
});

test('a draft row wears a badge and names its category by label, and its name is unchanged (20b, 20c)', async ({
  page,
}) => {
  // Filed under ブログ, not the default, so a row printing the default whatever the post holds fails.
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  const draftTitle = `ブログの下書き ${Date.now()}`;
  await page.getByLabel('タイトル').fill(draftTitle);
  await openPostSettings(page);
  await page.getByRole('radio', { name: 'ブログ' }).check();
  await closePostSettings(page);
  await expectAutosaved(page);

  await openPickerOnNewPost(page);
  await page.locator('.link-card-search').fill(draftTitle);
  await expect(page.locator('.link-card-result')).toHaveCount(1);
  const [draftRow] = await rowShapes(page);
  expect(draftRow.badge).toBe('未公開');
  expect(draftRow.category).toBe('ブログ');
  // The name is the title plus the draft note only: `getByRole('button', { name })` is a full match,
  // and other tests here select rows that way.
  expect(draftRow.label).toBe(`${draftTitle}（未公開）`);
  await expect(
    page.locator('.link-card-results').getByRole('button', { name: `${draftTitle}（未公開）` }),
  ).toBeVisible();

  // The seeded post draws the other category.
  await page.locator('.link-card-search').fill(CARD_TITLE);
  // **One row is not necessarily the new one**: both queries return one, the search is async, and a
  // count already right is reached with nothing changed. The draft leaving is the separating event.
  await expect(
    page.locator('.link-card-results').getByRole('button', { name: `${draftTitle}（未公開）` }),
  ).toHaveCount(0);
  await expect(page.locator('.link-card-result')).toHaveCount(1);
  const [publishedRow] = await rowShapes(page);
  expect(publishedRow.badge).toBeNull();
  expect(publishedRow.category).toBe('技術記事');
});

// §20 の 20f: the gutter the card keeps for its picture must not be kept by the picker. Both states
// in one test: "no gutter" alone would pass with the rule deleted.
test('the picker fills the card’s width, and the resolved card still reserves its picture (20f)', async ({
  page,
}) => {
  await openPickerOnNewPost(page);
  const gutter = () =>
    page
      .locator('.link-card-view .link-card-body')
      .evaluate((el) => getComputedStyle(el).paddingRight);
  const rowWidth = () =>
    page
      .locator('.link-card-result')
      .first()
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const bodyWidth = () =>
    page
      .locator('.link-card-view .link-card-body')
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));

  expect(await gutter()).toBe('0px');
  // The rows reach the text column's far edge (`:has(img)` once matched a row's thumbnail).
  expect(await rowWidth()).toBe(await bodyWidth());

  // Searched: the default list is capped at 20 newest-first.
  await page.locator('.link-card-search').fill(CARD_TITLE);
  await page.locator('.link-card-results').getByRole('button', { name: CARD_TITLE }).click();
  await expect(page.locator('.link-card-view .link-card-title')).toHaveText(CARD_TITLE);
  // A resolved card keeps the room, or its title runs under its picture.
  expect(await gutter()).not.toBe('0px');
  await expect(page.locator('.link-card-view .link-card-image')).toBeVisible();
});

// §7.4.1: opening the picker from a resolved card dispatches nothing, so none of the three exits
// has anything to undo.
for (const exit of ['cancel button', 'Escape', 'outside click'] as const) {
  test(`「変更」 costs no undo step, and ${exit} restores the card intact (4m)`, async ({
    page,
  }) => {
    await openWithCard(page);
    await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);

    await closeHistory(page);
    const before = (await historyState(page)).undoDepth;

    await card(page).getByRole('button', { name: '変更' }).click();
    await expect(page.locator('.link-card-search')).toBeFocused();
    // The href is intact while the picker is up; `markdown()` reads the live doc.
    expect(await markdown(page)).toContain(CARD_MD);
    expect((await historyState(page)).undoDepth).toBe(before);

    if (exit === 'cancel button') {
      await card(page).getByRole('button', { name: 'キャンセル' }).click();
    } else if (exit === 'Escape') {
      await page.keyboard.press('Escape');
    } else {
      // Outside both card and picker: what an author abandoning the picker would press.
      await page.getByLabel('タイトル').click();
    }

    await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
    await expect(page.locator('.link-card-search')).toHaveCount(0);
    expect(await markdown(page)).toContain(CARD_MD);
    // Nothing was dispatched, so the depth is unchanged since before 「変更」.
    expect((await historyState(page)).undoDepth).toBe(before);

    // §7.4.1's second half: `cancelEditAndFocus` puts a NodeSelection on the card, rather than
    // `dom.focus()` revealing a stale selection and scrolling there.
    const selectedNode = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as
        | (Element & {
            editor?: { state: { selection: { node?: { type: { name: string }; attrs: object } } } };
          })
        | null;
      const node = el?.editor?.state.selection.node;
      return node ? { type: node.type.name, attrs: node.attrs } : null;
    });
    if (exit === 'outside click') {
      // The outside press already said where the author wants to be.
      await expect(page.getByLabel('タイトル')).toBeFocused();
      expect(selectedNode).toBeNull();
    } else {
      expect(selectedNode).toEqual({ type: 'linkCard', attrs: { href: CARD_HREF } });
    }
  });
}

// Picking the post the card already names left the picker up: an unchanged `setNodeAttribute`
// is `eq()` to the old node, so `update` may never run. `setHref` calls `render` itself.
test('「変更」, then picking the post the card already names, still redraws it (4o)', async ({
  page,
}) => {
  await openWithCard(page);
  await card(page).getByRole('button', { name: '変更' }).click();
  await expect(page.locator('.link-card-search')).toBeFocused();

  // Searched, as in 20f.
  await page.locator('.link-card-search').fill(CARD_TITLE);
  await page.locator('.link-card-results').getByRole('button', { name: CARD_TITLE }).click();

  await expect(page.locator('.link-card-search')).toHaveCount(0);
  await expect(card(page).locator('.link-card-title')).toHaveText(CARD_TITLE);
  expect(await markdown(page)).toContain(CARD_MD);
});

// §7.4.1: a never-resolved card has nothing to cancel back to, so its picker has no キャンセル.
// Reached by a hand-written empty `data-href`: a fresh insert now lands resolved (§24.2, §7.5).
test('a freshly-inserted card’s picker has no キャンセル (4m)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '<div class="link-card" data-href=""></div>\n\n本文\n');
  await expect(page.locator('.link-card-search')).toBeVisible();

  await expect(card(page).getByRole('button', { name: 'キャンセル' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByLabel('タイトル').click();
  // Still unresolved: Escape and an outside click are no-ops here.
  await expect(page.locator('.link-card-search')).toBeVisible();
});
