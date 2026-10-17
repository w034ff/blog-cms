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

// The DB half of a link card, shared by the post page and the revision preview, and kept out of
// lib/render.ts so the pipeline has no `posts` dependency (docs/link-card-requirements.md §6). The
// stage has validated the href into one of two shapes (§14.2): posts are read live, an external
// title from what the editor stored. **Neither branch fetches** (§14.1); no row, a draft or an
// unknown slug all render a plain link (§6.1).
export async function resolveCard(href: string): Promise<CardTarget | null> {
  // A hand-written absolute URL to this blog's post has no preview row, so it is rewritten to the
  // internal reference as the entry points do (§14.5.1). The `<a href>` stays as written.
  const reference = normalizeCardHref(href, siteOrigin.origin) ?? href;
  if (!reference.startsWith('/posts/')) {
    const preview = await readLinkPreview(reference);
    if (!preview) return null;
    // Served through the signed /api/link-image path, so the target's CDN never sees the reader
    // (§14.4). Derived, not stored, so the signing key can change freely.
    return {
      ...preview,
      image: externalCardImage(preview.image ? linkImageSrc(preview.image) : null),
    };
  }
  const target = await getPostBySlug(reference.slice('/posts/'.length));
  if (!target) return null;
  // resolveThumbnail, so the card shows what the post list shows; the rehype stage trusts this
  // value. `internalCardImage` turns its `null` into the category's mark (§17), kept out of
  // `resolveThumbnail` because that answer is also `og:image` and the upload sweep's input.
  return {
    title: target.title,
    description: excerptFromBody(target.body),
    image: internalCardImage(resolveThumbnail(target), target.category),
  };
}
