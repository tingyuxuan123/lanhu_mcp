import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssetLocalizer } from '../dist/services/asset-localizer.js';
import { StyleExtractor } from '../dist/services/style-extractor.js';

function createLayer(overrides = {}) {
  return {
    id: 1,
    name: 'Hero Banner',
    type: 'image',
    visible: true,
    bounds: {
      x: 0,
      y: 0,
      width: 240,
      height: 120,
    },
    ...overrides,
  };
}

test('AssetLocalizer downloads assets locally, dedupes by content, and rewrites references', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-asset-localizer-'));
  const outputDir = path.join(tempDir, 'assets');
  const imageBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const downloadCalls = [];
  const localizer = new AssetLocalizer(async sourceUrl => {
    downloadCalls.push(sourceUrl);
    return {
      buffer: imageBuffer,
      contentType: 'image/png',
    };
  });

  const layers = [
    createLayer({
      id: 1,
      name: 'Hero Banner',
      assetUrl: 'https://example.com/assets/banner-a',
    }),
    createLayer({
      id: 2,
      name: 'Secondary Banner',
      assetUrl: 'https://example.com/assets/banner-b',
    }),
  ];
  const assets = [
    {
      id: 3,
      name: 'Hero Banner Asset',
      type: 'image',
      bounds: layers[0].bounds,
      assetUrl: 'https://example.com/assets/banner-a',
    },
  ];

  const result = await localizer.localize(layers, assets, {
    outputDir,
    publicPathPrefix: './public-assets',
  });

  assert.equal(downloadCalls.length, 2);
  assert.equal(result.localizedAssetCount, 3);
  assert.equal(result.downloadedFileCount, 1);
  assert.equal(result.files.length, 1);
  assert.match(result.files[0].fileName, /^hero-banner-[a-f0-9]{12}\.png$/);
  assert.equal(layers[0].assetUrl, result.files[0].localPath);
  assert.equal(layers[0].remoteAssetUrl, 'https://example.com/assets/banner-a');
  assert.equal(layers[0].localAssetPath, result.files[0].localPath);
  assert.equal(assets[0].assetUrl, result.files[0].localPath);
  assert.equal(assets[0].localAssetFilePath, result.files[0].filePath);

  const written = await fs.readFile(result.files[0].filePath);
  assert.deepEqual(written, imageBuffer);
});

test('AssetLocalizer records failures and keeps remote asset URL when download fails', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-asset-localizer-fail-'));
  const localizer = new AssetLocalizer(async () => {
    throw new Error('network down');
  });
  const layers = [
    createLayer({
      id: 7,
      name: 'Map Tile',
      assetUrl: 'https://example.com/assets/map-tile',
    }),
    createLayer({
      id: 8,
      name: 'Map Tile Copy',
      assetUrl: 'https://example.com/assets/map-tile',
    }),
  ];

  const result = await localizer.localize(layers, [], {
    outputDir: path.join(tempDir, 'assets'),
  });

  assert.equal(result.localizedAssetCount, 0);
  assert.equal(result.downloadedFileCount, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].layerId, 7);
  assert.equal(layers[0].assetUrl, 'https://example.com/assets/map-tile');
  assert.equal(layers[0].remoteAssetUrl, 'https://example.com/assets/map-tile');
  assert.equal(layers[0].localAssetPath, undefined);
  assert.equal(layers[1].assetUrl, 'https://example.com/assets/map-tile');
  assert.equal(layers[1].localAssetPath, undefined);
});

test('StyleExtractor prefers local asset paths over remote asset URLs', async () => {
  const extractor = new StyleExtractor();
  const css = extractor.extractFromLanhuNode(createLayer({
    assetUrl: 'https://example.com/assets/remote-banner.png',
    localAssetPath: './assets/hero-banner.png',
  }), 'css');

  assert.match(css, /background-image: url\('\.\/assets\/hero-banner\.png'\)/);
  assert.doesNotMatch(css, /remote-banner/);
});
