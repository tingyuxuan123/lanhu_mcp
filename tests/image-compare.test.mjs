import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Jimp } from 'jimp';
import {
  ImageAspectRatioMismatchError,
  ImageCompareService,
} from '../dist/services/image-compare.js';

async function writeSolidImage(filePath, width, height, color = 0xffffffff) {
  const image = new Jimp({ width, height, color });
  await image.write(filePath);
}

test('ImageCompareService accepts same-aspect scaled candidates', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-image-compare-'));
  const referencePath = path.join(tempDir, 'reference.png');
  const candidatePath = path.join(tempDir, 'candidate.png');

  try {
    await writeSolidImage(referencePath, 40, 20);
    await writeSolidImage(candidatePath, 20, 10);

    const service = new ImageCompareService();
    const result = await service.compare({
      referenceImagePath: referencePath,
      candidateImagePath: candidatePath,
      resizeCandidate: true,
    });

    assert.equal(result.resizedCandidate, true);
    assert.equal(result.visualSimilarityScore, 100);
    assert.deepEqual(result.referenceSize, { width: 40, height: 20 });
    assert.deepEqual(result.candidateSize, { width: 20, height: 10 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('ImageCompareService rejects incompatible aspect ratios before resizing', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-image-aspect-'));
  const referencePath = path.join(tempDir, 'wide-reference.png');
  const candidatePath = path.join(tempDir, 'tall-candidate.png');

  try {
    await writeSolidImage(referencePath, 80, 40);
    await writeSolidImage(candidatePath, 20, 80);

    const service = new ImageCompareService();
    await assert.rejects(
      service.compare({
        referenceImagePath: referencePath,
        candidateImagePath: candidatePath,
        resizeCandidate: true,
      }),
      error => {
        assert.ok(error instanceof ImageAspectRatioMismatchError);
        assert.equal(error.code, 'IMAGE_ASPECT_RATIO_MISMATCH');
        assert.deepEqual(error.referenceSize, { width: 80, height: 40 });
        assert.deepEqual(error.candidateSize, { width: 20, height: 80 });
        return true;
      },
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
