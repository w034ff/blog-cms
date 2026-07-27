// Full-window overlay shown while a file is dragged over the window, so the
// highlighted area matches where a drop is actually accepted (anywhere on the
// page). marginTop:0 cancels the parent form's space-y so the fixed layer covers
// the viewport edge-to-edge.
export function DropOverlay() {
  return (
    <div
      style={{ marginTop: 0 }}
      className='pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-white/80 dark:bg-zinc-900/55'>
      <div className='flex flex-col items-center gap-4 text-zinc-900 dark:text-zinc-50'>
        <svg
          xmlns='http://www.w3.org/2000/svg'
          fill='none'
          viewBox='0 0 24 24'
          strokeWidth={1.5}
          stroke='currentColor'
          aria-hidden='true'
          className='h-20 w-20'>
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z'
          />
        </svg>
        <span className='text-xl font-medium'>ここに画像をドロップして追加</span>
      </div>
    </div>
  );
}
