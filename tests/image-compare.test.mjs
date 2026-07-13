import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Jimp } from 'jimp';
import { ImageCompareService } from '../dist/services/image-compare.js';

test('ImageCompareService normalizes legacy Lanhu image hosts before fetching', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-image-host-'));
  const candidatePath = path.join(tempDir, 'candidate.png');
  const originalFetch = globalThis.fetch;

  try {
    await new Jimp({ width: 40, height: 20, color: 0xffffffff }).write(candidatePath);
    const referenceBytes = await fs.readFile(candidatePath);

    globalThis.fetch = async url => {
      assert.equal(String(url), 'https://assets.lanhuapp.com/reference/image?version=3');
      return new Response(referenceBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    };

    const service = new ImageCompareService();
    const result = await service.compare({
      referenceImageUrl: 'https://alipic.lanhuapp.com/reference/image?version=3',
      candidateImagePath: candidatePath,
    });

    assert.equal(result.visualSimilarityScore, 100);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});