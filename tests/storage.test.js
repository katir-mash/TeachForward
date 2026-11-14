import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProgress, saveProgress, STORAGE_KEY } from '../src/storage.js';
import { buildRoadmap, SAMPLE_PROFILE } from '../shared/roadmap.js';

const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('progress round trip restores current tasks and excludes stale or duplicated ids', () => {
  const storage = memoryStorage();
  const id = buildRoadmap(SAMPLE_PROFILE).tasks[0].id;
  assert.equal(saveProgress(storage, SAMPLE_PROFILE, [id, 'obsolete-task', id]), true);
  assert.deepEqual(loadProgress(storage), { profile: SAMPLE_PROFILE, completed: [id], warning: '' });
});

test('corrupt, invalid and incompatible saved data never crash the navigator', () => {
  const storage = memoryStorage();
  for (const raw of ['{broken', 'null', JSON.stringify({ version: 1, profile: { ...SAMPLE_PROFILE, education: 'made-up' }, completed: [] }), JSON.stringify({ version: 0, profile: SAMPLE_PROFILE, completed: [] })]) {
    storage.setItem(STORAGE_KEY, raw);
    const restored = loadProgress(storage);
    assert.equal(restored.profile, null);
    assert.deepEqual(restored.completed, []);
    assert.ok(restored.warning);
  }
});

test('storage denial and quota errors preserve usable in-memory behavior with warnings', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.ok(loadProgress(blocked).warning);
  assert.equal(saveProgress(blocked, SAMPLE_PROFILE, []), false);
  assert.deepEqual(loadProgress(memoryStorage()), { profile: null, completed: [], warning: '' });
});
