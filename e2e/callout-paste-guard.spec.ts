import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// The clipboard half of e2e/callout-drop-guard.spec.ts. Copying a selection that crosses a callout's
// edge puts the callout node on the clipboard — `data-pm-slice` round-trips the open depths, so the
// slice comes back the same shape a drag would carry — and pasting it built a box at the caret: a
// nested callout when the caret was inside one, a brand new one when it wasn't.
//
// The drop refuses that slice; the paste repairs it (unwrapHalfSelectedCallouts in
// components/editor/callout-extension.ts). The difference is the source: a move deletes the dragged
// range first and that deletion joins the callout to the block below it, so a drop has damage a
// clean slice can't undo, while a paste touches nothing but the caret.
//
// Every position here is a raw document offset rather than a click, because these tests assert whole
// documents. In doc(paragraph[0..8], callout[8..19](paragraph[9..18]), paragraph[19..27]):
//   7  = end of 「前の段落です」          13 = inside the callout, after 「囲みの」
//   17 = end of the callout's text        22 = in the last paragraph, after 「後の」
const MD = '前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n後の段落です\n';
const DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
  expect(await docString(page)).toBe(DOC);
}

// Copy [from, to], then put the caret at `at` — the clipboard keeps its contents across the caret
// move, so this is one real copy/paste round trip through the browser's own clipboard.
async function copyThenCaret(page: Page, from: number, to: number, at: number): Promise<void> {
  await setRange(page, from, to);
  await page.keyboard.press('Control+c');
  await setRange(page, at);
}

// The cross-edge copy: 「中身です」 from inside the callout plus 「後の」 from the paragraph after it.
// The slice is `<callout(paragraph("中身です")), paragraph("後の")>`, cut at the start and closed at
// the end — the shape that forces the box to be kept.
test('pasting a callout-crossing copy outside a callout does not build one', async ({ page }) => {
  await openEditor(page);
  await copyThenCaret(page, 13, 22, 7);
  await page.keyboard.press('Control+v');

  // Both halves arrive as plain blocks: the first merges into the paragraph the caret was in, the
  // second becomes the paragraph after it. Nothing anywhere gained a box.
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です中身です"), paragraph("後の"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
  );
});

test('pasting a callout-crossing copy inside a callout does not nest one', async ({ page }) => {
  await openEditor(page);
  // Caret at the end of the callout's own text, the case that used to nest.
  await copyThenCaret(page, 13, 22, 17);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です中身です"), paragraph("後の")), paragraph("後の段落です"))',
  );
});

// The control. A callout the selection covers end-to-end is closed in the slice, nothing is
// repaired, and pasting it still reproduces the box — copying a callout has to keep working.
test('pasting a copy of a whole callout still produces a callout', async ({ page }) => {
  await openEditor(page);
  // From the end of the leading paragraph to the start of the trailing one: the callout sits
  // between them, covered whole.
  await copyThenCaret(page, 7, 20, 26);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert')).toHaveCount(2);
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
});

// The other shape left alone: a selection made wholly inside a callout carries the callout cut on
// both sides, which has no closed edge to preserve and was already pasting as plain text.
test('pasting a copy from inside a callout stays text', async ({ page }) => {
  await openEditor(page);
  await copyThenCaret(page, 13, 17, 7);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です中身です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
  );
});

// The same whole-callout copy, aimed inside a callout instead. A closed callout in the slice is a
// real box and the test above keeps it one — but there is nowhere inside another callout for it to
// go, and Ctrl+V reached that nesting exactly as a drag did. The drop refuses it; here the box is
// dropped and its contents kept.
test('pasting a whole callout inside a callout keeps the text, not the box', async ({ page }) => {
  await openEditor(page);
  await copyThenCaret(page, 7, 20, 17);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です"), paragraph("囲みの中身です"), paragraph), paragraph("後の段落です"))',
  );
});

// The other container a callout may not be placed in. Unlike nesting, `> > [!NOTE]` stores and
// reloads perfectly well — this one is an editorial rule (a quote is someone else's words, a callout
// is the author's own aside), and it is the rule setCallout already enforces for the toolbar and the
// slash menu. Ctrl+V was the way around it.
const QUOTE_MD = '前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n> 引用の中身です\n';
const QUOTE_DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), blockquote(paragraph("引用の中身です")), paragraph)';

test('pasting a whole callout inside a blockquote keeps the text, not the box', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, QUOTE_MD);
  expect(await docString(page)).toBe(QUOTE_DOC);

  // 7 = end of 「前の段落です」, 21 = start of the quote's text, so the callout between them is
  // covered whole; 28 = end of 「引用の中身です」, inside the quote.
  await copyThenCaret(page, 7, 21, 28);
  await page.keyboard.press('Control+v');

  await expect(editor.locator('blockquote .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
});
