import 'server-only';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, type AppDatabase } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  HANDLE_FIXED,
  HANDLE_TAKEN,
  automaticHandle,
  checkHandle,
  normalizeHandle,
} from '@/lib/handle-rules';

// Reading and choosing an account's ID (docs/multi-author-requirements.md §13).

type Reader = Pick<AppDatabase, 'select'>;

// The ID to show for a row. A row without one reads as the automatic value it would have been
// given (§13.2), so a row written by a path that missed it still has an ID on every screen.
export function handleOf(row: { id: number; handle: string | null }): string {
  return row.handle ?? automaticHandle(row.id);
}

export type HandleChange =
  { kind: 'unchanged' } | { kind: 'change'; value: string } | { kind: 'error'; error: string };

// What saving `raw` as this account's ID would do, without writing. Submitting the current ID is
// no change, so the form can always send the field. Once chosen, any other value is refused.
export function planHandleChange(userId: number, raw: string, reader: Reader = db): HandleChange {
  const row = reader
    .select({ id: users.id, handle: users.handle, chosenAt: users.handleChosenAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return { kind: 'error', error: HANDLE_FIXED };
  if (normalizeHandle(raw) === handleOf(row)) return { kind: 'unchanged' };
  if (row.chosenAt !== null) return { kind: 'error', error: HANDLE_FIXED };
  const check = checkHandle(raw);
  if (!check.ok) return { kind: 'error', error: check.error };
  if (isHandleTaken(check.value, userId, reader)) return { kind: 'error', error: HANDLE_TAKEN };
  return { kind: 'change', value: check.value };
}

function isHandleTaken(value: string, exceptUserId: number, reader: Reader): boolean {
  return (
    reader
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handle, value), ne(users.id, exceptUserId)))
      .get() !== undefined
  );
}

export type ChooseHandleResult = { ok: true } | { ok: false; error: string };

// Fixes the account's ID (§13.4). Checks again inside the transaction: two tabs, or two people
// taking the same ID at once, must not both get through.
export function chooseHandle(
  userId: number,
  raw: string,
  now: Date = new Date(),
): ChooseHandleResult {
  return db.transaction((tx) => {
    const plan = planHandleChange(userId, raw, tx);
    if (plan.kind === 'unchanged') return { ok: true };
    if (plan.kind === 'error') return { ok: false, error: plan.error };
    tx.update(users)
      .set({ handle: plan.value, handleChosenAt: now.toISOString() })
      .where(and(eq(users.id, userId), isNull(users.handleChosenAt)))
      .run();
    return { ok: true };
  });
}
