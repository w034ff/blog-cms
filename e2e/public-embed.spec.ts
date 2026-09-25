import { test, expect, type Page } from '@playwright/test';
import { expectAutosaved, expectPublished, loadMarkdown, ensureCategory } from './editor-authoring';
import { shot } from './editor-probe';
import { publishedPath } from './published-post';

// The YouTube embed on the published page (docs/embed-requirements.md §6, §9.5). lib/render.test.ts
// covers the string; beyond it: (1) `<iframe>` is not in the sanitize schema, so a published iframe
// proves rehypeEmbed runs after rehypeSanitize; (2) the CSS: the wrapper holds the ratio, since an
// iframe's own `aspect-ratio` negotiates with its replaced-element size. Scoped to `#post-body`:
// `.prose` also matches the two empty footnote popovers.

const ID = 'hDPybQwAuVo';
const SRC = `https://www.youtube-nocookie.com/embed/${ID}`;

async function publish(page: Page, title: string, source: string): Promise<string> {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await page.getByLabel('タイトル').fill(title);
  await loadMarkdown(page, source);

  await expectAutosaved(page);
  await ensureCategory(page);
  await page.getByRole('button', { name: '投稿' }).click();
  await expectPublished(page);

  return publishedPath(page);
}

test('a published reference becomes an iframe in a 16:9 box (§9.5)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed spec',
    `本文の前。\n\n<div class="embed" data-href="https://www.youtube.com/watch?v=${ID}&amp;t=90"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-youtube .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute('src', `${SRC}?start=90`);
  // The third party is asked only when the reader scrolls there (§9.5); the request itself is §8-①.
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // Measured, not read off the stylesheet: the wrapper holds the ratio.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  // The player fills its box.
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);

  await expect(page.locator('#post-body')).toContainText('本文の前。');
  await shot(page, '06-public-embed');
});

test('a reference naming no single video is published as a plain link (Y4)', async ({ page }) => {
  const href = await publish(
    page,
    'Public embed fallback spec',
    '<div class="embed" data-href="https://www.youtube.com/playlist?list=PLabc"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  // A link, not a dropped node, which would silently shorten the body.
  await expect(
    page.locator('#post-body a[href="https://www.youtube.com/playlist?list=PLabc"]'),
  ).toHaveCount(1);
});

test('a hand-written javascript: reference becomes nothing at all (E2)', async ({ page }) => {
  // Both exits refuse it, including the plain-link fallback, also built after sanitize.
  const href = await publish(
    page,
    'Public embed protocol spec',
    '本文。\n\n<div class="embed" data-href="javascript:alert(1)"></div>\n',
  );
  await page.goto(href);

  await expect(page.locator('#post-body')).toContainText('本文。');
  await expect(page.locator('#post-body iframe')).toHaveCount(0);
  expect(await page.locator('#post-body').innerHTML()).not.toContain('javascript:');
});

// docs/embed-requirements.md §14.4, criterion S6. SlideShare is routed to our own blank page: the box
// is measured, not a third party's uptime, and the host's redirect (§14.3) is the reader's browser's.
const DECK = 'https://www.slideshare.net/slideshow/slidesharesample-260753333/260753333';

test('a deck reference is published in a 16:9 + 38px box the player fills (S6)', async ({
  page,
}) => {
  await page.route('https://www.slideshare.net/slideshow/embed_code/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public slideshare spec',
    `本文の前。\n\n<div class="embed" data-href="${DECK}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-slideshare .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    'https://www.slideshare.net/slideshow/embed_code/260753333',
  );
  // Full screen belongs to this attribute, not the `allow` string.
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // Not a ratio: the 38px control row is fixed, so the height is 16:9 plus the row (§14.4), and a
  // ratio assertion would hold at one width only.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(box!.width * (9 / 16) + 38, 0);
  // Wide enough that the check says something about the column.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
});

// docs/embed-requirements.md §15.3, criterion F7. `embed.figma.com` is routed to a blank page, as the
// deck is; the host's redirect is the reader's browser's.
const DESIGN = 'https://www.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe/Figma-sample?node-id=5-2&p=f';

test('a design reference is published in a 16:9 box the viewer fills (F7)', async ({ page }) => {
  await page.route('https://embed.figma.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public figma spec',
    `本文の前。\n\n<div class="embed" data-href="${DESIGN}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-figma .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The key form, node carried, `p=f` dropped (§15.4).
  await expect(iframe).toHaveAttribute(
    'src',
    'https://embed.figma.com/design/7or4V8Tl8YbEFRmMSF3pXe?embed-host=tech-blog&node-id=5-2',
  );
  // Full screen belongs to this attribute, not the `allow` string.
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // Measured, not read off the stylesheet: the wrapper holds the ratio.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  expect(box!.width).toBeGreaterThan(400);
  // The viewer fills the box inside its 1px rule (§15.4, border-box), and must not paint over it.
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height - 2, 0);
  expect(inner!.width).toBeCloseTo(box!.width - 2, 0);
});

// docs/embed-requirements.md §16.4, criterion SD6. Routed to a blank page; no redirect here, since
// the reference is already the player URL (§16.3).
const SLIDES = 'https://speakerdeck.com/player/9de2f18094b14cbb91b07331eb085e4f';

test('a Speaker Deck reference is published in a 16:9 box the player fills (SD6)', async ({
  page,
}) => {
  await page.route('https://speakerdeck.com/player/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public speakerdeck spec',
    `本文の前。\n\n<div class="embed" data-href="${SLIDES}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-speakerdeck .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  await expect(iframe).toHaveAttribute('src', SLIDES);
  // Full screen belongs to this attribute, not the `allow` string.
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // One ratio: Speaker Deck draws controls over the slide (§16.4).
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
  // Wide enough that the check says something about the column.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §17.4, criterion D7. Routed to a blank page.
const DOCSWELL_DECK = 'https://www.docswell.com/s/ku-suke/LK7J5V-hello-docswell#p5';

test('a Docswell reference is published in a slide-plus-control-row box (D7)', async ({ page }) => {
  await page.route('https://www.docswell.com/slide/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public docswell spec',
    `本文の前。\n\n<div class="embed" data-href="${DOCSWELL_DECK}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-docswell .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The embed form from the key, the pointed-at page carried (§17.3).
  await expect(iframe).toHaveAttribute('src', 'https://www.docswell.com/slide/LK7J5V/embed#p5');
  // Full screen belongs to this attribute, not the `allow` string.
  await expect(iframe).toHaveAttribute('allowfullscreen', '');
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // Not a ratio: a fixed 56px bar, so 16:9 plus the bar (§17.4).
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(box!.width * (9 / 16) + 56, 0);
  // Wide enough that the check says something about the column.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §18.4 and §18.5, criteria G7, G10 and G11. **GitHub cannot be stubbed**:
// requests from a frame sandboxed without `allow-same-origin` bypass `page.route` and
// `context.route`. So G7/G10 drive the parent's half with the message the frame would send, and G11
// runs that document against a script served from this file.
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae?file=hello.rb';

// The reporter's message, delivered directly. **`source` is the named box's frame**, which is how the
// listener authenticates (the gist's origin is `"null"`, §18.5); as in editor-embed.spec.ts.
async function report(page: Page, id: string, height: number, files: number): Promise<void> {
  await page.evaluate(
    ([source, embedId, h, n]) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        `#post-body [data-embed-id="${embedId}"] iframe`,
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source, id: embedId, height: h, files: n },
          source: frame?.contentWindow ?? undefined,
        }),
      );
    },
    ['gist-embed', id, height, files] as const,
  );
}

test('a gist is published as a srcdoc whose box follows the report (G7)', async ({ page }) => {
  const href = await publish(
    page,
    'Public gist spec',
    `本文の前。\n\n<div class="embed" data-href="${GIST}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-gist .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // The document is ours; GitHub's script loads inside it (§18.5).
  expect(await iframe.getAttribute('src')).toBeNull();
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-popups');
  const srcdoc = (await iframe.getAttribute('srcdoc'))!;
  expect(srcdoc).toContain(
    'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae.js?file=hello.rb',
  );
  expect(srcdoc).toContain('gist-embed');

  // Published at the guess (§18.4), then corrected. The real gist reports first here, so the claim is
  // that a report moves the box, to a height no gist would have.
  expect((await frame.boundingBox())!.height).toBeLessThan(400);
  await report(page, 'emb-0', 612, 1);
  // **The transition, not the pixel**: the live gist re-measures in the taller box and reports again,
  // 2px under (its 1px rule).
  await expect.poll(async () => (await frame.boundingBox())!.height).toBeGreaterThan(600);
  // Wide enough that the check says something about the column.
  expect((await frame.boundingBox())!.width).toBeGreaterThan(400);
});

// docs/embed-requirements.md §18.5, criterion G12, as the editor's §10.10 test. `data-embed-id` is
// public and sequential, and frames written by a sandbox's or pen's author (§20, §21) can post to
// the parent, so a message counts only from the frame of the box it names.
test('a frame answering under another box’s id is ignored (G12)', async ({ page }) => {
  const href = await publish(
    page,
    'Public gist impersonation spec',
    `<div class="embed" data-href="${GIST}"></div>\n`,
  );
  await page.goto(href);
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);

  // A rogue frame, as a pen's author has, names the gist and reports zero files (G10's retiring
  // message). The wait is on the parent having heard it.
  await page.evaluate(async (victim) => {
    const rogue = document.createElement('iframe');
    rogue.style.cssText = 'position:fixed;left:0;bottom:0;width:10px;height:10px';
    rogue.srcdoc =
      `<script>parent.postMessage({source:'gist-embed',id:${JSON.stringify(victim)},` +
      `height:0,files:0},'*')</script>`;
    document.body.appendChild(rogue);
    await new Promise<void>((resolve) => {
      window.addEventListener('message', function seen(event) {
        if (event.source !== rogue.contentWindow) return;
        window.removeEventListener('message', seen);
        resolve();
      });
    });
  }, 'emb-0');

  // Heard by the page, refused by the box.
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);
  await expect(page.locator(`#post-body a[href="${GIST}"]`)).toHaveCount(0);
  // The box still answers its own frame, or the refusal could be a dead listener.
  await report(page, 'emb-0', 612, 1);
  await expect
    .poll(
      async () => (await page.locator('#post-body .embed-gist .embed-frame').boundingBox())!.height,
    )
    .toBeGreaterThan(600);
});

test('a gist that drew no files is replaced with a plain link (G10)', async ({ page }) => {
  // GitHub writes nothing for a dead id, so the file count is the signal (§18.5), sparing the reader
  // the §10.6 clock.
  const href = await publish(
    page,
    'Public gist fallback spec',
    `<div class="embed" data-href="${GIST}"></div>\n`,
  );
  await page.goto(href);
  await expect(page.locator('#post-body .embed-gist')).toHaveCount(1);

  await report(page, 'emb-0', 250, 0);
  const link = page.locator(`#post-body a[href="${GIST}"]`);
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(page.locator('#post-body iframe')).toHaveCount(0);
});

// docs/embed-requirements.md §20.6, criterion C7. Routed to a blank page: booting CodeSandbox is
// dozens of third-party requests to check a stylesheet number.
const CODESANDBOX_PAGE = 'https://codesandbox.io/p/sandbox/react-example-xgzdk';

test('a CodeSandbox reference is published in a fixed 500px box (C7)', async ({ page }) => {
  await page.route('https://codesandbox.io/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public codesandbox spec',
    `本文の前。\n\n<div class="embed" data-href="${CODESANDBOX_PAGE}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-codesandbox .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // `runonclick=1` is ours, not the author's (§20.5).
  await expect(iframe).toHaveAttribute(
    'src',
    'https://codesandbox.io/embed/react-example-xgzdk?runonclick=1',
  );
  // §20.7's pair: no device asked for, and no `allow-top-navigation`.
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // **Neither a ratio nor a correction**: the resize message is unusable (§20.6), so a fixed 500.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(500, 0);
  // Wide enough that the check says something about the column.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);
});

// docs/embed-requirements.md §21.6, criterion P7. Routed to a blank page, which also keeps §21.13's
// rate challenge out of the suite.
const CODEPEN_PAGE = 'https://codepen.io/flatsato/pen/VwqprLp';

test('a CodePen reference is published in a 450px box that keeps 300px on a narrow column (P7)', async ({
  page,
}) => {
  await page.route('https://codepen.io/*/embed/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }),
  );
  const href = await publish(
    page,
    'Public codepen spec',
    `本文の前。\n\n<div class="embed" data-href="${CODEPEN_PAGE}"></div>\n\n本文の後。\n`,
  );
  await page.goto(href);

  const frame = page.locator('#post-body .embed-codepen .embed-frame');
  await expect(frame).toHaveCount(1);
  const iframe = frame.locator('iframe');
  // **`/pen/` → `/embed/`, no parameter added** (§21.5).
  await expect(iframe).toHaveAttribute('src', 'https://codepen.io/flatsato/embed/VwqprLp');
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
  );
  await expect(iframe).toHaveAttribute('loading', 'lazy');

  // A chosen height (§21.6): 450 wide, the documented 300 narrow.
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeCloseTo(450, 0);
  // Wide enough, as C7.
  expect(box!.width).toBeGreaterThan(400);
  const inner = await iframe.boundingBox();
  expect(inner!.height).toBeCloseTo(box!.height, 0);
  expect(inner!.width).toBeCloseTo(box!.width, 0);

  // Below the breakpoint, 300px, measured on the page rather than read from the media query.
  await page.setViewportSize({ width: 412, height: 915 });
  const narrow = await frame.boundingBox();
  expect(narrow!.height).toBeCloseTo(300, 0);
  expect(narrow!.width).toBeLessThan(400);
});
