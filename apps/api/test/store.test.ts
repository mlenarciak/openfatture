import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LocalStore } from '../src/store.js';
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
it('persists mutations across API restarts and rejects competing stale local writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'openfatture-test-')); temporary.push(directory);
  const path = join(directory, 'state.json'); const store = new LocalStore(path);
  const first = (await store.get('company_demo'))!; const stale = structuredClone(first);
  await store.put('company_demo', { ...first, sequence: 51 }, first.version);
  await expect(store.put('company_demo', { ...stale, sequence: 52 }, stale.version)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect((await new LocalStore(path).get('company_demo'))?.sequence).toBe(51);
  expect((await new LocalStore(path).get('company_demo'))?.version).toBe(1);
});
