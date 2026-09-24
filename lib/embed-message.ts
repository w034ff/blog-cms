// What an embed's iframe says back to the page (docs/embed-requirements.md §10.5), shared because
// **both surfaces listen**: the published page fixes the height and degrades a missing post to a
// link (§10.6); the editor fixes the height and tells the author.
//
// **This is X's protocol, not ours** (§10.7): without a wrapper iframe of our own, the parent must
// understand each provider. Only `.embed-x` is listened for: a YouTube box says nothing, and treating
// silence as failure would replace a working player.

export const X_ORIGIN = 'https://platform.twitter.com';

// The provider whose iframe answers back: both parent behaviours (height, silence as a missing post)
// are X's alone. A named protocol rather than a flag on `EmbedTarget`, which would promise a
// generality `readXCall` doesn't have.
export const X_PROVIDER = 'x';

// `resize` lands ~600ms after the iframe becomes visible (~1.1s from a cold navigation), so eight
// seconds tells a slow connection from a missing post.
//
// **The clock is started by visibility and never by load** (§10.6): X sends nothing while off
// screen, so a load-started clock would expire every embed below the fold.
export const EMBED_SILENCE_MS = 8000;

// Barely more than zero: "could the reader have seen it".
export const EMBED_VISIBLE_THRESHOLD = 0.01;

// How long a box must STAY on screen to count as seen. **Landing on `#heading` scrolls past the
// boxes above** for a moment, which raced the observer and could arm a clock for a post never
// looked at. Well under the 8s clock. **Only `components/EmbedFrames.tsx` uses it**; the editor has
// no such scroll-past and is left alone until a miss is measured.
export const EMBED_DWELL_MS = 500;

type XParams = { height?: number };

export type XCall = {
  // `twttr.private.resize` and `twttr.private.no_results` are the two that decide anything;
  // `initialized`, `results` and `rendered` also arrive and are acknowledged by being ignored.
  method?: string;
  // The `embedId` both render stages mint per placement; without one every iframe is `embed-0`.
  id?: string;
  params?: XParams[];
};

type XEnvelope = { 'twttr.embed'?: XCall };

// X posts JSON, sometimes as a string; both are read, anything else ignored. **The caller must still
// check the sender**: this only parses.
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

// docs/embed-requirements.md §18.5. **The second protocol, and ours:** GitHub offers no other way to
// learn a gist's height, so lib/embed-provider.ts frames it in a `srcdoc` document with a reporter
// we write, hence a plain object rather than X's envelope.
export const GIST_PROVIDER = 'gist';

// **`event.origin` is `"null"` here**, since the frame is sandboxed without `allow-same-origin`, so
// the parent authenticates by `event.source === iframe.contentWindow`. **Both parents make that
// check; the id is not a credential:** since sandboxes and pens (§20, §21) frame arbitrary code, any
// frame can post under another placement's id. The id says which placement; the source window says
// whether the sender may speak for it.
export const GIST_SOURCE = 'gist-embed';

export type GistCall = {
  // The `data-embed-id` this placement was given, as X's `id` is.
  id: string;
  // The height of the frame's `<body>` box (see `gistDocument` in lib/embed-provider.ts).
  height: number;
  // `.gist-file` blocks drawn. **Zero tells a deleted or private gist from a slow one**: GitHub's
  // `.js` writes nothing for an unresolved id.
  files: number;
};

type GistEnvelope = { source?: string; id?: string; height?: number; files?: number };

// One of our reporter's messages, or null. Like `readXCall`, the caller checks the sender.
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

// Sent into a gist frame to make it announce itself (§18.5), for a parent that started listening
// after the frame spoke.
export function gistAsk(): { ask: string } {
  return { ask: GIST_SOURCE };
}
