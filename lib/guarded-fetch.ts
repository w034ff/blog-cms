import { lookup } from 'node:dns/promises';
import { isIP, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

// The one place in this codebase that requests a URL chosen by its caller, and the guard that makes
// that safe (docs/link-card-requirements.md §14.5, docs/link-requirements.md §5.5.10).
//
// **One fetcher, three consumers** (the bubble's title, the card's title and description in
// lib/link-title.ts, and the image proxy in lib/link-image.ts), so what may be fetched is decided once.
//
// Checked against resolved addresses, not the href's text: a name resolving to 127.0.0.1, or a 302
// into one, passes any spelling test. Every hop is resolved and re-checked.
//
// **Known limit**: `fetchImpl` is handed a hostname, so the name is resolved a second time by the
// runtime and a hostile DNS server can answer differently that time (DNS rebinding). Closing it
// means connecting to the checked address directly and carrying the Host and the TLS SNI by hand.
// Recorded rather than fixed, so the next reader does not have to re-derive that this is open.

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

// Node races resolved addresses (RFC 8305), giving each attempt `autoSelectFamilyAttemptTimeout`
// (250ms by default); with no next address that budget decides the connection, a second deadline
// never meant here. A host with an unreachable AAAA and a ~270ms A record connected at random. Raised
// process-wide (no per-request form without undici); a silently hanging family now fails over after
// 1s, still inside TIMEOUT_MS.
setDefaultAutoSelectFamilyAttemptTimeout(1000);

// Addresses the server must not be talked into fetching: loopback, link-local (including the cloud
// metadata range), the RFC 1918 blocks, carrier-grade NAT, their v6 equivalents, and any of them
// carried inside a v6 address (v4-mapped, NAT64, 6to4). Written over
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
    // Judged over the eight groups, never the text: one address has many spellings. `new URL()`
    // rewrites `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`, and `ff0::` (group 0x0ff0) is not multicast.
    const [g0, g1, g2, g3, g4, g5, g6, g7] = ipv6Groups(address);
    const zeroTo = (end: number) => [g0, g1, g2, g3, g4, g5].slice(0, end).every((g) => g === 0);
    // IPv4-compatible (::a.b.c.d, which holds `::` and `::1`) and IPv4-translated (::ffff:0:a.b.c.d):
    // deprecated, so no public host lives there.
    if (zeroTo(6)) return true;
    if (zeroTo(4) && g4 === 0xffff && g5 === 0) return true;
    // Forms that carry an IPv4 address the packet ends up at — the same address wearing a hat, so it
    // gets the IPv4 answer: v4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96), 6to4 (2002::/16).
    if (zeroTo(5) && g5 === 0xffff) return isBlockedAddress(ipv4FromGroups(g6, g7));
    if (g0 === 0x64 && g1 === 0xff9b) {
      // The rest of 64:ff9b::/32 is local-use NAT64 (64:ff9b:1::/48, RFC 8215) or unassigned.
      return [g2, g3, g4, g5].some((g) => g !== 0) || isBlockedAddress(ipv4FromGroups(g6, g7));
    }
    if (g0 === 0x2002) return isBlockedAddress(ipv4FromGroups(g1, g2));
    // Teredo (2001::/32) tunnels to an IPv4 address stored inverted; no reason to reach one.
    if (g0 === 0x2001 && g1 === 0) return true;
    if ((g0 & 0xffc0) === 0xfe80) return true; // link-local
    if ((g0 & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
    if ((g0 & 0xfe00) === 0xfc00) return true; // unique-local
    if ((g0 & 0xff00) === 0xff00) return true; // multicast
    return false;
  }
  // Not an address at all — the caller resolves names before asking.
  return true;
}

// The eight 16-bit groups of an address `isIP` has already accepted as v6: a zone (`%eth0`) dropped,
// `::` expanded, a trailing dotted quad folded into the last two groups.
function ipv6Groups(address: string): number[] {
  let text = address.split('%')[0];
  const quad = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    text = `${text.slice(0, quad.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const fill = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array.from({ length: fill }, () => '0'), ...tailGroups].map((group) =>
    parseInt(group, 16),
  );
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
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

    // Not 2xx is nothing, whatever the body says: a Cloudflare challenge is a 403 with a <title>.
    // The content type is the caller's question.
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
