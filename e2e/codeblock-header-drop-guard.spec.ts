import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import {
  CODE_EDGE_DOC,
  CODE_EDGE_MD,
  cdpNativeDrag,
  selectAcrossCodeEdge,
  type Point,
} from './native-drag';

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
// Same machinery as the table and callout drop guards; see e2e/native-drag.ts, which also owns the
// fixture and the selection this file and editor-drag-containment.spec.ts both start from.

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, CODE_EDGE_MD);
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
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
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
  await expect(editor.locator('.code-block')).toHaveCount(1);
  // The field commits on blur, so a value that landed but hadn't committed yet would still be
  // waiting. Focusing and leaving is what would flush it.
  await filename.click();
  await filename.blur();
  await expect(filename).toHaveValue('');
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
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
