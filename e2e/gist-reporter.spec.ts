import { test, expect } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolveEmbed } from '../lib/embed-provider';

// docs/embed-requirements.md §18.5, criterion G11. **The document the gist is framed in, run for
// real** — the half `e2e/public-embed.spec.ts` cannot reach, because a request from a frame
// sandboxed without `allow-same-origin` does not pass through Playwright's routing (measured
// 2026-08-29) and so GitHub's own script cannot be stubbed in place.
//
// `srcdoc` takes the script URL as an argument, which is what makes this measurable at all: the
// document is built by the shipped code and pointed at a script served from here, so what runs is
// the reporter as published and only the third party is substituted. A data: URL will not do —
// Chrome refuses to load one as a `<script src>`, and the frame then reports zero files, which is
// the failure signal rather than a stand-in for content (measured 2026-08-29).
const GIST = 'https://gist.github.com/qiitan/fa7df2b570a3f16b39e990b2d2c20aae';
const HEIGHT = 612;

type Report = { source: string; id: string; height: number; files: number };

test('the frame announces its height, answers an ask, and reports an empty gist (G11)', async ({
  page,
}) => {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/gist.js')) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(`document.write('<div class="gist-file" style="height:${HEIGHT}px">stub</div>')`);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as AddressInfo).port;

  try {
    const target = resolveEmbed(GIST)!;
    const drawn = target.srcdoc!(`http://127.0.0.1:${port}/gist.js`, 'emb-drawn');
    // A script that is not there is exactly what GitHub serves for an id that no longer resolves:
    // the document parses, and nothing is drawn in it.
    const empty = target.srcdoc!(`http://127.0.0.1:${port}/missing.js`, 'emb-empty');

    // A real origin, not `about:blank`: a frame injected into `about:blank` could not load the
    // script at all (measured 2026-08-29, it reported zero files), and zero files is this
    // provider's failure signal rather than a neutral starting point.
    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { reports: Report[] }).reports = [];
      addEventListener('message', (event) => {
        const data = event.data as Report | null;
        if (data && data.source === 'gist-embed') {
          (window as unknown as { reports: Report[] }).reports.push(data);
        }
      });
    });
    await page.evaluate((docs) => {
      for (const doc of docs) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts allow-popups');
        frame.style.cssText = 'width:600px;height:200px;border:0;display:block';
        frame.srcdoc = doc;
        document.body.appendChild(frame);
      }
    }, [drawn, empty]);

    const reports = async () =>
      page.evaluate(() => (window as unknown as { reports: Report[] }).reports);

    // **The height, unprompted.** This is the whole reason the gist is framed in a document of ours
    // rather than pointed at `.pibb` (§18.3).
    await expect
      .poll(async () => (await reports()).find((r) => r.id === 'emb-drawn')?.height)
      .toBe(HEIGHT);
    expect((await reports()).find((r) => r.id === 'emb-drawn')?.files).toBe(1);
    // Zero files is the signal both surfaces turn into a link or a note (§18.5).
    await expect
      .poll(async () => (await reports()).find((r) => r.id === 'emb-empty')?.files)
      .toBe(0);

    // **The ask.** A parent that attached its listener after the frame had already spoken would
    // otherwise be stuck with the published guess — measured 2026-08-29, that race lost the message
    // outright. This is the reply, counted rather than merely observed.
    const before = (await reports()).filter((r) => r.id === 'emb-drawn').length;
    await page.evaluate(() => {
      document.querySelectorAll('iframe')[0].contentWindow?.postMessage({ ask: 'gist-embed' }, '*');
    });
    await expect
      .poll(async () => (await reports()).filter((r) => r.id === 'emb-drawn').length)
      .toBeGreaterThan(before);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
