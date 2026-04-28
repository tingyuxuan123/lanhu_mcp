import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUniAppSingleHandoff } from '../dist/services/uniapp-handoff.js';

test('buildUniAppSingleHandoff keeps only uniapp delivery fields', () => {
  const handoff = buildUniAppSingleHandoff({
    source: {
      pageUrl: 'https://lanhuapp.com/detail?image_id=123',
      designName: 'Profile',
      referenceImageUrl: 'https://example.com/reference.png',
    },
    artboard: {
      name: 'Profile',
      width: 375,
      height: 812,
    },
    designWidth: 375,
    vuePath: 'E:/artifacts/profile/profile.vue',
    metaPath: 'E:/artifacts/profile/profile-meta.json',
    bundlePath: 'E:/artifacts/profile/profile-bundle.json',
    localizedAssets: {
      outputDir: 'E:/artifacts/profile/assets',
      publicPathPrefix: '/static/lanhu-assets',
      files: [
        {
          fileName: 'icon-user.png',
          localPath: '/static/lanhu-assets/icon-user.png',
          filePath: 'E:/artifacts/profile/assets/icon-user.png',
          sourceUrl: 'https://example.com/icon-user.png',
        },
      ],
    },
  });

  assert.equal(handoff.mode, 'uniapp-sfc-assets');
  assert.equal(handoff.vuePath, 'E:/artifacts/profile/profile.vue');
  assert.equal(handoff.assetDirectory, 'E:/artifacts/profile/assets');
  assert.equal(handoff.assetFiles.length, 1);
  assert.equal(handoff.assetFiles[0].fileName, 'icon-user.png');
  assert.equal(handoff.designWidth, 375);
  assert.equal(handoff.handoffNotes.length, 3);
});