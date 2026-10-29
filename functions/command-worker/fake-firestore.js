function fakeFirestore() {
  const docs = new Map();
  let transactions = 0;

  const write = (key, data, options) => {
    docs.set(key, options?.merge ? { ...(docs.get(key) ?? {}), ...data } : data);
  };

  const ref = (collection, id) => {
    const key = `${collection}/${id}`;
    return {
      key,
      set: async (data, options) => write(key, data, options),
      get: async () => ({ exists: docs.has(key), data: () => docs.get(key) })
    };
  };

  return {
    docs,
    get transactions() {
      return transactions;
    },
    collection: (collection) => ({ doc: (id) => ref(collection, id) }),
    runTransaction: async (fn) => {
      transactions += 1;
      const writes = [];
      const tx = {
        get: (docRef) => docRef.get(),
        getAll: (...refs) => Promise.all(refs.map((docRef) => docRef.get())),
        set: (docRef, data, options) => {
          writes.push([docRef.key, data, options]);
          return tx;
        }
      };
      const result = await fn(tx);
      for (const [key, data, options] of writes) write(key, data, options);
      return result;
    }
  };
}

module.exports = { fakeFirestore };
