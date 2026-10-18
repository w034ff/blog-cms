// UI labels and messages for /withdrawal (docs/multi-author-requirements.md §12.5).

export const WITHDRAWAL_TITLE = '退会の手続き中';
export const formatWithdrawalPageBody = (date: string, posts: number, scribbles: number) =>
  `退会は${date}まで取り消せます。その後、アカウントと、記事 ${posts} 本・走り書き ${scribbles} 本を消します。`;
export const CANCEL_WITHDRAWAL_LABEL = '退会を取り消す';
export const LOGOUT_LABEL = 'ログアウト';
