import { createServer } from 'node:http';
import { build } from 'esbuild';

const result = await build({ entryPoints: [new URL('./preview.ts', import.meta.url).pathname], bundle: true,
  platform: 'browser', format: 'iife', write: false });
createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>Riff Home preview</title><div id="root"></div><script>${result.outputFiles[0].text}</script>`);
}).listen(4174, '127.0.0.1', () => console.log('Riff Home preview: http://127.0.0.1:4174'));
