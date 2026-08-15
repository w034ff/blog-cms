import { describe, expect, it, vi } from 'vitest';
import {
  extractTitle,
  fetchLinkTitle,
  isBlockedAddress,
  normalizeTitle,
  TITLE_MAX_LENGTH,
} from './link-title';

// The guard is the reason this file exists: the route makes the server fetch a URL its caller
// chose (docs/link-requirements.md §5.5.10). Every case below is written against a resolved
// address rather than the spelling of a host, because that is the distinction the guard is for.

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '100.64.0.1', // CGNAT — the range Tailscale itself uses
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1', // link-local
    'fd00::1', // unique-local
    'ff02::1', // multicast
    '::ffff:127.0.0.1', // v4-mapped loopback
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['1.1.1.1', '93.184.216.34', '172.32.0.1', '172.15.0.1', '2606:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('blocks anything that is not an address at all', () => {
    // The caller resolves names first; a name reaching here means something went wrong upstream,
    // and the safe answer to "I do not know what this is" is no.
    expect(isBlockedAddress('example.com')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});

describe('extractTitle', () => {
  it('prefers og:title over <title>', () => {
    const html = `<head><title>tab name</title><meta property="og:title" content="shared name"></head>`;
    expect(extractTitle(html)).toBe('shared name');
  });

  it('reads og:title with the attributes in either order', () => {
    expect(extractTitle(`<meta content="A" property="og:title">`)).toBe('A');
    expect(extractTitle(`<meta property="og:title" content="A">`)).toBe('A');
  });

  it('collapses whitespace and decodes the entities a title actually carries', () => {
    expect(extractTitle('<title>\n  A &amp; B\n  C\n</title>')).toBe('A & B C');
  });

  it('returns null when there is nothing to show', () => {
    expect(extractTitle('<html><body>no head</body></html>')).toBeNull();
    expect(extractTitle('<title>   </title>')).toBeNull();
  });

  it('truncates so one long title cannot reflow the card', () => {
    const long = normalizeTitle('あ'.repeat(400));
    expect(long).toHaveLength(TITLE_MAX_LENGTH);
    expect(long?.endsWith('…')).toBe(true);
  });
});

// A fetch that must never happen is the assertion in most of these, so the stub counts calls.
// Real `Response` objects rather than a shape cast into one: the code under test reads `ok`,
// `headers` and a streamed `body`, and a hand-built stand-in is where those quietly stop matching.
type ResponseSpec = { status?: number; headers?: Record<string, string>; body?: string };

function stub(responses: ResponseSpec[]) {
  const calls: string[] = [];
  let index = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    const spec = responses[index++] ?? {};
    return new Response(spec.body ?? '', {
      status: spec.status ?? 200,
      headers: spec.headers ?? { 'content-type': 'text/html' },
    });
  };
  return { fetchImpl, calls };
}

describe('fetchLinkTitle', () => {
  it('reads the title of an ordinary page', async () => {
    const { fetchImpl } = stub([{ body: '<title>Hello</title>' }]);
    await expect(
      fetchLinkTitle('https://example.com/x', {
        resolve: async () => ['93.184.216.34'],
        fetchImpl,
      }),
    ).resolves.toBe('Hello');
  });

  it('never connects when the name resolves to a private address', async () => {
    const { fetchImpl, calls } = stub([{ body: '<title>internal</title>' }]);
    await expect(
      fetchLinkTitle('https://evil.example/', {
        resolve: async () => ['192.168.1.1'],
        fetchImpl,
      }),
    ).resolves.toBeNull();
    // The point of the guard: not "returns null", but that nothing was requested.
    expect(calls).toEqual([]);
  });

  it('rejects a name that resolves to a public and a private address at once', async () => {
    // The classic way past a check that stops at the first record.
    const { fetchImpl, calls } = stub([{ body: '<title>internal</title>' }]);
    await expect(
      fetchLinkTitle('https://evil.example/', {
        resolve: async () => ['93.184.216.34', '127.0.0.1'],
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('re-checks the address after a redirect', async () => {
    // A public host that 302s to a private one — the hop the initial check cannot see.
    const { fetchImpl, calls } = stub([
      { status: 302, headers: { location: 'http://192.168.0.1/admin' } },
      { body: '<title>router</title>' },
    ]);
    await expect(
      fetchLinkTitle('https://example.com/', {
        resolve: async (host) => (host === 'example.com' ? ['93.184.216.34'] : ['192.168.0.1']),
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual(['https://example.com/']); // the second hop was never requested
  });

  it('gives up rather than following redirects forever', async () => {
    const { fetchImpl, calls } = stub(
      Array.from({ length: 10 }, () => ({
        status: 302,
        headers: { location: 'https://example.com/next' },
      })),
    );
    await expect(
      fetchLinkTitle('https://example.com/', { resolve: async () => ['1.1.1.1'], fetchImpl }),
    ).resolves.toBeNull();
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it('ignores the title on a non-2xx page', async () => {
    // Measured 2026-08-16: a Cloudflare challenge answers 403 and carries
    // `<title>Just a moment...</title>`. Reading it would put that on the card in place of the URL.
    const { fetchImpl } = stub([{ status: 403, body: '<title>Just a moment...</title>' }]);
    await expect(
      fetchLinkTitle('https://example.com/', { resolve: async () => ['1.1.1.1'], fetchImpl }),
    ).resolves.toBeNull();
  });

  it('ignores a body that is not HTML', async () => {
    const { fetchImpl } = stub([
      { headers: { 'content-type': 'application/pdf' }, body: '<title>nope</title>' },
    ]);
    await expect(
      fetchLinkTitle('https://example.com/a.pdf', {
        resolve: async () => ['1.1.1.1'],
        fetchImpl,
      }),
    ).resolves.toBeNull();
  });

  it('refuses a scheme that has no page behind it', async () => {
    const { fetchImpl, calls } = stub([{ body: '<title>x</title>' }]);
    for (const href of ['mailto:a@example.com', 'file:///etc/passwd', 'not a url']) {
      await expect(
        fetchLinkTitle(href, { resolve: async () => ['1.1.1.1'], fetchImpl }),
      ).resolves.toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it('checks an address literal without asking a resolver', async () => {
    const resolve = vi.fn(async () => ['1.1.1.1']);
    const { fetchImpl, calls } = stub([{ body: '<title>x</title>' }]);
    await expect(
      fetchLinkTitle('http://127.0.0.1:3001/admin', { resolve, fetchImpl }),
    ).resolves.toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
