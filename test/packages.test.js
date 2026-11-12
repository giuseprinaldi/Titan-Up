// node_modules is committed so the Windows installer never needs the npm
// registry. This fails when the folder and package-lock.json disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const versions = (lock) =>
  Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path, info]) => path && !info.dev)
      .map(([path, info]) => [path, info.version]),
  );

test('the committed node_modules matches package-lock.json', () => {
  const wanted = versions(read('package-lock.json'));
  // npm records what it actually installed in this hidden file.
  assert.deepEqual(versions(read('node_modules/.package-lock.json')), wanted, 'Run "npm ci --omit=dev" and commit node_modules.');
  for (const [path, version] of Object.entries(wanted)) {
    assert.equal(read(`${path}/package.json`).version, version, `${path} is not the locked version`);
  }
});
