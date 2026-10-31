import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

// npm start        -> editor            npm run view -> read-only viewer of the same project
const viewOnly = process.argv.includes('--view') || process.env.VIEW_ONLY === '1';
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';

if (!existsSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)))) {
  console.error('The app has not been built yet. Run "npm run build" first, then start again.');
  process.exit(1);
}

createApp(undefined, { viewOnly }).listen(port, host, () => {
  console.log(`Orbit ${viewOnly ? 'viewer (read-only)' : 'editor'} is running.`);
  console.log(`Open  http://${host === '0.0.0.0' ? 'localhost' : host}:${port}  in your browser.`);
  console.log('Press Ctrl+C to stop.');
});
