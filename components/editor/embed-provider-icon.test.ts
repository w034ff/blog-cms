import { describe, expect, it } from 'vitest';
import { EMBED_PROVIDERS } from '@/lib/embed-provider';
import { embedMarkShapes, PLAY_SHAPES } from './svg/icon-shapes';
import { EmbedProviderIcon } from './embed-provider-icon';

// Two surfaces ask "what does this provider look like": LinkBubble's embed button and the block
// drag ghost read `embedMarkShapes(target.provider)` (docs/embed-requirements.md §7.3), while
// EmbedInsertDialog's rows read `EmbedProviderIcon({ name })` (§24.4). Both are keyed off the same
// registry (`EMBED_PROVIDERS`) but by hand, and in different keyspaces — the internal `provider`
// string one way, the display `name` the other — so nothing stops a provider added to one from being
// forgotten in the other. `embedMarkShapes` fails silent (the generic `PLAY_SHAPES` frame comes back
// for any unrecognised key); `EmbedProviderIcon` fails silent too (`null`, an empty row). Neither
// throws, so this is the only thing that would catch it.
//
// `PROVIDER_KEY` is this test's own fixture, not read from the registry — `EmbedTarget.provider` is
// only produced by resolving a real URL (see `lib/embed-provider.test.ts`'s `leads` map), and
// hand-keeping a second small table here is cheaper than a ninth URL fixture. The first assertion
// below is what keeps this table from drifting out of sync with the registry unnoticed.
const PROVIDER_KEY: Record<string, string> = {
  YouTube: 'youtube',
  X: 'x',
  SlideShare: 'slideshare',
  Figma: 'figma',
  'Speaker Deck': 'speakerdeck',
  Docswell: 'docswell',
  'GitHub Gist': 'gist',
  CodeSandbox: 'codesandbox',
  CodePen: 'codepen',
};

// YouTube deliberately has no branch in `embedMarkShapes` (§7.3): the generic play frame *is* its
// mark. Every other provider must draw its own.
const SHARES_THE_DEFAULT_MARK = new Set(['YouTube']);

describe('provider marks — the dialog row and the bubble button stay in sync with the registry', () => {
  it('has a fixture key for every provider the registry names, and no others', () => {
    expect(Object.keys(PROVIDER_KEY).sort()).toEqual(
      EMBED_PROVIDERS.map((provider) => provider.name).sort(),
    );
  });

  it('gives every provider a mark in embedMarkShapes, except YouTube by design', () => {
    for (const provider of EMBED_PROVIDERS) {
      const ownsAMark = embedMarkShapes(PROVIDER_KEY[provider.name]) !== PLAY_SHAPES;
      expect(ownsAMark, provider.name).toBe(!SHARES_THE_DEFAULT_MARK.has(provider.name));
    }
  });

  it('gives every provider a row icon in EmbedProviderIcon', () => {
    for (const provider of EMBED_PROVIDERS) {
      expect(EmbedProviderIcon({ name: provider.name }), provider.name).not.toBeNull();
    }
  });
});
