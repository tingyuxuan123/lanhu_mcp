import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HtmlRestorationBatchRunner } from '../dist/services/html-restoration-batch-runner.js';

test('HtmlRestorationBatchRunner retries targets, dedupes prefixes, and writes summary', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-batch-runner-'));
  let alphaAttempts = 0;
  const runner = new HtmlRestorationBatchRunner(async options => {
    if (options.outputPrefix === 'alpha') {
      alphaAttempts += 1;
      assert.equal(options.cookie, 'cookie-value');
      assert.equal(options.pageUrl, 'https://lanhuapp.com/web/#/item/project/detailDetach?project_id=project-1&image_id=image-1');
      if (alphaAttempts === 1) {
        throw new Error('temporary network error');
      }

      return {
        source: { referenceImageUrl: 'https://example.com/reference-a.png' },
        htmlPath: path.join(tempDir, 'alpha', 'alpha.html'),
        screenshotPath: path.join(tempDir, 'alpha', 'alpha.png'),
        diffPath: path.join(tempDir, 'alpha', 'alpha-diff.png'),
        compare: {
          visualSimilarityScore: 96.1,
          visualDiffPercent: 3.2,
          pixelMismatchPercent: 4.4,
          weightedDiffPercent: 3.9,
          worstRegions: [
            { row: 0, col: 0, weightedDiffPercent: 8.1 },
          ],
        },
      };
    }

    assert.equal(options.outputPrefix, 'alpha-02');
    return {
      source: { referenceImageUrl: 'https://example.com/reference-b.png' },
      htmlPath: path.join(tempDir, 'alpha-02', 'alpha-02.html'),
      screenshotPath: path.join(tempDir, 'alpha-02', 'alpha-02.png'),
      diffPath: path.join(tempDir, 'alpha-02', 'alpha-02-diff.png'),
      compare: {
        visualSimilarityScore: 91.8,
        visualDiffPercent: 8.2,
        pixelMismatchPercent: 10.3,
        weightedDiffPercent: 7.4,
        worstRegions: [
          { row: 1, col: 1, weightedDiffPercent: 12.5 },
        ],
      },
    };
  });

  const summary = await runner.run({
    targets: [
      {
        pageUrl: 'https://lanhuapp.com/web/#/item/project/detailDetach?project_id=project-1&image_id=image-1',
        prefix: 'alpha',
      },
      {
        jsonUrl: 'https://example.com/restoration.json',
        prefix: 'alpha',
      },
    ],
    outputDir: tempDir,
    minScore: 95,
    maxAttempts: 2,
    cookie: 'cookie-value',
  });

  assert.equal(alphaAttempts, 2);
  assert.equal(summary.total, 2);
  assert.equal(summary.passed, 1);
  assert.equal(summary.belowThreshold, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.items[0].status, 'passed');
  assert.equal(summary.items[0].attempts, 2);
  assert.equal(summary.items[0].weightedDiffPercent, 3.9);
  assert.equal(summary.items[1].prefix, 'alpha-02');
  assert.equal(summary.items[1].status, 'below-threshold');
  assert.equal(summary.items[1].score, 91.8);

  const writtenSummary = JSON.parse(await fs.readFile(summary.summaryPath, 'utf8'));
  assert.equal(writtenSummary.total, 2);
  assert.equal(writtenSummary.items[1].prefix, 'alpha-02');
});
