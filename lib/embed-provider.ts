// What a URL becomes when it is embedded, and which URLs may become one
// (docs/embed-requirements.md §4, §4.3, §9.2).
//
// Shared rather than duplicated, for the reason lib/link-card-href.ts is shared: the resolve stage
// decides whether a stored reference becomes an iframe (lib/rehype-embed.ts), and the editor decides
// whether a URL the author is holding can become one (components/editor/embed-extension.ts,
// LinkBubble.tsx). An embed the editor makes that the published side refuses is the one
// disagreement worth engineering against, so both sides ask this one function. Nothing here touches
// the DOM or the DB, so both can import it.
//
// **No fetch happens anywhere in this file, and that is the point** (§3.2). Everything an embed
// shows is derived from the reference itself, which is why none of the link card's apparatus — the
// link_previews table, its TTL, its version, the image proxy — has a counterpart here.

export type EmbedTarget = {
  // Names the provider for the CSS hook both surfaces share (`embed-<provider>`). The stored form
  // carries no provider of its own (§4): it is derived here, so adding one cannot widen what has to
  // be spelled out in the document, in the sanitize schema, or in the editor.
  provider: string;
  // The iframe's src for ONE placement of this embed, built here and nowhere else. **A stored
  // reference never becomes a src.** The published stage runs after rehype-sanitize, so this string
  // meets no other check on its way into the DOM (§4.2) — hence an allowlist of shapes that can be
  // expressed, rather than a filter over shapes that cannot.
  //
  // A function rather than a string because a provider may need to name this particular iframe: X
  // does, and without a distinct `embedId` every iframe on the page calls itself `embed-0`, so the
  // parent cannot tell whose `resize` is whose (§10.5). The id is minted per placement by the two
  // render stages and never by `resolveEmbed`, which is what keeps this file pure and §4.3's
  // registry contract unchanged. A provider that needs no such thing ignores the argument — and
  // there is no bare src string left lying around for a caller to use instead.
  src: (instanceId: string) => string;
  // The iframe's accessible name. Generic on purpose (§8-②): with no fetch, the target's own title
  // is not available to either surface.
  title: string;
  // How this embed reads when it is *named* rather than shown — the editor's drag ghost
  // (docs/embed-requirements.md §10.10). Two slots, filled by the provider because only it knows
  // which of the two it can answer: `lead` is the strongest thing the URL says about this item (the
  // account for a post; the provider for a video, which has no name of its own without a fetch),
  // and `detail` is whatever is left worth saying, or `''`.
  //
  // **Separate from `title`, which is the iframe's accessible name on both surfaces.** That one has
  // to say what kind of thing this is to someone who cannot see it; this one is read beside a mark
  // that already says so, where a second 「X の投稿」 is the same word on every post.
  label: { lead: string; detail: string };
  allow: string;
};

type Provider = {
  // Matched against `URL.hostname`, which is already lowercased and punycoded by the parser.
  hosts: readonly string[];
  resolve: (url: URL) => EmbedTarget | null;
};

// §9.2. Eleven characters of the URL-safe alphabet, verified against the parse rather than trusted
// from it: this is the value that reaches the src, so what cannot be expressed here cannot be
// embedded. A path segment that is not an id names no video, which is the same answer as a URL
// naming no provider at all.
const YOUTUBE_ID = /^[\w-]{11}$/;
// `/shorts/<ID>`, `/live/<ID>`, `/embed/<ID>` — three paths that carry the id in the same place.
const YOUTUBE_PATH = /^\/(?:shorts|live|embed)\/([^/]+)/;
// The digits form (`90`, `90s`) and the clock form (`1h2m3s`, any part omitted). Bounded so an
// absurd value cannot be written into the src in exponential notation.
const SECONDS = /^(\d{1,9})s?$/;
const CLOCK = /^(?:(\d{1,9})h)?(?:(\d{1,9})m)?(?:(\d{1,9})s)?$/;

// Matches what YouTube's own player is given by its share links, minus `autoplay` and `fullscreen`,
// which are the two an author has not asked for.
const YOUTUBE_ALLOW =
  'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

function youtubeId(url: URL): string | null {
  // `youtu.be/<ID>` — the first path segment is the whole reference (§9.2's table measured the 303
  // that turns it into `watch?v=`; this reads the id rather than following it, since resolving an
  // embed must not put a request on the wire).
  if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
  // `watch?v=<ID>` — and `v` decides, so `watch?v=<ID>&list=…` is the video with the list dropped
  // (§9.4). A `list` with no `v` names a playlist, which has no single video and falls through.
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
}

// The moment the author linked to, carried into the player (§9.3). A `t` this does not understand
// is not a guess to make: playing from the start is a worse answer than the author's, but writing
// an uninterpreted string into the src is a worse one than either.
function youtubeStart(url: URL): number {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw === null) return 0;
  const seconds = SECONDS.exec(raw);
  if (seconds) return Number(seconds[1]);
  const clock = CLOCK.exec(raw);
  // CLOCK's parts are all optional, so it also matches the empty string and any bare word the
  // anchors let through — an all-empty match means nothing was recognised.
  if (!clock || (clock[1] === undefined && clock[2] === undefined && clock[3] === undefined)) {
    return 0;
  }
  return Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60 + Number(clock[3] ?? 0);
}

const youtube: Provider = {
  // `youtube-nocookie.com` and `music.youtube.com` are deliberately absent (§9.2): the allowlist
  // starts narrow, and nocookie is an output of this file rather than an input to it.
  hosts: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'],
  resolve: (url) => {
    const id = youtubeId(url);
    if (id === null || !YOUTUBE_ID.test(id)) return null;
    const start = youtubeStart(url);
    // nocookie because the request cannot be removed but its cookies can (§9.5). The query is built
    // from the parsed number, never from the author's string.
    const src = `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
    // The id is ignored: one YouTube iframe says nothing to its parent, so nothing has to tell two
    // of them apart.
    return {
      provider: 'youtube',
      src: () => src,
      title: 'YouTube 動画',
      // Seconds, the unit the author's own `t` and the src's `start` are both in. The video itself
      // cannot be named without a fetch — its id is not something a person reads — so the provider
      // leads and the moment follows.
      label: { lead: 'YouTube', detail: start > 0 ? `${start} 秒から` : '' },
      allow: YOUTUBE_ALLOW,
    };
  },
};

// §10.4. Up to 19 digits — a snowflake id, verified against the parse rather than trusted from it,
// for YOUTUBE_ID's reason: this is the value that reaches the src. The bound also keeps a longer
// run of digits out, which is the shape that would otherwise be written into the src verbatim.
const X_ID = /^\d{1,19}$/;
// `/<handle>/status/<ID>` and `/i/status/<ID>` — one pattern, because `/i/` occupies the handle's
// place. The handle segment stays `[^/]+` on purpose: copying X's own rules for what a handle may
// contain would go stale when they change, and it would guard nothing, since the id is the only
// part that reaches the src. A trailing `/photo/1` and the like are ignored for the same reason.
const X_PATH = /^\/([^/]+)\/status\/([^/]+)/;

// Nothing is asked for. A post is text and images in someone else's page, so the four permissions
// YouTube's player needs have no counterpart here.
const X_ALLOW = '';

const x: Provider = {
  // `t.co` is absent: it is a redirector, and resolving one would put a request on the wire, which
  // §3.2 forbids. The old domain is present because links to it are still written and it 301s to
  // `x.com` (§10.1) — following that redirect is the same forbidden request, so the shapes are
  // matched here instead.
  hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
  resolve: (url) => {
    const path = X_PATH.exec(url.pathname);
    const id = path?.[2] ?? null;
    // A profile URL, a list and a search all land here, and all become cards instead (§10.4). That
    // is the account half of §10's decision, and it is this `null` rather than any code of its own.
    if (id === null || !X_ID.test(id)) return null;
    return {
      provider: 'x',
      // `embedId` is what makes a `resize` message attributable (§10.5): without it every iframe on
      // the page answers to `embed-0`. `lang` changes the widget's own UI only — 「フォローする」
      // rather than `Follow` — and not the post (§10.4). Both are built from values this file owns;
      // the author's string reaches neither.
      src: (instanceId) =>
        `https://platform.twitter.com/embed/Tweet.html?id=${id}&lang=ja&embedId=${encodeURIComponent(instanceId)}`,
      title: 'X の投稿',
      // The account, which the URL already carries. `/i/status/<ID>` is the form that does not, and
      // there the provider leads and the bare id is all there is to add.
      label:
        path?.[1] === 'i' ? { lead: 'X', detail: id } : { lead: `@${path?.[1] ?? ''}`, detail: '' },
      allow: X_ALLOW,
    };
  },
};

// docs/embed-requirements.md §14.2. Digits, verified against the parse rather than trusted from it, for YOUTUBE_ID's reason:
// this is the value that reaches the src. Bounded like X_ID so a longer run of digits cannot be
// written into the src verbatim.
const SLIDESHARE_ID = /^\d{1,19}$/;
// `/slideshow/<slug>/<id>` — the current canonical shape, and the only public one that carries an
// id (measured 2026-08-25: the old `/<handle>/<slug>` form answers 404 and has no id in it at all,
// so there is nothing for a second pattern to read). The slug segment stays `[^/]+` for X_PATH's
// reason — only the id reaches the src.
const SLIDESHARE_PATH = /^\/slideshow\/[^/]+\/([^/]+)\/?$/;

// Nothing is asked for. Slides are images in someone else's page, so YouTube's four permissions
// have no counterpart here — and full screen is not among them anywhere: it is the iframe's
// `allowFullScreen` attribute that decides it, which both render stages already set. Measured
// 2026-08-25 with this exact pair (`allow=""` present, `allowfullscreen` present): the button in
// SlideShare's own control row puts the frame full screen, and without the attribute it does
// nothing.
const SLIDESHARE_ALLOW = '';

const slideshare: Provider = {
  // Narrow on purpose, as §9.2's list is: the locale hosts (`es.slideshare.net` and its siblings)
  // redirect to `www` and carry the id in the same place, but they are an open-ended set, and a URL
  // from one becomes a card rather than nothing.
  hosts: ['www.slideshare.net', 'slideshare.net'],
  resolve: (url) => {
    const id = SLIDESHARE_PATH.exec(url.pathname)?.[1] ?? null;
    if (id === null || !SLIDESHARE_ID.test(id)) return null;
    return {
      provider: 'slideshare',
      // The id form, which 302s to `embed_code/key/<KEY>` — the form SlideShare itself publishes in
      // `twitter:player` (embed-requirements.md §14.3). **The redirect is followed by the reader's browser**, so this
      // stays a function of the reference alone and no key has to be fetched, which is what makes
      // §3.2 hold for this provider. The id is ignored by the player, as YouTube's is: a deck says
      // nothing to its parent, so nothing has to tell two of them apart.
      src: () => `https://www.slideshare.net/slideshow/embed_code/${id}`,
      title: 'SlideShare のスライド',
      // The provider and nothing else. The slug is the only other thing the URL carries, and it is
      // not a name: a Japanese title slugifies to bare digits, and many slugs end in the id again
      // (embed-requirements.md §14.8). YouTube leads with the provider for the same reason — the item cannot be named
      // without a fetch.
      label: { lead: 'SlideShare', detail: '' },
      allow: SLIDESHARE_ALLOW,
    };
  },
};

// docs/embed-requirements.md §15.2. `YOUTUBE_ID`'s character class, verified against the parse
// rather than trusted from it, for `YOUTUBE_ID`'s reason: this is the value that reaches the src.
// **Wider than the keys measured** — the two seen are 22 characters of letters and digits
// (`7or4V8Tl8YbEFRmMSF3pXe`, `abttA1F3GxZdZlkI9t5s99`) — because a key form this refuses turns a
// working file into a bare link, and two samples do not establish an alphabet. What it rules out
// is a segment that cannot be a key at all: nothing that could leave the path, and nothing long
// enough to be something else. The bound is a ceiling, not a length; Figma's own docs use a
// four-character key in their example (`figma.com/design/pqrs/ExampleFile`).
const FIGMA_KEY = /^[\w-]{1,64}$/;
// `/design/<key>/<slug>` — the current canonical shape — and `/file/<key>/<slug>`, which is the
// same file: Figma's own `og:url` still publishes the `/file/` form for a design URL (measured
// 2026-08-25 on the sample). The slug is optional because it carries no meaning here; only the key
// reaches the src. `/proto/`, `/board/` and `/slides/` are deliberately absent (§15.2).
const FIGMA_PATH = /^\/(?:design|file)\/([^/]+)(?:\/|$)/;
// `node-id=<page>-<node>`. Both separators are written — `5-2` in a URL Figma emits today and `5:2`
// in an older one, which `searchParams` hands over already percent-decoded — and both land on the
// same node (measured 2026-08-25). The hyphen form is what enters the src, built from the parsed
// digits and never from the author's string (§9.3's rule).
const FIGMA_NODE = /^(\d{1,9})[-:](\d{1,9})$/;

// Figma refuses to render without it: with the parameter absent the frame is 「Not a valid embed
// context」 instead of the file (measured 2026-08-25). It names the embedding site — Figma asks for
// 「something that uniquely and clearly identifies your site」 — so it is this site's identifier for
// a third party, not its display name: `SITE_NAME` is not imported, because renaming what the
// header says should not retarget what Figma is told.
const FIGMA_EMBED_HOST = 'tech-blog';

// Nothing is asked for, as SlideShare asks for nothing: a design file is images in someone else's
// page. Full screen is the `allowFullScreen` attribute's, which both render stages already set —
// measured 2026-08-25 with this exact pair, the embed's own expand button puts the parent's
// `document.fullscreenElement` on the iframe.
const FIGMA_ALLOW = '';

const figma: Provider = {
  // `embed.figma.com` is deliberately absent for `youtube-nocookie.com`'s reason (§9.2): it is an
  // output of this file, not an input to it. `figma.site` is a different product — a published
  // site, not a file — and naming it here would claim a shape nothing has measured.
  hosts: ['www.figma.com', 'figma.com'],
  resolve: (url) => {
    const key = FIGMA_PATH.exec(url.pathname)?.[1] ?? null;
    if (key === null || !FIGMA_KEY.test(key)) return null;
    const node = FIGMA_NODE.exec(url.searchParams.get('node-id') ?? '');
    // The frame the author linked to, carried into the viewer (§15.3). Everything else the share
    // dialog writes is dropped: `p=f` names a pane of Figma's own UI, and `t=` is a sharing
    // attribution token, neither of which the reader's view is a function of (§15.4).
    const target = node ? `&node-id=${node[1]}-${node[2]}` : '';
    return {
      provider: 'figma',
      // The documented embed host, which 302s to `www.figma.com/design/<key>?…&viewer=1`, followed
      // by the reader's browser — so this stays a function of the reference alone and §3.2 holds
      // (embed-requirements.md §15.3). The legacy `www.figma.com/embed?url=<page URL>` form still
      // renders, and is not used: it would put the author's string into the src, which §4.2 gives
      // this file the job of preventing. The slug is dropped because the key alone resolves.
      src: () => `https://embed.figma.com/design/${key}?embed-host=${FIGMA_EMBED_HOST}${target}`,
      title: 'Figma のデザイン',
      // The provider and nothing else, for SlideShare's reason: the file cannot be named without a
      // fetch. The slug is the author's title slugified, and the node id (`5-2`) is not a name.
      label: { lead: 'Figma', detail: '' },
      allow: FIGMA_ALLOW,
    };
  },
};

const PROVIDERS: readonly Provider[] = [youtube, x, slideshare, figma];

// The embed a stored reference resolves to, or null when there is none — which is the same answer
// for a URL no provider claims, a provider's URL that names no single item, and a string that is
// not a URL at all. Callers act on the null identically (§6, §9.4): the reference stays a link.
export function resolveEmbed(href: string): EmbedTarget | null {
  const value = href.trim();
  if (value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // No credentials in a reference, the rule link cards already carry (link-card-requirements.md
  // §14.2.1 ②). The src is rebuilt from the id so nothing would leak through it — but 「リンクに戻す」
  // puts this exact string back into an `<a href>`, where it is published for every reader to see.
  if (url.username !== '' || url.password !== '') return null;
  const provider = PROVIDERS.find((candidate) => candidate.hosts.includes(url.hostname));
  return provider ? provider.resolve(url) : null;
}
