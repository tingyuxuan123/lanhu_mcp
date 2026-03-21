import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { AssetLocalizer } from '../dist/services/asset-localizer.js';
import { LanhuClient } from '../dist/services/lanhu-client.js';
import { LanhuParser } from '../dist/services/lanhu-parser.js';
import { imageCompareService } from '../dist/services/image-compare.js';
import { buildAssetPublicPath } from '../dist/utils/asset-localization.js';
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
const localAssetDirName = `${outputPrefix}-assets`;
const localAssetDir = path.join(outputDir, localAssetDirName);
const statusTimeLabel = process.env.SAMPLE_STATUS_TIME || '1:21 AM';
const statusAppLabel = process.env.SAMPLE_STATUS_APP || 'WeChat';

await fs.mkdir(outputDir, { recursive: true });

if (pageUrl && !cookie) {
  throw new Error('LANHU_COOKIE is required when LANHU_PAGE_URL is provided');
}

let document;
let sourceMeta;
let referenceImageUrl = directReferenceImageUrl;
let lanhuClient = cookie ? new LanhuClient(cookie) : null;

if (pageUrl) {
  const imageInfo = await lanhuClient.getImageInfo(parseLanhuUrl(pageUrl));
  const latestVersion = lanhuClient.getLatestVersion(imageInfo);
  document = await lanhuClient.fetchSketchJson(latestVersion.json_url);
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
const assets = parser.extractAssets(parsed, {
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

const localizedAssets = await localizeAssetUrls(layers, assets);

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

const styleRegistry = new Map();
const styleClassCounters = new Map();

function normalizeStyle(style = '') {
  return String(style)
    .split(';')
    .map(item => item.trim())
    .filter(Boolean)
    .join(';');
}

function sanitizeClassPrefix(prefix = 'node') {
  const normalized = String(prefix)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'node';
}

function registerStyleClass(prefix, style) {
  const normalizedStyle = normalizeStyle(style);
  if (!normalizedStyle) {
    return '';
  }

  const safePrefix = sanitizeClassPrefix(prefix);
  const registryKey = `${safePrefix}::${normalizedStyle}`;
  const existing = styleRegistry.get(registryKey);
  if (existing) {
    return existing.className;
  }

  const nextCount = (styleClassCounters.get(safePrefix) || 0) + 1;
  styleClassCounters.set(safePrefix, nextCount);

  const className = `${safePrefix}-${nextCount}`;
  styleRegistry.set(registryKey, {
    className,
    style: normalizedStyle,
  });

  return className;
}

function joinClassNames(...values) {
  const result = [];
  const seen = new Set();

  for (const value of values) {
    if (!value) {
      continue;
    }

    const parts = Array.isArray(value)
      ? value
      : String(value).split(/\s+/);

    for (const part of parts) {
      const token = String(part || '').trim();
      if (!token || seen.has(token)) {
        continue;
      }

      seen.add(token);
      result.push(token);
    }
  }

  return result.join(' ');
}

function renderClassAttr(baseClasses, stylePrefix, style) {
  const classes = joinClassNames(baseClasses, registerStyleClass(stylePrefix, style));
  return classes ? `class="${classes}"` : '';
}

function renderGeneratedCss() {
  return [...styleRegistry.values()]
    .map(({ className, style }) => `    .${className} { ${style}${style.endsWith(';') ? '' : ';'} }`)
    .join('\n');
}

async function localizeAssetUrls(nodes, assetSummaries = []) {
  const downloader = lanhuClient
    ? sourceUrl => lanhuClient.fetchBinaryWithMetadata(sourceUrl)
    : undefined;
  const localizer = downloader ? new AssetLocalizer(downloader) : new AssetLocalizer();

  return localizer.localize(nodes, assetSummaries, {
    outputDir: localAssetDir,
    publicPathPrefix: buildAssetPublicPath(localAssetDir),
  });
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
  positionContext = false,
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
    if (positionContext) {
      styles.push('position:relative');
    }
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

function assetWrapperStyles(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const styles = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      includeVisual: false,
    }),
  ];

  const radius = radiusValue(node);
  if (radius) {
    styles.push(`border-radius:${radius}`);
    styles.push('overflow:hidden');
  }

  return styles.filter(Boolean).join(';');
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

  const originType = String(node.pathData.originType || node.shapeType || '').trim();
  if (!originType) {
    return false;
  }

  const normalizedShapeType = originType.toLowerCase();
  const isRectLike = ['rect', 'rectangle', 'roundedrect'].includes(normalizedShapeType);
  const isEllipseLike = ['ellipse', 'oval', 'circle'].includes(normalizedShapeType);

  if (node.stroke && !isRectLike && !isEllipseLike) {
    return false;
  }

  return isRectLike || isEllipseLike;
}

function getEllipseComponentBounds(component) {
  const bounds = component?.originBounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const originType = String(component.originType || '').trim().toLowerCase();
  if (!['ellipse', 'oval', 'circle'].includes(originType)) {
    return null;
  }

  return bounds;
}

function getBoundsCenter(bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function getEllipseDotsLayout(node) {
  const components = node.pathData?.components || [];
  if (components.length < 2) {
    return null;
  }

  const ellipses = components
    .filter(component => component.operation === 'add')
    .map(component => getEllipseComponentBounds(component))
    .filter(Boolean);

  if (ellipses.length !== components.length) {
    return null;
  }

  const sorted = [...ellipses].sort((left, right) => left.x - right.x);
  const baselineY = getBoundsCenter(sorted[0]).y;
  const aligned = sorted.every(bounds => Math.abs(getBoundsCenter(bounds).y - baselineY) <= 1.5);
  if (!aligned) {
    return null;
  }

  const nonOverlapping = sorted.every((bounds, index) => (
    index === 0 || bounds.x >= sorted[index - 1].x + sorted[index - 1].width - 1
  ));
  if (!nonOverlapping) {
    return null;
  }

  return sorted;
}

function getEllipseRingLayout(node) {
  const components = node.pathData?.components || [];
  if (components.length !== 3) {
    return null;
  }

  const [outer, inner, center] = components;
  if (outer.operation !== 'add' || inner.operation !== 'subtract' || center.operation !== 'add') {
    return null;
  }

  const outerBounds = getEllipseComponentBounds(outer);
  const innerBounds = getEllipseComponentBounds(inner);
  const centerBounds = getEllipseComponentBounds(center);
  if (!outerBounds || !innerBounds || !centerBounds) {
    return null;
  }

  const outerCenter = getBoundsCenter(outerBounds);
  const innerCenter = getBoundsCenter(innerBounds);
  const centerDot = getBoundsCenter(centerBounds);
  const ringAligned = Math.abs(outerCenter.x - innerCenter.x) <= 1.5
    && Math.abs(outerCenter.y - innerCenter.y) <= 1.5
    && Math.abs(outerCenter.x - centerDot.x) <= 1.5
    && Math.abs(outerCenter.y - centerDot.y) <= 1.5;

  if (!ringAligned) {
    return null;
  }

  const ringThicknessX = (outerBounds.width - innerBounds.width) / 2;
  const ringThicknessY = (outerBounds.height - innerBounds.height) / 2;
  if (ringThicknessX <= 0 || ringThicknessY <= 0) {
    return null;
  }

  return {
    ringThickness: Number(Math.max(1, Math.min(ringThicknessX, ringThicknessY)).toFixed(2)),
    centerBounds,
  };
}

function renderEllipseDotsShape(node, ellipseBounds, offsetX = 0, offsetY = 0, mode = 'absolute', className = 'shape') {
  const wrapperStyle = [
    boxStyles(node, { offsetX, offsetY, mode, includeVisual: false }),
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
  ].join(';');
  const fill = node.fill || '#000000';
  const dotsHtml = ellipseBounds.map(bounds => {
    const dotStyle = [
      `width:${bounds.width}px`,
      `height:${bounds.height}px`,
      `background:${fill}`,
      'border-radius:9999px',
      'flex:0 0 auto',
    ].join(';');

    return `<span ${renderClassAttr('shape-dot', 'shape-dot', dotStyle)}></span>`;
  }).join('');

  return `<div ${renderClassAttr(`layer ${className}`, `${className}-layer`, wrapperStyle)} ${layerAttrs(node)}>${dotsHtml}</div>`;
}

function renderEllipseRingShape(node, ringLayout, offsetX = 0, offsetY = 0, mode = 'absolute', className = 'shape') {
  const fill = node.fill || '#000000';
  const wrapperStyle = [
    boxStyles(node, { offsetX, offsetY, mode, includeVisual: false }),
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `border:${ringLayout.ringThickness}px solid ${fill}`,
    'border-radius:9999px',
    'box-sizing:border-box',
    'background:transparent',
  ].join(';');
  const dotStyle = [
    `width:${ringLayout.centerBounds.width}px`,
    `height:${ringLayout.centerBounds.height}px`,
    `background:${fill}`,
    'border-radius:9999px',
    'flex:0 0 auto',
  ].join(';');

  return `<div ${renderClassAttr(`layer ${className}`, `${className}-layer`, wrapperStyle)} ${layerAttrs(node)}><span ${renderClassAttr('shape-dot center-dot', 'shape-dot', dotStyle)}></span></div>`;
}

function isSmallIconLikeNode(node) {
  const maxDimension = Math.max(node.bounds.width, node.bounds.height);
  const area = node.bounds.width * node.bounds.height;
  return maxDimension <= 48 && area <= 2304;
}

function hasRenderableVectorChildren(node) {
  const children = (node.children || []).filter(child => isRenderable(child) && !isTransparentLeaf(child));
  if (children.length === 0) {
    return false;
  }

  return children.every(child => (
    Boolean(child.text)
    || Boolean(child.pathData?.components?.length)
    || Boolean(child.children?.length)
    || Boolean(child.fill)
    || Boolean(child.stroke)
    || Boolean(child.assetUrl)
  ));
}

function shouldRenderAssetAsVector(node) {
  if (node.renderStrategy !== 'asset' || !isSmallIconLikeNode(node)) {
    return false;
  }

  if (node.assetUrl) {
    return false;
  }

  if (node.pathData?.components?.length) {
    return true;
  }

  return hasRenderableVectorChildren(node);
}

function simpleAssetChildrenFlowLayout(node, children) {
  if (children.length < 2) {
    return null;
  }

  const sortedByY = [...children].sort((left, right) => left.bounds.y - right.bounds.y);
  const alignedLeft = sortedByY.every(child => Math.abs(child.bounds.x - sortedByY[0].bounds.x) <= 1.5);
  const alignedWidth = sortedByY.every(child => Math.abs(child.bounds.width - sortedByY[0].bounds.width) <= 1.5);
  const nonOverlappingY = sortedByY.every((child, index) => {
    if (index === 0) {
      return true;
    }

    const previous = sortedByY[index - 1];
    return child.bounds.y >= previous.bounds.y + previous.bounds.height - 1;
  });

  if (!alignedLeft || !alignedWidth || !nonOverlappingY) {
    return null;
  }

  const childrenHtml = sortedByY.map((child, index) => {
    const previous = index > 0 ? sortedByY[index - 1] : null;
    const marginTop = previous
      ? Number((child.bounds.y - (previous.bounds.y + previous.bounds.height)).toFixed(2))
      : 0;
    const wrapperStyles = [
      'flex:0 0 auto',
      marginTop > 0 ? `margin-top:${marginTop}px` : '',
    ].filter(Boolean).join(';');

    return `<div ${renderClassAttr('asset-child-flow', 'asset-child-flow', wrapperStyles)}>${renderNode(child, 0, 0, 'flow', false)}</div>`;
  }).join('');

  return {
    wrapperStyles: [
      'display:flex',
      'flex-direction:column',
      'justify-content:flex-start',
      'align-items:flex-start',
      'box-sizing:border-box',
    ],
    childrenHtml,
  };
}

function centeredAssetChildrenFlowLayout(node, children) {
  if (children.length !== 2) {
    return null;
  }

  const sortedByArea = [...children].sort((left, right) => (
    right.bounds.width * right.bounds.height
  ) - (
    left.bounds.width * left.bounds.height
  ));
  const [backgroundNode, foregroundNode] = sortedByArea;
  const coverageX = backgroundNode.bounds.width / Math.max(node.bounds.width, 1);
  const coverageY = backgroundNode.bounds.height / Math.max(node.bounds.height, 1);
  const backgroundCloseToFrame = Math.abs(backgroundNode.bounds.x - node.bounds.x) <= 2
    && Math.abs(backgroundNode.bounds.y - node.bounds.y) <= 2
    && Math.abs((backgroundNode.bounds.x + backgroundNode.bounds.width) - (node.bounds.x + node.bounds.width)) <= 2
    && Math.abs((backgroundNode.bounds.y + backgroundNode.bounds.height) - (node.bounds.y + node.bounds.height)) <= 2;
  const centeredX = Math.abs(
    (foregroundNode.bounds.x + foregroundNode.bounds.width / 2)
    - (backgroundNode.bounds.x + backgroundNode.bounds.width / 2),
  ) <= Math.max(2, backgroundNode.bounds.width * 0.08);
  const centeredY = Math.abs(
    (foregroundNode.bounds.y + foregroundNode.bounds.height / 2)
    - (backgroundNode.bounds.y + backgroundNode.bounds.height / 2),
  ) <= Math.max(2, backgroundNode.bounds.height * 0.12);

  if (
    !backgroundCloseToFrame
    || coverageX < 0.9
    || coverageY < 0.9
    || !centeredX
    || !centeredY
    || !hasOwnVisual(backgroundNode)
  ) {
    return null;
  }

  return {
    visualNode: backgroundNode,
    wrapperStyles: [
      'display:flex',
      'justify-content:center',
      'align-items:center',
      'box-sizing:border-box',
    ],
    childrenHtml: renderFlowNode(foregroundNode),
  };
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
    const rangeClassAttr = renderClassAttr('text-range', 'text-range', stylesForRange(range));
    chunks.push(`<span${rangeClassAttr ? ` ${rangeClassAttr}` : ''}>${content}</span>`);
    cursor = range.to;
  }
  if (cursor < text.length) {
    chunks.push(escapeHtml(text.slice(cursor)));
  }
  return chunks.join('');
}

function renderShapeNode(node, offsetX = 0, offsetY = 0, mode = 'absolute', className = 'shape') {
  if (canRenderShapeAsPureBox(node)) {
    const wrapperStyle = boxStyles(node, { offsetX, offsetY, mode });

    return `<div ${renderClassAttr(`layer ${className}`, `${className}-layer`, wrapperStyle)} ${layerAttrs(node)}></div>`;
  }

  const ellipseDotsLayout = getEllipseDotsLayout(node);
  if (ellipseDotsLayout) {
    return renderEllipseDotsShape(node, ellipseDotsLayout, offsetX, offsetY, mode, className);
  }

  const ellipseRingLayout = getEllipseRingLayout(node);
  if (ellipseRingLayout) {
    return renderEllipseRingShape(node, ellipseRingLayout, offsetX, offsetY, mode, className);
  }

  const pathBounds = node.pathData.pathBounds || node.bounds;
  const wrapperStyle = [
    boxStyles(node, { offsetX, offsetY, mode }),
    shapeClipStyles(node, node.bounds),
  ].filter(Boolean).join(';');
  const svgStyle = [
    'display:block',
    `width:${pathBounds.width}px`,
    `height:${pathBounds.height}px`,
    'overflow:visible',
    (pathBounds.x !== node.bounds.x || pathBounds.y !== node.bounds.y)
      ? `transform:translate(${pathBounds.x - node.bounds.x}px, ${pathBounds.y - node.bounds.y}px)`
      : '',
    'transform-origin:top left',
  ].join(';');
  const fill = node.fill && !node.fill.startsWith('linear-gradient') && !node.fill.startsWith('radial-gradient')
    ? node.fill
    : 'transparent';
  const stroke = node.stroke?.color || 'none';
  const strokeWidth = node.stroke?.width || 0;

  const svgClassAttr = renderClassAttr('shape-svg', 'shape-svg', `${svgStyle};pointer-events:none`);

  return `<div ${renderClassAttr(`layer ${className}`, `${className}-layer`, wrapperStyle)} ${layerAttrs(node)}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pathBounds.width} ${pathBounds.height}" ${svgClassAttr}><path d="${svgPathForNode(node, pathBounds)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-rule="evenodd" /></svg></div>`;
}

function renderAssetVectorGroup(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  const children = (node.children || []).filter(child => isRenderable(child) && !isTransparentLeaf(child));
  if (children.length === 0) {
    return '';
  }

  const centeredLayout = centeredAssetChildrenFlowLayout(node, children);
  const flowLayout = simpleAssetChildrenFlowLayout(node, children);

  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      positionContext: mode === 'flow' && !flowLayout && !centeredLayout,
      includeVisual: Boolean(centeredLayout),
      visualNode: centeredLayout?.visualNode || node,
    }),
    centeredLayout?.visualNode ? shapeClipStyles(centeredLayout.visualNode, node.bounds) : '',
    centeredLayout ? centeredLayout.wrapperStyles.join(';') : '',
    flowLayout ? flowLayout.wrapperStyles.join(';') : '',
    'overflow:visible',
  ].filter(Boolean).join(';');

  const childrenHtml = centeredLayout
    ? centeredLayout.childrenHtml
    : flowLayout
    ? flowLayout.childrenHtml
    : renderLayerList(children, node.bounds.x, node.bounds.y, 'absolute', false);

  return `<div ${renderClassAttr('layer asset-vector', 'asset-vector', wrapperStyle)} ${layerAttrs(node)}>${childrenHtml}</div>`;
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

  if (node.assetUrl) {
    return `<div ${renderClassAttr('layer asset', 'asset-layer', assetWrapperStyles(node, offsetX, offsetY, mode))} ${layerAttrs(node)}><img src="${node.assetUrl}" ${renderClassAttr('asset-image', 'asset-image', 'width:100%;height:100%;display:block;object-fit:fill;pointer-events:none;background:transparent;border-radius:inherit')} /></div>`;
  }

  if (shouldRenderAssetAsVector(node)) {
    if (node.pathData?.components?.length) {
      return renderShapeNode(node, offsetX, offsetY, mode, 'asset-shape');
    }

    if (node.children?.length) {
      return renderAssetVectorGroup(node, offsetX, offsetY, mode);
    }
  }

  if (node.text) {
    return `<div ${renderClassAttr('layer text', 'text-layer', textContainerStyles(node, offsetX, offsetY, mode))} ${layerAttrs(node)}>${renderTextContent(node)}</div>`;
  }

  if (node.renderStrategy === 'shape' && node.pathData?.components?.length) {
    return renderShapeNode(node, offsetX, offsetY, mode);
  }

  if (!hasVisual(node)) {
    return '';
  }

  return `<div ${renderClassAttr(`layer ${node.type}`, `${node.type}-layer`, boxStyles(node, { offsetX, offsetY, mode }))} ${layerAttrs(node)}></div>`;
}

function renderBitmapFallback(node, offsetX = 0, offsetY = 0, mode = 'absolute') {
  if (/头像/.test(node.name || '')) {
    const wrapperStyle = [
      boxStyles(node, {
        offsetX,
        offsetY,
        mode,
        includeVisual: false,
      }),
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:4px',
    ].join(';');
    const iconColor = '#8e9cb3';
    const headStyle = [
      'width:16px',
      'height:16px',
      `background:${iconColor}`,
      'border-radius:9999px',
      'flex:0 0 auto',
    ].join(';');
    const bodyStyle = [
      'width:28px',
      'height:14px',
      `background:${iconColor}`,
      'border-radius:14px 14px 8px 8px',
      'flex:0 0 auto',
    ].join(';');

    return `<div ${renderClassAttr('layer bitmap-fallback avatar', 'avatar-fallback', wrapperStyle)} ${layerAttrs(node)}><span ${renderClassAttr('avatar-fallback-head', 'avatar-fallback-head', headStyle)}></span><span ${renderClassAttr('avatar-fallback-body', 'avatar-fallback-body', bodyStyle)}></span></div>`;
  }

  if (node.name === '我的') {
    const wrapperStyle = [
      boxStyles(node, {
        offsetX,
        offsetY,
        mode,
        includeVisual: false,
      }),
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:center',
      'gap:4px',
    ].join(';');
    const iconColor = '#c6c6c6';
    const headStyle = [
      'width:15px',
      'height:15px',
      `background:${iconColor}`,
      'border-radius:9999px',
      'flex:0 0 auto',
    ].join(';');
    const bodyStyle = [
      'width:26px',
      'height:13px',
      `background:${iconColor}`,
      'border-radius:13px 13px 8px 8px',
      'flex:0 0 auto',
    ].join(';');

    return `<div ${renderClassAttr('layer bitmap-fallback profile', 'profile-fallback', wrapperStyle)} ${layerAttrs(node)}><span ${renderClassAttr('profile-fallback-head', 'profile-fallback-head', headStyle)}></span><span ${renderClassAttr('profile-fallback-body', 'profile-fallback-body', bodyStyle)}></span></div>`;
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

    return `<div ${renderClassAttr('layer bitmap-fallback status-bar', 'status-bar', wrapperStyle)} ${layerAttrs(node)}>
      <div ${renderClassAttr('status-bar-left-group', 'status-bar-left-group', 'display:flex;align-items:center;gap:6px')}>
        <span ${renderClassAttr('status-bar-signal-dots', 'status-bar-signal-dots', 'font-size:8px;letter-spacing:-1px')}>●●●●●</span>
        <span>${escapeHtml(statusAppLabel)}</span>
      </div>
      <div>${escapeHtml(statusTimeLabel)}</div>
      <div ${renderClassAttr('status-bar-right-group', 'status-bar-right-group', 'display:flex;align-items:center;gap:6px')}>
        <span>100%</span>
        <span ${renderClassAttr('status-bar-battery', 'status-bar-battery', 'display:inline-flex;align-items:center;gap:2px')}>
          <span ${renderClassAttr('status-bar-battery-shell', 'status-bar-battery-shell', 'display:inline-flex;width:24px;height:11px;border:1.5px solid #111827;border-radius:2px;box-sizing:border-box;padding:1px')}>
            <span ${renderClassAttr('status-bar-battery-level', 'status-bar-battery-level', 'display:block;width:15px;height:100%;background:#111827;border-radius:1px')}></span>
          </span>
          <span ${renderClassAttr('status-bar-battery-cap', 'status-bar-battery-cap', 'display:inline-block;width:2px;height:5px;background:#111827;border-radius:0 1px 1px 0')}></span>
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

  return `<div ${renderClassAttr(contentClassName, contentClassName, styles.join(';'))}>${html}</div>`;
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
      usesAbsoluteLayout: false,
    };
  }

  return {
    childrenHtml: `${renderNode(visualNode, node.bounds.x, node.bounds.y, 'absolute', insideMask)}${renderFlowNode(contentNode)}`,
    wrapperStyles: [
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      `padding:${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px`,
      'box-sizing:border-box',
    ],
    usesAbsoluteLayout: true,
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
  if (!child.layoutHint && !child.children?.length && !child.text && !hasOwnVisual(child)) {
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
  const isIconSizedFlow = isSmallIconLikeNode(node) || isSmallIconLikeNode(child);
  const minWidthCoverage = isIconSizedFlow ? 0.6 : 0.82;
  const minHeightCoverage = isIconSizedFlow ? 0.2 : 0.82;

  if (
    padding.top < 0
    || padding.right < 0
    || padding.bottom < 0
    || padding.left < 0
    || widthCoverage < minWidthCoverage
    || heightCoverage < minHeightCoverage
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

function isBoundsInside(outerBounds, innerBounds, tolerance = 1.5) {
  return innerBounds.x >= outerBounds.x - tolerance
    && innerBounds.y >= outerBounds.y - tolerance
    && innerBounds.x + innerBounds.width <= outerBounds.x + outerBounds.width + tolerance
    && innerBounds.y + innerBounds.height <= outerBounds.y + outerBounds.height + tolerance;
}

function renderFlowWrapper(styles, html) {
  const style = styles.filter(Boolean).join(';');
  return `<div ${renderClassAttr('flow-wrapper', 'flow-wrapper', style)}>${html}</div>`;
}

function toggleControlFlowLayout(node, children) {
  if (children.length < 4 || children.length > 6 || node.bounds.height > 72) {
    return null;
  }

  const textChildren = children.filter(child => child.text);
  const shapeChildren = children.filter(child => !child.text && hasOwnVisual(child));
  if (textChildren.length < 2 || textChildren.length > 3 || shapeChildren.length < 2) {
    return null;
  }

  const trackNode = [...shapeChildren].sort((left, right) => right.bounds.width - left.bounds.width)[0];
  const activeNode = shapeChildren.find(child => (
    child.id !== trackNode.id
    && isBoundsInside(trackNode.bounds, child.bounds, 1.5)
    && Math.abs(child.bounds.y - trackNode.bounds.y) <= 2
    && Math.abs(child.bounds.height - trackNode.bounds.height) <= 2
    && child.bounds.width < trackNode.bounds.width
  ));

  if (
    !trackNode
    || !activeNode
    || trackNode.bounds.width < node.bounds.width * 0.45
    || trackNode.bounds.width >= node.bounds.width
    || !hasOwnVisual(trackNode)
    || !hasOwnVisual(activeNode)
  ) {
    return null;
  }

  const outerLabel = textChildren.find(child => child.bounds.x + child.bounds.width <= trackNode.bounds.x + 1.5);
  const innerTexts = textChildren.filter(child => isBoundsInside(trackNode.bounds, child.bounds, 1.5));
  const activeText = innerTexts.find(child => isBoundsInside(activeNode.bounds, child.bounds, 2));
  const inactiveText = innerTexts.find(child => child.id !== activeText?.id);
  if (!outerLabel || innerTexts.length === 0) {
    return null;
  }

  const outerLabelMarginLeft = Number((outerLabel.bounds.x - node.bounds.x).toFixed(2));
  const trackMarginLeft = Number((trackNode.bounds.x - (outerLabel.bounds.x + outerLabel.bounds.width)).toFixed(2));
  if (outerLabelMarginLeft < -0.5 || trackMarginLeft < -0.5) {
    return null;
  }

  const trackChildren = [];
  if (inactiveText) {
    trackChildren.push({
      marginLeft: Number((inactiveText.bounds.x - trackNode.bounds.x).toFixed(2)),
      html: renderFlowNode(inactiveText),
      width: inactiveText.bounds.width,
    });
  }

  const activeWrapperStyles = [
    boxStyles(activeNode, {
      mode: 'flow',
    }),
    'display:flex',
    'justify-content:center',
    'align-items:center',
    'box-sizing:border-box',
  ].filter(Boolean);
  const activeContent = activeText ? renderFlowNode(activeText) : '';
  const activeBlock = {
    marginLeft: Number((
      activeNode.bounds.x
      - trackNode.bounds.x
      - (trackChildren.length
        ? trackChildren[trackChildren.length - 1].marginLeft + trackChildren[trackChildren.length - 1].width
        : 0)
    ).toFixed(2)),
    html: renderFlowWrapper(activeWrapperStyles, activeContent),
  };

  if (activeBlock.marginLeft < -0.5) {
    return null;
  }

  const trackHtml = [
    inactiveText
      ? renderFlowWrapper([
        trackChildren[0].marginLeft > 0 ? `margin-left:${trackChildren[0].marginLeft}px` : '',
      ], trackChildren[0].html)
      : '',
    renderFlowWrapper([
      activeBlock.marginLeft > 0 ? `margin-left:${activeBlock.marginLeft}px` : '',
      'flex:0 0 auto',
    ], activeBlock.html),
  ].filter(Boolean).join('');

  const trackWrapperStyles = [
    boxStyles(trackNode, {
      mode: 'flow',
    }),
    'display:flex',
    'align-items:center',
    'justify-content:flex-start',
    'box-sizing:border-box',
  ];

  return {
    wrapperStyles: [
      'display:flex',
      'align-items:center',
      'justify-content:flex-start',
      'box-sizing:border-box',
    ],
    childrenHtml: [
      renderFlowWrapper([
        outerLabelMarginLeft > 0 ? `margin-left:${outerLabelMarginLeft}px` : '',
        'flex:0 0 auto',
      ], renderFlowNode(outerLabel)),
      renderFlowWrapper([
        trackMarginLeft > 0 ? `margin-left:${trackMarginLeft}px` : '',
        'flex:0 0 auto',
      ], renderFlowWrapper(trackWrapperStyles, trackHtml)),
    ].join(''),
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
  const toggleFlow = !simpleFlow && !detachedFlow && !maskedFlow ? toggleControlFlowLayout(node, contentChildren) : null;
  const singleFlow = !simpleFlow && !detachedFlow && !maskedFlow && !toggleFlow
    ? singleChildFlowLayout(node, contentChildren)
    : null;
  const wrapperVisualNode = embeddedVisualNode || maskedFlow?.visualNode || node;
  const usesAbsoluteChildren = mode === 'flow' && contentChildren.length > 0 && node.shouldRenderChildren !== false && (
    (!simpleFlow && !maskedFlow && !toggleFlow && !singleFlow && !detachedFlow)
    || Boolean(detachedFlow?.usesAbsoluteLayout)
  );
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      positionContext: usesAbsoluteChildren,
      forceClip: Boolean(maskedFlow?.forceClip),
      visualNode: wrapperVisualNode,
    }),
    embeddedVisualNode ? shapeClipStyles(embeddedVisualNode, node.bounds) : '',
    simpleFlow ? simpleFlow.wrapperStyles.join(';') : '',
    detachedFlow ? detachedFlow.wrapperStyles.join(';') : '',
    maskedFlow ? maskedFlow.wrapperStyles.join(';') : '',
    toggleFlow ? toggleFlow.wrapperStyles.join(';') : '',
    singleFlow ? singleFlow.wrapperStyles.join(';') : '',
  ].filter(Boolean).join(';');
  const childrenHtml = contentChildren.length > 0 && node.shouldRenderChildren !== false
    ? simpleFlow
      ? simpleFlow.childrenHtml
      : detachedFlow
        ? detachedFlow.childrenHtml
        : maskedFlow
          ? maskedFlow.childrenHtml
          : toggleFlow
            ? toggleFlow.childrenHtml
          : singleFlow
            ? singleFlow.childrenHtml
            : renderLayerList(contentChildren, node.bounds.x, node.bounds.y, 'absolute', insideMask)
    : detachedFlow?.childrenHtml || '';
  return `<div ${renderClassAttr('layer container', 'container-layer', wrapperStyle)} ${layerAttrs(node)} ${maskedFlow?.extraAttrs || ''}>${childrenHtml}</div>`;
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
    return `<div ${renderClassAttr('layout-line', 'layout-line', styles.filter(Boolean).join(';'))}>${lineHtml}</div>`;
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
  const visibleOverlays = overlays.filter(child => child.id !== embeddedVisualNode?.id);
  const wrapperStyle = [
    boxStyles(node, {
      offsetX,
      offsetY,
      mode,
      positionContext: mode === 'flow' && visibleOverlays.length > 0,
      forceClip: false,
      visualNode: embeddedVisualNode || node,
    }),
    embeddedVisualNode ? shapeClipStyles(embeddedVisualNode, node.bounds) : '',
    flexLayoutStyles(node, mode),
  ].join(';');
  const overlayHtml = visibleOverlays
    .map(child => renderNode(child, node.bounds.x, node.bounds.y, 'absolute', false))
    .join('\n');
  const flowHtml = node.layoutHint?.lines?.length
    ? renderLayoutLines(node)
    : items.map(child => renderFlowNode(child)).join('\n');

  return `<div ${renderClassAttr('layer flex-node', 'flex-node', wrapperStyle)} ${layerAttrs(node)}>${overlayHtml}${flowHtml}</div>`;
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
    return `<div ${renderClassAttr('layer mask', 'mask-layer', wrapperStyles)} ${layerAttrs(maskNode)}>${childHtml}</div>`;
  }

  const ownMask = hasVisual(maskNode) ? renderOwn(maskNode, offsetX, offsetY, mode) : '';
  const wrapperStyles = [
    boxStyles(maskNode, {
      offsetX,
      offsetY,
      mode,
      positionContext: mode === 'flow',
      forceClip: true,
    }),
    shapeClipStyles(maskNode, maskNode.bounds),
    'background:transparent',
  ].join(';');
  const childrenHtml = sortByPaint(targets).map(target => renderNode(target, maskNode.bounds.x, maskNode.bounds.y, 'absolute', true)).join('\n');

  return `${ownMask}<div ${renderClassAttr('layer mask', 'mask-layer', wrapperStyles)} ${layerAttrs(maskNode)}>${childrenHtml}</div>`;
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

function coversArtboard(node) {
  const widthCoverage = node.bounds.width / Math.max(artboard.width, 1);
  const heightCoverage = node.bounds.height / Math.max(artboard.height, 1);
  return node.bounds.x <= Math.max(2, artboard.width * 0.05)
    && node.bounds.y <= Math.max(2, artboard.height * 0.05)
    && widthCoverage >= 0.92
    && heightCoverage >= 0.92;
}

function isBackdropExtractionCandidate(node, insideBackdrop = false) {
  if (node.text || hasBitmapFallback(node)) {
    return false;
  }

  if (coversArtboard(node)) {
    return true;
  }

  if (!insideBackdrop) {
    return false;
  }

  const wideCoverage = node.bounds.width / Math.max(artboard.width, 1);
  return node.bounds.x <= Math.max(3, artboard.width * 0.05)
    && wideCoverage >= 0.92
    && (
      node.bounds.height >= Math.max(120, artboard.height * 0.18)
      || node.type === 'shape'
      || node.type === 'image'
    );
}

function collectRootBackdropAndContent(nodes) {
  const backgrounds = [];
  const contents = [];

  const visit = (node, insideBackdrop = false) => {
    if (!isRenderable(node) || isTransparentLeaf(node)) {
      return;
    }

    const backdropCandidate = isBackdropExtractionCandidate(node, insideBackdrop);
    if (backdropCandidate && node.children?.length && node.renderStrategy !== 'asset' && !node.text) {
      for (const child of sortByPaint(node.children)) {
        visit(child, true);
      }
      return;
    }

    if (backdropCandidate) {
      backgrounds.push(node);
      return;
    }

    contents.push(node);
  };

  for (const node of sortByPaint(nodes)) {
    visit(node, false);
  }

  return { backgrounds, contents };
}

function canShareRootFlowRow(row, node) {
  const nodeTop = node.bounds.y;
  const nodeBottom = node.bounds.y + node.bounds.height;
  const verticalOverlap = Math.min(row.bottom, nodeBottom) - Math.max(row.top, nodeTop);
  const minOverlap = Math.min(24, Math.min(node.bounds.height, row.bottom - row.top) * 0.35);
  if (verticalOverlap <= minOverlap) {
    return false;
  }

  return row.nodes.every(existing => {
    const overlapX = Math.min(
      existing.bounds.x + existing.bounds.width,
      node.bounds.x + node.bounds.width,
    ) - Math.max(existing.bounds.x, node.bounds.x);
    return overlapX <= Math.min(24, Math.min(existing.bounds.width, node.bounds.width) * 0.18);
  });
}

function buildRootFlowRows(nodes) {
  const sorted = [...nodes].sort((left, right) => (
    left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x
  ));
  const rows = [];

  for (const node of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && canShareRootFlowRow(lastRow, node)) {
      lastRow.nodes.push(node);
      lastRow.top = Math.min(lastRow.top, node.bounds.y);
      lastRow.bottom = Math.max(lastRow.bottom, node.bounds.y + node.bounds.height);
      lastRow.left = Math.min(lastRow.left, node.bounds.x);
      lastRow.right = Math.max(lastRow.right, node.bounds.x + node.bounds.width);
      continue;
    }

    rows.push({
      nodes: [node],
      top: node.bounds.y,
      bottom: node.bounds.y + node.bounds.height,
      left: node.bounds.x,
      right: node.bounds.x + node.bounds.width,
    });
  }

  return rows.map(row => ({
    ...row,
    nodes: row.nodes.sort((left, right) => left.bounds.x - right.bounds.x),
  }));
}

function renderGridPlacedNode(node, mode = 'flow') {
  const html = renderNode(node, 0, 0, mode, false);
  if (!html) {
    return '';
  }

  const styles = [
    'grid-area:1 / 1',
    'align-self:start',
    'justify-self:start',
    Math.abs(node.bounds.y) > 0.01 ? `margin-top:${node.bounds.y}px` : '',
    Math.abs(node.bounds.x) > 0.01 ? `margin-left:${node.bounds.x}px` : '',
  ].filter(Boolean).join(';');

  return `<div ${renderClassAttr('root-grid-node', 'root-grid-node', styles)}>${html}</div>`;
}

function renderRootFlowContent(nodes) {
  const rows = buildRootFlowRows(nodes);
  return rows.map((row, index) => {
    const previousRow = index > 0 ? rows[index - 1] : null;
    const marginTop = previousRow ? row.top - previousRow.bottom : row.top;
    const rowStyles = [
      'display:flex',
      'justify-content:flex-start',
      'align-items:flex-start',
      'box-sizing:border-box',
      Math.abs(marginTop) > 0.01 ? `margin-top:${marginTop}px` : '',
      Math.abs(row.left) > 0.01 ? `margin-left:${row.left}px` : '',
    ];

    let cursorX = row.left;
    const childrenHtml = row.nodes.map(node => {
      const marginLeft = node.bounds.x - cursorX;
      const marginTopWithinRow = node.bounds.y - row.top;
      cursorX = node.bounds.x + node.bounds.width;
      const wrapperStyles = [
        'flex:0 0 auto',
        Math.abs(marginLeft) > 0.01 ? `margin-left:${marginLeft}px` : '',
        Math.abs(marginTopWithinRow) > 0.01 ? `margin-top:${marginTopWithinRow}px` : '',
      ].filter(Boolean).join(';');
      return `<div ${renderClassAttr('root-flow-item', 'root-flow-item', wrapperStyles)}>${renderFlowNode(node)}</div>`;
    }).join('');

    return `<div ${renderClassAttr('root-flow-row', 'root-flow-row', rowStyles.filter(Boolean).join(';'))}>${childrenHtml}</div>`;
  }).join('\n');
}

function renderRootGridContent(nodes) {
  return sortByPaint(nodes)
    .map(node => renderGridPlacedNode(node, 'flow'))
    .filter(Boolean)
    .join('\n');
}

function renderRoot(nodes) {
  const { backgrounds, contents } = collectRootBackdropAndContent(nodes);
  if (backgrounds.length === 0 || contents.length === 0) {
    return renderLayerList(nodes);
  }

  const backgroundHtml = sortByPaint(backgrounds)
    .map(node => renderGridPlacedNode(node, 'flow'))
    .filter(Boolean)
    .join('\n');
  const contentHtml = renderRootGridContent(contents);

  return [
    `<div ${renderClassAttr('root-background-layer', 'root-background-layer', `grid-area:1 / 1;z-index:0;display:grid;grid-template-columns:minmax(0, 1fr);grid-template-rows:minmax(0, 1fr);width:${artboard.width}px;height:${artboard.height}px;overflow:hidden;box-sizing:border-box`)}>${backgroundHtml}</div>`,
    `<div ${renderClassAttr('root-content-layer', 'root-content-layer', `grid-area:1 / 1;z-index:1;display:grid;grid-template-columns:minmax(0, 1fr);grid-template-rows:minmax(0, 1fr);width:${artboard.width}px;height:${artboard.height}px;overflow:hidden;box-sizing:border-box`)}>${contentHtml}</div>`,
  ].join('\n');
}

const renderedRoot = renderRoot(layers);
const generatedCss = renderGeneratedCss();

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${artboard.width}, initial-scale=1.0" />
  <title>${escapeHtml(artboard.name)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden; }
    #artboard { display:grid; grid-template-columns:minmax(0, 1fr); grid-template-rows:minmax(0, 1fr); width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden; background: #fff; }
    .layer { box-sizing: border-box; }
    .text { -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; user-select: text; }
    #artboard img, #artboard svg, #artboard path { pointer-events: none; }
${generatedCss}
  </style>
</head>
<body>
  <div id="artboard">${renderedRoot}</div>
</body>
</html>`;

await fs.writeFile(htmlPath, html, 'utf8');
await fs.writeFile(parsedPath, JSON.stringify({ artboard, restoration, localizedAssets, layers }, null, 2), 'utf8');

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
  localizedAssets,
  htmlPath,
  parsedPath,
  screenshotPath,
  diffPath,
  compare,
};

await fs.writeFile(metaPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
