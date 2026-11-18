function readDrawTopic(env = process.env) {
  return env.DRAW_TOPIC?.trim();
}

// Dev only: token-less draws are attributed to a fixed fake user.
const readBypassDiscord = (env = process.env) => env.BYPASS_DISCORD?.trim().toLowerCase() === "true";

function checkConfig(env = process.env) {
  const problems = [];
  if (!readDrawTopic(env)) problems.push("DRAW_TOPIC is not configured");
  return problems;
}

module.exports = { checkConfig, readDrawTopic, readBypassDiscord };
