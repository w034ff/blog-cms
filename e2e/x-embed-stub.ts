import type { Page } from '@playwright/test';

// A stand-in for X's embed endpoint (docs/embed-requirements.md §10.5). **Specs must not depend
// on a third party**, and a live post would answer before a timeout became testable. Fulfilled at
// X's own URL, so `event.origin` is real and lib/embed-message.ts's origin check runs. The post id
// picks the outcome: it is the only part of the src a spec controls.

// Answers with a height, the way a real post does.
export const X_RESIZE_ID = '1111111111111111111';
// Answers `no_results`: deleted, private, or never existed. Its iframe is empty (§10.6).
export const X_MISSING_ID = '2222222222222222222';
// **Answers nothing, ever.** What a changed entry point would look like, and the only way to
// observe when the silence timeout starts (§10.6).
export const X_SILENT_ID = '3333333333333333333';
// A height nothing else uses, for the impersonation case (§10.10): a frame carrying another's
// `embedId` must be told apart by its number.
export const X_TALL_ID = '4444444444444444444';

export const X_HEIGHT = 420;
export const X_TALL_HEIGHT = 999;

// X's own pace: `resize` lands ~600ms after the iframe shows (EMBED_SILENCE_MS's note in
// lib/embed-message.ts). Not faster: `EmbedFrames` attaches its listener 200-320ms after load under
// suite load, and X's `resize` is fire-and-forget, so a faster reply invents a miss X never makes.
export const REPLY_MS = 600;

const url = (id: string) => `https://x.com/ClaudeDevs/status/${id}`;
export const X_RESIZE_URL = url(X_RESIZE_ID);
export const X_TALL_URL = url(X_TALL_ID);
export const X_MISSING_URL = url(X_MISSING_ID);
export const X_SILENT_URL = url(X_SILENT_ID);

function body(id: string, embedId: string): string {
  const call = (method: string, params: string) =>
    `parent.postMessage(JSON.stringify({"twttr.embed":{"jsonrpc":"2.0","method":"twttr.private.${method}","id":${JSON.stringify(embedId)},"params":[${params}]}}), '*');`;
  // A string, one of the real endpoint's two forms, which `readXCall` has to parse.
  const answer =
    id === X_RESIZE_ID
      ? call('resize', `{"width":550,"height":${X_HEIGHT},"data":{"tweet_id":"${id}"}}`)
      : id === X_TALL_ID
        ? call('resize', `{"width":550,"height":${X_TALL_HEIGHT},"data":{"tweet_id":"${id}"}}`)
        : id === X_MISSING_ID
          ? call('no_results', `{"data":{"tweet_id":"${id}"}}`)
          : '/* silence */';
  return `<!doctype html><meta charset="utf-8"><title>stub</title>
<body style="margin:0;font:14px system-ui">
<div id="post">${id === X_RESIZE_ID ? 'stubbed post' : ''}</div>
<script>
${call('initialized', `{"data":{"tweet_id":"${id}"}}`)}
setTimeout(function () { ${answer} }, ${REPLY_MS});
</script>`;
}

// Must be installed before the navigation that creates the iframes.
export async function stubX(page: Page): Promise<void> {
  await page.route('https://platform.twitter.com/embed/Tweet.html*', async (route) => {
    const target = new URL(route.request().url());
    const id = target.searchParams.get('id') ?? '';
    // Echoing the placement's name is the point: a stub answering under any name would not show the
    // `embed-0` collision the id prevents (§10.5).
    const embedId = target.searchParams.get('embedId') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: body(id, embedId),
    });
  });
}
