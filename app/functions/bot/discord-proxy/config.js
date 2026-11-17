const PUBLIC_KEY = /^[0-9a-f]{64}$/i;
const SNOWFLAKE = /^\d{1,20}$/;

const TOPICS = {
  draw: "DRAW_TOPIC",
  commands: "COMMANDS_TOPIC",
  snapshot: "SNAPSHOT_TOPIC"
};

function readPublicKey(env = process.env) {
  return env.DISCORD_PUBLIC_KEY?.trim();
}

function readTopic(route, env = process.env) {
  return env[TOPICS[route]]?.trim();
}

function parseIdList(value) {
  return String(value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function readAdmins(env = process.env) {
  return { userIds: parseIdList(env.ADMIN_USER_IDS), roleIds: parseIdList(env.ADMIN_ROLE_IDS) };
}

function checkConfig(env = process.env) {
  const problems = [];
  const publicKey = readPublicKey(env);

  if (!publicKey) problems.push("DISCORD_PUBLIC_KEY is not configured");
  else if (!PUBLIC_KEY.test(publicKey)) problems.push("DISCORD_PUBLIC_KEY must be 64 hexadecimal characters");

  for (const [route, variable] of Object.entries(TOPICS)) {
    if (!readTopic(route, env)) problems.push(`${variable} is not configured`);
  }

  const { userIds, roleIds } = readAdmins(env);
  for (const [name, ids] of [["ADMIN_USER_IDS", userIds], ["ADMIN_ROLE_IDS", roleIds]]) {
    const invalid = ids.filter((id) => !SNOWFLAKE.test(id));
    if (invalid.length > 0) problems.push(`${name} contains invalid Discord ids: ${invalid.join(", ")}`);
  }

  return problems;
}

module.exports = { checkConfig, readAdmins, readPublicKey, readTopic, TOPICS };
