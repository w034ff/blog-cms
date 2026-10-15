import { describe, expect, it } from 'vitest';
import {
  NO_LINE_BREAKS,
  SITE_DESCRIPTION_MAX_CHARS,
  SITE_NAME_MAX_CHARS,
  SITE_NAME_REQUIRED,
  tooLong,
  validateSiteIdentity,
} from './site-settings-rules';

// docs/site-settings-requirements.md §3 and §6 id=4.
describe('validateSiteIdentity', () => {
  it('trims both fields and accepts an empty description', () => {
    expect(validateSiteIdentity({ name: '  Small Diffs ', description: '   ' })).toEqual({
      ok: true,
      value: { name: 'Small Diffs', description: '' },
    });
  });

  it.each([
    ['empty name', { name: '', description: 'x' }, { name: SITE_NAME_REQUIRED }],
    ['blank name', { name: '   ', description: 'x' }, { name: SITE_NAME_REQUIRED }],
    [
      'name over the limit',
      { name: 'a'.repeat(SITE_NAME_MAX_CHARS + 1), description: '' },
      { name: tooLong(SITE_NAME_MAX_CHARS) },
    ],
    [
      'description over the limit',
      { name: 'n', description: 'あ'.repeat(SITE_DESCRIPTION_MAX_CHARS + 1) },
      { description: tooLong(SITE_DESCRIPTION_MAX_CHARS) },
    ],
    ['line break in the name', { name: 'a\nb', description: '' }, { name: NO_LINE_BREAKS }],
    ['CR in the description', { name: 'n', description: 'a\rb' }, { description: NO_LINE_BREAKS }],
    [
      'both wrong',
      { name: '', description: 'a\nb' },
      { name: SITE_NAME_REQUIRED, description: NO_LINE_BREAKS },
    ],
  ])('refuses %s', (_label, raw, errors) => {
    expect(validateSiteIdentity(raw)).toEqual({ ok: false, errors });
  });

  it('counts a surrogate pair as one character', () => {
    const name = '𠮷'.repeat(SITE_NAME_MAX_CHARS);
    expect(validateSiteIdentity({ name, description: '' }).ok).toBe(true);
  });
});
