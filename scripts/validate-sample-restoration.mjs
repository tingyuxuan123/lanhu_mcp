import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { LanhuClient } from '../dist/services/lanhu-client.js';
import { LanhuParser } from '../dist/services/lanhu-parser.js';
import { imageCompareService } from '../dist/services/image-compare.js';
import { parseLanhuUrl } from '../dist/utils/url-parser.js';

const pageUrl = process.env.LANHU_PAGE_URL;
const cookie = process.env.LANHU_COOKIE || '';
const directJsonUrl = process.env.LANHU_JSON_URL;
const directReferenceImageUrl = process.env.LANHU_REFERENCE_IMAGE_URL || null;
const jsonPath = pageUrl || directJsonUrl ? null : path.resolve(process.env.SAMPLE_JSON_PATH || 'tmp_sample.json');
const referenceImagePath = pageUrl || directReferenceImageUrl ? null : path.resolve(process.env.SAMPLE_REFERENCE_PATH || 'tmp_sample.png');
const outputDir = path.resolve(
  process.env.LANHU_OUTPUT_DIR
  || process.env.SAMPLE_OUTPUT_DIR
  || (pageUrl || directJsonUrl ? 'artifacts/lanhu-restoration' : 'artifacts/sample-validation'),
);
const outputPrefix = process.env.RESTORATION_OUTPUT_PREFIX || (pageUrl || directJsonUrl ? 'lanhu-restoration' : 'sample-restoration');
const statusTimeLabel = process.env.SAMPLE_STATUS_TIME || '1:21 AM';
const statusAppLabel = process.env.SAMPLE_STATUS_APP || 'WeChat';

await fs.mkdir(outputDir, { recursive: true });

if (pageUrl && !cookie) {
  throw new Error('LANHU_COOKIE is required when LANHU_PAGE_URL is provided');
}

let document;
let sourceMeta;
let referenceImageUrl = directReferenceImageUrl;

if (pageUrl) {
  const client = new LanhuClient(cookie);
  const imageInfo = await client.getImageInfo(parseLanhuUrl(pageUrl));
  const latestVersion = client.getLatestVersion(imageInfo);
  document = await client.fetchSketchJson(latestVersion.json_url);
  referenceImageUrl = referenceImageUrl || imageInfo.url || latestVersion.url;
  sourceMeta = {
    mode: 'page_url',
    pageUrl,
    imageId: imageInfo.id,
    designName: imageInfo.name,
    latestVersionId: latestVersion.id,
    latestVersionInfo: latestVersion.version_info,
    jsonUrl: latestVersion.json_url,
    imageUrl: latestVersion.url,
    referenceImageUrl,
  };
} else if (directJsonUrl) {
  const response = await fetch(directJsonUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Lanhu JSON: ${response.status} ${response.statusText}`);
  }

  document = await response.json();
  sourceMeta = {
    mode: 'json_url',
    jsonUrl: directJsonUrl,
    imageUrl: referenceImageUrl,
    referenceImageUrl,
  };
} else {
  document = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  sourceMeta = {
    mode: 'local_sample',
    jsonPath,
    imagePath: referenceImagePath,
    referenceImagePath,
  };
}

const parser = new LanhuParser();
const parsed = parser.parseDocument(document);
const artboard = parser.getArtboardInfo(parsed);
const layers = parser.buildLayerTree(parsed, 30, {
  includeInvisible: false,
  normalizeToArtboard: true,
});
const restoration = parser.buildRestorationPlan(layers);

const htmlPath = path.join(outputDir, `${outputPrefix}.html`);
const screenshotPath = path.join(outputDir, `${outputPrefix}.png`);
const diffPath = path.join(outputDir, `${outputPrefix}-diff.png`);
const metaPath = path.join(outputDir, `${outputPrefix}-meta.json`);
const parsedPath = path.join(outputDir, `${outputPrefix}-bundle.json`);

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

function layerAttrs(node) {
  return [
    `data-layer-id="${node.id}"`,
    `data-layer-name="${escapeHtml(String(node.name || ''))}"`,
    `data-layer-type="${escapeHtml(String(node.type || ''))}"`,
    node.renderStrategy ? `data-render-strategy="${escapeHtml(String(node.renderStrategy))}"` : '',
  ].filter(Boolean).join(' ');
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

function isTransparentLeaf(node) {
  return Boolean(
    node.opacity !== undefined
    && node.opacity <= 0.001
    && !node.text
    && (!node.children || node.children.length === 0)
    && !node.clip?.isMask
    && !node.clip?.clipped
  );
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
    'pointer-events:auto',
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
    const visualFill = getVisualFillValue(visualNode);
    if (visualFill) {
      styles.push(visualFill.startsWith('linear-gradient') || visualFill.startsWith('radial-gradient')
        ? `background-image:${visualFill}`
        : `background:${visualFill}`);
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
    || candidate.opacity !== undefined && candidate.opacity < 0.05
  ) {
    return undefined;
  }

  return candidate;
}

function applyOpacityToColor(color, opacity = 1) {
  if (!color || opacity >= 0.999) {
    return color;
  }

  const normalizedOpacity = Math.max(0, Math.min(1, opacity));
  const normalizedColor = color.trim().toLowerCase();
  const hexMatch = normalizedColor.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    const value = hexMatch[1];
    const expanded = value.length === 3
      ? value.split('').map(char => char + char).join('')
      : value;
    const red = parseInt(expanded.slice(0, 2), 16);
    const green = parseInt(expanded.slice(2, 4), 16);
    const blue = parseInt(expanded.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${Number(normalizedOpacity.toFixed(3))})`;
  }

  const rgbMatch = normalizedColor.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(',').map(part => part.trim());
    if (parts.length >= 3) {
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Number(normalizedOpacity.toFixed(3))})`;
    }
  }

  return null;
}

function canInlineVisualOpacity(visualNode) {
  if (!visualNode || visualNode.opacity === undefined || visualNode.opacity >= 0.999) {
    return true;
  }

  return Boolean(
    visualNode.fill
    && !visualNode.fill.startsWith('linear-gradient')
    && !visualNode.fill.startsWith('radial-gradient')
    && !visualNode.stroke
    && (!visualNode.shadows || visualNode.shadows.length === 0)
    && applyOpacityToColor(visualNode.fill, visualNode.opacity)
  );
}

function canEmbedVisualNode(node, visualNode) {
  if (!visualNode) {
    return false;
  }

  if (!canInlineVisualOpacity(visualNode)) {
    return false;
  }

  const toleranceX = Math.max(3, node.bounds.width * 0.03);
  const toleranceY = Math.max(3, node.bounds.height * 0.03);
  const nodeRight = node.bounds.x + node.bounds.width;
  const nodeBottom = node.bounds.y + node.bounds.height;
  const visualRight = visualNode.bounds.x + visualNode.bounds.width;
  const visualBottom = visualNode.bounds.y + visualNode.bounds.height;

  return Math.abs(visualNode.bounds.x - node.bounds.x) <= toleranceX
    && Math.abs(visualNode.bounds.y - node.bounds.y) <= toleranceY
    && Math.abs(visualRight - nodeRight) <= toleranceX
    && Math.abs(visualBottom - nodeBottom) <= toleranceY;
}

function getVisualFillValue(visualNode) {
  if (!visualNode?.fill) {
    return '';
  }

  if (visualNode.opacity !== undefined && visualNode.opacity < 0.999) {
    return applyOpacityToColor(visualNode.fill, visualNode.opacity) || visualNode.fill;
  }

  return visualNode.fill;
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

function canRenderShapeAsPureBox(node) {
  if (node.renderStrategy !== 'shape' || !node.pathData?.components?.length) {
    return false;
  }

  if (node.pathData.hasComplexGeometry) {
    return false;
  }

  const originType = node.pathData.originType || node.shapeType;
  if (!originType) {
    return false;
  }

  if (node.stroke && !['rectangle', 'ellipse'].includes(originType)) {
    return false;
  }

  return ['rectangle', 'ellipse'].includes(originType) || node.borderRadius !== undefined;
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

  if (isTransparentLeaf(node)) {
    return '';
  }

  if (isUnresolvedBitmapLayer(node)) {
    return renderBitmapFallback(node, offsetX, offsetY, mode);
  }

  if (node.renderStrategy === 'asset' && node.assetUrl) {
    return `<div class="layer asset" ${layerAttrs(node)} style="${boxStyles(node, { offsetX, offsetY, mode })}"><img src="${node.assetUrl}" style="width:100%;height:100%;display:block;object-fit:fill;pointer-events:none;" /></div>`;
  }

  if (node.text) {
    return `<div class="layer text" ${layerAttrs(node)} style="${textContainerStyles(node, offsetX, offsetY, mode)}">${renderTextContent(node)}</div>`;
  }

  if (node.renderStrategy === 'shape' && node.pathData?.components?.length) {
    if (canRenderShapeAsPureBox(node)) {
      const wrapperStyle = [
        boxStyles(node, { offsetX, offsetY, mode }),
        shapeClipStyles(node, node.bounds),
      ].filter(Boolean).join(';');

      return `<div class="layer shape" ${layerAttrs(node)} style="${wrapperStyle}"></div>`;
    }

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

    return `<div class="layer shape" ${layerAttrs(node)} style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pathBounds.width} ${pathBounds.height}" style="${svgStyle};pointer-events:none;"><path d="${svgPathForNode(node)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-rule="evenodd" /></svg></div>`;
  }

  if (!hasVisual(node)) {
    return '';
  }

  return `<div class="layer ${node.type}" ${layerAttrs(node)} style="${boxStyles(node, { offsetX, offsetY, mode })}"></div>`;
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
    return `<div class="layer bitmap-fallback avatar" ${layerAttrs(node)} style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="width:100%;height:100%;display:block;pointer-events:none;"><circle cx="24" cy="17" r="8" fill="${iconColor}" /><path d="M10 39c1.8-8.2 8.1-12.3 14-12.3S36.2 30.8 38 39" fill="${iconColor}" /></svg></div>`;
  }

  if (node.name === '我的') {
    const wrapperStyle = boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      includeVisual: false,
    });
    const iconColor = '#c6c6c6';
    return `<div class="layer bitmap-fallback profile" ${layerAttrs(node)} style="${wrapperStyle}"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style="width:100%;height:100%;display:block;pointer-events:none;"><circle cx="24" cy="18" r="8" fill="${iconColor}" /><path d="M11 39c1.7-7.7 7.7-11.5 13-11.5S35.3 31.3 37 39" fill="${iconColor}" /></svg></div>`;
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

    return `<div class="layer bitmap-fallback status-bar" ${layerAttrs(node)} style="${wrapperStyle}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:8px;letter-spacing:-1px">●●●●●</span>
        <span>${escapeHtml(statusAppLabel)}</span>
      </div>
      <div>${escapeHtml(statusTimeLabel)}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span>100%</span>
        <span style="display:inline-flex;align-items:center;gap:2px">
          <span style="display:inline-flex;width:24px;height:11px;border:1.5px solid #111827;border-radius:2px;box-sizing:border-box;padding:1px">
            <span style="display:block;width:15px;height:100%;background:#111827;border-radius:1px"></span>
          </span>
          <span style="display:inline-block;width:2px;height:5px;background:#111827;border-radius:0 1px 1px 0"></span>
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
  return {
    children: node.children || [],
    visualNode: getContainerVisualNode(node),
  };
}

function simpleContainerContentLayout(node, children) {
  if (children.length !== 1) {
    return null;
  }

  const [child] = children;
  if (!isRenderable(child) || child.clip?.isMask || child.clip?.clipped) {
    return null;
  }

  const padding = {
    top: Number((child.bounds.y - node.bounds.y).toFixed(2)),
    right: Number((node.bounds.x + node.bounds.width - (child.bounds.x + child.bounds.width)).toFixed(2)),
    bottom: Number((node.bounds.y + node.bounds.height - (child.bounds.y + child.bounds.height)).toFixed(2)),
    left: Number((child.bounds.x - node.bounds.x).toFixed(2)),
  };
  const centeredX = Math.abs(
    (child.bounds.x + child.bounds.width / 2) - (node.bounds.x + node.bounds.width / 2),
  ) <= Math.max(2, node.bounds.width * 0.03);
  const centeredY = Math.abs(
    (child.bounds.y + child.bounds.height / 2) - (node.bounds.y + node.bounds.height / 2),
  ) <= Math.max(2, node.bounds.height * 0.08);

  if (centeredX && centeredY) {
    return {
      wrapperStyles: [
        'display:flex',
        'justify-content:center',
        'align-items:center',
        'box-sizing:border-box',
      ],
      childrenHtml: renderFlowNode(child),
    };
  }

  if (padding.top < 0 || padding.right < 0 || padding.bottom < 0 || padding.left < 0) {
    return null;
  }

  return {
    wrapperStyles: [
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      `padding:${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`,
      'box-sizing:border-box',
    ],
    childrenHtml: renderFlowNode(child),
  };
}

function isDetachedBackgroundCandidate(node, child) {
  if (
    !isRenderable(child)
    || child.text
    || child.clip?.isMask
    || child.clip?.clipped
    || child.children?.length
    || !hasOwnVisual(child)
  ) {
    return false;
  }

  const widthCoverage = child.bounds.width / Math.max(node.bounds.width, 1);
  const heightCoverage = child.bounds.height / Math.max(node.bounds.height, 1);
  const leftDelta = Math.abs(child.bounds.x - node.bounds.x);
  const rightDelta = Math.abs((child.bounds.x + child.bounds.width) - (node.bounds.x + node.bounds.width));
  const topDelta = Math.abs(child.bounds.y - node.bounds.y);
  const bottomDelta = Math.abs((child.bounds.y + child.bounds.height) - (node.bounds.y + node.bounds.height));

  return widthCoverage >= 0.92
    && heightCoverage >= 0.72
    && leftDelta <= Math.max(4, node.bounds.width * 0.03)
    && rightDelta <= Math.max(4, node.bounds.width * 0.03)
    && (topDelta <= Math.max(6, node.bounds.height * 0.04) || bottomDelta <= Math.max(4, node.bounds.height * 0.03));
}

function getRelativeOffsets(node, child) {
  return {
    top: Number((child.bounds.y - node.bounds.y).toFixed(2)),
    right: Number((node.bounds.x + node.bounds.width - (child.bounds.x + child.bounds.width)).toFixed(2)),
    bottom: Number((node.bounds.y + node.bounds.height - (child.bounds.y + child.bounds.height)).toFixed(2)),
    left: Number((child.bounds.x - node.bounds.x).toFixed(2)),
  };
}

function buildGridOverlayChild(contentClassName, margin, html) {
  const styles = [
    'grid-area:1 / 1',
    'align-self:start',
    'justify-self:start',
  ];

  if (Math.abs(margin.top) > 0.01 || Math.abs(margin.left) > 0.01) {
    styles.push(`margin:${margin.top}px 0 0 ${margin.left}px`);
  }

  return `<div class="${contentClassName}" style="${styles.join(';')}">${html}</div>`;
}

function canUseDetachedGridOverlay(node, visualNode, contentNode, visualOffset, contentOffset) {
  if (
    visualOffset.top < 0
    || visualOffset.right < 0
    || visualOffset.bottom < 0
    || visualOffset.left < 0
    || contentOffset.top < 0
    || contentOffset.right < 0
    || contentOffset.bottom < 0
    || contentOffset.left < 0
  ) {
    return false;
  }

  const overlapX = Math.min(
    visualNode.bounds.x + visualNode.bounds.width,
    contentNode.bounds.x + contentNode.bounds.width,
  ) - Math.max(visualNode.bounds.x, contentNode.bounds.x);
  const overlapY = Math.min(
    visualNode.bounds.y + visualNode.bounds.height,
    contentNode.bounds.y + contentNode.bounds.height,
  ) - Math.max(visualNode.bounds.y, contentNode.bounds.y);

  return overlapX > Math.min(24, Math.min(visualNode.bounds.width, contentNode.bounds.width) * 0.4)
    && overlapY > Math.min(24, Math.min(visualNode.bounds.height, contentNode.bounds.height) * 0.4)
    && (Math.abs(visualOffset.top - contentOffset.top) > 2 || Math.abs(visualOffset.left - contentOffset.left) > 2)
    && !node.clip?.isMask;
}

function detachedContainerContentLayout(node, children, insideMask = false) {
  const backgroundCandidates = children.filter(child => isDetachedBackgroundCandidate(node, child));
  if (backgroundCandidates.length !== 1) {
    return null;
  }

  const [visualNode] = backgroundCandidates;
  const contentChildren = children.filter(child => child.id !== visualNode.id && isRenderable(child));
  if (contentChildren.length !== 1) {
    return null;
  }

  const [contentNode] = contentChildren;
  if (contentNode.clip?.isMask || contentNode.clip?.clipped) {
    return null;
  }

  const padding = getRelativeOffsets(node, contentNode);
  const visualOffset = getRelativeOffsets(node, visualNode);

  if (padding.top < 0 || padding.right < 0 || padding.bottom < 0 || padding.left < 0) {
    return null;
  }

  if (canUseDetachedGridOverlay(node, visualNode, contentNode, visualOffset, padding)) {
    return {
      childrenHtml: [
        buildGridOverlayChild(
          'layout-overlay-grid',
          visualOffset,
          renderNode(visualNode, 0, 0, 'flow', insideMask),
        ),
        buildGridOverlayChild(
          'layout-content-grid',
          padding,
          renderFlowNode(contentNode),
        ),
      ].join(''),
      wrapperStyles: [
        'display:grid',
        'grid-template-columns:minmax(0, 1fr)',
        'grid-template-rows:minmax(0, 1fr)',
        'box-sizing:border-box',
      ],
      overlayHtml: renderNode(visualNode, node.bounds.x, node.bounds.y, 'absolute', insideMask),
    };
  }

  return {
    childrenHtml: `${renderNode(visualNode, node.bounds.x, node.bounds.y, 'absolute', insideMask)}${renderFlowNode(contentNode)}`,
    overlayHtml: renderNode(visualNode, node.bounds.x, node.bounds.y, 'absolute', insideMask),
    flowHtml: renderFlowNode(contentNode),
    wrapperStyles: [
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      `padding:${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`,
      'box-sizing:border-box',
    ],
  };
}

function singleChildFlowLayout(node, children) {
  const renderableChildren = children.filter(child => (
    isRenderable(child)
    && !child.clip?.isMask
    && !child.clip?.clipped
    && (hasVisual(child) || child.layoutHint || child.children?.length || child.text)
  ));
  if (renderableChildren.length !== 1) {
    return null;
  }

  const [child] = renderableChildren;
  if (!child.layoutHint && !child.children?.length && !child.text) {
    return null;
  }

  const padding = {
    top: Number((child.bounds.y - node.bounds.y).toFixed(2)),
    right: Number((node.bounds.x + node.bounds.width - (child.bounds.x + child.bounds.width)).toFixed(2)),
    bottom: Number((node.bounds.y + node.bounds.height - (child.bounds.y + child.bounds.height)).toFixed(2)),
    left: Number((child.bounds.x - node.bounds.x).toFixed(2)),
  };
  const widthCoverage = child.bounds.width / Math.max(node.bounds.width, 1);
  const heightCoverage = child.bounds.height / Math.max(node.bounds.height, 1);

  if (
    padding.top < 0
    || padding.right < 0
    || padding.bottom < 0
    || padding.left < 0
    || widthCoverage < 0.82
    || heightCoverage < 0.82
  ) {
    return null;
  }

  return {
    wrapperStyles: [
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      `padding:${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`,
      'box-sizing:border-box',
    ],
    childrenHtml: renderFlowNode(child),
  };
}

function isSimpleMaskPair(maskNode, targetNode) {
  if (
    !maskNode
    || !targetNode
    || !maskNode.clip?.isMask
    || !maskNode.clip.targetIds?.includes(targetNode.id)
    || targetNode.clip?.maskId !== maskNode.id
    || !isRenderable(maskNode)
    || !isRenderable(targetNode)
    || targetNode.children?.length
  ) {
    return false;
  }

  const maxDimension = Math.max(maskNode.bounds.width, maskNode.bounds.height);
  if (maxDimension > 80) {
    return false;
  }

  const tolerance = 1.5;
  return Math.abs(maskNode.bounds.x - targetNode.bounds.x) <= tolerance
    && Math.abs(maskNode.bounds.y - targetNode.bounds.y) <= tolerance
    && Math.abs(maskNode.bounds.width - targetNode.bounds.width) <= tolerance
    && Math.abs(maskNode.bounds.height - targetNode.bounds.height) <= tolerance;
}

function simpleMaskedGroupLayout(node, children) {
  const visibleChildren = children.filter(child => !isTransparentLeaf(child));
  if (visibleChildren.length !== 2) {
    return null;
  }

  const maskNode = visibleChildren.find(child => child.clip?.isMask && child.clip.targetIds?.length === 1);
  if (!maskNode) {
    return null;
  }

  const targetNode = visibleChildren.find(child => child.id === maskNode.clip.targetIds[0]);
  if (!isSimpleMaskPair(maskNode, targetNode)) {
    return null;
  }

  return {
    visualNode: maskNode,
    forceClip: true,
    extraAttrs: `data-mask-source-id="${maskNode.id}"`,
    wrapperStyles: [
      shapeClipStyles(maskNode, node.bounds),
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      'box-sizing:border-box',
    ],
    childrenHtml: renderNode(targetNode, maskNode.bounds.x, maskNode.bounds.y, 'flow', true),
  };
}

function renderContainer(node, offsetX = 0, offsetY = 0, mode = 'absolute', insideMask = false) {
  const { children, visualNode } = getContainerChildren(node);
  const embeddedVisualNode = canEmbedVisualNode(node, visualNode) ? visualNode : undefined;
  const contentChildren = embeddedVisualNode
    ? children.filter(child => child.id !== embeddedVisualNode.id)
    : children;
  const simpleFlow = embeddedVisualNode ? simpleContainerContentLayout(node, contentChildren) : null;
  const detachedFlow = !simpleFlow ? detachedContainerContentLayout(node, contentChildren, insideMask) : null;
  const maskedFlow = !simpleFlow && !detachedFlow ? simpleMaskedGroupLayout(node, contentChildren) : null;
  const singleFlow = !simpleFlow && !detachedFlow && !maskedFlow ? singleChildFlowLayout(node, contentChildren) : null;
  const wrapperVisualNode = embeddedVisualNode || maskedFlow?.visualNode || node;
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      forceClip: Boolean(maskedFlow?.forceClip),
      visualNode: wrapperVisualNode,
    }),
    embeddedVisualNode ? shapeClipStyles(embeddedVisualNode, node.bounds) : '',
    simpleFlow ? simpleFlow.wrapperStyles.join(';') : '',
    detachedFlow ? detachedFlow.wrapperStyles.join(';') : '',
    maskedFlow ? maskedFlow.wrapperStyles.join(';') : '',
    singleFlow ? singleFlow.wrapperStyles.join(';') : '',
  ].filter(Boolean).join(';');
  const childrenHtml = contentChildren.length > 0 && node.shouldRenderChildren !== false
    ? simpleFlow
      ? simpleFlow.childrenHtml
      : detachedFlow
        ? (detachedFlow.childrenHtml || `${detachedFlow.overlayHtml}${detachedFlow.flowHtml}`)
        : maskedFlow
          ? maskedFlow.childrenHtml
          : singleFlow
          ? singleFlow.childrenHtml
          : renderLayerList(contentChildren, node.bounds.x, node.bounds.y, 'absolute', insideMask)
    : detachedFlow?.overlayHtml || detachedFlow?.childrenHtml || '';
  return `<div class="layer container" ${layerAttrs(node)} ${maskedFlow?.extraAttrs || ''} style="${wrapperStyle}">${childrenHtml}</div>`;
}

function flexLayoutStyles(node, mode = 'absolute') {
  const layout = node.layoutHint;
  if (!layout) {
    return '';
  }

  const inlineFlow = mode === 'flow'
    && (node.sizeHint?.width === 'content' || node.sizeHint?.height === 'content');
  const styles = [
    `display:${inlineFlow ? 'inline-flex' : 'flex'}`,
    `flex-direction:${layout.mode === 'flex-row' ? 'row' : 'column'}`,
    `justify-content:${toFlexJustify(layout.justifyContent)}`,
    `align-items:${toFlexAlign(layout.alignItems)}`,
    `gap:${layout.lines?.length ? 0 : layout.gap || 0}px`,
    'box-sizing:border-box',
  ];

  if (layout.padding) {
    styles.push(`padding:${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`);
  }

  return styles.join(';');
}

function toFlexJustify(value) {
  return value === 'space-between'
    ? 'space-between'
    : value === 'center'
      ? 'center'
      : value === 'end'
        ? 'flex-end'
        : 'flex-start';
}

function toFlexAlign(value) {
  return value === 'center'
    ? 'center'
    : value === 'end'
      ? 'flex-end'
      : value === 'stretch'
        ? 'stretch'
        : 'flex-start';
}

function renderLayoutLines(node) {
  const layout = node.layoutHint;
  const lines = layout?.lines || [];
  const contentBounds = layout?.contentBounds || node.bounds;

  return lines.map((line, index) => {
    const items = (line.itemIds || []).map(id => nodesById.get(id)).filter(Boolean);
    if (items.length === 0) {
      return '';
    }

    const previousLine = index > 0 ? lines[index - 1] : null;
    const marginTop = previousLine
      ? line.bounds.y - (previousLine.bounds.y + previousLine.bounds.height)
      : 0;
    const marginLeft = line.bounds.x - contentBounds.x;
    const styles = [
      'position:relative',
      'flex:0 0 auto',
      items.length > 1 ? 'display:flex' : 'display:block',
      items.length > 1 ? 'flex-direction:row' : '',
      items.length > 1 ? `justify-content:${toFlexJustify(line.justifyContent)}` : '',
      items.length > 1 ? `align-items:${toFlexAlign(line.alignItems)}` : '',
      items.length > 1 ? `gap:${line.gap || 0}px` : '',
      'box-sizing:border-box',
    ];

    if (Math.abs(marginTop) > 0.01) {
      styles.push(`margin-top:${marginTop}px`);
    }
    if (Math.abs(marginLeft) > 0.01) {
      styles.push(`margin-left:${marginLeft}px`);
    }

    if (items.length > 1) {
      styles.push(`width:${contentBounds.width}px`);
    } else if (!(items[0].sizeHint?.width === 'content')) {
      styles.push(`width:${line.bounds.width}px`);
    }

    const lineHtml = items.map(child => renderFlowNode(child)).join('\n');
    return `<div class="layout-line" style="${styles.filter(Boolean).join(';')}">${lineHtml}</div>`;
  }).join('\n');
}

function renderFlowNode(node) {
  if (!isRenderable(node)) {
    return '';
  }

  if (isTransparentLeaf(node)) {
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
  const embeddedVisualNode = canEmbedVisualNode(node, visualNode) ? visualNode : undefined;
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      forceClip: false,
      visualNode: embeddedVisualNode || node,
    }),
    embeddedVisualNode ? shapeClipStyles(embeddedVisualNode, node.bounds) : '',
    flexLayoutStyles(node, mode),
  ].join(';');
  const overlayHtml = overlays
    .filter(child => child.id !== embeddedVisualNode?.id)
    .map(child => renderNode(child, node.bounds.x, node.bounds.y, 'absolute', false))
    .join('\n');
  const flowHtml = node.layoutHint?.lines?.length
    ? renderLayoutLines(node)
    : items.map(child => renderFlowNode(child)).join('\n');

  return `<div class="layer flex-node" ${layerAttrs(node)} style="${wrapperStyle}">${overlayHtml}${flowHtml}</div>`;
}

function renderMaskGroup(maskNode, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const targets = (maskNode.clip?.targetIds || [])
    .map(id => nodesById.get(id))
    .filter(Boolean);
  const simpleTarget = targets.length === 1 && isSimpleMaskPair(maskNode, targets[0])
    ? targets[0]
    : null;

  if (simpleTarget) {
    const wrapperStyles = [
      boxStyles(maskNode, {
        offsetX,
        offsetY,
        mode,
        forceClip: true,
      }),
      shapeClipStyles(maskNode, maskNode.bounds),
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      'box-sizing:border-box',
    ].filter(Boolean).join(';');
    const childHtml = renderNode(simpleTarget, maskNode.bounds.x, maskNode.bounds.y, 'flow', true);
    return `<div class="layer mask" ${layerAttrs(maskNode)} style="${wrapperStyles}">${childHtml}</div>`;
  }

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

  return `${ownMask}<div class="layer mask" ${layerAttrs(maskNode)} style="${wrapperStyles}">${childrenHtml}</div>`;
}

function renderNode(node, offsetX = 0, offsetY = 0, mode = 'absolute', insideMask = false) {
  if (!isRenderable(node)) {
    return '';
  }

  if (isTransparentLeaf(node)) {
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
    .text { -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; user-select: text; }
    #artboard img, #artboard svg, #artboard path { pointer-events: none; }
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

let compare = null;
if (referenceImageUrl || referenceImagePath) {
  const compareParams = {
    candidateImagePath: screenshotPath,
    diffOutputPath: diffPath,
    resizeCandidate: true,
    mismatchThreshold: 0.08,
    gridRows: 8,
    gridCols: 4,
  };

  if (referenceImageUrl) {
    compare = await imageCompareService.compare({
      ...compareParams,
      referenceImageUrl,
    });
  } else {
    compare = await imageCompareService.compare({
      ...compareParams,
      referenceImagePath,
    });
  }
}

const result = {
  source: sourceMeta,
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
