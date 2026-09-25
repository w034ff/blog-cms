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

// Makes published X (and gist) embeds work in the reader's browser (docs/embed-requirements.md
// §10.5, §10.6), attached after mount like `CodeCopyButtons`. Two answers exist only once the frame
// is on screen: the height (published as a guess, corrected from `resize`), and whether the post
// exists (a missing one is an empty, transparent iframe, so it becomes a link).
//
// **This speaks X's protocol**, the cost §10.7 identified: without a wrapper iframe of our own
// there is no common `{type:"resize"}` message, so the parent must know the provider.
export function EmbedFrames({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;

    // Every box, keyed by its iframe's id. A box leaves only by becoming a link, so the fallback is
    // one-way (§10.6).
    const boxes = new Map<string, HTMLElement>();
    // Each box's iframe. **The id is a name, not a credential**: see `spokeFor`; also used to ask a
    // gist frame to speak.
    const frames = new Map<string, HTMLIFrameElement>();
    // Running clocks and ids that have spoken, **separate from `boxes` on purpose**: a box that
    // reported a height is safe but keeps listening, as `resize` repeats on width changes (§10.5).
    const timers = new Map<string, number>();
    const answered = new Set<string>();

    // **Two providers, one map.** Not `.embed`: YouTube never speaks, and a clock would replace a
    // working player (§10.5). X answers by its design; the gist because its frame document is ours
    // (§18.5).
    root
      .querySelectorAll<HTMLElement>('.embed-x[data-embed-id], .embed-gist[data-embed-id]')
      .forEach((box) => {
        const id = box.dataset.embedId;
        if (!id) return;
        boxes.set(id, box);
        // `rehypeEmbed` always adds one; without it nothing can speak, so the clock stays.
        const iframe = box.querySelector('iframe');
        if (iframe) frames.set(id, iframe);
      });
    if (boxes.size === 0) return;

    // **Ask the gist frames to speak**: a frame can announce before this listener attaches on
    // hydration, and that message is lost. Asked on mount if loaded, else on `load` (all are
    // `loading="lazy"`).
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
      // It spoke, so not missing: stopping the clock here is what keeps it off working embeds.
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

    // Whether the message came from the frame owning the placement it names. **The id is a name,
    // not a credential** (§18.5): `data-embed-id` is public and sequential, and sandbox or pen
    // frames (§20, §21) can post here too. The editor's NodeView makes the same check (§10.10).
    const spokeFor = (id: string, source: MessageEventSource | null): boolean => {
      const frame = frames.get(id);
      return frame !== undefined && frame.contentWindow !== null && source === frame.contentWindow;
    };

    const onMessage = (event: MessageEvent) => {
      // Our reporter: its `event.origin` is `"null"` (sandboxed without `allow-same-origin`), so
      // the source window is its whole authentication (§18.5). Zero files is its `no_results`.
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
      // The origin says "an X frame", not "this one": without this, one could resize or retire
      // another (§10.10).
      if (!spokeFor(call.id, event.source)) return;
      const height = call.params?.[0]?.height;
      // `rendered` and `results` are ignored: only the height and a missing post decide anything.
      if (call.method === 'twttr.private.resize' && typeof height === 'number') {
        applyHeight(call.id, height);
      } else if (call.method === 'twttr.private.no_results') {
        fallBack(call.id);
      }
    };
    window.addEventListener('message', onMessage);

    // **Crossing the viewport is not being seen.** Landing on `#heading` sweeps past boxes above it
    // for ~156ms, which armed their clocks and retired posts nobody saw (X6's misfire), racing this
    // observer. A box must stay `EMBED_DWELL_MS` to count.
    const dwells = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const box = entry.target;
          if (!(box instanceof HTMLElement)) continue;
          const id = box.dataset.embedId;
          if (!id) continue;
          if (!entry.isIntersecting) {
            // Scrolled off too soon: still observed, so returning to it can start its clock.
            const dwell = dwells.get(id);
            if (dwell !== undefined) {
              window.clearTimeout(dwell);
              dwells.delete(id);
            }
            continue;
          }
          // `answered` too: an embed on screen at first paint can report before this runs.
          if (!boxes.has(id) || answered.has(id) || timers.has(id) || dwells.has(id)) continue;
          dwells.set(
            id,
            window.setTimeout(() => {
              dwells.delete(id);
              // Seen once is enough; the observer lets go.
              observer.unobserve(box);
              // Re-asked: a `resize` during the dwell should call this off.
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
