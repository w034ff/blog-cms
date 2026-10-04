import { test, expect, devices, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { TEST_DB_PATH } from './constants';
import {
  closeHistory,
  expectAutosaved,
  loadMarkdown,
  selectNode,
  setRange,
} from './editor-authoring';
import { docString, markdown, settle, shot } from './editor-probe';
import { caretPoint, cdpNativeDrag, dragSelect } from './native-drag';

// The まとめ and TL;DR blocks in the editor (docs/summary-requirements.md). What only a browser
// answers: the markdown round trip through markdown-it's DOM, the NodeView's controls, and that each
// route into the document is wired to the rules. The rules themselves are
// components/editor/summary-rules.test.ts's.

const SUMMARY = (overall: string, sections = '') =>
  `<div class="summary">\n\n${overall}${overall ? '\n\n' : ''}${sections}</div>\n`;
const GOOD = (items: string) => `<div class="summary-good">\n\n${items}\n\n</div>\n\n`;
const BAD = (items: string) => `<div class="summary-bad">\n\n${items}\n\n</div>\n\n`;
const TLDR = (text: string) => `<div class="tldr">\n\n${text}${text ? '\n\n' : ''}</div>\n`;

async function openEditor(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  return errors;
}

function count(doc: string, name: string): number {
  return doc.split(`${name}(`).length - 1;
}

// getMarkdown has no trailing newline; the stored form, as written here, has one.
const stored = (md: string) => `${md}\n`;

test.describe('the markdown round trip', () => {
  // Fixed points: each reads back to itself (§4).
  const canonical: Record<string, string> = {
    'both sections, with marks, a link, & and a nested list': SUMMARY(
      '総評は **強調** と a &lt; b & c と [リンク](https://example.com/)。',
      GOOD('- 多機能\n  - 入れ子\n- **良い**') + BAD('- 使いにくい'),
    ),
    '良かった点 only': SUMMARY('総評。', GOOD('- 多機能')),
    '気になった点 only': SUMMARY('総評。', BAD('- 難あり')),
    'no section': SUMMARY('総評。'),
    'an empty section': SUMMARY('総評。', GOOD('- ')),
    'an empty 総評': SUMMARY('', GOOD('- 多機能') + BAD('- 難あり')),
    'nothing at all': SUMMARY(''),
    'a 総評 of two paragraphs': SUMMARY('一段落目。\n\n二段落目。'),
    'a TL;DR': TLDR('要点の一文目。\n\n要点の二文目。'),
    'an empty TL;DR': TLDR(''),
    'both boxes among paragraphs': `${TLDR('要点。')}\n本文。\n\n${SUMMARY('総評。', GOOD('- 良い'))}`,
  };

  for (const [name, source] of Object.entries(canonical)) {
    test(`is a fixed point: ${name}`, async ({ page }) => {
      const errors = await openEditor(page);
      let md = source;
      for (let round = 0; round < 3; round += 1) {
        await loadMarkdown(page, md);
        md = stored(await markdown(page));
        expect(md, `round ${round + 1}`).toBe(source);
      }
      expect(errors).toEqual([]);
    });
  }

  test('puts 良かった点 back before 気になった点', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(page, SUMMARY('総評。', BAD('- 難あり') + GOOD('- 多機能')));
    expect(stored(await markdown(page))).toBe(
      SUMMARY('総評。', GOOD('- 多機能') + BAD('- 難あり')),
    );
  });

  test('demotes a second まとめ and a second TL;DR, losing no text', async ({ page }) => {
    await openEditor(page);
    await loadMarkdown(
      page,
      `${TLDR('一つ目の要点')}\n${TLDR('二つ目の要点')}\n${SUMMARY('一つ目', GOOD('- 良い'))}\n${SUMMARY('二つ目', BAD('- 悪い'))}`,
    );
    const doc = await docString(page);
    expect(count(doc, 'tldr')).toBe(1);
    expect(count(doc, 'summary')).toBe(1);
    for (const text of ['一つ目の要点', '二つ目の要点', '一つ目', '良い', '二つ目', '悪い']) {
      expect(doc).toContain(`"${text}"`);
    }
    expect(doc).toContain('paragraph(bold("気になった点"))');
  });
});

test('a post opened with two まとめ has the second demoted', async ({ page }) => {
  // The first document never passes through a transaction, so this is the onCreate route.
  await openEditor(page);
  await page.getByLabel('タイトル').fill('Summary onCreate spec');
  await page.locator('.ProseMirror').click();
  await page.keyboard.type('下書き');
  await expectAutosaved(page);
  const id = Number(await page.locator('input[name="id"]').inputValue());
  const body = `本文。\n\n${SUMMARY('一つ目')}\n${SUMMARY('二つ目', GOOD('- 良い'))}`;
  const db = new Database(TEST_DB_PATH);
  try {
    // A never-published post keeps its text in `body`; `draft_content` is for edits to a published
    // one. Written where the editor will read it.
    const row = db.prepare('SELECT draft_content FROM posts WHERE id = ?').get(id) as {
      draft_content: string | null;
    };
    if (row.draft_content === null) {
      db.prepare('UPDATE posts SET body = ? WHERE id = ?').run(body, id);
    } else {
      const draft = { ...JSON.parse(row.draft_content), body };
      db.prepare('UPDATE posts SET draft_content = ? WHERE id = ?').run(JSON.stringify(draft), id);
    }
  } finally {
    db.close();
  }
  await page.goto(`/admin/posts/${id}/edit`);
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect.poll(async () => count(await docString(page), 'summary')).toBe(1);
  const doc = await docString(page);
  expect(doc).toContain('"二つ目"');
  expect(doc).toContain('paragraph(bold("良かった点"))');
});

test('the slash menu inserts each box once: まとめ at the end, TL;DR at the caret', async ({
  page,
}) => {
  const errors = await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, '一段落目\n\n二段落目\n');
  await editor.locator('p', { hasText: '一段落目' }).click();
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  const menu = page.locator('[data-slash-menu]');
  await page.keyboard.type('/まとめ');
  await menu.getByRole('button', { name: 'まとめ', exact: true }).click();
  await page.keyboard.type('総評です');
  expect(await docString(page)).toMatch(
    /paragraph\("二段落目"\), summary\(paragraph\("総評です"\)\), paragraph\)$/,
  );

  // Back at the top: TL;DR lands at the caret; neither row is offered a second time.
  await editor.locator('p', { hasText: '一段落目' }).click();
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: 'まとめ', exact: true })).toHaveCount(0);
  await menu.getByRole('button', { name: 'TL;DR' }).click();
  await page.keyboard.type('要点です');
  expect(await docString(page)).toContain('paragraph("一段落目"), tldr(paragraph("要点です"))');

  await editor.locator('p', { hasText: '二段落目' }).click();
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  if (await menu.isVisible()) {
    await expect(menu.getByRole('button', { name: 'TL;DR' })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'まとめ', exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test.describe('on a phone', () => {
  const PIXEL_7 = devices['Pixel 7'];
  test.use({
    viewport: PIXEL_7.viewport,
    userAgent: PIXEL_7.userAgent,
    deviceScaleFactor: PIXEL_7.deviceScaleFactor,
    isMobile: PIXEL_7.isMobile,
    hasTouch: PIXEL_7.hasTouch,
  });

  test('the ＋ drawer lists TL;DR and まとめ before 脚注, and greys them out once used', async ({
    page,
  }) => {
    await openEditor(page);
    await loadMarkdown(page, '本文\n');
    await page.locator('.ProseMirror p').first().click();
    const plus = page.getByRole('button', { name: 'ブロックを追加' });
    await plus.click();
    const rows = page.getByTestId('insert-menu-panel').getByRole('button');
    const names = await rows.allInnerTexts();
    const order = names
      .map((name) => name.trim())
      .filter((name) => ['コードブロック', 'TL;DR', 'まとめ', '脚注'].includes(name));
    expect(order).toEqual(['コードブロック', 'TL;DR', 'まとめ', '脚注']);
    await page.getByRole('button', { name: 'まとめ', exact: true }).click();
    await expect(page.locator('.ProseMirror .summary')).toHaveCount(1);

    await page.locator('.ProseMirror p', { hasText: '本文' }).click();
    await plus.click();
    await expect(page.getByRole('button', { name: 'まとめ', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'TL;DR', exact: true })).toBeEnabled();
  });
});

test('sections are added and removed by the まとめ’s own buttons', async ({ page }) => {
  const errors = await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, SUMMARY('総評。'));

  await editor.getByRole('button', { name: '＋ 気になった点' }).click();
  await page.keyboard.type('悪い');
  await editor.getByRole('button', { name: '＋ 良かった点' }).click();
  await page.keyboard.type('良い');
  // The caret is in a section's list: the toolbar asks `can().toggleOrderedList()` on every render,
  // which threw here before the list toggles were guarded (docs/editor-pitfalls.md §8.4).
  await expect(editor.locator('.summary-controls')).toBeHidden();
  expect(stored(await markdown(page))).toBe(SUMMARY('総評。', GOOD('- 良い') + BAD('- 悪い')));

  // Enter on an empty last item moves on: 良かった点 → 気になった点 → below the まとめ.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('次');
  expect(await docString(page)).toContain('summaryBad(bulletList(listItem(paragraph("次悪い"))');

  // A NodeView's DOM-built icon has no size of its own: the button once rendered 6px square, which
  // a click still reached, so its size is asserted rather than trusted.
  const remove = editor.getByRole('button', { name: '良かった点を削除' });
  const box = await remove.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  await remove.click();
  expect(stored(await markdown(page))).toBe(SUMMARY('総評。', BAD('- 次悪い')));
  await expect(editor.getByRole('button', { name: '＋ 良かった点' })).toBeVisible();

  // The まとめ goes whole from its own title row, sections and all, and one undo brings it back.
  const removeSummary = editor.getByRole('button', { name: 'まとめを削除' });
  const summaryBox = await removeSummary.boundingBox();
  expect(summaryBox?.width ?? 0).toBeGreaterThanOrEqual(24);
  const withSummary = await markdown(page);
  // Its own undo event, apart from the section removal just before it.
  await closeHistory(page);
  await removeSummary.click();
  await expect(editor.locator('.summary')).toHaveCount(0);
  expect(await docString(page)).toBe('doc(paragraph)');
  await page.keyboard.press('Control+z');
  expect(await markdown(page)).toBe(withSummary);
  expect(errors).toEqual([]);
});

test('nothing can be typed after the まとめ', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, `本文\n\n${SUMMARY('総評。')}`);
  const before = await markdown(page);
  await editor.locator(':scope > p').last().click();
  await settle(page);
  await page.keyboard.type('追記');
  await expect(page.getByRole('status')).toContainText('まとめの後ろには何も追加できません');
  expect(await markdown(page)).toBe(before);
});

// A composition's text reaches the document as a DOM read-back, which filterTransaction refuses
// after the browser has already drawn it: the refused text must not stay on screen, and the editor
// must still take input elsewhere.
test('nothing can be composed after the まとめ either, and the screen agrees', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, `本文\n\n${SUMMARY('総評。')}`);
  const before = await markdown(page);
  const trailing = editor.locator(':scope > p').last();
  await trailing.click();
  await settle(page);

  // Playwright cannot compose, so the IME is driven over CDP.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'あ', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: 'あ' });
  await settle(page);

  expect(await markdown(page)).toBe(before);
  await expect(trailing).toHaveText('');
  await editor.locator('p', { hasText: '本文' }).click();
  await settle(page);
  await page.keyboard.press('End');
  await page.keyboard.type('です');
  expect(await markdown(page)).toBe(before.replace('本文', '本文です'));
});

test('a pasted copy of the まとめ lands as ordinary blocks', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, `本文\n\n${SUMMARY('総評。', GOOD('- 良い'))}`);
  await editor.click();
  await selectNode(page, 'summary');
  await page.keyboard.press('Control+c');
  await setRange(page, 3);
  await page.keyboard.press('Control+v');
  const doc = await docString(page);
  expect(count(doc, 'summary')).toBe(1);
  expect(doc).toMatch(
    /^doc\(paragraph\("本文?"\), paragraph\("総評。"\), paragraph\(bold\("良かった点"\)\)/,
  );
});

// The handle draws its line only where the move would land (moveTransaction in
// block-drag-handle.ts): below the まとめ it draws none, and a release there changes nothing, as over
// the source. The gap above 本文 is the control: the same drag draws a line there.
test('the drag handle draws no line below the まとめ, and cannot move the TL;DR there', async ({
  page,
}) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, `${TLDR('要点。')}\n本文\n\n後の段落\n\n${SUMMARY('総評。')}`);
  const before = await markdown(page);
  const handle = editor.locator('.block-drag-handle').first();
  await editor.locator('.tldr').hover();
  const handleBox = await handle.boundingBox();
  const lastPara = await editor.locator('p', { hasText: '後の段落' }).boundingBox();
  const trailing = await editor.locator(':scope > p').last().boundingBox();
  if (!handleBox || !lastPara || !trailing) throw new Error('missing bounding box');
  const indicator = page.locator('.block-drag-indicator');

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  // Control: below 後の段落 (above the まとめ) is a valid gap.
  await page.mouse.move(lastPara.x + lastPara.width / 2, lastPara.y + lastPara.height - 2, {
    steps: 8,
  });
  await expect(indicator).toBeVisible();
  // Below the まとめ: no line.
  await page.mouse.move(trailing.x + trailing.width / 2, trailing.y + trailing.height - 2, {
    steps: 8,
  });
  await expect(indicator).toBeHidden();
  await page.mouse.up();
  expect(await markdown(page)).toBe(before);
  await expect(page.getByRole('status')).toHaveCount(0);
});

// Native drags draw prosemirror-dropcursor's line, kept off the refused gap by DropCursorGuard where
// `dropRuleBreak` refuses; the drop itself is refused with the notice. Asked by position, not count:
// the drag's first dragOver draws a line at its source, and upstream leaves the last line standing
// (up to 5s) when a later position is disabled rather than removing it. The line moves a moment
// after dragOver (measured: 300ms with the guard removed), and the 総評 is the control where the
// same drag draws one.
const DROP_CURSOR = '.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline';
const DROP_CURSOR_DELAY_MS = 300;

test('a native drag shows no drop line below the まとめ and is refused there', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, `本文の段落です\n\n${SUMMARY('総評。')}`);
  const before = await markdown(page);
  const select = async () =>
    dragSelect(
      page,
      await caretPoint(editor.getByText('本文の段落です'), 0),
      await caretPoint(editor.getByText('本文の段落です'), 2),
    );

  const trailing = await editor.locator(':scope > p').last().boundingBox();
  if (!trailing) throw new Error('missing bounding box');
  await cdpNativeDrag(
    page,
    await select(),
    { x: trailing.x + 20, y: trailing.y + trailing.height / 2 },
    async () => {
      await page.waitForTimeout(DROP_CURSOR_DELAY_MS);
      // Read once, not awaited: a retrying assertion waits out the upstream removal timer and
      // passed with the guard removed.
      const tops = await page
        .locator(DROP_CURSOR)
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
      expect(tops.filter((top) => top >= trailing.y - 2)).toEqual([]);
    },
  );
  await expect(page.getByRole('status')).toContainText('まとめの後ろには何も追加できません');
  expect(await markdown(page)).toBe(before);

  // Control: into the 総評, the same drag draws its line.
  const overall = await editor.locator('.summary-body p').first().boundingBox();
  if (!overall) throw new Error('missing bounding box');
  await cdpNativeDrag(
    page,
    await select(),
    { x: overall.x + 10, y: overall.y + overall.height / 2 },
    async () => expect(page.locator(DROP_CURSOR)).toHaveCount(1),
  );
});

test('undo and redo never hold two まとめ', async ({ page }) => {
  await openEditor(page);
  const editor = page.locator('.ProseMirror');
  await loadMarkdown(page, '本文\n');
  await editor.click();
  await closeHistory(page);

  const insert = async () => {
    await editor.locator('p', { hasText: '本文' }).click();
    await settle(page);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/まとめ');
    await page
      .locator('[data-slash-menu]')
      .getByRole('button', { name: 'まとめ', exact: true })
      .click();
    await closeHistory(page);
  };
  await insert();
  // Backspace in an empty まとめ removes it.
  await page.keyboard.press('Backspace');
  await closeHistory(page);
  expect(count(await docString(page), 'summary')).toBe(0);
  await insert();

  const seen: number[] = [];
  for (const key of ['Control+z', 'Control+z', 'Control+z', 'Control+Shift+z', 'Control+Shift+z']) {
    await page.keyboard.press(key);
    seen.push(count(await docString(page), 'summary'));
  }
  expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  expect(seen).toContain(0);
});

test('the published page draws the titles, the columns and the footnotes after the まとめ', async ({
  page,
}) => {
  const { expectPublished, ensureCategory } = await import('./editor-authoring');
  const { gotoPublished } = await import('./published-post');
  await openEditor(page);
  await page.getByLabel('タイトル').fill('Summary publish spec');
  await loadMarkdown(
    page,
    `${TLDR('要点の文。')}\n本文です[^1]。\n\n${SUMMARY('総評の文。', GOOD('- 良い') + BAD('- 悪い'))}\n[^1]: 注釈。\n`,
  );
  await page.locator('.ProseMirror p', { hasText: '本文です' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type('。');
  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoPublished(page);

  const body = page.locator('#post-body');
  await expect(body.locator('.tldr .summary-label')).toHaveText('TL;DR');
  const summary = body.locator('.summary');
  await expect(summary.locator('.summary-label')).toHaveText('まとめ');
  await expect(summary.locator('.summary-section-label')).toHaveText([
    '良かった点',
    '気になった点',
  ]);
  const columns = await summary
    .locator('.summary-body')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  // まとめ, then the footnotes.
  const order = await body.evaluate((el) => {
    const s = el.querySelector('.summary');
    const f = el.querySelector('section[data-footnotes]');
    return s && f ? s.compareDocumentPosition(f) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
  });
  expect(order).toBeTruthy();
  await shot(page, 'summary-published');
});
