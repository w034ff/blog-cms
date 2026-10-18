// UI labels and messages for account settings and withdrawal (docs/multi-author-requirements.md §6.1, §12.5).

export const WITHDRAWAL_SECTION_HEADING = '退会';
export const formatWithdrawalBody = (days: number) =>
  `記事と走り書きは公開されなくなり、${days} 日後に消えます。それまではログインすれば取り消せます。`;
export const WITHDRAWAL_BUTTON_LABEL = '退会する';
export const formatWithdrawalConfirmationMessage = (date: string) =>
  `退会は${date}まで取り消せます。`;
export const CANCEL_LABEL = 'やめる';
