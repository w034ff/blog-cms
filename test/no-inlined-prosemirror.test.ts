import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Build-time canary for the bug class fixed in components/editor/blockquote-extension.ts: a
// dependency that *bundles its own copy of prosemirror-state into its published dist* ships a
// duplicate Selection/TextSelection class. Two copies of that class break `instanceof TextSelection`
// inside prosemirror-view, which then silently eats keystrokes (the "dead Backspace" bug).
//
// This is invisible to `npm ls` — that shows a single deduped prosemirror-state, because the
// duplication happens at the DEPENDENCY's publish-time bundling, not in our tree. So instead we
// scan the @tiptap dependency surface (where our editor extensions come from) for the inlined copy.
//
// @tiptap/extension-blockquote inlined prosemirror-state through 3.27.x; that packaging bug was
// fixed upstream in 3.28.0 (it now imports @tiptap/pm/state), so no @tiptap package should inline it
// anymore and HANDLED is empty. If a dependency bump makes a package show up here again, this test
// fails with its name: mitigate it (a `.extend` that rebuilds selections with @tiptap/pm/state, the
// way blockquote-extension.ts historically did), then add it to HANDLED.

const TIPTAP_ROOT = join(process.cwd(), 'node_modules', '@tiptap');

// A dist that inlines prosemirror-state carries either the un-minified class definition (tsup/esbuild
// don't minify these builds) or an esbuild banner comment naming the bundled prosemirror-state source.
const INLINED_STATE =
  /class TextSelection extends Selection|\/prosemirror-state@[\d.]+\/[^\s'"]*index\.js/;

// Packages already mitigated in-tree. Empty since 3.28.0 fixed the extension-blockquote inlining.
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
