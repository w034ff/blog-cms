import { describe, expect, it } from 'vitest';
import { externalCardImage, internalCardImage } from './link-card-image';

// docs/category-mark-requirements.md §3.3, §3.4 and docs/link-card-requirements.md §17. The two
// kinds of card answer "the target has no picture" differently on purpose, and the whole of that
// decision is these two functions — everything else (the markup, the colour, the box) follows from
// what they return.
describe('internalCardImage', () => {
  it('draws the category’s mark when the post has no picture (CM-1)', () => {
    expect(internalCardImage(null, 'tech')).toEqual({ kind: 'mark', category: 'tech' });
    expect(internalCardImage(null, 'blog')).toEqual({ kind: 'mark', category: 'blog' });
  });

  it('keeps the post’s own picture and does not mark it (CM-1)', () => {
    // The value `resolveThumbnail` produced, passed through untouched: this function chooses the
    // fallback, it does not re-decide what a post's image is.
    expect(internalCardImage('/uploads/a.png', 'tech')).toEqual({
      kind: 'photo',
      src: '/uploads/a.png',
    });
  });

  it('never answers null (CM-1)', () => {
    // The property the card layer relies on: an internal card always has a picture, which is why
    // link-card-requirements.md §16.2's text-only card is the external case alone.
    expect(internalCardImage(null, 'tech')).not.toBeNull();
  });

  it('keeps an empty category as an empty category (CM-10)', () => {
    // A draft with no category chosen still gets a mark; the colour is the stylesheet's default.
    // Guessing one here would paint a draft as a category its author never picked.
    expect(internalCardImage(null, '')).toEqual({ kind: 'mark', category: '' });
  });
});

describe('externalCardImage', () => {
  it('has no fallback — the site’s mark would misname the source (CM-2)', () => {
    // A page this blog did not write, wearing this blog's mark, is the one outcome
    // docs/category-mark-requirements.md §2 refuses. The target's own icon is refused separately
    // (link-card-requirements.md §14.4, link-requirements.md §5.5.8).
    expect(externalCardImage(null)).toBeNull();
  });

  it('passes the signed proxy path through as a photo (CM-2)', () => {
    // Already same-origin when it arrives: app/(site)/posts/[slug]/page.tsx signs it with `linkImageSrc`
    // before this is called, so nothing here has to know about the third party's URL.
    const signed = '/api/link-image?url=https%3A%2F%2Fcdn.example%2Fa.png&sig=0123456789abcdef0123';
    expect(externalCardImage(signed)).toEqual({ kind: 'photo', src: signed });
  });
});
