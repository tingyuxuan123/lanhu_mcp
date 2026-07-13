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

async function loadSamplePayload() {
  return JSON.parse(await fs.readFile(samplePath, 'utf8'));
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

function findRawLayer(layers, predicate) {
  for (const layer of layers) {
    if (predicate(layer)) {
      return layer;
    }

    if (layer.layers?.length) {
      const match = findRawLayer(layer.layers, predicate);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

test('parser extracts restoration masks and paint order for sample', async () => {
  const { layers, restoration } = await loadSampleLayers();

  assert.ok(layers.length > 0);
  assert.ok(restoration.paintOrder.length > 0);
  assert.ok(restoration.maskGroups.length > 0);
  assert.ok(restoration.clippedLayerIds.length > 0);
});

test('parser normalizes image source dictionaries to the canonical asset CDN', () => {
  const parser = new LanhuParser();
  const document = parser.parseDocument({
    board: {
      id: 1,
      type: 'artboardSection',
      name: 'Asset URL normalization',
      visible: true,
      clipped: false,
      artboard: {
        artboardRect: { top: 0, left: 0, bottom: 100, right: 100 },
      },
      layers: [
        {
          id: 2,
          type: 'smartObjectLayer',
          name: 'Remote image',
          visible: true,
          clipped: false,
          pixels: true,
          boundsWithFX: { top: 0, left: 0, bottom: 20, right: 20 },
          images: {
            png_xxxhd: 'https://lanhu-oss-proxy.lanhuapp.com/max_abc123',
          },
        },
      ],
    },
  });

  const [node] = parser.buildLayerTree(document, 30);
  const [asset] = parser.extractAssets(document);

  assert.equal(node.assetUrls?.png_xxxhd, 'https://assets.lanhuapp.com/max_abc123');
  assert.equal(node.assetUrl, 'https://assets.lanhuapp.com/max_abc123');
  assert.equal(asset.assetUrls?.png_xxxhd, 'https://assets.lanhuapp.com/max_abc123');
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

test('parser keeps invalid repeated UI geometry absolute while preserving valid route flow', async () => {
  const { layers } = await loadSampleLayers();
  const all = flatten(layers);
  const footer = all.find(node => node.name === 'footer');
  const route = all.find(node => node.name === '路线' && node.layoutHint?.mode === 'flex-row');

  assert.equal(footer?.layoutHint, undefined, 'active footer item cannot retain its source y-coordinate in one flex row');
  assert.ok(route?.layoutHint, 'expected route group layout hint');
  assert.equal(route.layoutHint.justifyContent, 'start');
  assert.ok((route.layoutHint.gap || 0) > 0);
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

test('parser converts Lanhu tracking units into CSS letter spacing', async () => {
  const payload = await loadSamplePayload();
  const rawLayer = findRawLayer(payload.board.layers, layer => layer.id === 24225);

  assert.ok(rawLayer?.textInfo, 'expected a text layer with textInfo');
  rawLayer.textInfo.tracking = 20;

  const parser = new LanhuParser();
  const document = parser.parseDocument(payload);
  const layers = parser.buildLayerTree(document, 30, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });
  const all = flatten(layers);
  const searchPlaceholder = all.find(node => node.id === 24225);

  assert.equal(searchPlaceholder?.textStyle?.letterSpacing, 0.56);
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

test('parser normalizes unit-object text metrics without leaking invalid numeric output', () => {
  const parser = new LanhuParser();
  const document = parser.parseDocument({
    board: {
      id: 1,
      type: 'artboardSection',
      name: 'Text metrics',
      visible: true,
      clipped: false,
      artboard: {
        artboardRect: { top: 0, left: 0, bottom: 200, right: 400 },
      },
      layers: [
        {
          id: 2,
          type: 'textLayer',
          name: 'Framed paragraph',
          visible: true,
          clipped: false,
          text: true,
          boundsWithFX: { top: 20, left: 30, bottom: 100, right: 330 },
          textInfo: {
            text: 'Framed paragraph text',
            justification: 'center',
            size: { value: 24, units: 'pointsUnit' },
            leading: { value: 30, units: 'pointsUnit' },
            tracking: { value: 20, units: 'pointsUnit' },
            baselineShift: { value: 2, units: 'pointsUnit' },
            horizontalScale: { value: 100, units: 'percentUnit' },
            verticalScale: { value: 98, units: 'percentUnit' },
            _orgTransform: {
              xx: { value: 1, units: 'unitless' },
              xy: 0,
              yx: 0,
              yy: { value: 0.98, units: 'unitless' },
              tx: 0,
              ty: 0,
            },
            bounds: {
              top: { value: 0, units: 'pixelsUnit' },
              left: { value: 0, units: 'pixelsUnit' },
              bottom: { value: 80, units: 'pixelsUnit' },
              right: { value: 300, units: 'pixelsUnit' },
            },
            boundingBox: {
              top: { value: 4, units: 'pixelsUnit' },
              left: { value: 12, units: 'pixelsUnit' },
              bottom: { value: 64, units: 'pixelsUnit' },
              right: { value: 288, units: 'pixelsUnit' },
            },
            textShape: [{ char: 'box', frameBaselineAlignment: 'alignByAscent' }],
            textStyleRange: [
              {
                from: { value: 0, units: 'characters' },
                to: { value: 6, units: 'characters' },
                textStyle: {
                  size: { value: 24, units: 'pointsUnit' },
                  fontName: 'Example Sans',
                },
              },
              {
                from: { value: Number.NaN, units: 'characters' },
                to: { value: 10, units: 'characters' },
                textStyle: {
                  size: { value: Number.POSITIVE_INFINITY, units: 'pointsUnit' },
                },
              },
            ],
          },
        },
      ],
    },
  });

  const [textNode] = parser.buildLayerTree(document, 5, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });

  assert.equal(textNode.textStyle?.fontSize, 24);
  assert.equal(textNode.textStyle?.lineHeight, 30);
  assert.equal(textNode.textStyle?.letterSpacing, 0.48);
  assert.equal(textNode.textMetrics?.relativeBounds?.width, 300);
  assert.equal(textNode.textMetrics?.relativeBoundingBox?.height, 60);
  assert.equal(textNode.textMetrics?.baselineShift, 2);
  assert.equal(textNode.textMetrics?.horizontalScale, 100);
  assert.equal(textNode.textMetrics?.verticalScale, 98);
  assert.equal(textNode.textMetrics?.transformScaleY, 0.98);
  assert.equal(textNode.textMetrics?.frameKind, 'paragraph');
  assert.equal(textNode.sizeHint?.width, 'fixed');
  assert.equal(textNode.sizeHint?.height, 'fixed');
  assert.deepEqual(textNode.textStyleRanges?.map(range => [range.from, range.to, range.fontSize]), [[0, 6, 24]]);

  const serialized = JSON.stringify(textNode);
  assert.doesNotMatch(serialized, /\[object Object\]|NaN|Infinity|"(?:width|height|fontSize)":null/);
});

test('parser accepts only flex spacing that reproduces source coordinates', () => {
  const parser = new LanhuParser();
  const makeChild = (id, left) => ({
    id,
    type: 'shapeLayer',
    name: `item-${id}`,
    visible: true,
    clipped: false,
    bounds: { top: 20, left, bottom: 40, right: left + 20 },
    fill: { color: { red: 0, green: 0, blue: 0 } },
  });
  const document = parser.parseDocument({
    board: {
      id: 1,
      type: 'artboardSection',
      name: 'Flex geometry',
      visible: true,
      clipped: false,
      artboard: {
        artboardRect: { top: 0, left: 0, bottom: 100, right: 300 },
      },
      layers: [
        {
          id: 10,
          type: 'layerSection',
          name: 'uniform',
          visible: true,
          clipped: false,
          bounds: { top: 10, left: 10, bottom: 50, right: 150 },
          layers: [makeChild(11, 20), makeChild(12, 60), makeChild(13, 100)],
        },
        {
          id: 20,
          type: 'layerSection',
          name: 'uneven',
          visible: true,
          clipped: false,
          bounds: { top: 10, left: 160, bottom: 50, right: 300 },
          layers: [makeChild(21, 170), makeChild(22, 207), makeChild(23, 260)],
        },
      ],
    },
  });

  const layers = parser.buildLayerTree(document, 5, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });
  const uniform = layers.find(node => node.name === 'uniform');
  const uneven = layers.find(node => node.name === 'uneven');

  assert.equal(uniform?.layoutHint?.mode, 'flex-row');
  assert.equal(uniform.layoutHint.justifyContent, 'start');
  assert.equal(uniform.layoutHint.gap, 20);
  assert.equal(uneven?.layoutHint, undefined);
});
