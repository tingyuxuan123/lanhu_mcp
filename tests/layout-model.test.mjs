import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayoutRenderModel } from '../dist/services/layout-model.js';

const bounds = (x, y, width, height) => ({ x, y, width, height });

const layer = (id, geometry, overrides = {}) => ({
  id,
  name: `node-${id}`,
  type: 'group',
  visible: true,
  bounds: geometry,
  layoutBounds: geometry,
  ...overrides,
});

test('layout model accepts flow only when frame geometry remains linear', () => {
  const result = buildLayoutRenderModel([
    layer(1, bounds(0, 0, 160, 60), {
      children: [
        layer(2, bounds(16, 18, 28, 24), { layoutBounds: bounds(20, 20, 20, 20) }),
        layer(3, bounds(56, 18, 28, 24), { layoutBounds: bounds(60, 20, 20, 20) }),
        layer(4, bounds(96, 18, 28, 24), { layoutBounds: bounds(100, 20, 20, 20) }),
      ],
      layoutHint: {
        mode: 'flex-row',
        itemIds: [2, 3, 4],
        overlayIds: [],
      },
    }),
  ]);

  const container = result.nodes[0];
  assert.equal(container.layoutDecision?.mode, 'linear-flow');
  assert.equal(container.layoutDecision?.evidence.residual, 0);
  assert.equal(container.layoutHint?.gap, 20);
  assert.equal(container.layoutHint?.alignItems, 'start');
  assert.equal(container.sourceLayoutHint?.mode, 'flex-row');
});

test('layout model rejects source flex that cannot reproduce source coordinates', () => {
  const result = buildLayoutRenderModel([
    layer(1, bounds(0, 0, 160, 60), {
      children: [
        layer(2, bounds(20, 20, 20, 20)),
        layer(3, bounds(57, 20, 20, 20)),
        layer(4, bounds(110, 20, 20, 20)),
      ],
      layoutHint: {
        mode: 'flex-row',
        itemIds: [2, 3, 4],
        overlayIds: [],
      },
    }),
  ]);

  const container = result.nodes[0];
  assert.equal(container.layoutDecision?.mode, 'absolute');
  assert.equal(container.layoutHint, undefined);
  assert.equal(container.sourceLayoutHint?.mode, 'flex-row');
  assert.equal(container.layoutDecision?.evidence.reason, 'layout-candidate-violates-source-geometry');
});

test('layout model preserves validated multi-row flow as stacked lines', () => {
  const result = buildLayoutRenderModel([
    layer(1, bounds(0, 0, 120, 90), {
      children: [
        layer(2, bounds(10, 10, 30, 20)),
        layer(3, bounds(50, 10, 30, 20)),
        layer(4, bounds(10, 50, 50, 20)),
      ],
      layoutHint: {
        mode: 'flex-column',
        itemIds: [2, 3, 4],
        overlayIds: [],
        lines: [
          { itemIds: [2, 3], bounds: bounds(10, 10, 70, 20) },
          { itemIds: [4], bounds: bounds(10, 50, 50, 20) },
        ],
      },
    }),
  ]);

  const container = result.nodes[0];
  assert.equal(container.layoutDecision?.mode, 'stacked-lines');
  assert.deepEqual(container.layoutHint?.lines?.map(line => line.itemIds), [[2, 3], [4]]);
  assert.equal(container.layoutDecision?.evidence.residual, 0);
});