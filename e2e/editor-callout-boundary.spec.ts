import { test, expect, type Page } from '@playwright/test';
import { caret, caretAtLineStart, docString } from './editor-probe';
import { caretAtStartOf } from './editor-authoring';

// A native `Home` reaches ProseMirror through `selectionchange` on a 20ms debounce; a Backspace
// inside that window bypasses every keymap, and re-parsing the browser's own edit nests the next
// block inside the callout (docs/editor-pitfalls.md §1.1). The wait is `caretAtLineStart`
// (editor-probe.ts), which asks the editor, not the DOM.

// A flat wait past the 20ms sync, for native ArrowUp/End moves whose settled offset is not known in
// advance. Needed before an arrow too: an arrow inside the window after an Enter is swallowed
// (ProseMirror re-asserts its selection), invisibly to `caretAtLineStart`. Polling docString is not
// enough: the document settles before the selection does.
async function caretSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 70)));
}

// The callout is `isolating` (callout-extension.ts), so Backspace at the start of the next block
// cannot join it into the body.
test('a block right after a callout is not pulled in by Backspace at its start', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  // Escaping the isolating callout downward lands on a gap cursor; typing there makes the next block.
  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとに続く段落');

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await expect(callout).toBeVisible();
  // Precondition: the text is outside the callout.
  await expect(callout).not.toContainText('あとに続く段落');

  // Caret to the very start of that following paragraph, then Backspace.
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');

  // The boundary holds: one callout, body unchanged, paragraph not absorbed.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout).not.toContainText('あとに続く段落');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');

  // The caret lands at the body's end, so typing appends there.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
  await expect(editor).toContainText('あとに続く段落');
  await expect(callout).not.toContainText('あとに続く段落');
});

// An empty line after the callout can corrupt nothing, so stepIntoPreviousIsolating deletes it, as
// a blockquote join would. A non-empty paragraph below keeps TrailingNode from refilling it.
test('Backspace on an empty line after a callout deletes that line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  // The gap cursor makes one paragraph after the callout, not yet the shape needed.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('次の段落');
  // splitBlock at its start: isolating node, empty line, non-empty paragraph, without gap-cursor
  // Enter semantics.
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Enter');
  await caretSettled(page); // let the Enter's selection sync flush, or the arrow is swallowed
  await page.keyboard.press('ArrowLeft'); // into the empty line above
  // The same race, but `caretAtLineStart` is already true at '次の段落@0'; the empty line is the one
  // block whose whole caret reads '@0'.
  await expect.poll(() => caret(page)).toBe('@0');

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  // Excludes the callout's title chip, also a <p>.
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');
  await expect(bodyParagraphs).toHaveCount(3);

  await page.keyboard.press('Backspace');

  // The empty line is gone.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(bodyParagraphs).toHaveCount(2);
  await expect(editor).toContainText('次の段落');
  await expect(callout).not.toContainText('次の段落');

  // The caret is at the body's end.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
});

// Delete at the callout's end must not pull in the next paragraph. `isolating` already refuses
// joinForward (`findCutAfter`), but stepIntoNextIsolating must leave it alone too.
test('a block right after a callout is not pulled in by Delete at the callout end', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとに続く段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('ArrowUp'); // back onto the callout body's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await page.keyboard.press('Delete');

  // Nothing merged or deleted.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(editor).toContainText('あとに続く段落');
  await expect(callout).not.toContainText('あとに続く段落');

  // The caret is still at the body's end.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
});

// Delete at the end removes an empty line after it (stepIntoNextIsolating); the paragraph below
// keeps TrailingNode from refilling it.
test('Delete at a callout end deletes an empty line right after it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('次の段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Enter'); // splits into an empty paragraph + one holding the text
  await page.keyboard.press('ArrowUp'); // into the (still empty) paragraph
  await page.keyboard.press('ArrowUp'); // back onto the callout body's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');
  await expect(bodyParagraphs).toHaveCount(3);

  await page.keyboard.press('Delete');

  // The empty line is gone.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');
  await expect(bodyParagraphs).toHaveCount(2);
  await expect(editor).toContainText('次の段落');
  await expect(callout).not.toContainText('次の段落');

  // The caret stayed at the body's end.
  await page.keyboard.type('と追記');
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文と追記');
});

// `isolating` traps an empty callout (no way out from inside, no toolbar toggle), so Backspace at
// its start unwraps it.
test('Backspace at the start of an empty callout removes it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
});

// Only empty callouts: with text, Backspace at the start keeps the box.
test('Backspace at the start of a non-empty callout keeps it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('消えない本文');
  // Placed by command: a `Home` inside the sync window after typing is swallowed, and
  // `caretAtLineStart` then waits forever. Home is setup here; Backspace is the subject.
  await caretAtStartOf(page, 'callout');
  // Stated: a Backspace on a stale selection matches no keymap and the browser edits the DOM (file
  // header), so the caret must be known to be at 0.
  expect(await caret(page)).toBe('消えない本文@0');

  await page.keyboard.press('Backspace');
  const callout = editor.locator('div.markdown-alert');
  await expect(callout).toHaveCount(1);
  await expect(callout.locator('.markdown-alert-content')).toContainText('消えない本文');
});

// `isolating` blocks liftEmptyBlock (`liftTarget` will not climb past it), so without
// exitCalloutOnEmptyEnter Enter would split forever. As a blockquote: the first Enter opens an
// empty line inside, the second exits.
test('Enter twice at the end of a callout exits it into a new paragraph below', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('囲み枠の本文');

  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');

  // Baseline: TrailingNode keeps one empty paragraph after the last callout: 1 + 1.
  await expect(bodyParagraphs).toHaveCount(2);

  // First Enter: a new empty line inside; the count grows by one.
  await page.keyboard.press('Enter');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(bodyParagraphs).toHaveCount(3);

  // Second Enter exits into the existing trailing paragraph: 2, not 3.
  await page.keyboard.press('Enter');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  await expect(bodyParagraphs).toHaveCount(2);
  await expect(callout.locator('.markdown-alert-content')).toContainText('囲み枠の本文');

  await page.keyboard.type('あとに続く段落');
  await expect(bodyParagraphs).toHaveCount(2); // still no stray blank paragraph
  await expect(editor).toContainText('あとに続く段落');
  await expect(callout).not.toContainText('あとに続く段落');
});

// As an empty blockquote: Enter in a fresh empty callout removes it.
test('Enter right after inserting an empty callout removes it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  const bodyParagraphs = editor.locator('p:not(.markdown-alert-title)');
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  // Baseline as above.
  await expect(bodyParagraphs).toHaveCount(2);

  await page.keyboard.press('Enter');

  // Gone, reusing the trailing paragraph.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(0);
  await expect(bodyParagraphs).toHaveCount(1);

  await page.keyboard.type('あとに続く段落');
  await expect(bodyParagraphs).toHaveCount(1); // still no stray blank paragraph
  await expect(editor).toContainText('あとに続く段落');
});

// Only the trailing empty line exits (`$from.index(1) !== childCount - 1`); an empty line between
// body blocks splits in place, or the next key lands below the box.
test('Enter on an empty line between two callout blocks splits in place, not exits', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();

  // Assert the tree (docString), each step gated by `expect.poll`. Two lines: "前の行", then "後の行".
  await page.keyboard.type('前の行');
  await page.keyboard.press('Enter');
  await page.keyboard.type('後の行');
  await expect
    .poll(() => docString(page))
    .toBe('doc(callout(paragraph("前の行"), paragraph("後の行")), paragraph)');

  // A blank line between them: Home then Enter. caretAtLineStart waits out Home's sync, or Enter
  // splits at the stale end.
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => docString(page))
    .toBe('doc(callout(paragraph("前の行"), paragraph, paragraph("後の行")), paragraph)');

  // Into the blank (ArrowLeft): `@0` names an empty line.
  await caretSettled(page); // let the Enter's selection sync flush, or the arrow is swallowed
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => caret(page)).toBe('@0');

  // Must not exit: it splits in place and the blank stays inside.
  await page.keyboard.press('Enter');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(callout(paragraph("前の行"), paragraph, paragraph, paragraph("後の行")), paragraph)',
    );

  // The next key lands inside the callout.
  await page.keyboard.type('中の文字');
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(callout(paragraph("前の行"), paragraph, paragraph("中の文字"), paragraph("後の行")), paragraph)',
    );
});

// An empty line at the callout's head: the same guard, split in place.
test('Enter on an empty line at the head of a callout splits in place, not exits', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();

  // A blank above the body. **Placed by `caretAtStartOf`, not `Home`**, which the sync window after
  // typing can swallow.
  await page.keyboard.type('本文');
  await caretAtStartOf(page, 'callout');
  await page.keyboard.press('Enter');
  await expect
    .poll(() => docString(page))
    .toBe('doc(callout(paragraph, paragraph("本文")), paragraph)');

  // Into the leading blank, **through the editor**: a full run outlasts `caretSettled`'s 70ms and the
  // ArrowLeft is swallowed. After the Enter, the callout's inner start is that blank.
  await caretAtStartOf(page, 'callout');
  await expect.poll(() => caret(page)).toBe('@0');

  // Must not exit: split in place.
  await page.keyboard.press('Enter');
  await expect
    .poll(() => docString(page))
    .toBe('doc(callout(paragraph, paragraph, paragraph("本文")), paragraph)');

  // The next key lands inside the callout.
  await page.keyboard.type('中の文字');
  await expect
    .poll(() => docString(page))
    .toBe('doc(callout(paragraph, paragraph("中の文字"), paragraph("本文")), paragraph)');
});
