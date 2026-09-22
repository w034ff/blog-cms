import { test, expect } from '@playwright/test';
import { docString } from './editor-probe';
import { expectAutosaved, loadMarkdown, selectAcross, selectInside } from './editor-authoring';

// Drives the toolbar's callout-insert menu (CalloutMenu): open the dropdown, pick a
// type, and confirm it drops a real callout node — a `div.markdown-alert` whose label is
// a non-editable chip (no editable marker text) and whose body takes the caret — that
// round-trips to `> [!TYPE]` markdown. Browser-only: the node/NodeView and the markdown
// serialization only exist in the live editor.
test('the callout menu inserts a protected note callout that round-trips', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報' }).click();

  // A callout <div> (not a blockquote), tinted, with the type as a label chip.
  const callout = editor.locator('div.markdown-alert.markdown-alert-note');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('情報');
  // The marker is an attribute, never editable text.
  await expect(editor).not.toContainText('[!NOTE]');

  // The caret sits in the empty body, so typing (no extra click) fills the body.
  await page.keyboard.type('補足の説明です。');
  await expect(callout.locator('.markdown-alert-content')).toContainText('補足の説明です。');
  // Still a callout after typing — nothing the author types can degrade it to a quote.
  await expect(callout).toBeVisible();

  // Round-trips to the stored markdown (mirrored into the hidden body input).
  const body = (await page.locator('input[name="body"]').inputValue()).replace(/\\/g, '');
  expect(body).toContain('> [!NOTE]');
  expect(body).toContain('> 補足の説明です。');
});

// Round-trip through storage: a callout saved as `> [!TYPE]` markdown must parse back
// into the same protected node on load (the path every existing post takes). Authoring +
// autosave + reload exercises serialize → store → parse.updateDOM in one go.
test('a callout survives a reload — markdown parses back into the node', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await page.getByLabel('タイトル').fill('Callout round-trip');
  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();
  await page.keyboard.type('保存して読み込み直しても壊れない。');

  // Wait for autosave to persist the markdown (it also swaps the URL to the edit page),
  // then reload so the editor rebuilds from the stored source.
  await expectAutosaved(page);
  await page.reload();

  const callout = page.locator('.ProseMirror div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');
  await expect(callout.locator('.markdown-alert-content')).toContainText(
    '保存して読み込み直しても壊れない。',
  );
  await expect(page.locator('.ProseMirror')).not.toContainText('[!WARNING]');
});

// Inside an existing callout the menu switches its type in place — callouts never nest (the
// toolbar mirrors the top-level-only input rules). Insert a note, type into it, then reopen
// from the still-in-callout cursor and pick 警告; assert the single callout changed type and
// kept its body, rather than gaining a nested note+warning.
test('picking a type inside a callout switches it in place (no nesting)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('切り替えテスト');

  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();

  // Exactly one callout, now a warning, body preserved — not an outer note wrapping a warning.
  await expect(editor.locator('div.markdown-alert')).toHaveCount(1);
  const callout = editor.locator('div.markdown-alert.markdown-alert-warning');
  await expect(callout).toBeVisible();
  await expect(callout.locator('.markdown-alert-title-label')).toHaveText('警告');
  await expect(callout.locator('.markdown-alert-content')).toContainText('切り替えテスト');
});

// The other two tiers wire the same way — assert each menu choice inserts a callout node
// carrying the matching type + label.
for (const { label, type, title } of [
  { label: '警告', type: 'warning', title: '警告' },
  { label: '注意', type: 'caution', title: '注意' },
] as const) {
  test(`the callout menu inserts a ${type} callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');

    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();

    await editor.click();
    await page.getByRole('button', { name: '囲み枠' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();

    const callout = editor.locator(`div.markdown-alert.markdown-alert-${type}`);
    await expect(callout).toBeVisible();
    await expect(callout.locator('.markdown-alert-title-label')).toHaveText(title);
  });
}

// Callouts are top-level only (callout-extension.ts): both typing shortcuts check the
// depth, and setCallout mirrors that — inside a table, and inside a quote. The quote case
// is a judgement call rather than a storage limit (`> > [!NOTE]` round-trips fine): a
// blockquote is someone else's words, a callout the author's own aside, so nesting one in
// the other misattributes it. Browser-only — the guard lives in a command, not the schema.
test('the callout menu is disabled inside a quote', async ({ page }) => {
  await page.goto('/admin/posts/new');

  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();

  const trigger = page.getByRole('button', { name: '囲み枠' });
  await editor.click();
  await expect(trigger).toBeEnabled(); // top level: a callout can be inserted here

  await page.keyboard.type('> quoted text');
  await expect(trigger).toBeDisabled();

  // The greyed-out trigger is CalloutMenu reading the command; assert the command itself
  // refuses too, so the guard is pinned where it lives and not only at the UI that asks.
  const canSetCallout = await page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as
      | (Element & { editor?: { can(): { setCallout(type: string): boolean } } })
      | null;
    if (!el?.editor) throw new Error('no live editor on .ProseMirror');
    return el.editor.can().setCallout('note');
  });
  expect(canSetCallout).toBe(false);
});

// The refusals above were written as `editor.isActive('table' | 'blockquote')`, which only holds
// for a caret: a selection reaching from the paragraph above into either one reported false and
// went through, and insertContent then *replaced* the range — the table vanished outright and the
// quote lost the text the selection had covered. The guard scans the selected range instead
// (components/editor/selection-scan.ts). Browser-only: the guard lives in a command.
for (const { label, markdown, typeName, expected } of [
  {
    label: 'a table',
    markdown: 'text\n\n| a | b |\n| --- | --- |\n| c | d |\n',
    typeName: 'table',
    expected:
      'doc(paragraph("text"), table(tableRow(tableHeader(paragraph("a")), tableHeader(paragraph("b"))), tableRow(tableCell(paragraph("c")), tableCell(paragraph("d")))), paragraph)',
  },
  {
    label: 'a quote',
    markdown: 'text\n\n> quoted\n',
    typeName: 'blockquote',
    expected: 'doc(paragraph("text"), blockquote(paragraph("quoted")), paragraph)',
  },
]) {
  test(`a selection reaching into ${label} cannot insert a callout`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();

    await loadMarkdown(page, markdown);
    expect(await docString(page)).toBe(expected);

    await selectAcross(page, typeName);
    await expect(page.getByRole('button', { name: '囲み枠' })).toBeDisabled();

    // The command itself refuses, so the greyed-out trigger isn't the only thing standing in the
    // way — and the document is untouched, not partly replaced.
    const inserted = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as
        | (Element & { editor?: { commands: { setCallout(type: string): boolean } } })
        | null;
      if (!el?.editor) throw new Error('no live editor on .ProseMirror');
      return el.editor.commands.setCallout('note');
    });
    expect(inserted).toBe(false);
    expect(await docString(page)).toBe(expected);
  });
}

// A dropdown's `open` flag survives the trigger being disabled: the panel is gated on
// `open && !disabled` (ToolbarDropdown.tsx), so it hides while disabled but reappears — without
// anyone clicking — once the control is enabled again. useDismiss closes on mousedown/Escape, so
// this needs a selection change that involves neither; setTextSelection is exactly that.
test('a dropdown left open while it gets disabled does not reopen by itself', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, 'text\n\n> quoted\n');
  const trigger = page.getByRole('button', { name: '囲み枠' });
  const item = page.getByRole('button', { name: '情報', exact: true });

  // Caret in the leading paragraph: the menu opens normally.
  await selectInside(page, 'paragraph');
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(item).toBeVisible();

  // Into the quote — no mousedown, no Escape, so nothing dismisses the menu; the trigger goes
  // disabled and the panel hides.
  await selectInside(page, 'blockquote');
  await expect(trigger).toBeDisabled();
  await expect(item).toHaveCount(0);

  // Back out of the quote. The panel must stay shut until it is asked for again.
  await selectInside(page, 'paragraph');
  await expect(trigger).toBeEnabled();
  await expect(item).toHaveCount(0);

  // And the menu still works when actually clicked.
  await trigger.click();
  await expect(item).toBeVisible();
});

// Picking a type with a selection that only *overlaps* a callout retypes that callout, rather than
// replacing the selection with a fresh empty one beside the remains of the old — which is what the
// old `editor.isActive('callout')` check did, since isActive needs the callout to cover the whole
// range (see components/editor/selection-scan.ts). Browser-only: the branch lives in a command.
test('a selection overlapping a callout retypes it instead of inserting a new one', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();

  await loadMarkdown(page, '前の段落\n\n> [!NOTE]\n>\n> 囲みの中身\n');
  await expect(editor.locator('div.markdown-alert-note')).toHaveCount(1);

  // From inside the paragraph into the callout's text — neither wholly in nor wholly out.
  await selectAcross(page, 'callout');
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '警告', exact: true }).click();

  // Still one callout, now a warning, with its text intact — and no stray empty one.
  const callouts = editor.locator('div.markdown-alert');
  await expect(callouts).toHaveCount(1);
  await expect(editor.locator('div.markdown-alert-warning')).toHaveCount(1);
  await expect(callouts).toContainText('囲みの中身');
  expect(await docString(page)).toBe(
    'doc(paragraph("前の段落"), callout(paragraph("囲みの中身")), paragraph)',
  );
});
