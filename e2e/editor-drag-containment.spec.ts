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

// Content dragged out of the editor may not be dropped on the form fields beside it
// (useDragContainment in components/editor/useDragContainment.ts).
//
// Those fields are outside `view.dom`, so ProseMirror's drop path never runs for them and Chrome
// performs its own move — deleting the dragged range out of the contenteditable behind
// ProseMirror's back. Measured on the タイトル field before the guard existed:
//
//   before  doc(paragraph("前の段落です"), codeBlock("const x = 1;\n"), paragraph("後の段落です"))
//   after   doc(paragraph("前の段落です"), codeBlock("c"), paragraph)
//   title   "onst x = 1;  後の段"
//
// The body is destroyed and the fragment lands in the field with its newlines flattened.
//
// **Only タイトル is exercised here now — カテゴリ・タグ・説明 dropped 2026-09-21, when 記事の設定
// became a modal drawer (PostSettingsPanel.tsx, docs/editor-requirements.md §12.22).** A drag is one
// continuous mouse gesture (select in the body → mousedown in the body → move → drop on the field),
// and those three fields are mounted `hidden` unless the panel is open, at which point its backdrop
// blocks the body outright — there is no moment where the body is a legal drag source and the field
// is a legal drop target at once. Confirmed technically unreachable, not merely hard to script, and
// the same is true of a real drag: an author can no longer produce this failure on these three
// fields either. タイトル is untouched by this — it was never inside the panel — and still needs
// the guard exactly as before. `useDragContainment` itself is left covering all four regardless:
// defense in depth for a future non-modal reversion or another reachable path, even though only one
// of the four can be driven end-to-end from here. Same machinery as the other drop guards; see
// e2e/native-drag.ts, which also owns the fixture and the selection this file and
// codeblock-header-drop-guard.spec.ts both start from.

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

    // The document is the assertion that matters: the browser's move destroys the dragged range
    // whether or not anything lands in the field.
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

  // The refusal is scoped to the drag, not to the control. Without this, disabling the fields
  // outright would look like a pass.
  await page.getByLabel('タイトル').fill('E2E ドラッグ封じ');
  await expect(page.getByLabel('タイトル')).toHaveValue('E2E ドラッグ封じ');
  expect(await docString(page)).toBe(CODE_EDGE_DOC);
});

// The reported symptom, and the one the document assertions above do not catch: after the drag the
// editor had no caret. Two things caused that together, and both are the browser's doing once its
// default action runs — the source text was deleted out of the contenteditable, and focus moved to
// the field the drop landed on. Measured before the guard existed, dragging the whole of a
// callout's text onto タイトル:
//
//   doc     callout(paragraph("囲みの中身です")) → callout(paragraph)
//   title   "囲みの中身です"
//   editor  hasFocus false, activeElement <input name=title>, selection collapsed at 10
//
// So the caret was not merely invisible: the text it should have sat in was gone and the editor no
// longer held focus. Asserting the selection *and* the focus, because the document check alone
// passes on a document that is intact but unfocused.
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

  // `.last()` — the callout renders a contenteditable=false title paragraph ("情報") ahead of its
  // body, so the first <p> is chrome rather than the text being dragged.
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
  // The refused gesture leaves everything as it was: the editor keeps focus and the dragged range
  // stays selected, so the callout still shows where the text is.
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

// The guard must not touch the drag it doesn't own. A selection dragged *within* the editor is
// ProseMirror's own business and still moves; useImageUpload's file drop is a different gesture
// entirely (view.dragging is null for it) and is covered by e2e/image-upload.spec.ts.
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
