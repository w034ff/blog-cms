import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { caretAtStartOf, loadMarkdown, setRange } from './editor-authoring';

// `[text](url)` typed in the editor (docs/link-requirements.md §5.4, link-input-rule.ts; §2.2.1,
// §2.2.2, §2.1.1). Text serialization escapes `[` and `]` (`state.text(escapeHTML(node.text))` in
// tiptap-markdown → prosemirror-markdown's `esc`), and the link card relies on that, so the rule
// converts while typing only: `transformPastedText` is false, so a pasted one stays literal.
// Half this file is refusals, where applying the mark would silently drop the URL.

const SYNTAX = '[断片](#見出し)';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
}

// A synthesized plain-text paste: deterministic, no permissions.
function pasteText(page: Page, text: string): Promise<void> {
  return page.evaluate((value) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', value);
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, text);
}

async function report(page: Page, label: string): Promise<{ doc: string; md: string }> {
  const doc = await docString(page);
  const md = await markdown(page);
  console.log(`[measure] ${label}\n  doc = ${doc}\n  md  = ${JSON.stringify(md)}`);
  return { doc, md };
}

test('typing link syntax makes a link, and the brackets are no longer escaped on save', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);

  const { doc, md } = await report(page, 'typed');
  expect(doc).toBe('doc(paragraph(link("断片")))');
  // Stored as typed; a reload returns another string that publishes the same (§2.2.2).
  expect(md).toBe(SYNTAX);
  expect(md).not.toContain('\\[');
});

test('the link survives a save and reload, with the href percent-encoded on the way back', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  const stored = await markdown(page);

  // As reopening the post does.
  await loadMarkdown(page, stored);
  const { doc, md } = await report(page, 'typed → stored → reloaded');

  expect(doc).toBe('doc(paragraph(link("断片")))');
  // markdown-it encodes the href on the way in (§2.2.2); both forms publish identically, so
  // `md === stored` would be untrue.
  expect(md).toBe('[断片](#%E8%A6%8B%E5%87%BA%E3%81%97)');
});

test('the same syntax loaded UNescaped becomes the same link', async ({ page }) => {
  await openEditor(page);
  // markdown-it parses `[]()` (`linkify: false` only disables bare URLs): the serializer was at fault.
  await loadMarkdown(page, `${SYNTAX}\n`);
  const { doc, md } = await report(page, 'loaded unescaped');

  expect(doc).toBe('doc(paragraph(link("断片")))');
  expect(md).toBe('[断片](#%E8%A6%8B%E5%87%BA%E3%81%97)');
});

test('an external URL is taken the same way', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('[ここ](https://example.com)');
  const { doc, md } = await report(page, 'typed https');

  expect(doc).toBe('doc(paragraph(link("ここ")))');
  expect(md).toBe('[ここ](https://example.com)');
});

test('the title form round-trips, because it is the form the serializer writes', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type('[ここ](https://example.com "説明")');
  const { doc, md } = await report(page, 'typed with title');

  expect(doc).toBe('doc(paragraph(link("ここ")))');
  // `title` shows only in the markdown; a real link has one and it survives to publish (§2.3).
  expect(md).toBe('[ここ](https://example.com "説明")');
});

test('what is typed after the link does not join it', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  await page.keyboard.type('を見て');

  const { doc, md } = await report(page, 'typed past the link');
  // The mark is inclusive with `autolink` (§4), so without clearing it the sentence joins the link.
  expect(doc).toBe('doc(paragraph(link("断片"), "を見て"))');
  expect(md).toBe(`${SYNTAX}を見て`);
});

test('Backspace takes the rule back and returns the literal syntax', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  expect(await docString(page)).toContain('link(');

  await page.keyboard.press('Backspace');
  const { doc } = await report(page, 'undone');
  // `undoInputRule` restores every typed character; the whole document, so nothing is left over.
  expect(doc).toBe(`doc(paragraph("${SYNTAX}"))`);
});

test('image syntax is left to the image rule', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('![猫](/uploads/cat.png)');

  const { doc, md } = await report(page, 'typed image syntax');
  // `@tiptap/extension-image` has its own `![alt](src)` rule. `!` is excluded by a lookbehind, not
  // `[^!]`, which would shift every offset.
  expect(doc).toBe('doc(paragraph, image)');
  expect(md).toContain('![猫](/uploads/cat.png)');
});

test('a URL used as the link text does not overwrite the href', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('[https://example.com](/posts/foo)');

  const { doc, md } = await report(page, 'typed a URL as the link text');
  // `preventAutolink`: autolink's `appendTransaction` would otherwise put the visible URL in the href.
  expect(doc).toBe('doc(paragraph(link("https://example.com")))');
  expect(md).toBe('[https://example.com](/posts/foo)');
});

test('@[card](url) is a link with an @ in front of it, not a card', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('@[card](/posts/f377f7a9a768a5b4d6f2)');

  const { doc, md } = await report(page, 'typed Zenn card syntax');
  // Only `!` is excluded, so `@[card](url)` becomes `@` plus a link: the other side of
  // docs/link-card-requirements.md §4.1 (b)'s rejection.
  expect(doc).toBe('doc(paragraph("@", link("card")))');
  expect(md).toBe('@[card](/posts/f377f7a9a768a5b4d6f2)');
});

test('a scheme this site cannot publish is refused, and the text is left intact', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type('[電話](tel:+81-3-0000-0000)');

  const { doc, md } = await report(page, 'typed tel:');
  // The paste and bubble routes' gate (§2.4.2, §5.5): `setLink`'s narrowed `isAllowedUri`. A refusal
  // keeps the typed characters.
  expect(doc).toBe('doc(paragraph("[電話](tel:+81-3-0000-0000)"))');
  expect(md).toContain('tel:+81-3-0000-0000');
});

test('an accordion title refuses the rule instead of losing the href', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await caretAtStartOf(page, 'detailsSummary');
  await page.keyboard.type(SYNTAX);

  const { doc } = await report(page, 'typed in an accordion title');
  // `detailsSummary` has `marks: ''` (docs/accordion-requirements.md §2.3): `canSetMark` sees it, as
  // the bubble does (criterion 4m).
  expect(doc).not.toContain('link(');
  expect(doc).toContain(`detailsSummary("${SYNTAX}タイトル")`);
});

test('inline code keeps the syntax literal', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+e');
  await page.keyboard.type(SYNTAX);

  const { doc } = await report(page, 'typed inside inline code');
  // TipTap's runner skips rules beside a `spec.code` mark (prosemirror-inputrules checks only the
  // parent), and `code.excludes` would refuse anyway.
  expect(doc).toBe(`doc(paragraph(code("${SYNTAX}")))`);
});

// Brackets typed, URL pasted: works while no `)` is typed ahead, since the rule reads only before
// the caret. Pre-typed `[テキスト]()` is left alone (§5.4). Pinned because it passes by cooperation
// (the autolinked URL is overwritten), and a regex or `preventAutolink` change would break it
// quietly.
for (const url of ['https://example.com', '/posts/foo', '#見出し'] as const) {
  test(`typing "[テキスト](", pasting ${url} and typing ")" makes one link`, async ({ page }) => {
    await openEditor(page);
    await page.keyboard.type('[テキスト](');
    await pasteText(page, url);
    await page.keyboard.type(')');

    const { doc, md } = await report(page, `paste ${url} between the parens`);
    expect(doc).toBe('doc(paragraph(link("テキスト")))');
    expect(md).toBe(`[テキスト](${url})`);
  });
}

for (const href of ['/posts/foo', '#見出し'] as const) {
  test(`${href} pasted over a selection cannot make an in-site link`, async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, 'ここ\n');
    await setRange(page, 1, 3); // 「ここ」selected

    await pasteText(page, href);

    const { doc } = await report(page, `pasted ${href}`);
    // linkifyjs finds nothing, so linkOnPaste does not fire; only a clipboard `<a>` makes a link.
    expect(doc).toBe(`doc(paragraph("${href}"))`);
  });
}
