function readDrawTopic(env = process.env) {
  return env.DRAW_TOPIC?.trim();
}

function checkConfig(env = process.env) {
  const problems = [];
  if (!readDrawTopic(env)) problems.push("DRAW_TOPIC is not configured");
  return problems;
}

module.exports = { checkConfig, readDrawTopic };
