import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Reading the title of a page the author linked to, for the link card's top line
// (docs/link-requirements.md §5.5.10). The pure parts live here so they can be tested without a
// server or a network; the route (app/api/link-title/route.ts) is the admin gate, the cache and
// the same-origin short-circuit around them.
//
// This is a server fetching a URL chosen by its caller, so the guard below is the load-bearing
// part of the file. It is written against resolved addresses rather than against the text of the
// href, because a string test is not protection: `http://evil.example/` whose A record is
// 127.0.0.1 passes any spelling check, and so does a 302 into the same. Every hop is resolved and
// re-checked.

// Enough of a page to hold <head>. Titles live near the top; anything past this is a download we
// have no use for, and an unbounded read is a way for one link to exhaust memory.
const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
// Third-party text arriving in the editor's DOM. React escapes it, so the concern is layout rather
// than injection: an unbounded title reflows the card.
export const TITLE_MAX_LENGTH = 120;

// Addresses the server must not be talked into fetching: loopback, link-local (including the cloud
// metadata range), the RFC 1918 blocks, carrier-grade NAT, and their v6 equivalents. Written over
// the parsed address, so `0x7f.1`, `2130706433` and a DNS name pointing at any of them all arrive
// here in the same form.
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (family === 6) {
    const v6 = address.toLowerCase().split('%')[0];
    if (v6 === '::' || v6 === '::1') return true;
    if (
      v6.startsWith('fe8') ||
      v6.startsWith('fe9') ||
      v6.startsWith('fea') ||
      v6.startsWith('feb')
    )
      return true; // link-local
    if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // unique-local
    if (v6.startsWith('ff')) return true; // multicast
    // IPv4-mapped (::ffff:127.0.0.1) is the same address wearing a hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)?.[1];
    if (mapped) return isBlockedAddress(mapped);
    return false;
  }
  // Not an address at all — the caller resolves names before asking.
  return true;
}

// og:title first: it is what the page wants to be called when quoted, which is what this is.
// Falls back to <title>, which every one of the pages measured 2026-08-16 carried.
export function extractTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return normalizeTitle(og ?? title ?? '');
}

export function normalizeTitle(raw: string): string | null {
  const text = raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}…` : text;
}

type Deps = {
  resolve: (hostname: string) => Promise<string[]>;
  fetchImpl: typeof fetch;
};

const defaultDeps: Deps = {
  resolve: async (hostname) => {
    const records = await lookup(hostname, { all: true });
    return records.map((record) => record.address);
  },
  fetchImpl: fetch,
};

// null means "no title to show" for every reason there is — refused scheme, blocked address, a
// status that is not 2xx, a body that is not HTML, a timeout, no <title>. The caller has exactly
// one fallback (keep showing the URL), so distinguishing them here would buy nothing.
export async function fetchLinkTitle(
  href: string,
  deps: Partial<Deps> = {},
): Promise<string | null> {
  const { resolve, fetchImpl } = { ...defaultDeps, ...deps };
  let target: URL;
  try {
    target = new URL(href);
  } catch {
    return null;
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    // The hostname may already be an address literal, in which case `resolve` is asked nothing and
    // the literal is checked directly — otherwise a name is only as trustworthy as what it maps to.
    const bare = target.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    if (isIP(bare)) {
      addresses = [bare];
    } else {
      try {
        addresses = await resolve(bare);
      } catch {
        return null;
      }
    }
    // Every record, not the first: a name that resolves to a public address *and* a private one is
    // the classic way past a check that stops at one.
    if (addresses.length === 0 || addresses.some(isBlockedAddress)) return null;

    let response: Response;
    try {
      response = await fetchImpl(target.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'text/html' },
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return null;
      try {
        target = new URL(location, target);
      } catch {
        return null;
      }
      continue; // resolved and re-checked at the top of the loop
    }

    // Not 2xx means there is no page here, whatever the body says. Measured 2026-08-16: a
    // Cloudflare challenge answers 403 *and* carries `<title>Just a moment...</title>`, so a
    // parser that ignores the status would put that on the card in place of the URL.
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').includes('text/html')) return null;

    return extractTitle(await readCapped(response));
  }
  return null;
}

// Read at most MAX_BYTES, then stop pulling. Decoded as UTF-8: all ten pages measured 2026-08-16
// declared it, so a charset negotiation would be machinery with nothing to do.
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(joined.slice(0, MAX_BYTES));
}
