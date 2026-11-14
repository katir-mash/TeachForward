import { buildRoadmap, validateProfile } from '../shared/roadmap.js';

export const STORAGE_KEY = 'teachforward.progress.v1';

// Access the browser getter inside callers' try/catch (blocked storage can throw).
export const browserStorage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

export function loadProgress(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { profile: null, completed: [], warning: '' };
    const data = JSON.parse(raw);
    if (data.version !== 1 || !validateProfile(data.profile).valid || !Array.isArray(data.completed)) {
      return { profile: null, completed: [], warning: 'Saved data could not be restored. Create a new roadmap to continue.' };
    }
    const ids = new Set(buildRoadmap(data.profile).tasks.map(task => task.id));
    return { profile: data.profile, completed: [...new Set(data.completed.filter(id => ids.has(id)))], warning: '' };
  } catch {
    return { profile: null, completed: [], warning: 'Browser storage is unavailable or unreadable. You can use your roadmap, but progress may not survive a refresh.' };
  }
}

export function saveProgress(storage, profile, completed) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, profile, completed }));
    return true;
  } catch {
    return false;
  }
}
