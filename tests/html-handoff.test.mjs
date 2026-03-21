import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHtmlBatchHandoff, buildHtmlSingleHandoff } from '../dist/services/html-handoff.js';

test('buildHtmlSingleHandoff keeps only html and asset delivery fields', () => {
  const handoff = buildHtmlSingleHandoff({
    source: {
      pageUrl: 'https://lanhuapp.com/detail?image_id=123',
      designName: 'Profile',
      referenceImageUrl: 'https://example.com/reference.png',
    },
    htmlPath: 'E:/artifacts/profile/profile.html',
    screenshotPath: 'E:/artifacts/profile/profile.png',
    diffPath: 'E:/artifacts/profile/profile-diff.png',
    compare: {
      visualSimilarityScore: 96.4,
    },
    localizedAssets: {
      outputDir: 'E:/artifacts/profile/assets',
      publicPathPrefix: './assets',
      files: [
        {
          fileName: 'icon-user.png',
          localPath: './assets/icon-user.png',
          filePath: 'E:/artifacts/profile/assets/icon-user.png',
          sourceUrl: 'https://example.com/icon-user.png',
        },
      ],
    },
  });

  assert.equal(handoff.mode, 'html-assets-only');
  assert.equal(handoff.htmlPath, 'E:/artifacts/profile/profile.html');
  assert.equal(handoff.assetDirectory, 'E:/artifacts/profile/assets');
  assert.equal(handoff.assetFiles.length, 1);
  assert.equal(handoff.assetFiles[0].fileName, 'icon-user.png');
  assert.equal(handoff.similarityScore, 96.4);
  assert.equal(handoff.handoffNotes.length, 3);
});

test('buildHtmlBatchHandoff reduces batch summary to html delivery items', () => {
  const handoff = buildHtmlBatchHandoff({
    generatedAt: '2026-03-21T00:00:00.000Z',
    minScore: 95,
    targetMaxAttempts: 2,
    outputDir: 'E:/artifacts/batch',
    summaryPath: 'E:/artifacts/batch/restoration-summary.json',
    total: 1,
    passed: 1,
    failed: 0,
    belowThreshold: 0,
    items: [
      {
        prefix: 'abc123',
        status: 'passed',
        attempts: 1,
        pageUrl: 'https://lanhuapp.com/detail?image_id=abc123',
        referenceImageUrl: 'https://example.com/reference.png',
        score: 97.1,
        htmlPath: 'E:/artifacts/batch/abc123/abc123.html',
        screenshotPath: 'E:/artifacts/batch/abc123/abc123.png',
        diffPath: 'E:/artifacts/batch/abc123/abc123-diff.png',
        assetDirectory: 'E:/artifacts/batch/abc123/assets',
        assetPublicPathPrefix: './assets',
        assetFiles: [
          {
            fileName: 'hero.png',
            localPath: './assets/hero.png',
            filePath: 'E:/artifacts/batch/abc123/assets/hero.png',
          },
        ],
      },
    ],
  });

  assert.equal(handoff.mode, 'html-assets-only');
  assert.equal(handoff.total, 1);
  assert.equal(handoff.items[0].htmlPath, 'E:/artifacts/batch/abc123/abc123.html');
  assert.equal(handoff.items[0].assetDirectory, 'E:/artifacts/batch/abc123/assets');
  assert.equal(handoff.items[0].assetFiles.length, 1);
  assert.equal(handoff.items[0].similarityScore, 97.1);
});
