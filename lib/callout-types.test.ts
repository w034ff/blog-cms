import { describe, expect, it } from 'vitest';
import { isCalloutType, toCalloutType } from '@/lib/callout-types';

describe('toCalloutType', () => {
  it.each(['note', 'warning', 'caution'] as const)(
    'returns valid callout type %s as-is',
    (type) => {
      expect(isCalloutType(type)).toBe(true);
      expect(toCalloutType(type)).toBe(type);
    },
  );

  it.each([[null], [undefined], [''], ['tip'], ['NOTE']])(
    'falls back to note for invalid value %s',
    (value) => {
      expect(isCalloutType(value)).toBe(false);
      expect(toCalloutType(value)).toBe('note');
    },
  );
});
