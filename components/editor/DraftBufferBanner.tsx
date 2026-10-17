'use client';

import {
  DRAFT_BUFFER_DISCARD_LABEL,
  DRAFT_BUFFER_NOTICE,
  DRAFT_BUFFER_OVERWRITE_WARNING,
  DRAFT_BUFFER_RESTORE_LABEL,
  formatDraftBufferTime,
} from './draft-buffer';

export function DraftBufferBanner({
  writtenAt,
  hasOverwriteWarning,
  onRestore,
  onDiscard,
}: {
  writtenAt: number;
  hasOverwriteWarning: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const formattedTime = formatDraftBufferTime(writtenAt);

  return (
    <div
      role='alert'
      className='rounded-box flex flex-wrap items-center justify-between gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'>
      <div className='space-y-0.5'>
        <p>
          {DRAFT_BUFFER_NOTICE}（{formattedTime}）。
        </p>
        {hasOverwriteWarning && (
          <p className='text-xs text-amber-700 dark:text-amber-300'>
            {DRAFT_BUFFER_OVERWRITE_WARNING}
          </p>
        )}
      </div>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={onRestore}
          className='button-primary rounded-chip px-3 py-1 text-xs font-medium'>
          {DRAFT_BUFFER_RESTORE_LABEL}
        </button>
        <button
          type='button'
          onClick={onDiscard}
          className='button-secondary rounded-chip px-3 py-1 text-xs font-medium'>
          {DRAFT_BUFFER_DISCARD_LABEL}
        </button>
      </div>
    </div>
  );
}
