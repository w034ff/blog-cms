import 'server-only';

// The origin this site is served from, and the one thing that changes when it moves
// between hosts (localhost → a Tailscale Funnel `*.ts.net` name → a domain behind
// Cloudflare). Anything that has to emit an absolute URL — metadataBase, and the
// OGP/canonical fields built on it — reads it from here, so a move is a change of
// environment rather than a hunt through the source.
//
// Unset means local development. Deployments must set SITE_ORIGIN, because the
// fallback is not merely wrong there: it would publish og:image and canonical URLs
// pointing at the reader's own machine.
const DEFAULT_ORIGIN = 'http://localhost:3001';

function resolveSiteOrigin(): URL {
  const raw = process.env.SITE_ORIGIN?.trim();
  if (!raw) return new URL(DEFAULT_ORIGIN);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Thrown rather than quietly falling back: a typo that degrades to localhost
    // would only surface later as broken share cards, far from its cause.
    throw new Error(`SITE_ORIGIN is not a valid absolute URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`SITE_ORIGIN must be http(s): ${raw}`);
  }
  // Only the origin is meaningful; a stray path would be prefixed onto every
  // resolved URL. `new URL(url.origin)` also drops any query/fragment.
  return new URL(url.origin);
}

export const siteOrigin = resolveSiteOrigin();
