import { test, expect, type Page } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { docString } from './editor-probe';

async function getMarkdown(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector('.ProseMirror') as Element & {
      editor: { storage: { markdown: { getMarkdown: () => string } } };
    };
    return el.editor.storage.markdown.getMarkdown();
  });
}

// A card the seeded DB can resolve (e2e/prepare-db.mts), in the stored reference-only form —
// the same constants editor-link-card.spec.ts uses.
const CARD_HREF = '/posts/second-post';
const CARD_TITLE = 'React Server Components を学ぶよ';
const CARD_MD = `<div class="link-card" data-href="${CARD_HREF}"></div>`;

// One handle per matching top-level node (components/editor/block-drag-handle.ts); a plain
// paragraph gets none. Structural check, no dragging involved.
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

// A blockquote nested inside a callout must not get its own handle — decorations() only scans
// state.doc's direct children, so a nested instance is excluded by construction rather than by
// an extra check. This is the behavior confirmed during the design discussion.
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

// mousedown on the handle must select the whole node — not just place a cursor in it. This also
// covers the plain-click path: DragController only starts tracking movement (block-drag-handle.ts's
// DRAG_THRESHOLD) once the pointer actually moves, so a bare mousedown+mouseup with no motion in
// between — exactly what this test does — must leave the NodeSelection as the only effect.
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

// End-to-end reorder via the handle, covering the two structurally different cases: a plain node
// (blockquote) and a node prosemirror-tables wraps in an extra `.tableWrapper` div (table). Dragging
// is DragController's own mousemove/mouseup tracking (block-drag-handle.ts), not native HTML5
// drag-and-drop, so a plain page.mouse sequence drives it end-to-end — no CDP-level drag synthesis
// needed (contrast table-drop-guard.spec.ts, which still needs it for actual native DnD elsewhere).
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
    // Past DRAG_THRESHOLD so DragController treats it as a drag, then on to just past the
    // following paragraph's bottom — findBoundary() resolves that to "insert after it".
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
      steps: 6,
    });
    await expect(page.locator('.block-drag-indicator')).toBeVisible();
    // The pointer is now well past the source block, so CSS :hover/:has(+ :hover) no longer
    // targets its handle — DragController's `is-dragging` class (block-drag-handle.ts) is what
    // keeps it visible instead, matching how native HTML5 drag used to freeze :hover in place.
    await expect(handle).toHaveClass(/is-dragging/);
    await expect(handle).toHaveCSS('opacity', '1');
    // The cursor-following preview (block-drag-handle.ts's DragController.ensurePreview) is up too,
    // showing a clone of what's actually being moved.
    const preview = page.locator('.block-drag-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator(kind === 'blockquote' ? 'blockquote' : 'table')).toHaveCount(1);
    await page.mouse.up();
    await expect(handle).not.toHaveClass(/is-dragging/);
    // The drop path clears it too, not just Escape/abort (covered separately).
    await expect(preview).toBeHidden();

    // Moved, not copied: the block now comes after "後の段落", and there's exactly one of it.
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

// The link card (docs/link-card-requirements.md §7.2), which is the one target type that is both an
// atom and a NodeView. Three things at once, because they only hold together: the handle belongs to
// the card, the drag reorders it, and the card comes out the other side still pointing at the same
// post. The last one is the point — the card stores a reference and nothing a reader sees (§4.2), so
// a move that dropped `data-href` would leave a card that had silently forgotten its target, which
// is exactly the shape of the failure §7.1 recovered from the WAL. The reference is therefore
// asserted on the saved markdown, not on the rendered title (which the NodeView refetches and would
// happily redraw over an empty attribute).
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

  // The handle exists and is the card's own: `decorations()` places it immediately before its
  // target, so the sibling right after it is the thing it would drag.
  const handle = editor.locator('.block-drag-handle');
  await expect(handle).toHaveCount(1);
  const targetClass = await page.evaluate(
    () =>
      document.querySelector('.ProseMirror > .block-drag-handle')?.nextElementSibling?.className ??
      null,
  );
  expect(targetClass).toContain('link-card-view');

  // Resolved first, so the preview assertion below is about a real card rather than a card still
  // waiting on `/api/posts/search`.
  await expect(editor.locator('.link-card-title')).toHaveText(CARD_TITLE);

  const handleBox = await handle.boundingBox();
  const cardBox = await editor.locator('.link-card-view').boundingBox();
  const targetPara = editor.locator('p', { hasText: '後の段落' });
  const targetBox = await targetPara.boundingBox();
  if (!handleBox || !cardBox || !targetBox) throw new Error('missing bounding box');

  // alignHandles() pins each handle's `top` to its target's `offsetTop`, which is only the right
  // number while the two share an offsetParent (`.ProseMirror`). Asserted for this type because the
  // drag below cannot catch a misalignment — it aims at the handle's own box wherever that box has
  // ended up, so a handle parked at the top of the document would still drive the whole gesture.
  expect(Math.abs(handleBox.y - cardBox.y)).toBeLessThan(8);

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, {
    steps: 6,
  });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  // The preview clones the NodeView's own DOM, so what follows the cursor is the card as drawn —
  // not the empty `div.link-card` the document actually stores.
  const preview = page.locator('.block-drag-preview');
  await expect(preview.locator('.link-card-view')).toHaveCount(1);
  await expect(preview.locator('.link-card-title')).toHaveText(CARD_TITLE);
  await page.mouse.up();

  expect(errors).toEqual([]);
  // Moved, not copied. TrailingNode adds the empty paragraph, since the card is now the last block.
  await expect.poll(() => docString(page)).toBe('doc(paragraph("後の段落"), linkCard, paragraph)');
  expect(await getMarkdown(page)).toContain(CARD_MD);
});

// The original reported bug, guarded directly: dropping on the very next indicator down (not the
// one after that) must move the block by exactly one slot. Before findBoundary() excluded the
// dragged node from its own candidates (block-drag-handle.ts), its still-full-size `from`/`to`
// gaps sat a full block-height apart, so this exact drop was a no-op and you needed to cross both
// before anything moved. No settle-then-remeasure dance needed here (contrast an earlier,
// collapse-based version of this fix): nothing reflows anymore, so `boxB`'s position is stable for
// the whole gesture.
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
  // Into B's lower half — the very next indicator stop below the dragged blockquote.
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height - 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.mouse.up();

  expect(await getMarkdown(page)).toBe('B\n\n> A\n\nC');
});

// The indicator must stay hidden while the pointer is still over the dragged block's own
// (unmoving) rect — the "inSourceBounds" check in handleMouseMove (block-drag-handle.ts). Without
// it, right at drag start (pointer barely past the handle, still over the block's own top) the
// indicator would already show at the nearest real candidate — semantically a no-op, but visually
// far away for a tall block, reading as reacting before you've gone anywhere.
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
  // Past DRAG_THRESHOLD but still within A's own rect (its bottom, minus a couple px).
  await page.mouse.move(handleBox.x + handleBox.width / 2, boxA.y + boxA.height - 2, { steps: 3 });
  await expect(page.locator('.block-drag-indicator')).toBeHidden();

  // Now into B's lower half — outside A's rect, a real candidate.
  await page.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height - 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await page.mouse.up();
});

// The mirror of the downward case above, exercising applyMove's *other* branch: dragging up to a
// gap that sits before the dragged node, so `tr.mapping.map(target)` is a no-op (the delete happens
// entirely after the target) rather than shifting it. Guards the off-by-one that a single-direction
// test would miss. A blockquote after a paragraph, dragged onto the paragraph's top half, must land
// before it.
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
  // Past DRAG_THRESHOLD, then into the preceding paragraph's top half — findBoundary() resolves
  // that (clientY < the paragraph's vertical midpoint) to "insert before it".
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 2, { steps: 6 });
  await expect(page.locator('.block-drag-indicator')).toBeVisible();
  await expect(handle).toHaveClass(/is-dragging/);
  await page.mouse.up();
  await expect(handle).not.toHaveClass(/is-dragging/);

  // Moved, not copied: the blockquote now comes before "前の段落", and there's exactly one of it.
  await expect
    .poll(async () => {
      const md = await getMarkdown(page);
      return md.indexOf('引用文') < md.indexOf('前の段落');
    })
    .toBe(true);
  await expect(editor.locator('blockquote')).toHaveCount(1);
});

// While dragging, the pointer sweeps over other blocks on its way to the drop target — a real
// mousemove, unlike the frozen :hover of the old native-drag implementation, so without the
// `body.block-dragging` CSS guard (globals.css) those blocks' own handles would pop up too via the
// same :has(+ :hover) reveal that shows them on a plain hover.
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
  // `cursor` is set directly on .block-drag-handle, which normally beats an ancestor's
  // `!important` (that only wins among rules targeting the same element) — pointer-events: none
  // on non-dragged handles (globals.css) is what actually keeps the pointer from landing on B's
  // handle at all, so elementFromPoint here must resolve to something else, and that resolved
  // element (not handleB's own irrelevant computed style) is what the browser bases the visible
  // cursor icon on.
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

// Escape must abort the drag without dispatching a transaction — no reorder, no stray undo-history
// entry (block-drag-handle.ts's DragController.handleKeyDown).
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

// The cursor-following preview (block-drag-handle.ts's DragController.ensurePreview) is a plain
// DOM clone of the dragged node, not a decoration — no `view.dom` relationship to verify, just
// that it shows the right content while dragging and is cleared once the session ends.
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

// Pressing an edit key mid-drag must neither crash nor mutate the doc. The dragged block carries a
// NodeSelection, so without suppression ProseMirror's deleteSelection removes it on Delete: the doc
// shrinks, and applyMove's mousedown-captured from/to (block-drag-handle.ts) then point past the
// end → "Position … out of range" thrown from the mouseup handler (surfacing as a pageerror). The
// plugin's handleKeyDown swallows edit keys for the drag's duration, so the block survives and the
// drop still reorders it. Uses the table (the type from the original report) as the dragged block.
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

// The table's own floating toolbar (components/editor/TableToolbar.tsx, a TipTap BubbleMenu) is
// anchored to the table's on-screen position and only re-checks that position/visibility on an
// editor transaction — but nothing dispatches one for the length of a raw mousemove-driven drag
// (block-drag-handle.ts), so without the `body.block-dragging` CSS suppression (globals.css) it
// would just sit there, stale, next to the cursor-following drag preview for the whole gesture.
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

  // The drop moved the table, so it's still node-selected and still a table — the toolbar returns.
  await expect(toolbar).toBeVisible();
});

// Regression for a follow-on bug in the fix above: hiding the toolbar during the drag isn't enough
// on its own — endSession() lifts the `.table-toolbar` CSS suppression the instant the drag ends,
// synchronously and before the drop's own transaction has repositioned the menu. With the bubble
// menu's default 250ms updateDelay, that reposition is scheduled via setTimeout, so the menu would
// reappear at its stale (pre-drag) spot and visibly jump to the new one up to 250ms later —
// TableToolbar.tsx's `updateDelay={0}` routes the reposition through the plugin's synchronous
// branch instead, landing it in the same synchronous-plus-microtask window as the drop, before any
// paint. Asserted here by comparing the position read immediately after `mouse.up()` (no wait)
// against the same read after settling — they must already match.
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

// Dragging onto the footnote definitions' section. `block+ footnoteSection?` (footnote-extension.ts)
// pins the section past the last place a block may go, so the gap at `doc.content.size` — which
// findBoundary() used to return for any pointer below the last child's midpoint — is not a legal
// target. The failure was silent in the document and loud in the console: `tr.insert` refuses an
// unfittable slice by adding no step at all (`replaceStep` returns null), so the doc came back
// byte-identical and only `NodeSelection.create` reacted, throwing "Cannot read properties of null
// (reading 'nodeSize')" out of the mouseup handler. A doc-shape assertion alone therefore passes
// either way — the pageerror watch is what actually discriminates, so it leads here.
//
// Post-fix the whole band from the last real block downwards resolves to the gap *above* the
// section, which is the only schema-valid answer. The drop target Y is derived from the section's
// own rect rather than a fixed offset, so a change in the definitions' height can't quietly move
// this test off the zone it means to cover.
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
  // Into the section's own lower half — the deepest the pointer can go and still be over content,
  // and the position that used to resolve to "after the section".
  await page.mouse.move(sectionBox.x + sectionBox.width / 2, sectionBox.y + sectionBox.height - 2, {
    steps: 8,
  });
  const indicator = page.locator('.block-drag-indicator');
  await expect(indicator).toBeVisible();
  // The indicator is drawn at the last *block*'s bottom edge, so it never appears below the
  // definitions promising a drop that cannot happen.
  const indicatorBox = await indicator.boundingBox();
  if (!indicatorBox) throw new Error('missing bounding box');
  expect(indicatorBox.y).toBeLessThanOrEqual(sectionBox.y);
  await page.mouse.up();

  expect(errors).toEqual([]);
  // Moved, not copied, and landed above the section — which is still the document's last child.
  // (TrailingNode adds the empty paragraph, since the blockquote is now the last block before it.)
  await expect
    .poll(() => docString(page))
    .toBe(
      'doc(paragraph("本文", footnoteReference), blockquote(paragraph("引用文")), paragraph, footnoteSection(footnoteDefinition("注釈テキスト")))',
    );
});

// The visual counterpart to the NodeSelection test above: clicking a handle (no drag) node-selects
// the block, which must be visibly ringed (globals.css `.ProseMirror-selectednode` outline) so it's
// clear which block is selected — and thus what a Delete would remove. Element-agnostic: assert on
// the class, since which element carries it varies by type (a bare node vs a NodeView/table wrapper).
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
