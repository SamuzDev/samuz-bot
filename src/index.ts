import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  TextChannel,
  ChannelType,
  AttachmentBuilder,
} from "discord.js";
import "dotenv/config";
import express from "express";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

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

  const message =
    `👋 ¡Bienvenid@ ${member} a **${member.guild.name}**!\n` +
    `Pasa por #reglas y usa \`/chat\` si necesitas ayuda.`;

  // Canal elegido por .env o canal del sistema como fallback
  const channelId =
    process.env.WELCOME_CHANNEL_ID || member.guild.systemChannelId;

  try {
    if (channelId) {
      const ch = await member.guild.channels.fetch(channelId).catch(() => null);
      if (ch && ch.type === ChannelType.GuildText) {
        await (ch as TextChannel).send({ content: message });
        return;
      }
    }
    // Si no hay canal/permiso, intentamos por DM
    await member.send(
      `¡Hola ${member.displayName}! Bienvenid@ a **${member.guild.name}**.`
    );
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

  if (interaction.commandName === "imagine") {
    const prompt = interaction.options.getString("prompt", true);
    const attachment = interaction.options.getAttachment("image"); // opcional
    await interaction.deferReply();

    try {
      const payload: any = {
        prompt,
        userId: interaction.user.id,
        channelId: interaction.channelId,
      };
      if (attachment) {
        payload.imageUrl = attachment.url; // n8n la descargará
        payload.imageMime = attachment.contentType || ""; // pista de MIME
      }

      const res = await fetch(process.env.N8N_NANOBANANA_URL as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth": process.env.N8N_SHARED_SECRET || "",
        },
        body: JSON.stringify(payload),
      });

      const ct = res.headers.get("content-type") || "";
      const cd = res.headers.get("content-disposition") || "";
      const clen = Number(res.headers.get("content-length") || 0);

      // Si n8n responde BINARIO (image/png, image/jpeg o application/octet-stream)
      if (ct.startsWith("image/") || ct === "application/octet-stream") {
        const buf = Buffer.from(await res.arrayBuffer());
        const fileNameFromCD = (
          cd.match(/filename\*?=(?:UTF-8''|")?([^\";]+)/i)?.[1] || ""
        ).replace(/"/g, "");
        const fileName = fileNameFromCD || "nano-banana.png";

        console.log("[n8n] binary response:", {
          status: res.status,
          ct,
          clen,
          fileName,
          size: buf.length,
        });

        await interaction.editReply({
          content: "", // Si quieres, puedes poner un caption fijo
          files: [new AttachmentBuilder(buf, { name: fileName })],
        });
        return;
      }

      // Si NO es binario, tratamos como JSON (tu flujo anterior)
      const raw = await res.text();
      console.log(
        "[n8n] status:",
        res.status,
        "ct:",
        ct,
        "preview:",
        raw.slice(0, 120)
      );

      let data: any = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = { text: raw };
      }

      const { b64, fileName, caption, imageUrl } = extractImagePayload(data);

      if (
        typeof b64 === "string" &&
        /^[A-Za-z0-9+/=\r\n]+$/.test(b64) &&
        b64.length > 100
      ) {
        const buffer = Buffer.from(b64, "base64");
        await interaction.editReply({
          content: caption,
          files: [new AttachmentBuilder(buffer, { name: fileName })],
        });
        console.log("[OUT] sent base64 image:", {
          fileName,
          size: buffer.length,
        });
      } else if (imageUrl) {
        const imgRes = await fetch(imageUrl);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        await interaction.editReply({
          content: caption,
          files: [new AttachmentBuilder(buf, { name: fileName })],
        });
        console.log("[OUT] sent image from URL:", imageUrl, {
          fileName,
          size: buf.length,
        });
      } else {
        const text = (
          data?.text ?? "No recibí una imagen del servicio. Revisa logs."
        ).slice(0, 1900);
        console.log(
          "[OUT] no image fields in data keys:",
          Object.keys(data || {})
        );
        await interaction.editReply(text);
      }
    } catch (err) {
      console.error(err);
      await interaction.editReply("❌ Error al generar la imagen.");
    }
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
  new SlashCommandBuilder()
    .setName("imagine")
    .setDescription("Genera/edita una imagen con Nano Banana")
    .addStringOption((o) =>
      o
        .setName("prompt")
        .setDescription("Describe lo que quieres")
        .setRequired(true)
    )
    .addAttachmentOption((o) =>
      o
        .setName("image")
        .setDescription("Imagen base (opcional)")
        .setRequired(false)
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

function extractImagePayload(data: any) {
  // acepta variantes (image_base64 / imageBase64) y quita prefijo data:
  let b64 =
    data?.image_base64 ||
    data?.imageBase64 ||
    data?.data?.image_base64 ||
    data?.data?.imageBase64 ||
    "";

  if (typeof b64 === "string" && b64.startsWith("data:")) {
    b64 = b64.replace(/^data:\w+\/[\w.+-]+;base64,/, "");
  }

  const fileName = (data?.fileName || "image.png").toString();
  const caption = (data?.caption || "").toString();
  const imageUrl = data?.image_url || data?.imageUrl || "";

  return { b64, fileName, caption, imageUrl };
}

// ─── Servidor para Render ───
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("Bot is alive 🚀"));
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
