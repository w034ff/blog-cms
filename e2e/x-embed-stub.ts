import type { Page } from '@playwright/test';

// A stand-in for X's embed endpoint (docs/embed-requirements.md §10.5).
//
// **The specs must not depend on a third party.** Everything the two surfaces do with an X embed is
// driven by messages the iframe sends, so what has to be exercised is our handling of those three
// outcomes — a height, a missing post, and silence — not X's ability to serve them today. A live
// endpoint would also make "the timeout did not fire" untestable, since a real post answers before
// the clock is interesting.
//
// The route is fulfilled at X's own URL, so `event.origin` is genuinely
// `https://platform.twitter.com` and the origin check in `lib/embed-message.ts` is exercised rather
// than bypassed.
//
// Which outcome an iframe produces is chosen by the post id the author wrote, because that is the
// only part of the src a spec controls — `lib/embed-provider.ts` builds the rest.

// Answers with a height, the way a real post does.
export const X_RESIZE_ID = '1111111111111111111';
// Answers `no_results`: deleted, private, or never existed. Its iframe is empty (§10.6).
export const X_MISSING_ID = '2222222222222222222';
// **Answers nothing, ever.** What a changed entry point would look like, and the only way to
// observe when the silence timeout starts (§10.6).
export const X_SILENT_ID = '3333333333333333333';
// Answers with a height nothing else uses. It exists for the impersonation case (§10.10): a second
// frame carrying another frame's `embedId` has to be told apart from that frame by its number
// alone, so the two must not agree.
export const X_TALL_ID = '4444444444444444444';

export const X_HEIGHT = 420;
export const X_TALL_HEIGHT = 999;

// Long enough to be observable, far below the 8s the timeout allows.
const REPLY_MS = 300;

const url = (id: string) => `https://x.com/ClaudeDevs/status/${id}`;
export const X_RESIZE_URL = url(X_RESIZE_ID);
export const X_TALL_URL = url(X_TALL_ID);
export const X_MISSING_URL = url(X_MISSING_ID);
export const X_SILENT_URL = url(X_SILENT_ID);

function body(id: string, embedId: string): string {
  const call = (method: string, params: string) =>
    `parent.postMessage(JSON.stringify({"twttr.embed":{"jsonrpc":"2.0","method":"twttr.private.${method}","id":${JSON.stringify(embedId)},"params":[${params}]}}), '*');`;
  // A string, which is one of the two forms the real endpoint uses and the one `readXCall` has to
  // parse rather than read straight off `event.data`.
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
    // The name the parent gave this placement. Echoing it back is the whole point of the id: a
    // stub that answered under any other name would be indistinguishable from the `embed-0`
    // collision the id exists to prevent (§10.5).
    const embedId = target.searchParams.get('embedId') ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: body(id, embedId),
    });
  });
}
