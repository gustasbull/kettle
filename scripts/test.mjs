import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const browser = process.argv.includes('--browser');
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : [path];
  }));
  return files.flat().filter(path => path.endsWith(browser ? '.test.mjs' : '.test.ts')).sort();
}
const files = await discover('tests');
if (files.length === 0) {
  console.log(`No ${browser ? 'browser' : 'TypeScript'} test suites present.`);
} else {
  // panel-build exercises failure cleanup by replacing generated modules. Keep
  // it out of the parallel import phase so resource/MCP suites can never
  // observe the intentionally absent file between cleanup and atomic rebuild.
  const groups = browser
    ? [files]
    : [
        files.filter(path => path !== 'tests/panel-build.test.ts'),
        files.filter(path => path === 'tests/panel-build.test.ts'),
      ].filter(group => group.length > 0);
  for (const group of groups) {
    const result = spawnSync(process.execPath, [
      ...(browser ? [] : ['--import', 'tsx']), '--test', ...group,
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
}
