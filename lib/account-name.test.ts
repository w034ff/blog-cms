import { describe, expect, it } from 'vitest';
import { accountName, NO_DISPLAY_NAME } from './account-name';

describe('accountName (docs/multi-author-requirements.md §9.7, criterion 20)', () => {
  it('prefers the display name', () => {
    expect(accountName({ displayName: '佐藤 花子', username: 'admin' })).toEqual({
      name: '佐藤 花子',
      initial: '佐',
    });
  });

  it('falls back to the username', () => {
    expect(accountName({ displayName: '', username: 'admin' })).toEqual({
      name: 'admin',
      initial: 'A',
    });
  });

  it('names a Google author with no display name as such, with a question mark for a letter', () => {
    expect(accountName({ displayName: '  ', username: null })).toEqual({
      name: NO_DISPLAY_NAME,
      initial: '?',
    });
  });
});
