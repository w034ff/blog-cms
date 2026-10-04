import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A canary for a dependency that bundles its own prosemirror-state into its dist: a duplicate
// TextSelection class breaks `instanceof` in prosemirror-view, which then eats keystrokes (the dead
// Backspace; docs/editor-pitfalls.md §4). `npm ls` cannot see it, since the copy is inside the
// published dist, so the @tiptap packages are scanned.
//
// @tiptap/extension-blockquote inlined it through 3.27.x; 3.28.0 imports @tiptap/pm/state. If a
// package shows up here, mitigate it (a `.extend` rebuilding selections with @tiptap/pm/state) and
// add it to HANDLED.

const TIPTAP_ROOT = join(process.cwd(), 'node_modules', '@tiptap');

// An inlined copy shows as the un-minified class definition or esbuild's source banner.
const INLINED_STATE =
  /class TextSelection extends Selection|\/prosemirror-state@[\d.]+\/[^\s'"]*index\.js/;

// Packages mitigated in-tree; none since 3.28.0.
const HANDLED: string[] = [];

function distJsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return distJsFiles(full);
    return entry.endsWith('.js') ? [full] : [];
  });
}

function tiptapPackagesInliningState(): string[] {
  if (!existsSync(TIPTAP_ROOT)) return [];
  const hits = new Set<string>();
  for (const pkg of readdirSync(TIPTAP_ROOT)) {
    for (const file of distJsFiles(join(TIPTAP_ROOT, pkg, 'dist'))) {
      if (INLINED_STATE.test(readFileSync(file, 'utf8'))) {
        hits.add(`@tiptap/${pkg}`);
        break;
      }
    }
  }
  return [...hits].sort();
}

describe('bundled prosemirror-state guard (instanceof-breaking duplicate)', () => {
  it('only known/handled @tiptap packages inline prosemirror-state', () => {
    expect(tiptapPackagesInliningState()).toEqual(HANDLED);
  });
});
