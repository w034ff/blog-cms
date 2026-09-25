import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { docString } from './editor-probe';
import { stubX, X_RESIZE_URL } from './x-embed-stub';

async function getMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor: { storage: { markdown: { getMarkdown: () => string } } };
    };
    return el.editor.storage.markdown.getMarkdown();
  });
}

// A card the seeded DB resolves (e2e/prepare-db.mts), as in editor-link-card.spec.ts.
const CARD_HREF = '/posts/second-post';
const CARD_TITLE = 'React Server Components を学ぶよ';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;

// One handle per matching top-level node (block-drag-handle.ts); none for a paragraph.
test('a handle appears before a target type, none before a paragraph', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();

  await page.keyboard.type('通常の段落');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.keyboard.type('コールアウト本文');

  const targets = await page.evaluate(() => {
    const pm = document.querySelector('.ProseMirror') as HTMLElement;
    return Array.from(pm.querySelectorAll(':scope > .block-drag-handle')).map((h) => {
      const sibling = h.nextElementSibling as HTMLElement | null;
      return sibling?.tagName ?? null;
    });
  });
  // Only the callout gets a handle; the paragraph before it does not.
  expect(targets).toEqual(['DIV']);
});

// decorations() scans only the doc's direct children, so a nested blockquote gets no handle.
test('a blockquote nested inside a callout gets no handle of its own', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '囲み枠' }).click();
  await page.getByRole('button', { name: '情報', exact: true }).click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('ネストした引用');

  await expect(editor.locator('.markdown-alert blockquote')).toBeVisible();
  const handleCount = await editor.locator('.block-drag-handle').count();
  expect(handleCount).toBe(1); // the callout's own handle only
});

// mousedown selects the whole node. Also the plain-click path: DragController tracks movement
// only past DRAG_THRESHOLD, so a still mousedown+mouseup leaves only the NodeSelection.
test('mousedown on a handle creates a NodeSelection over its block', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用文');

  const handle = editor.locator('.block-drag-handle').first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('handle has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('.ProseMirror') as Element & {
          editor: {
            state: {
              selection: { constructor: { name: string }; node?: { type: { name: string } } };
            };
          };
        };
        const sel = el.editor.state.selection;
        return { type: sel.constructor.name, nodeType: sel.node?.type?.name };
      }),
    )
    .toEqual({ type: 'NodeSelection', nodeType: 'blockquote' });
  await page.mouse.up();
});

// Reorder via the handle for a plain node and one prosemirror-tables wraps in `.tableWrapper`.
// DragController's own mousemove/mouseup, not native DnD, so page.mouse drives it end to end.
for (const kind of ['blockquote', 'table'] as const) {
  test(`dragging a ${kind}'s handle past a following paragraph reorders it (not a copy)`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await editor.click();

    if (kind === 'blockquote') {
      await page.getByRole('button', { name: '引用' }).click();
      await page.keyboard.type('引用文');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.type('後の段落');
    } else {
      await page.getByRole('button', { name: '表', exact: true }).click();
      await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab'); // last cell
      await page.keyboard.press('ArrowDown'); // exit the table downward
      await page.keyboard.type('後の段落');
    }

    const before = await getMarkdown(page);
    expect(before.indexOf(kind === 'blockquote' ? '引用文' : '|')).toBeLessThan(
      before.indexOf('後の段落'),
    );

    const handle = editor.locator('.block-drag-handle').first();
    const handleBox = await handle.boundingBox();
    const targetPara = editor.locator('p', { hasText: '後の段落' });
    const targetBox = await targetPara.boundingBox();
    if (!handleBox || !targetBox) throw new Error('missing bounding box');

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Past DRAG_THRESHOLD, then past the paragraph's bottom: findBoundary() says "insert after it".
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 6,
    });
    await expect(page.locator('.block-drag-indicator')).toBeVisible();
    // Past the source block, so `is-dragging`, not :hover, keeps its handle visible.
    await expect(handle).toHaveClass(/is-dragging/);
    await expect(handle).toHaveCSS('opacity', '1');
    // The cursor-following preview (`ensurePreview`) is up too.
    const preview = page.locator('.block-drag-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator(kind === 'blockquote' ? 'blockquote' : 'table')).toHaveCount(1);
    await page.mouse.up();
    await expect(handle).not.toHaveClass(/is-dragging/);
    // The drop clears it too, not just Escape (tested separately).
    await expect(preview).toBeHidden();

    // Moved, not copied: one copy, after "後の段落".
    await expect
      .poll(async () => {
        const md = await getMarkdown(page);
        const blockIndex = md.indexOf(kind === 'blockquote' ? '引用文' : '|');
        return blockIndex > md.indexOf('後の段落');
      })
      .toBe(true);
    if (kind === 'blockquote') {
      await expect(editor.locator('blockquote')).toHaveCount(1);
    } else {
      await expect(editor.locator('table')).toHaveCount(1);
    }
  });
}

// The link card (docs/link-card-requirements.md §7.2), the one target that is an atom and a
// NodeView: the handle is its own, the drag reorders it, and it keeps its post. The reference is
// asserted on the saved markdown, since the NodeView would redraw a title over an empty attribute.
test("dragging a link card's handle past a following paragraph reorders it, reference intact", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, `${CARD_MD}\n\n後の段落\n`);

  // `decorations()` places the handle just before its target.
  const handle = editor.locator('.block-drag-handle');
  await expect(handle).toHaveCount(1);
  const targetClass = await page.evaluate(
    () =>
      document.querySelector('.ProseMirror > .block-drag-handle')?.nextElementSibling?.className ??
      null,
  );
  expect(targetClass).toContain('link-card-view');

  // Resolved first, so the preview below carries a real card.
  await expect(editor.locator('.link-card-title')).toHaveText(CARD_TITLE);

  const handleBox = await handle.boundingBox();
  const cardBox = await editor.locator('.link-card-view').boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !cardBox || !targetBox) throw new Error('missing bounding box');

  // alignHandles() sets `top` from the target's `offsetTop`, right only with a shared offsetParent.
  // The drag below aims at the handle wherever it is, so it cannot catch a misplaced handle.
  expect(Math.abs(handleBox.y - cardBox.y)).toBeLessThan(8);

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  // The preview clones the NodeView's DOM: the card as drawn, not the stored empty div.
  const preview = page.locator('.block-drag-preview');
  await expect(preview.locator('.link-card-view')).toHaveCount(1);
  await expect(preview.locator('.link-card-title')).toHaveText(CARD_TITLE);
  await page.mouse.up();

  expect(errors).toEqual([]);
  // Moved, not copied; TrailingNode adds the empty paragraph.
  await expect.poll(() => docString(page)).toBe('doc(paragraph("後の段落"), linkCard, paragraph)');
  expect(await getMarkdown(page)).toContain(CARD_MD);
});

// Dropping on the very next indicator down moves the block one slot. findBoundary() excludes the
// dragged node from its candidates; otherwise its own gaps sat a block apart and this was a no-op.
test('dropping on the very next indicator down moves the block by exactly one slot', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('A');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('B');
  await page.keyboard.press('Enter');
  await page.keyboard.type('C');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const boxB = await editor.locator('p', { hasText: 'B' }).boundingBox();
  if (!handleBox || !boxB) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Into B's lower half: the next indicator stop below.
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height - 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.mouse.up();

  expect(await getMarkdown(page)).toBe('B\n\n> A\n\nC');
});

// No indicator while the pointer is over the dragged block's own rect (`inSourceBounds`): at drag
// start it would already show at the nearest candidate, far away for a tall block.
test("the indicator stays hidden while the pointer is still over the dragged block's own rect", async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('A');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('B');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const boxA = await editor.locator('blockquote').boundingBox();
  const boxB = await editor.locator('p', { hasText: 'B' }).boundingBox();
  if (!handleBox || !boxA || !boxB) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Past DRAG_THRESHOLD, still inside A's rect.
  await page.mouse.move(handleBox.x + handleBox.width / 2, boxA.y + boxA.height - 2, { steps: 3 });
  await expect(page.locator('.block-drag-indicator')).toBeHidden();

  // Into B's lower half, a real candidate.
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height - 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.mouse.up();
});

// Upward: applyMove's other branch, where `tr.mapping.map(target)` is a no-op. A one-direction test
// would miss its off-by-one.
test("dragging a block's handle above the preceding paragraph reorders it (not a copy)", async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.type('前の段落');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用文');

  const before = await getMarkdown(page);
  expect(before.indexOf('前の段落')).toBeLessThan(before.indexOf('引用文'));

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '前の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Past DRAG_THRESHOLD, into the preceding paragraph's top half: "insert before it".
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await expect(handle).toHaveClass(/is-dragging/);
  await page.mouse.up();
  await expect(handle).not.toHaveClass(/is-dragging/);

  // Moved, not copied: one copy, before "前の段落".
  await expect
    .poll(async () => {
      const md = await getMarkdown(page);
      return md.indexOf('引用文') < md.indexOf('前の段落');
    })
    .toBe(true);
  await expect(editor.locator('blockquote')).toHaveCount(1);
});

// While dragging, the pointer sweeps over other blocks; without the `body.block-dragging` CSS
// guard (globals.css) their handles would pop up via the same :has(+ :hover) reveal.
test("dragging past another block's handle doesn't reveal it", async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用A');
  await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用B');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('後の段落');

  const handles = editor.locator('.block-drag-handle');
  const handleA = handles.nth(0);
  const handleB = handles.nth(1);
  const handleABox = await handleA.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleABox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleABox.x + handleABox.width / 2, handleABox.y + handleABox.height / 2);
  await page.mouse.down();
  // Pass squarely over blockquote B (and thus its handle's gutter) en route to the drop target.
  const handleBBox = await handleB.boundingBox();
  if (!handleBBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBBox.x + handleBBox.width / 2, handleBBox.y + handleBBox.height / 2, {
    steps: 6,
  });
  await expect(handleB).toHaveCSS('opacity', '0');
  // The handle's own `cursor` beats the body's `!important` (which ranks only rules on the same
  // element); pointer-events: none on other handles (globals.css) is what keeps the pointer off B's
  // handle, so elementFromPoint must resolve elsewhere, and that element sets the visible cursor.
  const hitAtHandleB = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return {
        isHandle: el?.classList.contains('block-drag-handle') ?? false,
        cursor: el ? getComputedStyle(el).cursor : null,
      };
    },
    [handleBBox.x + handleBBox.width / 2, handleBBox.y + handleBBox.height / 2] as const,
  );
  expect(hitAtHandleB.isHandle).toBe(false);
  expect(hitAtHandleB.cursor).toBe('grabbing');
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(handleB).toHaveCSS('opacity', '0');
  await page.mouse.up();
});

// Escape aborts with no transaction and no history entry (`handleKeyDown`).
test('Escape cancels an in-progress drag, leaving the document unchanged', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('後の段落');

  const before = await getMarkdown(page);

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.block-drag-indicator')).toBeHidden();
  await page.mouse.up();

  expect(await getMarkdown(page)).toBe(before);
});

// The preview is a plain DOM clone, not a decoration: right content mid-drag, gone after.
test('a cursor-following preview of the dragged block appears mid-drag and clears on Escape', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '引用' }).click();
  await page.keyboard.type('引用文');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('後の段落');

  const preview = page.locator('.block-drag-preview');
  await expect(preview).toBeHidden();

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(preview).toBeVisible();
  await expect(preview.locator('blockquote')).toHaveCount(1);
  await expect(preview.locator('blockquote')).toHaveText('引用文');

  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();
  await expect(preview.locator('blockquote')).toHaveCount(0);
  await page.mouse.up();
});

// An edit key mid-drag must not crash or edit: Delete would remove the NodeSelection, and applyMove's
// captured from/to would then throw "Position … out of range" on mouseup. handleKeyDown swallows
// edit keys. The table is the reported type.
test('pressing Delete mid-drag neither crashes nor deletes the block', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // last cell
  await page.keyboard.press('ArrowDown'); // exit the table downward
  await page.keyboard.type('後の段落');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.keyboard.press('Delete'); // mid-drag: must be swallowed, not delete the table
  await page.mouse.up();

  expect(errors).toEqual([]); // no "Position … out of range"
  await expect(editor.locator('table')).toHaveCount(1); // the block survived
});

// The table toolbar re-checks only on a transaction, and a drag dispatches none, so without the
// `body.block-dragging` suppression (globals.css) it would sit stale beside the ghost.
test('the table toolbar hides during a drag and returns after', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // last cell
  await page.keyboard.press('ArrowDown'); // exit the table downward
  await page.keyboard.type('後の段落');

  await editor.locator('td, th').first().click();
  const toolbar = page.locator('.table-toolbar');
  await expect(toolbar).toBeVisible();

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await expect(toolbar).toBeHidden();
  await page.mouse.up();

  // Still a node-selected table after the drop, so the toolbar returns.
  await expect(toolbar).toBeVisible();
});

// endSession() lifts the suppression before the drop repositions the menu; with the bubble menu's
// default 250ms updateDelay it reappeared at the old spot. TableToolbar.tsx's `updateDelay={0}`
// takes the synchronous path, so a read right after `mouse.up()` must already match a settled one.
test("the table toolbar's post-drop position has no stale intermediate frame", async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.getByRole('button', { name: '表', exact: true }).click();
  await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // last cell
  await page.keyboard.press('ArrowDown'); // exit the table downward
  await page.keyboard.type('後の段落');

  await editor.locator('td, th').first().click();
  const toolbar = page.locator('.table-toolbar');
  await expect(toolbar).toBeVisible();

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await page.mouse.up();

  const immediateBox = await toolbar.boundingBox();
  await page.waitForTimeout(400);
  const settledBox = await toolbar.boundingBox();
  expect(immediateBox).toEqual(settledBox);
});

// `block+ footnoteSection?` (footnote-extension.ts) makes `doc.content.size` an illegal target.
// The failure is silent in the doc: `tr.insert` adds no step (`replaceStep` returns null) and only
// `NodeSelection.create` throws from mouseup, so **the pageerror watch is what discriminates**. The
// whole band below the last block resolves above the section; the target Y comes from its rect.
test('dragging a block onto the footnote section drops it above the definitions, not past them', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await loadMarkdown(page, '> 引用文\n\n本文[^1]\n\n[^1]: 注釈テキスト\n');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const section = editor.locator('div[data-footnote-section]');
  const sectionBox = await section.boundingBox();
  if (!handleBox || !sectionBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // The section's lower half, which used to resolve to "after the section".
  await page.mouse.move(sectionBox.x + sectionBox.width / 2, sectionBox.y + sectionBox.height - 2, {
    steps: 8,
  });
  const indicator = page.locator('.block-drag-indicator');
  await expect(indicator).toBeVisible();
  // Drawn at the last block's bottom, never below the definitions.
  const indicatorBox = await indicator.boundingBox();
  if (!indicatorBox) throw new Error('missing bounding box');
  expect(indicatorBox.y).toBeLessThanOrEqual(sectionBox.y);
  await page.mouse.up();

  expect(errors).toEqual([]);
  // Moved, not copied, above the section, which stays last; TrailingNode adds the empty paragraph.
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("本文", footnoteReference), blockquote(paragraph("引用文")), paragraph, footnoteSection(footnoteDefinition("注釈テキスト")))',
    );
});

// Clicking a handle rings the block (globals.css `.ProseMirror-selectednode`), so it is clear what
// Delete would remove. Asserted on the class, whichever element carries it.
for (const kind of ['blockquote', 'table'] as const) {
  test(`clicking a ${kind}'s handle rings the selected block`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await editor.click();
    if (kind === 'blockquote') {
      await page.getByRole('button', { name: '引用' }).click();
      await page.keyboard.type('引用文');
    } else {
      await page.getByRole('button', { name: '表', exact: true }).click();
      await page.getByRole('button', { name: '2行2列の表を挿入' }).click();
    }

    const handle = editor.locator('.block-drag-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('handle has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up(); // a plain click (no motion past DRAG_THRESHOLD): selects, doesn't drag

    const selected = editor.locator('.ProseMirror-selectednode');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveCSS('outline-style', 'solid');
    await expect(selected).toHaveCSS('outline-width', '2px');
  });
}

// A target below the fold. The drag is plain mousemove/mouseup, so nothing scrolls by itself, and
// the session is modal (cursor, selection and keys taken), so an unfinishable drag leaves an editor
// that answers nothing. The pointer never moves after reaching the edge: scrolling and the
// indicator's tracking must happen without mouse events (AUTOSCROLL_ZONE).
test('holding at the bottom edge scrolls the page so a target below the fold is reachable', async ({
  page,
}) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  const paragraphs = Array.from({ length: 40 }, (_, i) => `段落${i + 1}`).join('\n\n');
  await loadMarkdown(page, `> 引用文です\n\n${paragraphs}\n`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // Vacuous unless the destination starts off-screen.
  const lastVisible = await editor
    .locator('p', { hasText: '段落40' })
    .evaluate((el) => el.getBoundingClientRect().top < window.innerHeight);
  expect(lastVisible).toBe(false);

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 200, (await page.evaluate(() => window.innerHeight)) - 3, {
    steps: 8,
  });
  // Parked: the page keeps scrolling until it runs out.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1,
      ),
    )
    .toBe(true);
  await page.mouse.up();

  // Landed at the tail gap; TrailingNode's empty paragraph follows.
  const md = await getMarkdown(page);
  expect(md.indexOf('段落40')).toBeLessThan(md.indexOf('> 引用文です'));
  expect(md.trim().endsWith('> 引用文です')).toBe(true);
});

// The wheel moves the page under a still pointer, and findBoundary() answers in viewport
// coordinates, so the target must follow the scroll (`handleScroll`). The claim is the pairing:
// the block lands before whichever paragraph the line is drawn at.
test('the drop target follows a wheel-scroll made mid-drag', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  const paragraphs = Array.from({ length: 40 }, (_, i) => `段落${i + 1}`).join('\n\n');
  await loadMarkdown(page, `> 引用文です\n\n${paragraphs}\n`);
  // The form's fields fill the first screen; clicking into the body scrolled it into view.

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // A paragraph clear of the autoscroll bands, so only the wheel moves the page, and below the first
  // paragraph's midpoint, which would resolve to the block's own gap (no indicator).
  const aimY = await page.evaluate(() => {
    const middle = window.innerHeight / 2;
    let best: number | null = null;
    let bestDelta = Infinity;
    for (const p of document.querySelectorAll('.ProseMirror > p')) {
      const rect = p.getBoundingClientRect();
      if (rect.top < 64 || rect.bottom > window.innerHeight - 64) continue;
      const delta = Math.abs((rect.top + rect.bottom) / 2 - middle);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = rect.bottom - 2; // its lower half: the gap *after* it, a real target
      }
    }
    return best;
  });
  if (aimY == null) throw new Error('no paragraph inside the safe band');
  await page.mouse.move(handleBox.x + 200, aimY, { steps: 8 });
  const indicator = page.locator('.block-drag-indicator');
  await expect(indicator).toBeVisible();
  const beforeWheel = await indicator.evaluate((el) => el.getBoundingClientRect().top);

  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => indicator.evaluate((el) => el.getBoundingClientRect().top))
    .not.toBe(beforeWheel);

  // The line sits at the top of the block the drop would precede.
  const aimedAt = await page.evaluate(() => {
    const line = document.querySelector('.block-drag-indicator') as HTMLElement;
    const top = line.getBoundingClientRect().top;
    let best: { text: string; delta: number } | null = null;
    for (const p of document.querySelectorAll('.ProseMirror > p')) {
      const delta = Math.abs(p.getBoundingClientRect().top - top);
      if (!best || delta < best.delta) best = { text: p.textContent ?? '', delta };
    }
    return best;
  });
  if (!aimedAt) throw new Error('no paragraph to aim at');
  expect(aimedAt.delta).toBeLessThan(2);

  // No movement before the drop, so the target cannot change after the read above.
  await page.mouse.up();
  expect(await getMarkdown(page)).toContain(`> 引用文です\n\n${aimedAt.text}`);
});

// Only the primary button picks a block up; a right-drag used to open a full modal session under
// the context menu.
test('a right-button press on a handle starts no drag', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await loadMarkdown(page, '> 引用文です\n\n後の段落\n');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetBox = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-preview')).toBeHidden();
  await expect(page.locator('.block-drag-indicator')).toBeHidden();
  expect(await page.evaluate(() => document.body.classList.contains('block-dragging'))).toBe(false);
  await page.mouse.up({ button: 'right' });

  expect(await getMarkdown(page)).toBe('> 引用文です\n\n後の段落');
});

// The reported freeze: a DragController session that never ended (`user-select: none`, keys
// swallowed). A native drag starting on top strands it, since the OS drag loop swallows
// `mousemove` and `mouseup`. page.mouse cannot enter that loop (e2e/native-drag.ts), so it is
// asserted at the seam: the dragstart is refused and the session still drops.
test('a native drag cannot start while a block drag is in progress', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '> 引用文です\n\n後の段落\n');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetBox = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();

  // A cancellable dragstart, as for the element prosemirror-view marked draggable.
  const prevented = await handle.evaluate(
    (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
  );
  expect(prevented).toBe(true);

  // Refused, not aborted: the real drag still drops.
  expect(await page.evaluate(() => document.body.classList.contains('block-dragging'))).toBe(true);
  await page.mouse.up();
  expect(await getMarkdown(page)).toBe('後の段落\n\n> 引用文です');
});

// The failsafe for a release nothing witnessed (a native drag before any dragstart, a release
// outside the window). A lost mouseup cannot be produced, so its aftermath is staged: a live
// session, then a move with no button down (prosemirror-view: `if (event.buttons == 0) this.done()`).
test('a mouse move with the button already released ends a stranded drag', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '> 引用文です\n\n後の段落\n');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetBox = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  expect(await page.evaluate(() => document.body.classList.contains('block-dragging'))).toBe(true);

  await page.evaluate(() =>
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 0 })),
  );

  // The modal state is gone: no body class, no ghost, keys reach the document.
  expect(await page.evaluate(() => document.body.classList.contains('block-dragging'))).toBe(false);
  await expect(page.locator('.block-drag-preview')).toBeHidden();
  await page.mouse.up(); // the real release, now finding nothing to finish
  // Aborted: an unwitnessed release is not a drop.
  expect(await getMarkdown(page)).toBe('> 引用文です\n\n後の段落');

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type('X');
  await expect.poll(() => getMarkdown(page)).toContain('X');
});

// The freeze at its source: a ringed block is a native drag source by prosemirror-view's doing
// (`selectNode()` sets `dom.draggable = true`, `mightDrag` arms for a press inside the selection),
// and that drag froze the editor with `view.dragging` left set. Asserted at the seam
// (e2e/native-drag.ts): the dragstart is refused and the press runs this plugin's drag instead.
for (const kind of ['blockquote', 'table'] as const) {
  test(`pressing a ringed ${kind} starts no native drag, and moves it as the handle does`, async ({
    page,
  }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await loadMarkdown(
      page,
      kind === 'blockquote'
        ? '> 引用文です\n\n後の段落\n'
        : '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n後の段落\n',
    );
    const block = editor.locator(kind === 'blockquote' ? 'blockquote' : 'table');
    await expect(block).toBeVisible();

    // Ring it by a click on its handle.
    const handle = editor.locator('.block-drag-handle').first();
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('missing bounding box');
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(1);

    // Marked draggable: the state the freeze starts from.
    expect(
      await editor
        .locator('.ProseMirror-selectednode')
        .evaluate((el) => el.getAttribute('draggable')),
    ).toBe('true');

    // Refused, asserted with no press in progress: DragController also cancels a dragstart during its
    // own session, so the same assertion mid-press passes without this guard.
    const prevented = await block.evaluate(
      (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
    );
    expect(prevented).toBe(true);

    const blockBox = await block.boundingBox();
    const targetBox = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
    if (!blockBox || !targetBox) throw new Error('missing bounding box');

    // And the press is this plugin's own drag.
    await page.mouse.move(blockBox.x + 40, blockBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 8,
    });
    await expect(page.locator('.block-drag-indicator')).toBeVisible();
    await expect(page.locator('.block-drag-preview')).toBeVisible();
    await page.mouse.up();

    const md = await getMarkdown(page);
    expect(md.indexOf('後の段落')).toBeLessThan(
      md.indexOf(kind === 'blockquote' ? '> 引用文です' : '| a | b |'),
    );
  });
}

// The mechanism has no type or depth check: Ctrl/Cmd+click (`selectNodeModifier`) node-selects a
// paragraph or heading too, outside `DRAGGABLE_TYPES`, so the guard covers any NodeSelection.
// Asserted at the same seam.
for (const [label, markdown, selector] of [
  ['paragraph', '本文の段落です。\n', 'p'],
  ['heading', '## 見出しです\n', 'h2'],
] as const) {
  test(`ctrl+click selecting a ${label} starts no native drag`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await loadMarkdown(page, markdown);

    const target = editor.locator(selector).first();
    const box = await target.boundingBox();
    if (!box) throw new Error('missing bounding box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Control');

    await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(1);
    expect(
      await editor
        .locator('.ProseMirror-selectednode')
        .evaluate((el) => el.getAttribute('draggable')),
    ).toBe('true');

    const prevented = await editor
      .locator('.ProseMirror-selectednode')
      .evaluate(
        (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
      );
    expect(prevented).toBe(true);
  });
}

// A plain click node-selects a footnote reference, an inline atom at nonzero depth: the same
// mechanism by another gesture, which a depth-0 guard would miss.
test('clicking a footnote reference to select it starts no native drag', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '本文[^a]です\n\n[^a]: 注釈\n');

  const ref = editor.locator('sup[data-footnote-ref]').first();
  await ref.click();

  await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(1);
  const prevented = await editor
    .locator('.ProseMirror-selectednode')
    .evaluate(
      (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
    );
  expect(prevented).toBe(true);
});

// `image`, `linkCard` and `embed` declare `draggable: true`, so they are native drag sources with
// nothing selected. Chrome drags the picture as a File, which `clearData()` does not remove, and
// useImageUpload read it as an incoming file. The サムネイル badge showing is this unringed state
// (the ring hides it). 390x220, already in data/uploads, as in e2e/image-layout.spec.ts.
const UNRINGED_IMAGE =
  '/uploads/3cf43f6c9f92a311cb0de38736934c4efc6aa3d1d0968206d837e593fbe99107.png';

// The guard is written against the DOM attribute, not a type: the image (reported) and the card
// (§7.2). `embed` is covered by the ringed test, since it needs the X stub.
for (const [kind, markdown, block, press] of [
  ['image', `![](${UNRINGED_IMAGE})\n\n後の段落\n`, '.image-block', '.image-block img'],
  ['link card', `${CARD_MD}\n\n後の段落\n`, '.link-card', '.link-card-title'],
] as const) {
  test(`pressing an unringed ${kind} starts no native drag`, async ({ page }) => {
    await page.goto('/admin/posts/new');
    const editor = page.locator('.ProseMirror');
    await expect(editor).toBeVisible();
    await editor.click();
    await loadMarkdown(page, markdown);
    await expect(editor.locator(press)).toBeVisible({ timeout: 20_000 });

    // Nothing ringed: the state the report was made in.
    await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(0);
    // Marked draggable anyway (`dom.draggable = true` from the spec): Chrome's drag source.
    expect(await editor.locator(block).evaluate((el) => el.getAttribute('draggable'))).toBe('true');

    // On what a press really targets (picture, title), so the guard must walk up to the source.
    // Asserted at the seam (e2e/native-drag.ts).
    const prevented = await editor
      .locator(press)
      .evaluate(
        (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
      );
    expect(prevented).toBe(true);
  });
}

// The scope control: a text drag out of a blockquote is the gesture every drop guard is built on
// (useDragContainment.ts), so the refusal is keyed on `draggable`, not the container type.
test('a drag starting on text inside a blockquote is still allowed', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '> 引用文です\n\n後の段落\n');
  await expect(editor.locator('blockquote')).toBeVisible();
  await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(0);

  const prevented = await editor
    .locator('blockquote p')
    .evaluate(
      (el) => !el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true })),
    );
  expect(prevented).toBe(false);
});

// Dragging a ringed block by its body must not paint a text selection. ProseMirror's mousedown
// turns the NodeSelection into a caret and `.ProseMirror-hideselection` stops applying;
// `selectionToDOM` will not fix the DOM selection mid-press, so the mousedown is preventDefault-ed.
// Measured in pixels: `getSelection()` reports the node's range either way and `::selection` has
// no readable style. The idle baseline is taken in the same run.
test('dragging a ringed block by its body paints no text selection', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '> 引用文がここにあります\n\n後の段落\n');

  const block = editor.locator('blockquote');
  const blockBox = await block.boundingBox();
  if (!blockBox) throw new Error('missing bounding box');
  // Inside the block, clear of its 2px outline.
  const clip = {
    x: blockBox.x + 6,
    y: blockBox.y + 4,
    width: blockBox.width - 12,
    height: blockBox.height - 8,
  };
  const idle = await selectionBluePixels(page, clip);

  // Ring it with its handle, then pick it up by its body.
  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  const targetBox = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
  if (!handleBox || !targetBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(1);

  await page.mouse.move(blockBox.x + 60, blockBox.y + 12);
  await page.mouse.down();
  // A short move, then the long one: load-bearing, since a single jump leaves nothing to paint and
  // passes with the fix removed.
  await page.mouse.move(blockBox.x + 70, blockBox.y + 16, { steps: 3 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 10,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  const dragging = await selectionBluePixels(page, clip);
  await page.mouse.up();

  // Before the fix: 3709 against an idle 188.
  expect(dragging).toBeLessThan(idle + 200);
});

// A plain click must still put the caret in a ringed block: with the mousedown preventDefault-ed,
// `LeftMouseDown.up` never moved the selection, and the next key replaced the whole block.
test('a plain click inside a ringed block lands the caret in it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '> 引用文がここにあります\n\n後の段落\n');

  const handle = editor.locator('.block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(1);

  const blockBox = await editor.locator('blockquote').boundingBox();
  if (!blockBox) throw new Error('missing bounding box');
  await page.mouse.click(blockBox.x + 60, blockBox.y + 12);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.querySelector('.ProseMirror') as Element & {
          editor: { state: { selection: { constructor: { name: string } } } };
        };
        return el.editor.state.selection.constructor.name;
      }),
    )
    .toBe('TextSelection');

  await page.keyboard.type('X');
  // Typed into the quote, not over it.
  await expect.poll(() => getMarkdown(page)).toContain('> ');
  expect(await getMarkdown(page)).toContain('引用文がここにあります');
});

// An atom has no interior, so `Selection.near` from the boundary beside it picks the next block's
// text: a re-press on the blank band inside a ringed card or embed moved the selection away.
test('a plain re-press on a ringed link card or embed keeps it selected', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await stubX(page);
  await loadMarkdown(
    page,
    `${CARD_MD}\n\n<div class="embed" data-href="${X_RESIZE_URL}"></div>\n\n後の段落\n`,
  );

  const card = editor.locator('.link-card-view');
  await expect(card.locator('.link-card-title')).toHaveText(CARD_TITLE);
  const embed = editor.locator('.embed-view');
  const frame = embed.locator('.embed-frame');
  await expect.poll(async () => Math.round((await frame.boundingBox())!.height)).toBeGreaterThan(0);

  const selectionType = () =>
    page.evaluate(() => {
      const el = document.querySelector('.ProseMirror') as Element & {
        editor: { state: { selection: { constructor: { name: string } } } };
      };
      return el.editor.state.selection.constructor.name;
    });

  for (const target of [card, embed]) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('missing bounding box');
    // The blank band inside the box's bottom edge, which the dead-zone fix (§8.2) does not touch.
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 8;

    // Setup: a just-loaded embed swallows a first click without selecting (also seen in
    // editor-embed.spec.ts's openSandbox), and the frame's box appears too early to wait on. So press
    // until the ring is on; normally that is one click.
    await expect
      .poll(async () => {
        await page.mouse.click(x, y);
        return target.getAttribute('class');
      })
      .toMatch(/ProseMirror-selectednode/);

    // The claim: a re-press keeps the ring.
    await page.mouse.click(x, y);
    await expect(target).toHaveClass(/ProseMirror-selectednode/);
    expect(await selectionType()).toBe('NodeSelection');
  }
});

// Selection-blue pixels in `clip`, counted in the page (no image decoder here): the browser's
// highlight is far bluer than anything the editor draws.
async function selectionBluePixels(
  page: Page,
  clip: { x: number; y: number; width: number; height: number },
): Promise<number> {
  const shot = await page.screenshot({ clip });
  return page.evaluate(
    async (dataUrl) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let blue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 2] > 140 && data[i + 2] - data[i] > 45 && data[i + 2] - data[i + 1] > 25) {
          blue += 1;
        }
      }
      return blue;
    },
    `data:image/png;base64,${shot.toString('base64')}`,
  );
}

// The dragged embed's own `<iframe>` must not take the pointer (docs/embed-requirements.md §8.1,
// criterion E12): the drag is window `mousemove`, and an iframe swallows it and the `mouseup`. The
// frame is inert at rest, but the selected block's is live, and picking up selects.
//
// **The computed style is asserted, not the freeze**: CDP input bypasses the hit-test routing an
// out-of-process frame relies on, so the parent keeps getting moves over it either way. The swallow
// was measured on a same-origin frame, where CDP does route into it.
test('an embed being dragged does not let its own iframe take the pointer', async ({ page }) => {
  await stubX(page);
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, `前の段落\n\n<div class="embed" data-href="${X_RESIZE_URL}"></div>\n`);

  const frame = editor.locator('.embed-view .embed-frame iframe');
  await expect(frame).toBeVisible();
  const pointerEvents = () =>
    frame.evaluate((el) => getComputedStyle(el as HTMLElement).pointerEvents);
  // With the caret in the paragraph the frame is inert; `loadMarkdown` selects the embed.
  await editor.locator('p').first().click();
  await expect(editor.locator('.ProseMirror-selectednode')).toHaveCount(0);
  expect(await pointerEvents()).toBe('none');

  const handle = editor.locator(':scope > .block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error('missing bounding box');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Past DRAG_THRESHOLD, where `body.block-dragging` is set.
  await page.mouse.move(handleBox.x + 30, handleBox.y + 40);
  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains('block-dragging')))
    .toBe(true);
  // Now the NodeSelection, which used to wake its frame.
  await expect(editor.locator('.ProseMirror-selectednode.embed-view')).toHaveCount(1);
  expect(await pointerEvents()).toBe('none');

  await page.keyboard.press('Escape');
  await page.mouse.up();
  // Over, still selected, so the player is reachable again.
  await expect(editor.locator('.ProseMirror-selectednode.embed-view')).toHaveCount(1);
  await expect.poll(pointerEvents).toBe('auto');
});

// The link card's ghost carries its face, not its controls (docs/link-card-requirements.md §7.5).
// Both halves fail alone: the controls must go, and the box needs a width, since the band held it
// open (the splinter of docs/embed-requirements.md §10.10).
test('the card ghost carries the card’s face, not its controls', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(
    page,
    '段落A\n\n<div class="link-card" data-href="/posts/second-post"></div>\n\n' +
      '段落B\n\n<div class="link-card" data-href=""></div>\n\n段落C\n',
  );
  await expect(editor.locator('.link-card-view')).toHaveCount(2);
  // Resolved first, or there is no title to carry.
  await expect(editor.locator('.link-card-title').first()).toHaveText(CARD_TITLE);

  const ghost = page.locator('.block-drag-preview');
  const carry = async (nth: number) => {
    const handles = editor.locator(':scope > .block-drag-handle');
    const box = await handles.nth(nth).boundingBox();
    if (!box) throw new Error('missing bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 60);
    await expect(ghost).toBeVisible();
    return ghost.evaluate((el) => ({
      controls: el.querySelectorAll('button, input').length,
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
      text: (el.textContent ?? '').trim(),
    }));
  };
  const drop = async () => {
    await page.keyboard.press('Escape');
    await page.mouse.up();
  };

  const cardBox = await editor.locator('.link-card-view').first().boundingBox();
  if (!cardBox) throw new Error('missing bounding box');
  const resolved = await carry(0);
  await drop();
  expect(resolved.controls).toBe(0);
  expect(resolved.text).toBe(CARD_TITLE);
  expect(resolved.width).toBe(400);
  // Shorter than the card: its document margin and floor mean nothing under the cursor.
  expect(resolved.height).toBeLessThan(cardBox.height);

  // The picker has no face, so it is named, as the embed's token is (§10.10).
  const picker = await carry(1);
  await drop();
  expect(picker.controls).toBe(0);
  expect(picker.text).toBe('リンク先未設定のカード');
  expect(picker.width).toBe(400);
});

// The source shows as cut while the drag has a real target, bound to the same answer as the line
// (docs/link-card-requirements.md §7.6). Three states: off in the no-op stretch, on with a target,
// gone when the session ends.
test('the source block shows as cut only while the drop would move it', async ({ page }) => {
  await page.goto('/admin/posts/new');
  const editor = page.locator('.ProseMirror');
  await expect(editor).toBeVisible();
  await editor.click();
  await loadMarkdown(page, '段落A\n\n> 引用文がここにあります\n\n段落B\n\n段落C\n\n段落D\n');

  const quote = editor.locator('blockquote');
  const quoteBox = await quote.boundingBox();
  const handle = editor.locator(':scope > .block-drag-handle').first();
  const handleBox = await handle.boundingBox();
  if (!handleBox || !quoteBox) throw new Error('missing bounding box');
  // A box on <body>, not a class (block-drag-handle.ts says why), so it is read as geometry, against
  // the block's live box in the same frame: the page autoscrolls, so a box taken before the drag is
  // a different coordinate frame.
  const cut = () =>
    page.evaluate(() => {
      const el = document.querySelector('.block-drag-cut') as HTMLElement | null;
      if (!el || el.style.display === 'none') return null;
      const v = el.getBoundingClientRect();
      const q = document.querySelector('.ProseMirror blockquote')!.getBoundingClientRect();
      return {
        top: q.top - v.top,
        bottom: v.bottom - q.bottom,
        left: q.left - v.left,
        right: v.right - q.right,
      };
    });
  const lineShown = () =>
    page.evaluate(() => {
      const el = document.querySelector('.block-drag-indicator') as HTMLElement | null;
      return !!el && el.style.display !== 'none';
    });

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();

  // Inside the block's height: the drop changes nothing, so nothing is marked.
  await page.mouse.move(handleBox.x + 200, quoteBox.y + quoteBox.height / 2);
  expect(await lineShown()).toBe(false);
  expect(await cut()).toBeNull();

  // Far enough for a real gap: line and cut arrive together.
  await page.mouse.move(handleBox.x + 200, quoteBox.y + quoteBox.height + 300);
  expect(await lineShown()).toBe(true);
  const veil = await cut();
  expect(veil).not.toBeNull();
  // Exactly the block's box plus the ring (`CUT_INFLATE`), at any frame rate, since it is drawn in
  // document coordinates.
  if (!veil) throw new Error('unreachable');
  expect([veil.top, veil.bottom, veil.left, veil.right]).toEqual([4, 4, 4, 4]);

  // End the session while it shows: the mark must not survive.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await cut()).toBeNull();
});
