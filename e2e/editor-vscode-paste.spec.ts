import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// Base CodeBlock turns any paste carrying VS Code's `vscode-editor-data` into a code block, so a URL
// copied from an editor became a ```markdown fence, replacing any selection.
// code-block-extension.ts swaps in one requiring more than one line. The filter matches an upstream
// PluginKey name, so a rename would silently restore the old handler: the single-line cases catch
// it. Synthesized, as image-upload.spec.ts synthesizes a File.

const URL_TEXT = 'https://wikiwiki.jp/livejupiter';

type Flavour = { type: string; data: string };

// VS Code puts the language in `mode`, this flavour's one use.
const VSCODE: Flavour = {
  type: 'vscode-editor-data',
  data: JSON.stringify({ version: 1, mode: 'markdown' }),
};

async function openEditor(page: Page, md: string): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, md);
}

async function paste(page: Page, flavours: Flavour[]): Promise<void> {
  await page.evaluate((items) => {
    const transfer = new DataTransfer();
    for (const { type, data } of items) transfer.setData(type, data);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, flavours);
}

const plain = (data: string): Flavour => ({ type: 'text/plain', data });

test('a single-line paste from VS Code stays text', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 4); // end of 「ここ」
  await paste(page, [plain(URL_TEXT), VSCODE]);

  // The reported case: a URL copied out of an editor window used to arrive as a ```markdown fence.
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await docString(page)).toContain('paragraph');
});

test('copying a whole line from VS Code is still one line', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 4);
  // A line copy includes its newline; one line of content, so a trailing newline is stripped first.
  await paste(page, [plain(`${URL_TEXT}\n`), VSCODE]);

  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
});

test('a single-line paste from VS Code does not destroy the selection', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 1, 3); // 「ここ」selected
  await paste(page, [plain('const x = 1;'), VSCODE]);

  // The old handler replaced 「ここ」 with a code block; now it lands as text.
  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
  expect(await docString(page)).toBe('doc(paragraph("const x = 1;"))');
});

test('a multi-line paste from VS Code is still a code block with its language', async ({
  page,
}) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 4);
  await paste(page, [plain('line1\nline2'), VSCODE]);

  // The half of the feature worth keeping: the flavour is the only source for the language.
  expect(await docString(page)).toBe(
    'doc(paragraph("ここ"), codeBlock("line1\\nline2"), paragraph)',
  );
  const language = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            state: {
              doc: {
                descendants(
                  f: (n: { type: { name: string }; attrs: { language?: string } }) => void,
                ): void;
              };
            };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let found = '';
    el.editor.state.doc.descendants((n) => {
      if (n.type.name === 'codeBlock') found = n.attrs.language ?? '';
    });
    return found;
  });
  expect(language).toBe('markdown');
  // Built with `language` only: an empty `filename` must not leave ```markdown: stored.
  expect(await markdown(page)).toBe('ここ\n\n```markdown\nline1\nline2\n```');
});

test('a URL pasted from VS Code over a selection still makes a link', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 1, 3);
  await paste(page, [plain(URL_TEXT), VSCODE]);

  // Unaffected: Link's priority 1000 puts its handlePaste first (ExtensionManager sorts by priority
  // after reversing the list).
  expect(await docString(page)).toBe('doc(paragraph(link("ここ")))');
});
