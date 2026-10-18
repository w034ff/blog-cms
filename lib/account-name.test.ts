import { describe, expect, it } from 'vitest';
import { accountName } from './account-name';

describe('accountName (docs/multi-author-requirements.md §9.7, §13.5, criteria 20 and 54)', () => {
  it('prefers the display name', () => {
    expect(accountName({ displayName: '佐藤 花子', handle: 'hanako' })).toEqual({
      name: '佐藤 花子',
      initial: '佐',
    });
  });

  it('falls back to the ID, with its first letter for the button', () => {
    expect(accountName({ displayName: '  ', handle: 'yamada_taro' })).toEqual({
      name: '@yamada_taro',
      initial: 'Y',
    });
  });
});
