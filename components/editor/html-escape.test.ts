import { describe, expect, it } from 'vitest';
import { escapeAttribute } from './html-escape';

describe('escapeAttribute', () => {
  it('escapes `&` before the entities it adds', () => {
    expect(escapeAttribute('a&b<c"d')).toBe('a&amp;b&lt;c&quot;d');
    expect(escapeAttribute('&amp;')).toBe('&amp;amp;');
  });
});
