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
