import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validationScriptUrl = new URL('./validate-sample-restoration.mjs', import.meta.url);
const outputDir = path.resolve(process.env.LANHU_OUTPUT_DIR || 'artifacts/loop');
const minScore = Number(process.env.RESTORATION_MIN_SCORE || 95);
const targetMaxAttempts = Math.max(1, Number(process.env.LANHU_TARGET_MAX_ATTEMPTS || 3));

await fs.mkdir(outputDir, { recursive: true });

const targets = await resolveTargets();
if (targets.length === 0) {
  throw new Error(
    'No Lanhu targets provided. Use LANHU_PAGE_URL, LANHU_PAGE_URLS, LANHU_TARGETS_FILE, or LANHU_JSON_URL.',
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  minScore,
  targetMaxAttempts,
  outputDir,
  total: targets.length,
  passed: 0,
  failed: 0,
  belowThreshold: 0,
  items: [],
};

for (let index = 0; index < targets.length; index += 1) {
  const target = normalizeTarget(targets[index], index);
  const targetOutputDir = path.join(outputDir, target.prefix);
  await fs.mkdir(targetOutputDir, { recursive: true });

  try {
    const { attempts } = await runValidationWithRetry(target, targetOutputDir);
    const metaPath = path.join(targetOutputDir, `${target.prefix}-meta.json`);
    const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
    const score = Number(meta.compare?.visualSimilarityScore || 0);
    const passed = score >= minScore;
    if (passed) {
      summary.passed += 1;
    } else {
      summary.belowThreshold += 1;
    }

    summary.items.push({
      prefix: target.prefix,
      status: passed ? 'passed' : 'below-threshold',
      score,
      attempts,
      pageUrl: target.pageUrl || undefined,
      jsonUrl: target.jsonUrl || undefined,
      referenceImageUrl: meta.source?.referenceImageUrl || target.referenceImageUrl || undefined,
      htmlPath: meta.htmlPath,
      screenshotPath: meta.screenshotPath,
      diffPath: meta.diffPath,
      metaPath,
    });
  } catch (error) {
    summary.failed += 1;
    summary.items.push({
      prefix: target.prefix,
      status: 'failed',
      attempts: targetMaxAttempts,
      pageUrl: target.pageUrl || undefined,
      jsonUrl: target.jsonUrl || undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const summaryPath = path.join(outputDir, 'restoration-summary.json');
await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));

if (summary.failed > 0 || summary.belowThreshold > 0) {
  process.exitCode = 1;
}

async function resolveTargets() {
  const targetsFile = process.env.LANHU_TARGETS_FILE;
  if (targetsFile) {
    const raw = await fs.readFile(path.resolve(targetsFile), 'utf8');
    return parseTargets(raw);
  }

  const pageUrls = process.env.LANHU_PAGE_URLS;
  if (pageUrls) {
    return parseTargetList(pageUrls).map(pageUrl => ({ pageUrl }));
  }

  const pageUrl = process.env.LANHU_PAGE_URL;
  if (pageUrl) {
    return [{ pageUrl }];
  }

  const jsonUrl = process.env.LANHU_JSON_URL;
  if (jsonUrl) {
    return [{
      jsonUrl,
      referenceImageUrl: process.env.LANHU_REFERENCE_IMAGE_URL || undefined,
      prefix: process.env.RESTORATION_OUTPUT_PREFIX || undefined,
    }];
  }

  return [];
}

function parseTargets(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('LANHU_TARGETS_FILE must contain a JSON array.');
    }

    return parsed.map(item => {
      if (typeof item === 'string') {
        return { pageUrl: item };
      }
      return item;
    });
  }

  return parseTargetList(trimmed).map(pageUrl => ({ pageUrl }));
}

function parseTargetList(raw) {
  return String(raw || '')
    .split(/[\r\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeTarget(target, index) {
  if (!target || (typeof target !== 'object' && typeof target !== 'string')) {
    throw new Error(`Invalid target at index ${index}`);
  }

  const normalized = typeof target === 'string'
    ? { pageUrl: target }
    : {
        pageUrl: target.pageUrl,
        jsonUrl: target.jsonUrl,
        referenceImageUrl: target.referenceImageUrl,
        prefix: target.prefix,
      };

  if (!normalized.pageUrl && !normalized.jsonUrl) {
    throw new Error(`Target ${index + 1} is missing pageUrl/jsonUrl`);
  }

  return {
    ...normalized,
    prefix: normalized.prefix || derivePrefix(normalized, index),
  };
}

function derivePrefix(target, index) {
  if (target.pageUrl) {
    try {
      const parsedUrl = new URL(target.pageUrl);
      const hash = parsedUrl.hash.startsWith('#')
        ? parsedUrl.hash.slice(1)
        : parsedUrl.hash;
      const queryString = hash.includes('?')
        ? hash.split('?')[1]
        : parsedUrl.searchParams.toString();
      const params = new URLSearchParams(queryString);
      const imageId = params.get('image_id');
      if (imageId) {
        return imageId.slice(0, 8);
      }
    } catch {
      // ignore and fall back to index-based prefix
    }
  }

  if (target.jsonUrl) {
    try {
      const parsedUrl = new URL(target.jsonUrl);
      const basename = path.basename(parsedUrl.pathname).replace(/[^a-z0-9]+/gi, '');
      if (basename) {
        return basename.slice(0, 12);
      }
    } catch {
      // ignore and fall back to index-based prefix
    }
  }

  return `target-${String(index + 1).padStart(2, '0')}`;
}

async function runValidation(target, targetOutputDir) {
  const previousEnv = {
    LANHU_PAGE_URL: process.env.LANHU_PAGE_URL,
    LANHU_JSON_URL: process.env.LANHU_JSON_URL,
    LANHU_REFERENCE_IMAGE_URL: process.env.LANHU_REFERENCE_IMAGE_URL,
    LANHU_OUTPUT_DIR: process.env.LANHU_OUTPUT_DIR,
    RESTORATION_OUTPUT_PREFIX: process.env.RESTORATION_OUTPUT_PREFIX,
  };

  process.chdir(repoRoot);
  process.env.LANHU_PAGE_URL = target.pageUrl || '';
  process.env.LANHU_JSON_URL = target.jsonUrl || '';
  process.env.LANHU_REFERENCE_IMAGE_URL = target.referenceImageUrl || '';
  process.env.LANHU_OUTPUT_DIR = targetOutputDir;
  process.env.RESTORATION_OUTPUT_PREFIX = target.prefix;

  try {
    await import(`${validationScriptUrl.href}?run=${Date.now()}-${target.prefix}`);
  } finally {
    restoreEnv(previousEnv);
  }
}

async function runValidationWithRetry(target, targetOutputDir) {
  let lastError;

  for (let attempt = 1; attempt <= targetMaxAttempts; attempt += 1) {
    try {
      await runValidation(target, targetOutputDir);
      return { attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= targetMaxAttempts) {
        break;
      }

      await wait(300 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

function wait(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}
