import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
} from "discord.js";
import "dotenv/config";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client?.user?.tag}`);

  client.user?.setPresence({
    activities: [{ name: "Chochox", type: ActivityType.Watching }],
    status: "online", // "online" | "idle" | "dnd" | "invisible"
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
    return;
  }

  if (interaction.commandName === "chat") {
    const prompt = interaction.options.getString("prompt", true);
    await interaction.deferReply(); // mientras n8n responde

    try {
      const res = await fetch(process.env.N8N_WEBHOOK_URL as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth": process.env.N8N_SHARED_SECRET || "", // opcional si validas en n8n
        },
        body: JSON.stringify({
          prompt,
          userId: interaction.user.id,
          channelId: interaction.channelId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      const text: string = (
        data?.text ?? "No recibí respuesta del servicio."
      ).slice(0, 1900);
      await interaction.editReply(text);
    } catch (err) {
      console.error(err);
      await interaction.editReply("❌ Error al consultar la IA.");
    }
  }
});

client.login(process.env.TOKEN);

// ── Register slash commands (ping + chat)
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with Pong!"),
  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Pregunta a la IA vía n8n")
    .addStringOption((o) =>
      o
        .setName("prompt")
        .setDescription("¿Qué quieres preguntar?")
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN as string);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID as string,
        process.env.GUILD_ID as string
      ),
      { body: commands }
    );
    console.log("Slash commands registered!");
  } catch (error) {
    console.error(error);
  }
})();