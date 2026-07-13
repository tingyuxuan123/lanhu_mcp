import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));

async function importRuntimeModule(candidates) {
  for (const candidate of candidates) {
    const modulePath = path.resolve(runtimeDir, candidate);

    try {
      await fs.access(modulePath);
      return import(pathToFileURL(modulePath).href);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Unable to resolve runtime module from ${runtimeDir}: ${candidates.join(', ')}`);
}

async function loadRuntimeDependencies() {
  const [
    { AssetLocalizer },
    { LanhuClient },
    { LanhuParser },
    { buildAssetPublicPath },
    { parseLanhuUrl },
    { renderUniAppRoot },
  ] = await Promise.all([
    importRuntimeModule(['../services/asset-localizer.js', '../../dist/services/asset-localizer.js']),
    importRuntimeModule(['../services/lanhu-client.js', '../../dist/services/lanhu-client.js']),
    importRuntimeModule(['../services/lanhu-parser.js', '../../dist/services/lanhu-parser.js']),
    importRuntimeModule(['../utils/asset-localization.js', '../../dist/utils/asset-localization.js']),
    importRuntimeModule(['../utils/url-parser.js', '../../dist/utils/url-parser.js']),
    importRuntimeModule(['../services/uniapp-renderer.js', '../../dist/services/uniapp-renderer.js']),
  ]);

  return {
    AssetLocalizer,
    LanhuClient,
    LanhuParser,
    buildAssetPublicPath,
    parseLanhuUrl,
    renderUniAppRoot,
  };
}

export async function runUniAppRestoration(options = {}) {
  const {
    AssetLocalizer,
    LanhuClient,
    LanhuParser,
    buildAssetPublicPath,
    parseLanhuUrl,
    renderUniAppRoot,
  } = await loadRuntimeDependencies();
  const pageUrl = options.pageUrl ?? process.env.LANHU_PAGE_URL;
  const cookie = options.cookie ?? (process.env.LANHU_COOKIE || '');
  const directJsonUrl = options.jsonUrl ?? process.env.LANHU_JSON_URL;
  const directReferenceImageUrl = options.referenceImageUrl ?? (process.env.LANHU_REFERENCE_IMAGE_URL || null);
  const jsonPath = pageUrl || directJsonUrl ? null : path.resolve(options.jsonPath || process.env.SAMPLE_JSON_PATH || 'tmp_sample.json');
  const referenceImagePath = pageUrl || directReferenceImageUrl ? null : path.resolve(options.referenceImagePath || process.env.SAMPLE_REFERENCE_PATH || 'tmp_sample.png');
  const outputDir = path.resolve(
    options.outputDir
    || process.env.LANHU_OUTPUT_DIR
    || process.env.SAMPLE_OUTPUT_DIR
    || (pageUrl || directJsonUrl ? 'artifacts/lanhu-uniapp' : 'artifacts/sample-uniapp'),
  );
  const outputPrefix = options.outputPrefix || process.env.RESTORATION_OUTPUT_PREFIX || (pageUrl || directJsonUrl ? 'lanhu-uniapp' : 'sample-uniapp');
  const localAssetDirName = `${outputPrefix}-assets`;
  const localAssetDir = path.join(outputDir, localAssetDirName);
  const assetPublicPath = options.assetPublicPath || process.env.LANHU_UNIAPP_ASSET_PUBLIC_PATH || '/static/lanhu-assets';

  await fs.mkdir(outputDir, { recursive: true });

  if (pageUrl && !cookie) {
    throw new Error('LANHU_COOKIE is required when LANHU_PAGE_URL is provided');
  }

  let document;
  let sourceMeta;
  let referenceImageUrl = directReferenceImageUrl;
  const lanhuClient = cookie ? new LanhuClient(cookie) : null;

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
  const designWidth = resolveDesignWidth(
    options.designWidth ?? process.env.LANHU_UNIAPP_DESIGN_WIDTH,
    artboard?.width,
  );
  const layers = parser.buildLayerTree(parsed, 30, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });
  const assets = parser.extractAssets(parsed, {
    includeInvisible: false,
    normalizeToArtboard: true,
  });
  const localizedAssets = await localizeAssetUrls(layers, assets);
  const sfc = renderUniAppRoot(layers, artboard, {
    designWidth,
    componentName: 'LanhuRestoredPage',
  });

  const vuePath = path.join(outputDir, `${outputPrefix}.vue`);
  const metaPath = path.join(outputDir, `${outputPrefix}-meta.json`);
  const bundlePath = path.join(outputDir, `${outputPrefix}-bundle.json`);

  const payload = {
    source: sourceMeta,
    artboard,
    designWidth,
    layers,
    localizedAssets,
  };

  await Promise.all([
    fs.writeFile(vuePath, sfc, 'utf8'),
    fs.writeFile(metaPath, JSON.stringify({
      source: sourceMeta,
      artboard,
      designWidth,
      vuePath,
      localizedAssets,
      generatedAt: new Date().toISOString(),
    }, null, 2), 'utf8'),
    fs.writeFile(bundlePath, JSON.stringify(payload, null, 2), 'utf8'),
  ]);

  return {
    source: {
      pageUrl: sourceMeta.pageUrl,
      jsonUrl: sourceMeta.jsonUrl,
      designName: sourceMeta.designName,
      referenceImageUrl,
    },
    artboard: {
      name: artboard.name,
      width: artboard.width,
      height: artboard.height,
    },
    designWidth,
    vuePath,
    metaPath,
    bundlePath,
    localizedAssets: {
      outputDir: localizedAssets?.outputDir,
      publicPathPrefix: localizedAssets?.publicPathPrefix,
      files: localizedAssets?.files,
    },
  };

  async function localizeAssetUrls(nodes, assetSummaries = []) {
    const downloader = lanhuClient
      ? sourceUrl => lanhuClient.fetchBinaryWithMetadata(sourceUrl)
      : undefined;
    const localizer = downloader ? new AssetLocalizer(downloader) : new AssetLocalizer();

    return localizer.localize(nodes, assetSummaries, {
      outputDir: localAssetDir,
      publicPathPrefix: buildAssetPublicPath(localAssetDir, assetPublicPath),
    });
  }
}

function resolveDesignWidth(value, fallbackWidth) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return numericValue;
  }

  const artboardWidth = Number(fallbackWidth);
  if (Number.isFinite(artboardWidth) && artboardWidth > 0) {
    return artboardWidth;
  }

  return 375;
}
