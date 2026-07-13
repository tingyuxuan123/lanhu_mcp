import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Jimp } from 'jimp';
import { runHtmlRestoration } from '../dist/runtime/html-restoration-runtime.mjs';

test('HTML restoration preserves paragraph frames and emits only finite CSS numbers', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-html-runtime-'));
  const fixturePath = path.join(tempDir, 'fixture.json');
  const referencePath = path.join(tempDir, 'reference.png');
  const fixture = {
    board: {
      id: 1,
      type: 'artboardSection',
      name: 'Paragraph frame',
      visible: true,
      clipped: false,
      artboard: {
        artboardRect: { top: 0, left: 0, bottom: 120, right: 240 },
      },
      layers: [
        {
          id: 2,
          type: 'textLayer',
          name: 'Centered paragraph',
          visible: true,
          clipped: false,
          text: true,
          boundsWithFX: { top: 20, left: 30, bottom: 90, right: 210 },
          textInfo: {
            text: 'A paragraph frame that can wrap',
            justification: 'center',
            size: { value: 20, units: 'pointsUnit' },
            leading: { value: 26, units: 'pointsUnit' },
            bounds: {
              top: { value: 0, units: 'pixelsUnit' },
              left: { value: 0, units: 'pixelsUnit' },
              bottom: { value: 70, units: 'pixelsUnit' },
              right: { value: 180, units: 'pixelsUnit' },
            },
            boundingBox: {
              top: { value: 3, units: 'pixelsUnit' },
              left: { value: 10, units: 'pixelsUnit' },
              bottom: { value: 55, units: 'pixelsUnit' },
              right: { value: 170, units: 'pixelsUnit' },
            },
            textShape: [{ char: 'box' }],
          },
        },
      ],
    },
  };

  await fs.writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
  await new Jimp({ width: 240, height: 120, color: 0xffffffff }).write(referencePath);

  try {
    const result = await runHtmlRestoration({
      jsonPath: fixturePath,
      referenceImagePath: referencePath,
      outputDir: tempDir,
      outputPrefix: 'paragraph-frame',
    });
    const html = await fs.readFile(result.htmlPath, 'utf8');

    assert.match(html, /width:180px/);
    assert.match(html, /height:70px/);
    assert.match(html, /white-space:pre-wrap/);
    assert.match(html, /word-break:break-word/);
    assert.doesNotMatch(html, /\[object Object\]|(?:NaN|Infinity|null)(?:px|deg|%)/);
    assert.equal(result.compare.referenceSize.width, 240);
    assert.equal(result.compare.referenceSize.height, 120);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('HTML restoration renders direct JSON URLs without falling back to a sample reference image', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-html-direct-json-'));
  const originalFetch = globalThis.fetch;
  const designJsonUrl = 'https://alipic.lanhuapp.com/direct-design.json';
  const normalizedDesignJsonUrl = 'https://assets.lanhuapp.com/direct-design.json';

  globalThis.fetch = async url => {
    assert.equal(String(url), normalizedDesignJsonUrl);
    return new Response(JSON.stringify({
      board: {
        id: 1,
        type: 'artboardSection',
        name: 'Direct JSON design',
        visible: true,
        clipped: false,
        artboard: {
          artboardRect: { top: 0, left: 0, bottom: 120, right: 240 },
        },
        layers: [
          {
            id: 2,
            type: 'textLayer',
            name: 'Direct JSON text',
            visible: true,
            clipped: false,
            text: true,
            boundsWithFX: { top: 20, left: 30, bottom: 50, right: 210 },
            textInfo: {
              text: 'Direct JSON',
              size: { value: 20, units: 'pointsUnit' },
              leading: { value: 24, units: 'pointsUnit' },
              textShape: [{ char: 'point' }],
            },
          },
        ],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const result = await runHtmlRestoration({
      jsonUrl: designJsonUrl,
      outputDir: tempDir,
      outputPrefix: 'direct-json',
    });
    const html = await fs.readFile(result.htmlPath, 'utf8');

    assert.equal(result.source.mode, 'json_url');
    assert.equal(result.source.jsonUrl, normalizedDesignJsonUrl);
    assert.equal(result.compare, null);
    assert.match(html, /font-size:20px/);
    assert.doesNotMatch(html, /\[object Object\]|(?:NaN|Infinity|null)(?:px|deg|%)/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('HTML restoration downloads page references with Lanhu authentication before comparison', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanhu-html-reference-'));
  const referenceFixturePath = path.join(tempDir, 'reference-fixture.png');
  await new Jimp({ width: 60, height: 30, color: 0xffffffff }).write(referenceFixturePath);
  const referenceBytes = await fs.readFile(referenceFixturePath);
  const originalFetch = globalThis.fetch;
  const designJsonUrl = 'https://cdn.example.com/protected/design.json';
  const latestReferenceUrl = 'https://lanhuapp.com/protected/latest-reference.png';
  let referenceRequestCount = 0;

  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);

    if (requestUrl.startsWith('https://lanhuapp.com/api/project/image?')) {
      assert.equal(init.headers.Cookie, 'session=runtime-test');
      return new Response(JSON.stringify({
        code: '00000',
        result: {
          id: 'image-1',
          name: 'Authenticated reference',
          url: 'https://lanhuapp.com/protected/fallback-reference.png',
          latest_version: 'version-1',
          versions: [
            {
              id: 'version-1',
              type: 'image',
              height: 30,
              width: 60,
              create_time: 'Fri, 10 Jul 2026 00:00:00 UTC',
              version_info: 'Version 1',
              url: latestReferenceUrl,
              json_url: designJsonUrl,
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (requestUrl === designJsonUrl) {
      return new Response(JSON.stringify({
        board: {
          id: 1,
          type: 'artboardSection',
          name: 'Authenticated reference',
          visible: true,
          clipped: false,
          artboard: {
            artboardRect: { top: 0, left: 0, bottom: 30, right: 60 },
          },
          layers: [],
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (requestUrl === latestReferenceUrl) {
      referenceRequestCount += 1;
      assert.equal(init.headers.Cookie, 'session=runtime-test');
      assert.equal(init.headers.Referer, 'https://lanhuapp.com/web/');
      return new Response(referenceBytes, {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }

    throw new Error(`Unexpected fetch URL: ${requestUrl}`);
  };

  try {
    const result = await runHtmlRestoration({
      pageUrl: 'https://lanhuapp.com/web/#/item/project/detailDetach?pid=project-1&image_id=image-1&tid=team-1',
      cookie: 'session=runtime-test',
      outputDir: tempDir,
      outputPrefix: 'authenticated-reference',
    });
    const persistedReference = await fs.readFile(result.source.referenceImagePath);

    assert.equal(referenceRequestCount, 1);
    assert.equal(result.source.referenceImageUrl, latestReferenceUrl);
    assert.equal(result.source.referenceImagePath, path.join(tempDir, 'authenticated-reference-reference.png'));
    assert.deepEqual(persistedReference, referenceBytes);
    assert.equal(result.compare.referenceSize.width, 60);
    assert.equal(result.compare.referenceSize.height, 30);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
