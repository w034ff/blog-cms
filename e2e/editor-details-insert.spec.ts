import { test, expect, devices, type Page } from '@playwright/test';
import { loadMarkdown, selectInside, setRange } from './editor-authoring';
import { markdown, docString, caret, caretPos } from './editor-probe';

// The accordion's two insertion routes and the one placement rule behind them
// (docs/accordion-requirements.md §6.3, §7). Browser-only: both routes run through the live
// editor, and the menu's own predicate reads editor state.
//
// The placement rule is worth its own coverage because the official setDetails has no such check
// — it inserts wherever `detailsContent` can hold the caret's block range, which includes a table
// cell's paragraph. Without the wrapper in details-extension.ts the menu offers the row there and
// running it splits the table.

const DETAILS = 'div[data-type="details"]';

test('the slash menu inserts an accordion with the caret in its title', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/アコーディオン');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'アコーディオン' }).click();

  expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
  await page.keyboard.type('タイトル');
  expect(await caret(page)).toBe('タイトル@4');
  expect(await markdown(page)).toBe('<details>\n<summary>タイトル</summary>\n\n</details>');
});

// §7.9, criterion 45: the ＋ drawer's own アコーディオン row (`hover: none` only). PIXEL_7's
// fields, the same subset editor-mobile-toolbar.spec.ts uses — `describe`-scoped keys only, since
// Playwright refuses a whole device descriptor at this level.
test.describe('on an emulated phone', () => {
  const PIXEL_7 = devices['Pixel 7'];
  test.use({
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: PIXEL_7.deviceScaleFactor,
    isMobile: PIXEL_7.isMobile,
    hasTouch: PIXEL_7.hasTouch,
  });

  test("the ＋ drawer's アコーディオン row inserts with the caret in its title, and closes the sheet", async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await page.getByRole('button', { name: 'ブロックを追加' }).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: 'アコーディオン', exact: true }).click();

    // Same shape as the slash-menu test above: title focused, structure right — plus the sheet
    // closing, the same "inserted, done" ending 引用/脚注/画像/囲み枠/表 all got (2026-09-20).
    await expect(panel).not.toBeVisible();
    expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
    await page.keyboard.type('タイトル');
    expect(await caret(page)).toBe('タイトル@4');
  });
});

// The row was labelled 折りたたみ until 2026-08-03 (§7.3). That word stays a search keyword, so an
// author who reaches for it still finds the row under its new name — the point of keeping it.
test('the old wording still finds the row in the slash menu', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/折りたたみ');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'アコーディオン' }).click();

  expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
});

test('the `:::details ` shortcut converts the line and keeps what follows it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type(':::details ');
  expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');

  // The caret is in the title, as with the menu route.
  await page.keyboard.type('タイトル');
  expect(await markdown(page)).toBe('<details>\n<summary>タイトル</summary>\n\n</details>');
});

// A newly inserted accordion is open (§7.4), which is what makes the caret-in-the-title landing
// useful: Enter from a *closed* title deliberately leaves the accordion (§7.2), so an author who
// inserted one and pressed Enter to start writing would have been thrown below it.
//
// The document must not learn about it. `persist: false` (§5) means the schema carries no `open`
// attribute at all, so this is a NodeView-only change — asserted here and not only in
// editor-details-view.spec.ts, because opening is now something an insertion does on its own.
for (const route of ['menu', 'shortcut'] as const) {
  test(`a newly inserted accordion is open (${route}) without touching the document`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    if (route === 'menu') {
      await page.keyboard.type('/アコーディオン');
      await page
        .locator('[data-slash-menu]')
        .getByRole('button', { name: 'アコーディオン' })
        .click();
    } else {
      await page.keyboard.type(':::details ');
    }

    const body = page.locator(`.ProseMirror ${DETAILS} [data-type="detailsContent"]`);
    await expect(body).toBeVisible();
    await expect(page.locator(`.ProseMirror ${DETAILS} > button`)).toHaveAttribute(
      'aria-label',
      'アコーディオンを閉じる',
    );
    expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
    expect(await markdown(page)).toBe('<details>\n<summary></summary>\n\n</details>');

    // Open, so Enter in the title reaches the body instead of escaping below the accordion — and
    // lands in the empty line already there rather than inserting one ahead of it (§7.4). The
    // exact body is asserted, not `toContain`: the leftover this replaced was a second, empty
    // paragraph, which only a whole-body match can rule out.
    await page.keyboard.type('タイトル');
    await page.keyboard.press('Enter');
    await page.keyboard.type('本文');
    expect(await docString(page)).toContain(
      'details(detailsSummary("タイトル"), detailsContent(paragraph("本文")))',
    );
    expect(await markdown(page)).toBe(
      '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>',
    );
  });
}

// Backspace out of an accordion nobody filled in (§7.2, §7.5). The rule is that the title's
// characters survive the dissolve — an empty title has none, so it must not leave a paragraph
// standing for nothing. Asserted as the whole document: the defect was an extra empty node, which
// only a whole-document match can see.
//
// `doc(paragraph, paragraph)` rather than a single one because the trailing paragraph belongs to
// TrailingNode, which added it while a non-textblock was last in the document and does not take it
// back. Every block node in this editor leaves it — the callout, measured the same way, leaves
// exactly this — so it is not the accordion's to fix.
test('backspacing out of an untitled accordion leaves no paragraph for the title', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.keyboard.type('/アコーディオン');
  await page.locator('[data-slash-menu]').getByRole('button', { name: 'アコーディオン' }).click();
  await expect(page.locator(`.ProseMirror ${DETAILS}`)).toBeVisible();

  await page.keyboard.press('Backspace');
  expect(await docString(page)).toBe('doc(paragraph, paragraph)');
  expect(await markdown(page)).toBe('');
});

// The other half of the same rule, and the reason the fix above is scoped to an empty title: a
// title that was written must still come back as a paragraph, ahead of the body (§7.2).
test('backspacing out of a titled accordion keeps the title as a paragraph', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題名</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await page.keyboard.press('Home');
  // Poll the *state* caret, not the DOM one: a click places the caret in the DOM ~20ms before
  // ProseMirror's state catches up, and Backspace fired inside that window reads the stale offset
  // and deletes a character of the title instead of dissolving.
  await expect.poll(() => caret(page)).toBe('題名@0');
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toContain('paragraph("題名"), paragraph("本文")');
  expect(await markdown(page)).toBe('題名\n\n本文');
});

// The two edges of that narrowing (§7.4). It only applies to a body that is one empty line — the
// shape insertion leaves — because there "insert a first line" and "enter the existing one" land
// the caret identically and differ only in the leftover. Everywhere else the official Enter stands,
// and both of these are cases where taking it away would lose real behaviour: content would be
// pushed into a line the author did not ask for, and a folded body would swallow the caret.
test('Enter in the title of an accordion with a body still opens a new first line', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} > button`).click();
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('追加');

  expect(await docString(page)).toContain('detailsContent(paragraph("追加"), paragraph("本文"))');
});

test('Enter in the title of a folded accordion still lands below it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // Loaded, so it is folded (§5) — and its body is one empty line, the exact shape the override
  // acts on when open. Folded, it must not: the caret would go somewhere invisible.
  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('外');

  expect(await docString(page)).toContain(
    'details(detailsSummary("題"), detailsContent(paragraph)), paragraph("外")',
  );
});

// Tab from the title, the motion Enter above cannot offer: it enters the body *as it stands*, where
// Enter inserts a first line in front of it. Three cases, one rule — only from the title, only while
// open, and never a document change.
//
// The key has to be dispatched rather than pressed. Playwright's synthetic Tab, sent through CDP,
// escapes the contenteditable to the browser's own focus cycling instead of reaching ProseMirror's
// keydown handler (the same harness quirk recorded in editor-table-whole-cell-selection.spec.ts;
// real keypresses in a browser do not do this). Dispatching the event on `.ProseMirror` reaches the
// handler exactly as a real one does — what it cannot reproduce is the native focus move a declined
// Tab falls through to, which is why the two declining cases below assert "nothing happened" rather
// than where focus went.
async function dispatchTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }),
      );
  });
}

test('Tab in the title enters the existing body without adding a line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} > button`).click();
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  // Poll the *state* caret before pressing anything: a click lands in the DOM ~20ms before
  // ProseMirror's state catches up, and a key fired inside that window reads the stale selection
  // (the same race the Backspace test above waits out).
  await expect.poll(() => caret(page)).toMatch(/^題@/);
  await dispatchTab(page);

  // At the start of the body's own first line — not a new one, which is the whole difference from
  // Enter (the test above lands `paragraph("追加"), paragraph("本文")` on the same document).
  expect(await caret(page)).toBe('本文@0');
  await page.keyboard.type('追加');
  expect(await docString(page)).toContain('detailsContent(paragraph("追加本文"))');
});

test('Tab in the title of a folded accordion does nothing', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // Loaded, so folded (§5). The caret must not go into a body no one can see (§7.2); declining
  // hands Tab back to the browser, whose focus move is the behaviour every other prose Tab has.
  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await expect.poll(() => caret(page)).toMatch(/^題@/);
  const before = await caretPos(page);
  await dispatchTab(page);

  expect(await caretPos(page)).toBe(before);
  expect(await docString(page)).toContain(
    'details(detailsSummary("題"), detailsContent(paragraph("本文")))',
  );
});

test('Tab in the body itself is not the title binding', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} > button`).click();
  await page.locator(`.ProseMirror ${DETAILS} [data-type="detailsContent"] p`).click();
  await expect.poll(() => caret(page)).toMatch(/^本文@/);
  const before = await caretPos(page);
  await dispatchTab(page);

  expect(await caretPos(page)).toBe(before);
  expect(await markdown(page)).toBe('<details>\n<summary>題</summary>\n\n本文\n\n</details>');
});

// The counterpart: opening belongs to the insertion gesture, not to the node. A document arriving
// from storage renders as a reader sees it — every accordion closed (§5).
test('an accordion loaded from markdown stays closed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');
  await expect(page.locator(`.ProseMirror ${DETAILS} [data-type="detailsContent"]`)).toBeHidden();
});

test('the shortcut carries text typed after the trigger into the body', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  // Type the tail first, then go back and complete the trigger in front of it.
  await page.keyboard.type(':::details本文');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' ');

  expect(await docString(page)).toContain('detailsContent(paragraph("本文"))');
});

// Backspace undoing the `:::details ` shortcut must leave the caret where the author was typing,
// not one block further on (§7.6). Measured in absolute positions: both the restored line and the
// one after it can be非empty, and the text-based caret probe cannot tell which block it is in.
//
// A paragraph has to follow the accordion for the undo to happen at all: at the document end
// TrailingNode's appended paragraph clears the input rule's inverse first, and Backspace dissolves
// instead. That is true of every block shortcut in this editor — `:::info `, `> `, `- ` and `## `
// all behave the same way there, measured — so it is not something these specs pin on the
// accordion.

// Builds an empty line above an existing paragraph and leaves the caret on it.
//
// The caret is placed by command and the click only takes focus — and the click happens *before*
// the content is loaded, so its own caret cannot arrive late and overwrite anything. This used to
// be `click(p)` + `Home`, which is the click→key lag in its purest form: the click's caret reaches
// `state.selection` ~20ms after the keypress, so Home moved a caret that was then replaced by the
// click's own at the end of the line, and the poll sat on `後続の段落@5` until it timed out.
// Diagnosed from the retained trace on 2026-08-10 after it failed both in a full run and, later, on
// its own. Fixed by construction, which is the standing remedy for this family.
async function lineAboveAParagraph(page: Page) {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '後続の段落\n');
  await setRange(page, 1);
  await expect.poll(() => caret(page)).toBe('後続の段落@0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => caret(page)).toBe('@0');
}

test('undoing the shortcut leaves the caret at the end of the restored text', async ({ page }) => {
  await lineAboveAParagraph(page);
  await page.keyboard.type(':::details ');
  await expect(page.locator(`.ProseMirror ${DETAILS}`)).toBeVisible();

  await page.keyboard.press('Backspace');
  expect(await docString(page)).toBe('doc(paragraph(":::details "), paragraph("後続の段落"))');
  // paragraph(":::details ") spans 0..13, so 12 is the end of its text — where the space was
  // typed. 14 would be the start of 後続の段落, which is where this used to land.
  await expect.poll(() => caretPos(page)).toBe(12);
});

test('undoing the shortcut puts the caret before the text it carried', async ({ page }) => {
  await lineAboveAParagraph(page);
  await page.keyboard.type(':::details本文');
  await expect.poll(() => caret(page)).toBe(':::details本文@12');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  // The arrows have to have landed in ProseMirror's *state* before the space is typed: the
  // selection sync lags a key by ~20ms, and a space typed inside that window completes the trigger
  // at the old offset, producing a different document (a full-suite-only failure, since the lag is
  // longer when the run is busy).
  await expect.poll(() => caret(page)).toBe(':::details本文@10');
  await page.keyboard.type(' ');
  await expect(page.locator(`.ProseMirror ${DETAILS}`)).toBeVisible();

  await page.keyboard.press('Backspace');
  expect(await docString(page)).toBe('doc(paragraph(":::details 本文"), paragraph("後続の段落"))');
  // The caret belongs between the trigger and 本文 — 2 characters back from the line's end (15).
  await expect.poll(() => caretPos(page)).toBe(12);
});

// Every container refuses both routes. The menu hides its row (the predicate asks the wrapped
// command); the input rule declines and leaves the text alone.
const CONTAINERS: Record<string, { source: string; node: string }> = {
  引用: { source: '> 引用文\n', node: 'blockquote' },
  callout: { source: '> [!NOTE]\n>\n> 本文\n', node: 'callout' },
  リスト項目: { source: '- 項目\n', node: 'listItem' },
  アコーディオン: {
    source: '<details>\n<summary>t</summary>\n\n本文\n\n</details>\n',
    node: 'detailsContent',
  },
};

for (const [where, { source, node }] of Object.entries(CONTAINERS)) {
  test(`neither route offers an accordion inside a ${where}`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await loadMarkdown(page, source);
    // Click first: the selection below is set through the editor's own commands, which does not
    // give the DOM node focus, and without focus the keystrokes go nowhere.
    await editor.click();
    // Put the caret at the *start* of the container's first line: both routes need a line start
    // (the input rule is anchored there, and the slash trigger is `startOfLine`), so anything else
    // would let the test pass without ever asking the question. ArrowLeft collapses the selection
    // to its beginning.
    //
    // Programmatic rather than by keyboard: a closed accordion's body is `hidden`, so arrow keys
    // cannot reach it at all. Opening a fresh line with Enter would work too, but Enter inside a
    // detailsContent can *leave* the accordion — the caret would end up exactly where an
    // accordion is allowed, and the test would be measuring the wrong position.
    await selectInside(page, node);
    await page.keyboard.press('ArrowLeft');

    await page.keyboard.type('/');
    const menu = page.locator('[data-slash-menu]');
    if (await menu.isVisible()) {
      await expect(menu.getByRole('button', { name: 'アコーディオン' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.type(':::details ');

    // The shortcut stayed literal, and no new accordion exists: the one the アコーディオン case
    // loaded is the only detailsSummary allowed in the document.
    const summaries = (await docString(page)).split('detailsSummary').length - 1;
    expect(summaries).toBe(node === 'detailsContent' ? 1 : 0);
    expect(await docString(page)).toContain(':::details');
  });
}

test('inside a table cell the row is hidden and the table survives', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| 1 | 2 |\n');
  await editor.locator('td').first().click();

  const before = await markdown(page);
  await page.keyboard.type('/');
  const menu = page.locator('[data-slash-menu]');
  if (await menu.isVisible()) {
    await expect(menu.getByRole('button', { name: 'アコーディオン' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }

  expect(await editor.locator(DETAILS).count()).toBe(0);
  expect(await markdown(page)).toContain('| a | b |');
  expect(before).toContain('| a | b |');
});

// §7.8 — Backspace at the START OF THE BODY. The document said nothing about this position until
// 2026-08-10, and what happens there turns out to depend on the body's first block. These two pin
// the paragraph cases, which are the ones the accordion itself decides; the list / quote / code /
// callout rows of §7.8's table are what those nodes do at the start of *any* container and belong
// to them, not here.
//
// `pageerror` is watched on both: the symptom being asserted is a document that did not change,
// and a byte-identical document is exactly what an uncaught throw also leaves behind (the lesson
// from the clearNodes RangeError). Without this the two are indistinguishable.

// The start of the body's first line. Resolved to the first *textblock* inside `detailsContent`:
// `detailsContent` + 1 is the position before that block, and a raw position that is not inside a
// textblock silently lands somewhere else — measuring the title's end while claiming to measure
// the body, which is how the first pass at §7.8 got the wrong answer.
async function bodyFirstLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: {
        state: {
          doc: {
            descendants(
              f: (
                n: { type: { name: string }; isTextblock: boolean; nodeSize: number },
                pos: number,
              ) => void,
            ): void;
          };
        };
      };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let start = -1;
    let end = -1;
    let target = -1;
    el.editor.state.doc.descendants((node, at) => {
      if (start === -1 && node.type.name === 'detailsContent') {
        start = at;
        end = at + node.nodeSize;
      }
      if (start !== -1 && target === -1 && at > start && at < end && node.isTextblock) {
        target = at + 1;
      }
    });
    if (target === -1) throw new Error('no textblock in detailsContent');
    return target;
  });
}

// Open the accordion and put the caret at the body's first line. A loaded accordion is folded
// (§5) and a folded body takes no caret at all — a selection set into the hidden `detailsContent`
// normalizes back to the end of the title.
async function caretAtBodyStart(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await loadMarkdown(page, md);
  const toggle = page.locator(`.ProseMirror ${DETAILS} > button`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
  const target = await bodyFirstLine(page);
  await setRange(page, target);
  await expect.poll(() => caretPos(page)).toBe(target);
}

for (const { label, md } of [
  {
    label: 'a line with text in it',
    md: '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n',
  },
  { label: 'the body’s only, empty line', md: '<details>\n<summary>題</summary>\n\n</details>\n' },
]) {
  test(`Backspace at the start of ${label} does nothing`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await caretAtBodyStart(page, md);

    const doc = await docString(page);
    const at = await caretPos(page);
    await page.keyboard.press('Backspace');

    // Both, not just the document: half of the tear this refuses would show only as a moved caret
    // (the text absorbed into the title leaves the body's own node in place).
    expect(await docString(page)).toBe(doc);
    expect(await caretPos(page)).toBe(at);
    expect(errors).toEqual([]);
  });
}

// The one shape that does act, and the only motion from body back to title anywhere in the editor
// (§7.2 declined to *bind* one, which is not the same as saying the motion is unreachable). It
// needs a sibling after it: joinBackward's branch here has to produce a legal delete step, and
// `block+` cannot give up its only child — which is exactly why the case above does nothing.
test('Backspace on an empty first body line with a sibling deletes it and returns to the title', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await caretAtBodyStart(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');

  // Enter at the body's start opens an empty line ahead of 本文 — the shape under test.
  await page.keyboard.press('Enter');
  const target = await bodyFirstLine(page);
  await setRange(page, target);
  await expect.poll(() => caretPos(page)).toBe(target);
  expect(await docString(page)).toContain('detailsContent(paragraph, paragraph("本文"))');

  await page.keyboard.press('Backspace');

  // The empty line is gone and the caret sits at the END of the title, so typing continues it.
  expect(await docString(page)).toContain('detailsContent(paragraph("本文"))');
  expect(await caret(page)).toBe('題@1');
  await page.keyboard.type('名');
  expect(await docString(page)).toContain('detailsSummary("題名")');
  expect(errors).toEqual([]);
});
