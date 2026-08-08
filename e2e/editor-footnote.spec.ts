import { test, expect } from '@playwright/test';
import {
  collapseToEnd,
  loadMarkdown,
  selectInside,
  selectNode,
  setRange,
} from './editor-authoring';
import { markdown, docString, caretPos, settle } from './editor-probe';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// Footnotes (docs/footnote-requirements.md), stages 1 and 2 of §11: the markdown round trip, the
// definitions' section and its placement, both insertion routes, numbering, pairing, the placement
// guards and the clipboard rules.
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
  const { first, doc } = await roundTrip(page, '本文\n\n[^x]: 消えては困る注釈\n');

  expect(doc).toBe(
    'doc(paragraph("本文"), footnoteSection(footnoteDefinition("消えては困る注釈")))',
  );
  expect(first).toContain('[^x]: 消えては困る注釈');
});

test('an orphan definition survives in the company of a real one', async ({ page }) => {
  // The case the test above cannot see, and the one that was broken: with no referenced footnote
  // the tail emits no section wrapper, ProseMirror supplies the missing section itself, and the
  // orphan lands inside it by luck. Add one ordinary footnote and the wrapper exists — a rescued
  // definition appended after it is outside the only node that may hold it, and is dropped.
  // Measured as the note's words disappearing from both the document and the saved markdown.
  const { first, doc } = await roundTrip(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 孤児の注\n');

  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("A の注"), footnoteDefinition("孤児の注")))',
  );
  expect(first).toContain('[^a]: A の注');
  expect(first).toContain('[^x]: 孤児の注');
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
  // And the definitions arrive in that order too, which is the one case in this suite where the
  // file's order and the references' disagree. It answers whether a post saved before §3's sort
  // existed opens looking right: markdown-it-footnote's tail walks `env.footnotes.list`, which is
  // indexed by reference, so the parser hands over reference order whatever the file said. Nothing
  // has to heal on load — which is as well, since the real editor takes its content through
  // `useEditor({ content })` rather than a transaction, and no appended transaction runs there.
  expect(await definitionNumbers(page)).toEqual(['1', '2']);
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("B の注"), footnoteDefinition("A の注"))',
  );
  // The labels are untouched by the renumbering (§4.1).
  const saved = await markdown(page);
  expect(saved).toContain('[^b] と [^a]');
  expect(saved).toContain('[^a]: A の注');
});

// -----------------------------------------------------------------------------------------------
// The definitions' order (§3 — "並び順は本文中の参照順で自動整列する")
// -----------------------------------------------------------------------------------------------

// The half of §3 that shipped unmeasured. None of the 21 acceptance criteria named the definitions'
// *order* — criterion 3 asks only that the numbers are redealt — so the section was free to keep
// them in the order they happened to be created, and did: a footnote added between two others put
// its definition at the end, and the column read [1], [3], [2]. The published page never showed it,
// because remark-gfm rebuilds the section from reference order when it renders; the editor and the
// saved markdown were the two that disagreed with the reader.
//
// Read top to bottom, so the assertion is what the author sees rather than what the document says.
function definitionNumbers(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator('.ProseMirror div[data-footnote-def]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-number') ?? ''));
}

test('a footnote added between two others lands between their definitions', async ({ page }) => {
  await loadMarkdown(page, '文A[^a]と文B[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await page.locator('.ProseMirror').click();
  await settle(page);
  // Between the two references — after 文A[^a]と文.
  await setRange(page, 6);
  await page.keyboard.type('[^');

  expect(await numbers(page)).toEqual(['1', '2', '3']);
  expect(await definitionNumbers(page)).toEqual(['1', '2', '3']);
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition, footnoteDefinition("注B"))',
  );
  // What is saved follows too, so a reopened post does not have to be re-sorted to look right.
  const saved = await markdown(page);
  expect(saved.indexOf('[^a]: 注A')).toBeLessThan(saved.indexOf('[^b]: 注B'));
});

test('Backspace still takes back a [^ typed between two footnotes', async ({ page }) => {
  // Criterion 8, on the branch it never covered: the existing case types into an empty document, so
  // it builds the section rather than inserting into one, and the ordered insert only touches the
  // second. The reason it has to stay inside the input rule's own transaction is here — footnotePairing
  // stands down while an input rule is undoable (any appended transaction clears the record
  // undoInputRule needs, §9.1), so a definition sorted from an append would sit in the wrong place
  // until the author's next keystroke, and appending anyway would cost this Backspace instead.
  //
  // Typed rather than loaded: setContent is a single history event, so one undo over a loaded
  // document takes the document.
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('文A[^');
  await page.keyboard.type('と文B[^');
  await setRange(page, 6);
  await page.keyboard.type('[^');
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition, footnoteDefinition, footnoteDefinition)',
  );

  await page.keyboard.press('Backspace');

  // The characters are back where they were typed, and the third definition left with them.
  expect(await docString(page)).toBe(
    'doc(paragraph("文A", footnoteReference, "と文[^B", footnoteReference), footnoteSection(footnoteDefinition, footnoteDefinition))',
  );
});

test('a definition materialized by a paste sorts to its reference', async ({ page }) => {
  // The other route into the section, and the one the reconciliation has to answer: a pasted
  // reference gets its definition back from what it carried (§6.1), appended at the end because
  // that is where materializing puts it. Landing the reference *before* an existing one is what
  // makes the appended definition wrong, and nothing in the insertion path is involved.
  await loadMarkdown(page, '文A[^a]\n\n文B[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  // The click is for focus — the clipboard keys need it — and the settle keeps the caret it places
  // from reaching state.selection after the selection made below (see selectFirstParagraph).
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await selectNode(page, 'paragraph');
  await page.keyboard.press('Control+x');
  await settle(page);
  // Cutting the reference took its definition with it (§5.1), so 注B is alone now.
  expect(await docString(page)).toBe(
    'doc(paragraph("文B", footnoteReference), footnoteSection(footnoteDefinition("注B")))',
  );

  await setRange(page, 1);
  await settle(page);
  await page.keyboard.press('Control+v');
  await settle(page);

  // 文A is back in front of 文B, so its note belongs in front of 注B — even though the paste put it
  // at the end a moment ago.
  expect(await numbers(page)).toEqual(['1', '2']);
  expect(await definitionNumbers(page)).toEqual(['1', '2']);
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition("注B"))',
  );
});

// Put the caret at the end of the first definition. The click is what focuses the editor, and the
// settle after it is not optional — a caret placed by clicking reaches state.selection ~20ms late.
async function caretAtEndOfFirstDefinition(page: import('@playwright/test').Page) {
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  await page.keyboard.press('End');
  await settle(page);
}

test('Enter in a definition breaks the line instead of splitting the note', async ({ page }) => {
  // A split copies the attributes, so both halves kept the same label: a second definition carrying
  // the same number, and a second `[^a]:` line in the markdown. Measured before the fix — the column
  // read [1], [1], [2].
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('続き');

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A", hardBreak, "続き"), footnoteDefinition("注B"))',
  );
  expect(await definitionNumbers(page)).toEqual(['1', '2']);
});

test('a line broken inside a definition survives the round trip', async ({ page }) => {
  // Why a hard break is the right answer and not merely a safe one: the shape already round-trips,
  // because Shift+Enter has always been able to make it. Enter only routes a third key to it.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('二行目');

  const saved = await markdown(page);
  // One definition line for one label — the duplicate is what destroyed the note, since
  // markdown-it's footnote_def keeps the last `[^a]:` it sees and drops what came before.
  expect(saved.match(/\[\^a\]:/g)).toHaveLength(1);
  await loadMarkdown(page, saved);
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("注A", hardBreak, "二行目")))',
  );
});

test('Enter in the middle of a definition keeps the words before the caret', async ({ page }) => {
  // The case that lost text rather than merely looking wrong: split mid-note, the second `[^a]:`
  // line won on reload and "注釈" was gone.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注釈テキスト\n');
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await page.keyboard.press('Enter');

  const saved = await markdown(page);
  expect(saved).toContain('注釈');
  expect(saved).toContain('テキスト');
  await loadMarkdown(page, saved);
  expect(await docString(page)).toContain('注釈');
  expect(await docString(page)).toContain('テキスト');
});

test('Enter outside a definition still splits the block', async ({ page }) => {
  // The binding is document-wide, so it has to decline everything that is not a definition — a
  // swallowed Enter in the prose would be a far worse bug than the one being fixed.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('次の段落');

  expect(await docString(page)).toContain(
    'doc(paragraph("本文", footnoteReference), paragraph("次の段落")',
  );
});

// The Enter split's mirror image (§5.1). A join keeps one label and drops the other, so the second
// note's words are filed under the first note's label and the second reference is left empty —
// measured, `[^a]: 注A` + `[^b]: 注B` became `[^a]: 注A注B` with `[^b]` unpublishable. Backspace at
// the *first* definition happened not to join, but only because the section is isolating; the rule
// was nowhere.
test('Backspace at the start of a definition refuses instead of joining', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await page.locator('.ProseMirror div[data-footnote-def]').nth(1).click();
  await settle(page);
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition("注B"))',
  );
  await expect(page.getByText(/本文中の参照を削除/)).toBeVisible();
});

test('Delete at the end of a definition does not pull the next one in', async ({ page }) => {
  // The same join reached from the other side. Fixing only Backspace would leave the defect one key
  // away, which is the shape §6 keeps warning about.
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Delete');

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition("注B"))',
  );
  await expect(page.getByText(/本文中の参照を削除/)).toBeVisible();
});

test('Backspace in an emptied definition says where to go', async ({ page }) => {
  // §5.2 keeps the emptied definition and marks its reference; the author is then standing in an
  // empty note with a key that did nothing and said nothing. A refused gesture changes no document,
  // so without the notice it cannot be told from a broken key.
  //
  // Not "delete the footnote now that it is empty": the reference is elsewhere in the prose, and
  // Backspace repeats — clearing a note by holding the key would run straight past empty.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await docString(page)).toContain('footnoteSection(footnoteDefinition)');

  await page.keyboard.press('Backspace');

  // Still there, still the author's to fill in or to remove from the prose.
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
  );
  await expect(page.getByText(/本文中の参照を削除/)).toBeVisible();
});

test('Backspace and Delete inside a definition still edit the text', async ({ page }) => {
  // The refusal is the two edges only. Taking the whole key would be a worse bug than the join.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注釈\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Backspace');
  expect(await docString(page)).toContain('footnoteDefinition("注")');

  // Home moves the *DOM* selection, which reaches state.selection a debounce later — without this
  // the Delete below is handed the caret from before it, still at the end, where the edge guard
  // refuses. Measured as this test failing intermittently.
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Delete');
  expect(await docString(page)).toContain('footnoteSection(footnoteDefinition)');
});

// Positions inside the first and second definitions, read off the document rather than written
// down: a range whose whole point is the edge it spans cannot afford a literal that drifts when the
// fixture changes.
function acrossDefinitions(
  page: import('@playwright/test').Page,
  fromOffset: number,
  toOffset: number,
): Promise<{ from: number; to: number }> {
  return page.evaluate(
    (offsets) => {
      const el = document.querySelector('.ProseMirror') as unknown as {
        editor: { state: { doc: { descendants(f: (node: unknown, pos: number) => void): void } } };
      };
      const starts: number[] = [];
      el.editor.state.doc.descendants((node, pos) => {
        if ((node as { type: { name: string } }).type.name === 'footnoteDefinition') {
          starts.push(pos + 1);
        }
      });
      return { from: starts[0] + offsets.from, to: starts[1] + offsets.to };
    },
    { from: fromOffset, to: toOffset },
  );
}

// The gesture the edge keymap above cannot see. `isolating` on the definition is what answers it:
// isolating-boundary.ts already clamps a ranged replacement at all seven entry points off that flag,
// so the definitions become two of the nodes it protects rather than growing a rule of their own.
// Measured before the flag: the two notes merged into `footnoteDefinition("注")` and `[^b]` lost its
// definition node outright.
test('a range spanning two definitions deletes inside each, not across', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  const { from, to } = await acrossDefinitions(page, 1, 1);
  await setRange(page, from, to);
  await settle(page);
  await page.keyboard.press('Backspace');

  // Both notes still exist and still hold their own labels; only the selected characters went.
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注"), footnoteDefinition("B"))',
  );
  const saved = await markdown(page);
  expect(saved).toContain('[^a]: 注');
  expect(saved).toContain('[^b]: B');
});

test('typing over a range spanning two definitions keeps both', async ({ page }) => {
  // handleTextInput is a separate entry point from the Backspace one, and the clamp covers it — a
  // single character over a boundary-spanning selection was one of the shapes that corrupted the
  // callout and the code block.
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  const { from, to } = await acrossDefinitions(page, 1, 1);
  await setRange(page, from, to);
  await settle(page);
  await page.keyboard.type('X');

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注X"), footnoteDefinition("B"))',
  );
});

test('Shift+Enter and Mod+Enter still break the line in a definition', async ({ page }) => {
  // Both were dead the moment the definition became isolating: HardBreak binds them straight to
  // `setHardBreak`, which refuses when the caret's parent is an isolating node. They are routed
  // through the same insertion as Enter, and this is what says so.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('二');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('三');

  expect(await docString(page)).toContain(
    'footnoteDefinition("注A", hardBreak, "二", hardBreak, "三")',
  );
});

test('Backspace outside a definition still joins blocks', async ({ page }) => {
  // Document-wide bindings, so what they decline matters as much as what they take.
  await loadMarkdown(page, '本文[^a]\n\nあとの段落\n\n[^a]: 注A\n');
  await page.locator('.ProseMirror p').nth(1).click();
  await settle(page);
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toContain('paragraph("本文", footnoteReference, "あとの段落")');
});

test('an empty definition says so where the author is standing', async ({ page }) => {
  // §5.2's first layer describes a placeholder here and then argues it is not enough by itself,
  // which is where the reference-side marking came from — but the placeholder itself was never
  // built. Read off the attribute rather than the rendered text: the content is a CSS `::after`,
  // which has no node for Playwright to query.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  const definition = page.locator('.ProseMirror div[data-footnote-def]');
  await expect(definition).not.toHaveAttribute('data-empty', '');

  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(definition).toHaveAttribute('data-empty', '');
  expect(await definition.evaluate((el) => getComputedStyle(el, '::after').content)).toContain(
    '注釈を入力',
  );

  // And it goes the moment there is a note again — it marks a state, not an event.
  await page.keyboard.type('書いた');
  await expect(definition).not.toHaveAttribute('data-empty', '');
});

test('selecting a reference marks the definition it belongs to', async ({ page }) => {
  // Clicking a reference already makes a NodeSelection — it is how a footnote is picked to be
  // deleted (§5.1) — and it said nothing about which of the notes at the end of the document was
  // its own. Shown, not jumped to: moving the caret into the definition would strand the author
  // mid-sentence with no backref to come back by, which is why §5.1 keeps the caret in the prose in
  // the first place.
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  const definitions = page.locator('.ProseMirror div[data-footnote-def]');
  await expect(definitions.nth(0)).not.toHaveAttribute('data-paired', '');

  await page.locator('.ProseMirror sup[data-footnote-ref]').nth(1).click();
  await settle(page);
  await expect(definitions.nth(1)).toHaveAttribute('data-paired', '');
  await expect(definitions.nth(0)).not.toHaveAttribute('data-paired', '');

  // The other reference hands it over rather than adding to it.
  await page.locator('.ProseMirror sup[data-footnote-ref]').nth(0).click();
  await settle(page);
  await expect(definitions.nth(0)).toHaveAttribute('data-paired', '');
  await expect(definitions.nth(1)).not.toHaveAttribute('data-paired', '');
});

test('a caret in the prose does not light the definitions up', async ({ page }) => {
  // A NodeSelection and nothing else. A caret next to a reference is where an author writing prose
  // spends most of its time, and marking on that would be noise rather than an answer — so this is
  // the half that keeps the highlight meaning something.
  await loadMarkdown(page, '本文[^a]のあと\n\n[^a]: 注A\n');
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await page.keyboard.press('End');
  await settle(page);

  await expect(page.locator('.ProseMirror div[data-footnote-def]')).not.toHaveAttribute(
    'data-paired',
    '',
  );
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

// -----------------------------------------------------------------------------------------------
// Placement guards (§6, criterion 7)
// -----------------------------------------------------------------------------------------------

test('a footnote cannot be put in a table cell, and says why', async ({ page }) => {
  // §6: a cell is the one place markdown's pipe form breaks easily, and this editor has already
  // lost a table's pipe form twice to content it could not represent on one line.
  await loadMarkdown(page, '| a | b |\n| - | - |\n| 1 | 2 |\n');
  await page.locator('.ProseMirror td').first().click();

  await page.keyboard.press('Control+Shift+f');
  expect(await docString(page)).not.toContain('footnoteReference');
  await expect(page.getByText(/脚注は.*置けません/)).toBeVisible();
});

test('typing [^ in a table cell leaves the characters alone', async ({ page }) => {
  // The second of criterion 7's two refusal paths. The shortcut and the input rule are separate
  // entry points and a guard on one says nothing about the other.
  await loadMarkdown(page, '| a | b |\n| - | - |\n| 1 | 2 |\n');
  await page.locator('.ProseMirror td').first().click();

  await page.keyboard.type('[^');
  expect(await docString(page)).not.toContain('footnoteReference');
  expect(await docString(page)).toContain('[^');
});

test('a footnote cannot be put in a code block', async ({ page }) => {
  await loadMarkdown(page, '```ts\nconst a = 1;\n```\n');
  await page.locator('.ProseMirror pre').first().click();

  await page.keyboard.press('Control+Shift+f');
  expect(await docString(page)).not.toContain('footnoteReference');
});

// Criterion 7b (§6.5). The accordion's title is the one refusal the schema insists on rather than
// the markdown: `detailsSummary` is `text*`, so with no guard the insertion does not fail — the
// fitter splits the accordion in two to make room for the reference, tearing half the title into the
// body and leaving a spare empty accordion behind. That is what these two pin.
const ACCORDION = '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n';

test('a footnote cannot be put in an accordion title', async ({ page }) => {
  await loadMarkdown(page, ACCORDION);
  await page.locator('.ProseMirror summary').first().click();
  await settle(page);
  await page.keyboard.press('End');

  await page.keyboard.press('Control+Shift+f');

  const doc = await docString(page);
  expect(doc).not.toContain('footnoteReference');
  // The accordion is intact: one of them, title whole, body untouched.
  expect(doc.match(/detailsSummary/g)).toHaveLength(1);
  expect(doc).toContain('detailsSummary("タイトル")');
  expect(doc).toContain('paragraph("本文")');
  await expect(page.getByText(/アコーディオンのタイトル内には置けません/)).toBeVisible();
});

test('typing [^ in an accordion title leaves the characters alone', async ({ page }) => {
  // The input rule is the other entry point, and a guard on the shortcut says nothing about it —
  // the same pairing criterion 7 makes for the table cell.
  await loadMarkdown(page, ACCORDION);
  await page.locator('.ProseMirror summary').first().click();
  await settle(page);
  await page.keyboard.press('End');

  await page.keyboard.type('[^');

  const doc = await docString(page);
  expect(doc).not.toContain('footnoteReference');
  expect(doc).toContain('detailsSummary("タイトル[^")');
});

test('a footnote inside an accordion body keeps its definition at the end of the document', async ({
  page,
}) => {
  // The half that must not be lost to the guard above: the body is `block+` → paragraph →
  // `inline*`, so it takes a reference exactly like a callout's. The guard names `detailsSummary`,
  // never `details`.
  await loadMarkdown(page, ACCORDION);
  // A loaded accordion is folded (§5 of the accordion requirements), and a hidden body cannot be
  // clicked into — the toggle is the only way to open one, since `persist: false` keeps the open
  // state out of the document entirely.
  const body = page.locator('.ProseMirror [data-type="detailsContent"]');
  await page.locator('.ProseMirror [data-type="details"] > button').click();
  await expect(body).toBeVisible();

  await body.locator('p').last().click();
  // Not optional, and this test found out the hard way — it failed only under the load of the whole
  // spec, exactly as the clipboard helper below documents. A caret placed by clicking reaches
  // `state.selection` ~20ms late, so the shortcut was still being asked about the *stale* selection,
  // which after a load sits at the top of the document — inside the title. The refusal added above
  // then answered correctly for a place the author had already left.
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+f');

  const doc = await docString(page);
  expect(doc).toContain('footnoteReference');
  expect(doc).toMatch(/footnoteSection\(footnoteDefinition\)\)$/);
});

test('a footnote inside a callout keeps its definition at the end of the document', async ({
  page,
}) => {
  // §6 allows it: a callout is part of the prose. Criterion 13.
  await loadMarkdown(page, '> [!NOTE]\n> 注意書き\n');
  await page.locator('.ProseMirror div[data-callout] p:not(.markdown-alert-title)').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+f');

  const doc = await docString(page);
  expect(doc).toContain('footnoteReference');
  // The definition is outside the callout, in the section at the end of the document.
  expect(doc).toMatch(/footnoteSection\(footnoteDefinition\)\)$/);
});

// -----------------------------------------------------------------------------------------------
// The clipboard (§6.1–§6.4, criteria 16–18)
// -----------------------------------------------------------------------------------------------

// Select the first paragraph whole, so the copy carries the reference inside it.
//
// The click is only for focus — the clipboard keys need it — and the settle after it is not
// optional: a caret placed by clicking reaches state.selection ~20ms late (ProseMirror's
// DOMObserver.flushSoon), and a pending flush would otherwise overwrite the selection made below.
//
// The selection itself goes through the command rather than Home+Shift+End, and that is the point.
// Those keys move the *DOM* selection, which reaches state.selection a debounce later, so a
// Control+c pressed inside that window is handed the stale one: ProseMirror builds an empty slice,
// declines the copy, and the browser's native handler puts the DOM selection on the clipboard as
// plain text. The paste then lands `本文[^a]` as literal characters and the footnote is simply gone.
// Measured 2026-08-05 from a full-suite trace — 5ms between Shift+End and Control+c — where it
// passed alone and on retry and failed only under the load of the whole suite.
async function selectFirstParagraph(page: import('@playwright/test').Page) {
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await selectInside(page, 'paragraph');
}

test('duplicating a paragraph duplicates its footnote', async ({ page }) => {
  // Criterion 16. Definitions live at the end of the document, so a copied paragraph carries none —
  // the note rides on the reference instead (§6.1), and the label is minted fresh because the
  // carried one is still in use (§6.2).
  await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  // The clipboard write is asynchronous; pasting straight after it can read what was there before.
  await settle(page);
  // Not End: the same debounce would leave Enter looking at the selection just copied, and Enter
  // replaces a ranged selection — the paragraph, its reference and the whole definition section go.
  await collapseToEnd(page);
  await page.keyboard.press('Enter');
  await settle(page);
  await page.keyboard.press('Control+v');

  const saved = await markdown(page);
  // Two references, two definitions, and the note's words on both.
  expect(saved.match(/\[\^[^\]]+\]: A の注/g)).toHaveLength(2);
  expect(await docString(page)).toMatch(
    /footnoteDefinition\("A の注"\), footnoteDefinition\("A の注"\)/,
  );
});

test('cutting and pasting a paragraph keeps the note and the label', async ({ page }) => {
  // Criterion 17. The cut takes the definition with the reference (§5.1); the paste puts it back
  // from what the reference carried, and the label is free again so it is reused (§6.2) — a
  // footnote that only moved must not look like a different one in the diff.
  await loadMarkdown(page, '本文[^keepme]\n\nあと\n\n[^keepme]: 消えない注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+x');
  await settle(page);
  await page.keyboard.press('Control+v');

  const saved = await markdown(page);
  expect(saved).toContain('[^keepme]');
  expect(saved).toContain('[^keepme]: 消えない注');
});

test('pasting a footnote into a table cell leaves no definition behind', async ({ page }) => {
  // Criterion 18, and the collision §6.3 exists to prevent: the reference falls to plain text, and
  // the note it was carrying is discarded rather than materialized — a definition with nothing
  // pointing at it would otherwise be read as an orphan worth keeping (§5.4).
  await loadMarkdown(page, '本文[^a]\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n[^a]: A の注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  await settle(page);
  await page.locator('.ProseMirror td').first().click();
  // A caret placed by clicking reaches state.selection ~20ms late, and pasting inside that window
  // pastes over the *old* selection — measured here as the copy landing back on its own paragraph.
  // The same lag has produced a real bug in this editor before.
  await settle(page);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  // Exactly the one definition the document started with.
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  // The reference fell to plain text inside the cell rather than staying a node.
  expect(doc).not.toMatch(/tableCell\([^)]*footnoteReference/);
});

test('pasting a footnote into an accordion title leaves the accordion whole', async ({ page }) => {
  // §6.5's paste half, and the reason it needs a hook of its own. Every other refused destination is
  // repaired *after* the slice lands, which works because the reference lands there; a `text*` title
  // never holds one, so the fitter tears the accordion apart to place it and the repair — which asks
  // about the reference's position — finds an ordinary paragraph and answers nothing. Measured
  // before the guard: two accordions, half the title in the body.
  await loadMarkdown(page, `本文[^a]です\n\n${ACCORDION}\n[^a]: A の注\n`);
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  await settle(page);
  await page.locator('.ProseMirror summary').first().click();
  await page.keyboard.press('End');
  // The click's caret reaches state.selection ~20ms late; pasting inside that window pastes over the
  // selection just copied.
  await settle(page);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  // One accordion, still whole, with the pasted words in its title as plain text.
  expect(doc.match(/detailsSummary/g)).toHaveLength(1);
  expect(doc).toContain('detailsSummary("タイトル本文[^a]です")');
  expect(doc).toContain('detailsContent(paragraph("本文"))');
  // The reference did not become a node there, and no second definition was minted for it.
  expect(doc).not.toMatch(/detailsContent\([^)]*footnoteReference/);
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  await expect(page.getByText(/アコーディオンのタイトル内には置けません/)).toBeVisible();
});

// -----------------------------------------------------------------------------------------------
// The orphan notice (§5.4)
// -----------------------------------------------------------------------------------------------

test('loading a document with an orphan definition says so', async ({ page }) => {
  // §5.4: the definition is kept, and the author is told. Kept silently it would be
  // indistinguishable from a bug — the note is in the document, marked `[?]`, with no reason given.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 参照のない注\n');

  await expect(page.getByText(/参照されていない脚注が 1 件/)).toBeVisible();
  // Kept, not deleted, and marked as having no number to carry.
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(1);
});

test('the orphan notice does not return on every keystroke', async ({ page }) => {
  // The document holding an orphan is a state, not an event. Reporting it per transaction would
  // put a toast over the text while the author types.
  await loadMarkdown(page, '本文\n\n[^x]: 参照のない注\n');
  await expect(page.getByText(/参照されていない脚注が/)).toBeVisible();

  // Outlast the toast, then type.
  await expect(page.getByText(/参照されていない脚注が/)).toBeHidden({ timeout: 10_000 });
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await page.keyboard.type('あいうえお');

  await expect(page.getByText(/参照されていない脚注が/)).toBeHidden();
});

// -----------------------------------------------------------------------------------------------
// Criterion 14 — dragging a footnote across a boundary (§6.4)
// -----------------------------------------------------------------------------------------------
//
// §6.4 reasons that drops need no rule of their own: prosemirror-view runs transformPasted over the
// dragged slice, so paste and drop answer through one path. That is read off the source; these
// measure it. handleDrop fires on the *native* drop event, which the ordinary mouse API cannot
// produce — see e2e/native-drag.ts for the CDP machinery.

test('dragging a footnote into ordinary prose leaves no orphan behind', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]です\n\n移動先の段落\n\n[^a]: A の注\n');

  const source = page.locator('.ProseMirror p').first();
  const target = page.locator('.ProseMirror p').nth(1);
  const origin = await dragSelect(page, await caretPoint(source, 0), await caretPoint(source, 4));
  await cdpNativeDrag(page, origin, await caretPoint(target, 3));

  const doc = await docString(page);
  // One footnote before, one after: a move must not mint a second definition, and the one that
  // existed must not be left pointing at nothing.
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(0);
  // A footnote that only moved is the same footnote (§6.2).
  expect(await markdown(page)).toContain('[^a]: A の注');
});

test('dragging a footnote into a table cell leaves no orphan behind', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]です\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n[^a]: A の注\n');

  const source = page.locator('.ProseMirror p').first();
  const origin = await dragSelect(page, await caretPoint(source, 0), await caretPoint(source, 4));
  await cdpNativeDrag(page, origin, await caretPoint(page.locator('.ProseMirror td').first(), 1));

  // The drop is refused outright, which is the only answer that loses nothing: a drop moves, so
  // repairing it at the destination would delete the source and leave the note an orphan.
  const doc = await docString(page);
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(0);
  expect(doc).not.toMatch(/tableCell\([^)]*footnoteReference/);
  // Nothing moved: the reference is still where it was, and the author is told why.
  expect(doc).toMatch(/paragraph\("本文", footnoteReference, "です"\)/);
  await expect(page.getByText(/表のセル内には置けません/)).toBeVisible();
});

test('dragging a footnote into an accordion title leaves the accordion whole', async ({ page }) => {
  // The third route into §6.5's title, and the one that could not be settled by reading: whether
  // `posAtCoords` over a `<summary>` resolves *inside* the summary node is a browser fact, and the
  // refusal is worthless if it does not. Criterion 14 already cost this spec that lesson once.
  //
  // Unlike the paste, this is refused outright rather than degraded — a drop moves, so falling to
  // plain text at the destination would delete the source and orphan the note (§6.3).
  await loadMarkdown(page, `本文[^a]です\n\n${ACCORDION}\n[^a]: A の注\n`);

  const source = page.locator('.ProseMirror p').first();
  const origin = await dragSelect(page, await caretPoint(source, 0), await caretPoint(source, 4));
  await cdpNativeDrag(page, origin, await caretPoint(page.locator('.ProseMirror summary'), 3));

  const doc = await docString(page);
  expect(doc.match(/detailsSummary/g)).toHaveLength(1);
  expect(doc).toContain('detailsSummary("タイトル")');
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(0);
  // Nothing moved, and the author is told why.
  expect(doc).toMatch(/paragraph\("本文", footnoteReference, "です"\)/);
  await expect(page.getByText(/アコーディオンのタイトル内には置けません/)).toBeVisible();
});
