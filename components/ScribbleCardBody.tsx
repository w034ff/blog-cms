'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// Cutoff threshold for long scribble bodies on the list page (docs/scribble-requirements.md §5).
export const SCRIBBLE_CARD_MAX_HEIGHT_PX = 300;

export function ScribbleCardBody({
  html,
  slug,
  targetId,
}: {
  html: string;
  slug: string | null;
  targetId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const measure = () => {
      setIsClamped(content.scrollHeight > container.clientHeight);
    };

    measure();

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className='mt-3'>
      <div
        ref={containerRef}
        id={targetId}
        data-scribble-body-box
        className='relative overflow-hidden'
        style={{ maxHeight: `${SCRIBBLE_CARD_MAX_HEIGHT_PX}px` }}>
        <div
          ref={contentRef}
          className='flow-root prose prose-zinc dark:prose-invert max-w-none'
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {isClamped && (
          <div
            aria-hidden='true'
            className='scribble-fade-bottom pointer-events-none absolute inset-x-0 bottom-0 h-16'
          />
        )}
      </div>
      {isClamped && (
        <div className='mt-3'>
          <Link
            href={`/scribbles/${slug ?? ''}`}
            className='inline-flex items-center text-sm font-medium hover:underline'>
            続きを読む →
          </Link>
        </div>
      )}
    </div>
  );
}
