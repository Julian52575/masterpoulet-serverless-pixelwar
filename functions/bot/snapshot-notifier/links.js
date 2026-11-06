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

  return { metadataOf, signedUrl };
}

module.exports = { createSnapshotFiles };
