// UI labels and messages for /admin/users (docs/multi-author-requirements.md §9.5).

export const USERS_TITLE = '利用者';
export const PARTICIPATION_HEADING = '参加';

export const ACCESS_MODE_ALLOWLIST_LABEL = '招待した人だけ';
export const ACCESS_MODE_ALLOWLIST_HELP =
  '招待したメールアドレスの Google アカウントだけが著者になれます。';
export const ACCESS_MODE_OPEN_LABEL = '誰でも';
export const ACCESS_MODE_OPEN_HELP = 'Google アカウントがあれば誰でも著者になれます。';

export const SAVE_LABEL = '保存';
export const SAVING_LABEL = '保存中…';
export const SAVED_MESSAGE = '保存しました';

export const INVITE_LABEL = '招待する';
export const INVITE_PLACEHOLDER = 'name@example.com';
export const INVITE_BUTTON_LABEL = '招待する';
export const INVITING_BUTTON_LABEL = '招待中…';
export const INVITE_HELP = '最初にログインしたとき、招待は利用者に変わります。';

export const BADGE_ADMIN = '管理者';
export const BADGE_SUSPENDED = '停止中';
export const BADGE_INVITED = '招待中';

export const LOGIN_METHOD_GOOGLE = 'Google でログイン';
export const LOGIN_METHOD_PASSWORD = 'パスワードでログイン';
export const NOT_LOGGED_IN_YET = 'まだログインしていません';

export const formatPostCount = (count: number) => `記事 ${count} 本`;
export const formatScribbleCount = (count: number) => `走り書き ${count} 本`;

export const MENU_SUSPEND = '停止する';
export const MENU_UNSUSPEND = '停止を解除';
export const MENU_REMOVE_INVITE = '招待を取り消す';

export const SUSPEND_CONFIRMATION_MESSAGE =
  'このアカウントを停止します。ログインと書き込みができなくなり、公開中の記事と走り書きはサイトから外れます。解除すると元に戻ります。';
export const CANCEL_LABEL = 'やめる';
export const SUSPEND_ACTION_BUTTON = '停止する';
