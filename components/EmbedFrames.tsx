'use client';

import { useEffect } from 'react';
import { embedFallbackAnchor } from '@/lib/embed-fallback';
import {
  EMBED_DWELL_MS,
  EMBED_SILENCE_MS,
  EMBED_VISIBLE_THRESHOLD,
  gistAsk,
  readGistCall,
  readXCall,
  X_ORIGIN,
} from '@/lib/embed-message';

// Makes the published X embeds usable in the reader's browser (docs/embed-requirements.md §10.5,
// §10.6). The body itself stays server-rendered; this only attaches behaviour after mount, the
// arrangement `CodeCopyButtons` already uses, and renders nothing.
//
// Two things cannot be decided at build time, because both are answers the provider only gives once
// its iframe is on screen:
//
//   1. **The height.** A post's height is its content's, not a ratio, so the box is published at a
//      guess and corrected from the provider's own `resize` message.
//   2. **Whether the post exists at all.** A deleted, private or absent post yields an iframe that
//      is completely empty — no text, no link, transparent — so a reader who got no fallback would
//      see a blank gap where the author put a reference (§10.6, measured 2026-08-23).
//
// **This file speaks X's protocol, and that is the cost §10.7 identified.** A wrapper iframe on an
// origin of our own would normalise every provider onto one `{type:"resize"}` message, the way Zenn
// and Qiita do; without one, the parent has to understand the provider it is talking to. Which is
// why the selector below is `.embed-x` and not `.embed`: a YouTube box holds its own ratio and
// never sends anything, so treating it as silent-and-therefore-broken would replace a working
// player with a link.
export function EmbedFrames({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    // Every X box on the page, keyed by the id its iframe was given. A box leaves this map only by
    // being replaced with a link, which is what makes the fallback one-way: a `resize` arriving
    // afterwards has nothing left to apply to (§10.6).
    const boxes = new Map<string, HTMLElement>();
    // The iframe inside each of those boxes, under the same key. **Kept because the id is a name,
    // not a credential** — see `spokeFor` below, which is the only thing this map exists for
    // besides asking a gist frame to speak.
    const frames = new Map<string, HTMLIFrameElement>();
    // The clocks still running, and the ids that have said anything at all. **These are separate
    // from `boxes` on purpose.** A box that has reported a height is no longer at risk of being
    // mistaken for a missing post, but it must stay listening — the provider re-sends `resize`
    // whenever the width changes (§10.5), so it is never done talking.
    const timers = new Map<string, number>();
    const answered = new Set<string>();

    // **Two providers, one map.** The selector is not `.embed` — a YouTube box holds its own ratio
    // and never sends anything, so a clock armed for it would replace a working player with a link
    // (§10.5). It is these two because these two answer: X because X wrote its iframe that way, the
    // gist because the document around GitHub's script is one this codebase writes (§18.5).
    root
      .querySelectorAll<HTMLElement>('.embed-x[data-embed-id], .embed-gist[data-embed-id]')
      .forEach((box) => {
        const id = box.dataset.embedId;
        if (!id) return;
        boxes.set(id, box);
        // A box `rehypeEmbed` built always holds one. A box without one keeps its clock — nothing
        // can legitimately speak for it, so silence is the only answer it can give.
        const iframe = box.querySelector('iframe');
        if (iframe) frames.set(id, iframe);
      });
    if (boxes.size === 0) return;

    // **Ask the gist frames to speak, rather than only waiting for them to.** A frame's document
    // parses with the page around it, while this listener is attached on hydration — measured
    // 2026-08-29, an announcement sent in that gap was lost and the box kept its published guess.
    // Asked on mount for a frame already loaded, and again on `load` for one that was not (every
    // embed here is `loading="lazy"`, so below the fold that is much later).
    const asked: { iframe: HTMLIFrameElement; onLoad: () => void }[] = [];
    boxes.forEach((box, id) => {
      if (!box.classList.contains('embed-gist')) return;
      const iframe = frames.get(id);
      if (!iframe) return;
      const ask = () => iframe.contentWindow?.postMessage(gistAsk(), '*');
      iframe.addEventListener('load', ask);
      asked.push({ iframe, onLoad: ask });
      ask();
    });

    const stopClock = (id: string) => {
      const timer = timers.get(id);
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timers.delete(id);
    };

    const applyHeight = (id: string, height: number) => {
      const box = boxes.get(id);
      if (!box) return;
      // It spoke, so it is not missing. Stopping the clock here is the whole difference between a
      // timeout that guards against silence and one that expires on every working embed.
      answered.add(id);
      stopClock(id);
      const frame = box.querySelector<HTMLElement>('.embed-frame');
      if (frame) frame.style.height = `${height}px`;
    };

    const fallBack = (id: string) => {
      const box = boxes.get(id);
      const href = box?.dataset.href;
      if (!box || !href) return;
      boxes.delete(id);
      frames.delete(id);
      stopClock(id);
      const spec = embedFallbackAnchor(href);
      const anchor = document.createElement('a');
      anchor.href = spec.href;
      anchor.textContent = spec.text;
      anchor.target = spec.target;
      box.replaceWith(anchor);
    };

    // Whether this message came from the frame that owns the placement it names.
    //
    // **The id is a name, not a credential** (§18.5, corrected 2026-09-01). It is published in the
    // markup as `data-embed-id` and minted as `emb-0`, `emb-1`, …, and every iframe on the page
    // posts onto this one bus. Holding only the id was enough while every frame here held a
    // document its own provider wrote; §20 and §21 put frames on the page whose contents are
    // written by whoever made that sandbox or pen, and one of those can name another placement and
    // have its box replaced with a link or its height set to anything. The editor's NodeView has
    // asked this question since §10.10 — it holds one frame and compares against it directly — and
    // this is the same check for the surface that holds many.
    const spokeFor = (id: string, source: MessageEventSource | null): boolean => {
      const frame = frames.get(id);
      return frame !== undefined && frame.contentWindow !== null && source === frame.contentWindow;
    };

    const onMessage = (event: MessageEvent) => {
      // Our own reporter first. **Its `event.origin` is the string `"null"`**, because the frame is
      // sandboxed without `allow-same-origin` — so the source window is the whole of its
      // authentication, and there is no constant to compare an origin against (§18.5). A gist that
      // drew no files is this provider's `no_results`: GitHub's script writes nothing at all for an
      // id that no longer resolves.
      const gist = readGistCall(event.data);
      if (gist !== null) {
        if (!spokeFor(gist.id, event.source)) return;
        if (gist.files === 0) fallBack(gist.id);
        else applyHeight(gist.id, gist.height);
        return;
      }
      if (event.origin !== X_ORIGIN) return;
      const call = readXCall(event.data);
      if (!call?.id) return;
      // The origin above says "an X frame", not "this X frame": every X embed on the page is served
      // from the same origin, so without this one of them could resize or retire another (§10.10).
      if (!spokeFor(call.id, event.source)) return;
      const height = call.params?.[0]?.height;
      // `rendered` and `results` are acknowledged only by being ignored: the two that decide
      // anything are the height and the absence of a post.
      if (call.method === 'twttr.private.resize' && typeof height === 'number') {
        applyHeight(call.id, height);
      } else if (call.method === 'twttr.private.no_results') {
        fallBack(call.id);
      }
    };
    window.addEventListener('message', onMessage);

    // **Crossing the viewport is not being seen** (2026-09-11). A reader landing on `#heading` is
    // carried past everything above the anchor, and the box above the landing point is intersecting
    // for only ~156ms while that scroll runs — which armed its clock and, eight seconds later,
    // replaced a post the reader never looked at with a link. That is the misfire X6 exists to
    // prevent, and whether it happened was a race between the scroll and this observer's first
    // callback, so it went both ways on the same code. A box now has to stay for `EMBED_DWELL_MS`
    // before it counts, which settles the race rather than tuning it.
    const dwells = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const box = entry.target;
          if (!(box instanceof HTMLElement)) continue;
          const id = box.dataset.embedId;
          if (!id) continue;
          if (!entry.isIntersecting) {
            // Carried off before it had been there long enough. The box stays observed, because
            // nothing has been decided about it yet — a reader who scrolls back to it must still
            // start its clock.
            const dwell = dwells.get(id);
            if (dwell !== undefined) {
              window.clearTimeout(dwell);
              dwells.delete(id);
            }
            continue;
          }
          // `answered` is checked because the two are not ordered: an embed visible at first paint
          // can report its height before this callback ever runs, and arming a clock for it would
          // replace a working post eight seconds later.
          if (!boxes.has(id) || answered.has(id) || timers.has(id) || dwells.has(id)) continue;
          dwells.set(
            id,
            window.setTimeout(() => {
              dwells.delete(id);
              // Dwelt on once is enough — a box the reader has read and scrolled past is not a
              // second chance to fail — so this is where the observer lets go of it.
              observer.unobserve(box);
              // Re-asked rather than carried down from above: `EMBED_DWELL_MS` has passed since,
              // and a `resize` arriving inside that window is exactly what should call this off.
              if (!boxes.has(id) || answered.has(id) || timers.has(id)) return;
              timers.set(
                id,
                window.setTimeout(() => fallBack(id), EMBED_SILENCE_MS),
              );
            }, EMBED_DWELL_MS),
          );
        }
      },
      { threshold: EMBED_VISIBLE_THRESHOLD },
    );
    boxes.forEach((box) => observer.observe(box));

    return () => {
      window.removeEventListener('message', onMessage);
      asked.forEach(({ iframe, onLoad }) => iframe.removeEventListener('load', onLoad));
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
      dwells.forEach((dwell) => window.clearTimeout(dwell));
    };
  }, [targetId]);

  return null;
}
