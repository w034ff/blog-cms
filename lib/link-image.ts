import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchGuarded, readCapped, type Deps } from './guarded-fetch';
import { ALLOWED_IMAGE_MIME_TYPES } from './uploads';

// The external link card's image, and the reason it is not an `<img src>` pointing at the target's
// CDN (docs/link-card-requirements.md §14.4).
//
// The card shows the target's og:image through this site instead: the published page emits
// `/api/link-image?url=…&sig=…`, and the route fetches that URL when a reader's browser asks for it.
// Measured 2026-08-18, this is what Zenn and はてな both do (§14.4.1) — neither points a reader at
// the origin site, and both sign the path.
//
// **The signature is what stops this being an open image proxy.** Without it, anyone could hand the
// route any URL and have this server fetch it for them — and unlike the editor's routes, this one
// cannot be admin-gated, because readers have to be able to load it.

// Truncated HMAC. 20 hex characters is 80 bits, which is far past what forging is worth here: the
// prize is making this server fetch one public image, and the address guard still stands behind it.
const SIGNATURE_LENGTH = 20;

// Smaller than an upload (`MAX_UPLOAD_BYTES` is 5MB): what this fetches is drawn at 8rem × 5rem,
// and the cap is also the ceiling on what one request to a *published* URL can cost this server.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Bounded, evicting, in memory. The signed URL is published in the page, so it is public and
// permanent — anyone can request it, and `Cache-Control` is advice a caller is free to ignore.
// Without this, N requests to one card are N outbound fetches from a home connection, which is an
// amplification the storage option (§14.11) structurally does not have. A CDN in front would do
// this better; until there is one, this is the part of its job that must not wait.
//
// Failures are cached too, and for the same reason rather than for symmetry: a target whose image
// has gone answers fast, and re-asking on every request is exactly the loop being closed here.
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FAIL_TTL_MS = 10 * 60 * 1000;

// A subkey rather than the session secret itself. The two sign different things for different
// audiences, and a key used for one purpose is the only kind whose compromise has a bounded
// meaning. Derived, so deployment keeps exactly the one secret it already sets.
//
// **Thrown rather than defaulted.** `?? ''` here would not degrade — it would make the key a
// constant anyone can compute, and this route is the one that cannot be admin-gated, so the result
// is an open image proxy that looks like it is working. lib/site.ts refuses a missing SITE_ORIGIN
// for the same shape of reason: a misconfiguration whose symptom appears somewhere else.
const secret = process.env.SESSION_SECRET;
if (!secret) {
  throw new Error(
    'SESSION_SECRET must be set: /api/link-image signs its URLs with a key derived from it, and an empty key is one anybody can compute.',
  );
}
const signingKey = createHmac('sha256', secret).update('link-image').digest();

function signature(url: string): string {
  return createHmac('sha256', signingKey).update(url).digest('hex').slice(0, SIGNATURE_LENGTH);
}

// Fixed-length hex on both sides, so `timingSafeEqual` can be used at all — it throws on a length
// mismatch, which is itself the leak it exists to avoid.
export function verifyImageUrl(url: string, sig: string): boolean {
  if (typeof sig !== 'string' || sig.length !== SIGNATURE_LENGTH) return false;
  return timingSafeEqual(Buffer.from(signature(url)), Buffer.from(sig));
}

// What goes in the card's `<img src>`. Same-origin and signed, so the third party's URL never
// reaches the reader's browser and the reader's address never reaches the third party.
export function linkImageSrc(url: string): string {
  return `/api/link-image?url=${encodeURIComponent(url)}&sig=${signature(url)}`;
}

// The image itself. `null` for every refusal there is — the guard, a status that is not 2xx, a type
// this site would not accept from its own author, a body over the cap, a timeout.
//
// The allowlist is `lib/uploads.ts`'s, which is the same list the upload route enforces, and that
// sharing is deliberate in one particular: **SVG is not on it.** An SVG can carry script, and this
// route serves bytes from this site's own origin — an allowlist that let one through would be
// handing a third party a same-origin script tag.
export type LinkImage = { bytes: Uint8Array; contentType: string };

export async function fetchImage(url: string, deps: Partial<Deps> = {}): Promise<LinkImage | null> {
  const response = await fetchGuarded(url, ALLOWED_IMAGE_MIME_TYPES.join(','), deps);
  if (!response) return null;
  const contentType = imageType(response);
  if (!contentType) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  const bytes = await readCapped(response, MAX_IMAGE_BYTES);
  // Exactly at the cap means the read stopped early and what is here is a truncated file. Serving
  // half an image is worse than serving none: the card would draw a torn picture rather than fall
  // back to the layout it has for having no picture at all.
  if (bytes.length === 0 || bytes.length >= MAX_IMAGE_BYTES) return null;
  return { bytes, contentType };
}

// "Would this URL serve an image?", asked without downloading one. Used when a card is written
// (lib/link-previews.ts), where the question is whether to keep the reference at all — the answer
// is the status, the type and, when the target declares it, the length. The body is cancelled
// unread: a yes/no does not need megabytes, and the route asks the real question later anyway.
export async function probeImage(url: string, deps: Partial<Deps> = {}): Promise<boolean> {
  const response = await fetchGuarded(url, ALLOWED_IMAGE_MIME_TYPES.join(','), deps);
  if (!response) return false;
  const ok = imageType(response) !== null && declaredLengthFits(response);
  await response.body?.cancel().catch(() => {});
  return ok;
}

function imageType(response: Response): string | null {
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return ALLOWED_IMAGE_MIME_TYPES.includes(type) ? type : null;
}

// An undeclared length is not a refusal — plenty of CDNs stream without one, and the read cap is
// what actually bounds this. A declared one over the cap is, because it is a download that would
// be thrown away at the cap anyway.
function declaredLengthFits(response: Response): boolean {
  const declared = Number(response.headers.get('content-length'));
  return !Number.isFinite(declared) || declared <= MAX_IMAGE_BYTES;
}

type Entry = { image: LinkImage | null; expires: number };
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<LinkImage | null>>();

// What the route calls. One fetch per URL per TTL, and one fetch for a burst of simultaneous
// requests — a published URL can be asked for by many readers at once, and without the in-flight
// map each of them would be its own outbound request for the same bytes.
export async function loadImage(url: string, deps: Partial<Deps> = {}): Promise<LinkImage | null> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.image;
  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = fetchImage(url, deps)
    .then((image) => {
      remember(url, image);
      return image;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

function remember(url: string, image: LinkImage | null): void {
  cache.delete(url);
  cache.set(url, {
    image,
    expires: Date.now() + (image ? CACHE_TTL_MS : CACHE_FAIL_TTL_MS),
  });
  // Insertion-ordered, so the first key is the oldest. Evicting by total bytes rather than by count
  // because the entries are images and one of them can be worth a hundred of another.
  let total = 0;
  for (const entry of cache.values()) total += entry.image?.bytes.length ?? 0;
  while (total > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    total -= cache.get(oldest)?.image?.bytes.length ?? 0;
    cache.delete(oldest);
  }
}
