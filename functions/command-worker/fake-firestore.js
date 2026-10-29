function fakeFirestore() {
  const docs = new Map();
  return {
    docs,
    collection: (collection) => ({
      doc: (id) => {
        const key = `${collection}/${id}`;
        return {
          set: async (data, options) => {
            docs.set(key, options?.merge ? { ...(docs.get(key) ?? {}), ...data } : data);
          },
          get: async () => ({ exists: docs.has(key), data: () => docs.get(key) })
        };
      }
    })
  };
}

module.exports = { fakeFirestore };
