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

// The one import. `GIST_SOURCE` names the message the document below writes into itself, and the
// two surfaces that read it live in `lib/embed-message.ts` — the name has to be the same string in
// all three places, and this file is where it is written rather than where it is decided.
import { GIST_SOURCE } from './embed-message';

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
  // A document of our own to frame the provider in, built from the `src` above — or null to point
  // the iframe straight at that `src`, which is what every provider but one does.
  //
  // **This exists so that a provider can be made to speak** (§18.5). A cross-origin frame's height
  // is knowable only if the frame reports it, and GitHub's gist markup reports nothing: `.pibb`
  // runs no script, and neither it nor `.js` sends CORS headers, so it cannot be measured from
  // outside either (measured 2026-08-29). Framing GitHub's own `document.write` script inside a
  // document this file writes puts a reporter of ours in that same document, and then the box
  // follows the gist instead of guessing at it.
  //
  // The stages set `srcdoc` **instead of** `src` when this is non-null. The string is raw HTML;
  // escaping it into an attribute belongs to whichever stage is writing one.
  srcdoc: ((src: string, instanceId: string) => string) | null;
  // The `sandbox` attribute, or null for no attribute at all — which is not the same thing, since
  // `sandbox=""` is the most restrictive value there is.
  //
  // **Only a provider that would otherwise navigate the article away asks for this** (§18.6).
  // `.pibb` carries `<base target="_parent">`, so a reader clicking 「view raw」 inside the frame
  // takes the whole page to `gist.githubusercontent.com` — measured 2026-08-29, and no other
  // provider here can do that. The empty value is enough because that fragment runs no script; a
  // provider whose player does would be broken by it, which is why this is the provider's answer
  // and not a blanket rule.
  sandbox: string | null;
};

type Provider = {
  // How this provider is written when it is named to the author — the insert dialog's table of
  // what can be embedded (docs/embed-requirements.md §24.1).
  //
  // **It lives here rather than beside each `label.lead` because it has to be readable without a
  // URL.** `resolve` produces a `label` for one particular reference, so nothing could ask "what
  // can be embedded at all" without inventing a URL per provider. Where `lead` is the provider's
  // own name, that branch reads this field instead of repeating the string — the seven that always
  // lead with the provider, and the fallback branch of the two that usually lead with an account
  // (X, gist). One spelling per provider; `embed-provider.test.ts` holds it there.
  name: string;
  // Matched against `URL.hostname`, which is already lowercased and punycoded by the parser.
  hosts: readonly string[];
  // **What the insert dialog's table prints beside the name** (§24.1, 2026-09-03). One noun naming
  // the kind of thing this provider embeds, and nothing about the URL.
  //
  // **The hosts used to be here, and they answered the wrong question.** A row printing
  // `www.youtube.com / youtube.com / m.youtube.com / youtu.be` says which *site* matches, while
  // every URL an author actually gets wrong is about which *page* on it: `x.com/<user>` claims the
  // host and does not resolve (§10.4), and so do a gist user page, a CodePen profile, a YouTube
  // playlist, Figma's `/proto/`, Docswell's video and CodeSandbox's devbox. The kind answers the
  // question the author brings instead — 「スライドを貼りたい、どれが使える」 — which a list of
  // nine brand names cannot, and which the slash row already assumes by carrying 「スライド」 as a
  // keyword.
  //
  // **Nine rows spell five words**, and the repetition is the point: three say 「スライド」 and
  // three say 「コード」, so the reverse lookup lands on a group rather than on one name.
  //
  // **A kind is true without a URL**, which is why this can sit in the registry beside `name`
  // instead of being a second string that has to keep step with the matcher. A printed URL shape
  // cannot: only three of the nine have one form (X, SlideShare, Speaker Deck), YouTube has five,
  // and Docswell's video wears the same path as its deck (§17.2), so no shape can separate them.
  kind: string;
  // **The one provider whose address bar is not the answer** (§16.10). Printed in parentheses after
  // the kind, and absent everywhere else: for the other eight the address bar is the whole answer,
  // so a note on every row would repeat what the reader already has.
  //
  // A deck page carries no id, so `/player/<id>` exists nowhere an author can copy it except inside
  // the embed code (§16.3) — this is the only row where "what to paste" has to be said *before* the
  // paste. **It names the code rather than a button**, because `speakerdeckSnippetHref` takes both
  // of Speaker Deck's Share buttons (iframe and JS) and naming one would be false for the other;
  // which button to press is the refusal's to say, at the moment the author has actually pasted the
  // wrong thing.
  //
  // **This replaced a printed path shape** (`speakerdeck.com/player/<id>`, 2026-09-03). That string
  // existed because the column printed hosts and `speakerdeck.com` on its own invited the address
  // bar; with the hosts gone there is no lie left to correct, and the path was never something the
  // author could produce anyway.
  note?: string;
  // **What the dialog's refusal says about a URL on this provider's hosts that did not resolve**,
  // or null to leave it to the generic sentence (§24.1). Asked per URL rather than per provider
  // because a provider's refusal answers for *every* shape that fails on its hosts — the file
  // browser, the user page, the search results — and a sentence about the one shape the author
  // probably had would be false for the rest.
  //
  // Two kinds of answer, and the difference is whether the author can act:
  //
  //   - **The URL is fixable.** Say what is embeddable, and drop 「リンクカードにしてください」: the
  //     card is a fallback where a fix exists. Figma and Speaker Deck.
  //   - **The reference cannot be embedded at all.** Keep the card — it really is the next move —
  //     and add the reason the generic sentence cannot give. Docswell's video, CodeSandbox's devbox.
  //
  // The URL is already parsed by `resolveEmbed`, and it is passed rather than reparsed so this
  // cannot disagree with the matcher about what the path is.
  refusal?: (url: URL) => string | null;
  // **Whether the shared insert dialog may offer a link card when this provider refuses** — the
  // second half of the two-kind split `refusal` documents above. Only meaningful alongside a
  // `refusal` that actually fires: true for Docswell's video and CodeSandbox's devbox (「残す」),
  // absent (false) for Figma and Speaker Deck (「勧めない」 — a fixable URL exists, so a card would
  // be a worse answer than the fix `refusal` already names).
  cardFallback?: boolean;
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
  name: 'YouTube',
  kind: '動画',
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
      label: { lead: youtube.name, detail: start > 0 ? `${start} 秒から` : '' },
      allow: YOUTUBE_ALLOW,
      srcdoc: null,
      sandbox: null,
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
  name: 'X',
  kind: '投稿',
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
        path?.[1] === 'i'
          ? { lead: x.name, detail: id }
          : { lead: `@${path?.[1] ?? ''}`, detail: '' },
      allow: X_ALLOW,
      srcdoc: null,
      sandbox: null,
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
  name: 'SlideShare',
  kind: 'スライド',
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
      label: { lead: slideshare.name, detail: '' },
      allow: SLIDESHARE_ALLOW,
      srcdoc: null,
      sandbox: null,
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
  name: 'Figma',
  kind: 'デザインファイル',
  // `embed.figma.com` is deliberately absent for `youtube-nocookie.com`'s reason (§9.2): it is an
  // output of this file, not an input to it. `figma.site` is a different product — a published
  // site, not a file — and naming it here would claim a shape nothing has measured.
  hosts: ['www.figma.com', 'figma.com'],
  // **The one other provider where the author can fix the URL themselves** (§24.1). `/proto/`,
  // `/board/` and `/slides/` are the same file seen through a different view, so the design URL
  // exists and Figma's own UI hands it over — which is what makes a sentence worth more here than
  // the generic 「リンクカードにしてください」.
  //
  // **Phrased as what is embeddable, not as what went wrong**, because a provider's refusal answers
  // for *every* URL on its hosts that does not resolve — the file browser, the community pages and
  // a malformed key land here too, and 「プロトタイプは対応していません」 would be false for those.
  //
  // No `shape`: unlike Speaker Deck's, Figma's hosts are not misleading. The address bar of a
  // design file works, which is what the row's hosts already promise.
  refusal: () => '埋め込めるのは /design/ か /file/ の URL です。',
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
      label: { lead: figma.name, detail: '' },
      allow: FIGMA_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §16.2. Lowercase hex, verified against the parse rather than trusted
// from it, for `YOUTUBE_ID`'s reason: this is the value that reaches the src. Two lengths are in
// service — 32 for decks published today and 24 for the older ones (measured 2026-08-26:
// `504229f1c53c970002012ba0` and `4fa4436e5f35f0002200b70b` both play) — so the bound is a range
// over the pair rather than either one alone. **Uppercase is not the same id**: the same 32
// characters upper-cased answer 404, so the character class is not `[0-9a-fA-F]`.
const SPEAKERDECK_ID = /^[0-9a-f]{24,32}$/;
// `/player/<id>` — **the only shape there is** (§16.2). The deck page's own URL carries no id, and
// no slug-shaped alias for the player exists: `/player/<user>/<slug>`, `/<user>/<slug>/embed`,
// `/<user>/<slug>/player` and `/embed/<user>/<slug>` all answer 404 (measured 2026-08-26). The
// trailing slash is optional because Speaker Deck serves it either way.
const SPEAKERDECK_PATH = /^\/player\/([^/]+)\/?$/;

// Nothing is asked for, as SlideShare and Figma ask for nothing. Speaker Deck's own snippet writes
// `allow="web-share"` for the share menu the player draws, and that menu is a link list rather than
// a call to the Web Share API — the author has not asked for it, and §9.2's rule for `autoplay`
// applies. Full screen is the `allowFullScreen` attribute's, which both render stages already set:
// measured 2026-08-26 with `allow=""`, the player's own button puts the parent's
// `document.fullscreenElement` on the iframe.
const SPEAKERDECK_ALLOW = '';

const speakerdeck: Provider = {
  name: 'Speaker Deck',
  kind: 'スライド',
  // `www` is present because it answers and 301s to the apex, which is where the id sits in the
  // same place (measured 2026-08-26) — the same call §14.2 made for `slideshare.net`.
  hosts: ['speakerdeck.com', 'www.speakerdeck.com'],
  // **The row says the paste is not a URL, and the refusal names the button** (§16.10). A deck
  // page's URL carries no id, so `speakerdeck.com/<user>/<slug>` — the address bar, and what
  // 「Copy link」 hands over — never resolves; `/player/<id>` is the only shape there is, and it
  // exists nowhere an author can copy it except inside the embed code. The note says that much
  // before the paste; which button produces it is what the refusal adds, at the moment the author
  // has actually pasted the wrong thing.
  //
  // **The note names the code, the refusal names one button, and those differ on purpose.**
  // `speakerdeckSnippetHref` takes either Share button's output (§16.9), so a note saying
  // 「iframe コード」 would be false for the author holding the JS one. **The refusal names one
  // button because it is a recipe** (§16.10, 2026-09-03): what an author needs there is one path
  // that works, and the note above has already told them the code is what to paste, so the one
  // holding the JS snippet is not sent to a dead end. Naming both lengthens a sentence that has to
  // stay one line at 390px (§24.1).
  note: '埋め込みコード',
  refusal: () => 'Share →「Copy iframe code」の内容を貼ってください。',
  resolve: (url) => {
    const id = SPEAKERDECK_PATH.exec(url.pathname)?.[1] ?? null;
    if (id === null || !SPEAKERDECK_ID.test(id)) return null;
    return {
      provider: 'speakerdeck',
      // The reference rebuilt on the apex host, so the two spellings of the same deck reach one
      // src. **This is the player URL the author pasted**, which is the whole of §16.3: the id is
      // not derivable from the deck page's URL, so unlike SlideShare there is no canonical page to
      // start from and no redirect for the reader's browser to follow.
      src: () => `https://speakerdeck.com/player/${id}`,
      title: 'Speaker Deck のスライド',
      // The provider and nothing else, for SlideShare's reason: the deck cannot be named without a
      // fetch, and this URL does not even carry a slug to be tempted by (§16.7).
      label: { lead: speakerdeck.name, detail: '' },
      allow: SPEAKERDECK_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §17.2. Uppercase letters and digits, verified against the parse rather
// than trusted from it, for `YOUTUBE_ID`'s reason: this is the value that reaches the src. Every key
// measured is 6 of them (92 deck URLs collected 2026-08-26 from the front page, two tag listings, a
// user page and a search result), and the bound is a ceiling rather than a length, as `FIGMA_KEY`'s
// is — a class that refuses a working deck turns it into a bare link.
//
// **Lowercase is left out on purpose, and that is what keeps videos out** (§17.2). Docswell serves
// video from the same `/s/<user>/<key>-<slug>` path with a `v` in front of the key (`vYN91PJ`), and
// a video is a different endpoint — `/video/<key>/embed`, with that `v` dropped — so
// `/slide/vYN91PJ/embed` answers 404. Keys are case-sensitive besides: `lk7j5v` is a 404 where
// `LK7J5V` is the deck, so accepting lowercase could only ever build a src that shows Docswell's own
// 404 page inside the article.
const DOCSWELL_KEY = /^[0-9A-Z]{1,32}$/;
// The same key with the video's `v` in front — the shape `DOCSWELL_KEY` turns away, named here so
// the refusal can tell a video apart from a user page or a search result (§24.1).
const DOCSWELL_VIDEO_KEY = /^v[0-9A-Z]{1,32}$/;
// `/s/<user>/<key>-<slug>`, the deck page — the URL the address bar holds. The slug is optional
// because the key alone resolves (`/s/<user>/<key>` 302s to the full form), and it is separated from
// the key by the first `-`, which is why the key group excludes it. The trailing `/<n>` is the page
// permalink (§17.3). `/s/` is matched in lowercase because the path is case-sensitive too — `/S/…`
// answers 404 (measured 2026-08-26).
const DOCSWELL_PATH = /^\/s\/[^/]+\/([^/-]+)(?:-[^/]*)?(?:\/(\d{1,4}))?\/?$/;
// `#p<n>`, the page the deck page's own player writes into the address bar — the fragment reaches
// here with its `#`, and `URL` never percent-decodes it into one.
const DOCSWELL_PAGE = /^#p(\d{1,4})$/;

// Nothing is asked for, as SlideShare, Figma and Speaker Deck ask for nothing: slides are images in
// someone else's page. Full screen is the `allowFullScreen` attribute's, which both render stages
// already set — measured 2026-08-26 with this exact pair (`allow=""` present), the player's own
// 全画面 button puts the parent's `document.fullscreenElement` on the iframe.
const DOCSWELL_ALLOW = '';

// The page the author is pointing at, carried into the player (§17.3). The deck page and the player
// spell it the same way, and both clamp — `#p99` on a 13-page deck lands on 13, `#p0` on 1
// (measured 2026-08-26) — so nothing here has to know how long a deck is. The two spellings the
// author may hold are the fragment and the `/<n>` permalink, which the deck page itself rewrites
// into the fragment.
function docswellPage(url: URL, path: RegExpExecArray): number {
  const fragment = DOCSWELL_PAGE.exec(url.hash)?.[1];
  return Number(fragment ?? path[2] ?? 0);
}

const docswell: Provider = {
  name: 'Docswell',
  kind: 'スライド',
  // The apex is present because it answers directly rather than redirecting, and carries the key in
  // the same place (measured 2026-08-26) — the call §14.2 made for `slideshare.net`.
  hosts: ['www.docswell.com', 'docswell.com'],
  // **The video, and only the video.** `DOCSWELL_KEY` excludes lowercase precisely so a video's
  // `v`-prefixed key falls out (§17.2), and this recognises the shape that fell out — a deck path
  // whose key is a video's. **The card stays the answer**: a video is a different endpoint that
  // does not frame at all, so unlike Figma there is no URL for the author to reach instead. What
  // the generic sentence cannot say is *why*, and that is all this adds.
  refusal: (url) => {
    const key = DOCSWELL_PATH.exec(url.pathname)?.[1];
    return key !== undefined && DOCSWELL_VIDEO_KEY.test(key)
      ? '動画は埋め込めません。リンクカードとして挿入します。'
      : null;
  },
  cardFallback: true,
  resolve: (url) => {
    const path = DOCSWELL_PATH.exec(url.pathname);
    const key = path?.[1] ?? null;
    if (path === null || key === null || !DOCSWELL_KEY.test(key)) return null;
    const page = docswellPage(url, path);
    return {
      provider: 'docswell',
      // The embed form Docswell publishes for itself, in `oembed`'s `html` and in the snippet its
      // own Share dialog hands out (embed-requirements.md §17.3). No redirect and no fetch: the key
      // in the deck page's URL is the key in the embed's, which is what makes §3.2 hold here. The
      // fragment is built from the parsed number, never from the author's string (§9.3's rule), and
      // page 1 writes none — it is what the player opens on.
      src: () => `https://www.docswell.com/slide/${key}/embed${page > 1 ? `#p${page}` : ''}`,
      title: 'Docswell のスライド',
      // The provider, then the page if the author named one — YouTube's shape, and for its reason:
      // the deck cannot be named without a fetch, and the slug is the title slugified (§17.7).
      label: { lead: docswell.name, detail: page > 1 ? `${page} ページ目から` : '' },
      allow: DOCSWELL_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §18.2. Lowercase hex, verified against the parse rather than trusted
// from it, for `YOUTUBE_ID`'s reason: this is the value that reaches the src. Two lengths are in
// service, as Speaker Deck's are — 32 for gists made today and 20 for older ones (measured
// 2026-08-29: `fa7df2b570a3f16b39e990b2d2c20aae` and `6cad326836d38bd3a7ae` both render) — so the
// bound is a range over the pair. **Uppercase is not the same gist**: the same 32 characters
// upper-cased answer 404, so the class is not `[0-9a-fA-F]`.
const GIST_ID = /^[0-9a-f]{20,32}$/;
// A GitHub login: letters, digits and hyphens, 39 at most, which is the ceiling GitHub itself
// enforces. **This is the first path segment other than an id that reaches a src here**, and it has
// to, because it is load-bearing: `gist.github.com/wrongowner/<id>.pibb` answers 404 rather than
// redirecting (measured 2026-08-29). Case is not: `QIITAN/<id>` is the same gist as `qiitan/<id>`,
// so nothing normalises it either.
const GIST_OWNER = /^[A-Za-z0-9-]{1,39}$/;
// `/<owner>/<id>` and `/<id>`. The second is a real form rather than a courtesy — it 302s to the
// first, which the reader's browser follows (§14.3's arrangement), and the 302's own
// `x-frame-options: deny` does not reach the rendered document, so the frame still draws (measured
// 2026-08-29). The trailing slash is optional because gist serves it either way.
const GIST_PATH = /^\/([^/]+)(?:\/([^/]+))?\/?$/;
// The `?file=` a gist page URL may carry (§18.3), which both Zenn and Qiita document in this exact
// spelling. Bounded rather than enumerated: the value is percent-encoded on its way into the src,
// so what this excludes is not an injection but a string that cannot name a file — a path
// separator, a control character, or a run longer than any filename. **A name the gist does not
// have is a 404 with an empty body**, and 404 carries `x-frame-options: deny`, so the reader gets
// the browser's own refusal notice rather than the whole gist (measured 2026-08-29).
const GIST_FILE = /^[^/\\\u0000-\u001f\u007f]{1,255}$/;

// Nothing is asked for, as SlideShare, Figma, Speaker Deck and Docswell ask for nothing: `.pibb` is
// a stylesheet and static markup, with no script of its own to want a permission (measured
// 2026-08-29 — 5054 bytes, one `<link rel=stylesheet>`, zero `<script>`).
const GIST_ALLOW = '';

// The document GitHub's gist script is run inside (embed-requirements.md §18.5). **Everything the
// frame does that GitHub did not write is here**, and there is only ever one of it: no state, no
// DOM, one string built from two arguments, so both render stages produce the identical frame.
//
// Three things it adds to what `.js` writes:
//
//   1. **A reporter**, because nothing else can answer「この gist は何 px か」. It sends the height
//      and how many files were drawn; `lib/embed-message.ts` describes the message and why zero
//      files is the signal for a gist that no longer resolves.
//
//      **It answers a `{ask}` as well as announcing, and announcing does not de-duplicate.** A
//      frame that reported once and then went quiet is unreachable if the parent was not listening
//      yet — and it is not, reliably: the frame's document parses with the page around it, while
//      the listener is attached on hydration. Measured 2026-08-29, that race lost the message
//      outright and the box sat at its published guess forever. Only the resize path compares
//      heights, because that one is answering a change rather than a question.
//   2. `<base target="_blank">`. GitHub's markup links to the gist, the file and the raw text, and
//      the sandbox has no `allow-top-navigation`, so without a target of their own those clicks
//      would do nothing at all. **`.pibb` writes `<base target="_parent">` instead** — which is why
//      it could take the article away, and why the form that lets us write our own is safer as well
//      as measurable (§18.6).
//   3. A transparent background and no margin, so the box is the gist's own height rather than the
//      gist plus the 8px `<body>` margin the UA would otherwise supply.
//
// **The height measured is `<body>`'s box, not `documentElement.scrollHeight`.** The latter is
// clamped to the frame's own viewport, so it can never report a number below the box it is already
// in — measured 2026-08-29, a six-line gist in the 250px guess reported 250 and kept 90px of empty
// white under it forever. Reading the body's rect makes the box able to shrink as well as grow,
// which is the whole of「可変」.
//
// **The document ends at the reporter's `</script>`, and closes no tags after it.** React's server
// renderer does not reproduce anything following `</script>` inside this attribute: with
// `</body></html>` written here, the served HTML carried the attribute without them while the RSC
// payload carried the whole string, and the two disagreeing is a hydration mismatch — logged by
// React, and gist-only (measured 2026-08-29 against the same page with a YouTube embed and with no
// embed at all). Both tags are optional in HTML and the frame parses identically without them.
// Anything added to this document belongs BEFORE that script, not after it.
//
// `postMessage` is addressed to `'*'` because the frame cannot know the origin it is embedded in —
// the sandbox gives it an opaque one. The payload is a height and a count, so there is nothing in
// it to withhold; the parent is the side that has to check who is talking.
function gistDocument(src: string, instanceId: string): string {
  return (
    '<!doctype html><html><head><base target="_blank">' +
    '<style>html,body{margin:0;padding:0;background:transparent}</style></head><body>' +
    `<script src="${src}"></script>` +
    '<script>(function(){var s=' +
    JSON.stringify(GIST_SOURCE) +
    ',i=' +
    JSON.stringify(instanceId) +
    ',l=-1;function h(){return Math.ceil(document.body.getBoundingClientRect().height);}' +
    'function send(){l=h();' +
    "parent.postMessage({source:s,id:i,height:l,files:document.querySelectorAll('.gist-file').length},'*');}" +
    'function grew(){if(h()!==l)send();}' +
    'if(window.ResizeObserver)new ResizeObserver(grew).observe(document.body);' +
    'addEventListener("message",function(e){if(e.data&&e.data.ask===s)send();});' +
    'addEventListener("load",send);setTimeout(send,0);setTimeout(send,400);})();</script>'
  );
}

const gist: Provider = {
  name: 'GitHub Gist',
  kind: 'コード',
  // One host. `gist.githubusercontent.com` is deliberately absent: it serves the raw file as
  // `text/plain` under `x-frame-options: deny` and CSP `sandbox`, so it is not an embed of anything
  // — and it is an output of this file's own `view raw` link rather than an input to it.
  hosts: ['gist.github.com'],
  resolve: (url) => {
    const path = GIST_PATH.exec(url.pathname);
    if (path === null) return null;
    // `/<owner>/<id>` fills both groups; `/<id>` fills only the first, and then there is no owner.
    const owner = path[2] === undefined ? null : path[1];
    const id = path[2] ?? path[1];
    if (!GIST_ID.test(id)) return null;
    if (owner !== null && !GIST_OWNER.test(owner)) return null;
    const named = url.searchParams.get('file');
    // A `file` that cannot name a file is dropped rather than passed on, for §9.3's reason: the
    // whole gist is a worse answer than the author's, and the browser's refusal notice is a worse
    // one than either.
    const file = named !== null && GIST_FILE.test(named) ? named : null;
    return {
      provider: 'gist',
      // **The embed script, not the frameable page.** `.pibb` is GitHub's own frameable rendering
      // and it renders — but it is a document we cannot add anything to, and a gist that cannot
      // report its height forces a fixed box (embed-requirements.md §18.3). `.js` is the same
      // markup delivered as `document.write` calls, so it can be run inside a document of ours,
      // and `gistDocument` puts a reporter beside it. No redirect to wait on when the owner is
      // present and no fetch either way, so §3.2 holds.
      src: () =>
        `https://gist.github.com/${owner === null ? '' : `${owner}/`}${id}.js` +
        (file === null ? '' : `?file=${encodeURIComponent(file)}`),
      srcdoc: gistDocument,
      title: 'GitHub Gist のコード',
      // **The one provider here whose reference carries real names**, which is why this is not
      // `{ lead: 'GitHub Gist' }` the way every deck's is: the decks cannot be named without a
      // fetch, and a gist URL already holds the owner, and the file too when the author named one.
      // X's shape exactly (§10.4) — the account leads, and the form that carries no account falls
      // back to the provider with the bare id behind it.
      label:
        owner === null
          ? { lead: gist.name, detail: file ?? id }
          : { lead: owner, detail: file ?? '' },
      allow: GIST_ALLOW,
      // §18.6. `allow-scripts` because both the gist's own `document.write` and the reporter beside
      // it have to run; `allow-popups` so GitHub's own 「view raw」 still opens somewhere, since the
      // document sets `target="_blank"`. **`allow-same-origin` is deliberately absent**, which is
      // what keeps a third party's markup out of the page around it — and the price is an opaque
      // origin, so the parent authenticates the message by its source window (§18.5).
      sandbox: 'allow-scripts allow-popups',
    };
  },
};

// docs/embed-requirements.md §20.3. **This is the only provider here whose src is not built from an
// extracted id**: the whole last path segment goes through untouched, because CodeSandbox's embed
// endpoint answers to the slug form and the bare id alike (`/embed/react-example-xgzdk` and
// `/embed/xgzdk` are the same sandbox, measured 2026-08-30) — and Zenn ships exactly that,
// forwarding the author's `eager-proskuriakova-2lcdqm` rather than the `2lcdqm` inside it.
//
// **Not splitting is what keeps `react-new-devbox` safe.** A rule that took the text after the last
// `-` would read `devbox` out of a segment that is a name rather than a slug-plus-id, and build a
// src for a sandbox that does not exist. Leaving the segment alone makes that mistake unavailable.
//
// Hyphens are in the class for the same reason; the bound is far past the 26 characters of the
// longest slug form measured, for `FIGMA_KEY`'s reason — a narrow one silently turns live
// sandboxes into plain links. Case is not normalised: `/embed/XGZDK` resolves to `/embed/xgzdk`
// (measured), unlike Docswell's keys.
const CODESANDBOX_SEGMENT = /^[0-9A-Za-z-]{1,64}$/;
// `/p/sandbox/<seg>` is the canonical page form today — `/s/new` 307s to `/p/sandbox/new` (measured
// headed 2026-08-30) — and `/s/<seg>` is the legacy one, which carries the segment in the same
// place. `/p/devbox/` is deliberately absent (§20.3): VM Sandboxes do not embed off codesandbox.io
// at all — measured, and it is the provider's product boundary, not a rule we could route around
// (§20.13).
const CODESANDBOX_PATH = /^\/(?:p\/sandbox|s)\/([^/]+)\/?$/;
// The shape the line above deliberately excludes, named so the refusal can say why (§24.1).
const DEVBOX_PATH = /^\/p\/devbox\/[^/]+\/?$/;

// Nothing is asked for. CodeSandbox's own snippet requests `camera; microphone; geolocation; usb;
// payment` and eleven more, and **Qiita and Zenn both copy that list verbatim** — this file does
// not (§20.7). What a sandbox frames is arbitrary third-party code, and no reason can be given for
// handing it a device by default; §17.4's "nothing is asked for" and §9's "minus what the author
// did not ask for" both land here. **The divergence from those two sites is deliberate**, and it is
// written down so the next reader does not restore it as an oversight.
const CODESANDBOX_ALLOW = '';

const codesandbox: Provider = {
  name: 'CodeSandbox',
  kind: 'コード',
  // `www` answers 200 in its own right rather than redirecting (measured 2026-08-30), which is the
  // call §17.2 made for Docswell's apex.
  hosts: ['codesandbox.io', 'www.codesandbox.io'],
  // **The devbox, and only the devbox.** `CODESANDBOX_PATH` leaves `/p/devbox/` out because a VM
  // Sandbox does not frame off codesandbox.io at all — the provider's own product boundary, not a
  // rule to route around (§20.13). **So the card stays the answer** and this only supplies the
  // reason; there is no other URL for the same sandbox.
  refusal: (url) =>
    DEVBOX_PATH.test(url.pathname)
      ? 'Devbox は埋め込めません。リンクカードとして挿入します。'
      : null,
  cardFallback: true,
  resolve: (url) => {
    const segment = CODESANDBOX_PATH.exec(url.pathname)?.[1] ?? null;
    if (segment === null || !CODESANDBOX_SEGMENT.test(segment)) return null;
    return {
      provider: 'codesandbox',
      // `runonclick=1` is **not in anything the author wrote** — this file adds it, which is §4's
      // rule ("the src is built here") rather than a liberty. It defers the bundler and the preview
      // origin until the reader clicks: 64 requests instead of 114, with `<id>.csb.app`,
      // `prod-packager-packages` and `data.jsdelivr.com` never contacted (measured 2026-08-30).
      // A reader who clicks pays the 112 anyway, so this defers the cost rather than removing it —
      // and it is why §20.2 says the embed offers code now and a running result one click away.
      //
      // Nothing else is appended. `theme`, `fontsize`, `hidenavigation` and `view` all still work,
      // but each would be a default chosen on this project's behalf for every author, and only
      // `runonclick` has a measurement behind it (§20.5).
      src: () => `https://codesandbox.io/embed/${segment}?runonclick=1`,
      title: 'CodeSandbox のサンドボックス',
      // No `detail` is possible: the segment is a slugified title or a random word rather than a
      // name, and unlike YouTube's start time (§9.3) or Docswell's page (§17.3) there is nothing in
      // the URL left to carry over.
      label: { lead: codesandbox.name, detail: '' },
      allow: CODESANDBOX_ALLOW,
      srcdoc: null,
      // Zenn's list, and what it buys is the absence of `allow-top-navigation`: the third party's
      // code in the frame cannot take the article somewhere else. **`allow-same-origin` is present
      // here, where §18.6's gist deliberately drops it** — the editor and the preview use their own
      // storage and workers, so an opaque origin breaks them. Measured with `allow=""` beside it
      // (2026-08-30), a pairing neither Qiita nor Zenn ships: the editor paints, and 「Click to Run」
      // boots the preview.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    };
  },
};

// §21.3. Measured over 473 pens collected from Qiita's API (2026-08-31): 460 slugs of 7 characters
// and 13 of 6, drawn from 33 letters with no digit among them. The class is wider than that on
// §17.2's judgment — a predicate narrowed to one measurement turns live pens silently into plain
// links — and it is an allowlist because this value reaches the src (§4.2).
//
const CODEPEN_SLUG = /^[A-Za-z0-9]{4,16}$/;
// The new editor's pens, which carry a UUIDv7 instead (`019f2a4c-772a-7863-84be-b43a2738f8f5`).
// **A second shape rather than a widened first one**: a class covering both would be
// `[A-Za-z0-9-]{4,40}`, which admits every hyphenated string in between and none of them names a
// pen. §4.2 asks for the shapes that can be expressed, and these are two shapes.
//
// Lowercase hex only, which is what all four measured pens spell and what a UUID is canonically
// written as. Measured 2026-08-31 in the author's own browser: `/<user>/embed/<UUID>` renders,
// including for a pen whose page URL is the `/editor/` form (§21.3).
const CODEPEN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The user segment goes into the src too, so it is checked with the same kind of predicate rather
// than trusted from the parse. 163 usernames measured, the longest 26 characters, all inside this
// class.
const CODEPEN_USER = /^[\w-]{1,40}$/;
// `/pen/` is the canonical page; `/full/` and `/details/` are the same pen under a different view
// and carry the slug in the same place.
const CODEPEN_PATH = /^\/([^/]+)\/(?:pen|full|details)\/([^/]+)\/?$/;
// A team's pens sit one segment deeper, and CodePen's own official account is a team — so this is
// not an edge shape. The `/pen/` → `/embed/` rule applies to it literally, which is the form built
// below; measured 2026-08-31, and `/<team>/embed/<slug>` renders too, so this keeps the spelling of
// the page the author was holding (§21.4).
const CODEPEN_TEAM_PATH = /^\/team\/([^/]+)\/(?:pen|full|details)\/([^/]+)\/?$/;
// The new editor's own address bar. The `/editor/` prefix is **not** carried into the src: the
// plain `/<user>/embed/<UUID>` renders the same pen (measured 2026-08-31), and it is the form the
// canonical page URL of such a pen already takes. `/full/` and `/details/` are not accepted here —
// only `/pen/` was seen under this prefix.
const CODEPEN_EDITOR_PATH = /^\/editor\/([^/]+)\/pen\/([^/]+)\/?$/;

// Nothing is asked for, for §20.7's reason with more force behind it: what a pen frames is
// third-party code with no sandbox author in between. Zenn sets no `allow` attribute at all, which
// grants the same nothing.
const CODEPEN_ALLOW = '';

const codepen: Provider = {
  name: 'CodePen',
  kind: 'コード',
  hosts: ['codepen.io', 'www.codepen.io'],
  resolve: (url) => {
    // Three page shapes, each naming the owner and the slug in the same two places. They cannot
    // overlap — the first is three path segments and the other two are four, under a fixed first
    // segment — so the order they are tried in carries no meaning.
    const team = CODEPEN_TEAM_PATH.exec(url.pathname);
    const match = team ?? CODEPEN_EDITOR_PATH.exec(url.pathname) ?? CODEPEN_PATH.exec(url.pathname);
    if (match === null) return null;
    const [, user, slug] = match;
    if (!CODEPEN_USER.test(user)) return null;
    if (!CODEPEN_SLUG.test(slug) && !CODEPEN_UUID.test(slug)) return null;
    // A team keeps its prefix in the src and a `/editor/` URL drops its own, because those are the
    // two forms measured to render (§21.3) — and the first is what CodePen's own `/pen/` → `/embed/`
    // rule produces when applied to the page the author was holding.
    const owner = team ? `team/${user}` : user;
    return {
      provider: 'codepen',
      // `/pen/` → `/embed/`, which is what CodePen's own documentation says to do
      // (`blog.codepen.io/documentation/embedded-pens/`) and what Zenn emits for `@[codepen](…)`.
      //
      // **Not one query parameter is appended**, and that is a decision rather than an omission
      // (§21.5). Zenn adds `embed-version=2`, which CodePen documents nowhere and which the frame
      // renders without (measured 2026-08-31). `default-tab` and `theme-id` both work, and both
      // would be a default chosen on every author's behalf: which panel is the point of a pen
      // differs between a CSS demo and a JS one, and the frame's own tab bar is already in the
      // reader's hands. §20.5 added `runonclick=1` because 114 requests became 64; the same
      // reasoning refuses `/embed/preview/` here, where the saving measured is 10 requests → 8.
      //
      // **The user segment is not checked by CodePen** — `/anon/embed/<slug>` renders the same pen
      // (measured 2026-08-31) — so it is carried rather than derived: the author's URL spells it,
      // and this file has no better spelling to offer.
      src: () => `https://codepen.io/${owner}/embed/${slug}`,
      title: 'CodePen のペン',
      // Empty for §20.10's reason: the slug is not a name. **The user segment is deliberately not
      // put here** — the src does not use it as the reference and CodePen does not verify it, so
      // the drag ghost would be naming an author on the strength of a string nobody checked.
      label: { lead: codepen.name, detail: '' },
      allow: CODEPEN_ALLOW,
      // No document of our own: the frame reports no height (measured over 15s, §21.6), and the
      // script that would make it report one is a third-party `<script>` on the page (§6).
      srcdoc: null,
      // §20.7's value, and the entry that matters is again the absent `allow-top-navigation`:
      // arbitrary JS runs in here and must not be able to take the article elsewhere. **Zenn ships
      // no `sandbox` at all**, so this is a deliberate divergence. `allow-same-origin` stays for
      // §20.7's reason — CodePen runs the result in a nested `cdpn.io` frame that uses storage.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    };
  },
};

// Grouped by `kind` (§24.5, 2026-09-03) — the three スライド rows and the three コード rows sit
// together rather than being split by Figma or Speaker Deck landing between them. Adjacent repeats
// read as a deliberate group; the same three words scattered through the list read as accidental.
// Speaker Deck sits last in its group, not first, so the one row with a note is the group's tail
// rather than its opening example.
const PROVIDERS: readonly Provider[] = [
  youtube,
  x,
  slideshare,
  docswell,
  speakerdeck,
  figma,
  gist,
  codesandbox,
  codepen,
];

// What can be embedded at all, for the insert dialog's table (docs/embed-requirements.md §24.1).
//
// **Derived from the registry, never written twice.** A hand-kept list would have been wrong four
// times in the month this file grew Figma, the gist, CodeSandbox and CodePen — and wrong is worse
// here than absent, since the table is the only place an author is told what is supported.
//
// **`hosts` rides along even though the dialog no longer prints them** (§24.1, 2026-09-03). It is
// what the lit row is looked up by — a resolved reference's host against this list — and it is the
// matcher's own data rather than a second string, so carrying it costs nothing and asking the
// dialog to reach for `PROVIDERS` instead would hand it the whole registry.
export type EmbedProviderInfo = {
  name: string;
  hosts: readonly string[];
  kind: string;
  note?: string;
};
export const EMBED_PROVIDERS: readonly EmbedProviderInfo[] = PROVIDERS.map((provider) => ({
  name: provider.name,
  hosts: provider.hosts,
  kind: provider.kind,
  note: provider.note,
}));

// What the insert dialog says about a reference it cannot embed, or null when it has nothing to add
// and the generic sentence stands (§24.1). **Asked only of a URL `resolveEmbed` has refused** — a
// provider that claimed the host is what makes a specific answer possible, and a provider that did
// not is why most references get the generic one.
//
// The parse is repeated rather than shared with `resolveEmbed`: this runs once per keystroke at
// most, against a string the author is looking at, and the alternative is a second return channel
// through a function every caller in both render stages already uses for something else.
export function embedRefusal(href: string): string | null {
  const value = href.trim();
  if (value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const provider = PROVIDERS.find((candidate) => candidate.hosts.includes(url.hostname));
  return provider?.refusal?.(url) ?? null;
}

// Whether a refused reference should still be offered as a link card (§24.1's two-kind split,
// `cardFallback` above). Asked only where `embedRefusal` already returned non-null — a URL no
// provider refused takes the ordinary card path and never reaches this.
export function embedCardFallback(href: string): boolean {
  const value = href.trim();
  if (value === '') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const provider = PROVIDERS.find((candidate) => candidate.hosts.includes(url.hostname));
  return provider?.cardFallback ?? false;
}

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
