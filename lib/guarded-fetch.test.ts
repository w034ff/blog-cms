import { getDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from './guarded-fetch';

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
