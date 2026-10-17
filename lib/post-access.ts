import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { posts, users } from '@/lib/db/schema';
import { getOptionalSession } from '@/lib/dal';

export type UserAccess = {
  id: number;
  role: string;
};

// Rejection message returned to the editor when a user attempts to modify another author's post.
export const FORBIDDEN_POST_EDIT = 'この記事を編集する権限がありません。';

// Pure predicate answering whether a signed-in user may edit a post (docs/multi-author-requirements.md §4.1).
// Admins may edit any post. Authors may edit only their own posts (authorId === user.id).
// Posts with no author (authorId === null) may be edited only by admins.
export function canEditPost(user: UserAccess, authorId: number | null): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'author' && authorId !== null) return authorId === user.id;
  return false;
}

// Server helper reading the user's role and the row's authorId from the DB and evaluating `canEditPost`.
// Returns false if there is no session, the user row is missing or suspended, the post row is missing,
// or the user lacks permission to edit the post.
export async function canCurrentUserEdit(postId: number): Promise<boolean> {
  if (!Number.isSafeInteger(postId)) return false;
  const session = await getOptionalSession();
  if (!session) return false;
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, session.userId))
    .get();
  if (!user) return false;
  const post = db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .get();
  if (!post) return false;
  return canEditPost({ id: session.userId, role: user.role }, post.authorId);
}
