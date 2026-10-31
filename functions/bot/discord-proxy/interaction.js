const SUB_COMMAND = 1;

const COMMANDS = {
  draw: ["x", "y", "color"],
  get: [],
  snapshot: []
};

const ADMIN_COMMANDS = {
  pause: [],
  resume: [],
  clear: [],
  ratelimit: ["user", "limit"]
};

function readOptions(options = [], expected) {
  const payload = {};
  for (const name of expected) {
    const option = options.find((o) => o.name === name);
    if (option === undefined) return null;
    payload[name] = option.value;
  }
  return payload;
}

function resolveCommand(data) {
  if (!data || typeof data.name !== "string") return null;

  if (data.name === "admin") {
    const sub = data.options?.[0];
    if (sub?.type !== SUB_COMMAND || !Object.hasOwn(ADMIN_COMMANDS, sub.name)) return null;
    const payload = readOptions(sub.options, ADMIN_COMMANDS[sub.name]);
    return payload && { type: `admin.${sub.name}`, payload };
  }

  if (!Object.hasOwn(COMMANDS, data.name)) return null;
  const payload = readOptions(data.options, COMMANDS[data.name]);
  return payload && { type: data.name, payload };
}

function parseInteraction(interaction) {
  const command = resolveCommand(interaction?.data);
  const user = interaction?.member?.user ?? interaction?.user;
  if (!command || !user?.id) return null;

  return {
    ...command,
    user_id: user.id,
    username: user.global_name ?? user.username,
    roles: interaction.member?.roles ?? [],
    guild_id: interaction.guild_id ?? null,
    channel_id: interaction.channel_id ?? null,
    application_id: interaction.application_id,
    interaction_id: interaction.id,
    interaction_token: interaction.token
  };
}

module.exports = { parseInteraction };
