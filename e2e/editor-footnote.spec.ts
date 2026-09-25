import { test, expect, devices } from '@playwright/test';
import {
  collapseToEnd,
  loadMarkdown,
  selectInside,
  selectNode,
  setRange,
} from './editor-authoring';
import { markdown, docString, caretPos, settle } from './editor-probe';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// Footnotes (docs/footnote-requirements.md), stages 1 and 2 of §11: the round trip, the section and
// its placement, both insertion routes, numbering, pairing, placement guards, the clipboard.
//
// The round trip comes first because it is what loses an author's work: neither tiptap-markdown nor
// prosemirror-markdown handles footnotes, so both directions are hand-written. Without the plugin,
// markdown-it's `reference` rule took a definition line for a link reference definition and the
// note came back as a URL (footnote-literal-extension.ts, §7.2).

// Load, save, load that, save again: a real round trip reaches a fixed point on the second pass.
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

  // Both halves are nodes, the definition in the section pinned last (§3, §3.2). No trailing
  // paragraph: the node before the section is one already (§3.1's TrailingNode change).
  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("注釈テキスト")))',
  );
  // The note's text is in the document as unescaped GFM.
  expect(first).toContain('[^1]: 注釈テキスト');
  expect(first).toContain('本文[^1]');
  expect(first).not.toContain('\\[');
  expect(second).toBe(first);
});

test('a generated label survives the round trip unchanged', async ({ page }) => {
  // §4.1: a label is never rewritten. The default renderer makes `[^fn-a3f]` `id="fn1"`; the
  // replaced renderer rules keep it.
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

test('two references to one note round-trip as a single definition', async ({ page }) => {
  // §6.2: several references to one definition. markdown-it-footnote emits a token per reference
  // and the parse keys on `data-label`, so both find it. The shape the editor now produces.
  const { first, second, doc } = await roundTrip(page, '本文[^a]と再度[^a]\n\n[^a]: A の注\n');

  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference, "と再度", footnoteReference), footnoteSection(footnoteDefinition("A の注")))',
  );
  expect(first).toContain('本文[^a]と再度[^a]');
  // One definition line: both references read [1] whatever the section holds, so count.
  expect(first.match(/\[\^a\]: A の注/g)).toHaveLength(1);
  expect(second).toBe(first);
});

test('a footnote at the end of the document round-trips', async ({ page }) => {
  // The section sits at the document's end (§3), so every footnote ends up this shape.
  const { first, second } = await roundTrip(page, '# 見出し\n\n本文[^1]\n\n[^1]: 注釈\n');

  expect(first).toContain('[^1]: 注釈');
  expect(second).toBe(first);
});

test('an empty definition does not orphan its reference', async ({ page }) => {
  // §5.3's premise for the publish-time check, measured rather than assumed.
  const { first, second, doc } = await roundTrip(page, '本文[^x]\n\n[^x]:\n');

  expect(doc).toContain('footnoteReference');
  expect(first).toContain('[^x]');
  expect(second).toBe(first);
});

test('an inline ^[note] becomes an ordinary footnote rather than vanishing', async ({ page }) => {
  // §1 lists `^[…]` as a non-goal, but the plugin parses it; this pins what happens to the words.
  const { first, second } = await roundTrip(page, '本文^[インライン注]\n');

  expect(first).toContain('インライン注');
  expect(second).toBe(first);
});

test('an orphan definition keeps its text', async ({ page }) => {
  // §5.4 keeps an orphan definition; markdown-it-footnote's tail drops unclaimed definitions.
  const { first, doc } = await roundTrip(page, '本文\n\n[^x]: 消えては困る注釈\n');

  expect(doc).toBe(
    'doc(paragraph("本文"), footnoteSection(footnoteDefinition("消えては困る注釈")))',
  );
  expect(first).toContain('[^x]: 消えては困る注釈');
});

test('an orphan definition survives in the company of a real one', async ({ page }) => {
  // With one referenced footnote the tail emits a section wrapper, and a rescued orphan appended after
  // it lands outside the only node that may hold it and is dropped. Without one, ProseMirror
  // supplies the section and the orphan lands inside by luck.
  const { first, doc } = await roundTrip(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 孤児の注\n');

  expect(doc).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("A の注"), footnoteDefinition("孤児の注")))',
  );
  expect(first).toContain('[^a]: A の注');
  expect(first).toContain('[^x]: 孤児の注');
});

// §3.1 / §3.2: with the section pinned last, TrailingNode must add the paragraph above it, not below,
// and must not give up, which would leave a table with no caret spot below it.
test('a block against the definition section still gets a paragraph above it', async ({ page }) => {
  // The table must be the last thing before the section for the question to arise.
  await loadMarkdown(page, '本文[^1]\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n[^1]: 注釈\n');

  const doc = await docString(page);
  // An empty paragraph between table and section, which stays last.
  expect(doc).toContain('), paragraph, footnoteSection(');
  expect(doc.endsWith('footnoteSection(footnoteDefinition("注釈")))')).toBe(true);
});

test('nothing can be placed after the definition section', async ({ page }) => {
  await loadMarkdown(page, '本文[^1]\n\n[^1]: 注釈\n');

  // `block+ footnoteSection?` (§3.2): through the editor's own command, since the claim is that the
  // gesture cannot put content below the footnotes.
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

  // The section is still last.
  expect(await docString(page)).toMatch(/footnoteSection\(footnoteDefinition\("注釈"\)\)\)$/);
});

// -----------------------------------------------------------------------------------------------
// Insertion, numbering and pairing (§4, §5.1, §9)
// -----------------------------------------------------------------------------------------------

// The numbers are decorations (§4), read off the DOM: renumbering must not touch what is saved.
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

test.describe('on an emulated phone', () => {
  // §9.4, criterion 23: the ＋ drawer's 脚注 row, `hover: none` only. `describe`-scoped Pixel 7 keys
  // only, as in editor-mobile-toolbar.spec.ts: Playwright refuses a whole descriptor here.
  const PIXEL_7 = devices['Pixel 7'];
  test.use({
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: PIXEL_7.deviceScaleFactor,
    isMobile: PIXEL_7.isMobile,
    hasTouch: PIXEL_7.hasTouch,
  });

  test("the ＋ drawer's 脚注 row inserts a reference and leaves the caret in the prose", async ({
    page,
  }) => {
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.keyboard.type('本文');

    await page.getByRole('button', { name: 'ブロックを追加' }).click();
    const panel = page.getByTestId('insert-menu-panel');
    await panel.getByRole('button', { name: '脚注', exact: true }).click();

    // As for Mod-Shift-F: reference and empty definition from one gesture, caret back in the prose.
    expect(await docString(page)).toBe(
      'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
    );
    expect(await caretPos(page)).toBe(4);
    await page.keyboard.type('の続き');
    expect(await docString(page)).toContain('paragraph("本文", footnoteReference, "の続き")');
  });
});

test('undo takes back a [^ typed at the end of the document', async ({ page }) => {
  // §10's criterion 8: Backspace is `undoInputRule`, "put back what I typed", not history. The
  // section being last is the shape the TrailingNode/undoInputRule trap lived in.
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
  // §4: numbers follow reference order, labels do not; `[^b] と [^a]` makes them disagree.
  await loadMarkdown(page, '[^b] と [^a]\n\n[^a]: A の注\n\n[^b]: B の注\n');

  expect(await numbers(page)).toEqual(['1', '2']);
  // Definitions arrive in reference order too: markdown-it-footnote's tail walks `env.footnotes.list`,
  // indexed by reference, so an older post opens sorted. Nothing heals on load, which is as well:
  // `useEditor({ content })` runs no appended transaction.
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

// §3's order, which no criterion named: a footnote added between two others put its definition at
// the end ([1], [3], [2]), while the published page, rebuilt by remark-gfm, looked right. Read top
// to bottom, as the author sees it.
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
  // Criterion 8 on the insert-into-an-existing-section branch. The ordered insert stays in the input
  // rule's own transaction: footnotePairing stands down while an input rule is undoable (an appended
  // transaction clears undoInputRule's record, §9.1). Typed, not loaded: one undo over a loaded
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

  // The characters are back, and the third definition left with them.
  expect(await docString(page)).toBe(
    'doc(paragraph("文A", footnoteReference, "と文[^B", footnoteReference), footnoteSection(footnoteDefinition, footnoteDefinition))',
  );
});

test('a definition materialized by a paste sorts to its reference', async ({ page }) => {
  // A pasted reference gets its definition back from what it carried (§6.1), appended at the end;
  // landing before an existing reference makes that order wrong.
  await loadMarkdown(page, '文A[^a]\n\n文B[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  // The click focuses (the clipboard keys need it); settle so its caret does not land after the
  // selection below (see selectFirstParagraph).
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await selectNode(page, 'paragraph');
  await page.keyboard.press('Control+x');
  await settle(page);
  // The cut took its definition (§5.1); 注B is alone.
  expect(await docString(page)).toBe(
    'doc(paragraph("文B", footnoteReference), footnoteSection(footnoteDefinition("注B")))',
  );

  await setRange(page, 1);
  await settle(page);
  await page.keyboard.press('Control+v');
  await settle(page);

  // 文A is before 文B again, so its note goes before 注B, though the paste appended it.
  expect(await numbers(page)).toEqual(['1', '2']);
  expect(await definitionNumbers(page)).toEqual(['1', '2']);
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition("注B"))',
  );
});

// The click focuses; settle, since a clicked caret reaches state ~20ms late.
async function caretAtEndOfFirstDefinition(page: import('@playwright/test').Page) {
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  await page.keyboard.press('End');
  await settle(page);
}

test('Enter in a definition breaks the line instead of splitting the note', async ({ page }) => {
  // A split copied the label to both halves: a duplicate number and a second `[^a]:` line.
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
  // A hard break already round-trips, since Shift+Enter makes it; Enter just routes to it.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('二行目');

  const saved = await markdown(page);
  // One line per label: markdown-it keeps the last `[^a]:` and drops earlier ones.
  expect(saved.match(/\[\^a\]:/g)).toHaveLength(1);
  await loadMarkdown(page, saved);
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition("注A", hardBreak, "二行目")))',
  );
});

test('Enter in the middle of a definition keeps the words before the caret', async ({ page }) => {
  // Split mid-note, the second `[^a]:` won on reload and "注釈" was lost.
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
  // Document-wide binding, so it must decline outside definitions.
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

// The mirror of the Enter split (§5.1): a join keeps one label, so the second note's words move
// under the first and the second reference is left empty.
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
  // The same join from the other side (Delete).
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Delete');

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注A"), footnoteDefinition("注B"))',
  );
  await expect(page.getByText(/本文中の参照を削除/)).toBeVisible();
});

test('Backspace in an emptied definition says where to go', async ({ page }) => {
  // §5.2 keeps an emptied definition, so Backspace there refuses, and says so: a refused gesture
  // changes nothing and would look like a broken key. Not "delete the empty footnote": Backspace
  // repeats, and holding it would run past empty.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注A\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  expect(await docString(page)).toContain('footnoteSection(footnoteDefinition)');

  await page.keyboard.press('Backspace');

  // Still there, the author's to fill or remove.
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference), footnoteSection(footnoteDefinition))',
  );
  await expect(page.getByText(/本文中の参照を削除/)).toBeVisible();
});

test('Backspace and Delete inside a definition still edit the text', async ({ page }) => {
  // Only the two edges refuse; taking the whole key would be worse than the join.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: 注釈\n');
  await caretAtEndOfFirstDefinition(page);
  await page.keyboard.press('Backspace');
  expect(await docString(page)).toContain('footnoteDefinition("注")');

  // `Home` reaches state a debounce later; without the wait Delete sees the old caret at the end.
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Delete');
  expect(await docString(page)).toContain('footnoteSection(footnoteDefinition)');
});

// Read off the document: a literal would drift when the fixture changes.
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

// A range over two definitions: `isolating` makes isolating-boundary.ts clamp it at all its
// entry points, so the notes did not merge.
test('a range spanning two definitions deletes inside each, not across', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  await page.locator('.ProseMirror div[data-footnote-def]').first().click();
  await settle(page);
  const { from, to } = await acrossDefinitions(page, 1, 1);
  await setRange(page, from, to);
  await settle(page);
  await page.keyboard.press('Backspace');

  // Both notes exist with their labels; only the selected characters went.
  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("注"), footnoteDefinition("B"))',
  );
  const saved = await markdown(page);
  expect(saved).toContain('[^a]: 注');
  expect(saved).toContain('[^b]: B');
});

test('typing over a range spanning two definitions keeps both', async ({ page }) => {
  // handleTextInput is a separate entry point from Backspace, and the clamp covers it.
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
  // HardBreak's `setHardBreak` refuses inside an isolating node, so these route through Enter's
  // insertion.
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
  // Document-wide bindings: what they decline matters too.
  await loadMarkdown(page, '本文[^a]\n\nあとの段落\n\n[^a]: 注A\n');
  await page.locator('.ProseMirror p').nth(1).click();
  await settle(page);
  await page.keyboard.press('Home');
  await settle(page);
  await page.keyboard.press('Backspace');

  expect(await docString(page)).toContain('paragraph("本文", footnoteReference, "あとの段落")');
});

test('an empty definition says so where the author is standing', async ({ page }) => {
  // §5.2's placeholder, read off the attribute: its text is a CSS `::after`, not a node.
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

  // Gone once there is text: it marks a state.
  await page.keyboard.type('書いた');
  await expect(definition).not.toHaveAttribute('data-empty', '');
});

test('selecting a reference marks the definition it belongs to', async ({ page }) => {
  // Selecting a reference highlights its definition. Shown, not jumped to: the caret stays in the
  // prose (§5.1), with no backref to return by.
  await loadMarkdown(page, '本文[^a]と本文[^b]\n\n[^a]: 注A\n[^b]: 注B\n');
  const definitions = page.locator('.ProseMirror div[data-footnote-def]');
  await expect(definitions.nth(0)).not.toHaveAttribute('data-paired', '');

  await page.locator('.ProseMirror sup[data-footnote-ref]').nth(1).click();
  await settle(page);
  await expect(definitions.nth(1)).toHaveAttribute('data-paired', '');
  await expect(definitions.nth(0)).not.toHaveAttribute('data-paired', '');

  // The other reference takes it over.
  await page.locator('.ProseMirror sup[data-footnote-ref]').nth(0).click();
  await settle(page);
  await expect(definitions.nth(0)).toHaveAttribute('data-paired', '');
  await expect(definitions.nth(1)).not.toHaveAttribute('data-paired', '');
});

test('a caret in the prose does not light the definitions up', async ({ page }) => {
  // Only a NodeSelection: a caret beside a reference is where authors spend their time.
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
  // §5.2's first layer: an unfinished note is visible from the prose.
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
  // §6: a footnote would break the cell's one-line pipe form.
  await loadMarkdown(page, '| a | b |\n| - | - |\n| 1 | 2 |\n');
  await page.locator('.ProseMirror td').first().click();

  await page.keyboard.press('Control+Shift+f');
  expect(await docString(page)).not.toContain('footnoteReference');
  await expect(page.getByText(/脚注は.*置けません/)).toBeVisible();
});

test('typing [^ in a table cell leaves the characters alone', async ({ page }) => {
  // Criterion 7's second path: shortcut and input rule are separate entry points.
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

// Criterion 7b (§6.5): `detailsSummary` is `text*`, and unguarded the fitter splits the accordion
// to make room, tearing the title and leaving a spare accordion.
const ACCORDION = '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n';

test('a footnote cannot be put in an accordion title', async ({ page }) => {
  await loadMarkdown(page, ACCORDION);
  await page.locator('.ProseMirror summary').first().click();
  await settle(page);
  await page.keyboard.press('End');

  await page.keyboard.press('Control+Shift+f');

  const doc = await docString(page);
  expect(doc).not.toContain('footnoteReference');
  // One accordion, title whole, body untouched.
  expect(doc.match(/detailsSummary/g)).toHaveLength(1);
  expect(doc).toContain('detailsSummary("タイトル")');
  expect(doc).toContain('paragraph("本文")');
  await expect(page.getByText(/アコーディオンのタイトル内には置けません/)).toBeVisible();
});

test('typing [^ in an accordion title leaves the characters alone', async ({ page }) => {
  // The input rule, the other entry point.
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
  // The body (`block+` → paragraph → `inline*`) takes a reference; the guard names only
  // `detailsSummary`.
  await loadMarkdown(page, ACCORDION);
  // A loaded accordion is folded (`persist: false`), so open it before clicking into the body.
  const body = page.locator('.ProseMirror [data-type="detailsContent"]');
  await page.locator('.ProseMirror [data-type="details"] > button').click();
  await expect(body).toBeVisible();

  await body.locator('p').last().click();
  // Required: a clicked caret reaches state ~20ms late, and the shortcut would judge the stale
  // selection, in the title after a load.
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
  // §6 allows it (criterion 13): a callout is prose.
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

// Select the first paragraph whole, so the copy carries its reference. Settle after the focusing
// click, or a pending flush overwrites the selection below. Through the command, not
// Home+Shift+End: those move the DOM selection, and a Control+c inside the debounce copies an empty
// slice, so the browser puts plain text on the clipboard and the footnote is lost
// (docs/editor-pitfalls.md §1.1).
async function selectFirstParagraph(page: import('@playwright/test').Page) {
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await selectInside(page, 'paragraph');
}

test('duplicating a paragraph shares its footnote', async ({ page }) => {
  // Criterion 16 (§6.2): a carried label whose definition holds the same words is the same footnote,
  // so the copy joins it: a second reference to one note. Count, don't read the number: both read [1]
  // either way.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  // The clipboard write is async; paste after it lands.
  await settle(page);
  // Not End: after the debounce Enter would replace the copied range, footnotes and all.
  await collapseToEnd(page);
  await page.keyboard.press('Enter');
  await settle(page);
  await page.keyboard.press('Control+v');
  await settle(page);

  const saved = await markdown(page);
  // Two references, one definition, one definition line.
  expect(saved.match(/\[\^a\]/g)).toHaveLength(3);
  expect(saved.match(/\[\^[^\]]+\]: A の注/g)).toHaveLength(1);
  expect(await docString(page)).toContain('footnoteSection(footnoteDefinition("A の注"))');
  expect(await numbers(page)).toEqual(['1', '1']);
});

test('deleting one of two references keeps the note, and the last one takes it', async ({
  page,
}) => {
  // footnotePairing checks whether any reference still carries the label (`order.has`), so deleting
  // one of two is safe.
  await loadMarkdown(page, '本文[^a]と再度[^a]\n\n[^a]: A の注\n');
  await page.locator('.ProseMirror p').first().click();
  await settle(page);

  // The second reference: 本文(2) + ref(1) + と再度(3) puts it at 7.
  await setRange(page, 7, 8);
  await page.keyboard.press('Backspace');
  await settle(page);
  expect(await docString(page)).toBe(
    'doc(paragraph("本文", footnoteReference, "と再度"), footnoteSection(footnoteDefinition("A の注")))',
  );

  await setRange(page, 3, 4);
  await page.keyboard.press('Backspace');
  await settle(page);
  // Now nothing points at it, so the definition and the empty section go (§5.1).
  expect(await docString(page)).toBe('doc(paragraph("本文と再度"))');
});

test('cutting and pasting a paragraph keeps the note and the label', async ({ page }) => {
  // Criterion 17: the cut takes the definition (§5.1), the paste restores it and reuses the free
  // label (§6.2), so a moved footnote does not look new in the diff.
  await loadMarkdown(page, '本文[^keepme]\n\nあと\n\n[^keepme]: 消えない注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+x');
  await settle(page);
  await page.keyboard.press('Control+v');

  const saved = await markdown(page);
  expect(saved).toContain('[^keepme]');
  expect(saved).toContain('[^keepme]: 消えない注');
});

// Copy, open another document, paste at the end: carrying a footnote between posts.
async function copyFirstParagraphInto(
  page: import('@playwright/test').Page,
  source: string,
  destination: string,
) {
  await loadMarkdown(page, source);
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  await settle(page);

  await loadMarkdown(page, destination);
  await page.locator('.ProseMirror p').first().click();
  await settle(page);
  await collapseToEnd(page);
  await page.keyboard.press('Enter');
  await settle(page);
  await page.keyboard.press('Control+v');
  await settle(page);
}

test('a label that collides with a different note does not adopt it', async ({ page }) => {
  // Sharing must not swallow this (§6.2): external labels are kept (§4.1), so two posts with `[^1]`
  // is ordinary, and matching on label alone would drop 元の注.
  await copyFirstParagraphInto(
    page,
    '元の本文[^1]\n\n[^1]: 元の注\n',
    '別の記事[^1]\n\n[^1]: 別の注\n',
  );

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("別の注"), footnoteDefinition("元の注"))',
  );
  expect(await numbers(page)).toEqual(['1', '2']);

  const saved = await markdown(page);
  expect(saved).toContain('[^1]: 別の注');
  // The arrival kept its words under a name of its own.
  expect(saved).toMatch(/\[\^(?!1\])[^\]]+\]: 元の注/);
});

test('two references sharing a note stay one footnote when the label has to change', async ({
  page,
}) => {
  // Minting is per carried label, not per reference, or a shared note splits in two in transit.
  await copyFirstParagraphInto(
    page,
    '元[^1]と再度[^1]\n\n[^1]: 元の注\n',
    '別[^1]\n\n[^1]: 別の注\n',
  );

  expect(await docString(page)).toContain(
    'footnoteSection(footnoteDefinition("別の注"), footnoteDefinition("元の注"))',
  );
  // Three references, two definitions: the pasted pair still points at one note.
  expect(await numbers(page)).toEqual(['1', '2', '2']);
  expect((await markdown(page)).match(/: 元の注/g)).toHaveLength(1);
});

test('pasting a footnote into a table cell leaves no definition behind', async ({ page }) => {
  // Criterion 18 (§6.3): into a cell the reference falls to text and its carried note is discarded,
  // not kept as an orphan (§5.4).
  await loadMarkdown(page, '本文[^a]\n\n| x | y |\n| - | - |\n| 1 | 2 |\n\n[^a]: A の注\n');
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  await settle(page);
  await page.locator('.ProseMirror td').first().click();
  // A clicked caret reaches state ~20ms late; pasting sooner pastes over the old selection.
  await settle(page);
  await page.keyboard.press('Control+v');

  const doc = await docString(page);
  // Exactly the one definition the document started with.
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  // The reference fell to plain text inside the cell rather than staying a node.
  expect(doc).not.toMatch(/tableCell\([^)]*footnoteReference/);
});

test('pasting a footnote into an accordion title leaves the accordion whole', async ({ page }) => {
  // §6.5's paste half needs its own hook: other refusals repair after the slice lands, but a
  // `text*` title never holds the reference, so the fitter tears the accordion and the repair finds
  // nothing.
  await loadMarkdown(page, `本文[^a]です\n\n${ACCORDION}\n[^a]: A の注\n`);
  await selectFirstParagraph(page);
  await page.keyboard.press('Control+c');
  await settle(page);
  await page.locator('.ProseMirror summary').first().click();
  await page.keyboard.press('End');
  // Settle, as above.
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
  // §5.4: kept and reported, or the `[?]` note would look like a bug.
  await loadMarkdown(page, '本文[^a]\n\n[^a]: A の注\n\n[^x]: 参照のない注\n');

  await expect(page.getByText(/参照されていない脚注が 1 件/)).toBeVisible();
  // Kept, not deleted, and marked as having no number to carry.
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(1);
});

test('the orphan notice does not return on every keystroke', async ({ page }) => {
  // A state, not an event: reporting per transaction would toast over typing.
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
// prosemirror-view runs transformPasted over a dropped slice, so paste and drop share a path; this
// measures that. A native drop needs CDP (e2e/native-drag.ts).

test('dragging a footnote into ordinary prose leaves no orphan behind', async ({ page }) => {
  await loadMarkdown(page, '本文[^a]です\n\n移動先の段落\n\n[^a]: A の注\n');

  const source = page.locator('.ProseMirror p').first();
  const target = page.locator('.ProseMirror p').nth(1);
  const origin = await dragSelect(page, await caretPoint(source, 0), await caretPoint(source, 4));
  await cdpNativeDrag(page, origin, await caretPoint(target, 3));

  const doc = await docString(page);
  // A move mints no second definition and orphans none.
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

  // Refused outright: a drop moves, so repairing at the destination would orphan the note.
  const doc = await docString(page);
  expect(doc.match(/footnoteDefinition/g)).toHaveLength(1);
  await expect(page.locator('.ProseMirror div[data-footnote-def][data-orphan]')).toHaveCount(0);
  expect(doc).not.toMatch(/tableCell\([^)]*footnoteReference/);
  // Nothing moved: the reference is still where it was, and the author is told why.
  expect(doc).toMatch(/paragraph\("本文", footnoteReference, "です"\)/);
  await expect(page.getByText(/表のセル内には置けません/)).toBeVisible();
});

test('dragging a footnote into an accordion title leaves the accordion whole', async ({ page }) => {
  // The third route into §6.5's title: whether `posAtCoords` over a `<summary>` resolves inside it is
  // a browser fact. Refused, not degraded, as a drop moves (§6.3).
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
