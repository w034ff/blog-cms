import { describe, expect, it } from 'vitest';
import { fetchImage, linkImageSrc, loadImage, probeImage, verifyImageUrl } from './link-image';

// docs/link-card-requirements.md §14.4. This is the one route a reader may call, so it cannot be
// admin-gated — the signature is the gate, and these are the cases that say it holds.
describe('linkImageSrc / verifyImageUrl', () => {
  const URL_A = 'https://cdn.example/a.png';

  it('signs a URL and accepts its own signature', () => {
    const src = linkImageSrc(URL_A);
    const params = new URLSearchParams(src.slice(src.indexOf('?') + 1));
    expect(params.get('url')).toBe(URL_A);
    expect(verifyImageUrl(URL_A, params.get('sig') ?? '')).toBe(true);
  });

  it('refuses a signature made for a different URL', () => {
    // The forgery that matters: keeping a signature this site really issued and swapping the URL
    // beside it would turn the route into an open image proxy.
    const src = linkImageSrc(URL_A);
    const sig = new URLSearchParams(src.slice(src.indexOf('?') + 1)).get('sig') ?? '';
    expect(verifyImageUrl('https://evil.example/a.png', sig)).toBe(false);
  });

  it('refuses a missing, short or over-long signature without throwing', () => {
    // Length is checked first on purpose: `timingSafeEqual` throws on a length mismatch, which
    // would turn a malformed query into a 500 and leak the comparison it exists to hide.
    for (const sig of ['', 'abc', 'f'.repeat(64)]) {
      expect(() => verifyImageUrl(URL_A, sig)).not.toThrow();
      expect(verifyImageUrl(URL_A, sig), sig).toBe(false);
    }
  });
});

describe('fetchImage', () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const deps = (spec: { status?: number; type?: string; body?: BodyInit }) => ({
    resolve: async () => ['93.184.216.34'],
    fetchImpl: (async () =>
      new Response(spec.body ?? png, {
        status: spec.status ?? 200,
        headers: { 'content-type': spec.type ?? 'image/png' },
      })) as unknown as typeof fetch,
  });

  it('returns the bytes and the type for an allowed image', async () => {
    await expect(fetchImage('https://cdn.example/a.png', deps({}))).resolves.toEqual({
      bytes: png,
      contentType: 'image/png',
    });
  });

  it('reads the type without its parameters', async () => {
    await expect(
      fetchImage('https://cdn.example/a.png', deps({ type: 'image/png; charset=binary' })),
    ).resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('refuses a type this site would not accept from its own author', async () => {
    // The allowlist is lib/uploads.ts's, and SVG is not on it: an SVG can carry script, and these
    // bytes are served from this site's own origin.
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream']) {
      await expect(fetchImage('https://cdn.example/a', deps({ type })), type).resolves.toBeNull();
    }
  });

  it('refuses an empty body', async () => {
    await expect(fetchImage('https://cdn.example/a.png', deps({ body: '' }))).resolves.toBeNull();
  });

  it('never connects when the name resolves to a private address', async () => {
    const calls: string[] = [];
    await expect(
      fetchImage('https://intranet.example/a.png', {
        resolve: async () => ['192.168.1.5'],
        fetchImpl: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response(png, { headers: { 'content-type': 'image/png' } });
        }) as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe('probeImage', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const stub = (headers: Record<string, string>) => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(png);
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    return {
      wasCancelled: () => cancelled,
      deps: {
        resolve: async () => ['93.184.216.34'],
        fetchImpl: (async () => new Response(body, { headers })) as unknown as typeof fetch,
      },
    };
  };

  it('answers yes without reading the body', async () => {
    // The point of probing rather than fetching: this runs when a card is written, and the answer
    // is a yes/no. Downloading megabytes to produce a boolean is the cost being avoided.
    const { deps, wasCancelled } = stub({ 'content-type': 'image/png' });
    await expect(probeImage('https://cdn.example/a.png', deps)).resolves.toBe(true);
    expect(wasCancelled()).toBe(true);
  });

  it('answers no for a type the proxy would refuse anyway', async () => {
    const { deps } = stub({ 'content-type': 'image/svg+xml' });
    await expect(probeImage('https://cdn.example/a.svg', deps)).resolves.toBe(false);
  });

  it('answers no when the target declares a length over the cap', async () => {
    const { deps } = stub({
      'content-type': 'image/png',
      'content-length': String(9 * 1024 * 1024),
    });
    await expect(probeImage('https://cdn.example/big.png', deps)).resolves.toBe(false);
  });

  it('accepts a target that declares no length at all', async () => {
    // Streaming CDNs often send none, and the read cap is what actually bounds the download.
    const { deps } = stub({ 'content-type': 'image/png' });
    await expect(probeImage('https://cdn.example/stream.png', deps)).resolves.toBe(true);
  });
});

describe('loadImage', () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const counting = () => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        resolve: async () => ['93.184.216.34'],
        fetchImpl: (async (input: RequestInfo | URL) => {
          calls.push(String(input));
          return new Response(png, { headers: { 'content-type': 'image/png' } });
        }) as unknown as typeof fetch,
      },
    };
  };

  it('fetches once for a burst of simultaneous requests', async () => {
    // The signed URL is printed in the published page, so many readers can ask for the same one at
    // the same moment. Without the in-flight map each of them is its own outbound request.
    const { calls, deps } = counting();
    const url = 'https://cdn.example/burst.png';
    const [a, b, c] = await Promise.all([
      loadImage(url, deps),
      loadImage(url, deps),
      loadImage(url, deps),
    ]);
    expect(calls).toHaveLength(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('serves the next request from memory', async () => {
    // And the request after the burst, which is the part `Cache-Control` cannot be trusted with:
    // the URL is public, so a caller is free to ignore the header entirely.
    const { calls, deps } = counting();
    const url = 'https://cdn.example/again.png';
    await loadImage(url, deps);
    await loadImage(url, deps);
    expect(calls).toHaveLength(1);
  });

  it('remembers a failure too, rather than re-asking a target that has none', async () => {
    const calls: string[] = [];
    const deps = {
      resolve: async () => ['93.184.216.34'],
      fetchImpl: (async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return new Response('', { status: 404 });
      }) as unknown as typeof fetch,
    };
    const url = 'https://cdn.example/gone.png';
    await expect(loadImage(url, deps)).resolves.toBeNull();
    await expect(loadImage(url, deps)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });
});
