import { getOptionalSession } from '@/lib/dal';
import { getPostForEdit } from '@/lib/posts';
import { markdownFilename, postToMarkdown } from '@/lib/post-markdown';

// The 記事一覧 row's Markdown download. The live columns only, never the parked `draftContent`:
// what is downloaded is what readers see (for a draft, its current content — it has no other copy).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  // proxy.ts sends a request without a session to /login first; the handler still checks for
  // itself, as /api/drafts does, rather than trusting that it sits behind it.
  if (!(await getOptionalSession())) return new Response(null, { status: 401 });

  const id = Number((await params).id);
  const post = Number.isSafeInteger(id) ? await getPostForEdit(id) : null;
  if (!post) return new Response(null, { status: 404 });

  // `filename` is the ASCII fallback; `filename*` carries the Japanese title (RFC 6266).
  const disposition = `attachment; filename="post-${post.id}.md"; filename*=UTF-8''${encodeURIComponent(markdownFilename(post))}`;
  return new Response(postToMarkdown(post), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': disposition,
      'Cache-Control': 'private, no-store',
    },
  });
}
