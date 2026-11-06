
const {
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("draw")
    .setDescription("Draw one pixel on the canvas")
    .addIntegerOption(option =>
      option.setName("x")
        .setDescription("Pixel X coordinate")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("y")
        .setDescription("Pixel Y coordinate")
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName("color")
        .setDescription("Pixel color, for example #ff0000")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("get")
    .setDescription("Get the current canvas image"),

  new SlashCommandBuilder()
    .setName("snapshot")
    .setDescription("Create a timestamped canvas snapshot"),

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Canvas administration")
    .addSubcommand(sub =>
      sub.setName("pause")
        .setDescription("Pause drawing")
    )
    .addSubcommand(sub =>
      sub.setName("resume")
        .setDescription("Resume drawing")
    )
    .addSubcommand(sub =>
      sub.setName("clear")
        .setDescription("Clear the canvas")
    )
    .addSubcommand(sub =>
      sub.setName("ratelimit")
        .setDescription("Set a user's rate limit")
        .addUserOption(option =>
          option.setName("user")
            .setDescription("User to configure")
            .setRequired(true)
        )
        .addIntegerOption(option =>
          option.setName("limit")
            .setDescription("Maximum draws per minute")
            .setMinValue(1)
            .setRequired(true)
        )
    )
].map(command => command.toJSON());

async function main() {
  const { DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID } =
    process.env;

  if (!DISCORD_APPLICATION_ID || !DISCORD_BOT_TOKEN ||
      !DISCORD_GUILD_ID) {
    throw new Error(
      "Set DISCORD_APPLICATION_ID, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID"
    );
  }

  const rest = new REST({ version: "10" })
    .setToken(DISCORD_BOT_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      DISCORD_APPLICATION_ID,
      DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  console.log("Seven slash commands registered successfully.");
}

main().catch(error => {
  console.error("Command registration failed:", error);
  process.exitCode = 1;
});
