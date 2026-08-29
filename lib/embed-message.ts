// What an embed's iframe says back to the page it is on (docs/embed-requirements.md §10.5).
//
// Shared for the reason `lib/embed-provider.ts` is shared: **both surfaces listen.** The published
// page corrects the box's height and degrades a post it cannot fetch to a link (§10.6), and the
// editor's NodeView corrects the same height and tells the author instead — the same two answers,
// two different things done with the second. Writing the protocol out twice is how the two would
// drift apart without anything failing loudly.
//
// **This is X's protocol, not a protocol of ours, and that is the cost §10.7 named.** A wrapper
// iframe on an origin of our own would normalise every provider onto one message, the way Zenn and
// Qiita do. Until there is one, the parent has to understand the provider it is talking to — which
// is also why only `.embed-x` is listened for: a YouTube box holds its own ratio and says nothing,
// so treating silence as failure would replace a working player with a link.

export const X_ORIGIN = 'https://platform.twitter.com';

// The one provider whose iframe answers back, named because **both parent behaviours below are
// this provider's and no other's**: correcting the height, and reading silence as a missing post.
// A surface that arms the clock for every provider replaces a working YouTube player with the
// failure state eight seconds after the reader scrolls to it — measured in the editor 2026-08-24.
// Not a boolean on `EmbedTarget`: the parent has to know WHICH protocol it is speaking, since
// `readXCall` understands one, and a flag would promise a generality that does not exist.
export const X_PROVIDER = 'x';

// Measured 2026-08-23: `resize` lands ~600ms after the iframe becomes visible (~1.1s from a cold
// navigation). Eight seconds is roughly seven times that — long enough that a slow connection is
// not mistaken for a missing post, short enough that nobody is left looking at a blank box.
//
// **The clock is started by visibility and never by load** (§10.6). X sends nothing at all while
// its iframe is off screen, even though the post inside is already drawn, so a clock started at
// load would expire on every embed below the fold and take working posts with it.
export const EMBED_SILENCE_MS = 8000;

// Barely more than zero: the question is "could the reader have seen it", not "how much of it".
export const EMBED_VISIBLE_THRESHOLD = 0.01;

type XParams = { height?: number };

export type XCall = {
  // `twttr.private.resize` and `twttr.private.no_results` are the two that decide anything;
  // `initialized`, `results` and `rendered` also arrive and are acknowledged by being ignored.
  method?: string;
  // The `embedId` this iframe was given. **Without one every iframe on the page answers to
  // `embed-0`** (measured 2026-08-23), which is why both render stages mint one per placement.
  id?: string;
  params?: XParams[];
};

type XEnvelope = { 'twttr.embed'?: XCall };

// The provider posts JSON, historically as a string. Both forms are read; anything that is not one
// of its own calls is ignored rather than guessed at. **The caller must still check `event.origin`**
// — this only parses, and a message shaped like X's can come from anywhere.
export function readXCall(data: string | XEnvelope | null): XCall | null {
  let envelope: XEnvelope | null = null;
  if (typeof data === 'string') {
    try {
      envelope = JSON.parse(data);
    } catch {
      return null;
    }
  } else {
    envelope = data;
  }
  const call = envelope?.['twttr.embed'];
  return call && typeof call.method === 'string' && typeof call.id === 'string' ? call : null;
}

// docs/embed-requirements.md §18.5. **The second protocol here, and the first one that is ours.**
// §10.7 recorded that a wrapper iframe on an origin of our own would normalise every provider onto
// one message; this is that arrangement for a single provider, because GitHub gives no other way to
// learn a gist's height — `.pibb` carries no script, and neither `.pibb` nor `.js` sends CORS
// headers, so nothing can be measured from outside (measured 2026-08-29).
//
// The document is built by `lib/embed-provider.ts` and framed with `srcdoc`, so the reporter inside
// it is written by us. That is what makes this shape a plain object rather than X's nested
// `twttr.embed` envelope.
export const GIST_PROVIDER = 'gist';

// **`event.origin` is the string `"null"` for this one, not an origin to compare against.** The
// frame is sandboxed without `allow-same-origin`, which is what stops the gist's own markup
// reaching the page around it — and the price is an opaque origin. So the parent authenticates by
// the window the message came from (`event.source === iframe.contentWindow`), which is the check the
// editor's NodeView already makes for X, rather than by a constant.
export const GIST_SOURCE = 'gist-embed';

export type GistCall = {
  // The `data-embed-id` this placement was given, as X's `id` is.
  id: string;
  // `document.documentElement.scrollHeight` inside the frame.
  height: number;
  // How many `.gist-file` blocks the script drew. **Zero is how a deleted or private gist is told
  // apart from a slow one** — GitHub's `.js` writes nothing at all for an id that does not resolve
  // (measured 2026-08-29), which no other signal distinguishes from silence.
  files: number;
};

type GistEnvelope = { source?: string; id?: string; height?: number; files?: number };

// Reads one of our own reporter's messages, or null for anything else on the bus. Shaped like
// `readXCall`: it only parses, and the caller must still check where the message came from.
export function readGistCall(data: string | GistEnvelope | null): GistCall | null {
  let envelope: GistEnvelope | null = null;
  if (typeof data === 'string') {
    try {
      envelope = JSON.parse(data);
    } catch {
      return null;
    }
  } else {
    envelope = data;
  }
  if (envelope?.source !== GIST_SOURCE) return null;
  const { id, height, files } = envelope;
  if (typeof id !== 'string' || typeof height !== 'number' || typeof files !== 'number')
    return null;
  return { id, height, files };
}

// What the parent sends *into* a gist frame to make it announce itself (§18.5). The frame's reporter
// answers it with the same message it sends unprompted, so a parent that attached its listener after
// the frame had already spoken is not stuck with the published guess.
export function gistAsk(): { ask: string } {
  return { ask: GIST_SOURCE };
}
