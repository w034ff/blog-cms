import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import { caretAtLineStart, docString, selectionClassName, settle } from './editor-probe';

// The position of a code block's first character — the caret spot every test below acts on. Named
// by walking the document rather than by arithmetic, so a fixture that nests the block one level
// deeper doesn't silently point somewhere else.
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

// A keyboard `Home` moves the caret natively; ProseMirror syncs its internal selection from the
// `selectionchange` event on a 20ms debounce (DOMObserver.flushSoon). A Backspace inside that
// window bypasses every keymap and the browser's native edit corrupts the document (see the
// callout boundary spec for the full story). The wait is `caretAtLineStart` in editor-probe.ts,
// which asks the editor rather than the DOM — see there for why the DOM's offset cannot answer it.

// The same 20ms selectionchange debounce (DOMObserver.flushSoon) that caretAtLineStart guards, but
// after a native ArrowUp/End move whose settled offset is line-dependent — there's no fixed value
// to poll for, so a flat wait past the debounce is the only option. Without it a Delete fired inside
// the debounce window acts on ProseMirror's stale selection and corrupts the doc. The natural gap
// between the End keypress and Delete usually clears the debounce on its own, but not reliably —
// this makes it deterministic rather than leaning on incidental timing margin.
async function caretSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 70)));
}

// The code block is `isolating` (components/editor/code-block-extension.ts), so a block below it
// can't be merged into the code, and the shared Backspace shortcut steps the caret into the code
// block's end instead of node-selecting it. Browser-only — this is live-editor edit behavior.
test('a paragraph after a code block is not merged into it by Backspace at its start', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  // Code block, then a paragraph directly after it (ArrowDown exits the code block — exitOnArrowDown
  // must still work with `isolating` on).
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const x = 1');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('あとの段落');

  const codeBody = editor.locator('.code-block code');
  // Precondition: exitOnArrowDown made a separate paragraph — the text is NOT in the code body.
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  await page.keyboard.press('Home');
  await caretAtLineStart(page);
  await page.keyboard.press('Backspace');

  // Not merged: one code block, its body unchanged, the paragraph still present.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret landed at the *end of the code body*, so typing appends there (into the code).
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
  await expect(editor).toContainText('あとの段落');
});

// Unlike the non-empty case above, an *empty* line right after the code block carries nothing
// that could corrupt the code, so stepIntoPreviousIsolating deletes it outright (matching
// blockquote's plain join, where the empty line just disappears) instead of leaving it stranded.
// A second, non-empty paragraph below proves the delete really happened: with the doc's last
// block already a paragraph, StarterKit's TrailingNode has nothing to refill, so a stale line
// would otherwise still be there to count.
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

  // The empty line is gone — only the non-empty paragraph remains, directly after the code block.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // Caret landed at the code body's end, same as the non-empty case.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// The Delete-direction mirror of the "not merged" test above: at the code block's own end,
// Delete must not pull in the following non-empty paragraph. `isolating` already blocks
// joinForward for this (prosemirror-commands' findCutAfter refuses to cross it), so this is a
// plain no-op with no custom command involved — but it's exactly the case stepIntoNextIsolating
// must also leave alone, so it's covered here alongside its empty-line counterpart below.
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

  // Nothing merged, nothing deleted: one code block, its body unchanged, the paragraph intact.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor).toContainText('あとの段落');

  // The caret is still at the code body's end, so typing appends there.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// The Delete-direction mirror of the empty-line Backspace test above: at the code block's own
// end, an empty line right after it carries nothing that could corrupt the code, so
// stepIntoNextIsolating (isolating-boundary.ts) deletes it outright. A second, non-empty
// paragraph proves the delete happened (TrailingNode has nothing to refill, so a stale line
// would otherwise still be there to count).
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

  // The empty line is gone — only the non-empty paragraph remains, directly after the code block.
  await expect(editor.locator('.code-block')).toHaveCount(1);
  await expect(codeBody).toHaveText('const x = 1');
  await expect(editor.locator('p')).toHaveCount(1);
  await expect(editor.locator('p')).toHaveText('次の段落');

  // Caret stayed at the code body's end, so typing appends there.
  await page.keyboard.type(';');
  await expect(codeBody).toHaveText('const x = 1;');
});

// Regression: `isolating` must not trap the code block — Backspace from inside an empty block
// must still remove it. Right after typing the fence it takes the fence-undo path (the literal
// ``` text comes back, see fenceUndoKey in the extension); once the record has expired, the
// inherited empty → clear kicks in instead (covered in editor-codeblock-language.spec.ts).
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

// Backspace at the *start of the code itself*, in a non-empty block. Base CodeBlock's own
// Backspace handler tests `$anchor.pos === 1` — true only when the code block is the document's
// very first node — and answered it with `clearNodes()`: the block was destroyed, its language and
// filename went with it, and multi-line code landed in one paragraph holding literal \n characters
// (which re-parses as headings/lists on the next load). It now *selects* the block instead, in every
// position, so the document is untouched and a second Backspace removes the whole thing.
async function typeTwoLineBlock(page: Page): Promise<void> {
  await page.keyboard.type('```ts:index.ts '); // language *and* filename, so attr loss is visible
  await page.keyboard.type('const a = 1');
  await page.keyboard.press('Enter'); // newlineInCode — one block, two lines
  await page.keyboard.type('const b = 2');
  await page.keyboard.press('ArrowUp'); // onto the first line
  await page.keyboard.press('Home'); // …and to the code's very start
  // The code body is one DOM text node, so offset 0 is the start of the code, not just of a line.
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

  // The document is untouched; only the selection changed.
  await expectBlockIntact(page);
  expect(await selectionClassName(page)).toBe('NodeSelection');

  // …and the second press removes the whole block, which is the route out.
  await page.keyboard.press('Backspace');
  await expect(editor.locator('.code-block')).toHaveCount(0);
});

// The control: the identical keystroke one paragraph further down the document, where
// `$anchor.pos === 1` is false. Both positions must behave the same way.
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

// The same keystroke, in the containers a code block actually lives in. `isolating` makes
// prosemirror-commands' findCutBefore return null, and joinBackward reads that as "nothing to join
// across" rather than "refuse" — falling through to blockRange() + liftTarget, which tore the block
// out of its container. A callout was already safe (liftTarget breaks on an isolating ancestor and
// the callout is one); listItem, blockquote and details are not isolating, so all three broke.
// docString rather than element counts: what went wrong is the *shape* of the document.
const NESTED: { name: string; md: string; doc: string }[] = [
  {
    name: 'a list item',
    md: '- 項目\n\n  ```ts:index.ts\n  const a = 1\n  const b = 2\n  ```\n',
    // The whole listItem used to be lifted out — `- 項目` came back as a bare `項目`.
    doc: 'doc(bulletList(listItem(paragraph("項目"), codeBlock("const a = 1\\nconst b = 2\\n"))), paragraph)',
  },
  {
    name: 'a blockquote',
    md: '> 引用\n>\n> ```ts:index.ts\n> const a = 1\n> const b = 2\n> ```\n',
    // The code block used to escape the quote and land as a top-level sibling.
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
    // What it did instead: selected the block, so the author is one press from removing it.
    expect(await selectionClassName(page)).toBe('NodeSelection');
  });
}

// The third container, and the one no markdown fixture reaches: `:::details` doesn't parse back
// through loadMarkdown (it arrives as a literal paragraph), so the accordion is built by typing the
// way editor-details-view.spec.ts does. `details` is not `isolating` either, so before the guard it
// lifted the code block straight out of the accordion body.
//
// The document is captured rather than spelled out — the point is that the keystroke changes
// nothing, and naming the accordion's internal node structure here would only couple this test to it.
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

  // The guard returns true without ever touching `tr`, so it must leave nothing on the history
  // stack — an empty transaction there would spend the author's next Ctrl+Z undoing nothing. This
  // is the one case in this file that can ask: the document was *typed*, so undo has a real step to
  // reach, and reaching it proves the Backspace didn't insert one of its own in front. (The
  // fixtures above arrive via setContent, which is a single history event, so the same press there
  // would clear the whole document either way and prove nothing.)
  await page.keyboard.press('Control+z');
  await settle(page);
  expect(await docString(page)).not.toBe(before);
});

// Getting rid of a fence inside a quote, which is what the author actually does — and which the
// first version of the guard (a bare no-op at the block's start) made impossible.
//
// The trap is the trailing newline: a block loaded from markdown carries one (markdown-it
// terminates fence content with it), so deleting the visible code leaves `codeBlock("\n")` — empty
// on screen, `content.size === 1` in the document. The empty→paragraph escape declines there, and a
// refusal at the start then swallowed every further Backspace, leaving no way out at all. Selecting
// the block instead covers that state without having to decide which whitespace counts as empty.
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

  // Select the visible code and delete it — the state that used to become a dead end.
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

// Empty an already-settled code block (the fence-undo record has to be gone, or Backspace takes
// that path instead) and press Backspace: the block goes back to being a paragraph.
async function typeSettledEmptyBlock(page: Page): Promise<void> {
  await page.keyboard.type('```ts ');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace'); // deleteSoleCodeChar — empty again, record expired
  await settle(page);
}

// The reported crash. Base CodeBlock answers the empty block with TipTap's `clearNodes()`, which
// takes `contentMatchAt(index).defaultType` unchecked — and this document is `block+
// footnoteSection?`, so at every top-level position past the first child that default is
// `footnoteSection`. Setting a code block to a node whose content is `footnoteDefinition+` threw
// "RangeError: Invalid content for node type footnoteSection", uncaught, and the block could not be
// removed with Backspace at all.
//
// The pageerror listener is the point of this test: the throw left the document *untouched*, so a
// spec asserting only the document reads the failure as "nothing happened" and passes either way.
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
  // The caret came with it, so typing continues in the paragraph the fence became.
  await page.keyboard.type('ふつうの文');
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落"), paragraph("ふつうの文"), paragraph)',
  );
});

// The same escape inside a list item — where it never threw (clearNodes asks the *listItem's*
// content expression, which has no footnoteSection in reach) but did something else: `clearNodes`
// also lifts, so the block used to leave the bullet on its way to becoming a paragraph.
// clearEmptyCodeBlock only re-marks the node, so it stays in the item, which is what emptying any
// other block there does. Asserted as a document rather than a block count, because both behaviours
// remove the `.code-block`.
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

// Regression: deleting the block's final character used to be left to the browser, and
// Chrome's native edit folded the emptied <pre><code> into the ce=false header — removing
// the code body from the DOM while ignoreMutation hid the damage from ProseMirror (the
// header remained but the block was uneditable until a reload). deleteSoleCodeChar in the
// extension now performs that one deletion through ProseMirror.
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
