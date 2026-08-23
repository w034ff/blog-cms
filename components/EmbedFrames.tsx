'use client';

import { useEffect } from 'react';
import { embedFallbackAnchor } from '@/lib/embed-fallback';
import {
  EMBED_SILENCE_MS,
  EMBED_VISIBLE_THRESHOLD,
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
    // The clocks still running, and the ids that have said anything at all. **These are separate
    // from `boxes` on purpose.** A box that has reported a height is no longer at risk of being
    // mistaken for a missing post, but it must stay listening — the provider re-sends `resize`
    // whenever the width changes (§10.5), so it is never done talking.
    const timers = new Map<string, number>();
    const answered = new Set<string>();

    root.querySelectorAll<HTMLElement>('.embed-x[data-embed-id]').forEach((box) => {
      const id = box.dataset.embedId;
      if (id) boxes.set(id, box);
    });
    if (boxes.size === 0) return;

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
      stopClock(id);
      const spec = embedFallbackAnchor(href);
      const anchor = document.createElement('a');
      anchor.href = spec.href;
      anchor.textContent = spec.text;
      anchor.target = spec.target;
      box.replaceWith(anchor);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== X_ORIGIN) return;
      const call = readXCall(event.data);
      if (!call?.id) return;
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

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const box = entry.target;
          if (!(box instanceof HTMLElement)) continue;
          const id = box.dataset.embedId;
          // Once seen is enough — the clock runs from the first time the reader could have been
          // looking at it, and a box scrolled past and back is not a second chance to fail.
          observer.unobserve(box);
          // `answered` is checked because the two are not ordered: an embed visible at first paint
          // can report its height before this callback ever runs, and arming a clock for it would
          // replace a working post eight seconds later.
          if (!id || !boxes.has(id) || answered.has(id) || timers.has(id)) continue;
          timers.set(
            id,
            window.setTimeout(() => fallBack(id), EMBED_SILENCE_MS),
          );
        }
      },
      { threshold: EMBED_VISIBLE_THRESHOLD },
    );
    boxes.forEach((box) => observer.observe(box));

    return () => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [targetId]);

  return null;
}
