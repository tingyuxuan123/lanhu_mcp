import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');
const sourcePath = path.join(projectRoot, 'src', 'runtime', 'html-restoration-runtime.mjs');
const targetDir = path.join(projectRoot, 'dist', 'runtime');
const targetPath = path.join(targetDir, 'html-restoration-runtime.mjs');

await fs.mkdir(targetDir, { recursive: true });
await fs.copyFile(sourcePath, targetPath);
