import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchGuarded, readCapped, type Deps } from './guarded-fetch';
import { ALLOWED_IMAGE_MIME_TYPES } from './uploads';

// The external card's image, served through this site (docs/link-card-requirements.md §14.4) as
// `/api/link-image?url=…&sig=…`, as Zenn and はてな do, so readers never hit the target's CDN.
// **The signature is what stops this being an open image proxy**: readers need the route, so it
// can't be admin-gated.

// Truncated HMAC: 80 bits, far past what forging a fetch of one public image is worth.
const SIGNATURE_LENGTH = 20;

// Below the 5MB upload cap: the image is drawn at 8rem × 5rem, and this bounds what one published
// URL can cost this server.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// A bounded in-memory cache: the signed URL is public and permanent, and without it N requests to a
// card are N outbound fetches (§14.11). Failures are cached too, or a gone image would be re-asked
// every time. A CDN would do this better.
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_FAIL_TTL_MS = 10 * 60 * 1000;

// A subkey derived from the one deployment secret, so the two uses can't compromise each other.
// **Thrown rather than defaulted:** `?? ''` would make the key computable, an open proxy that looks
// like it works (lib/site.ts refuses a missing SITE_ORIGIN for the same reason).
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

// Fixed-length hex, since `timingSafeEqual` throws on a length mismatch.
export function verifyImageUrl(url: string, sig: string): boolean {
  if (typeof sig !== 'string' || sig.length !== SIGNATURE_LENGTH) return false;
  return timingSafeEqual(Buffer.from(signature(url)), Buffer.from(sig));
}

// What goes in the card's `<img src>`. Same-origin and signed, so the third party's URL never
// reaches the reader's browser and the reader's address never reaches the third party.
export function linkImageSrc(url: string): string {
  return `/api/link-image?url=${encodeURIComponent(url)}&sig=${signature(url)}`;
}

// The image, or null for any refusal. The type allowlist is lib/uploads.ts's, and **SVG is not on
// it**: served from this origin, an SVG's script would be same-origin.
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
  // Exactly at the cap means truncated; no picture beats a torn one.
  if (bytes.length === 0 || bytes.length >= MAX_IMAGE_BYTES) return null;
  return { bytes, contentType };
}

// Would this URL serve an image? Asked when a card is written (lib/link-previews.ts) from status,
// type and declared length, cancelling the body.
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

// An undeclared length is fine (the read cap bounds it); a declared one over the cap is refused.
function declaredLengthFits(response: Response): boolean {
  const declared = Number(response.headers.get('content-length'));
  return !Number.isFinite(declared) || declared <= MAX_IMAGE_BYTES;
}

type Entry = { image: LinkImage | null; expires: number };
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<LinkImage | null>>();

// What the route calls: one fetch per URL per TTL, shared by simultaneous requests.
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
  // Insertion order makes the first key the oldest; evicted by bytes, since images vary widely.
  let total = 0;
  for (const entry of cache.values()) total += entry.image?.bytes.length ?? 0;
  while (total > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    total -= cache.get(oldest)?.image?.bytes.length ?? 0;
    cache.delete(oldest);
  }
}
