import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHORTCUT, SHORTCUT_CATALOG } from './shortcut-catalog';

// Data-level guards only (docs/cms-features.md「書き方ヘルプ」§7, 3f). Whether the sheet actually
// *draws* every entry is a browser question and belongs to e2e/editor-writing-help.spec.ts, which
// imports this same module and counts rows against it — vitest here runs on `environment: 'node'`
// and renders nothing.
describe('shortcut catalog', () => {
  it('has no duplicate id', () => {
    const ids = SHORTCUT_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Two entries claiming one key is the mistake this catches: both would render, and only one of
  // them would be telling the truth about what the key does.
  it('has no duplicate token', () => {
    const tokens = SHORTCUT_CATALOG.map((entry) => entry.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('exposes every entry by id', () => {
    expect(Object.keys(SHORTCUT).length).toBe(SHORTCUT_CATALOG.length);
    for (const entry of SHORTCUT_CATALOG) expect(SHORTCUT[entry.id]).toBe(entry);
  });

  // **The toolbar consumes the catalog and owns no key of its own.** Read from the source rather
  // than asserted against props, because what would go wrong is a literal creeping back in beside
  // the lookups — a `shortcut='Mod-x'` that the help sheet then never hears about, which is the
  // exact failure the catalog exists to prevent (its own header comment says why the direction
  // matters). Nothing else can see that; the component renders the same either way.
  it("is the toolbar's only source of keys", () => {
    const source = readFileSync(new URL('./Toolbar.tsx', import.meta.url), 'utf8');
    expect(source.match(/shortcut='[^']*'/g)).toBeNull();
  });
});
