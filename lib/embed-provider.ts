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
  // The iframe's src, built here and nowhere else. **A stored reference never becomes a src.** The
  // published stage runs after rehype-sanitize, so this string meets no other check on its way into
  // the DOM (§4.2) — hence an allowlist of shapes that can be expressed, rather than a filter over
  // shapes that cannot.
  src: string;
  // The iframe's accessible name. Generic on purpose (§8-②): with no fetch, the target's own title
  // is not available to either surface.
  title: string;
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
    return { provider: 'youtube', src, title: 'YouTube 動画', allow: YOUTUBE_ALLOW };
  },
};

const PROVIDERS: readonly Provider[] = [youtube];

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
