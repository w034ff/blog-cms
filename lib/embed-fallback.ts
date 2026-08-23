// The plain link a published embed degrades to (docs/embed-requirements.md §6, §10.6).
//
// **One surface, two code paths.** `rehypeEmbed` builds this at render time for a reference no
// provider claims, and the reader's browser builds it later for a reference that resolved fine but
// could not be fetched — a deleted, private or absent post, whose iframe arrives completely empty
// (§10.6). The reader must not be able to tell which of the two happened, so the final shape is
// described here rather than in either place that produces it.
//
// The editor is a third surface and is deliberately NOT covered: §7.2 settled that an author who
// can still fix the reference is told so in `embed-note`, rather than shown the degraded form.
//
// Nothing here touches the DOM, so the browser and the build pipeline can both import it.

export type EmbedFallbackAnchor = {
  href: string;
  // The URL itself. No fetch has run anywhere in this feature (§3.2), so there is no title to put
  // here, and the URL is what the author typed in the first place.
  text: string;
  // `rehypeNewTabLinks` decides this for the build pipeline — its rule 1 is "any `http(s)` href
  // leaves this site", and an embed reference is always one — so a render-time fallback already
  // carries `target` by the time it reaches the browser. **A client-built one has to add it
  // itself**: the pipeline finished before the page was sent. No `rel`, for that file's reason —
  // a modern browser implies `noopener`, and `noreferrer` would withhold what §7 refuses to
  // withhold.
  target: '_blank';
};

// The anchor as the reader ends up seeing it, whichever path produced it. `rehypeEmbed` cannot use
// this directly — it runs before `rehypeNewTabLinks` and must leave `target` to it, which is why
// that stage emits a bare anchor and a test pins the two forms together (basis X5).
export function embedFallbackAnchor(href: string): EmbedFallbackAnchor {
  return { href, text: href, target: '_blank' };
}
