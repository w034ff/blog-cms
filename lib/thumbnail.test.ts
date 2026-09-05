import { describe, it, expect } from 'vitest';
import { firstBodyImage, isUploadPath, resolveThumbnail } from './thumbnail';

const UPLOAD = '/uploads/8c3a2ce41540e56801a3.png';
const OTHER = '/uploads/53c15ab9a44112b2377c.webp';

describe('isUploadPath', () => {
  it('accepts the form the uploads route produces', () => {
    expect(isUploadPath(UPLOAD)).toBe(true);
    expect(isUploadPath('/uploads/a-b_c.1.jpg')).toBe(true);
  });

  it('rejects anything that is not a site-relative upload path', () => {
    // Each of these reaches an `<img src>` and `og:image` if it gets through, so
    // the rejection is the point, not the tidiness.
    expect(isUploadPath('')).toBe(false);
    expect(isUploadPath('https://evil.example/x.png')).toBe(false);
    expect(isUploadPath('//evil.example/x.png')).toBe(false);
    expect(isUploadPath('/uploads/../../etc/passwd')).toBe(false);
    expect(isUploadPath('/uploads/nested/x.png')).toBe(false);
    expect(isUploadPath('javascript:alert(1)')).toBe(false);
    expect(isUploadPath(' /uploads/x.png')).toBe(false);
  });
});

describe('firstBodyImage', () => {
  it('finds a markdown image', () => {
    expect(firstBodyImage(`前文\n\n![図](${UPLOAD})\n\n後文\n`)).toBe(UPLOAD);
  });

  it('finds a raw <img>, which a body can legitimately hold', () => {
    expect(firstBodyImage(`<img src="${UPLOAD}" alt="図">`)).toBe(UPLOAD);
    expect(firstBodyImage(`<IMG ALT='図' SRC='${UPLOAD}'>`)).toBe(UPLOAD);
  });

  it('returns the earlier of the two syntaxes, not the earlier pattern', () => {
    // The regexes are tried markdown-first, so an HTML image that appears above
    // a markdown one is the case that catches a naive implementation.
    expect(firstBodyImage(`<img src="${UPLOAD}">\n\n![後](${OTHER})`)).toBe(UPLOAD);
    expect(firstBodyImage(`![先](${UPLOAD})\n\n<img src="${OTHER}">`)).toBe(UPLOAD);
  });

  it('ignores an off-site image and a plain link to an upload', () => {
    expect(firstBodyImage('![外](https://example.com/x.png)')).toBeNull();
    // A link, not an image: it is not what the post is a picture of.
    expect(firstBodyImage(`[配布物](${UPLOAD})`)).toBeNull();
  });

  it('is null for a body with no image', () => {
    expect(firstBodyImage('ただの本文。\n\n## 見出し\n')).toBeNull();
  });

  it('does not carry regex state between calls', () => {
    // The patterns are module-level literals with the /g flag, so a leaked
    // `lastIndex` would make the second call start mid-string and miss.
    const body = `![図](${UPLOAD})`;
    expect(firstBodyImage(body)).toBe(UPLOAD);
    expect(firstBodyImage(body)).toBe(UPLOAD);
  });
});

describe('resolveThumbnail', () => {
  it('prefers what the author chose', () => {
    expect(resolveThumbnail({ thumbnail: UPLOAD, body: `![図](${OTHER})` })).toBe(UPLOAD);
  });

  it('falls back to the body when nothing was chosen', () => {
    expect(resolveThumbnail({ thumbnail: '', body: `![図](${OTHER})` })).toBe(OTHER);
  });

  it('falls back rather than trusting a column that holds a bad value', () => {
    // The column predates any validation, so a stored off-site URL has to
    // degrade to the fallback instead of reaching an `<img src>`.
    expect(
      resolveThumbnail({ thumbnail: 'https://evil.example/x.png', body: `![図](${OTHER})` }),
    ).toBe(OTHER);
  });

  it('is null when there is neither', () => {
    expect(resolveThumbnail({ thumbnail: '', body: '本文だけ' })).toBeNull();
  });
});
