import { describe, expect, it } from 'vitest';
import { adminNavGroups } from './AdminSideNav';

const labels = (admin: boolean) =>
  adminNavGroups(admin).map((group) => group.map((item) => item.label));

// docs/multi-author-requirements.md §11
describe('adminNavGroups', () => {
  it('gives an author the own-work group alone', () => {
    expect(labels(false)).toEqual([['記事一覧', '走り書き', 'ライブラリ']]);
  });

  it('gives an admin the same first group, then the management group', () => {
    expect(labels(true)).toEqual([
      ['記事一覧', '走り書き', 'ライブラリ'],
      ['タグの管理', '利用者', 'サイトの設定'],
    ]);
  });
});
