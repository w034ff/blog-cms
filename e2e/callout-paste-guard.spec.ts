import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';

// The clipboard half of callout-drop-guard.spec.ts: `data-pm-slice` keeps the open depths, so a copy
// across a callout's edge pasted a box at the caret, nested or new. Repaired by
// unwrapHalfSelectedCallouts (callout-slice-guard.ts), as the drop is. Raw positions, since whole
// documents are asserted. In doc(paragraph[0..8], callout[8..19](paragraph[9..18]), paragraph[19..27]):
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

// Copy [from, to], caret to `at`: one real round trip through the clipboard.
async function copyThenCaret(page: Page, from: number, to: number, at: number): Promise<void> {
  await setRange(page, from, to);
  await page.keyboard.press('Control+c');
  await setRange(page, at);
}

// `<callout(paragraph("中身です")), paragraph("後の")>`, cut at the start, closed at the end.
test('pasting a callout-crossing copy outside a callout does not build one', async ({ page }) => {
  await openEditor(page);
  await copyThenCaret(page, 13, 22, 7);
  await page.keyboard.press('Control+v');

  // Plain blocks, no box anywhere.
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です中身です"), paragraph("後の"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))',
  );
});

test('pasting a callout-crossing copy inside a callout does not nest one', async ({ page }) => {
  await openEditor(page);
  // At the end of the callout's text, which used to nest.
  await copyThenCaret(page, 13, 22, 17);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です中身です"), paragraph("後の")), paragraph("後の段落です"))',
  );
});

// Control: a whole callout is closed in the slice and still pastes as a box.
test('pasting a copy of a whole callout still produces a callout', async ({ page }) => {
  await openEditor(page);
  // The callout between two paragraphs, covered whole.
  await copyThenCaret(page, 7, 20, 26);
  await page.keyboard.press('Control+v');

  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.markdown-alert')).toHaveCount(2);
  await expect(editor.locator('.markdown-alert .markdown-alert')).toHaveCount(0);
});

// Wholly inside a callout: cut on both sides, already plain text.
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

// A whole callout aimed inside a callout has nowhere to go: the box is dropped, its contents kept.
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

// Nor in a quote: editorial, as setCallout enforces for toolbar and slash menu.
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

  // 7 to 21 covers the callout; 28 is inside the quote.
  await copyThenCaret(page, 7, 21, 28);
  await page.keyboard.press('Control+v');

  await expect(editor.locator('blockquote .markdown-alert')).toHaveCount(0);
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
});

// A callout below the slice's top: wouldNestCallout checks descendants, but a shallow flatten handed
// the slice back, so paste nested what drop refused. `> > [!NOTE]` is no longer authorable but
// still loads.
const NESTED_MD = '前の段落です\n\n> > [!NOTE]\n> >\n> > 囲みの中身です\n\n> 引用の中身です\n';

test('pasting a quote that holds a callout does not carry the box into a quote', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, NESTED_MD);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), blockquote(callout(paragraph("囲みの中身です"))), blockquote(paragraph("引用の中身です")), paragraph)',
  );

  // The first quote as a node, closed; caret at 30, inside the second quote.
  await selectNode(page, 'blockquote');
  await page.keyboard.press('Control+c');
  await setRange(page, 30);
  await page.keyboard.press('Control+v');

  // The quote comes over (nested quotes are native), the callout inside is flattened.
  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), blockquote(callout(paragraph("囲みの中身です"))), blockquote(paragraph("引用の中身です"), blockquote(paragraph("囲みの中身です"))), paragraph)',
  );
});

// The slice's first child is cut open: nodes on the first and last child paths keep their depth
// (openStart/openEnd), anything beside them can be flattened. The open quote stays, the closed
// callout goes.
const OPEN_EDGE_MD =
  '前の段落です\n\n> 引用の先頭\n>\n> > [!NOTE]\n> >\n> > 囲みの中身です\n\n後の段落です\n\n> 貼り付け先です\n';

test('a callout beside an open edge is flattened, the edge keeps its depth', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, OPEN_EDGE_MD);

  // 12 opens the quote two levels down; 32 is past it; 45 is inside the second quote.
  await copyThenCaret(page, 12, 32, 45);
  await page.keyboard.press('Control+v');

  await expect(editor.locator('.markdown-alert')).toHaveCount(1);
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落です"), blockquote(paragraph("引用の先頭"), callout(paragraph("囲みの中身です"))), paragraph("後の段落です"), blockquote(paragraph("貼り付け先ですの先頭"), paragraph("囲みの中身です")), paragraph("後の段"), paragraph)',
  );
});
