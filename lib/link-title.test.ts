import { describe, expect, it, vi } from 'vitest';
import { isBlockedAddress } from './guarded-fetch';
import {
  DESCRIPTION_MAX_LENGTH,
  extractDescription,
  extractImage,
  extractTitle,
  fetchLinkPreview,
  fetchLinkTitle,
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

// docs/link-card-requirements.md §14.9. The card wants one more line than the bubble does, and
// where that line comes from was the measurement that decided it: og:description alone covers 4 of
// the 10 sites measured 2026-08-18, the pair with `<meta name="description">` covers 6.
describe('extractDescription', () => {
  it('prefers og:description over the plain meta description (14h)', () => {
    expect(
      extractDescription(
        '<meta property="og:description" content="OG のほう">' +
          '<meta name="description" content="素のほう">',
      ),
    ).toBe('OG のほう');
  });

  it('falls back to `name="description"` (14h)', () => {
    // Two of the ten sites measured carry only this one (developer.mozilla.org, wikiwiki.jp), so
    // the fallback is what the majority of the coverage rests on rather than a nicety.
    expect(extractDescription('<meta name="description" content="素のほう">')).toBe('素のほう');
  });

  it('reads either attribute order', () => {
    expect(extractDescription('<meta content="逆順" property="og:description">')).toBe('逆順');
    expect(extractDescription('<meta content="逆順" name="description">')).toBe('逆順');
  });

  it('returns null when the page describes itself nowhere (14h)', () => {
    // zenn.dev is this case, measured. The card draws its title alone, which is the shape §12
    // already gives an internal post with an empty description.
    expect(extractDescription('<title>説明の無いページ</title>')).toBeNull();
  });

  it('truncates so one long description cannot become the card', () => {
    const long = 'あ'.repeat(DESCRIPTION_MAX_LENGTH + 40);
    const out = extractDescription(`<meta name="description" content="${long}">`);
    expect(out).toHaveLength(DESCRIPTION_MAX_LENGTH);
    expect(out?.endsWith('…')).toBe(true);
  });
});

describe('fetchLinkPreview', () => {
  const deps = (fetchImpl: typeof fetch) => ({
    resolve: async () => ['93.184.216.34'],
    fetchImpl,
  });

  it('reads the title and the description in one request', async () => {
    // One fetcher, two extractors (§14.5): the preview must not cost a second round trip, and the
    // call count is what says so rather than the returned value.
    const { fetchImpl, calls } = stub([
      { body: '<title>Hello</title><meta name="description" content="説明">' },
    ]);
    await expect(fetchLinkPreview('https://example.com/x', deps(fetchImpl))).resolves.toEqual({
      title: 'Hello',
      description: '説明',
      image: '',
    });
    expect(calls).toHaveLength(1);
  });

  it('returns a preview with an empty description when the page has none', async () => {
    const { fetchImpl } = stub([{ body: '<title>Hello</title>' }]);
    await expect(fetchLinkPreview('https://example.com/x', deps(fetchImpl))).resolves.toEqual({
      title: 'Hello',
      description: '',
      image: '',
    });
  });

  it('returns null when there is no title to build a card on', async () => {
    // The card's first line is the title. With none there is nothing to draw that the stored
    // reference does not already say, so this is a `failed` row and the card shows the URL (§14.7).
    const { fetchImpl } = stub([{ body: '<p>no head at all</p>' }]);
    await expect(fetchLinkPreview('https://example.com/x', deps(fetchImpl))).resolves.toBeNull();
  });

  it('reads nothing off a page that did not answer 2xx (14g)', async () => {
    // The Cloudflare challenge, measured on www.npmjs.com 2026-08-18: status 403 with a real
    // `<title>Just a moment...</title>` in the body. Putting that on a card would be worse than
    // showing the URL, which is what the status check exists for.
    const { fetchImpl } = stub([
      { status: 403, body: '<title>Just a moment...</title><meta name="description" content="x">' },
    ]);
    await expect(fetchLinkPreview('https://example.com/x', deps(fetchImpl))).resolves.toBeNull();
  });

  it('never connects when the name resolves to a private address (14f)', async () => {
    // The whole guard is inherited from fetchLinkTitle — same loop, same resolver — and this is
    // the assertion shape that says so: not "null came back" but "no request went out".
    const { fetchImpl, calls } = stub([{ body: '<title>internal</title>' }]);
    await expect(
      fetchLinkPreview('https://intranet.example/x', {
        resolve: async () => ['10.0.0.5'],
        fetchImpl,
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

// docs/link-card-requirements.md §14.4. The card's picture is the target's og:image, served through
// this site's own proxy — so what is read here is a reference that lib/link-image.ts later signs,
// and every value measured 2026-08-18 was an absolute URL on a third party's CDN.
describe('extractImage', () => {
  const PAGE = 'https://example.com/articles/one';

  it('reads an absolute og:image', () => {
    expect(
      extractImage('<meta property="og:image" content="https://cdn.example/a.png">', PAGE),
    ).toBe('https://cdn.example/a.png');
  });

  it('resolves a relative one against the page it came from', () => {
    // Not seen in the ten sites measured, but permitted — and a half-URL would simply never load,
    // which on the published page is a broken picture nothing can react to.
    expect(extractImage('<meta property="og:image" content="/img/a.png">', PAGE)).toBe(
      'https://example.com/img/a.png',
    );
  });

  it('reads either attribute order', () => {
    expect(
      extractImage('<meta content="https://cdn.example/b.png" property="og:image">', PAGE),
    ).toBe('https://cdn.example/b.png');
  });

  it('returns null when there is no image, or none the proxy could ever fetch', () => {
    expect(extractImage('<title>no picture</title>', PAGE)).toBeNull();
    // The proxy only ever fetches http(s), so anything that cannot become one is stored as nothing
    // rather than as a reference that fails later in another module.
    expect(
      extractImage('<meta property="og:image" content="data:image/png;base64,AA">', PAGE),
    ).toBeNull();
  });

  // §14.5.3. `&amp;` in the attribute is `&` in the URL, and the hosts that sign their query
  // refuse anything else: measured 2026-08-19, the undecoded form reaches `qiita.com` (imgix) and
  // `nextjs.org` as `amp;w`, `amp;s`, … and is refused, which leaves the row `partial` and the
  // card without its picture while the title and the description arrive intact.
  it('decodes entities, so a signed query string survives (14v)', () => {
    expect(
      extractImage(
        '<meta property="og:image" content="https://qiita-user-contents.imgix.net/bg.png?ixlib=rb-4.1.1&amp;w=1200&amp;fm=jpg&amp;s=5119e7fe">',
        PAGE,
      ),
    ).toBe('https://qiita-user-contents.imgix.net/bg.png?ixlib=rb-4.1.1&w=1200&fm=jpg&s=5119e7fe');
  });
});
