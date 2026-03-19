import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { LanhuParser } from '../dist/services/lanhu-parser.js';
import { imageCompareService } from '../dist/services/image-compare.js';

const jsonUrl = process.env.LANHU_JSON_URL || 'https://alipic.lanhuapp.com/psi6socdrxe5mf8z6xtfksqqnh9ecwf2a3b4f00-9a25-48a3-b39e-841eb81ae047';
const referenceImageUrl = process.env.LANHU_REFERENCE_IMAGE_URL || 'https://alipic.lanhuapp.com/ps1lmw1s8ifmwu5wx8xk0tfmoo0cpvd2mn1c980b2a-494d-4e44-8340-0196159b13a9';
const outputDir = path.resolve(process.env.LANHU_OUTPUT_DIR || 'artifacts/loop');

await fs.mkdir(outputDir, { recursive: true });

const response = await fetch(jsonUrl, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json, text/plain, */*',
  },
});
if (!response.ok) {
  throw new Error(`Failed to fetch Lanhu JSON: ${response.status} ${response.statusText}`);
}

const document = await response.json();
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

function escapeHtml(value = '') {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function flatten(nodes) {
  const result = [];
  const walk = current => {
    for (const node of current) {
      result.push(node);
      if (node.assetUrl) {
        continue;
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}

function hasVisual(node) {
  return Boolean(
    node.text
    || node.assetUrl
    || node.fill
    || node.stroke
    || (node.shadows && node.shadows.length)
  );
}

function textStyles(node) {
  if (!node.textStyle) return '';
  const ts = node.textStyle;
  const justify = ts.alignment === 'center' ? 'center' : ts.alignment === 'right' ? 'flex-end' : 'flex-start';
  return [
    'display:flex',
    `justify-content:${justify}`,
    'align-items:center',
    'white-space:pre-wrap',
    'overflow:hidden',
    `font-size:${ts.fontSize}px`,
    `font-family:'${ts.fontFamily}','PingFang SC','Microsoft YaHei',sans-serif`,
    `font-weight:${ts.fontWeight || 400}`,
    `font-style:${ts.fontStyle || 'normal'}`,
    `color:${ts.color}`,
    `text-align:${ts.alignment}`,
    ts.lineHeight ? `line-height:${ts.lineHeight}px` : '',
    ts.letterSpacing !== undefined ? `letter-spacing:${ts.letterSpacing}px` : '',
  ].filter(Boolean).join(';');
}

function commonStyles(node) {
  const styles = [
    'position:absolute',
    `left:${node.bounds.x}px`,
    `top:${node.bounds.y}px`,
    `width:${node.bounds.width}px`,
    `height:${node.bounds.height}px`,
    `z-index:${10000 - (node.zIndex || 0)}`,
    'box-sizing:border-box',
    'pointer-events:none',
    '-webkit-font-smoothing:antialiased',
  ];

  if (node.opacity !== undefined) styles.push(`opacity:${node.opacity}`);
  if (node.borderRadius !== undefined) {
    const radius = Array.isArray(node.borderRadius)
      ? node.borderRadius.map(value => `${value}px`).join(' ')
      : `${node.borderRadius}px`;
    styles.push(`border-radius:${radius}`);
    styles.push('overflow:hidden');
  }
  if (node.stroke) styles.push(`border:${node.stroke.width}px solid ${node.stroke.color}`);
  if (node.fill) {
    if (node.fill.startsWith('linear-gradient') || node.fill.startsWith('radial-gradient')) {
      styles.push(`background:${node.fill}`);
    } else {
      styles.push(`background:${node.fill}`);
    }
  }
  if (node.shadows?.length) {
    styles.push(`box-shadow:${node.shadows.map(shadow => `${shadow.type === 'innerShadow' ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`).join(',')}`);
  }
  return styles.join(';');
}

function renderNode(node) {
  const style = commonStyles(node);
  if (node.assetUrl) {
    return `<div class="layer layer-${node.type}" style="${style}"><img src="${node.assetUrl}" style="width:100%;height:100%;display:block;object-fit:fill;" /></div>`;
  }
  if (node.text) {
    return `<div class="layer layer-text" style="${style};${textStyles(node)}">${escapeHtml(node.text)}</div>`;
  }
  return `<div class="layer layer-${node.type}" style="${style}"></div>`;
}

const flatLayers = flatten(layers).filter(node => {
  if (!hasVisual(node)) return false;
  if (node.opacity !== undefined && node.opacity <= 0.001) return false;
  if (node.bounds.width <= 0 || node.bounds.height <= 0) return false;
  if (node.bounds.y < 0) return false;
  if (node.bounds.x >= artboard.width || node.bounds.y >= artboard.height) return false;
  if (node.bounds.x + node.bounds.width <= 0 || node.bounds.y + node.bounds.height <= 0) return false;
  return true;
});
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${artboard.width}, initial-scale=1.0" />
  <title>${escapeHtml(artboard.name)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    body { width: ${artboard.width}px; height: ${artboard.height}px; overflow: hidden; }
    #artboard { position: relative; width: ${artboard.width}px; height: ${artboard.height}px; background: #fff; overflow: hidden; }
    .layer-text { word-break: break-word; }
  </style>
</head>
<body>
  <div id="artboard">${flatLayers.map(renderNode).join('\n')}</div>
</body>
</html>`;

const htmlPath = path.join(outputDir, 'restoration-v2.html');
const screenshotPath = path.join(outputDir, 'restoration-v2.png');
const diffPath = path.join(outputDir, 'diff-v2.png');
const metaPath = path.join(outputDir, 'meta-v2.json');

await fs.writeFile(htmlPath, html, 'utf8');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: Math.ceil(artboard.width), height: Math.ceil(artboard.height) }, deviceScaleFactor: 1 });
await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' });
await page.locator('#artboard').screenshot({ path: screenshotPath });
await browser.close();

const compareResult = await imageCompareService.compare({
  referenceImageUrl,
  candidateImagePath: screenshotPath,
  diffOutputPath: diffPath,
  resizeCandidate: true,
  gridRows: 6,
  gridCols: 4,
});

const result = {
  artboard,
  flatLayerCount: flatLayers.length,
  assetCount: assets.length,
  htmlPath,
  screenshotPath,
  diffPath,
  compare: compareResult,
};

await fs.writeFile(metaPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify(result, null, 2));
