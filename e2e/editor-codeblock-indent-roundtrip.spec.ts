import { test, expect } from '@playwright/test';
import { loadMarkdown } from './editor-authoring';
import { markdown } from './editor-probe';

// A code block nested under a delimiter (list "  ", quote or callout "> ") gained a blank line in the
// fence on every open→save: markdown-it ends fence content with a newline, `text()` made it a final
// empty line, and `write()` prefixed it with the delimiter, which reparsed as content. See
// serializeCodeBlock in code-block-extension.ts. Parse-side only, visible on the public page.
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

    // The serializer's own output must reproduce itself, one extra pass, since the drift grew per pass.
    await loadMarkdown(page, first);
    const second = await markdown(page);
    expect(second, where).toBe(first);

    await loadMarkdown(page, second);
    expect(await markdown(page), where).toBe(first);
  }
});
