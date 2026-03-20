import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { LanhuParser } from '../dist/services/lanhu-parser.js';

const samplePath = path.resolve('tmp_sample.json');

async function loadSampleLayers() {
  const payload = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  const parser = new LanhuParser();
  const document = parser.parseDocument(payload);
  const layers = parser.buildLayerTree(document, 30, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });

  return {
    layers,
    restoration: parser.buildRestorationPlan(layers),
  };
}

function flatten(nodes, output = []) {
  for (const node of nodes) {
    output.push(node);
    if (node.children?.length) {
      flatten(node.children, output);
    }
  }
  return output;
}

test('parser extracts restoration masks and paint order for sample', async () => {
  const { layers, restoration } = await loadSampleLayers();

  assert.ok(layers.length > 0);
  assert.ok(restoration.paintOrder.length > 0);
  assert.ok(restoration.maskGroups.length > 0);
  assert.ok(restoration.clippedLayerIds.length > 0);
});

test('parser keeps partially outside nodes that still intersect the artboard', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const outside = all.find(node => node.partiallyOutsideArtboard);

  assert.ok(outside, 'expected at least one node to cross the artboard bounds');
  assert.equal(outside.intersectsArtboard, true);
});

test('parser exposes mixed text style ranges for price labels', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const price = all.find(node => node.text === '￥180/吨');

  assert.ok(price, 'expected price text layer');
  assert.ok(price.textStyleRanges && price.textStyleRanges.length >= 2);
  assert.equal(price.textStyleRanges[0].fontWeight, 700);
  assert.equal(price.textStyleRanges[1].fontWeight, 400);
});

test('parser infers flex layouts for repeated UI groups', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const footer = all.find(node => node.name === 'footer');
  const route = all.find(node => node.name === '路线' && node.layoutHint?.mode === 'flex-row');

  assert.ok(footer?.layoutHint, 'expected footer layout hint');
  assert.equal(footer.layoutHint.mode, 'flex-row');
  assert.ok((footer.layoutHint.itemIds || []).length >= 4);
  assert.ok(route?.layoutHint, 'expected route group layout hint');
});

test('parser marks text-only groups as content-sized', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const params = all.find(node => node.name === '参数' && node.isTextOnlyContainer);

  assert.ok(params, 'expected a text-only parameter group');
  assert.equal(params.sizeHint?.width, 'content');
  assert.equal(params.sizeHint?.height, 'content');
});

test('parser exposes box-style background sources for layout restoration', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const searchBox = all.find(node => node.id === 24228);
  const primaryCard = all.find(node => node.id === 30269);
  const recommendationCard = all.find(node => node.id === 30449);

  assert.equal(searchBox?.containerVisualSourceId, 24222);
  assert.equal(primaryCard?.containerVisualSourceId, 30233);
  assert.equal(recommendationCard?.containerVisualSourceId, 30419);
});

test('parser drops abnormal single-line leading values', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const searchPlaceholder = all.find(node => node.id === 24225);
  const menuLabel = all.find(node => node.id === 30081);

  assert.ok(searchPlaceholder?.textStyle, 'expected search placeholder text style');
  assert.equal(searchPlaceholder.textStyle.lineHeight, undefined);
  assert.equal(menuLabel?.textStyle?.lineHeight, undefined);
});

test('parser normalizes sample gradient angles and border radii for restoration', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const quickMenuBackground = all.find(node => node.id === 30067);
  const recommendationHeader = all.find(node => node.id === 30380);
  const primaryCardBackground = all.find(node => node.id === 30225);

  assert.equal(
    quickMenuBackground?.fill,
    'linear-gradient(0deg, #f1f5f8 0%, #ffffff 100%)',
  );
  assert.deepEqual(quickMenuBackground?.borderRadius, [24, 24, 0, 0]);

  assert.equal(
    recommendationHeader?.fill,
    'linear-gradient(-90deg, #dfe7fa 0%, #d5e2f5 100%)',
  );
  assert.deepEqual(recommendationHeader?.borderRadius, [24, 24, 0, 0]);

  assert.deepEqual(primaryCardBackground?.borderRadius, [0, 24, 24, 24]);
});

test('parser infers stacked row layouts for recommendation cards', async () => {
  const { layers, restoration } = await loadSampleLayers();
  const all = flatten(layers);
  const recommendationCard = all.find(node => node.id === 30449);
  const stackedLines = recommendationCard?.layoutHint?.lines || [];

  assert.equal(recommendationCard?.layoutHint?.mode, 'flex-column');
  assert.ok(stackedLines.length >= 5, 'expected recommendation card to be split into stacked rows');
  assert.deepEqual(stackedLines[0]?.itemIds, [30440, 30496]);
  assert.ok(stackedLines[1]?.itemIds.includes(30438));
  assert.ok(stackedLines.at(-1)?.itemIds.includes(30447));
  assert.ok(restoration.flexContainerIds.includes(30449));
});

test('parser does not infer flex layouts inside asset-backed icon groups', async () => {
  const { layers, restoration } = await loadSampleLayers();
  const all = flatten(layers);
  const tabIcon = all.find(node => node.id === 24580);

  assert.ok(tabIcon, 'expected tab icon group');
  assert.equal(tabIcon.renderStrategy, 'asset');
  assert.equal(tabIcon.layoutHint, undefined);
  assert.equal(restoration.flexContainerIds.includes(24580), false);
});
