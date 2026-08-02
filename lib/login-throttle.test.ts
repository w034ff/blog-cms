import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAttempts } from '@/lib/db/schema';
import { db } from '@/lib/db';
import {
  checkLoginAllowed,
  clearLoginFailures,
  delayForFailures,
  recordLoginFailure,
} from '@/lib/login-throttle';

vi.mock('@/lib/db', async () => {
  const { createTestDb } = await import('@/test/db');
  return { db: createTestDb() };
});

beforeEach(() => {
  db.delete(loginAttempts).run();
});

const T0 = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('delayForFailures', () => {
  it('lets the first two failures through without a wait', () => {
    expect(delayForFailures(0)).toBe(0);
    expect(delayForFailures(1)).toBe(0);
    expect(delayForFailures(2)).toBe(0);
  });

  it('doubles from one second, then holds at thirty', () => {
    expect([3, 4, 5, 6, 7, 8, 9, 20].map(delayForFailures)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('checkLoginAllowed', () => {
  it('allows a username that has never failed', () => {
    expect(checkLoginAllowed('admin', T0)).toEqual({ allowed: true });
  });

  it('still allows the attempt right after an early failure', () => {
    recordLoginFailure('admin', T0);
    expect(checkLoginAllowed('admin', T0 + 1)).toEqual({ allowed: true });
  });

  it('refuses within the wait and reports the seconds left', () => {
    for (let i = 0; i < 3; i++) recordLoginFailure('admin', T0);
    // 3 failures → a 1s wait, so 400ms in there is 600ms left, reported as 1s.
    expect(checkLoginAllowed('admin', T0 + 400)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it('allows again once the wait has passed', () => {
    for (let i = 0; i < 3; i++) recordLoginFailure('admin', T0);
    expect(checkLoginAllowed('admin', T0 + 1_000)).toEqual({ allowed: true });
  });

  // The property that makes this a cooldown and not a lockout: no number of
  // failures can keep the real owner out for longer than the cap.
  it('never asks for more than thirty seconds, however many failures', () => {
    for (let i = 0; i < 50; i++) recordLoginFailure('admin', T0);
    const verdict = checkLoginAllowed('admin', T0 + 1);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  it('is not itself a failure — checking repeatedly does not extend the wait', () => {
    for (let i = 0; i < 4; i++) recordLoginFailure('admin', T0);
    const first = checkLoginAllowed('admin', T0 + 100);
    for (let i = 0; i < 10; i++) checkLoginAllowed('admin', T0 + 100);
    expect(checkLoginAllowed('admin', T0 + 100)).toEqual(first);
  });

  it('throttles each username separately', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('admin', T0);
    expect(checkLoginAllowed('someone-else', T0).allowed).toBe(true);
  });
});

describe('decay and reset', () => {
  it('starts the count over after an hour of quiet', () => {
    for (let i = 0; i < 6; i++) recordLoginFailure('admin', T0);
    expect(checkLoginAllowed('admin', T0 + HOUR)).toEqual({ allowed: true });
    // …and the next failure is a first failure, not a seventh.
    expect(recordLoginFailure('admin', T0 + HOUR)).toBe(1);
  });

  it('accumulates while attempts keep coming', () => {
    expect(recordLoginFailure('admin', T0)).toBe(1);
    expect(recordLoginFailure('admin', T0 + 1_000)).toBe(2);
    expect(recordLoginFailure('admin', T0 + 2_000)).toBe(3);
  });

  it('clears the count on a successful login', () => {
    for (let i = 0; i < 5; i++) recordLoginFailure('admin', T0);
    clearLoginFailures('admin');
    expect(checkLoginAllowed('admin', T0 + 1)).toEqual({ allowed: true });
  });

  // Rows are keyed by whatever was typed, so a run of invented usernames must not
  // leave the table growing forever.
  it('prunes rows that have aged past the decay window', () => {
    recordLoginFailure('stale-one', T0);
    recordLoginFailure('stale-two', T0);
    recordLoginFailure('current', T0 + HOUR + 1);
    expect(
      db
        .select()
        .from(loginAttempts)
        .all()
        .map((row) => row.username),
    ).toEqual(['current']);
  });
});
