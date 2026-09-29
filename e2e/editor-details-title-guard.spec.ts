import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown, selectNode, setRange } from './editor-authoring';
import { docString, markdown } from './editor-probe';

// An accordion's title is `text*` (docs/accordion-requirements.md §2.3, §6.5): no blocks, no marks.
// ProseMirror does not refuse the intruder; the fitter splits the accordion and saves two
// `<details>`. The insertion guards are here; marks are the schema's, so the two halves assert
// different things.

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

// From the document, not a click: a click's caret reaches state ~20ms late.
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

// The first textblock in `detailsContent`; a raw position lands elsewhere silently.
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

  // The command's predicate, which every route asks.
  expect(await blockPredicates(page)).toEqual({ setCallout: false, insertTable: false });
  // The toolbar follows from it.
  await expect(page.getByRole('button', { name: '囲み枠' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '表', exact: true })).toBeDisabled();
});

// The body takes both (§6.3), so the guards name `detailsSummary`, never `details`.
test('the accordion body still takes a callout and a table', async ({ page }) => {
  await openWithAccordion(page);
  // Open it first: a folded body takes no caret, and a selection there falls back to the title. Aim at
  // the first textblock, not `detailsContent` + 1.
  const toggle = page.locator('.ProseMirror [data-type="details"] > button');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'アコーディオンを閉じる');
  await setRange(page, await bodyFirstLine(page));

  expect(await blockPredicates(page)).toEqual({ setCallout: true, insertTable: true });

  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByLabel('2行2列の表を挿入').click();
  // One accordion, the table in its body.
  expect(await docString(page)).toContain('detailsContent(table(');
  expect(await docString(page)).toContain('detailsSummary("タイトル")');
});

// Spelled out, not imported: copy changes should fail a test. The name matches the footnote guard's
// (§7.3).
const BLOCKED_IN_TITLE = 'アコーディオンのタイトルには画像を挿入できません';

const PNG_1x1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('an image is refused in an accordion title, and says why', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  // The picker greys out; paste and drop get the notice.
  const picker = page.getByRole('button', { name: '画像', exact: true });
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
  // Intact: one accordion, title unchanged.
  expect(await docString(page)).toBe(
    'doc(details(detailsSummary("タイトル"), detailsContent(paragraph("本文"))), paragraph)',
  );
});

// Every row refuses, so `hasAnyItem` is false and `/` stays a character, as in a table cell.
test('`/` in an accordion title stays a literal character', async ({ page }) => {
  await openWithAccordion(page);
  await setRange(page, await firstPos(page, 'detailsSummary'));

  await page.keyboard.type('/');
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  expect(await docString(page)).toContain('detailsSummary("/タイトル")');
});

// `marks: ''` in the schema: the commands report false by themselves, greying the toolbar.
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

// A stored emphasized title keeps its words and drops the mark (§6.3 objects to dropping content,
// not marks; serializeDetails already read `textContent`).
test('a stored title with emphasis keeps its words and drops the mark', async ({ page }) => {
  await openWithAccordion(
    page,
    '<details>\n<summary><b>強調</b>と地</summary>\n\n本文\n\n</details>\n',
  );

  expect(await docString(page)).toContain('detailsSummary("強調と地")');
  expect(await markdown(page)).toBe('<details>\n<summary>強調と地</summary>\n\n本文\n\n</details>');
});

// The slice routes (§6.8): a drag or copy across a paragraph boundary carries blocks and splits the
// accordion. A selection within one paragraph is inline and still lands as text. Copy pinned.
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
  // The whole document: the symptom is a second accordion.
  expect(await docString(page)).toBe(INTACT);
});

// Why the guard reads the slice, not the position.
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

// A node-selected block is a block anywhere; it used to land before the accordion, now one rule.
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
