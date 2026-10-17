import { describe, expect, it } from 'vitest';
import { DEFAULT_SHARE_IMAGE, sharedOpenGraph } from './shared-metadata';

// docs/site-settings-requirements.md §9.
describe('sharedOpenGraph', () => {
  const site = { name: 'Small Diffs', description: '説明' };

  it('uses the committed image, with its size, while no share image is set', () => {
    expect(sharedOpenGraph({ ...site, shareImage: '' }).images).toEqual([
      { url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: 'Small Diffs — 説明' },
    ]);
  });

  it('uses the uploaded share image without a size it cannot know', () => {
    expect(sharedOpenGraph({ ...site, shareImage: '/uploads/a.png' }).images).toEqual([
      { url: '/uploads/a.png', alt: 'Small Diffs — 説明' },
    ]);
  });
});
