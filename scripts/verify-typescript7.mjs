import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const bootstrap = require(resolve(root, 'node_modules/typescript/package.json'));
const native = require(resolve(root, 'node_modules/@typescript/native-preview/package.json'));
const expectedBootstrap = manifest.devDependencies.typescript;
const expectedNative = manifest.devDependencies['@typescript/native-preview'].replace(
  'npm:typescript@',
  '',
);

function fail(message) {
  console.error(`[typescript7] ${message}`);
  process.exit(1);
}

if (bootstrap.version !== expectedBootstrap || !bootstrap.version.startsWith('6.')) {
  fail(
    `svelte-check bootstrap must be TypeScript ${expectedBootstrap}; installed ${bootstrap.version}`,
  );
}

if (native.version !== expectedNative || !native.version.startsWith('7.')) {
  fail(`native diagnostics must be TypeScript ${expectedNative}; installed ${native.version}`);
}

for (const requiredExport of ['./unstable/sync', './unstable/ast']) {
  if (!(requiredExport in native.exports)) {
    fail(`native TypeScript package is missing ${requiredExport}`);
  }
}

const checker = require.resolve('svelte-check/bin/svelte-check', { paths: [root] });
const fixture = resolve(root, 'tests/fixtures/typescript7-prop-check/tsconfig.json');
const result = spawnSync(
  process.execPath,
  [checker, '--tsgo-experimental-api', '--tsconfig', fixture],
  { cwd: root, encoding: 'utf8' },
);
const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;

if (result.error) {
  fail(`could not run the Svelte TypeScript 7 guard: ${result.error.message}`);
}

if (result.status !== 1) {
  fail(`invalid-prop fixture exited ${result.status ?? 'without a status'} instead of 1\n${output}`);
}

if (!output.includes('Parent.svelte') || !output.includes("Type 'string' is not assignable to type 'number'")) {
  fail(`TypeScript 7 did not report the expected cross-component prop error\n${output}`);
}

console.log(
  `[typescript7] verified TypeScript ${native.version} Svelte diagnostics (TS${bootstrap.version} bootstrap)`,
);
