function createSnapshotFiles({ bucket, now = () => Date.now() }) {
  async function metadataOf(name) {
    const [metadata] = await bucket.file(name).getMetadata();
    return metadata.metadata ?? {};
  }

  async function signedUrl(name, ttlMinutes) {
    const [url] = await bucket.file(name).getSignedUrl({
      version: "v4",
      action: "read",
      expires: now() + ttlMinutes * 60 * 1000
    });
    return url;
  }

  async function readJson(name) {
    try {
      const [data] = await bucket.file(name).download();
      return JSON.parse(data.toString("utf8"));
    } catch (error) {
      if (error?.code === 404) return null;
      throw error;
    }
  }

  return { metadataOf, signedUrl, readJson };
}

module.exports = { createSnapshotFiles };
