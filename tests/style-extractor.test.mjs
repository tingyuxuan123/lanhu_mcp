import test from 'node:test';
import assert from 'node:assert/strict';
import { StyleExtractor } from '../dist/services/style-extractor.js';

function createFlexNode(justifyContent) {
  return {
    id: 1,
    name: 'Spacing owner',
    type: 'group',
    visible: true,
    bounds: { x: 0, y: 0, width: 200, height: 40 },
    layoutHint: {
      mode: 'flex-row',
      itemIds: [],
      overlayIds: [],
      gap: 20,
      justifyContent,
      alignItems: 'center',
    },
  };
}

test('StyleExtractor emits only one flex spacing owner in every output format', () => {
  const extractor = new StyleExtractor();
  const distributedNode = createFlexNode('space-between');

  const css = extractor.extractFromLanhuNode(distributedNode, 'css');
  const tailwind = extractor.extractFromLanhuNode(distributedNode, 'tailwind');
  const react = extractor.extractFromLanhuNode(distributedNode, 'react');
  const vue = extractor.extractFromLanhuNode(distributedNode, 'vue');

  assert.match(css, /justify-content: space-between/);
  assert.doesNotMatch(css, /\bgap:/);
  assert.doesNotMatch(tailwind, /gap-\[/);
  assert.doesNotMatch(react, /"gap":/);
  assert.doesNotMatch(vue, /"gap":/);

  const explicitGapCss = extractor.extractFromLanhuNode(createFlexNode('start'), 'css');
  assert.match(explicitGapCss, /gap: 20px/);
  assert.match(explicitGapCss, /justify-content: flex-start/);
});
