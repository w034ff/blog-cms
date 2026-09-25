import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown } from './editor-authoring';
import {
  CODE_EDGE_DOC,
  CODE_EDGE_MD,
  cdpNativeDrag,
  dragSelect,
  selectAcrossCodeEdge,
} from './native-drag';

// Editor content may not be dropped on the form fields beside it (useDragContainment.ts). Outside
// `view.dom` ProseMirror's drop never runs and Chrome's own move deletes the range behind its back:
//
//   before  doc(paragraph("前の段落です"), codeBlock("const x = 1;\n"), paragraph("後の段落です"))
//   after   doc(paragraph("前の段落です"), codeBlock("c"), paragraph)
//   title   "onst x = 1;  後の段"
//
// Only タイトル is exercised: the other fields are in the modal 記事の設定 drawer (§12.22), whose
// backdrop blocks the body, so no drag can reach them. The guard still covers all four.
// Machinery and fixture: e2e/native-drag.ts.

const FIELDS = ['タイトル'] as const;

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, CODE_EDGE_MD);
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
}

for (const label of FIELDS) {
  test(`a selection dragged out of the editor is refused by the ${label} field`, async ({
    page,
  }) => {
    await openEditor(page);
    const field = page.getByLabel(label);
    const before = await field.inputValue();

    const from = await selectAcrossCodeEdge(page);
    const box = await field.boundingBox();
    if (!box) throw new Error('missing box');
    await cdpNativeDrag(page, from, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

    // The document matters: the browser's move destroys the range whatever lands in the field.
    expect(await docString(page)).toBe(CODE_EDGE_DOC);
    await expect(field).toHaveValue(before);
  });
}

test('the fields still take typed input after a refused drop', async ({ page }) => {
  await openEditor(page);
  const from = await selectAcrossCodeEdge(page);
  const box = await page.getByLabel('タイトル').boundingBox();
  if (!box) throw new Error('missing box');
  await cdpNativeDrag(page, from, { x: box.x + box.width / 2, y: box.y + box.height / 2 });

  // Scoped to the drag: disabling the fields would also pass.
  await page.getByLabel('タイトル').fill('E2E ドラッグ封じ');
  await expect(page.getByLabel('タイトル')).toHaveValue('E2E ドラッグ封じ');
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
});

// The reported symptom: no caret after the drag. The browser deleted the source text and moved
// focus to the field:
//
//   doc     callout(paragraph("囲みの中身です")) → callout(paragraph)
//   title   "囲みの中身です"
//   editor  hasFocus false, activeElement <input name=title>, selection collapsed at 10
//
// Selection and focus are asserted: an intact but unfocused document passes the document check.
const CALLOUT_MD = '前の段落です\n\n> [!NOTE]\n>\n> 囲みの中身です\n\n後の段落です\n';
const CALLOUT_DOC =
  'doc(paragraph("前の段落です"), callout(paragraph("囲みの中身です")), paragraph("後の段落です"))';

test("dragging a callout's whole text to a field leaves the editor focused and the selection intact", async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, CALLOUT_MD);
  expect(await docString(page)).toBe(CALLOUT_DOC);

  // `.last()`: the first <p> is the callout's title chip.
  const inner = await editor.locator('.markdown-alert p').last().boundingBox();
  const title = await page.getByLabel('タイトル').boundingBox();
  if (!inner || !title) throw new Error('missing boxes');

  const from = await dragSelect(
    page,
    { x: inner.x + 1, y: inner.y + inner.height / 2 },
    { x: inner.x + inner.width - 1, y: inner.y + inner.height / 2 },
  );
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('囲みの中身です');

  await cdpNativeDrag(page, from, {
    x: title.x + title.width / 2,
    y: title.y + title.height / 2,
  });

  expect(await docString(page)).toBe(CALLOUT_DOC);
  await expect(page.getByLabel('タイトル')).toHaveValue('');
  // Focus and selection are kept.
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor?: {
          state: { selection: { from: number; to: number } };
          view: { hasFocus(): boolean };
        };
      };
      const selection = el.editor?.state.selection;
      return {
        hasFocus: el.editor?.view.hasFocus(),
        from: selection?.from,
        to: selection?.to,
        domText: window.getSelection()?.toString(),
      };
    }),
  ).toEqual({ hasFocus: true, from: 10, to: 17, domText: '囲みの中身です' });
});

// Drags within the editor still move; file drops (view.dragging null) are image-upload.spec.ts's.
test('a drag that stays inside the editor still moves the text', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');

  const above = await editor.getByText('前の段落です').boundingBox();
  if (!above) throw new Error('missing box');
  const from = await dragSelect(
    page,
    { x: above.x + 2, y: above.y + above.height / 2 },
    { x: above.x + 40, y: above.y + above.height / 2 },
  );

  const below = await editor.getByText('後の段落です').boundingBox();
  if (!below) throw new Error('missing box');
  await cdpNativeDrag(page, from, { x: below.x + 40, y: below.y + below.height / 2 });

  const after = await docString(page);
  expect(after, after).not.toBe(CODE_EDGE_DOC);
});
