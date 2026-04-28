import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UniAppRestorationRunner } from '../dist/services/uniapp-restoration-runner.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==',
  'base64',
);

test('UniAppRestorationRunner infers design width from the artboard when omitted', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uniapp-restoration-'));
  const originalFetch = globalThis.fetch;
  const originalSampleJsonPath = process.env.SAMPLE_JSON_PATH;
  const originalReferenceImagePath = process.env.SAMPLE_REFERENCE_PATH;

  process.env.SAMPLE_JSON_PATH = path.resolve('tmp_sample.json');
  process.env.SAMPLE_REFERENCE_PATH = path.resolve('tmp_sample.png');
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => PNG_1X1,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type'
          ? 'image/png'
          : null;
      },
    },
  });

  try {
    const runner = new UniAppRestorationRunner();
    const result = await runner.run({
      outputDir,
      outputPrefix: 'sample-page',
      assetPublicPath: '/static/lanhu-assets',
    });
    const vue = await fs.readFile(path.join(outputDir, 'sample-page.vue'), 'utf8');
    const trackedNodeMatch = vue.match(/class="([^"]+)" data-node-id="30149"/);

    assert.equal(result.designWidth, 750);
    assert.match(vue, /\.page \{[^}]*width: 750rpx;[^}]*min-height: 1547rpx;/);
    assert.ok(trackedNodeMatch, 'expected trace metadata for node 30149');
    assert.match(vue, /data-node-role="group-block"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSampleJsonPath === undefined) {
      delete process.env.SAMPLE_JSON_PATH;
    } else {
      process.env.SAMPLE_JSON_PATH = originalSampleJsonPath;
    }
    if (originalReferenceImagePath === undefined) {
      delete process.env.SAMPLE_REFERENCE_PATH;
    } else {
      process.env.SAMPLE_REFERENCE_PATH = originalReferenceImagePath;
    }
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});
