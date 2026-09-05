import { test, expect, type Page } from '@playwright/test';
import { docString, markdown } from './editor-probe';
import { caretAtStartOf, loadMarkdown, setRange } from './editor-authoring';

// `[text](url)` typed in the editor (docs/link-requirements.md §5.4, components/editor/
// link-input-rule.ts) — and the measurements that motivated it (§2.2.1, §2.2.2, §2.1.1).
//
// The syntax used to be inert twice over: no input rule took it, and text serialization escapes
// `[` and `]` unconditionally (`state.text(escapeHTML(node.text))` in tiptap-markdown.es.js:628 →
// prosemirror-markdown's `esc`), so it was stored as `\[text\](url)` and came back literal from
// every reload. The escape is still there — the link card is built on it — so the rule converts
// while the text is being typed, and that is the only moment it acts: `transformPastedText` is
// false, so a *pasted* `[text](url)` is still literal text.
//
// Half of this file measures what the rule refuses. Those are the cases where applying the mark
// would drop the href without a word, which costs the author the URL and not merely the styling.

const SYNTAX = '[断片](#見出し)';

async function openEditor(page: Page): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
}

// A plain-text paste at the current selection, synthesized rather than driven through the OS
// clipboard so it stays deterministic and needs no permissions.
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
  // The href is stored as it was typed. What comes back after a reload is not this string — see
  // the round-trip test below — but both publish identically (§2.2.2).
  expect(md).toBe(SYNTAX);
  expect(md).not.toContain('\\[');
});

test('the link survives a save and reload, with the href percent-encoded on the way back', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  const stored = await markdown(page);

  // Exactly what reopening the saved post does — same tiptap-markdown parse path.
  await loadMarkdown(page, stored);
  const { doc, md } = await report(page, 'typed → stored → reloaded');

  expect(doc).toBe('doc(paragraph(link("断片")))');
  // Not idempotent as text: markdown-it normalizes the href on the way in, so the readable form the
  // author typed comes back encoded (§2.2.2). Harmless — both forms publish to the identical
  // `#user-content-%E8%A6%8B%E5%87%BA%E3%81%97` (measured through renderMdxToHtml) — but a test
  // asserting `md === stored` here would be asserting something untrue.
  expect(md).toBe('[断片](#%E8%A6%8B%E5%87%BA%E3%81%97)');
});

test('the same syntax loaded UNescaped becomes the same link', async ({ page }) => {
  await openEditor(page);
  // The control that located the fault before the rule existed: markdown-it does parse `[]()`
  // (`linkify: false` only disables bare URLs), so what was broken was the serializer, not the
  // parser. It still holds, and it is what the typing path now agrees with.
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
  // `title` is not in `doc.toString()`, so the markdown is where it shows. Post id 36's one real
  // link has a title and it survives to publish (§2.3) — an author copying that line out of stored
  // markdown and typing it back gets the link it came from.
  expect(md).toBe('[ここ](https://example.com "説明")');
});

test('what is typed after the link does not join it', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  await page.keyboard.type('を見て');

  const { doc, md } = await report(page, 'typed past the link');
  // The link mark is inclusive while `autolink` is on (§4), so without the rule clearing the stored
  // mark the rest of the sentence would be swallowed into the href.
  expect(doc).toBe('doc(paragraph(link("断片"), "を見て"))');
  expect(md).toBe(`${SYNTAX}を見て`);
});

test('Backspace takes the rule back and returns the literal syntax', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type(SYNTAX);
  expect(await docString(page)).toContain('link(');

  await page.keyboard.press('Backspace');
  const { doc } = await report(page, 'undone');
  // `undoInputRule` (bound to Backspace by TipTap's Keymap) restores the characters, closing
  // paren included — the author typed it. The whole document, not `toContain`: nothing may be left
  // over from the mark that was applied.
  expect(doc).toBe(`doc(paragraph("${SYNTAX}"))`);
});

test('image syntax is left to the image rule', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('![猫](/uploads/cat.png)');

  const { doc, md } = await report(page, 'typed image syntax');
  // Not a hypothetical collision: `@tiptap/extension-image` has an input rule of its own for
  // `![alt](src)`, and it is what answers here. The `!` is excluded by a lookbehind rather than a
  // matched `[^!]`, which would have shifted every offset the handler computes by one.
  expect(doc).toBe('doc(paragraph, image)');
  expect(md).toContain('![猫](/uploads/cat.png)');
});

test('a URL used as the link text does not overwrite the href', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('[https://example.com](/posts/foo)');

  const { doc, md } = await report(page, 'typed a URL as the link text');
  // `preventAutolink` on the rule's transaction is what keeps this honest: autolink runs in
  // `appendTransaction` and looks at every transaction in the batch, so without the meta it would
  // reconsider the text just written and put the visible URL in the href.
  expect(doc).toBe('doc(paragraph(link("https://example.com")))');
  expect(md).toBe('[https://example.com](/posts/foo)');
});

test('@[card](url) is a link with an @ in front of it, not a card', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.type('@[card](/posts/f377f7a9a768a5b4d6f2)');

  const { doc, md } = await report(page, 'typed Zenn card syntax');
  // Only `!` is excluded, so the `@` is left where it was typed and the brackets behind it are
  // taken as an ordinary link. This is what docs/link-card-requirements.md §4.1 (b) rejected the
  // syntax for, seen from the other side: a hand-typed `@[card](url)` does not round-trip as what
  // a node would have written, and now it does not even stay literal.
  expect(doc).toBe('doc(paragraph("@", link("card")))');
  expect(md).toBe('@[card](/posts/f377f7a9a768a5b4d6f2)');
});

test('a scheme this site cannot publish is refused, and the text is left intact', async ({
  page,
}) => {
  await openEditor(page);
  await page.keyboard.type('[電話](tel:+81-3-0000-0000)');

  const { doc, md } = await report(page, 'typed tel:');
  // The same gate the paste and bubble routes pass (§2.4.2, §5.5): the rule asks `setLink`, whose
  // `isAllowedUri` PostEditor narrowed to what the public sanitizer will publish. A refusal must
  // leave the typed characters standing — the href included — rather than take the syntax and drop
  // the URL.
  expect(doc).toBe('doc(paragraph("[電話](tel:+81-3-0000-0000)"))');
  expect(md).toContain('tel:+81-3-0000-0000');
});

test('an accordion title refuses the rule instead of losing the href', async ({ page }) => {
  await openEditor(page);
  await loadMarkdown(page, '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n');
  await caretAtStartOf(page, 'detailsSummary');
  await page.keyboard.type(SYNTAX);

  const { doc } = await report(page, 'typed in an accordion title');
  // `detailsSummary` is `text*` with `marks: ''` (docs/accordion-requirements.md §2.3): the mark
  // would be filtered out on the way in and the href would vanish silently. `canSetMark` is what
  // sees this, and it is the same predicate that makes the bubble say so (criterion 4m).
  expect(doc).not.toContain('link(');
  expect(doc).toContain(`detailsSummary("${SYNTAX}タイトル")`);
});

test('inline code keeps the syntax literal', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Control+e');
  await page.keyboard.type(SYNTAX);

  const { doc } = await report(page, 'typed inside inline code');
  // Two answers agree here. TipTap's input-rule runner never asks the rule at all when a
  // neighbouring mark carries `spec.code` — which prosemirror-inputrules on its own does not do, it
  // looks only at the parent node — and the rule's own gate would refuse it anyway, because
  // `code.excludes` covers every mark.
  expect(doc).toBe(`doc(paragraph(code("${SYNTAX}")))`);
});

// The other half of the markdown habit: write the brackets, then bring the URL in from the
// clipboard. It works as long as the closing paren is not typed ahead of the paste — the rule reads
// only the text *before* the caret, so a `)` already sitting after it can never be part of a match.
// Pre-typing `[テキスト]()` and pasting inside is therefore the one order that does not convert, and
// it is left as it is (docs/link-requirements.md §5.4): the paste there already makes a link out of
// the URL itself, so taking it would mean beating that behaviour rather than filling a gap.
//
// These are fixed because they pass today by cooperation, not by design — the URL arrives autolinked
// in the first case and the rule writes over it. A change to the regex or to `preventAutolink` could
// break this without breaking anything else, and the wreck it leaves (an autolinked URL inside
// escaped brackets) is the hard kind to notice.
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
    // linkifyjs finds nothing in either string, so linkOnPaste never fires: the selection is just
    // replaced by the text. Unchanged by §5.4 — the rule is on typing only — and still the reason
    // route (d), an `<a>` already on the clipboard, is the only paste that makes a link.
    expect(doc).toBe(`doc(paragraph("${href}"))`);
  });
}
