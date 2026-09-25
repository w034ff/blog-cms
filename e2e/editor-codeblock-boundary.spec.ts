import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import { caretAtLineStart, docString, selectionClassName, settle } from './editor-probe';

// A code block's first character, found by walking the document so a deeper fixture still works.
function codeContentStart(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor?: { state: { doc: { descendants(f: (n: unknown, p: number) => void): void } } };
    };
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let at: number | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      if ((node as { type: { name: string } }).type.name === 'codeBlock' && at === null) at = pos;
    });
    if (at === null) throw new Error('no codeBlock in the document');
    return (at as number) + 1; // step over the block's open token, into its text
  });
}

// A native `Home` reaches state through the 20ms debounce; a Backspace inside it bypasses every keymap
// (docs/editor-pitfalls.md §1.1, editor-callout-boundary.spec.ts). The wait is `caretAtLineStart`.

// A flat wait past the 20ms sync after a native ArrowUp/End, whose settled offset is not known;
// a Delete inside it acts on the stale selection.
async function caretSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 70)));
}

// The code block is `isolating` (code-block-extension.ts): the block below cannot merge into it, and
// Backspace steps the caret to the code's end instead of node-selecting it.
test('a paragraph after a code block is not merged into it by Backspace at its start', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // A code block, then a paragraph (exitOnArrowDown must still work with `isolating`).
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとの段落');

  const codeBody = editor.locator('.code-block code');
  // Precondition: the text is not in the code body.
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');

  // Not merged: one block, body unchanged, paragraph present.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret is at the code's end, so typing appends to the code.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
  await expect(editor).toContainText('あとの段落');
});

// An empty line after the block can corrupt nothing, so stepIntoPreviousIsolating deletes it. The
// paragraph below keeps TrailingNode from refilling it.
test('Backspace on an empty line after a code block deletes that line', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown'); // exits into a fresh empty paragraph
  await page.keyboard.press('Enter');
  await page.keyboard.type('次の段落');
  await page.keyboard.press('ArrowUp'); // back into the empty line

  const codeBody = editor.locator('.code-block code');
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(2);

  await page.keyboard.press('Backspace');

  // The empty line is gone.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // The caret is at the code's end.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// Delete at the code's end must not pull in the next paragraph. `isolating` already refuses
// joinForward (`findCutAfter`), but stepIntoNextIsolating must leave it alone too.
test('a paragraph after a code block is not merged into it by Delete at the code block end', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとの段落');
  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('ArrowUp'); // back onto the code block's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const codeBody = editor.locator('.code-block code');
  await page.keyboard.press('Delete');

  // Nothing merged or deleted.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret is still at the code's end.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// Delete at the end removes an empty line after it (stepIntoNextIsolating); the paragraph below
// keeps TrailingNode from refilling it.
test('Delete at a code block end deletes an empty line right after it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown'); // exits into a fresh empty paragraph
  await page.keyboard.press('Enter'); // splits into two empty paragraphs
  await page.keyboard.type('次の段落'); // fills the second
  await page.keyboard.press('ArrowUp'); // into the (still empty) first paragraph
  await page.keyboard.press('ArrowUp'); // back onto the code block's line
  await page.keyboard.press('End'); // its true end
  await caretSettled(page);

  const codeBody = editor.locator('.code-block code');
  await expect(editor.locator('p')).toHaveCount(2);

  await page.keyboard.press('Delete');

  // The empty line is gone.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // The caret stayed at the code's end.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// `isolating` must not trap the block: right after the fence, Backspace restores the literal text
// (fenceUndoKey); later the empty → clear path applies (editor-codeblock-language.spec.ts).
test('Backspace in a just-typed empty code block restores the fence text', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('``` '); // plain empty fence
  await expect(editor.locator('.code-block')).toHaveCount(1);

  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
  await expect(editor).toContainText('```');
});

// Backspace at the start of non-empty code. Base CodeBlock tests `$anchor.pos === 1` (the doc's first
// node only) and ran `clearNodes()`, destroying language, filename and line structure. It now
// selects the block everywhere; a second Backspace removes it.
async function typeTwoLineBlock(page: Page): Promise<void> {
  await page.keyboard.type('```ts:index.ts '); // language *and* filename, so attr loss is visible
  await page.keyboard.type('const a = 1');
  await page.keyboard.press('Enter'); // newlineInCode — one block, two lines
  await page.keyboard.type('const b = 2');
  await page.keyboard.press('ArrowUp'); // onto the first line
  await page.keyboard.press('Home'); // …and to the code's very start
  // The code body is one text node, so offset 0 is the code's start.
  await caretAtLineStart(page);
}

async function expectBlockIntact(page: Page): Promise<void> {
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(editor.locator('.code-block code')).toHaveText('const a = 1\nconst b = 2');
  await expect(editor.locator('.code-block-lang')).toHaveValue('ts');
  await expect(editor.locator('.code-block-filename')).toHaveValue('index.ts');
}

test('Backspace at the start of the code selects the block, it is not destroyed (block first in the doc)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await typeTwoLineBlock(page);
  await expectBlockIntact(page);

  await page.keyboard.press('Backspace');

  // Only the selection changed.
  await expectBlockIntact(page);
  expect(await selectionClassName(page)).toBe('NodeSelection');

  // The second press removes the block.
  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
});

// Control: one paragraph down, where `$anchor.pos === 1` is false, the same result.
test('Backspace at the start of the code selects the block (paragraph above it)', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await typeTwoLineBlock(page);
  await expectBlockIntact(page);

  await page.keyboard.press('Backspace');

  await expectBlockIntact(page);
  expect(await selectionClassName(page)).toBe('NodeSelection');
  await expect(editor.locator('p').first()).toHaveText('前の段落');

  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
  await expect(editor.locator('p').first()).toHaveText('前の段落');
});

// In containers: `isolating` makes `findCutBefore` return null, which joinBackward reads as
// nothing to join, falling through to blockRange() + liftTarget, tearing the block out. listItem,
// blockquote and details are not isolating. docString: the shape is what went wrong.
const NESTED: { name: string; md: string; doc: string }[] = [
  {
    name: 'a list item',
    md: '- 項目\n\n  ```ts:index.ts\n  const a = 1\n  const b = 2\n  ```\n',
    // The listItem used to be lifted out.
    doc: 'doc(bulletList(listItem(paragraph("項目"), codeBlock("const a = 1\\nconst b = 2\\n"))), paragraph)',
  },
  {
    name: 'a blockquote',
    md: '> 引用\n>\n> ```ts:index.ts\n> const a = 1\n> const b = 2\n> ```\n',
    // The block used to escape the quote.
    doc: 'doc(blockquote(paragraph("引用"), codeBlock("const a = 1\\nconst b = 2\\n")), paragraph)',
  },
];

for (const { name, md, doc } of NESTED) {
  test(`Backspace at the start of the code does not lift the block out of ${name}`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, md);
    await settle(page);
    expect(await docString(page)).toBe(doc); // precondition: the fixture really nested

    await setRange(page, await codeContentStart(page));
    await settle(page);
    await page.keyboard.press('Backspace');
    await settle(page);

    expect(await docString(page)).toBe(doc); // …and the keystroke changed nothing
    await expect(editor.locator('.code-block-lang')).toHaveValue('ts');
    await expect(editor.locator('.code-block-filename')).toHaveValue('index.ts');
    // It selects the block instead.
    expect(await selectionClassName(page)).toBe('NodeSelection');
  });
}

// The accordion, typed since `:::details` does not reparse (as in editor-details-view.spec.ts);
// `details` is not isolating either. The document is captured, not spelled out.
test('Backspace at the start of the code does not lift the block out of an accordion', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type(':::details ');
  await page.keyboard.type('タイトル');
  await page.keyboard.press('Enter'); // opens the body's first line
  await page.keyboard.type('本文');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts:index.ts ');
  await page.keyboard.type('const a = 1'); // also expires the fence-undo record

  const before = await docString(page);
  expect(before).toContain('details'); // precondition: really inside an accordion…
  expect(before).toContain('codeBlock("const a = 1")'); // …with the code block in its body

  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');
  await settle(page);

  expect(await docString(page)).toBe(before);
  await expect(editor.locator('.code-block-lang')).toHaveValue('ts');
  await expect(editor.locator('.code-block-filename')).toHaveValue('index.ts');

  // The guard touches no `tr`, so no empty history step: undo must reach the typed document. Only a
  // typed fixture can ask (setContent is one event).
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await docString(page)).not.toBe(before);
});

// Removing a fence inside a quote. A loaded block ends in `\n`, so deleting the code leaves
// `codeBlock("\n")`, which the empty escape declines; a bare refusal at the start then trapped
// every Backspace. Selecting the block covers it.
test('a code block inside a quote can be removed with Backspace, trailing newline and all', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, '> 引用\n>\n> ```ts:index.ts\n> const a = 1\n> ```\n');
  await settle(page);
  expect(await docString(page)).toBe(
    'doc(blockquote(paragraph("引用"), codeBlock("const a = 1\\n")), paragraph)',
  );

  // Delete the visible code: the old dead end.
  const start = await codeContentStart(page);
  await setRange(page, start, start + 'const a = 1'.length);
  await settle(page);
  await page.keyboard.press('Delete');
  await settle(page);
  expect(await docString(page)).toBe(
    'doc(blockquote(paragraph("引用"), codeBlock("\\n")), paragraph)',
  );

  await page.keyboard.press('Backspace'); // selects the block…
  await settle(page);
  expect(await selectionClassName(page)).toBe('NodeSelection');
  await page.keyboard.press('Backspace'); // …and removes it
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe('doc(blockquote(paragraph("引用")), paragraph)');
});

// Empty a settled block (no fence-undo record) and Backspace: it becomes a paragraph.
async function typeSettledEmptyBlock(page: Page): Promise<void> {
  await page.keyboard.type('```ts ');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace'); // deleteSoleCodeChar — empty again, record expired
  await settle(page);
}

// The reported crash: `clearNodes()` takes `contentMatchAt(index).defaultType` unchecked, which past
// the first child of `block+ footnoteSection?` is `footnoteSection`, throwing "RangeError: Invalid
// content for node type footnoteSection". **The pageerror listener is the point**: the throw left
// the document untouched.
test('Backspace clears an empty code block below a paragraph without throwing', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('前の段落'); // …so the code block is NOT the doc's first child
  await page.keyboard.press('Enter');
  await typeSettledEmptyBlock(page);
  expect(await docString(page)).toBe('doc(paragraph("前の段落"), codeBlock, paragraph)');

  await page.keyboard.press('Backspace');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe('doc(paragraph("前の段落"), paragraph, paragraph)');
  // The caret came along.
  await page.keyboard.type('ふつうの文');
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落"), paragraph("ふつうの文"), paragraph)',
  );
});

// In a list item `clearNodes` did not throw but lifted the block out of the bullet.
// clearEmptyCodeBlock only re-marks the node. Asserted as a document: both remove `.code-block`.
test('Backspace clears an empty code block inside a list item, leaving it in the list', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, '- 項目\n\n  ```ts\n  ```\n');
  await settle(page);
  expect(await docString(page)).toBe(
    'doc(bulletList(listItem(paragraph("項目"), codeBlock)), paragraph)',
  );

  await setRange(page, await codeContentStart(page));
  await settle(page);
  await page.keyboard.press('Backspace');
  await settle(page);

  expect(errors).toEqual([]);
  expect(await docString(page)).toBe(
    'doc(bulletList(listItem(paragraph("項目"), paragraph)), paragraph)',
  );
});

// The browser's own deletion of the last character folded the empty <pre><code> into the ce=false
// header, hidden by ignoreMutation; deleteSoleCodeChar does it through ProseMirror.
test('deleting the last character keeps the code body editable', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('```ts ');
  await expect(editor.locator('.code-block-lang')).toHaveValue('ts');
  const code = editor.locator('.code-block code');
  await page.keyboard.type('x');
  await expect(code).toHaveText('x');

  await page.keyboard.press('Backspace');
  await expect(code).toHaveText(''); // the <code> survives, now empty

  await page.keyboard.type('y'); // …and still receives typing
  await expect(code).toHaveText('y');
});
