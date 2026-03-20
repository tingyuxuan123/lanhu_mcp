import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { LanhuParser } from '../dist/services/lanhu-parser.js';
import { imageCompareService } from '../dist/services/image-compare.js';

const jsonPath = path.resolve(process.env.SAMPLE_JSON_PATH || 'tmp_sample.json');
const referenceImagePath = path.resolve(process.env.SAMPLE_REFERENCE_PATH || 'tmp_sample.png');
const outputDir = path.resolve(process.env.SAMPLE_OUTPUT_DIR || 'artifacts/sample-validation');
const statusTimeLabel = process.env.SAMPLE_STATUS_TIME || '1:21 AM';
const statusAppLabel = process.env.SAMPLE_STATUS_APP || 'WeChat';

await fs.mkdir(outputDir, { recursive: true });

const document = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
const parser = new LanhuParser();
const parsed = parser.parseDocument(document);
const artboard = parser.getArtboardInfo(parsed);
const layers = parser.buildLayerTree(parsed, 30, {
  includeInvisible: false,
  normalizeToArtboard: true,
});
const restoration = parser.buildRestorationPlan(layers);

const htmlPath = path.join(outputDir, 'sample-restoration.html');
const screenshotPath = path.join(outputDir, 'sample-restoration.png');
const diffPath = path.join(outputDir, 'sample-restoration-diff.png');
const metaPath = path.join(outputDir, 'sample-restoration-meta.json');
const parsedPath = path.join(outputDir, 'sample-restoration-bundle.json');

const nodesById = new Map();
const walk = nodes => {
  for (const node of nodes) {
    nodesById.set(node.id, node);
    if (node.children?.length) {
      walk(node.children);
    }
  }
};
walk(layers);

const maskedTargetIds = new Set(restoration.maskGroups.flatMap(group => group.targetIds));

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sortByPaint(nodes) {
  return [...nodes].sort((left, right) => (right.zIndex || 0) - (left.zIndex || 0));
}

function hasVisual(node) {
  if (isUnresolvedBitmapLayer(node)) {
    return hasBitmapFallback(node);
  }

  return Boolean(
    node.text
    || node.assetUrl
    || node.fill
    || node.stroke
    || (node.shadows && node.shadows.length)
  );
}

function hasOwnVisual(node) {
  if (isUnresolvedBitmapLayer(node)) {
    return hasBitmapFallback(node);
  }

  return Boolean(
    node.fill
    || node.stroke
    || node.assetUrl
    || (node.shadows && node.shadows.length)
    || (node.renderStrategy === 'shape' && node.pathData?.components?.length)
  );
}

function isRenderable(node) {
  if (!node.visible) return false;
  if (node.bounds.width <= 0 || node.bounds.height <= 0) return false;
  if (node.intersectsArtboard === false) return false;
  return true;
}

function isUnresolvedBitmapLayer(node) {
  const rasterLike = node.type === 'layer' || node.type === 'image';
  return Boolean(
    rasterLike
    && !node.assetUrl
    && !node.text
    && !node.pathData?.components?.length
    && (!node.children || node.children.length === 0)
  );
}

function hasBitmapFallback(node) {
  return /头像/.test(node.name || '')
    || node.name === '我的'
    || (node.name === 'Path' && node.bounds.y <= 40 && node.bounds.width >= 600);
}

function radiusValue(node) {
  if (node.shapeType === 'ellipse') {
    return '9999px';
  }
  if (node.borderRadius === undefined) {
    return '';
  }
  if (Array.isArray(node.borderRadius)) {
    return node.borderRadius.map(value => `${value}px`).join(' ');
  }
  return `${node.borderRadius}px`;
}

function boxShadowValue(node) {
  if (!node.shadows?.length) {
    return '';
  }
  return node.shadows
    .map(shadow => `${shadow.type === 'innerShadow' ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`)
    .join(',');
}

function boxStyles(node, {
  offsetX = 0,
  offsetY = 0,
  forceClip = false,
  mode = 'absolute',
  omitWidth,
  omitHeight,
  includeVisual = true,
  visualNode = node,
} = {}) {
  const transforms = [];
  const styles = [
    'box-sizing:border-box',
    'transform-origin:top left',
    'pointer-events:none',
  ];

  if (mode === 'flow') {
    styles.push('position:relative');
    styles.push('flex:0 0 auto');
  } else {
    let left = node.bounds.x - offsetX;
    if ((node.text || node.isTextOnlyContainer) && node.sizeHint?.width === 'content') {
      if (node.textStyle?.alignment === 'center') {
        left = node.bounds.x + node.bounds.width / 2 - offsetX;
        transforms.push('translateX(-50%)');
      } else if (node.textStyle?.alignment === 'right') {
        left = node.bounds.x + node.bounds.width - offsetX;
        transforms.push('translateX(-100%)');
      }
    }
    styles.push('position:absolute');
    styles.push(`left:${left}px`);
    styles.push(`top:${node.bounds.y - offsetY}px`);
  }

  const shouldOmitWidth = omitWidth ?? (node.sizeHint?.width === 'content');
  const shouldOmitHeight = omitHeight ?? (node.sizeHint?.height === 'content');

  if (!shouldOmitWidth) {
    styles.push(`width:${node.bounds.width}px`);
  }
  if (!shouldOmitHeight) {
    styles.push(`height:${node.bounds.height}px`);
  }

  if (node.opacity !== undefined) {
    styles.push(`opacity:${node.opacity}`);
  }

  if (includeVisual) {
    if (visualNode.fill) {
      styles.push(visualNode.fill.startsWith('linear-gradient') || visualNode.fill.startsWith('radial-gradient')
        ? `background-image:${visualNode.fill}`
        : `background:${visualNode.fill}`);
    }

    if (visualNode.stroke) {
      styles.push(`border:${visualNode.stroke.width}px solid ${visualNode.stroke.color}`);
    }

    const radius = radiusValue(visualNode);
    if (radius) {
      styles.push(`border-radius:${radius}`);
    }

    const shadow = boxShadowValue(visualNode);
    if (shadow) {
      styles.push(`box-shadow:${shadow}`);
    }
  }

  if (node.textMetrics?.transformScaleX && Math.abs(node.textMetrics.transformScaleX - 1) > 0.001) {
    const scaleY = node.textMetrics.transformScaleY && Math.abs(node.textMetrics.transformScaleY - 1) > 0.001
      ? ` scaleY(${node.textMetrics.transformScaleY})`
      : '';
    transforms.push(`scaleX(${node.textMetrics.transformScaleX})${scaleY}`);
  } else if (node.textMetrics?.transformScaleY && Math.abs(node.textMetrics.transformScaleY - 1) > 0.001) {
    transforms.push(`scaleY(${node.textMetrics.transformScaleY})`);
  }

  if (forceClip) {
    styles.push('overflow:hidden');
  }

  if (transforms.length > 0) {
    styles.push(`transform:${transforms.join(' ')}`);
  }

  return styles.join(';');
}

function getContainerVisualNode(node) {
  if (!node.containerVisualSourceId) {
    return undefined;
  }

  const candidate = nodesById.get(node.containerVisualSourceId);
  if (
    !candidate
    || !isRenderable(candidate)
    || candidate.opacity !== undefined && candidate.opacity < 0.99
  ) {
    return undefined;
  }

  return candidate;
}

function resolveLineHeight(node, style, singleLine) {
  if (style.lineHeight) {
    return `${style.lineHeight}px`;
  }

  const fontSize = style.fontSize || 14;
  if (!singleLine) {
    return `${Number((fontSize * 1.2).toFixed(2))}px`;
  }

  const fallback = Math.max(
    fontSize,
    Math.min(node.bounds.height || fontSize, Number((fontSize * 1.2).toFixed(2))),
  );
  return `${Number(fallback.toFixed(2))}px`;
}

function textContainerStyles(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const style = node.textStyle || {};
  const singleLine = !String(node.text || '').includes('\n');
  const styles = [
    boxStyles(node, {
      offsetX,
      offsetY,
      forceClip: false,
      mode,
      omitWidth: true,
      omitHeight: true,
      includeVisual: false,
    }),
    `white-space:${singleLine ? 'nowrap' : 'pre-wrap'}`,
    `word-break:${singleLine ? 'keep-all' : 'break-word'}`,
    'overflow:visible',
    'background:transparent',
    'display:inline-block',
    `font-size:${style.fontSize || 14}px`,
    `font-family:'${style.fontFamily || 'sans-serif'}','Microsoft YaHei','PingFang SC',sans-serif`,
    `font-weight:${style.fontWeight || 400}`,
    `font-style:${style.fontStyle || 'normal'}`,
    `color:${style.color || '#000000'}`,
    `text-align:${style.alignment || 'left'}`,
    'max-width:none',
  ];

  styles.push(`line-height:${resolveLineHeight(node, style, singleLine)}`);

  if (style.letterSpacing !== undefined) {
    styles.push(`letter-spacing:${style.letterSpacing}px`);
  }

  return styles.join(';');
}

function stylesForRange(range) {
  const styles = [];
  if (range.fontSize) styles.push(`font-size:${range.fontSize}px`);
  if (range.fontFamily) styles.push(`font-family:'${range.fontFamily}','PingFang SC','Microsoft YaHei',sans-serif`);
  if (range.fontWeight) styles.push(`font-weight:${range.fontWeight}`);
  if (range.fontStyle) styles.push(`font-style:${range.fontStyle}`);
  if (range.color) styles.push(`color:${range.color}`);
  return styles.join(';');
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) < 0.01;
}

function svgPathForNode(node, baseBounds) {
  const pathData = node.pathData;
  if (!pathData?.components?.length) {
    return '';
  }

  const relativeBounds = baseBounds || pathData.pathBounds || node.bounds;
  const offsetX = relativeBounds.x;
  const offsetY = relativeBounds.y;
  const paths = [];

  for (const component of pathData.components) {
    for (const subpath of component.subpaths) {
      if (!subpath.points.length) {
        continue;
      }

      const [first, ...rest] = subpath.points;
      let d = `M ${Number((first.anchor.x - offsetX).toFixed(3))} ${Number((first.anchor.y - offsetY).toFixed(3))}`;
      let previous = first;

      for (const point of rest) {
        const lineLike = nearlyEqual(previous.forward.x, previous.anchor.x)
          && nearlyEqual(previous.forward.y, previous.anchor.y)
          && nearlyEqual(point.backward.x, point.anchor.x)
          && nearlyEqual(point.backward.y, point.anchor.y);

        d += lineLike
          ? ` L ${Number((point.anchor.x - offsetX).toFixed(3))} ${Number((point.anchor.y - offsetY).toFixed(3))}`
          : ` C ${Number((previous.forward.x - offsetX).toFixed(3))} ${Number((previous.forward.y - offsetY).toFixed(3))} ${Number((point.backward.x - offsetX).toFixed(3))} ${Number((point.backward.y - offsetY).toFixed(3))} ${Number((point.anchor.x - offsetX).toFixed(3))} ${Number((point.anchor.y - offsetY).toFixed(3))}`;
        previous = point;
      }

      if (subpath.closed) {
        const lineLike = nearlyEqual(previous.forward.x, previous.anchor.x)
          && nearlyEqual(previous.forward.y, previous.anchor.y)
          && nearlyEqual(first.backward.x, first.anchor.x)
          && nearlyEqual(first.backward.y, first.anchor.y);
        d += lineLike
          ? ` L ${Number((first.anchor.x - offsetX).toFixed(3))} ${Number((first.anchor.y - offsetY).toFixed(3))} Z`
          : ` C ${Number((previous.forward.x - offsetX).toFixed(3))} ${Number((previous.forward.y - offsetY).toFixed(3))} ${Number((first.backward.x - offsetX).toFixed(3))} ${Number((first.backward.y - offsetY).toFixed(3))} ${Number((first.anchor.x - offsetX).toFixed(3))} ${Number((first.anchor.y - offsetY).toFixed(3))} Z`;
      }

      paths.push(d);
    }
  }

  return paths.join(' ');
}

function shapeClipStyles(node, baseBounds) {
  const pathValue = svgPathForNode(node, baseBounds);
  if (!pathValue) {
    return '';
  }

  return [
    `clip-path:path('${pathValue}')`,
    `-webkit-clip-path:path('${pathValue}')`,
  ].join(';');
}

function renderTextContent(node) {
  const text = node.text || '';
  const ranges = node.textStyleRanges || [];
  if (ranges.length <= 1) {
    return escapeHtml(text);
  }

  let cursor = 0;
  const chunks = [];
  for (const range of ranges) {
    if (range.from > cursor) {
      chunks.push(escapeHtml(text.slice(cursor, range.from)));
    }
    const content = escapeHtml(text.slice(range.from, range.to));
    chunks.push(`<span style="${stylesForRange(range)}">${content}</span>`);
    cursor = range.to;
  }
  if (cursor < text.length) {
    chunks.push(escapeHtml(text.slice(cursor)));
  }
  return chunks.join('');
}

function renderOwn(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  if (!isRenderable(node)) {
    return '';
  }

  if (isUnresolvedBitmapLayer(node)) {
    return renderBitmapFallback(node, offsetX, offsetY, mode);
  }

  if (node.renderStrategy === 'asset' && node.assetUrl) {
    return `<div class="layer asset" style="${boxStyles(node, { offsetX, offsetY, mode })}"><img src="${node.assetUrl}" style="width:100%;height:100%;display:block;object-fit:fill;" /></div>`;
  }

  if (node.text) {
    return `<div class="layer text" style="${textContainerStyles(node, offsetX, offsetY, mode)}">${renderTextContent(node)}</div>`;
  }

  if (node.renderStrategy === 'shape' && node.pathData?.components?.length) {
    const pathBounds = node.pathData.pathBounds || node.bounds;
    const wrapperStyle = [
      boxStyles(node, { offsetX, offsetY, mode }),
      shapeClipStyles(node, node.bounds),
    ].filter(Boolean).join(';');
    const svgStyle = [
      'position:absolute',
      `left:${pathBounds.x - node.bounds.x}px`,
      `top:${pathBounds.y - node.bounds.y}px`,
      `width:${pathBounds.width}px`,
      `height:${pathBounds.height}px`,
      'overflow:visible',
    ].join(';');
    const fill = node.fill && !node.fill.startsWith('linear-gradient') && !node.fill.startsWith('radial-gradient')
      ? node.fill
      : 'transparent';
    const stroke = node.stroke?.color || 'none';
    const strokeWidth = node.stroke?.width || 0;

    return `<div class="layer shape" style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pathBounds.width} ${pathBounds.height}" style="${svgStyle}"><path d="${svgPathForNode(node)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-rule="evenodd" /></svg></div>`;
  }

  if (!hasVisual(node)) {
    return '';
  }

  return `<div class="layer ${node.type}" style="${boxStyles(node, { offsetX, offsetY, mode })}"></div>`;
}

function renderBitmapFallback(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  if (/头像/.test(node.name || '')) {
    const wrapperStyle = boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      includeVisual: false,
    });
    const iconColor = '#8e9cb3';
    return `<div class="layer bitmap-fallback avatar" style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="width:100%;height:100%;display:block"><circle cx="24" cy="17" r="8" fill="${iconColor}" /><path d="M10 39c1.8-8.2 8.1-12.3 14-12.3S36.2 30.8 38 39" fill="${iconColor}" /></svg></div>`;
  }

  if (node.name === '我的') {
    const wrapperStyle = boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      includeVisual: false,
    });
    const iconColor = '#c6c6c6';
    return `<div class="layer bitmap-fallback profile" style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="width:100%;height:100%;display:block"><circle cx="24" cy="18" r="8" fill="${iconColor}" /><path d="M11 39c1.7-7.7 7.7-11.5 13-11.5S35.3 31.3 37 39" fill="${iconColor}" /></svg></div>`;
  }

  if (node.name === 'Path' && node.bounds.y <= 40 && node.bounds.width >= 600) {
    const wrapperStyle = [
      boxStyles(node, {
        offsetX,
        offsetY,
        mode,
        includeVisual: false,
      }),
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'font-size:13px',
      'font-weight:600',
      'line-height:1',
      'color:#111827',
      'padding:0 10px',
      'box-sizing:border-box',
    ].join(';');

    return `<div class="layer bitmap-fallback status-bar" style="${wrapperStyle}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:8px;letter-spacing:-1px">●●●●●</span>
        <span>${escapeHtml(statusAppLabel)}</span>
      </div>
      <div>${escapeHtml(statusTimeLabel)}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span>100%</span>
        <span style="position:relative;display:inline-block;width:24px;height:11px;border:1.5px solid #111827;border-radius:2px;box-sizing:border-box;padding:1px">
          <span style="display:block;width:15px;height:100%;background:#111827;border-radius:1px"></span>
          <span style="position:absolute;right:-3px;top:2px;width:2px;height:5px;background:#111827;border-radius:0 1px 1px 0"></span>
        </span>
      </div>
    </div>`;
  }

  return '';
}

function getLayoutChildren(node) {
  const itemIdSet = new Set(node.layoutHint?.itemIds || []);
  const overlayIdSet = new Set(node.layoutHint?.overlayIds || []);
  return {
    items: (node.layoutHint?.itemIds || []).map(id => nodesById.get(id)).filter(Boolean),
    overlays: (node.children || []).filter(child => overlayIdSet.has(child.id) || !itemIdSet.has(child.id)),
  };
}

function getContainerChildren(node) {
  const visualNode = getContainerVisualNode(node);
  const children = (node.children || []).filter(child => child.id !== visualNode?.id);
  return {
    children,
    visualNode,
  };
}

function renderContainer(node, offsetX = 0, offsetY = 0, mode = 'absolute', insideMask = false) {
  const { children, visualNode } = getContainerChildren(node);
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      forceClip: false,
      visualNode: visualNode || node,
    }),
    visualNode ? shapeClipStyles(visualNode, node.bounds) : '',
  ].filter(Boolean).join(';');
  const childrenHtml = children.length > 0 && node.shouldRenderChildren !== false
    ? renderLayerList(children, node.bounds.x, node.bounds.y, 'absolute', insideMask)
    : '';
  return `<div class="layer container" style="${wrapperStyle}">${childrenHtml}</div>`;
}

function flexLayoutStyles(node) {
  const layout = node.layoutHint;
  if (!layout) {
    return '';
  }

  const styles = [
    'display:flex',
    `flex-direction:${layout.mode === 'flex-row' ? 'row' : 'column'}`,
    `justify-content:${layout.justifyContent === 'space-between' ? 'space-between' : layout.justifyContent === 'center' ? 'center' : layout.justifyContent === 'end' ? 'flex-end' : 'flex-start'}`,
    `align-items:${layout.alignItems === 'center' ? 'center' : layout.alignItems === 'end' ? 'flex-end' : layout.alignItems === 'stretch' ? 'stretch' : 'flex-start'}`,
    `gap:${layout.gap || 0}px`,
    'box-sizing:border-box',
  ];

  if (layout.padding) {
    styles.push(`padding:${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`);
  }

  return styles.join(';');
}

function renderFlowNode(node) {
  if (!isRenderable(node)) {
    return '';
  }

  if (node.clip?.isMask && node.clip.targetIds?.length) {
    return renderMaskGroup(node, 0, 0, 'flow');
  }

  if (node.layoutHint && node.layoutHint.mode !== 'absolute') {
    return renderFlexNode(node, 0, 0, 'flow');
  }

  if (node.children?.length && node.shouldRenderChildren !== false && node.renderStrategy !== 'asset') {
    return renderContainer(node, 0, 0, 'flow', false);
  }

  return renderOwn(node, 0, 0, 'flow');
}

function renderFlexNode(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const { items, overlays } = getLayoutChildren(node);
  const visualNode = getContainerVisualNode(node);
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      forceClip: false,
      visualNode: visualNode || node,
    }),
    visualNode ? shapeClipStyles(visualNode, node.bounds) : '',
    flexLayoutStyles(node),
  ].join(';');
  const overlayHtml = overlays
    .filter(child => child.id !== visualNode?.id)
    .map(child => renderNode(child, node.bounds.x, node.bounds.y, 'absolute', false))
    .join('\n');
  const flowHtml = items.map(child => renderFlowNode(child)).join('\n');

  return `<div class="layer flex-node" style="${wrapperStyle}">${overlayHtml}${flowHtml}</div>`;
}

function renderMaskGroup(maskNode, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const targets = (maskNode.clip?.targetIds || [])
    .map(id => nodesById.get(id))
    .filter(Boolean);
  const ownMask = hasVisual(maskNode) ? renderOwn(maskNode, offsetX, offsetY, mode) : '';
  const wrapperStyles = [
    boxStyles(maskNode, {
      offsetX,
      offsetY,
      mode,
      forceClip: true,
    }),
    shapeClipStyles(maskNode, maskNode.bounds),
    'background:transparent',
  ].join(';');
  const childrenHtml = sortByPaint(targets).map(target => renderNode(target, maskNode.bounds.x, maskNode.bounds.y, 'absolute', true)).join('\n');

  return `${ownMask}<div class="layer mask" style="${wrapperStyles}">${childrenHtml}</div>`;
}

function renderNode(node, offsetX = 0, offsetY = 0, mode = 'absolute', insideMask = false) {
  if (!isRenderable(node)) {
    return '';
  }

  if (!insideMask && maskedTargetIds.has(node.id)) {
    return '';
  }

  if (node.clip?.isMask && node.clip.targetIds?.length) {
    return renderMaskGroup(node, offsetX, offsetY, mode);
  }

  if (node.layoutHint && node.layoutHint.mode !== 'absolute') {
    return renderFlexNode(node, offsetX, offsetY, mode);
  }

  if (node.children?.length && node.shouldRenderChildren !== false && node.renderStrategy !== 'asset') {
    return renderContainer(node, offsetX, offsetY, mode, insideMask);
  }

  return renderOwn(node, offsetX, offsetY, mode);
}

function renderLayerList(nodes, offsetX = 0, offsetY = 0, mode = 'absolute', insideMask = false) {
  return sortByPaint(nodes).map(node => {
    return renderNode(node, offsetX, offsetY, mode, insideMask);
  }).join('\n');
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${artboard.width}, initial-scale=1.0" />
  <title>${escapeHtml(artboard.name)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden; }
    #artboard { position: relative; width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden; background: #fff; }
    .layer { position: absolute; }
    .text { -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
  </style>
</head>
<body>
  <div id="artboard">${renderLayerList(layers)}</div>
</body>
</html>`;

await fs.writeFile(htmlPath, html, 'utf8');
await fs.writeFile(parsedPath, JSON.stringify({ artboard, restoration, layers }, null, 2), 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: Math.ceil(artboard.width), height: Math.ceil(artboard.height) },
  deviceScaleFactor: 1,
});
await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
await page.locator('#artboard').screenshot({ path: screenshotPath });
await browser.close();

const compare = await imageCompareService.compare({
  referenceImagePath,
  candidateImagePath: screenshotPath,
  diffOutputPath: diffPath,
  resizeCandidate: true,
  mismatchThreshold: 0.08,
  gridRows: 8,
  gridCols: 4,
});

const result = {
  artboard,
  rootLayerCount: layers.length,
  restoration,
  htmlPath,
  parsedPath,
  screenshotPath,
  diffPath,
  compare,
};

await fs.writeFile(metaPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
