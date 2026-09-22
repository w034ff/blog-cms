import 'server-only';
import { getPostBySlug } from '@/lib/posts';
import { readLinkPreview } from '@/lib/link-previews';
import { linkImageSrc } from '@/lib/link-image';
import { normalizeCardHref } from '@/lib/link-card-href';
import { externalCardImage, internalCardImage } from '@/lib/link-card-image';
import { siteOrigin } from '@/lib/site';
import type { CardTarget } from '@/lib/render';
import { resolveThumbnail } from '@/lib/thumbnail';
import { excerptFromBody } from '@/lib/excerpt';

// The DB half of a link card, shared by the post page and the revision preview so a card resolves
// the same way in both. It lives here, not in lib/render.ts, so the render pipeline keeps
// no dependency on `posts` (docs/link-card-requirements.md §6) — the stage is handed this closure
// and knows nothing about where a title comes from.
//
// The href has already been validated by the stage before it gets here, so it is one of exactly
// two shapes and `/posts/` tells them apart (§14.2). Which table answers is the only difference:
// this blog's posts are read live, an external page's title is read from what the editor stored.
//
// **Neither branch fetches.** `readLinkPreview` is a SELECT; there is no path from a reader's
// request to another server (§14.1). A URL the editor has never resolved has no row, which is the
// same `null` a draft or an unknown slug produces, and the stage renders a plain link for all of
// them (§6.1).
export async function resolveCard(href: string): Promise<CardTarget | null> {
  // A reference written by hand can be this blog's own published URL, which no entry point would
  // produce (§14.5.1) and which has no `link_previews` row to find — the editor's route refuses to
  // fetch this server. Rewritten to the internal reference here for the same reason it is rewritten
  // there, so the two surfaces resolve a stored card the same way. The `<a href>` is untouched: it
  // is what the author wrote, and it goes where it says.
  const reference = normalizeCardHref(href, siteOrigin.origin) ?? href;
  if (!reference.startsWith('/posts/')) {
    const preview = await readLinkPreview(reference);
    if (!preview) return null;
    // The target's own picture, but served from here: `linkImageSrc` signs a path into
    // /api/link-image, so the reader's browser asks this site for it and the target's CDN never
    // sees the reader (§14.4). Deriving the path here rather than storing it means the signing key
    // can change without rewriting a single row.
    return {
      ...preview,
      image: externalCardImage(preview.image ? linkImageSrc(preview.image) : null),
    };
  }
  const target = await getPostBySlug(reference.slice('/posts/'.length));
  if (!target) return null;
  // resolveThumbnail, not `target.thumbnail`: the card shows the same image the
  // post list does, including the body-derived fallback. It is also the only
  // thing standing between a bad stored value and an `<img src>`, since the
  // rehype stage trusts what this returns.
  //
  // `internalCardImage` is what turns its `null` — a post with no picture at all
  // — into this site's own mark (§17). It is not folded into `resolveThumbnail`
  // because that answer also becomes `og:image` and is checked against the
  // uploads sweep; the fallback belongs to the card, and the editor's card
  // reaches the same function through `/api/posts/search`.
  return {
    title: target.title,
    description: excerptFromBody(target.body),
    image: internalCardImage(resolveThumbnail(target)),
  };
}
