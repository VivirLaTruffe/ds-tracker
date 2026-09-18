/*
 * Persistence. Three layers, all optional except the first:
 *  1. localStorage  — safety-net copy, always written.
 *  2. Linked file   — File System Access API (Chromium): the user picks a .json, we autosave to it.
 *  3. Import/Export — plain download/upload, works in every browser.
 */
'use strict';

const LS_DATA_KEY = 'ds-tracker:data:v1';
const LS_PREFS_KEY = 'ds-tracker:prefs:v1';
const IDB_NAME = 'ds-tracker';
const IDB_STORE = 'kv';
const IDB_HANDLE_KEY = 'fileHandle';
const JSON_PICKER_TYPES = [{ description: 'Données DS Tracker (JSON)', accept: { 'application/json': ['.json'] } }];

const Local = {
  loadData() {
    try {
      const txt = localStorage.getItem(LS_DATA_KEY);
      return txt ? sanitizeData(JSON.parse(txt)) : null;
    } catch (e) {
      return null;
    }
  },
  saveData(data) {
    try {
      localStorage.setItem(LS_DATA_KEY, JSON.stringify(data));
    } catch (e) { /* storage full or blocked: the linked file / export still work */ }
  },
  loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(LS_PREFS_KEY)) || {};
    } catch (e) {
      return {};
    }
  },
  savePrefs(prefs) {
    try {
      localStorage.setItem(LS_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) { /* ignore */ }
  },
};

/* ---- tiny IndexedDB key/value store, only used to remember the file handle ---- */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    if (value === undefined) tx.objectStore(IDB_STORE).delete(key);
    else tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- linked file ---- */

const FileLink = {
  handle: null,
  lastModified: 0,

  get supported() {
    return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function';
  },

  get name() {
    return this.handle ? this.handle.name : '';
  },

  async _readHandle() {
    const file = await this.handle.getFile();
    this.lastModified = file.lastModified;
    const text = await file.text();
    // An empty file (just created by the user) means "no data yet".
    if (!text.trim()) return null;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error("Ce fichier n'est pas du JSON valide.");
    }
    return sanitizeData(parsed);
  },

  /** Ask the user to pick an existing file. Returns its data (null if the file is empty). */
  async pickExisting() {
    const [handle] = await window.showOpenFilePicker({ types: JSON_PICKER_TYPES, multiple: false });
    this.handle = handle;
    const data = await this._readHandle();
    await idbSet(IDB_HANDLE_KEY, handle);
    return data;
  },

  /** Ask the user where to create a new file, and write `data` into it. */
  async pickNew(data) {
    this.handle = await window.showSaveFilePicker({ suggestedName: 'ds-tracker.json', types: JSON_PICKER_TYPES });
    await idbSet(IDB_HANDLE_KEY, this.handle);
    await this.write(data);
  },

  /**
   * Try to re-attach the file used last time.
   * Returns 'none' | 'ready' | 'needs-permission'. Never prompts.
   */
  async restore() {
    if (!this.supported) return 'none';
    try {
      const handle = await idbGet(IDB_HANDLE_KEY);
      if (!handle) return 'none';
      this.handle = handle;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      return perm === 'granted' ? 'ready' : 'needs-permission';
    } catch (e) {
      return 'none';
    }
  },

  /** Must be called from a user gesture (click). Returns the file's data. */
  async grantAndRead() {
    const perm = await this.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Accès au fichier refusé.');
    return this._readHandle();
  },

  async read() {
    return this._readHandle();
  },

  async write(data) {
    const writable = await this.handle.createWritable();
    await writable.write(JSON.stringify(data, null, 2) + '\n');
    await writable.close();
    this.lastModified = (await this.handle.getFile()).lastModified;
  },

  /** True if the file changed on disk since we last read/wrote it (e.g. after a git pull). */
  async changedOnDisk() {
    if (!this.handle) return false;
    try {
      return (await this.handle.getFile()).lastModified !== this.lastModified;
    } catch (e) {
      return false;
    }
  },

  async unlink() {
    this.handle = null;
    this.lastModified = 0;
    try {
      await idbSet(IDB_HANDLE_KEY, undefined);
    } catch (e) { /* ignore */ }
  },
};

/* ---- import / export (works everywhere) ---- */

function exportToDownload(data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ds-tracker-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function parseImportedFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    throw new Error("Ce fichier n'est pas du JSON valide.");
  }
  return sanitizeData(parsed);
}
