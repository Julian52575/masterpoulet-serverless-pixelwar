function loadConfig(env = process.env) {
  const pixelEventsTopic = String(env.PIXEL_EVENTS_TOPIC ?? "").trim();
  const problems = [];

  if (!pixelEventsTopic) problems.push("PIXEL_EVENTS_TOPIC is not configured");

  return { pixelEventsTopic, problems };
}

module.exports = { loadConfig };
