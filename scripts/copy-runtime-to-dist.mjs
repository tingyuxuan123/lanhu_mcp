import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');
const targetDir = path.join(projectRoot, 'dist', 'runtime');

await fs.mkdir(targetDir, { recursive: true });

for (const fileName of ['html-restoration-runtime.mjs', 'uniapp-restoration-runtime.mjs']) {
	const sourcePath = path.join(projectRoot, 'src', 'runtime', fileName);
	const targetPath = path.join(targetDir, fileName);
	await fs.copyFile(sourcePath, targetPath);
}
