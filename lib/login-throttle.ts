import 'server-only';
import { eq, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { loginAttempts } from '@/lib/db/schema';

// Slows repeated failed logins on a publicly reachable /login.
//
// A cooldown, deliberately NOT a lockout. The username is attacker-supplied and
// there is exactly one admin, so "N failures locks the account" hands anyone a way
// to keep the real admin out for as long as they care to keep failing. Here every
// wait expires on its own: someone who knows the password is never shut out, they
// are at worst delayed by MAX_DELAY_MS.
//
// The wait is enforced by refusing early rather than by sleeping on the request.
// Holding the connection open would tie up server resources on exactly the traffic
// we don't want, and an early refusal also skips the bcrypt comparison — which
// matters more than it looks: that hash costs ~250ms of a single-threaded server,
// so an unthrottled attempt is a small denial of service whether or not the
// password is ever guessed.
const FREE_ATTEMPTS = 2;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
// A wait that has been available this long means the burst is over; the count
// starts again rather than making tomorrow's first attempt pay for today's typos.
const DECAY_MS = 60 * 60 * 1000;

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

// 0, 0, 1s, 2s, 4s, 8s, 16s, 30s, 30s… — doubling is what turns a dictionary run
// into a non-starter, and the cap is what keeps the legitimate user's worst case
// bounded. Exported for the test that pins the shape of the curve.
export function delayForFailures(failures: number): number {
  if (failures <= FREE_ATTEMPTS) return 0;
  const doublings = failures - FREE_ATTEMPTS - 1;
  return Math.min(BASE_DELAY_MS * 2 ** doublings, MAX_DELAY_MS);
}

function currentRow(username: string): { failures: number; lastFailureAt: number } | undefined {
  return db
    .select({ failures: loginAttempts.failures, lastFailureAt: loginAttempts.lastFailureAt })
    .from(loginAttempts)
    .where(eq(loginAttempts.username, username))
    .get();
}

// Whether this username may attempt a login right now, and if not, how long is
// left. Read-only: an attempt refused here is not itself a failure, or a caller
// hammering the endpoint would extend its own wait forever.
export function checkLoginAllowed(username: string, now: number = Date.now()): ThrottleVerdict {
  const row = currentRow(username);
  if (!row) return { allowed: true };
  if (now - row.lastFailureAt >= DECAY_MS) return { allowed: true };

  const readyAt = row.lastFailureAt + delayForFailures(row.failures);
  if (now >= readyAt) return { allowed: true };
  return { allowed: false, retryAfterSeconds: Math.ceil((readyAt - now) / 1000) };
}

// Counts a failed attempt and returns the total. Failures older than the decay
// window restart the count instead of accumulating across unrelated bursts.
export function recordLoginFailure(username: string, now: number = Date.now()): number {
  const row = currentRow(username);
  const failures = row && now - row.lastFailureAt < DECAY_MS ? row.failures + 1 : 1;

  db.insert(loginAttempts)
    .values({ username, failures, lastFailureAt: now })
    .onConflictDoUpdate({
      target: loginAttempts.username,
      set: { failures, lastFailureAt: now },
    })
    .run();

  // Rows are keyed by whatever was typed into the username field, so a long run of
  // invented names would otherwise grow this table without bound. Anything past the
  // decay window no longer affects any verdict, so it can go.
  db.delete(loginAttempts)
    .where(lt(loginAttempts.lastFailureAt, now - DECAY_MS))
    .run();

  return failures;
}

export function clearLoginFailures(username: string): void {
  db.delete(loginAttempts).where(eq(loginAttempts.username, username)).run();
}
