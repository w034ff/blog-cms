'use client';

import { useRef, useState } from 'react';
import type { MarkResult } from '@/app/actions/library';

// One bookmark or like on one post, as a button shows it (docs/library-requirements.md §5, §6.2).
// The press flips the look at once and does not wait for the Action. Each press sends the value it
// set, and an answer to an older press is dropped, so quick presses land on the last look; a
// refusal, a lapsed session or a failed request puts the look back. `onSessionExpired` is told
// when the session lapsed (true) and when a later press clears that (false).
export function useMark(
  postId: number,
  initial: boolean,
  action: (postId: unknown, on: unknown) => Promise<MarkResult>,
  onSessionExpired?: (expired: boolean) => void,
): [marked: boolean, toggle: () => void] {
  const [marked, setMarked] = useState(initial);
  const targetRef = useRef(initial);
  const seqRef = useRef(0);

  const settle = (seq: number, value: boolean) => {
    if (seq !== seqRef.current) return;
    targetRef.current = value;
    setMarked(value);
  };

  const toggle = () => {
    const next = !targetRef.current;
    targetRef.current = next;
    setMarked(next);
    onSessionExpired?.(false);
    const seq = ++seqRef.current;
    void action(postId, next)
      .then((result) => {
        if ('on' in result) return settle(seq, result.on);
        if ('sessionExpired' in result && seq === seqRef.current) onSessionExpired?.(true);
        settle(seq, !next);
      })
      .catch(() => settle(seq, !next));
  };

  return [marked, toggle];
}
