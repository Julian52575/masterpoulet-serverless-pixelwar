const toMillis = (value) => value?.toMillis?.() ?? value?.getTime?.() ?? value;

const COMPARE = {
  "<=": (a, b) => toMillis(a) <= toMillis(b),
  "<": (a, b) => toMillis(a) < toMillis(b),
  "==": (a, b) => toMillis(a) === toMillis(b)
};

function fakeFirestore() {
  const docs = new Map();
  let transactions = 0;
  let batches = 0;

  const write = (key, data, options) => {
    docs.set(key, options?.merge ? { ...(docs.get(key) ?? {}), ...data } : data);
  };

  const ref = (collection, id) => {
    const key = `${collection}/${id}`;
    return {
      key,
      id,
      set: async (data, options) => write(key, data, options),
      get: async () => ({ exists: docs.has(key), data: () => docs.get(key) }),
      delete: async () => { docs.delete(key); }
    };
  };

  const query = (collection, filters = [], max = Infinity) => ({
    where: (field, op, value) => query(collection, [...filters, [field, op, value]], max),
    limit: (n) => query(collection, filters, n),
    select: () => query(collection, filters, max),
    get: async () => {
      const prefix = `${collection}/`;
      const found = [...docs.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
        .filter(([, data]) => filters.every(([field, op, value]) => data[field] !== undefined && COMPARE[op](data[field], value)))
        .slice(0, max)
        .map(([key, data]) => ({ id: key.slice(prefix.length), ref: ref(collection, key.slice(prefix.length)), data: () => data }));
      return { docs: found, size: found.length, empty: found.length === 0 };
    }
  });

  return {
    docs,
    get transactions() {
      return transactions;
    },
    get batches() {
      return batches;
    },
    collection: (collection) => ({ doc: (id) => ref(collection, id), ...query(collection) }),
    batch: () => {
      const deletes = [];
      return {
        delete: (docRef) => { deletes.push(docRef.key); },
        commit: async () => {
          batches += 1;
          for (const key of deletes) docs.delete(key);
        }
      };
    },
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
