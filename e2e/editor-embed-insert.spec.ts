import { test, expect, type Locator, type Page } from '@playwright/test';
import { loadMarkdown, setRange } from './editor-authoring';
import type { Editor } from '@tiptap/react';
import { markdown, settle } from './editor-probe';

// The embed's own door (docs/embed-requirements.md §24.1). Browser-only twice over: the slash
// menu's filtering runs in the editor, and the dialog is React rendered beside it.
//
// A URL each of two providers claims, and one no provider does. The first two come from
// `lib/embed-provider.test.ts`'s own fixtures, so a shape that stops resolving fails there first,
// where the reason is visible.
const YOUTUBE = 'https://www.youtube.com/watch?v=hDPybQwAuVo';
const CODEPEN = 'https://codepen.io/flatsato/pen/VwqprLp';
const UNCLAIMED = 'https://example.com/an-article';
// A Figma URL the provider claims but cannot embed: a prototype is the same file behind a different
// view, so `/design/` exists and the author can reach it — which is what earns this provider a
// sentence of its own instead of the generic 「リンクカードにしてください」 (§24.1).
const FIGMA_PROTO = 'https://www.figma.com/proto/7or4V8Tl8YbEFRmMSF3pXe/a-file';
const FIGMA_REFUSAL = '埋め込めるのは /design/ か /file/ の URL です。';
// The other kind of provider sentence: a Docswell video cannot be embedded by any URL (§17.2), so
// the card stays the answer and the sentence only supplies the reason the generic one cannot.
const DOCSWELL_VIDEO = 'https://www.docswell.com/s/someone/vLK7J5V-a-video';
const DOCSWELL_REFUSAL = '動画は埋め込めません。リンクカードにしてください。';
// Same host, a shape with no sentence of its own — the provider answers per URL, not per host.
const DOCSWELL_USER = 'https://www.docswell.com/user/somebody';
// Speaker Deck, the one provider whose hosts do not tell the whole truth (§16.10). The deck page
// is what an author reaches for and what 「Copy link」 hands over, and it never resolves; the id
// lives only inside the embed code. **The snippet is Speaker Deck's own output**, the same string
// `lib/speakerdeck-snippet.test.ts` reads — a hand-written one measures this file’s idea of the
// markup rather than the button's.
const SPEAKERDECK_ID = '9de2f18094b14cbb91b07331eb085e4f';
const SPEAKERDECK_PLAYER = `https://speakerdeck.com/player/${SPEAKERDECK_ID}`;
const SPEAKERDECK_PAGE = 'https://speakerdeck.com/soudai/pgcon21j-tutorial';
// The two strings the registry gives that row — the cell its column prints (the kind, then the
// note in parentheses) and the refusal it earns in place of 「リンクカードにしてください」.
// Spelled out here as the provider names below are: `lib/embed-provider.test.ts` holds the
// registry to carrying them, and this file measures that the dialog draws them.
const SPEAKERDECK_CELL = 'スライド（埋め込みコード）';
const SPEAKERDECK_REFUSAL = 'Share →「Copy iframe code」の内容を貼ってください。';
const SPEAKERDECK_IFRAME = `<iframe class="speakerdeck-iframe" frameborder="0" src="${SPEAKERDECK_PLAYER}" title="実際に使うSQLの書き方 徹底解説 / pgcon21j-tutorial" allowfullscreen="true" allow="web-share" style="border: 0px; width: 100%; height: auto; aspect-ratio: 560 / 315;" data-ratio="1.7777777777777777"></iframe>`;

// The refusal's own words, in one place. **Asserted as the whole sentence, not a fragment of it**:
// every negative below is a `not.toContainText`, and a fragment that stopped matching would make
// all of them pass while measuring nothing. Held together by the positives — reword the dialog
// without touching this and they fail first, which is the only order that cannot go quiet.
const REFUSAL = 'このURLは埋め込めません。リンクカードにしてください。';

// For `paste` above. Chromium does not hand a page the clipboard on its own.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

async function openMenu(page: Page, query: string): Promise<void> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await page.keyboard.type(`/${query}`);
  await expect(page.locator('[data-slash-menu]')).toBeVisible();
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

// **A real paste, not a `fill`.** The dialog treats a pasted URL as finished and a typed one as
// still being typed (§24.1), and `fill` is neither — it sets the value in one change event with no
// paste before it, which is the shape of neither thing the author does. The clipboard is granted
// per file below.
async function paste(page: Page, field: Locator, text: string): Promise<void> {
  await field.click();
  await page.evaluate((value: string) => navigator.clipboard.writeText(value), text);
  await page.keyboard.press('ControlOrMeta+V');
}

// **This is the whole argument for not adding a permanent button.** The reference site opens its
// embed dialog from a 「+」 in the editor chrome, because its editor writes markdown and the syntax
// cannot be remembered. Here the row is found by searching for what the author is holding — and
// untested, that is a hope rather than a mechanism.
test('the embed row is found by the provider an author is thinking of (24a)', async ({ page }) => {
  for (const query of ['youtube', 'figma', 'スライド', 'gist', 'twitter', '埋め込み']) {
    await openMenu(page, query);
    const menu = page.locator('[data-slash-menu]');
    await expect(menu.getByRole('button', { name: '埋め込み' }), query).toBeVisible();
  }
});

// The row must not open a dialog whose insert would then refuse, so it asks the same predicate the
// insert will meet. A table cell is paragraph-only, which is where the link card's row already
// drops out (link-card-requirements.md §5.4).
test('the embed row is not offered where an embed cannot land (24b)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '| a | b |\n| --- | --- |\n| c | d |\n');
  await page.locator('.ProseMirror td').first().click();
  await page.keyboard.type('/');
  // Every row refuses in a cell, so the trigger itself stays inert — `/` is an ordinary character
  // and no menu opens at all (slash-command.ts's `allow`). Asserting the row's absence inside an
  // open menu would be asserting against a menu that is not there.
  await expect(page.locator('[data-slash-menu]')).toHaveCount(0);
  expect(await markdown(page)).toContain('/');
});

test('the dialog lights the provider a URL resolves to, and refuses one no provider claims (24c)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page)).toBeVisible();

  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const lit = dialog(page).locator('li[aria-current="true"]');
  // **The alert exists before it says anything.** A live region has to be in the tree when its
  // text arrives, so this is asserted on the empty dialog — mounting the container together with
  // the refusal is the bug this measures, and it looks identical on screen.
  const alert = dialog(page).locator('[role="alert"]');
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText('');
  // Where the table sits before anything has been said, for the no-shift assertion below.
  const listBefore = (await dialog(page).locator('ul').boundingBox())!.y;
  await expect(field).toHaveAttribute('aria-invalid', 'false');
  // The field points at the alert whether or not it holds anything: an `aria-describedby` that
  // comes and goes on a focused element is what does not get read.
  const describedBy = await field.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(await alert.getAttribute('id')).toBe(describedBy);
  await expect(submit).toBeDisabled();

  // **Typed rather than filled, and not judged while it is on its way.** `fill` sets the value in
  // one event, so it cannot show that a half-typed URL says nothing — which is what was reported.
  await field.click();
  await page.keyboard.type('https://www.you');
  await expect(dialog(page)).not.toContainText(REFUSAL);

  // **Pasted, and answered at once.** The URL arrives whole, so there is nothing to wait for — and
  // this is how a URL reaches this field nearly every time. Waiting for a blur here is what made
  // the dialog feel silent (reported 2026-09-02); the field still has focus when this is asserted.
  await field.fill('');
  await paste(page, field, UNCLAIMED);
  await expect(dialog(page)).toContainText(REFUSAL);
  await expect(field).toBeFocused();
  // **The refusal is announced, and the field says it is the one at fault.** Success already had
  // this treatment — the lit row carries `aria-current` because colour alone reaches neither a
  // reader who does not see it nor one who hears the page — and this is the other half of it.
  await expect(alert).toHaveText(REFUSAL);
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  // **And nothing moved to make room for it.** The alert holds its line while empty, so the table
  // sits where it did before the refusal arrived. Measured as a `y` rather than asserted on the
  // class, because the property is "the table did not move" and a reservation can be lost to a
  // wrapper's gap without the `min-h` going anywhere (both were needed — §24.1).
  const listAfter = (await dialog(page).locator('ul').boundingBox())!.y;
  expect(listAfter).toBe(listBefore);

  // **Re-pasting the same URL changes nothing, so React raises no change event** — and the flag
  // that says "this was pasted" is consumed there. Left set, it would judge the next keystroke as
  // finished and bring the refusal back mid-typing, which is the report this gate exists for
  // (measured 2026-09-02).
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('h');
  await expect(dialog(page)).not.toContainText(REFUSAL);

  await field.fill(YOUTUBE);
  // **The confirmation is the lit row and the button becoming pressable, and nothing else** — the
  // label used to name the provider and the row used to say 「これになります」, which was the same
  // fact three times (§24.1). One row lights, and it is the provider that answered.
  await expect(lit).toHaveCount(1);
  await expect(lit).toContainText('YouTube');
  await expect(submit).toBeEnabled();
  // `toHaveText`, not the role name: `getByRole` matches a substring, so 「YouTube として挿入する」
  // would resolve the same locator and the naming could come back unmeasured.
  await expect(submit).toHaveText('挿入する');

  // **A URL that is on its way to being typed is not judged.** The refusal waits for the author to
  // leave the field or press Enter; `fill` does neither, so nothing is said yet.
  await field.fill(UNCLAIMED);
  await expect(submit).toBeDisabled();
  await expect(lit).toHaveCount(0);
  await expect(dialog(page)).not.toContainText(REFUSAL);

  // Enter is the author saying they are done with it, so now the reason appears.
  await field.press('Enter');
  await expect(dialog(page)).toContainText(REFUSAL);
  expect(await markdown(page)).not.toContain(UNCLAIMED);
  // And editing it away takes the reason with it, rather than leaving it standing over a URL it is
  // no longer about.
  await field.fill(YOUTUBE);
  await expect(dialog(page)).not.toContainText(REFUSAL);

  // **A URL on a claimed host is refused in that provider's own words.** The generic sentence sends
  // the author to the link card, and for a Figma prototype that is a fallback rather than a fix —
  // the same file has a `/design/` URL and Figma's own UI hands it over. Measured beside the
  // generic case above, because what separates them is only whether a provider claimed the host.
  await field.fill(FIGMA_PROTO);
  await field.press('Enter');
  await expect(dialog(page).locator('[role="alert"]')).toHaveText(FIGMA_REFUSAL);
  await expect(dialog(page)).not.toContainText(REFUSAL);
  await expect(submit).toBeDisabled();
  // No row lights: the host matched, the URL did not resolve, and those are not the same question.
  await expect(lit).toHaveCount(0);

  // **The other kind: nothing can embed this, so the card stays and only the reason is added.**
  // Taking 「リンクカードにしてください」 away here would leave a diagnosis with no move behind it,
  // which is the opposite of what the Figma sentence above does (§24.1).
  await field.fill(DOCSWELL_VIDEO);
  await field.press('Enter');
  await expect(dialog(page).locator('[role="alert"]')).toHaveText(DOCSWELL_REFUSAL);

  // **And it is narrow.** A provider's refusal meets every shape that fails on its hosts, so a
  // sentence about videos must not answer for a user page — which the generic one describes
  // correctly and this one would not.
  await field.fill(DOCSWELL_USER);
  await field.press('Enter');
  await expect(dialog(page)).toContainText(REFUSAL);

  // Nothing is said when there is nothing to say: an empty field draws no line at all, which is
  // the state the dialog opens in — even after a refusal has been shown.
  await field.fill(UNCLAIMED);
  await field.blur();
  await expect(dialog(page)).toContainText(REFUSAL);
  await field.fill('');
  await field.blur();
  await expect(dialog(page)).not.toContainText(REFUSAL);
  await expect(dialog(page)).not.toContainText('貼り付けてください');
});

// **The row an author cannot read off its hosts, and the paste that row asks for** (§16.10,
// §24.1). Speaker Deck is the only provider where the address bar is not the answer: a deck page
// carries no id, so `/player/<id>` exists nowhere the author can copy it except inside the embed
// code. The editor already took that snippet as a paste into the body (§16.9); this dialog was a
// fourth entrance that had not been given it, while the table went on naming `speakerdeck.com` as
// though any URL there would do.
//
// **The note and the paste are measured together on purpose.** A row that says "paste the embed
// code" over a field that refuses markup is a worse lie than the one it replaced.
test('the Speaker Deck row asks for the embed code, and the field takes it (24h)', async ({
  page,
}) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page)).toBeVisible();

  const field = dialog(page).getByLabel('URL または埋め込みコード');
  const submit = dialog(page).getByRole('button', { name: '挿入する' });
  const row = dialog(page).getByRole('listitem').filter({ hasText: 'Speaker Deck' });
  // The note is on the row before anything has been pasted: this is the one provider whose address
  // bar is not the answer, and the only place that can be said *before* the paste. **Asserted as
  // the cell's exact text**, since `toContainText` would also pass for a row that had kept the
  // kind and dropped the note. It names the code rather than a button — either Share button's
  // output resolves (§16.9), so 「iframe コード」 would be false for half the authors.
  await expect(row.locator('span').nth(1)).toHaveText(SPEAKERDECK_CELL);
  // The other eight carry a bare kind — without this, putting a note on every row passes, which
  // would be the column repeating what the address bar already answers for them (§16.10).
  await expect(
    dialog(page).getByRole('listitem').filter({ hasText: 'YouTube' }).locator('span').nth(1),
  ).toHaveText('動画');

  // The deck page still refuses: nothing here widened what can be stored (§16.9). **And it refuses
  // in this provider's own words** — the generic sentence sends the author to the link card, which
  // for a deck page is a fallback rather than a fix, since the id they need is not in that URL at
  // all. Said here rather than on the row because this is the moment they have actually pasted the
  // wrong thing.
  await paste(page, field, SPEAKERDECK_PAGE);
  await expect(submit).toBeDisabled();
  await expect(dialog(page).locator('[role="alert"]')).toHaveText(SPEAKERDECK_REFUSAL);
  await expect(dialog(page)).not.toContainText(REFUSAL);

  // The embed code resolves, and it lights the row — `hostOf` of the markup is '', so a dialog
  // that asked the field rather than the resolved reference would enable the button beside nine
  // unlit rows.
  await field.fill('');
  await paste(page, field, SPEAKERDECK_IFRAME);
  await expect(submit).toBeEnabled();
  await expect(dialog(page).locator('li[aria-current="true"]')).toContainText('Speaker Deck');
  await expect(dialog(page).locator('[role="alert"]')).toHaveText('');

  // **What is stored is the player URL, not the markup.** The snippet only ever names a
  // candidate; the reference that lands in the document is rebuilt from the id (§16.9).
  await submit.click();
  await expect(dialog(page)).toHaveCount(0);
  const body = await markdown(page);
  expect(body).toContain(SPEAKERDECK_PLAYER);
  expect(body).not.toContain('<iframe');
});

// The table is the only place an author is told what can be embedded, and it is generated from the
// resolver's registry — `lib/embed-provider.test.ts` holds the list itself to the registry, so what
// is worth measuring here is that the dialog draws all of it.
test('the dialog lists every provider that can be embedded (24d)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page)).toBeVisible();
  for (const name of [
    'YouTube',
    'X',
    'SlideShare',
    'Figma',
    'Speaker Deck',
    'Docswell',
    'GitHub Gist',
    'CodeSandbox',
    'CodePen',
  ]) {
    await expect(dialog(page).getByText(name, { exact: true }), name).toBeVisible();
  }
  await expect(dialog(page)).toContainText('対応 9 件');
});

// **Inserted into the middle of a document, not an empty one.** The author types in a dialog
// outside the editor, so what is under test is that ProseMirror's selection survives the DOM focus
// leaving — and in an empty document the embed lands in the only place there is, which would pass
// either way.
test('the dialog inserts at the line the menu was opened on (24e)', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.locator('.ProseMirror').click();
  await loadMarkdown(page, '前の段落\n\nここに入る\n\n後の段落\n');

  // Put the caret at the end of 「ここに入る」, then open a line under it. **Set, not clicked**: a
  // click resolves the locator and then clicks coordinates, and the editor is still settling after
  // `loadMarkdown` — instrumented 2026-09-02, the caret landed in the *third* paragraph about one
  // run in three, which sent the embed to the end of the document and read as a bug in the insert.
  const end = await page.evaluate((text: string) => {
    const el = document.querySelector('.ProseMirror') as (Element & { editor?: Editor }) | null;
    const editor = el?.editor;
    if (!editor) throw new Error('no live editor on .ProseMirror');
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found !== null) return false;
      if (node.isTextblock && node.textContent === text) found = pos + node.nodeSize - 1;
      return true;
    });
    if (found === null) throw new Error(`no paragraph reading ${text}`);
    return found;
  }, 'ここに入る');
  await setRange(page, end);
  await page.keyboard.press('Enter');
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();

  await dialog(page).getByLabel('URL または埋め込みコード').fill(CODEPEN);
  await dialog(page).getByRole('button', { name: '挿入する' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await settle(page);

  const body = await markdown(page);
  expect(body).toContain(CODEPEN);
  // Between the two paragraphs it was opened between, and above the last one.
  expect(body.indexOf('ここに入る')).toBeLessThan(body.indexOf(CODEPEN));
  expect(body.indexOf(CODEPEN)).toBeLessThan(body.indexOf('後の段落'));
  await expect(page.locator('.ProseMirror .embed-view')).toHaveCount(1);
});

test('Escape and the backdrop close the dialog without inserting (24f)', async ({ page }) => {
  await openMenu(page, 'embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await dialog(page).getByLabel('URL または埋め込みコード').fill(YOUTUBE);
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(await markdown(page)).not.toContain(YOUTUBE);

  // And the field does not remember the abandoned URL the next time it opens — the dialog is the
  // whole of the half-made state here, unlike the card, which leaves an unfinished block behind.
  await page.keyboard.type('/embed');
  await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
  await expect(dialog(page).getByLabel('URL または埋め込みコード')).toHaveValue('');
  await page.locator('div[role="dialog"]').press('Escape');
  await expect(dialog(page)).toHaveCount(0);
});

// §24.1's shape rule. The dialog was a bottom sheet first, and with nine provider rows that came to
// 478px of a 700px screen — it sat in the bottom 68% with the editor's own form fields showing
// above it (reported 2026-09-02), and with a soft keyboard up it would not have fitted at all.
//
// Both viewports in one test on purpose: "it fills the screen" alone would also pass if the
// desktop dialog had become a full-height slab, which is the other way to get this wrong.
test.describe('the dialog is a full screen on a phone and a card on a desktop (24g)', () => {
  const openDialog = async (page: Page) => {
    await page.goto('/admin/posts/new');
    await expect(page.locator('.ProseMirror')).toBeVisible();
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('/embed');
    await page.locator('[data-slash-menu]').getByRole('button', { name: '埋め込み' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    return page.getByRole('dialog').evaluate((el) => {
      const box = el.getBoundingClientRect();
      const host = el.parentElement?.getBoundingClientRect();
      return {
        height: Math.round(box.height),
        // The backdrop rather than `innerHeight`: a headless window counts its scrollbar in the
        // latter, and what the dialog is measured against is the fixed layer it sits in.
        available: Math.round(host?.height ?? 0),
        width: Math.round(box.width),
        outerWidth: Math.round(host?.width ?? 0),
      };
    });
  };

  test.describe('narrow', () => {
    test.use({ viewport: { width: 390, height: 700 } });
    test('fills it', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBe(box.available);
      expect(box.width).toBe(box.outerWidth);
    });
  });

  test.describe('wide', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('does not', async ({ page }) => {
      const box = await openDialog(page);
      expect(box.height).toBeLessThan(box.available);
      expect(box.width).toBeLessThan(box.outerWidth);
    });
  });
});
