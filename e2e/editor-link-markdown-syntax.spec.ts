import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { loadMarkdown, setRange } from './editor-authoring';

// Measurement for docs/link-requirements.md §9 (first bullet): does typing `[text](url)` in the
// editor become a link after a save/reload round trip?
//
// §2.2 assumes it does ("保存して再読込したときに初めてリンクになる、という 2 段階の迂回路", filed
// 未実測). The source says otherwise: tiptap-markdown serializes text with
// `state.text(escapeHTML(node.text))` (tiptap-markdown.es.js:628) and prosemirror-markdown's `esc`
// escapes `[` and `]` unconditionally (dist/index.js:821), so the brackets should come back out as
// `\[…\]` and never reach markdown-it as link syntax. These tests measure both halves separately:
// what typing stores, and what loading the stored form gives back.
//
// The second question this answers is whether an in-site link can be authored at all: routes
// (a)/(b)/(c) are all gated on linkifyjs, which recognises neither `/posts/foo` nor `#見出し`.

const SYNTAX = '[断片](#見出し)';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
}

async function report(page: Page, label: string): Promise<{ doc: string; md: string }> {
  const doc = await docString(page);
  const md = await markdown(page);
  console.log(`[measure] ${label}\n  doc = ${doc}\n  md  = ${JSON.stringify(md)}`);
  return { doc, md };
}

test('typing link syntax does not make a link, and the brackets are escaped on save', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);

  const { doc, md } = await report(page, 'typed');
  // No input rule for `[]()` — extension-link contributes addPasteRules only.
  expect(doc).toBe(`doc(paragraph("${SYNTAX}"))`);
  expect(md).toContain('\\[');
});

test('the two-stage detour does not exist: save then reload leaves it literal', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  const stored = await markdown(page);

  // Exactly what reopening the saved post does — same tiptap-markdown parse path.
  await loadMarkdown(page, stored);
  const { doc, md } = await report(page, 'typed → stored → reloaded');

  expect(doc).not.toContain('link(');
  expect(doc).toBe(`doc(paragraph("${SYNTAX}"))`);
  // And it is stable: a second round trip changes nothing.
  expect(md).toBe(stored);
});

test('the same syntax loaded UNescaped does become a link', async ({ page }) => {
  await openEditor(page);
  // The control: markdown-it does parse `[]()` (linkify:false only disables bare URLs), so the
  // detour fails at the *serializer*, not at the parser.
  await loadMarkdown(page, `${SYNTAX}\n`);
  const { doc, md } = await report(page, 'loaded unescaped');

  expect(doc).toBe('doc(paragraph(link("断片")))');
  // markdown-it normalizes the href, so a non-ASCII fragment comes back percent-encoded rather
  // than as it was written. Harmless: both forms publish to the identical
  // `#user-content-%E8%A6%8B%E5%87%BA%E3%81%97` (measured through renderMdxToHtml), because
  // rehypeClobberFragmentLinks only prefixes what follows the `#` and remark encodes the raw form
  // to the same string. It is not idempotent *as text*, though — an author who typed the readable
  // form sees the encoded one after a reload.
  expect(md).toBe('[断片](#%E8%A6%8B%E5%87%BA%E3%81%97)');
});

test('escaping is not specific to fragments', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('[ここ](https://example.com)');
  const { doc, md } = await report(page, 'typed https');

  // Not even the URL inside the parens links: autolink wants a word boundary after it, and the
  // `)` typed immediately behind is not one. The whole thing stays text.
  expect(doc).toBe('doc(paragraph("[ここ](https://example.com)"))');
  expect(md).toContain('\\[');
});

for (const href of ['/posts/foo', '#見出し'] as const) {
  test(`${href} pasted over a selection cannot make an in-site link`, async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, 'ここ\n');
    await setRange(page, 1, 3); // 「ここ」selected

    await page.evaluate((text) => {
      const transfer = new DataTransfer();
      transfer.setData('text/plain', text);
      document
        .querySelector('.ProseMirror')
        ?.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
    }, href);

    const { doc } = await report(page, `pasted ${href}`);
    // linkifyjs finds nothing in either string, so linkOnPaste never fires: the selection is just
    // replaced by the text. Route (d) — an <a> already on the clipboard — is the only one left.
    expect(doc).toBe(`doc(paragraph("${href}"))`);
  });
}
