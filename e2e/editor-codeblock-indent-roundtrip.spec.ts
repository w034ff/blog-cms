import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown } from './editor-probe';

// Regression (measured 2026-08-03, fixed the same day): a code block nested anywhere that
// serializes with a delimiter — a list item ("  "), a quote or a callout ("> ") — grew one blank
// line inside the fence on every open→save cycle, forever. The content of a block loaded from
// markdown ends with a newline (markdown-it terminates fence content with one), prosemirror-
// markdown's `text()` turned that into a final empty line, and `write()` prefixed it with the
// delimiter; re-parsing read the delimiter-only line back as a blank line of content. Only the
// top level was unaffected, its delimiter being "". See serializeCodeBlock in
// components/editor/code-block-extension.ts.
//
// Parse-side only — no typing needed to trigger it, and the drift is visible on the public page
// as blank lines accumulating in the code.
const CASES: Record<string, string> = {
  'top level': '```ts\nconst a = 1\n```\n',
  'list item': '- 項目\n\n  ```ts\n  const a = 1\n  ```\n',
  quote: '> ```ts\n> const a = 1\n> ```\n',
  callout: '> [!NOTE]\n>\n> ```ts\n> const a = 1\n> ```\n',
  'nested list item': '- 項目\n\n  - 入れ子\n\n    ```ts\n    const a = 1\n    ```\n',
};

test('a nested code block round-trips to a fixed point', async ({ page }) => {
  await page.goto('/admin/posts/new');
  await expect(page.locator('.ProseMirror')).toBeVisible();

  for (const [where, source] of Object.entries(CASES)) {
    await loadMarkdown(page, source);
    const first = await markdown(page);

    // The code survives with its language, wherever it sits.
    expect(first, where).toContain('const a = 1');
    expect(first, where).toContain('```ts');

    // Re-loading the serializer's own output must produce it again. One extra pass, so a drift
    // that needs a cycle to appear can't hide: the growth added a line at *every* pass.
    await loadMarkdown(page, first);
    const second = await markdown(page);
    expect(second, where).toBe(first);

    await loadMarkdown(page, second);
    expect(await markdown(page), where).toBe(first);
  }
});
