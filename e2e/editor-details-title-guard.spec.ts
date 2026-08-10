import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';
import { docString, markdown } from './editor-probe';

// An accordion's title is `text*` (docs/accordion-requirements.md §2.3, §6.5): it holds no block
// node and, as of 2026-08-10, no marks either. ProseMirror does not *refuse* what does not fit —
// the fitter splits the accordion in two around the intruder and grows a second, untitled one from
// the title's remainder, which then saves as two `<details>`. Measured on all three routes the
// toolbar and the slash menu offered (callout, table, image) before the guards below existed.
//
// These are the insertion-gesture guards only. Marks are answered by the schema instead, which is
// why the two halves of this file assert different things: a refused command versus a mark that
// never reaches the document.

const TITLED = '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n';

type Probe = Element & {
  editor: {
    can(): {
      setCallout(t: string): boolean;
      insertTable(o: unknown): boolean;
      toggleBold(): boolean;
      toggleItalic(): boolean;
      toggleStrike(): boolean;
      toggleCode(): boolean;
      toggleAccentEmphasis(): boolean;
      setLink(o: { href: string }): boolean;
    };
    state: {
      doc: { descendants(f: (n: { type: { name: string } }, pos: number) => void): void };
    };
  };
};

// The first position inside the title, and the first inside the body — asked of the document
// rather than clicked, because a click places the DOM caret ~20ms before ProseMirror's state
// catches up and every predicate below reads the state.
async function firstPos(page: Page, typeName: string): Promise<number> {
  return page.evaluate((name) => {
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let pos = -1;
    el.editor.state.doc.descendants((node, at) => {
      if (pos === -1 && node.type.name === name) pos = at;
    });
    if (pos === -1) throw new Error(`no ${name} in the document`);
    return pos + 1;
  }, typeName);
}

// The start of the body's first line. Resolved to the first textblock inside `detailsContent`,
// because a raw position that is not inside one lands somewhere else without saying so.
async function bodyFirstLine(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let start = -1;
    let end = -1;
    let target = -1;
    el.editor.state.doc.descendants((node, at) => {
      const n = node as { type: { name: string }; isTextblock: boolean; nodeSize: number };
      if (start === -1 && n.type.name === 'detailsContent') {
        start = at;
        end = at + n.nodeSize;
      }
      if (start !== -1 && target === -1 && at > start && at < end && n.isTextblock) target = at + 1;
    });
    if (target === -1) throw new Error('no textblock in detailsContent');
    return target;
  });
}

function blockPredicates(page: Page): Promise<{ setCallout: boolean; insertTable: boolean }> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const can = el.editor.can();
    return {
      setCallout: can.setCallout('note'),
      insertTable: can.insertTable({ rows: 2, cols: 2, withHeaderRow: true }),
    };
  });
}

async function openWithAccordion(page: Page, md = TITLED): Promise<void> {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, md);
  await expect(page.locator('.ProseMirror [data-type="details"]')).toBeVisible();
}

test('the callout and table controls are refused in an accordion title', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  // The command's own predicate first: every route asks it, so this is where the rule lives.
  expect(await blockPredicates(page)).toEqual({ setCallout: false, insertTable: false });
  // …and the toolbar follows from it without a second rule of its own.
  await expect(page.getByRole('button', { name: '囲み枠' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '表', exact: true })).toBeDisabled();
});

// The body must keep taking both — §6.3 blesses a callout, a table and a code block *inside* an
// accordion, and folding one away is most of the point. This is why the guards name
// `detailsSummary` and never `details`; asserted here so a later widening cannot pass unnoticed.
test('the accordion body still takes a callout and a table', async ({ page }) => {
  await openWithAccordion(page);
  // A loaded accordion is folded (§5) and a folded body takes no caret at all — setTextSelection
  // into the hidden `detailsContent` normalizes back to the end of the title, which would test the
  // title again under the body's name. Open it first, and aim at the body's first *textblock*
  // rather than at `detailsContent` + 1, which is the position before that block.
  const toggle = page.locator('.ProseMirror [data-type="details"] > button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
  await setRange(page, await bodyFirstLine(page));

  expect(await blockPredicates(page)).toEqual({ setCallout: true, insertTable: true });

  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByLabel('2行2列の表を挿入').click();
  // One accordion still, with the table inside its body rather than beside it.
  expect(await docString(page)).toContain('detailsContent(table(');
  expect(await docString(page)).toContain('detailsSummary("タイトル")');
});

// Spelled out rather than imported from useImageUpload: this is user-visible copy, so a wording
// change should turn a test red rather than travel with it. 「アコーディオンのタイトル」 is what the
// footnote guard already calls the same place — one feature, one name (§7.3).
const BLOCKED_IN_TITLE = 'アコーディオンのタイトルには画像を挿入できません';

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('an image is refused in an accordion title, and says why', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  // The picker greys out; paste and drop have no control to grey, so they get the notice.
  const picker = page.getByLabel(/画像/).first();
  await expect(picker).toBeDisabled();

  const toast = page.getByRole('status');
  await expect(toast).toHaveCount(0);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  }, PNG_1x1_BASE64);

  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(BLOCKED_IN_TITLE);
  await expect(page.locator('.ProseMirror img')).toHaveCount(0);
  // The accordion is intact — one of it, its title unchanged.
  expect(await docString(page)).toBe(
    'doc(details(detailsSummary("タイトル"), detailsContent(paragraph("本文"))), paragraph)',
  );
});

// With every row's predicate false, `hasAnyItem` is false and the trigger declines — so `/` stays
// an ordinary character instead of opening an empty popup. The same thing already happens in a
// table cell. One assertion pins the whole slash path, which is the second route the three block
// insertions arrived by.
test('`/` in an accordion title stays a literal character', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await page.keyboard.type('/');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  expect(await docString(page)).toContain('detailsSummary("/タイトル")');
});

// Marks are answered by the schema (`marks: ''`), not by a guard per command — so the assertion is
// that the commands report false on their own, which is what greys the toolbar out with no UI-side
// rule to keep in step.
test('no mark can be applied in an accordion title', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  const can = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    const c = el.editor.can();
    return {
      toggleBold: c.toggleBold(),
      toggleItalic: c.toggleItalic(),
      toggleStrike: c.toggleStrike(),
      toggleCode: c.toggleCode(),
      toggleAccentEmphasis: c.toggleAccentEmphasis(),
      setLink: c.setLink({ href: 'https://example.com' }),
    };
  });
  expect(can).toEqual({
    toggleBold: false,
    toggleItalic: false,
    toggleStrike: false,
    toggleCode: false,
    toggleAccentEmphasis: false,
    setLink: false,
  });
  await expect(page.getByRole('button', { name: /太字/ })).toBeDisabled();
});

// The half of `marks: ''` that had to be measured before choosing the schema over a guard: a stored
// title carrying emphasis keeps its *words*. §6.3 refuses schema restrictions because forbidding a
// shape drops the content of markdown that carries it — a dropped mark does not, and the emphasis
// was already being lost at save time (serializeDetails reads `textContent`), so nothing that
// survived before is lost now.
test('a stored title with emphasis keeps its words and drops the mark', async ({ page }) => {
  await openWithAccordion(
    page,
    '<details>\n<summary><b>強調</b>と地</summary>\n\n本文\n\n</details>\n',
  );

  expect(await docString(page)).toContain('detailsSummary("強調と地")');
  expect(await markdown(page)).toBe('<details>\n<summary>強調と地</summary>\n\n本文\n\n</details>');
});

// The slice routes (§6.8). A block reaching the title does not have to come from a command: a
// selection dragged or copied across a paragraph boundary carries block structure, and the fitter
// splits the accordion around it exactly as an inserted callout did. What must keep working is the
// selection made *within* one paragraph — that carries nothing but inline content, lands as text,
// and is a gesture authors use.
//
// Stated as user-visible copy, pinned here rather than imported, like the image refusal above.
const TITLE_NO_BLOCKS = 'アコーディオンのタイトルには段落やブロックを入れられません';

const WITH_PARAGRAPHS =
  '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n\n一つ目の段落\n\n二つ目の段落\n';

const INTACT =
  'doc(details(detailsSummary("タイトル"), detailsContent(paragraph("本文"))), paragraph("一つ目の段落"), paragraph("二つ目の段落"))';

async function paragraphRange(page: Page, text: string): Promise<{ from: number; to: number }> {
  return page.evaluate((needle) => {
    const el = document.querySelector('.ProseMirror') as Probe | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    let found: { from: number; to: number } | null = null;
    el.editor.state.doc.descendants((node, pos) => {
      const n = node as unknown as { type: { name: string }; textContent: string };
      if (!found && n.type.name === 'paragraph' && n.textContent === needle) {
        found = { from: pos + 1, to: pos + 1 + n.textContent.length };
      }
    });
    if (!found) throw new Error(`no paragraph reading ${needle}`);
    return found;
  }, text);
}

test('a paste crossing a paragraph boundary is refused in the title', async ({ page }) => {
  await openWithAccordion(page, WITH_PARAGRAPHS);
  expect(await docString(page)).toBe(INTACT);

  const first = await paragraphRange(page, '一つ目の段落');
  const second = await paragraphRange(page, '二つ目の段落');
  await setRange(page, first.from + 2, second.to - 2);
  await page.keyboard.press('Control+c');
  await setRange(page, await firstPos(page, 'detailsSummary'));
  await page.keyboard.press('Control+v');

  const toast = page.getByRole('status');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText(TITLE_NO_BLOCKS);
  // Whole-document, not `toContain`: the defect's symptom is a second accordion appearing.
  expect(await docString(page)).toBe(INTACT);
});

// The other half of the rule, and the reason the guard reads the slice rather than the position.
test('a paste from within one paragraph still lands as text in the title', async ({ page }) => {
  await openWithAccordion(page, WITH_PARAGRAPHS);

  const first = await paragraphRange(page, '一つ目の段落');
  await setRange(page, first.from, first.to);
  await page.keyboard.press('Control+c');
  await setRange(page, await firstPos(page, 'detailsSummary'));
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await docString(page)).toContain('detailsSummary("一つ目の段落タイトル")');
});

// A whole block taken with the drag handle's node selection is a block wherever it is put. Before
// the guard this one was not destructive — it landed *before* the accordion — but that is a
// surprising place for content the author asked to put in the title, and the rule is now one rule.
test('a whole callout pasted into the title is refused', async ({ page }) => {
  await openWithAccordion(
    page,
    '<details>\n<summary>タイトル</summary>\n\n本文\n\n</details>\n\n> [!NOTE]\n> 囲みの中身\n',
  );
  await selectNode(page, 'callout');
  await page.keyboard.press('Control+c');
  await setRange(page, await firstPos(page, 'detailsSummary'));
  const before = await docString(page);
  await page.keyboard.press('Control+v');

  await expect(page.getByRole('status')).toHaveText(TITLE_NO_BLOCKS);
  expect(await docString(page)).toBe(before);
});
