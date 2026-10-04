import { describe, expect, it } from 'vitest';
import { resolveEmbed } from './embed-provider';
import {
  blobLanguage,
  blobSourceFromFilename,
  isBinaryPath,
  parseGithubBlob,
  sliceBlobLines,
} from './github-blob';

// docs/embed-requirements.md §19. The URL shapes below were taken from GitHub's own address bar and
// its「Copy permalink」item; `refs/heads/…` is the form it writes when a
// branch name is ambiguous with a tag.
//
// **What this file has to hold is the boundary, not the happy path.** The one string that becomes a
// network address is `rawUrl`, and it is built from segments rather than copied from the author's
// URL — so the tests that matter most are the ones that show a URL failing to become one.
const BLOB = 'https://github.com/facebook/react/blob/main/packages/react/index.js';

describe('parseGithubBlob', () => {
  it('reads a blob URL into the four things the import needs (B1)', () => {
    expect(parseGithubBlob(BLOB)).toEqual({
      rawUrl: 'https://raw.githubusercontent.com/facebook/react/main/packages/react/index.js',
      href: BLOB,
      repo: 'facebook/react',
      path: 'packages/react/index.js',
      language: 'js',
      lines: null,
    });
  });

  it('takes a permalink and a branch ref alike (B1)', () => {
    // The 40-hex permalink 「Copy permalink」 produces, and the branch form the address bar shows.
    // Both are copied at insert time, so neither is more faithful than the other *after* the copy —
    // what the permalink buys is that the reader following the attribution link sees what was
    // copied. That is a difference in the link, not in what may be imported (§19.2).
    const sha = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
    const permalink = `https://github.com/facebook/react/blob/${sha}/packages/react/index.js`;
    expect(parseGithubBlob(permalink)?.rawUrl).toBe(
      `https://raw.githubusercontent.com/facebook/react/${sha}/packages/react/index.js`,
    );
    expect(parseGithubBlob(permalink)?.path).toBe('packages/react/index.js');
  });

  it('passes a multi-segment ref through without splitting it (B2)', () => {
    // `refs/heads/main` reaches raw.githubusercontent.com verbatim and resolves (measured
    // 2026-08-29), and it is the one multi-segment ref whose length is knowable from the string.
    const target = parseGithubBlob(
      'https://github.com/facebook/react/blob/refs/heads/main/package.json',
    );
    expect(target?.rawUrl).toBe(
      'https://raw.githubusercontent.com/facebook/react/refs/heads/main/package.json',
    );
    expect(target?.path).toBe('package.json');
  });

  it('leaves a slashed branch name in the displayed path, and fetches the right file anyway (B2)', () => {
    // The ambiguity `refLength` records: `feature/x` cannot be told from a directory called `x`
    // without the repository's ref list. The fetch is unaffected — the whole tail is what raw takes
    // — so the cost is one leading directory in the fence's filename, which the author can edit.
    const target = parseGithubBlob('https://github.com/o/r/blob/feature/x/src/a.ts');
    expect(target?.rawUrl).toBe('https://raw.githubusercontent.com/o/r/feature/x/src/a.ts');
    expect(target?.path).toBe('x/src/a.ts');
  });

  it('reads the line fragment, in every form GitHub writes it (B3)', () => {
    expect(parseGithubBlob(`${BLOB}#L12`)?.lines).toEqual({ from: 12, to: 12 });
    expect(parseGithubBlob(`${BLOB}#L12-L20`)?.lines).toEqual({ from: 12, to: 20 });
    // The column form, written when the selection starts or ends mid-line. A fence holds whole
    // lines, so the columns are read and dropped rather than refusing the URL.
    expect(parseGithubBlob(`${BLOB}#L12C4-L20C9`)?.lines).toEqual({ from: 12, to: 20 });
    // Rebuilt rather than copied, and the single-line form stays single.
    expect(parseGithubBlob(`${BLOB}#L12C4-L20C9`)?.href).toBe(`${BLOB}#L12-L20`);
    expect(parseGithubBlob(`${BLOB}#L12C4`)?.href).toBe(`${BLOB}#L12`);
  });

  it('falls back to the whole file for a fragment naming no lines (B3)', () => {
    for (const hash of ['', '#L0', '#L20-L12', '#readme', '#L', '#Lx'])
      expect(parseGithubBlob(`${BLOB}${hash}`)?.lines, hash).toBeNull();
    // …and the attribution link then carries no fragment either, rather than one that means nothing.
    expect(parseGithubBlob(`${BLOB}#L0`)?.href).toBe(BLOB);
  });

  it('ignores the query GitHub adds to a rendered file (B1)', () => {
    // `?plain=1` is the「source を見る」toggle on a Markdown file; it changes GitHub's page, not
    // the file, and raw has nothing to do with it.
    expect(parseGithubBlob(`${BLOB}?plain=1`)?.rawUrl).toBe(
      'https://raw.githubusercontent.com/facebook/react/main/packages/react/index.js',
    );
  });

  it('refuses every GitHub URL that is not one file (B4)', () => {
    for (const href of [
      'https://github.com/facebook/react/tree/main/packages', // a directory
      'https://github.com/facebook/react/blame/main/package.json',
      'https://github.com/facebook/react/commits/main/package.json',
      'https://github.com/facebook/react/raw/main/package.json', // a redirect into the raw host
      'https://github.com/facebook/react', // the repository
      'https://github.com/facebook', // a user
      'https://github.com/facebook/react/blob/main', // a ref with no path
      'https://github.com/facebook/react/blob/main/', // …and the same with a trailing slash
      'https://gist.github.com/o/fa7df2b570a3f16b39e990b2d2c20aae', // a gist is §18's, not this
      'https://raw.githubusercontent.com/facebook/react/main/package.json',
      'http://github.com/facebook/react/blob/main/package.json', // http
      'https://github.example.com/o/r/blob/main/a.ts', // a host that merely starts the same
      'https://www.github.com/o/r/blob/main/a.ts', // redirects to github.com; not reproduced here
      'not a url',
    ])
      expect(parseGithubBlob(href), href).toBeNull();
  });

  it('refuses an owner, a repo or a segment outside the shape (B4)', () => {
    for (const href of [
      `https://github.com/${'a'.repeat(40)}/r/blob/main/a.ts`, // owner over GitHub's own ceiling
      'https://github.com/o_o/r/blob/main/a.ts', // underscore is not a login character
      `https://github.com/o/${'r'.repeat(101)}/blob/main/a.ts`,
      'https://github.com/o/r r/blob/main/a.ts',
      'https://github.com/o/./blob/main/a.ts',
      'https://github.com/o/r/blob/main/%2f/a.ts', // an escaped separator survives new URL()
      'https://github.com/o/r/blob/main/%zz/a.ts', // a malformed escape names nothing
      'https://github.com/o/r/blob/./a.ts',
      'https://github.com/o/r/blob/main//a.ts', // an empty segment
    ])
      expect(parseGithubBlob(href), href).toBeNull();
  });

  it('is handed a path new URL() has already collapsed (B4)', () => {
    // A dot segment never reaches this file in any spelling — the URL parser resolves `..`,
    // `%2e%2e`, `%2E%2E` and `.%2e` alike. What arrives names a ref called
    // `etc` and a file called `passwd`, which is an ordinary blob URL for a file that will not be
    // there. Recorded rather than guarded again: what is left to refuse is the escaped *separator*
    // above, which that normalisation does not touch.
    for (const dots of ['..', '%2e%2e', '%2E%2E', '.%2e'])
      expect(
        parseGithubBlob(`https://github.com/o/r/blob/main/${dots}/etc/passwd`)?.rawUrl,
        dots,
      ).toBe('https://raw.githubusercontent.com/o/r/etc/passwd');
  });

  it('keeps an escaped path escaped when the fence cannot hold it decoded (B5)', () => {
    // A name with a multibyte character decodes and is shown decoded…
    expect(
      parseGithubBlob('https://github.com/o/r/blob/main/docs/%E8%A6%81%E4%BB%B6.md')?.path,
    ).toBe('docs/要件.md');
    // …but a name with a space keeps its escapes, because ```lang:filename admits no whitespace
    // (`sanitizeFilename`) and repairing it would name a different file.
    expect(parseGithubBlob('https://github.com/o/r/blob/main/my%20file.ts')?.path).toBe(
      'my%20file.ts',
    );
  });

  it('does not claim a file it could never import (B20)', () => {
    // A `.png` was offered the button before this, where pressing it could only ever produce the
    // 「テキストファイルではない」toast. Refused here, the URL falls through to the link card —
    // which is what Qiita and Zenn do for a non-text file, decided after a server fetch they make
    // and this does not.
    for (const name of ['logo.png', 'a/b/diagram.svg', 'doc.pdf', 'dist/app.wasm', 'FONT.WOFF2'])
      expect(parseGithubBlob(`https://github.com/o/r/blob/main/${name}`), name).toBeNull();
  });

  it('is not something resolveEmbed also claims (B6)', () => {
    // The two halves of「GitHub の埋め込み」(§18.9): one URL, one meaning (§3.3). A blob URL must
    // reach this file and no provider, or the bubble would have two buttons for it.
    expect(resolveEmbed(BLOB)).toBeNull();
    expect(resolveEmbed(`${BLOB}#L12-L20`)).toBeNull();
  });
});

describe('blobLanguage', () => {
  it('names only languages the code block itself offers (B7)', () => {
    expect(blobLanguage('a/b/index.tsx')).toBe('tsx');
    expect(blobLanguage('scripts/deploy.sh')).toBe('bash');
    expect(blobLanguage('Dockerfile')).toBe('dockerfile');
    expect(blobLanguage('.bashrc')).toBe('bash');
    expect(blobLanguage('a/b/CHANGELOG.md')).toBe('markdown');
    // Unmapped is the plain fence, not a guess: `language: null` is what「Plain Text」stores.
    expect(blobLanguage('src/App.vue')).toBeNull();
    expect(blobLanguage('LICENSE')).toBeNull();
    expect(blobLanguage('a/b.unknown')).toBeNull();
  });
});

describe('sliceBlobLines', () => {
  const text = 'one\ntwo\nthree\nfour\n';

  it('takes the whole file without its trailing newline (B8)', () => {
    // The fence supplies the final newline; keeping the file's own would add a blank last line to
    // every imported block.
    expect(sliceBlobLines(text, null)).toBe('one\ntwo\nthree\nfour');
  });

  it('takes an inclusive 1-based range, clamped at the end of the file (B8)', () => {
    expect(sliceBlobLines(text, { from: 2, to: 3 })).toBe('two\nthree');
    expect(sliceBlobLines(text, { from: 3, to: 3 })).toBe('three');
    // `#L3-L999` on a four-line file is a range the author can write by hand and GitHub itself
    // shows to the end. Clamped rather than refused.
    expect(sliceBlobLines(text, { from: 3, to: 999 })).toBe('three\nfour\n');
  });

  it('refuses a range that starts past the end of the file (B8)', () => {
    // Distinguishable from an empty file, which is the point: the caller says so out loud.
    expect(sliceBlobLines(text, { from: 99, to: 100 })).toBeNull();
  });

  it('normalises CRLF (B8)', () => {
    expect(sliceBlobLines('a\r\nb\r\n', null)).toBe('a\nb');
    expect(sliceBlobLines('a\r\nb\r\nc\r\n', { from: 2, to: 3 })).toBe('b\nc');
  });
});

describe('blobSourceFromFilename', () => {
  it('reads the header out of a stored fence filename (B9)', () => {
    // What the block stores is the URL; what its header shows is these two halves.
    expect(blobSourceFromFilename(BLOB)).toEqual({
      href: BLOB,
      repo: 'facebook/react',
      path: 'packages/react/index.js',
    });
    expect(blobSourceFromFilename(`${BLOB}#L3-L4`)?.href).toBe(`${BLOB}#L3-L4`);
  });

  it('says nothing about an ordinary filename (B9)', () => {
    // Every code block in every existing post goes through here, so the answer for a plain name
    // has to be "not a source" rather than anything at all.
    for (const name of [
      'index.ts',
      'a/b/c.py',
      '',
      'https://example.com/a.ts',
      'https://github.com/facebook/react',
    ])
      expect(blobSourceFromFilename(name), name).toBeNull();
  });
});

describe('isBinaryPath', () => {
  it('refuses by extension and nothing else (B20)', () => {
    expect(isBinaryPath('a/b/logo.png')).toBe(true);
    // Case is not part of the answer: GitHub serves `LOGO.PNG` as an image just the same.
    expect(isBinaryPath('LOGO.PNG')).toBe(true);
    // **A deny list, so an extension-less name is text.** This is the asymmetry the list exists
    // for: an allow list would refuse these four, which are the files an author most often quotes.
    for (const name of ['LICENSE', 'Dockerfile', 'Makefile', '.gitignore'])
      expect(isBinaryPath(name), name).toBe(false);
    // A leading dot is a name, not an extension.
    expect(isBinaryPath('.bashrc')).toBe(false);
    // And an ordinary source file is untouched.
    for (const name of ['index.ts', 'main.go', 'a/b/style.css', 'notes.md'])
      expect(isBinaryPath(name), name).toBe(false);
  });
});
