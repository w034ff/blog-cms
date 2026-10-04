import { describe, expect, it } from 'vitest';
import { CARD_PLACEHOLDER_SRC, externalCardImage, internalCardImage } from './link-card-image';

// docs/link-card-requirements.md §17. The two kinds of card answer "the target has no picture"
// differently on purpose, and the whole of that decision is these two functions — everything else
// (the class, the tint, the box) follows from what they return.
describe('internalCardImage', () => {
  it('falls back to this site’s own mark when the post has no picture', () => {
    expect(internalCardImage(null)).toEqual({ src: CARD_PLACEHOLDER_SRC, placeholder: true });
  });

  it('keeps the post’s own picture and does not mark it', () => {
    // The value `resolveThumbnail` produced, passed through untouched: this function chooses the
    // fallback, it does not re-decide what a post's image is.
    expect(internalCardImage('/uploads/a.png')).toEqual({
      src: '/uploads/a.png',
      placeholder: false,
    });
  });

  it('never answers null', () => {
    // The property the card layer relies on: an internal card always has a picture, which is why
    // §16.2's text-only card is now the external case alone.
    expect(internalCardImage(null)).not.toBeNull();
  });
});

describe('externalCardImage', () => {
  it('has no fallback — the house mark would misname the source', () => {
    // A page this blog did not write, wearing this blog's mark, is the one outcome §17 refuses.
    // The target's own icon is refused separately (§14.4, link-requirements.md §5.5.8).
    expect(externalCardImage(null)).toBeNull();
  });

  it('passes the signed proxy path through', () => {
    // Already same-origin when it arrives: app/(site)/posts/[slug]/page.tsx signs it with `linkImageSrc`
    // before this is called, so nothing here has to know about the third party's URL.
    const signed = '/api/link-image?url=https%3A%2F%2Fcdn.example%2Fa.png&sig=0123456789abcdef0123';
    expect(externalCardImage(signed)).toEqual({ src: signed, placeholder: false });
  });
});
