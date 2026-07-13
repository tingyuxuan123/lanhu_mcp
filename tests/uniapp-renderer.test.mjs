import test from 'node:test';
import assert from 'node:assert/strict';
import { pxToRpx, renderUniAppRoot } from '../dist/services/uniapp-renderer.js';

test('pxToRpx converts design pixels using width scale', () => {
  assert.equal(pxToRpx(10, 375), '20rpx');
  assert.equal(pxToRpx(375, 375), '750rpx');
});

test('renderUniAppRoot defaults to the artboard width when designWidth is omitted', () => {
  const sfc = renderUniAppRoot([], {
    name: 'Wide Artboard',
    x: 0,
    y: 0,
    width: 750,
    height: 1547,
  });

  assert.match(sfc, /\.page \{[^}]*width: 750rpx;[^}]*min-height: 1547rpx;/);
});

test('renderUniAppRoot emits semantic section classes, trace metadata, and shared token variables', () => {
  const sfc = renderUniAppRoot([
    {
      id: 1,
      name: '数据',
      type: 'group',
      visible: true,
      bounds: { x: 0, y: 0, width: 375, height: 120 },
      children: [
        {
          id: 2,
          name: '1',
          type: 'group',
          visible: true,
          bounds: { x: 0, y: 0, width: 120, height: 120 },
          layoutHint: { mode: 'flex-column', itemIds: [20], overlayIds: [] },
          children: [
            {
              id: 20,
              name: '今日订单',
              type: 'text',
              visible: true,
              bounds: { x: 0, y: 0, width: 40, height: 20 },
              text: 'A',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
        {
          id: 3,
          name: '2',
          type: 'group',
          visible: true,
          bounds: { x: 128, y: 0, width: 120, height: 120 },
          layoutHint: { mode: 'flex-column', itemIds: [21], overlayIds: [] },
          children: [
            {
              id: 21,
              name: '待接单',
              type: 'text',
              visible: true,
              bounds: { x: 128, y: 0, width: 40, height: 20 },
              text: 'B',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
        {
          id: 4,
          name: '3',
          type: 'group',
          visible: true,
          bounds: { x: 256, y: 0, width: 120, height: 120 },
          layoutHint: { mode: 'flex-column', itemIds: [22], overlayIds: [] },
          children: [
            {
              id: 22,
              name: '已完成',
              type: 'text',
              visible: true,
              bounds: { x: 256, y: 0, width: 40, height: 20 },
              text: 'C',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
      ],
    },
  ], {
    name: 'Stats Demo',
    x: 0,
    y: 0,
    width: 375,
    height: 120,
  }, {
    designWidth: 375,
  });

  assert.match(sfc, /class="section stats-panel box-node absolute-node layout-row" data-node-id="1" data-node-role="stats-panel" data-node-name="数据"/);
  assert.match(sfc, /class="section-item stats-panel__item box-node flow-node layout-column" data-node-id="2" data-node-role="stats-panel__item"/);
  assert.match(sfc, /class="section-item stats-panel__item-2 box-node flow-node layout-column" data-node-id="3" data-node-role="stats-panel__item"/);
  assert.match(sfc, /\.layout-row \{[^}]*display: flex;[^}]*flex-direction: row;/);
  assert.match(sfc, /\.stats-panel \{[^}]*left: 0rpx;[^}]*top: 0rpx;/);
  assert.match(sfc, /\.page \{[^}]*--color-1: #111111;/);
  assert.doesNotMatch(sfc, /class="node-/);
});

test('renderUniAppRoot infers a page-level vertical section stack for wide homepage blocks', () => {
  const sfc = renderUniAppRoot([
    {
      id: 10,
      name: '首页容器',
      type: 'group',
      visible: true,
      bounds: { x: 0, y: 0, width: 375, height: 420 },
      children: [
        {
          id: 14,
          name: 'bg',
          type: 'shape',
          visible: true,
          bounds: { x: 0, y: 0, width: 375, height: 420 },
          fill: '#f5f7fb',
          renderStrategy: 'shape',
        },
        {
          id: 11,
          name: '菜单',
          type: 'group',
          visible: true,
          bounds: { x: 16, y: 20, width: 343, height: 96 },
          fill: '#ffffff',
          children: [
            {
              id: 21,
              name: '菜单标题',
              type: 'text',
              visible: true,
              bounds: { x: 32, y: 40, width: 80, height: 20 },
              text: 'Menu',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#222222',
                alignment: 'left',
              },
            },
          ],
        },
        {
          id: 12,
          name: '数据',
          type: 'group',
          visible: true,
          bounds: { x: 16, y: 136, width: 343, height: 96 },
          fill: '#ffffff',
          children: [
            {
              id: 22,
              name: '数据标题',
              type: 'text',
              visible: true,
              bounds: { x: 32, y: 156, width: 80, height: 20 },
              text: 'Stats',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#222222',
                alignment: 'left',
              },
            },
          ],
        },
        {
          id: 13,
          name: '推荐',
          type: 'group',
          visible: true,
          bounds: { x: 16, y: 252, width: 343, height: 96 },
          fill: '#ffffff',
          children: [
            {
              id: 23,
              name: '推荐标题',
              type: 'text',
              visible: true,
              bounds: { x: 32, y: 272, width: 80, height: 20 },
              text: 'Feed',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#222222',
                alignment: 'left',
              },
            },
          ],
        },
      ],
    },
  ], {
    name: 'Home Sections',
    x: 0,
    y: 0,
    width: 375,
    height: 420,
  }, {
    designWidth: 375,
  });

  assert.match(sfc, /class="page-content page-stack box-node absolute-node layout-column" data-node-id="10" data-node-role="page-stack"/);
});

test('renderUniAppRoot remaps flow layout item ids when non-visual wrappers are flattened', () => {
  const sfc = renderUniAppRoot([
    {
      id: 200,
      name: '菜单',
      type: 'group',
      visible: true,
      bounds: { x: 0, y: 0, width: 375, height: 180 },
      layoutHint: { mode: 'flex-column', itemIds: [201, 204], overlayIds: [] },
      children: [
        {
          id: 201,
          name: '菜单包装',
          type: 'group',
          visible: true,
          bounds: { x: 0, y: 0, width: 375, height: 80 },
          children: [
            {
              id: 202,
              name: '第一快捷菜单',
              type: 'group',
              visible: true,
              bounds: { x: 0, y: 0, width: 375, height: 80 },
              layoutHint: { mode: 'flex-row', itemIds: [203], overlayIds: [] },
              children: [
                {
                  id: 203,
                  name: '车源',
                  type: 'text',
                  visible: true,
                  bounds: { x: 16, y: 20, width: 48, height: 20 },
                  text: '车源',
                  textStyle: {
                    fontSize: 16,
                    fontFamily: 'PingFang SC',
                    color: '#111111',
                    alignment: 'left',
                  },
                },
              ],
            },
          ],
        },
        {
          id: 204,
          name: '第二块',
          type: 'group',
          visible: true,
          bounds: { x: 0, y: 100, width: 375, height: 80 },
          fill: '#ffffff',
          children: [
            {
              id: 205,
              name: '更多',
              type: 'text',
              visible: true,
              bounds: { x: 16, y: 120, width: 48, height: 20 },
              text: '更多',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
      ],
    },
  ], {
    name: 'Flatten Layout',
    x: 0,
    y: 0,
    width: 375,
    height: 180,
  }, {
    designWidth: 375,
  });

  assert.doesNotMatch(sfc, /data-node-id="201"/);
  assert.match(sfc, /data-node-id="202"/);
  assert.ok(sfc.indexOf('data-node-id="202"') < sfc.indexOf('data-node-id="204"'));
});

test('renderUniAppRoot applies readable column layout overrides to recommendation sections', () => {
  const sfc = renderUniAppRoot([
    {
      id: 300,
      name: '智能推荐',
      type: 'group',
      visible: true,
      bounds: { x: 0, y: 0, width: 375, height: 460 },
      children: [
        {
          id: 301,
          name: '标题',
          type: 'text',
          visible: true,
          bounds: { x: 16, y: 16, width: 80, height: 20 },
          text: '智能推荐',
          textStyle: {
            fontSize: 16,
            fontFamily: 'PingFang SC',
            color: '#111111',
            alignment: 'left',
          },
        },
        {
          id: 302,
          name: '1',
          type: 'group',
          visible: true,
          bounds: { x: 16, y: 56, width: 343, height: 180 },
          layoutHint: { mode: 'flex-column', itemIds: [304], overlayIds: [] },
          children: [
            {
              id: 304,
              name: '卡片标题',
              type: 'text',
              visible: true,
              bounds: { x: 32, y: 72, width: 80, height: 20 },
              text: 'A',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
        {
          id: 303,
          name: '1',
          type: 'group',
          visible: true,
          bounds: { x: 16, y: 248, width: 343, height: 180 },
          layoutHint: { mode: 'flex-column', itemIds: [305], overlayIds: [] },
          children: [
            {
              id: 305,
              name: '卡片标题',
              type: 'text',
              visible: true,
              bounds: { x: 32, y: 264, width: 80, height: 20 },
              text: 'B',
              textStyle: {
                fontSize: 16,
                fontFamily: 'PingFang SC',
                color: '#111111',
                alignment: 'left',
              },
            },
          ],
        },
      ],
    },
  ], {
    name: 'Recommendation',
    x: 0,
    y: 0,
    width: 375,
    height: 460,
  }, {
    designWidth: 375,
  });

  assert.match(sfc, /class="section recommendation-list box-node absolute-node layout-column" data-node-id="300" data-node-role="recommendation-list"/);
  assert.match(sfc, /class="section-item recommendation-list__item box-node flow-node layout-column" data-node-id="302" data-node-role="recommendation-list__item"/);
  assert.match(sfc, /class="section-item recommendation-list__item-2 box-node flow-node layout-column" data-node-id="303" data-node-role="recommendation-list__item"/);
});

test('renderUniAppRoot does not emit background fills for asset-backed image nodes', () => {
  const sfc = renderUniAppRoot([
    {
      id: 4,
      name: 'trend icon',
      type: 'shape',
      visible: true,
      bounds: { x: 20, y: 20, width: 8, height: 14 },
      fill: '#1cc184',
      borderRadius: 2,
      assetUrl: '/static/lanhu-assets/icon-down.png',
      renderStrategy: 'asset',
    },
  ], {
    name: 'Image Fill',
    x: 0,
    y: 0,
    width: 375,
    height: 100,
  }, {
    designWidth: 375,
  });

  assert.match(sfc, /<image class="icon-node icon-node-\d+ box-node absolute-node image-node" data-node-id="4" data-node-role="icon-node" data-node-name="trend icon" src="\/static\/lanhu-assets\/icon-down.png" mode="aspectFill" \/>/);
  assert.match(sfc, /\.icon-node-\d+ \{[^}]*border-radius: 4rpx;/);
  assert.doesNotMatch(sfc, /\.icon-node \{[^}]*width:/);
  assert.doesNotMatch(sfc, /\.icon-node \{[^}]*height:/);
  assert.doesNotMatch(sfc, /\.icon-node \{[^}]*background-color:/);
  assert.doesNotMatch(sfc, /\.icon-node \{[^}]*background-image:/);
});

test('renderUniAppRoot preserves rich text ranges as nested text nodes with semantic segment classes', () => {
  const sfc = renderUniAppRoot([
    {
      id: 9,
      name: 'price',
      type: 'text',
      visible: true,
      bounds: { x: 0, y: 0, width: 100, height: 30 },
      text: '￥180/吨',
      textStyle: {
        fontSize: 18,
        fontFamily: 'PingFang SC',
        color: '#111111',
        alignment: 'left',
      },
      textStyleRanges: [
        { from: 0, to: 1, fontWeight: 700, fontSize: 18, color: '#111111' },
        { from: 1, to: 5, fontWeight: 400, fontSize: 14, color: '#666666' },
      ],
      sizeHint: { width: 'content', height: 'content' },
    },
  ], {
    name: 'Price',
    x: 0,
    y: 0,
    width: 375,
    height: 100,
  }, {
    designWidth: 375,
  });

  assert.match(sfc, /text-heading-seg-1/);
  assert.match(sfc, /text-heading-seg-2/);
  assert.match(sfc, /<text class="text-node-role text-heading box-node absolute-node text-node" data-node-id="9" data-node-role="text-heading" data-node-name="price"><text class="text-heading-seg-1">￥<\/text><text class="text-heading-seg-2">180\/<\/text>/);
});

test('renderUniAppRoot sorts root nodes by paint order before emitting markup', () => {
  const sfc = renderUniAppRoot([
    {
      id: 2,
      name: 'foreground',
      type: 'text',
      visible: true,
      zIndex: 1,
      bounds: { x: 24, y: 24, width: 80, height: 20 },
      text: '前景',
      textStyle: {
        fontSize: 14,
        fontFamily: 'PingFang SC',
        color: '#111111',
        alignment: 'left',
      },
    },
    {
      id: 1,
      name: 'background',
      type: 'shape',
      visible: true,
      zIndex: 10,
      bounds: { x: 0, y: 0, width: 375, height: 120 },
      fill: '#f5f5f5',
      renderStrategy: 'shape',
    },
  ], {
    name: 'Layer Order',
    x: 0,
    y: 0,
    width: 375,
    height: 120,
  }, {
    designWidth: 375,
  });

  assert.ok(sfc.indexOf('data-node-id="1"') < sfc.indexOf('data-node-id="2"'));
});

test('renderUniAppRoot promotes non-visual absolute text containers and keeps single-line text nowrap', () => {
  const sfc = renderUniAppRoot([
    {
      id: 20,
      name: '问候',
      type: 'group',
      visible: true,
      zIndex: 2,
      bounds: { x: 42, y: 104, width: 124, height: 30 },
      renderStrategy: 'group',
      shouldRenderChildren: true,
      isTextOnlyContainer: true,
      sizeHint: { width: 'content', height: 'content' },
      children: [
        {
          id: 21,
          name: '云链智行',
          type: 'text',
          visible: true,
          zIndex: 1,
          bounds: { x: 42, y: 104, width: 124, height: 30 },
          text: '云链智行',
          textStyle: {
            fontSize: 32,
            fontFamily: 'Alibaba PuHuiTi',
            fontWeight: 700,
            color: '#007bff',
            alignment: 'left',
            lineHeight: 37,
          },
          sizeHint: { width: 'content', height: 'content' },
        },
      ],
    },
  ], {
    name: 'Greeting',
    x: 0,
    y: 0,
    width: 375,
    height: 160,
  }, {
    designWidth: 375,
  });

  assert.doesNotMatch(sfc, /data-node-id="20"/);
  assert.match(sfc, /data-node-id="21"/);
  assert.match(sfc, /\.text-hero \{[^}]*width: 248rpx;[^}]*height: 60rpx;[^}]*white-space: nowrap;[^}]*word-break: keep-all;/);
});

test('renderUniAppRoot emits full-bleed background overlays before flow content inside flex containers', () => {
  const sfc = renderUniAppRoot([
    {
      id: 400,
      name: '横幅',
      type: 'group',
      visible: true,
      bounds: { x: 0, y: 0, width: 375, height: 120 },
      layoutHint: { mode: 'flex-column', itemIds: [401], overlayIds: [402] },
      children: [
        {
          id: 401,
          name: '标题',
          type: 'text',
          visible: true,
          bounds: { x: 24, y: 42, width: 120, height: 24 },
          text: '内容',
          textStyle: {
            fontSize: 18,
            fontFamily: 'PingFang SC',
            color: '#111111',
            alignment: 'left',
          },
        },
        {
          id: 402,
          name: 'bg',
          type: 'shape',
          visible: true,
          bounds: { x: 0, y: 0, width: 375, height: 120 },
          fill: '#f5f5f5',
          renderStrategy: 'shape',
        },
      ],
    },
  ], {
    name: 'Overlay Order',
    x: 0,
    y: 0,
    width: 375,
    height: 120,
  }, {
    designWidth: 375,
  });

  assert.ok(sfc.indexOf('data-node-id="402"') < sfc.indexOf('data-node-id="401"'));
});

test('renderUniAppRoot omits top preview chrome layers used only for design framing', () => {
  const sfc = renderUniAppRoot([
    {
      id: 80,
      name: 'top',
      type: 'image',
      visible: true,
      zIndex: 5,
      bounds: { x: 0, y: 0, width: 750, height: 422 },
      assetUrl: '/static/lanhu-assets/top.png',
      renderStrategy: 'asset',
    },
    {
      id: 81,
      name: 'Path',
      type: 'layer',
      visible: true,
      zIndex: 20,
      bounds: { x: 13, y: 29, width: 727, height: 20 },
      fill: '#111111',
      renderStrategy: 'shape',
    },
    {
      id: 82,
      name: '标题+小程序',
      type: 'group',
      visible: true,
      zIndex: 21,
      bounds: { x: 430, y: 70, width: 304, height: 80 },
      renderStrategy: 'group',
      shouldRenderChildren: true,
      children: [
        {
          id: 83,
          name: '小程序-暗色',
          type: 'group',
          visible: true,
          zIndex: 22,
          bounds: { x: 559, y: 86, width: 175, height: 64 },
          renderStrategy: 'group',
          shouldRenderChildren: true,
          children: [
            {
              id: 84,
              name: 'capsule-bg',
              type: 'shape',
              visible: true,
              bounds: { x: 559, y: 86, width: 175, height: 64 },
              borderRadius: 32,
              stroke: { color: '#111111', width: 1 },
              renderStrategy: 'shape',
            },
          ],
        },
      ],
    },
  ], {
    name: 'Preview Chrome',
    x: 0,
    y: 0,
    width: 750,
    height: 1547,
  }, {
    designWidth: 750,
  });

  assert.match(sfc, /data-node-id="80"/);
  assert.doesNotMatch(sfc, /data-node-id="81"/);
  assert.doesNotMatch(sfc, /data-node-id="82"/);
  assert.doesNotMatch(sfc, /data-node-id="83"/);
  assert.doesNotMatch(sfc, /data-node-id="84"/);
});

test('renderUniAppRoot keeps regular Path nodes when they do not match the preview status bar geometry', () => {
  const sfc = renderUniAppRoot([
    {
      id: 90,
      name: 'Path',
      type: 'layer',
      visible: true,
      bounds: { x: 40, y: 260, width: 140, height: 20 },
      fill: '#ff6b6b',
      renderStrategy: 'shape',
    },
  ], {
    name: 'Regular Path',
    x: 0,
    y: 0,
    width: 750,
    height: 1547,
  }, {
    designWidth: 750,
  });

  assert.match(sfc, /data-node-id="90"/);
});

test('renderUniAppRoot keeps similarly named mini-program content when it is outside the top preview area', () => {
  const sfc = renderUniAppRoot([
    {
      id: 100,
      name: '小程序-暗色',
      type: 'group',
      visible: true,
      bounds: { x: 520, y: 280, width: 175, height: 64 },
      fill: '#ffffff',
      renderStrategy: 'group',
      shouldRenderChildren: true,
      children: [
        {
          id: 101,
          name: 'capsule-body',
          type: 'shape',
          visible: true,
          bounds: { x: 520, y: 280, width: 175, height: 64 },
          borderRadius: 32,
          stroke: { color: '#111111', width: 1 },
          renderStrategy: 'shape',
        },
      ],
    },
  ], {
    name: 'Mini Program Content',
    x: 0,
    y: 0,
    width: 750,
    height: 1547,
  }, {
    designWidth: 750,
  });

  assert.match(sfc, /data-node-id="100"/);
  assert.match(sfc, /data-node-id="101"/);
});
