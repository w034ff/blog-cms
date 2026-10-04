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

// The code block header's controls refuse drops of content dragged from this document
// (`refuseChromeDrops`, useDragContainment.ts, used by code-block-extension.ts). The NodeView's
// `stopEvent` keeps ProseMirror out of the header, so a drop on the filename <input> misses
// `handleDrop`, and Chrome's own move deletes the range:
//
//   before  doc(paragraph("前の段落です"), codeBlock("const x = 1;\n"), paragraph("後の段落です"))
//   after   doc(paragraph("前の段落です"), codeBlock("c"), paragraph)
//   field   ""
//
// The text is destroyed, so the document is the primary assertion. Machinery and fixture:
// e2e/native-drag.ts.

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

  // Nothing in the field…
  await expect(filename).toHaveValue('');
  // …and, more to the point, the document is untouched.
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
  await expect(editor.locator('.code-block')).toHaveCount(1);
  // It commits on blur, so focus and leave to flush anything pending.
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

  // Scoped to the drag: disabling the field would also pass. Read after blur, since sync() rewrites
  // an unfocused field from the attrs, blanking a commit that never happened.
  await filename.fill('index.ts');
  await filename.blur();
  await expect(filename).toHaveValue('index.ts');
});
