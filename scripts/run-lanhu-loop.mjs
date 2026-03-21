import { htmlRestorationBatchRunner, resolveBatchTargetsFromEnv } from '../dist/services/html-restoration-batch-runner.js';

const targets = await resolveBatchTargetsFromEnv();
if (targets.length === 0) {
  throw new Error(
    'No Lanhu targets provided. Use LANHU_PAGE_URL, LANHU_PAGE_URLS, LANHU_TARGETS_FILE, or LANHU_JSON_URL.',
  );
}

const summary = await htmlRestorationBatchRunner.run({
  targets,
  outputDir: process.env.LANHU_OUTPUT_DIR,
  minScore: process.env.RESTORATION_MIN_SCORE ? Number(process.env.RESTORATION_MIN_SCORE) : undefined,
  maxAttempts: process.env.LANHU_TARGET_MAX_ATTEMPTS ? Number(process.env.LANHU_TARGET_MAX_ATTEMPTS) : undefined,
  cookie: process.env.LANHU_COOKIE,
});

console.log(JSON.stringify(summary, null, 2));

if (summary.failed > 0 || summary.belowThreshold > 0) {
  process.exitCode = 1;
}
