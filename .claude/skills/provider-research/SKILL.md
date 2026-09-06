---
name: provider-research
description: Evaluate whether a URL provider should be an embed or a link card
---
For the provider given as $ARGUMENTS:
1. Check how Zenn/Qiita/dev.to handle it.
2. Measure empirically with headed Playwright: does the iframe load off-origin? X-Frame-Options / frame-ancestors? natural height, mobile tap behavior.
3. Report raw measurements before any conclusion. No claims from curl alone.
4. Recommend embed vs. link card with tradeoffs, then STOP and wait for my decision.
