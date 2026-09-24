import { describe, expect, it } from 'vitest';
import { isAllowedUri } from '@tiptap/extension-link';
import { isPublishableUri } from './link-protocols';

// The subtraction that keeps a link which would die on publish out of the editor
// (docs/link-requirements.md §2.4.2). What the E2E covers is that a `tel:` link is refused and that
// one leading space does not smuggle it past (criteria 3a/3b). What only this file can cover is the
// *shape of the strip itself*: the character class is copied from @tiptap/extension-link rather
// than written as `\s`, and the whole of that choice is the C0 range.
//
// Without the strip, ` tel:+81…` is accepted; with it written as `\s`, U+0001 is.
// **Simplifying `URI_WHITESPACE` to `\s` is the realistic future edit, and the U+0001 case below
// is the only thing in the repo that would notice.**

// The composition extensions.ts installs: the extension's own check runs behind the subtraction.
// The `!!` is not this file's tidying — it is what the extension itself hands over, verbatim:
// `defaultValidate: (url) => !!isAllowedUri(url, this.options.protocols)`. Without it the exported
// helper yields the `String.match` result, and a refusal reads as `null` rather than `false`.
const viaExtension = (url: string): boolean => isPublishableUri(url, (u) => !!isAllowedUri(u));

// The composition PostEditor's handlePaste installs for route (a) (§2.4.2): `linkOnPaste` calls raw
// `setMark` and never consults `isAllowedUri`, so that guard passes `() => true` and the strip is
// the only thing standing there.
const viaPasteGuard = (url: string): boolean => isPublishableUri(url, () => true);

const TEL = 'tel:+81312345678';
const ch = (code: number): string => String.fromCharCode(code);

describe('isPublishableUri refuses the schemes that die on publish', () => {
  it.each(['tel:+81312345678', 'ftp://example.com/x', 'sms:+81312345678', 'cid:a@example.com'])(
    'refuses %s',
    (url) => {
      expect(viaExtension(url)).toBe(false);
      expect(viaPasteGuard(url)).toBe(false);
    },
  );
});

describe('leading whitespace does not smuggle one through', () => {
  // Each of these is stripped by the extension before its own check, so the subtraction has to see
  // the same string or it is looking at a URI the extension is not.
  const cases: [string, string][] = [
    ['SP', ch(0x20)],
    ['TAB', ch(0x09)],
    ['NBSP', ch(0xa0)],
    ['U+2028 LINE SEPARATOR', ch(0x2028)],
    ['U+3000 IDEOGRAPHIC SPACE', ch(0x3000)],
  ];
  it.each(cases)('refuses %s + tel:', (_name, prefix) => {
    expect(viaExtension(prefix + TEL)).toBe(false);
    expect(viaPasteGuard(prefix + TEL)).toBe(false);
  });

  // The case that is not whitespace in the ordinary sense, and the only reason the class is
  // upstream's rather than `\s`. A `\s`-based strip returns true here.
  it('refuses a C0 control + tel:, which is what `\\s` would miss', () => {
    expect(viaExtension(ch(0x01) + TEL)).toBe(false);
    expect(viaPasteGuard(ch(0x01) + TEL)).toBe(false);
    // Stated so the claim above is checked rather than asserted in a comment: this is what the
    // simplification would produce.
    expect(/\s/.test(ch(0x01))).toBe(false);
  });
});

describe('what an author writes for this site is untouched', () => {
  // The subtraction sits in front of `defaultValidate`, which admits everything with no scheme, so
  // relative paths and fragments go on being accepted exactly as before (§2.4.2, §5.5.3).
  it.each(['https://example.com', 'mailto:a@example.com', '/posts/foo', '#見出し'])(
    'accepts %s',
    (url) => {
      expect(viaExtension(url)).toBe(true);
    },
  );

  // `javascript:` is refused by the extension's own check, so the paste guard answers true. Nothing
  // is open by it: linkify does not read `javascript:` as a link at all (§2.4.2).
  it('leaves javascript: to the extension check', () => {
    expect(viaExtension('javascript:alert(1)')).toBe(false);
    expect(viaPasteGuard('javascript:alert(1)')).toBe(true);
  });
});
