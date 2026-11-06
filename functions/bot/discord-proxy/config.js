const PUBLIC_KEY = /^[0-9a-f]{64}$/i;

function readPublicKey(env = process.env) {
  return env.DISCORD_PUBLIC_KEY?.trim();
}

function checkConfig(env = process.env) {
  const problems = [];
  const publicKey = readPublicKey(env);

  if (!publicKey) problems.push("DISCORD_PUBLIC_KEY is not configured");
  else if (!PUBLIC_KEY.test(publicKey)) problems.push("DISCORD_PUBLIC_KEY must be 64 hexadecimal characters");

  if (!env.PUBSUB_TOPIC?.trim()) problems.push("PUBSUB_TOPIC is not configured");

  return problems;
}

module.exports = { checkConfig, readPublicKey };
