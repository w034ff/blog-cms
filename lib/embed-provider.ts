// What a URL becomes when it is embedded, and which URLs may become one
// (docs/embed-requirements.md §4, §4.3, §9.2). Shared by the published stage (lib/rehype-embed.ts)
// and the editor (components/editor/embed-extension.ts, LinkBubble.tsx), so an embed the editor
// makes can never be refused on publish. No DOM or DB, so both can import it.
//
// **No fetch happens anywhere in this file** (§3.2): everything an embed shows is derived from the
// reference itself, unlike the link card.

// `GIST_SOURCE` must be the same string in all three places that use it.
import { GIST_SOURCE } from './embed-message';

export type EmbedTarget = {
  // The CSS hook both surfaces share (`embed-<provider>`), derived here so the stored form needs
  // none (§4).
  provider: string;
  // The iframe's src for ONE placement, built here and nowhere else. **A stored reference never
  // becomes a src:** the published stage runs after rehype-sanitize (§4.2), hence an allowlist of
  // expressible shapes. A function so a provider can name this particular iframe (X's `embedId`,
  // §10.5); the id is minted by the render stages, never by `resolveEmbed`.
  src: (instanceId: string) => string;
  // The iframe's accessible name, generic because nothing is fetched (§8-②).
  title: string;
  // How the embed reads when *named* rather than shown, in the editor's drag ghost (§10.10):
  // `lead` is the strongest thing the URL says (an account, or the provider), `detail` the rest or
  // `''`. Separate from `title`, which must say what kind of thing this is; this sits beside a mark
  // that already does.
  label: { lead: string; detail: string };
  allow: string;
  // A document of our own framing the provider, or null to point the iframe at `src`. **So a
  // provider can be made to report its height** (§18.5): GitHub's gist markup reports nothing and
  // can't be measured cross-origin. Stages set `srcdoc` **instead of** `src`; escaping is theirs.
  srcdoc: ((src: string, instanceId: string) => string) | null;
  // The `sandbox` attribute, or null for none (`sandbox=""` is the most restrictive value). **Only
  // for a provider that would otherwise navigate the article away** (§18.6): a blanket rule would
  // break players that run script.
  sandbox: string | null;
};

type Provider = {
  // The provider's name for the author, e.g. the insert dialog's table (§24.1). Here rather than in
  // each `label.lead` because it must be readable without a URL; `lead` reads it instead of
  // repeating the string (embed-provider.test.ts holds one spelling).
  name: string;
  // Matched against `URL.hostname`, which is already lowercased and punycoded by the parser.
  hosts: readonly string[];
  // **What the insert dialog prints beside the name** (§24.1): one noun for the kind of thing
  // embedded. Hosts answered the wrong question (which site, when authors get the *page* wrong),
  // and no printed URL shape separates the providers. Kinds repeat on purpose (three スライド, three
  // コード), so the lookup lands on a group, and a kind is true without a URL.
  kind: string;
  // **The one provider whose address bar is not the answer** (§16.10): a deck page carries no id,
  // and `/player/<id>` only appears inside the embed code (§16.3). Printed after the kind; absent
  // for the others. **It names the code rather than a button**, since `speakerdeckSnippetHref` takes
  // both Share buttons; which button is the refusal's to say.
  note?: string;
  // **What the dialog's refusal says about an unresolved URL on this provider's hosts**, or null for
  // the generic sentence (§24.1). It answers for *every* failing shape on those hosts, so it says
  // what is embeddable rather than what went wrong. Two kinds:
  //
  //   - **The URL is fixable** (Figma, Speaker Deck): say what embeds, and don't suggest a card.
  //   - **Not embeddable at all** (Docswell's video, CodeSandbox's devbox): keep the card, add why.
  //
  // Takes `resolveEmbed`'s parsed URL, so it can't disagree with the matcher.
  refusal?: (url: URL) => string | null;
  // Whether the dialog may offer a card when `refusal` fires: true for the "not embeddable" kind
  // (「残す」), false where a fixable URL exists (「勧めない」).
  cardFallback?: boolean;
  resolve: (url: URL) => EmbedTarget | null;
};

// §9.2. **Every id is verified against the parse, not trusted from it**, because it reaches the
// src: what can't be expressed here can't be embedded. The same rule holds for every provider's
// patterns below.
const YOUTUBE_ID = /^[\w-]{11}$/;
// `/shorts/<ID>`, `/live/<ID>`, `/embed/<ID>`: the id in the same place.
const YOUTUBE_PATH = /^\/(?:shorts|live|embed)\/([^/]+)/;
// `90`/`90s` and `1h2m3s`. Bounded, so no absurd value reaches the src in exponential notation.
const SECONDS = /^(\d{1,9})s?$/;
const CLOCK = /^(?:(\d{1,9})h)?(?:(\d{1,9})m)?(?:(\d{1,9})s)?$/;

// YouTube's share-link permissions minus `autoplay` and `fullscreen`, which the author didn't ask
// for.
const YOUTUBE_ALLOW =
  'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

function youtubeId(url: URL): string | null {
  // `youtu.be/<ID>`: the id is read, not followed (no request on the wire).
  if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
  // `watch?v=<ID>`: `v` decides, so a `list` is dropped (§9.4); a `list` alone is a playlist.
  if (url.pathname === '/watch') return url.searchParams.get('v');
  return YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null;
}

// The start time (§9.3). One this doesn't understand plays from the start rather than writing an
// uninterpreted string into the src.
function youtubeStart(url: URL): number {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw === null) return 0;
  const seconds = SECONDS.exec(raw);
  if (seconds) return Number(seconds[1]);
  const clock = CLOCK.exec(raw);
  // CLOCK matches the empty string too; all-empty means nothing was recognised.
  if (!clock || (clock[1] === undefined && clock[2] === undefined && clock[3] === undefined)) {
    return 0;
  }
  return Number(clock[1] ?? 0) * 3600 + Number(clock[2] ?? 0) * 60 + Number(clock[3] ?? 0);
}

const youtube: Provider = {
  name: 'YouTube',
  kind: '動画',
  // Not nocookie (an output, not an input) or music.youtube.com (§9.2).
  hosts: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'],
  resolve: (url) => {
    const id = youtubeId(url);
    if (id === null || !YOUTUBE_ID.test(id)) return null;
    const start = youtubeStart(url);
    // nocookie: the request can't be removed but its cookies can (§9.5).
    const src = `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
    // The instance id is unused: a YouTube iframe says nothing to its parent.
    return {
      provider: 'youtube',
      src: () => src,
      title: 'YouTube 動画',
      // The video can't be named without a fetch, so the provider leads and the start time follows.
      label: { lead: youtube.name, detail: start > 0 ? `${start} 秒から` : '' },
      allow: YOUTUBE_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// §10.4. Up to 19 digits (a snowflake id).
const X_ID = /^\d{1,19}$/;
// `/<handle>/status/<ID>` and `/i/status/<ID>`. The handle stays `[^/]+`: only the id reaches the
// src, and X's handle rules would go stale.
const X_PATH = /^\/([^/]+)\/status\/([^/]+)/;

// Nothing is asked for: a post needs none of the player's permissions.
const X_ALLOW = '';

const x: Provider = {
  name: 'X',
  kind: '投稿',
  // No `t.co`: resolving a redirector is a request (§3.2). twitter.com is matched directly for the
  // same reason (§10.1).
  hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
  resolve: (url) => {
    const path = X_PATH.exec(url.pathname);
    const id = path?.[2] ?? null;
    // Profiles, lists and searches become cards (§10.4) through this `null`.
    if (id === null || !X_ID.test(id)) return null;
    return {
      provider: 'x',
      // `embedId` makes `resize` attributable (§10.5); `lang` localises the widget UI only (§10.4).
      // The author's string reaches neither.
      src: (instanceId) =>
        `https://platform.twitter.com/embed/Tweet.html?id=${id}&lang=ja&embedId=${encodeURIComponent(instanceId)}`,
      title: 'X の投稿',
      // The account leads; `/i/status/<ID>` has none, so the provider and the id.
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

// docs/embed-requirements.md §14.2. Digits, bounded like X_ID.
const SLIDESHARE_ID = /^\d{1,19}$/;
// `/slideshow/<slug>/<id>`, the only public shape carrying an id. Only the id reaches the src.
const SLIDESHARE_PATH = /^\/slideshow\/[^/]+\/([^/]+)\/?$/;

// Nothing is asked for. Full screen is the iframe's `allowFullScreen`, which both stages set.
const SLIDESHARE_ALLOW = '';

const slideshare: Provider = {
  name: 'SlideShare',
  kind: 'スライド',
  // Narrow, as §9.2: locale hosts are an open-ended set, and their URLs become cards.
  hosts: ['www.slideshare.net', 'slideshare.net'],
  resolve: (url) => {
    const id = SLIDESHARE_PATH.exec(url.pathname)?.[1] ?? null;
    if (id === null || !SLIDESHARE_ID.test(id)) return null;
    return {
      provider: 'slideshare',
      // The id form, which 302s to the `embed_code/key/<KEY>` SlideShare publishes (§14.3), followed
      // by the reader's browser, so no key is fetched (§3.2).
      src: () => `https://www.slideshare.net/slideshow/embed_code/${id}`,
      title: 'SlideShare のスライド',
      // The provider only: the slug is no name (often digits or the id again, §14.8).
      label: { lead: slideshare.name, detail: '' },
      allow: SLIDESHARE_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §15.2. **Wider than the keys measured**, since refusing a real key
// turns a working file into a bare link; it only rules out what can't be a key. A ceiling, not a
// length.
const FIGMA_KEY = /^[\w-]{1,64}$/;
// `/design/<key>/<slug>` and `/file/<key>/<slug>` (the same file; Figma's own `og:url` uses it).
// `/proto/`, `/board/` and `/slides/` are deliberately absent (§15.2).
const FIGMA_PATH = /^\/(?:design|file)\/([^/]+)(?:\/|$)/;
// `node-id=5-2` or the older `5:2`, the same node. The src gets the hyphen form, built from the
// parsed digits (§9.3).
const FIGMA_NODE = /^(\d{1,9})[-:](\d{1,9})$/;

// Figma refuses to render without it. It identifies this site to a third party, so it is not
// the site's name, which an admin can change (docs/site-settings-requirements.md): renaming the
// site must not retarget Figma.
const FIGMA_EMBED_HOST = 'tech-blog';

// Nothing is asked for; full screen is `allowFullScreen`'s.
const FIGMA_ALLOW = '';

const figma: Provider = {
  name: 'Figma',
  kind: 'デザインファイル',
  // Not `embed.figma.com` (an output) or `figma.site` (a different product).
  hosts: ['www.figma.com', 'figma.com'],
  // **The author can fix the URL** (§24.1): `/proto/` etc. are views of a file whose design URL
  // Figma hands over. Phrased as what embeds, since it answers for every failing URL on the host.
  refusal: () => '埋め込めるのは /design/ か /file/ の URL です。',
  resolve: (url) => {
    const key = FIGMA_PATH.exec(url.pathname)?.[1] ?? null;
    if (key === null || !FIGMA_KEY.test(key)) return null;
    const node = FIGMA_NODE.exec(url.searchParams.get('node-id') ?? '');
    // The node is carried (§15.3); `p=f` and `t=` are UI and sharing tokens, dropped (§15.4).
    const target = node ? `&node-id=${node[1]}-${node[2]}` : '';
    return {
      provider: 'figma',
      // The documented embed host, which 302s for the reader's browser (§15.3). Not the legacy
      // `embed?url=<page URL>`, which would put the author's string into the src (§4.2).
      src: () => `https://embed.figma.com/design/${key}?embed-host=${FIGMA_EMBED_HOST}${target}`,
      title: 'Figma のデザイン',
      // The provider only, for SlideShare's reason.
      label: { lead: figma.name, detail: '' },
      allow: FIGMA_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §16.2. Lowercase hex, 24 (older) or 32 characters. **Uppercase is a
// different id** (404).
const SPEAKERDECK_ID = /^[0-9a-f]{24,32}$/;
// `/player/<id>`, **the only shape there is** (§16.2): the deck page URL has no id, and no
// slug-shaped alias exists.
const SPEAKERDECK_PATH = /^\/player\/([^/]+)\/?$/;

// Nothing is asked for: the snippet's `web-share` is for a link-list menu the author didn't ask
// for. Full screen is `allowFullScreen`'s.
const SPEAKERDECK_ALLOW = '';

const speakerdeck: Provider = {
  name: 'Speaker Deck',
  kind: 'スライド',
  // `www` 301s to the apex with the id in the same place (as §14.2).
  hosts: ['speakerdeck.com', 'www.speakerdeck.com'],
  // **The row says the paste is not a URL; the refusal names a button** (§16.10). The note names
  // the code, true of both Share buttons `speakerdeckSnippetHref` takes (§16.9); the refusal is a
  // one-path recipe that must fit one line at 390px (§24.1).
  note: '埋め込みコード',
  refusal: () => 'Share →「Copy iframe code」の内容を貼ってください。',
  resolve: (url) => {
    const id = SPEAKERDECK_PATH.exec(url.pathname)?.[1] ?? null;
    if (id === null || !SPEAKERDECK_ID.test(id)) return null;
    return {
      provider: 'speakerdeck',
      // Rebuilt on the apex so both spellings reach one src. No canonical page or redirect exists
      // to start from (§16.3).
      src: () => `https://speakerdeck.com/player/${id}`,
      title: 'Speaker Deck のスライド',
      // The provider only (§16.7).
      label: { lead: speakerdeck.name, detail: '' },
      allow: SPEAKERDECK_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §17.2. Uppercase letters and digits; a ceiling, as FIGMA_KEY's.
// **Lowercase is left out on purpose, which keeps videos out:** a video's key is `v`-prefixed on
// the same path and embeds elsewhere, and keys are case-sensitive, so lowercase could only build a
// src showing Docswell's 404.
const DOCSWELL_KEY = /^[0-9A-Z]{1,32}$/;
// A video's key, named so the refusal can recognise it (§24.1).
const DOCSWELL_VIDEO_KEY = /^v[0-9A-Z]{1,32}$/;
// `/s/<user>/<key>-<slug>`, the deck page. The slug is optional, the key ends at the first `-`,
// `/<n>` is a page permalink (§17.3), and `/s/` is lowercase because paths are case-sensitive.
const DOCSWELL_PATH = /^\/s\/[^/]+\/([^/-]+)(?:-[^/]*)?(?:\/(\d{1,4}))?\/?$/;
// `#p<n>`, the page the deck's own player writes into the address bar.
const DOCSWELL_PAGE = /^#p(\d{1,4})$/;

// Nothing is asked for; full screen is `allowFullScreen`'s.
const DOCSWELL_ALLOW = '';

// The page, carried into the player (§17.3) from `#p<n>` or `/<n>`. The player clamps, so the deck
// length needn't be known.
function docswellPage(url: URL, path: RegExpExecArray): number {
  const fragment = DOCSWELL_PAGE.exec(url.hash)?.[1];
  return Number(fragment ?? path[2] ?? 0);
}

const docswell: Provider = {
  name: 'Docswell',
  kind: 'スライド',
  // The apex answers directly with the key in the same place.
  hosts: ['www.docswell.com', 'docswell.com'],
  // **Videos only:** they don't frame at all, so the card stays the answer (§17.2) and this adds
  // why.
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
      // The embed form Docswell itself publishes (§17.3): same key, no redirect, no fetch. The
      // fragment comes from the parsed number (§9.3); page 1 writes none.
      src: () => `https://www.docswell.com/slide/${key}/embed${page > 1 ? `#p${page}` : ''}`,
      title: 'Docswell のスライド',
      // The provider, then the page, as for YouTube (§17.7).
      label: { lead: docswell.name, detail: page > 1 ? `${page} ページ目から` : '' },
      allow: DOCSWELL_ALLOW,
      srcdoc: null,
      sandbox: null,
    };
  },
};

// docs/embed-requirements.md §18.2. Lowercase hex, 20 (older) or 32 characters; uppercase is a
// different gist (404).
const GIST_ID = /^[0-9a-f]{20,32}$/;
// A GitHub login (≤ 39 characters). **The first non-id segment that reaches a src here**, and it
// must: a wrong owner is a 404 rather than a redirect. Case doesn't matter, so it isn't normalised.
const GIST_OWNER = /^[A-Za-z0-9-]{1,39}$/;
// `/<owner>/<id>` and `/<id>`, which 302s to the first for the reader's browser; the frame still
// draws, since the 302's `x-frame-options` doesn't reach the document.
const GIST_PATH = /^\/([^/]+)(?:\/([^/]+))?\/?$/;
// `?file=` (§18.3), as Zenn and Qiita spell it. Bounded, not enumerated: it is percent-encoded
// into the src, so this only excludes strings that can't name a file. **An unknown name is a 404
// with `x-frame-options: deny`**, showing the browser's refusal instead of the gist.
const GIST_FILE = /^[^/\\\u0000-\u001f\u007f]{1,255}$/;

// Nothing is asked for: `.pibb` is static markup with no script.
const GIST_ALLOW = '';

// The document GitHub's gist script runs inside (embed-requirements.md §18.5): one string from two
// arguments, identical on both stages. It adds:
//
//   1. **A reporter** of the height and the file count (lib/embed-message.ts; zero files means a
//      dead gist). **It answers an `{ask}` as well as announcing**, because the frame can announce
//      before the parent's listener exists (on hydration). Only the resize path de-duplicates.
//   2. `<base target="_blank">`, since the sandbox has no `allow-top-navigation`. **`.pibb` writes
//      `target="_parent"` instead**, which could take the article away (§18.6).
//   3. No background or margin, so the box is the gist's own height.
//
// **The height is `<body>`'s box, not `documentElement.scrollHeight`**, which is clamped to the
// frame's viewport and could never shrink the box.
//
// **The document ends at the reporter's `</script>` and closes no tags after it.** React's SSR drops
// anything after `</script>` in this attribute while the RSC payload keeps it, a hydration mismatch.
// Add anything new BEFORE that script.
//
// `postMessage` targets `'*'`: the sandboxed frame's origin is opaque, and the payload holds nothing
// to withhold. The parent checks the sender.
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
  // Not `gist.githubusercontent.com`: raw text under `x-frame-options: deny`, and an output of the
  // `view raw` link.
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
    // An invalid `file` is dropped (§9.3): the whole gist beats the browser's refusal notice.
    const file = named !== null && GIST_FILE.test(named) ? named : null;
    return {
      provider: 'gist',
      // **The embed script, not the frameable `.pibb`**, which we can't add a reporter to
      // (§18.3). `.js` is the same markup as `document.write` calls, run inside `gistDocument`.
      src: () =>
        `https://gist.github.com/${owner === null ? '' : `${owner}/`}${id}.js` +
        (file === null ? '' : `?file=${encodeURIComponent(file)}`),
      srcdoc: gistDocument,
      title: 'GitHub Gist のコード',
      // **The URL carries real names** (owner, file), so they lead, as X's account does (§10.4);
      // without an owner, the provider and the id.
      label:
        owner === null
          ? { lead: gist.name, detail: file ?? id }
          : { lead: owner, detail: file ?? '' },
      allow: GIST_ALLOW,
      // §18.6: `allow-scripts` for the gist and reporter, `allow-popups` for 「view raw」.
      // **No `allow-same-origin`**, keeping third-party markup out of the page; the price is an
      // opaque origin, so the parent authenticates by source window (§18.5).
      sandbox: 'allow-scripts allow-popups',
    };
  },
};

// docs/embed-requirements.md §20.3. **The only provider whose src takes the whole last path
// segment**: the embed endpoint answers the slug form and the bare id alike (as Zenn forwards it).
// **Not splitting is what keeps `react-new-devbox` safe**: taking the text after the last `-` would
// build a src for a sandbox that doesn't exist. Bounded generously (FIGMA_KEY's reason); case is not
// normalised.
const CODESANDBOX_SEGMENT = /^[0-9A-Za-z-]{1,64}$/;
// `/p/sandbox/<seg>` (canonical) and the legacy `/s/<seg>`. `/p/devbox/` is deliberately absent: VM
// Sandboxes don't embed off codesandbox.io at all (§20.3, §20.13).
const CODESANDBOX_PATH = /^\/(?:p\/sandbox|s)\/([^/]+)\/?$/;
// The shape the line above deliberately excludes, named so the refusal can say why (§24.1).
const DEVBOX_PATH = /^\/p\/devbox\/[^/]+\/?$/;

// Nothing is asked for (§20.7). CodeSandbox's snippet asks for camera, microphone and more, and
// **Qiita and Zenn copy it verbatim; this divergence is deliberate**: a sandbox frames arbitrary
// third-party code.
const CODESANDBOX_ALLOW = '';

const codesandbox: Provider = {
  name: 'CodeSandbox',
  kind: 'コード',
  // `www` answers directly (as §17.2's Docswell apex).
  hosts: ['codesandbox.io', 'www.codesandbox.io'],
  // **Devboxes only:** they don't frame off codesandbox.io at all (§20.13), so the card stays the
  // answer and this adds why.
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
      // `runonclick=1` is added here (§4's rule, not a liberty): it defers the bundler and preview
      // until the reader clicks, roughly halving the requests (§20.2, §20.5). Nothing else is
      // appended: other parameters would be defaults chosen for every author.
      src: () => `https://codesandbox.io/embed/${segment}?runonclick=1`,
      title: 'CodeSandbox のサンドボックス',
      // No `detail`: the segment is a slug or a random word, not a name.
      label: { lead: codesandbox.name, detail: '' },
      allow: CODESANDBOX_ALLOW,
      srcdoc: null,
      // Zenn's list: no `allow-top-navigation`, so the code can't navigate the article.
      // **`allow-same-origin` is present, unlike the gist's** (§18.6): the editor and preview need
      // their own storage and workers. Measured working with `allow=""`.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    };
  },
};

// §21.3. Pen slugs are letters (6-7 measured); the class is wider, on §17.2's judgment.
//
const CODEPEN_SLUG = /^[A-Za-z0-9]{4,16}$/;
// The new editor's pens carry a UUIDv7. **A second shape rather than a widened first one**, which
// would admit every hyphenated string in between (§4.2). Lowercase hex, UUID's canonical form;
// `/<user>/embed/<UUID>` renders, including for `/editor/` pens (§21.3).
const CODEPEN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The user segment reaches the src, so it is checked too.
const CODEPEN_USER = /^[\w-]{1,40}$/;
// `/pen/`, `/full/` and `/details/`: the same pen, the slug in the same place.
const CODEPEN_PATH = /^\/([^/]+)\/(?:pen|full|details)\/([^/]+)\/?$/;
// A team's pens (CodePen's own account is one), one segment deeper; `/<team>/embed/<slug>` keeps
// the page's spelling (§21.4).
const CODEPEN_TEAM_PATH = /^\/team\/([^/]+)\/(?:pen|full|details)\/([^/]+)\/?$/;
// The new editor's address bar. `/editor/` is dropped from the src: the plain form renders the
// same pen. Only `/pen/` was seen under this prefix.
const CODEPEN_EDITOR_PATH = /^\/editor\/([^/]+)\/pen\/([^/]+)\/?$/;

// Nothing is asked for, for §20.7's reason.
const CODEPEN_ALLOW = '';

const codepen: Provider = {
  name: 'CodePen',
  kind: 'コード',
  hosts: ['codepen.io', 'www.codepen.io'],
  resolve: (url) => {
    // Three non-overlapping page shapes, so their order means nothing.
    const team = CODEPEN_TEAM_PATH.exec(url.pathname);
    const match = team ?? CODEPEN_EDITOR_PATH.exec(url.pathname) ?? CODEPEN_PATH.exec(url.pathname);
    if (match === null) return null;
    const [, user, slug] = match;
    if (!CODEPEN_USER.test(user)) return null;
    if (!CODEPEN_SLUG.test(slug) && !CODEPEN_UUID.test(slug)) return null;
    // A team keeps its prefix and `/editor/` drops its own: the two forms known to render (§21.3).
    const owner = team ? `team/${user}` : user;
    return {
      provider: 'codepen',
      // `/pen/` → `/embed/`, as CodePen documents and Zenn emits. **No query parameter is
      // appended** (§21.5): Zenn's `embed-version=2` is undocumented and unneeded, and tab or theme
      // would be defaults chosen for every author. The user segment is carried, not checked:
      // CodePen doesn't verify it.
      src: () => `https://codepen.io/${owner}/embed/${slug}`,
      title: 'CodePen のペン',
      // Empty: the slug is no name, and the unverified user segment shouldn't name an author.
      label: { lead: codepen.name, detail: '' },
      allow: CODEPEN_ALLOW,
      // No document of our own: the frame reports no height, and making it would need a third-party
      // `<script>` on the page (§21.6, §6).
      srcdoc: null,
      // §20.7's value: no `allow-top-navigation` for arbitrary JS (**Zenn ships no `sandbox`**, a
      // deliberate divergence). `allow-same-origin` because the result runs in a nested `cdpn.io`
      // frame that uses storage.
      sandbox: 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups',
    };
  },
};

// Grouped by `kind` (§24.5), so repeated kinds read as a group; Speaker Deck ends its group so the
// row with a note is the tail.
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

// What can be embedded, for the insert dialog (§24.1). **Derived from the registry, never written
// twice.** `hosts` rides along, unprinted, because the lit row is looked up by host.
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

// The dialog's specific refusal, or null for the generic sentence (§24.1). Only for a URL
// `resolveEmbed` refused. The parse is repeated rather than threaded through `resolveEmbed`.
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

// Whether a refused reference may still be a card (`cardFallback`); only asked where
// `embedRefusal` is non-null.
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
  // No credentials in a reference (link-card-requirements.md §14.2.1 ②): 「リンクに戻す」 would
  // publish the string in an `<a href>`.
  if (url.username !== '' || url.password !== '') return null;
  const provider = PROVIDERS.find((candidate) => candidate.hosts.includes(url.hostname));
  return provider ? provider.resolve(url) : null;
}
