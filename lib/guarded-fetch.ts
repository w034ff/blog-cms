import { lookup } from 'node:dns/promises';
import { isIP, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// The one place in this codebase that requests a URL chosen by its caller, and the guard that makes
// that safe (docs/link-card-requirements.md §14.5, docs/link-requirements.md §5.5.10).
//
// **One fetcher, three consumers**: the link bubble reads a title out of the page, an external link
// card reads a title and a description out of it (lib/link-title.ts), and the image proxy reads
// bytes (lib/link-image.ts). They differ only in what they do with the response — never in what is
// allowed to be fetched, which is the whole reason this is one function and not three.
//
// The guard is written against resolved addresses rather than against the text of the href, because
// a string test is not protection: `http://evil.example/` whose A record is 127.0.0.1 passes any
// spelling check, and so does a 302 into the same. Every hop is resolved and re-checked.
//
// **Known limit**: `fetchImpl` is handed a hostname, so the name is resolved a second time by the
// runtime and a hostile DNS server can answer differently that time (DNS rebinding). Closing it
// means connecting to the checked address directly and carrying the Host and the TLS SNI by hand.
// Recorded rather than fixed, so the next reader does not have to re-derive that this is open.

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

// Node races the resolved addresses (RFC 8305) and gives each attempt
// `autoSelectFamilyAttemptTimeout` — 250ms by default — before it starts the next one. When there
// is no next one, that budget decides the connection, which makes it a second deadline this file
// never declared: `TIMEOUT_MS` above is the one it means.
//
// **Measured 2026-08-31 against asciinema.org**, the first origin asked for here that is not behind
// a CDN (every provider in lib/embed-provider.ts connects in ~20ms). Its AAAA is unreachable from
// this host — `ENETUNREACH`, returned instantly, so the switch itself costs nothing — and its A
// answers in 249–289ms, straddling the budget. With both families 2 of 3 connects failed
// `ETIMEDOUT` at ~300ms; with the same name resolved to the A record alone 3 of 3 connected, at
// 274–289ms, because a single address is given no budget at all. The card was therefore a coin
// flip, and the `link_previews` row it wrote says `failed`.
//
// Process-global, because this is a `node:net` default and there is no per-request form without a
// custom undici dispatcher (undici is not a dependency here). What it changes is only how long one
// address family is given before the next is tried: a host whose first family hangs *silently* now
// fails over after 1s rather than 250ms, still inside TIMEOUT_MS.
setDefaultAutoSelectFamilyAttemptTimeout(1000);

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

export type Deps = {
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

// The guarded fetch: scheme, address, redirects, timeout. Returns the final 2xx response with its
// body unread, so each caller decides what the body is allowed to be and how much of it to take —
// an HTML page for the extractors above the card, an image for the proxy behind it.
export async function fetchGuarded(
  href: string,
  accept: string,
  deps: Partial<Deps> = {},
): Promise<Response | null> {
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
        headers: { Accept: accept },
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

    // Not 2xx means there is nothing here, whatever the body says. Measured 2026-08-16: a
    // Cloudflare challenge answers 403 *and* carries `<title>Just a moment...</title>`, so a
    // parser that ignores the status would put that on the card in place of the URL. What the
    // content-type has to be is the caller's question, not this one's.
    if (!response.ok) return null;
    return response;
  }
  return null;
}

// Read at most `max` bytes, then stop pulling. An unbounded read is a way for one link to exhaust
// memory, and past the cap there is nothing any caller wants: `<title>` lives near the top of a
// page, and an image over the cap is one this site would refuse from its own author.
export async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
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
  return joined.slice(0, max);
}
