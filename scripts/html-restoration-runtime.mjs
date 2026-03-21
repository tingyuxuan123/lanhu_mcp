import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runHtmlRestoration } from '../dist/runtime/html-restoration-runtime.mjs';

export { runHtmlRestoration };

const isDirectExecution = Boolean(
  process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
);

if (isDirectExecution) {
  runHtmlRestoration()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
