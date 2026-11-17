const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/;

function loadConfig(env = process.env) {
  const bucket = String(env.SNAPSHOT_BUCKET ?? "").trim();
  const storageEndpoint = String(env.STORAGE_API_ENDPOINT ?? "").trim() || null;
  const problems = [];

  if (!bucket) problems.push("SNAPSHOT_BUCKET is not configured");
  else if (!BUCKET_NAME.test(bucket)) problems.push("SNAPSHOT_BUCKET is not a valid bucket name");

  return { bucket, storageEndpoint, problems };
}

module.exports = { loadConfig };
