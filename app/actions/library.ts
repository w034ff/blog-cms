'use server';

import { z } from 'zod';
import { getOptionalSession } from '@/lib/dal';
import { recordView, setBookmark, setLike } from '@/lib/library';

// Every argument is checked here: an Action can be POSTed directly with anything in it, so not
// drawing a button is no boundary (docs/library-requirements.md §4).
const postIdSchema = z.number().int().positive();
const onSchema = z.boolean();

export type MarkResult =
  | { on: boolean }
  // The session lapsed; the page offers to sign in again rather than redirecting away.
  | { sessionExpired: true }
  // Not published, the account's own (for a like), or no such post: one answer for all (§4).
  | { notFound: true };

async function mark(
  write: (userId: number, postId: number, on: boolean) => boolean,
  postId: unknown,
  on: unknown,
): Promise<MarkResult> {
  const session = await getOptionalSession();
  if (!session) return { sessionExpired: true };
  const id = postIdSchema.safeParse(postId);
  const value = onSchema.safeParse(on);
  if (!id.success || !value.success) return { notFound: true };
  return write(session.userId, id.data, value.data) ? { on: value.data } : { notFound: true };
}

// Sets rather than toggles, so a double click or a page left open in two tabs lands where the
// button last showed instead of flipping back.
export async function setBookmarkAction(postId: unknown, on: unknown): Promise<MarkResult> {
  return mark(setBookmark, postId, on);
}

export async function setLikeAction(postId: unknown, on: unknown): Promise<MarkResult> {
  return mark(setLike, postId, on);
}

// Sent by the post's page from an effect once it has mounted, never from the render, so a prefetch
// records nothing (§4). Nothing is returned: the page has no use for the answer.
export async function recordViewAction(postId: unknown): Promise<void> {
  const session = await getOptionalSession();
  const id = postIdSchema.safeParse(postId);
  if (!session || !id.success) return;
  recordView(session.userId, id.data);
}
