const database = new Promise((resolve, reject) => {
  const req = indexedDB.open('eitaa-file-catalog', 1);
  req.onupgradeneeded = () => {
    req.result.createObjectStore('sessions', { keyPath: 'identity' });
    const files = req.result.createObjectStore('files', { keyPath: 'id' });
    files.createIndex('session', 'identity');
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function transact(stores, action, write = false) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, write ? 'readwrite' : 'readonly');
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('ذخیره اطلاعات ناموفق بود.'));
    action(tx, value => { result = value; });
  });
}
const Store = {
  session: identity => transact(['sessions'], (tx, done) => {
    tx.objectStore('sessions').get(identity).onsuccess = e => done(e.target.result);
  }),
  sessions: () => transact(['sessions'], (tx, done) => {
    tx.objectStore('sessions').getAll().onsuccess = e => done(e.target.result);
  }),
  saveSession: session => transact(['sessions'], tx => tx.objectStore('sessions').put(session), true),
  files: identity => transact(['files'], (tx, done) => {
    tx.objectStore('files').index('session').getAll(identity).onsuccess = e => done(e.target.result);
  }),
  saveFile: file => transact(['files'], tx => tx.objectStore('files').put(file), true),
  page: (session, files) => transact(['sessions', 'files'], tx => {
    tx.objectStore('sessions').put(session);
    const store = tx.objectStore('files');
    for (const file of files) {
      const id = `${session.identity}:${file.key}`;
      store.get(id).onsuccess = e => {
        const previous = e.target.result;
        store.put({ ...file, ...previous, name: file.name, ext: file.ext, size: file.size || previous?.size || 0,
          lastSeenScan: session.scanId, id, identity: session.identity });
      };
    }
  }, true),
  prune: session => transact(['files'], tx => {
    tx.objectStore('files').index('session').openCursor(session.identity).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { if (cursor.value.lastSeenScan !== session.scanId) cursor.delete(); cursor.continue(); }
    };
  }, true),
  clear: identity => transact(['sessions', 'files'], tx => {
    tx.objectStore('sessions').delete(identity);
    tx.objectStore('files').index('session').openCursor(identity).onsuccess = e => {
      const cursor = e.target.result;
      if (cursor) { cursor.delete(); cursor.continue(); }
    };
  }, true)
};
