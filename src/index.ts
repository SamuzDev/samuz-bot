import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  TextChannel,
  ChannelType
} from "discord.js";
import "dotenv/config";
import express from "express";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client?.user?.tag}`);

  client.user?.setPresence({
    activities: [{ name: "Chochox", type: ActivityType.Watching }],
    status: "online", // "online" | "idle" | "dnd" | "invisible"
  });
});

client.on(Events.GuildMemberAdd, async (member) => {
  // No saludar bots
  if (member.user.bot) return;

  const message = `👋 ¡Bienvenid@ ${member} a **${member.guild.name}**!\n` +
                  `Pasa por #reglas y usa \`/chat\` si necesitas ayuda.`;

  // Canal elegido por .env o canal del sistema como fallback
  const channelId = process.env.WELCOME_CHANNEL_ID || member.guild.systemChannelId;

  try {
    if (channelId) {
      const ch = await member.guild.channels.fetch(channelId).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) {
        await (ch as TextChannel).send({ content: message });
        return;
      }
    }
    // Si no hay canal/permiso, intentamos por DM
    await member.send(`¡Hola ${member.displayName}! Bienvenid@ a **${member.guild.name}**.`);
  } catch (err) {
    console.error("Welcome message failed:", err);
  }
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

// ─── Servidor para Render ───
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("Bot is alive 🚀"));
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
