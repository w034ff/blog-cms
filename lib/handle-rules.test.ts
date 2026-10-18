import { describe, expect, it } from 'vitest';
import {
  HANDLE_FORMAT_ERROR,
  HANDLE_MAX_CHARS,
  HANDLE_UNAVAILABLE,
  RESERVED_HANDLES,
  automaticHandle,
  checkHandle,
  normalizeHandle,
} from './handle-rules';

// docs/multi-author-requirements.md §13.3, criterion 50.
describe('ID rules', () => {
  it('folds width and case and drops one leading @', () => {
    expect(normalizeHandle(' ＠Ｙａｍａｄａ_Taro ')).toBe('yamada_taro');
    expect(normalizeHandle('@@a')).toBe('@a');
  });

  it('takes 3 to 15 of a-z, 0-9 and _', () => {
    expect(HANDLE_MAX_CHARS).toBe(15);
    expect(checkHandle('abc')).toEqual({ ok: true, value: 'abc' });
    expect(checkHandle('a'.repeat(15))).toEqual({ ok: true, value: 'a'.repeat(15) });
    for (const bad of ['ab', 'a'.repeat(16), 'yamada-taro', 'yamada.taro', '山田', 'a b', '']) {
      expect(checkHandle(bad)).toEqual({ ok: false, error: HANDLE_FORMAT_ERROR });
    }
  });

  it('refuses the automatic shape and the reserved names, however they are typed', () => {
    expect(automaticHandle(7)).toBe('user7');
    for (const taken of ['user7', 'USER12', '@admin', 'Ｓｅａｒｃｈ', ...RESERVED_HANDLES]) {
      expect(checkHandle(taken)).toEqual({ ok: false, error: HANDLE_UNAVAILABLE });
    }
    // Only user followed by digits alone is the automatic shape.
    expect(checkHandle('user7a')).toEqual({ ok: true, value: 'user7a' });
  });
});
