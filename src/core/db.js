// IndexedDB store — offline-first, everything stays on the device (blobs included).
const DB_NAME = 'nexus3d';
const DB_VER = 1;
const STORES = ['projects', 'deliverables', 'models', 'plotplans', 'viewpoints', 'clashtests'];

let _db;
let memoryFallback = null; // used when IndexedDB is unavailable (private mode, sandboxed preview)

function open() {
  if (_db) return _db;
  _db = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (s !== 'projects') os.createIndex('projectId', 'projectId');
        }
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).then((db) => {
    if (!db) {
      memoryFallback = Object.fromEntries([...STORES, 'meta'].map((s) => [s, new Map()]));
      console.warn('[db] IndexedDB unavailable — using in-memory store');
    }
    return db;
  });
  return _db;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return fn(null, memoryFallback[store]);
  const t = db.transaction(store, mode);
  const out = await fn(t.objectStore(store));
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out;
}

export const db = {
  async all(store) {
    return tx(store, 'readonly', (os, mem) => (mem ? [...mem.values()] : wrap(os.getAll())));
  },
  async get(store, id) {
    return tx(store, 'readonly', (os, mem) => (mem ? mem.get(id) : wrap(os.get(id))));
  },
  async put(store, obj) {
    obj.updated = Date.now();
    await tx(store, 'readwrite', (os, mem) => (mem ? mem.set(obj.id ?? obj.key, obj) : wrap(os.put(obj))));
    return obj;
  },
  async del(store, id) {
    return tx(store, 'readwrite', (os, mem) => (mem ? mem.delete(id) : wrap(os.delete(id))));
  },
  async byProject(store, projectId) {
    return tx(store, 'readonly', (os, mem) => (mem
      ? [...mem.values()].filter((r) => r.projectId === projectId)
      : wrap(os.index('projectId').getAll(projectId))));
  },
  async deleteProject(projectId) {
    for (const s of STORES.filter((x) => x !== 'projects')) {
      const rows = await db.byProject(s, projectId);
      for (const r of rows) await db.del(s, r.id);
    }
    await db.del('projects', projectId);
  },
  async meta(key, value) {
    if (value === undefined) {
      const r = await tx('meta', 'readonly', (os, mem) => (mem ? mem.get(key) : wrap(os.get(key))));
      return r?.value;
    }
    return tx('meta', 'readwrite', (os, mem) => (mem ? mem.set(key, { key, value }) : wrap(os.put({ key, value }))));
  },
  get persistent() { return !memoryFallback; },
};

export async function requestPersistence() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return false;
}
