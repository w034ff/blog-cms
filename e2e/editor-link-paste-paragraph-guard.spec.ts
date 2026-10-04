import { test, expect, type Page } from '@playwright/test';
import { docString } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// `linkOnPaste` links the whole selection to a pasted URL without replacing it, so Ctrl+A then a paste
// linked every paragraph. LinkPasteParagraphGuard (link-paste-paragraph-guard.ts) confines route (a)
// (docs/link-requirements.md §2.1) to one paragraph.

type EditorProbe = Element & { editor?: { state: { doc: { content: { size: number } } } } };

function docSize(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as EditorProbe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.state.doc.content.size;
  });
}

async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', text);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, text);
}

async function openEditor(page: Page, markdown: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, markdown);
}

test('a URL pasted over a selection confined to one paragraph still links', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 1, 3); // 「ここ」
  await pastePlainText(page, 'https://example.com');
  expect(await docString(page)).toBe('doc(paragraph(link("ここ")))');
});

test('a URL pasted over a selection spanning two paragraphs replaces them, one link not two', async ({
  page,
}) => {
  await openEditor(page, 'AAA\n\nBBB\n');
  const size = await docSize(page);
  await setRange(page, 1, size - 1); // start of "AAA" through end of "BBB", both inside the doc
  await pastePlainText(page, 'https://example.com');
  // One paragraph, not each keeping a mismatched link; autolink (§4) then links the lone URL, label and
  // href agreeing.
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.com")))');
});

test('Ctrl+A over the whole post, then pasting a URL, replaces it instead of linking every paragraph', async ({
  page,
}) => {
  await openEditor(page, 'AAA\n\nBBB\n\nCCC\n');
  await page.keyboard.press('ControlOrMeta+a');
  await pastePlainText(page, 'https://example.com');
  expect(await docString(page)).toBe('doc(paragraph(link("https://example.com")))');
});

test('a non-URL paste over a multi-paragraph selection is unaffected (already replaced)', async ({
  page,
}) => {
  await openEditor(page, 'AAA\n\nBBB\n');
  await page.keyboard.press('ControlOrMeta+a');
  await pastePlainText(page, 'plain text, not a link');
  expect(await docString(page)).toBe('doc(paragraph("plain text, not a link"))');
});
