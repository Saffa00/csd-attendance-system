import Dexie from 'dexie';
import { apiFetch } from './api';

/**
 * Student offline storage (IndexedDB via Dexie).
 *  - cache: last good API responses (profile, courses, timetable, today, history), scoped per user
 *  - queue: attendance submissions made offline, synced when the connection returns
 * Only student accounts use this. It is wiped on sign-out.
 */
export const db = new Dexie('cs-attendance');
db.version(1).stores({ cache: 'key', queue: '++id,session_id,client_timestamp' });
db.version(2).stores({ cache: 'key', queue: '++id,user_id,status,client_timestamp' });

const MAX_AGE_MS = 48 * 3600 * 1000;
const changed = () => window.dispatchEvent(new Event('queue-changed'));

// ---------------------------------------------------------------- cache
export const cacheSet = (userId, name, value) => db.cache.put({ key: `${userId}:${name}`, value, updated_at: Date.now() });
export const cacheGet = async (userId, name) => (await db.cache.get(`${userId}:${name}`)) || null;

/** Network first; falls back to the cached copy when offline. Returns { data, fromCache, updatedAt }. */
export async function cachedGet(userId, name, path) {
  try {
    const data = await apiFetch(path);
    cacheSet(userId, name, data).catch(() => {});
    return { data, fromCache: false };
  } catch (e) {
    if (!e.network) throw e;
    const hit = await cacheGet(userId, name);
    if (hit) return { data: hit.value, fromCache: true, updatedAt: hit.updated_at };
    throw e;
  }
}

export async function wipeLocalData() {
  await Promise.all([db.cache.clear(), db.queue.clear()]);
  changed();
}

// ---------------------------------------------------------------- offline attendance queue
export async function queueAttendance(userId, record) {
  await db.queue.add({ ...record, user_id: userId, status: 'queued', client_timestamp: new Date().toISOString(), created_at: Date.now() });
  changed();
}
export const listQueue = userId => db.queue.where('user_id').equals(userId).toArray();
export async function queueCount(userId) {
  return db.queue.where('user_id').equals(userId).and(i => i.status === 'queued').count();
}
export async function dismissQueued(id) { await db.queue.delete(id); changed(); }

let syncing = false;
/**
 * Sends queued submissions one by one. The server re-validates location, code, time window and
 * the 48 hour limit. Network / server errors keep the item for the next attempt; a definite
 * rejection is kept as "failed" with the reason so the student can see it.
 */
export async function syncQueue(userId) {
  if (syncing || !navigator.onLine) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    const items = (await listQueue(userId)).filter(i => i.status === 'queued').sort((a, b) => a.id - b.id);
    for (const item of items) {
      if (Date.now() - Date.parse(item.client_timestamp) > MAX_AGE_MS) {
        await db.queue.update(item.id, { status: 'failed', error: 'Older than 48 hours, so it could not be submitted.' });
        failed++; continue;
      }
      const { id, user_id, status, created_at, error, ...payload } = item;
      try {
        await apiFetch('/attendance', { method: 'POST', body: { ...payload, submitted_offline: true } });
        await db.queue.delete(id); synced++;
      } catch (e) {
        if (e.network || e.status >= 500 || e.status === 429) break;          // try again later
        if (e.code === 'ALREADY') { await db.queue.delete(id); continue; }    // already recorded on the server
        await db.queue.update(id, { status: 'failed', error: e.message }); failed++;
      }
    }
  } finally {
    syncing = false;
    changed();
  }
  return { synced, failed };
}
