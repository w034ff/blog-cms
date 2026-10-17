import { describe, expect, it } from 'vitest';
import {
  NO_LINE_BREAKS,
  SHARE_IMAGE_INVALID,
  SITE_DESCRIPTION_MAX_CHARS,
  SITE_NAME_MAX_CHARS,
  SITE_NAME_REQUIRED,
  tooLong,
  validateSiteIdentity,
} from './site-settings-rules';

// docs/site-settings-requirements.md §3 and §6 id=4.
describe('validateSiteIdentity', () => {
  it('trims both fields and accepts an empty description', () => {
    expect(
      validateSiteIdentity({ name: '  Small Diffs ', description: '   ', shareImage: '' }),
    ).toEqual({
      ok: true,
      value: { name: 'Small Diffs', description: '', shareImage: '' },
    });
  });

  it.each([
    ['empty name', { name: '', description: 'x', shareImage: '' }, { name: SITE_NAME_REQUIRED }],
    ['blank name', { name: '   ', description: 'x', shareImage: '' }, { name: SITE_NAME_REQUIRED }],
    [
      'name over the limit',
      { name: 'a'.repeat(SITE_NAME_MAX_CHARS + 1), description: '', shareImage: '' },
      { name: tooLong(SITE_NAME_MAX_CHARS) },
    ],
    [
      'description over the limit',
      { name: 'n', description: 'あ'.repeat(SITE_DESCRIPTION_MAX_CHARS + 1), shareImage: '' },
      { description: tooLong(SITE_DESCRIPTION_MAX_CHARS) },
    ],
    [
      'line break in the name',
      { name: 'a\nb', description: '', shareImage: '' },
      { name: NO_LINE_BREAKS },
    ],
    [
      'CR in the description',
      { name: 'n', description: 'a\rb', shareImage: '' },
      { description: NO_LINE_BREAKS },
    ],
    [
      'both wrong',
      { name: '', description: 'a\nb', shareImage: '' },
      { name: SITE_NAME_REQUIRED, description: NO_LINE_BREAKS },
    ],
  ])('refuses %s', (_label, raw, errors) => {
    expect(validateSiteIdentity(raw)).toEqual({ ok: false, errors });
  });

  it('counts a surrogate pair as one character', () => {
    const name = '𠮷'.repeat(SITE_NAME_MAX_CHARS);
    expect(validateSiteIdentity({ name, description: '', shareImage: '' }).ok).toBe(true);
  });

  // §6 id=8: '' or an upload path, the shape scripts/upload-refs.mts keeps from the sweep.
  it.each(['', '/uploads/abc.png'])('accepts the share image %j', (shareImage) => {
    expect(validateSiteIdentity({ name: 'n', description: '', shareImage })).toEqual({
      ok: true,
      value: { name: 'n', description: '', shareImage },
    });
  });

  it.each(['https://example.com/a.png', '/og.png', '/uploads/../x.png', ' /uploads/a.png'])(
    'refuses the share image %j',
    (shareImage) => {
      expect(validateSiteIdentity({ name: 'n', description: '', shareImage })).toEqual({
        ok: false,
        errors: { shareImage: SHARE_IMAGE_INVALID },
      });
    },
  );
});
