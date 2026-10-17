import { getDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { fetchGuarded, isBlockedAddress } from './guarded-fetch';

// The budget Node gives one address before it tries the next. Left at its 250ms default it decides
// whether a card appears for any dual-stack origin whose reachable family answers slower than that
// — measured against asciinema.org, 2026-08-31. The number is asserted rather than the behaviour
// because the behaviour is a TCP handshake against a third party.
describe('address-attempt budget', () => {
  it('is raised past a real handshake when the module is loaded', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true); // the import is the point; this keeps it honest
    expect(getDefaultAutoSelectFamilyAttemptTimeout()).toBe(1000);
  });
});

// One v6 address has many spellings, and several v6 forms deliver to a v4 address. The guard has to
// answer for the address the packet reaches; the plain v4 and v6 ranges are in lib/link-title.test.ts.
describe('isBlockedAddress over v6 spellings', () => {
  it.each([
    '::ffff:7f00:1', // v4-mapped loopback as `new URL()` writes it
    '::FFFF:127.0.0.1',
    '::ffff:a9fe:a9fe', // v4-mapped cloud metadata
    '::ffff:0a00:0001',
    '0:0:0:0:0:ffff:c0a8:101',
    '::7f00:1', // IPv4-compatible
    '::1.1.1.1',
    '::ffff:0:7f00:1', // IPv4-translated
    '0:0:0:0:0:0:0:1',
    '64:ff9b::7f00:1', // NAT64 to loopback
    '64:ff9b::169.254.169.254',
    '64:ff9b:1::101:101', // local-use NAT64
    '2002:7f00:1::', // 6to4 of 127.0.0.1
    '2002:c0a8:101::1', // 6to4 of 192.168.1.1
    '2001:0:4136:e378::1', // Teredo
    'fe80::1%eth0',
    'febf::1',
    'fec0::1', // site-local
    'fc00::1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    '::ffff:101:101', // v4-mapped 1.1.1.1
    '::ffff:1.1.1.1',
    '64:ff9b::101:101', // NAT64 to 1.1.1.1
    '2002:101:101::1', // 6to4 of 1.1.1.1
    'ff0::1', // group 0x0ff0, not multicast
    'fd::1', // group 0x00fd, not unique-local
    'fe8::1', // group 0x0fe8, not link-local
    '2001:db8::1',
  ])('allows %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe('fetchGuarded', () => {
  it.each([
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]:3001/',
    'http://[64:ff9b::a9fe:a9fe]/',
  ])('never requests the address literal %s', async (href) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('reached'));
    expect(await fetchGuarded(href, '*/*', { fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks a redirect into a v4-mapped literal before following it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://[::ffff:7f00:1]/' } }),
    );
    const resolve = vi.fn(async () => ['93.184.216.34']);
    expect(await fetchGuarded('https://example.com/', '*/*', { fetchImpl, resolve })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
