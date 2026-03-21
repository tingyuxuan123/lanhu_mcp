import { runHtmlRestoration } from './html-restoration-runtime.mjs';

runHtmlRestoration()
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
