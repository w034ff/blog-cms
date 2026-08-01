import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import { caretPoint, cdpNativeDrag, dragSelect, type Point } from './native-drag';

// The code block header's controls are not a drop target for content dragged out of this document
// (refuseEditorDrag in components/editor/code-block-extension.ts).
//
// The filename <input> is a natively droppable text control, and the NodeView's `stopEvent` keeps
// ProseMirror out of every event over the header — so prosemirror-view's `eventBelongsToView` stops
// short of the view and a drop there misses ProseMirror's drop path entirely: no `handleDrop` prop
// runs, and no transaction removes the dragged range. What Chrome does with the drop it is left
// holding is the reported bug, and it is worse than a bad filename. Measured on this document, with
// a selection running from inside the code body into the paragraph below it:
//
//   before  doc(paragraph("前の段落です"), codeBlock("const x = 1;\n"), paragraph("後の段落です"))
//   after   doc(paragraph("前の段落です"), codeBlock("c"), paragraph)
//   field   ""
//
// The dragged range is gone from the document — Chrome ran its own move and deleted the source out
// of the contenteditable, which ProseMirror never authorized and cannot undo as one step — and it
// did not arrive in the field either. The text is simply destroyed. Hence the document assertion
// below is the primary one and the field's value is the secondary check.
//
// Same machinery as the table and callout drop guards; see e2e/native-drag.ts.

const MD = '前の段落です\n\n```ts\nconst x = 1;\n```\n\n後の段落です\n';
// The code block's trailing "\n" is what markdown-it's fence renderer emits; it is part of the
// loaded document, not an artifact of the assertion.
const DOC =
  'doc(paragraph("前の段落です"), codeBlock("const x = 1;\\n"), paragraph("後の段落です"))';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, MD);
  expect(await docString(page)).toBe(DOC);
}

// From inside the code body down into the paragraph below it: the slice carries the code block and
// the text/plain carries a newline, which is the shape the report describes.
//
// Both endpoints are caret boundaries measured on the rendered text (caretPoint, e2e/native-drag.ts)
// rather than pixel offsets into the boxes: the assertions below count characters, so the gesture
// has to reach the same ones every run. Measuring also settles the vertical question the box could
// not — the fence renders a trailing "\n", so the <code> box is two lines tall and its midpoint
// lands on the empty second line, where a mousedown selects nothing and the whole test passes
// vacuously. A caret measured at the first character is on the first line by construction.
async function selectAcrossCodeEdge(page: Page): Promise<Point> {
  const editor = page.locator('.ProseMirror');
  const from = await dragSelect(
    page,
    await caretPoint(editor.locator('.code-block code'), 1),
    await caretPoint(editor.getByText('後の段落です'), 3),
  );
  // Guard the guard: assert the selection actually spans the boundary before dragging it.
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected).toContain('後の段');
  expect(selected).toContain('x = 1;');
  return from;
}

async function dragOntoFilenameField(page: Page, from: Point): Promise<void> {
  const field = await page.locator('.ProseMirror .code-block-filename').boundingBox();
  if (!field) throw new Error('missing box');
  await cdpNativeDrag(page, from, { x: field.x + field.width / 2, y: field.y + field.height / 2 });
}

test('a selection spanning the code body and the prose cannot be dropped on the filename field', async ({
  page,
}) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  const filename = editor.locator('.code-block-filename');
  await expect(filename).toHaveValue('');

  await dragOntoFilenameField(page, await selectAcrossCodeEdge(page));

  // Nothing landed in the field…
  await expect(filename).toHaveValue('');
  // …and — the half that matters more — the document is untouched. Chrome's native move would have
  // deleted the dragged range straight out of the contenteditable, which ProseMirror never
  // authorized and the NodeView's ignoreMutation would have partly hidden from it.
  expect(await docString(page)).toBe(DOC);
  await expect(editor.locator('.code-block')).toHaveCount(1);
  // The field commits on blur, so a value that landed but hadn't committed yet would still be
  // waiting. Focusing and leaving is what would flush it.
  await filename.click();
  await filename.blur();
  await expect(filename).toHaveValue('');
  expect(await docString(page)).toBe(DOC);
});

test('the filename field still accepts typing after a refused drop', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  const filename = editor.locator('.code-block-filename');

  await dragOntoFilenameField(page, await selectAcrossCodeEdge(page));

  // The refusal is scoped to the drag; the control itself is untouched. Without this, blocking the
  // drop by disabling the field would look like a pass. Asserting the value *after* blur also
  // reads the model, not the keystrokes: the NodeView's sync() rewrites the field from the node's
  // attrs whenever the input is unfocused, so a commit that never happened would blank it here.
  await filename.fill('index.ts');
  await filename.blur();
  await expect(filename).toHaveValue('index.ts');
});
