import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// Base CodeBlock ships a paste handler that turns any clipboard carrying VS Code's
// `vscode-editor-data` flavour into a code block without looking at the content — so copying a URL
// out of an editor window produced a ```markdown fence, and over a selection it destroyed the
// selected text on the way (`replaceSelectionWith`). components/editor/code-block-extension.ts
// replaces it with one that requires the text to span more than one line.
//
// These specs are the standing check on that swap. The filter that removes the base plugin matches
// an upstream PluginKey name, so a rename in @tiptap/extension-code-block would silently restore
// the old behaviour — the single-line cases below are what would catch it.
//
// The clipboard is synthesised the way e2e/image-upload.spec.ts synthesises a pasted File:
// `vscode-editor-data` is a real custom MIME type, and DataTransfer.setData accepts it.

const URL_TEXT = 'https://wikiwiki.jp/livejupiter';

type Flavour = { type: string; data: string };

// VS Code writes the source file's language into `mode`; that is where the code block's language
// attribute comes from, and the only thing this clipboard flavour is actually good for.
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
  // Ctrl+C with nothing selected copies the caret's line *including* its newline. That is one line
  // of content, so the multi-line test strips a trailing newline before deciding.
  await paste(page, [plain(`${URL_TEXT}\n`), VSCODE]);

  await expect(page.locator('.ProseMirror pre')).toHaveCount(0);
});

test('a single-line paste from VS Code does not destroy the selection', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 1, 3); // 「ここ」selected
  await paste(page, [plain('const x = 1;'), VSCODE]);

  // The old handler replaced the selection with a code block holding the pasted text, so 「ここ」
  // vanished. Now the paste lands as ordinary text.
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
  // The node is built with `language` only, so `filename` comes from its default. An empty one
  // must not leave a dangling colon in the fence (```markdown:), which is what would be stored.
  expect(await markdown(page)).toBe('ここ\n\n```markdown\nline1\nline2\n```');
});

test('a URL pasted from VS Code over a selection still makes a link', async ({ page }) => {
  await openEditor(page, 'ここ\n');
  await setRange(page, 1, 3);
  await paste(page, [plain(URL_TEXT), VSCODE]);

  // Unaffected by the swap, and the reason the reported bug was not worse than it was: Link sets
  // priority 1000, and ExtensionManager sorts by priority *after* reversing the extension list, so
  // its handlePaste is asked before any code block handler whatever the array order.
  expect(await docString(page)).toBe('doc(paragraph(link("ここ")))');
});
