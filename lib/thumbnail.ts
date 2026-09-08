// A post's card image, and the one place that decides what it actually is.
//
// The stored column (`posts.thumbnail`) holds only what the author explicitly
// chose, and is empty on every post written before this feature existed. The
// value a reader sees comes from `resolveThumbnail`, which falls back to the
// first upload the body already references — so the archive gained card images
// without anyone editing it. That fallback is the reason this is a function and
// not a column read at each call site: four surfaces show the image (the post
// list, the admin post list, the public link card, and `og:image`) and they must
// not disagree about which one it is.

// The shape a thumbnail may take: a site-relative path into the uploads
// directory. The character class matches scripts/gc-uploads.mts's `UPLOAD_REF`,
// which is what decides whether the file is still referenced — a thumbnail this
// accepts but the sweep does not recognise would be deleted out from under the
// post.
//
// Deliberately narrower than "any URL". The value reaches an `<img src>` and,
// through `generateMetadata`, `og:image`, and both of those are places where an
// off-site URL means this blog silently republishes — and hotlinks — someone
// else's image. Every route that can set the column (the editor's picker,
// uploads) produces this form, so nothing legitimate is excluded. Anything else
// is treated as unset rather than rejected loudly, because the column predates
// no validation at all and a bad row must degrade to the fallback, not to a
// broken image.
const UPLOAD_PATH = /^\/uploads\/[A-Za-z0-9._-]+$/;

// The two ways an image reaches the stored markdown. `image-extension.ts`
// serializes to `![alt](src)`, which is the common case; raw `<img>` is here
// because a body can hold hand-written HTML (the accordion serializes to it, and
// a paste can carry it), and an author who put an image there would not expect
// it to be invisible to this.
//
// Matched against the body as text rather than by walking a parsed tree: this
// runs for every post in a listing, and the answer only has to be good enough to
// pick a picture.
const MARKDOWN_IMAGE = /!\[[^\]]*\]\((\/uploads\/[A-Za-z0-9._-]+)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc=["'](\/uploads\/[A-Za-z0-9._-]+)["']/gi;

export function isUploadPath(value: string): boolean {
  return UPLOAD_PATH.test(value);
}

// The first upload referenced by the body, in document order. Both forms are
// searched and the earlier match wins — "first" has to mean first as the reader
// meets it, not first of whichever syntax was tried first.
export function firstBodyImage(body: string): string | null {
  let best: { index: number; path: string } | null = null;
  for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
    // `lastIndex` is per-regex state and these are module-level literals, so a
    // stray one would make the second call on the same body start mid-string.
    pattern.lastIndex = 0;
    const match = pattern.exec(body);
    if (match && (!best || match.index < best.index)) {
      best = { index: match.index, path: match[1] };
    }
  }
  return best ? best.path : null;
}

// What the post's image is, for every surface that shows one. Null means the
// post has no image at all, which is a normal state and not an error — a
// text-only post is the majority of this blog.
export function resolveThumbnail(post: { thumbnail: string; body: string }): string | null {
  if (isUploadPath(post.thumbnail)) return post.thumbnail;
  return firstBodyImage(post.body);
}

// Whether the body still references this exact path as an image, in either syntax. The editor
// asks it twice, of the old body and the new one, to drop a choice whose image has just left the
// body (components/PostEditor.tsx) — an image the author marked in place is a body reference, so
// once it goes the choice is stale. A single absence proves nothing: the field's own picker
// uploads a card image the body need never contain.
//
// Every match is checked rather than just the first, unlike firstBodyImage: the question here is
// membership, not order.
export function bodyContainsImage(body: string, path: string): boolean {
  for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      if (match[1] === path) return true;
    }
  }
  return false;
}
