import { test, expect, devices, type Page } from '@playwright/test';
import { loadMarkdown, selectInside, setRange } from './editor-authoring';
import { markdown, docString, caret, caretPos } from './editor-probe';

// The accordion's two insertion routes and their placement rule (docs/accordion-requirements.md
// §6.3, §7). The official setDetails has no check and would insert into a table cell, splitting the
// table; details-extension.ts wraps it.

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

// §7.9, criterion 45: the ＋ drawer's アコーディオン row (`hover: none`). Pixel 7 keys only, as in
// editor-mobile-toolbar.spec.ts.
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

    // As the slash-menu route, and the sheet closes after the insert.
    await expect(panel).not.toBeVisible();
    expect(await docString(page)).toContain('details(detailsSummary, detailsContent(paragraph))');
    await page.keyboard.type('タイトル');
    expect(await caret(page)).toBe('タイトル@4');
  });
});

// 折りたたみ, the old label (§7.3), is still a search keyword.
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

  // The caret is in the title, as with the menu.
  await page.keyboard.type('タイトル');
  expect(await markdown(page)).toBe('<details>\n<summary>タイトル</summary>\n\n</details>');
});

// A new accordion is open (§7.4), so Enter in the title starts the body instead of leaving
// (§7.2). `persist: false` (§5): the document has no `open` attribute, so this is NodeView-only.
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

    // Open, so Enter reaches the body's existing empty line (§7.4). The exact body: the old
    // leftover was a second empty paragraph.
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

// Backspace out of an untitled accordion (§7.2, §7.5) leaves no paragraph for the empty title;
// whole-document match. The second paragraph is TrailingNode's, left by every block node.
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

// A written title comes back as a paragraph before the body (§7.2).
test('backspacing out of a titled accordion keeps the title as a paragraph', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await loadMarkdown(page, '<details>\n<summary>題名</summary>\n\n本文\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await page.keyboard.press('Home');
  // Poll the state caret: a clicked caret reaches state ~20ms late, and Backspace would delete a
  // title character instead.
  await expect.poll(() => caret(page)).toBe('題名@0');
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toContain('paragraph("題名"), paragraph("本文")');
  expect(await markdown(page)).toBe('題名\n\n本文');
});

// The narrowing applies only to a body of one empty line (§7.4). Elsewhere the official Enter
// stands, or content would be pushed down and a folded body would take the caret.
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

  // Loaded, so folded (§5): the override must not send the caret somewhere invisible.
  await loadMarkdown(page, '<details>\n<summary>題</summary>\n\n</details>\n');
  await page.locator(`.ProseMirror ${DETAILS} summary`).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('外');

  expect(await docString(page)).toContain(
    'details(detailsSummary("題"), detailsContent(paragraph)), paragraph("外")',
  );
});

// Enter over a range with its head in the title (docs/editor-pitfalls.md §6.4): the title binding
// declines a range and IsolatingBoundary clamps it. Positions: 前の段落です 1..7, 題名 10..12,
// 畳んだ本文 15..20.
const EDGE_MD =
  '前の段落です\n\n<details>\n<summary>題名</summary>\n\n畳んだ本文\n\n</details>\n\n後の段落です\n';

async function openEdgeDoc(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, EDGE_MD);
  const toggle = page.locator(`.ProseMirror ${DETAILS} > button`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
}

test('Enter over a range from the body back into the title replaces it', async ({ page }) => {
  await openEdgeDoc(page);
  await setRange(page, 17, 11);
  await expect.poll(() => caret(page)).toBe('題名@1');
  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), details(detailsSummary("題"), detailsContent(paragraph("だ本文"))), paragraph("後の段落です"))',
    );
});

test('Enter over a range from the paragraph above into the title replaces it', async ({ page }) => {
  await openEdgeDoc(page);
  await setRange(page, 3, 11);
  await expect.poll(() => caret(page)).toBe('前の段落です@2');
  await page.keyboard.press('Enter');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の"), paragraph, details(detailsSummary("名"), detailsContent(paragraph("畳んだ本文"))), paragraph("後の段落です"))',
    );
});

// A range inside the title is deleted, then the title's Enter opens a first body line.
test('Enter over a range inside the title deletes it, then opens the body', async ({ page }) => {
  await openEdgeDoc(page);
  await setRange(page, 10, 11);
  await expect.poll(() => caret(page)).toBe('題名@0');
  await page.keyboard.press('Enter');
  await page.keyboard.type('追加');

  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("前の段落です"), details(detailsSummary("名"), detailsContent(paragraph("追加"), paragraph("畳んだ本文"))), paragraph("後の段落です"))',
    );
});

// Tab from the title enters the body as it stands. Only from the title, only while open, never a
// document change. Dispatched, not pressed: Playwright's Tab escapes the contenteditable
// (e2e/README.md), so the declining cases assert nothing happened rather than where focus went.
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
  // Poll the state caret first (the ~20ms click lag).
  await expect.poll(() => caret(page)).toMatch(/^題@/);
  await dispatchTab(page);

  // The start of the body's own line, not a new one: the difference from Enter.
  expect(await caret(page)).toBe('本文@0');
  await page.keyboard.type('追加');
  expect(await docString(page)).toContain('detailsContent(paragraph("追加本文"))');
});

test('Tab in the title of a folded accordion does nothing', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  // Folded (§5): declining hands Tab to the browser's focus move (§7.2).
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

// Opening belongs to insertion: a loaded accordion stays closed (§5).
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
  // The tail first, then complete the trigger in front of it.
  await page.keyboard.type(':::details本文');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.type(' ');

  expect(await docString(page)).toContain('detailsContent(paragraph("本文"))');
});

// Backspace undoing `:::details ` leaves the caret where the author was typing (§7.6), in absolute
// positions since both lines can be non-empty. A paragraph must follow: at the document's end
// TrailingNode clears the input rule's inverse, true of every block shortcut here.

// An empty line above a paragraph, caret on it. Placed by command, the click only focusing and made
// before loading, so its late caret cannot overwrite anything (the click→key lag).
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
  // 0..13, so 12 ends the text, where the space was typed; 14 would be the next paragraph.
  await expect.poll(() => caretPos(page)).toBe(12);
});

test('undoing the shortcut puts the caret before the text it carried', async ({ page }) => {
  await lineAboveAParagraph(page);
  await page.keyboard.type(':::details本文');
  await expect.poll(() => caret(page)).toBe(':::details本文@12');
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft');
  // The arrows must reach state before the space, or the trigger completes at the old offset.
  await expect.poll(() => caret(page)).toBe(':::details本文@10');
  await page.keyboard.type(' ');
  await expect(page.locator(`.ProseMirror ${DETAILS}`)).toBeVisible();

  await page.keyboard.press('Backspace');
  expect(await docString(page)).toBe('doc(paragraph(":::details 本文"), paragraph("後続の段落"))');
  // Between the trigger and 本文.
  await expect.poll(() => caretPos(page)).toBe(12);
});

// Every container refuses both routes: the menu hides its row, the input rule leaves the text.
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
    // Click first: a command-set selection does not focus the DOM.
    await editor.click();
    // The start of the container's first line, which both routes require, or the test passes without
    // asking. Programmatic: a closed accordion's body is `hidden`, and Enter in a body can leave it.
    await selectInside(page, node);
    await page.keyboard.press('ArrowLeft');

    await page.keyboard.type('/');
    const menu = page.locator('[data-slash-menu]');
    if (await menu.isVisible()) {
      await expect(menu.getByRole('button', { name: 'アコーディオン' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.type(':::details ');

    // The shortcut stayed literal: only the loaded accordion exists.
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

// §7.8: Backspace at the start of the body depends on its first block; these pin the paragraph
// cases. `pageerror` is watched: an unchanged document is also what an uncaught throw leaves.

// Resolved to the first textblock in `detailsContent`: a raw position outside one lands elsewhere,
// which once measured the title's end instead.
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

// Open first: a folded body takes no caret, and a selection set there normalizes to the title's end.
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

    // Both: half of the tear shows only as a moved caret.
    expect(await docString(page)).toBe(doc);
    expect(await caretPos(page)).toBe(at);
    expect(errors).toEqual([]);
  });
}

// The one shape that acts, and the only body-to-title motion: with a sibling, joinBackward can
// delete; `block+` cannot lose its only child.
test('Backspace on an empty first body line with a sibling deletes it and returns to the title', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await caretAtBodyStart(page, '<details>\n<summary>題</summary>\n\n本文\n\n</details>\n');

  // An empty line ahead of 本文.
  await page.keyboard.press('Enter');
  const target = await bodyFirstLine(page);
  await setRange(page, target);
  await expect.poll(() => caretPos(page)).toBe(target);
  expect(await docString(page)).toContain('detailsContent(paragraph, paragraph("本文"))');

  await page.keyboard.press('Backspace');

  // Gone, and the caret continues the title from its end.
  expect(await docString(page)).toContain('detailsContent(paragraph("本文"))');
  expect(await caret(page)).toBe('題@1');
  await page.keyboard.type('名');
  expect(await docString(page)).toContain('detailsSummary("題名")');
  expect(errors).toEqual([]);
});
