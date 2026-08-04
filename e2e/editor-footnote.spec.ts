import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown, docString, caretPos } from './editor-probe';

// Footnotes (docs/footnote-requirements.md), stage 1 of §11: the markdown round trip, the
// definitions' section and its placement, both insertion routes, numbering, and pairing.
//
// The round-trip half comes first because it is the half that loses an author's work. Neither
// tiptap-markdown nor prosemirror-markdown carries any footnote handling, so both directions are
// written by hand and either could drop text.
//
// This supersedes editor-footnote-literal.spec.ts, which pinned the opposite contract — that
// `[^1]` stays literal text — and whose history belongs here. Measured 2026-08-02, fixed
// 2026-08-03: a definition line is shaped like a markdown link reference definition, so
// markdown-it's `reference` rule consumed it without emitting a token and the body's `[^1]`
// resolved against it into `<a href="注釈テキスト">^1</a>`. The note's words left the document
// entirely and came back as a URL. Footnotes were then deliberately left unsupported and the words
// merely kept as text; this spike is the reversal, so the same input now has to produce nodes.
// The guard that stood in between is still registered and is now unreachable — see
// footnote-literal-extension.ts and §7.2.

// Load, read back what would be saved, then load that and read again. A feature that round-trips
// reaches a fixed point on the second pass; one that merely survives once does not.
async function roundTrip(page: import('@playwright/test').Page, source: string) {
  await loadMarkdown(page, source);
  const first = await markdown(page);
  const doc = await docString(page);
  await loadMarkdown(page, first);
  return { first, second: await markdown(page), doc };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
});

test('a footnote round-trips as GFM syntax', async ({ page }) => {
  const { first, second, doc } = await roundTrip(page, '本文[^1]\n\n[^1]: 注釈テキスト\n');

  // Both halves are real nodes now, not the literal text the guard used to leave behind, and the
  // definition lives in the section the schema pins to the end of the document (§3, §3.2). No
  // trailing paragraph: the last node *before* the section is already one, which is the whole of
  // §3.1's change to TrailingNode.
  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("注釈テキスト")))',
  );
  // The note's text is in the document, and the syntax is unescaped GFM — the whole point.
  expect(first).toContain('[^1]: 注釈テキスト');
  expect(first).toContain('本文[^1]');
  expect(first).not.toContain('\\[');
  expect(second).toBe(first);
});

test('a generated label survives the round trip unchanged', async ({ page }) => {
  // §4.1: a label is never rewritten once it exists. The default renderer drops it — `[^fn-a3f]`
  // becomes `id="fn1"` — so this is what the replaced renderer rules buy.
  const { first, second } = await roundTrip(page, '本文[^fn-a3f]\n\n[^fn-a3f]: 注釈\n');

  expect(first).toContain('[^fn-a3f]');
  expect(first).toContain('[^fn-a3f]: 注釈');
  expect(second).toBe(first);
});

test('two footnotes keep their own labels and text', async ({ page }) => {
  const { first, second } = await roundTrip(page, '[^b] と [^a]\n\n[^a]: A の注\n\n[^b]: B の注\n');

  expect(first).toContain('[^a]: A の注');
  expect(first).toContain('[^b]: B の注');
  expect(second).toBe(first);
});

test('a footnote at the end of the document round-trips', async ({ page }) => {
  // The definition section is designed to sit at the document's end (§3), so this is the shape
  // every footnote eventually takes.
  const { first, second } = await roundTrip(page, '# 見出し\n\n本文[^1]\n\n[^1]: 注釈\n');

  expect(first).toContain('[^1]: 注釈');
  expect(second).toBe(first);
});

test('an empty definition does not orphan its reference', async ({ page }) => {
  // §5.3 asserts an empty definition "may not survive the round trip", which is the premise the
  // publish-time check was built on. Measured here rather than assumed.
  const { first, second, doc } = await roundTrip(page, '本文[^x]\n\n[^x]:\n');

  expect(doc).toContain('footnoteReference');
  expect(first).toContain('[^x]');
  expect(second).toBe(first);
});

test('an inline ^[note] becomes an ordinary footnote rather than vanishing', async ({ page }) => {
  // §1 lists `^[…]` as a non-goal, but the plugin parses it the moment it is installed. What
  // happens to the author's words is the question — this pins the answer.
  const { first, second } = await roundTrip(page, '本文^[インライン注]\n');

  expect(first).toContain('インライン注');
  expect(second).toBe(first);
});

test('an orphan definition keeps its text', async ({ page }) => {
  // §5.4 says an orphan definition is kept and reported. markdown-it-footnote's tail drops it
  // instead — the definition tokens are filtered out of the stream and never re-emitted when no
  // reference claimed them. If this fails, installing the plugin makes a real case *worse* than
  // the literal-text guard it replaces.
  const { first } = await roundTrip(page, '本文\n\n[^x]: 消えては困る注釈\n');

  expect(first).toContain('消えては困る注釈');
});

// §3.1 / §3.2 — the definitions' section is pinned last, and TrailingNode has to answer around it.
// Both halves are needed: read naively the paragraph lands *below* the definitions, and answered
// with "do nothing when the section is last" a table sits against the section with nowhere below
// it to put the caret.
test('a block against the definition section still gets a paragraph above it', async ({ page }) => {
  // The table has to be the last thing *before* the section for the question to arise at all.
  await loadMarkdown(page, '本文[^1]\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[^1]: 注釈\n');

  const doc = await docString(page);
  // An empty paragraph between the table and the section — somewhere to put the caret below the
  // table — and the section is still the document's last child.
  expect(doc).toContain('), paragraph, footnoteSection(');
  expect(doc.endsWith('footnoteSection(footnoteDefinition("注釈")))')).toBe(true);
});

test('nothing can be placed after the definition section', async ({ page }) => {
  await loadMarkdown(page, '本文[^1]\n\n[^1]: 注釈\n');

  // The content expression is `block+ footnoteSection?` (§3.2), so a block aimed past the section
  // has nowhere to land there. Driven through the editor's own command rather than asked of the
  // schema, because what matters is that the *gesture* cannot put content below the footnotes.
  await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & {
          editor?: {
            state: { doc: { content: { size: number } } };
            commands: { insertContentAt(position: number, value: string): boolean };
          };
        })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    el.editor.commands.insertContentAt(el.editor.state.doc.content.size, '<p>あと</p>');
  });

  // Whatever ProseMirror did with it, the section is still the document's last child.
  expect(await docString(page)).toMatch(/footnoteSection\(footnoteDefinition\("注釈"\)\)\)$/);
});

// -----------------------------------------------------------------------------------------------
// Insertion, numbering and pairing (§4, §5.1, §9)
// -----------------------------------------------------------------------------------------------

// The numbers are decorations, not attributes (§4), so they are read off the DOM rather than the
// document — which is exactly the property being checked: renumbering must not touch what is saved.
function numbers(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('.ProseMirror sup[data-footnote-ref]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-number') ?? ''));
}

test('Mod-Shift-F inserts a reference and leaves the caret in the prose', async ({ page }) => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('本文');
  await page.keyboard.press('Control+Shift+f');

  // A reference in the prose and an empty definition in the section, from one gesture.
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
  );
  // §5.1: the caret stays where the author was writing — right after the reference.
  expect(await caretPos(page)).toBe(4);
  // Still typing prose, not the note.
  await page.keyboard.type('の続き');
  expect(await docString(page)).toContain('paragraph("本文", footnoteReference, "の続き")');
});

test('typing [^ inserts a reference', async ({ page }) => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('本文[^');

  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
  );
});

test('undo takes back a [^ typed at the end of the document', async ({ page }) => {
  // §10's criterion 8, and Backspace is the key that means it: TipTap binds `undoInputRule` there,
  // so this is the "put back what I typed" path, not history's. The definition section is the
  // document's last child by design, which is exactly the shape the TrailingNode/undoInputRule trap
  // lived in — worth pinning now that footnotes actually reach it.
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('本文[^');
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toBe('doc(paragraph("本文[^"))');
});

test('deleting a reference deletes its definition, and one undo restores both', async ({
  page,
}) => {
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('本文');
  await page.keyboard.press('Control+Shift+f');
  await page.keyboard.press('Backspace');

  // §5.1: the definition goes with the reference, and the empty section goes with it.
  expect(await docString(page)).toBe('doc(paragraph("本文"))');

  await page.keyboard.press('Control+z');
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
  );
});

test('numbers follow document order while labels do not move', async ({ page }) => {
  // §4: the number the reader sees is derived from the order of the references; the label stored in
  // the markdown is not. Loading `[^b] と [^a]` is the case where the two disagree.
  await loadMarkdown(page, '[^b] と [^a]\n\n[^a]: A の注\n\n[^b]: B の注\n');

  expect(await numbers(page)).toEqual(['1', '2']);
  // The labels are untouched by the renumbering (§4.1).
  const saved = await markdown(page);
  expect(saved).toContain('[^b] と [^a]');
  expect(saved).toContain('[^a]: A の注');
});

test('a reference with an empty definition is marked in the prose', async ({ page }) => {
  // §5.2's first layer: the unfinished footnote has to be visible from where the author is looking.
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('本文');
  await page.keyboard.press('Control+Shift+f');

  const reference = page.locator('.ProseMirror sup[data-footnote-ref]');
  await expect(reference).toHaveAttribute('data-incomplete', '');

  // Filling the definition clears the mark.
  await page.locator('.ProseMirror div[data-footnote-def]').click();
  await page.keyboard.type('注釈');
  await expect(reference).not.toHaveAttribute('data-incomplete', '');
});
