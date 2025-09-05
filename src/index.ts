import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  ActivityType,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
  MessageFlags,
  Partials,
} from "discord.js";
import "dotenv/config";
import { fetchImageBuffer } from "./helpers/images.js";
import express from "express";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

function cleanB64(s: unknown) {
  const str = (s ?? "").toString();
  return str.startsWith("data:") ? str.replace(/^data:[^;]+;base64,/, "") : str;
}

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function ordinal(n: number): string {
  const v = n % 100;
  let suf = "th";
  if (v < 11 || v > 13) {
    switch (v % 10) {
      case 1:
        suf = "st";
        break;
      case 2:
        suf = "nd";
        break;
      case 3:
        suf = "rd";
        break;
    }
  }
  return `${n}${suf}`;
}

function rulesButton(guildId: string) {
  const rulesId = process.env.RULES_CHANNEL_ID;
  if (!rulesId) return null;
  const url = `https://discord.com/channels/${guildId}/${rulesId}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel("📜 Read the Rules")
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client?.user?.tag}`);

  client.user?.setPresence({
    activities: [{ name: "Overthinking 💭", type: ActivityType.Custom }],
    status: "online", // 'idle' | 'dnd' | 'invisible'
  });
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // ¿menciona al bot?
    const botId = client.user?.id;
    if (!botId) return;
    const mentioned =
      message.mentions.users.has(botId) ||
      new RegExp(`^<@!?${botId}>`).test(message.content);
    if (!mentioned) return;

    // prompt = contenido sin la mención
    const prompt =
      message.content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim() ||
      "Enhance or transform the provided image(s) as requested.";

    // recopilar imágenes del mensaje
    const images: Array<{
      url: string;
      mime: string;
      name: string;
      size: number;
    }> = [];
    for (const att of message.attachments.values()) {
      const mime = att.contentType || "";
      if (mime.startsWith("image/")) {
        images.push({
          url: att.url,
          mime,
          name: att.name ?? "image",
          size: att.size ?? 0,
        });
      }
    }

    // si es reply, también mirar adjuntos del mensaje citado
    if (message.reference?.messageId && images.length === 0) {
      try {
        const quoted = await message.fetchReference();
        for (const att of quoted.attachments.values()) {
          const mime = att.contentType || "";
          if (mime.startsWith("image/")) {
            images.push({
              url: att.url,
              mime,
              name: att.name ?? "image",
              size: att.size ?? 0,
            });
          }
        }
      } catch {}
    }

    // indicador de “escribiendo…”
    await message.channel.sendTyping();

    // payload para n8n (edición si hay imágenes; generación si no)
    const payload: any = {
      mode: images.length ? "edit" : "generate",
      prompt,
      images, // n8n descargará las URLs
      userId: message.author.id,
      channelId: message.channelId,
      guildId: message.guildId,
      messageId: message.id,
    };

    const res = await fetch(process.env.N8N_NANOBANANA_URL as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth": process.env.N8N_SHARED_SECRET || "",
      },
      body: JSON.stringify(payload),
    });

    // --- respuesta binaria (una imagen) ---
    const ct = res.headers.get("content-type") || "";
    if (ct.startsWith("image/") || ct === "application/octet-stream") {
      const buf = Buffer.from(await res.arrayBuffer());
      await message.reply({
        content: "", // o un caption corto
        files: [new AttachmentBuilder(buf, { name: "result.png" })],
      });
      return;
    }

    // --- respuesta JSON (una o varias imágenes) ---
    const raw = await res.text();
    let data: any = {};
    try {
      data = JSON.parse(raw);
    } catch {
      data = { text: raw };
    }

    const files: AttachmentBuilder[] = [];
    // array de base64
    if (Array.isArray(data.images_base64)) {
      for (let i = 0; i < Math.min(10, data.images_base64.length); i++) {
        const b64 = cleanB64(data.images_base64[i]);
        if (typeof b64 === "string" && b64.length > 100) {
          files.push(
            new AttachmentBuilder(Buffer.from(b64, "base64"), {
              name: data.fileNames?.[i] || `image_${i + 1}.png`,
            })
          );
        }
      }
    }
    // array de URLs
    if (!files.length && Array.isArray(data.image_urls)) {
      for (let i = 0; i < Math.min(10, data.image_urls.length); i++) {
        const u = data.image_urls[i];
        const r = await fetch(u);
        const buf = Buffer.from(await r.arrayBuffer());
        files.push(new AttachmentBuilder(buf, { name: `image_${i + 1}.png` }));
      }
    }
    // compat: un solo base64/url
    if (!files.length && (data.image_base64 || data.imageBase64)) {
      const b64 = cleanB64(data.image_base64 || data.imageBase64);
      files.push(
        new AttachmentBuilder(Buffer.from(b64, "base64"), {
          name: data.fileName || "image.png",
        })
      );
    } else if (!files.length && (data.image_url || data.imageUrl)) {
      const r = await fetch(data.image_url || data.imageUrl);
      const buf = Buffer.from(await r.arrayBuffer());
      files.push(
        new AttachmentBuilder(buf, { name: data.fileName || "image.png" })
      );
    }

    if (files.length) {
      await message.reply({ content: data.caption ?? "", files });
    } else {
      const text = (data.text ?? "No recibí imágenes del servicio.").slice(
        0,
        1900
      );
      await message.reply(text);
    }
  } catch (err) {
    console.error("mention->image error:", err);
    await message.reply("❌ No pude procesar tus imágenes. Intenta de nuevo.");
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.user.bot) return;

    const channelId =
      process.env.WELCOME_CHANNEL_ID || member.guild.systemChannelId;
    const ch = channelId
      ? await member.guild.channels.fetch(channelId).catch(() => null)
      : null;
    if (!ch?.isTextBased()) return;

    const url = await getLandscapeFromNekosBest("waifu", 1.3, 10);

    // 2) crear el banner con blur
    const buffer = await makeBlurBannerFromUrl({
      url: url || "",
      width: 1280,
      height: 640, // o 720 si prefieres 16:9
      overlayDarken: 0.22,
      border: true,
    });

    const count = member.guild.memberCount ?? 0;

    const headlines = [
      "🚀 Welcome aboard!",
      "🎉 Glad you’re here!",
      "🌟 A new star has arrived!",
      "🔥 Fresh energy in the server!",
    ];
    const sublines = [
      `Hey <@${member.id}>, make yourself at home.`,
      `We’ve been waiting for you, <@${member.id}>!`,
      `Big welcome to <@${member.id}>!`,
      `Great to have you with us, <@${member.id}>.`,
    ];
    const footerLines = [
      `You’re our **${ordinal(count)}** member.`,
      `Don’t be shy—say hi!`,
      `Type **/chat** if you need anything.`,
      `Check the rules and have fun!`,
    ];

    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle(pick(headlines) ?? null)
      .setDescription(
        `${pick(sublines)}\n\nWelcome to **${member.guild.name}**!\n${pick(
          footerLines
        )}`
      )
      .setThumbnail(
        member.user.displayAvatarURL({ extension: "png", size: 256 })
      )
      .setImage("attachment://welcome.png")
      .setTimestamp();

    const row = rulesButton(member.guild.id);

    await ch.send({
      embeds: [embed.setImage("attachment://welcome.png")],
      files: [{ attachment: buffer, name: "welcome.png" }],
      components: row ? [row] : [],
    });
  } catch (e) {
    console.error("Welcome card failed:", e);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const channelId =
      process.env.FAREWELL_CHANNEL_ID || member.guild.systemChannelId;
    const ch = channelId
      ? await member.guild.channels.fetch(channelId).catch(() => null)
      : null;
    if (!ch?.isTextBased()) return;

    const username = member.displayName || member.user?.username || "Member";
    const avatarUrl =
      member.user?.displayAvatarURL({ extension: "png", size: 512 }) ||
      "https://cdn.discordapp.com/embed/avatars/0.png";

    const url = await getLandscapeFromNekosBest("waifu", 1.3, 10);

    // 2) crear el banner con blur
    const buffer = await makeBlurBannerFromUrl({
      url: url || "",
      width: 1280,
      height: 640, // o 720 si prefieres 16:9
      overlayDarken: 0.22,
      border: true,
    });

    const headlines = [
      "👋 Farewell for now!",
      "💫 Until next time!",
      "🛫 Safe travels!",
      "🌌 See you on the next adventure!",
    ];
    const sublines = [
      `**${username}** just left **${member.guild.name}**.`,
      `Thanks for being with us, **${username}**.`,
      `We’ll miss you, **${username}**.`,
      `Hope to see you again, **${username}**!`,
    ];

    const embed = new EmbedBuilder()
      .setColor(0x1f2937)
      .setTitle(pick(headlines) ?? null)
      .setDescription(`${pick(sublines)}\n\nDoors are always open ✨`)
      .setThumbnail(avatarUrl)
      .setImage("attachment://farewell.png")
      .setTimestamp();

    await ch.send({
      embeds: [embed],
      files: [{ attachment: buffer, name: "farewell.png" }],
    });
  } catch (e) {
    console.error("Farewell send failed:", e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
    return;
  }

  if (interaction.commandName === "clean") {
    // Solo el usuario permitido
    if (interaction.user.id !== process.env.CLEAN_ALLOWED_USER_ID) {
      return interaction.reply({
        content: "❌ You can't use this command.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Asegúrate de que es en un servidor y hay canal
    if (!interaction.inGuild() || !interaction.channel) {
      return interaction.reply({
        content: "❌ This only works in server text channels.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const channel = interaction.channel;

    // Limítalo a canales de texto/announcement (bulkDelete no funciona en DMs/threads)
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement
    ) {
      return interaction.reply({
        content: "❌ Only in regular text channels.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const me = interaction.guild!.members.me;
    if (!me) {
      return interaction.reply({
        content: "❌ Bot member not found in this guild.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // ✅ En vez de channel.permissionsFor(me) usa:
    const perms = me.permissionsIn(channel.id);
    if (!perms.has(PermissionFlagsBits.ManageMessages)) {
      return interaction.reply({
        content: "❌ I need **Manage Messages** in this channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const amount = interaction.options.getInteger("amount", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const deleted = await (channel as TextChannel).bulkDelete(amount, true);
      await interaction.editReply(
        `🧹 Deleted **${deleted.size}** messages (older than 14 days can't be removed).`
      );
    } catch (err: any) {
      console.error("clean error:", err);
      await interaction.editReply(
        `❌ Couldn't delete messages.\n\`\`\`${err?.message ?? err}\`\`\``
      );
    }
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
  new SlashCommandBuilder()
    .setName("clean")
    .setDescription("Elimina mensajes recientes de este canal")
    .addIntegerOption((o) =>
      o
        .setName("amount")
        .setDescription("Cantidad (1-100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
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

/**
 * Devuelve una URL horizontal de nekos.best (si no encuentra, cae en la primera).
 * @param category  "waifu" | "neko" | "kitsune" | "husbando"
 * @param minAR     relación mínima (1.3 ≈ horizontal clara)
 * @param amount    cuántas candidatas pedir a la API (1..20)
 */
export async function getLandscapeFromNekosBest(
  category: "waifu" | "neko" | "kitsune" | "husbando" = "waifu",
  minAR = 1.3,
  amount = 8
) {
  const r = await fetch(
    `https://nekos.best/api/v2/${category}?amount=${Math.min(
      Math.max(amount, 1),
      20
    )}`
  );
  const j = await r.json();
  const urls: string[] = (j?.results || [])
    .map((x: any) => x?.url)
    .filter(Boolean);

  for (const u of urls) {
    try {
      const buf = await fetchImageBuffer(u); // ⬅️
      const img = await loadImage(buf); // ⬅️
      if (img.width / img.height >= minAR) return u;
    } catch {}
  }
  if (urls.length) return urls[0];
  throw new Error("nekos.best sin resultados");
}

/**
 * Banner "cinemático": blur del fondo + la misma imagen en limpio centrada.
 * Solo usa imágenes HORIZONTALES (minAR). Si no encuentra, usa la última como fallback.
 */
export async function makeBlurBannerFromUrl(opts: {
  url: string;
  width?: number;
  height?: number;
  overlayDarken?: number;
  border?: boolean;
}) {
  const {
    url,
    width = 1280,
    height = 640,
    overlayDarken = 0.22,
    border = true,
  } = opts;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // ⬇️ en vez de loadImage(url):
  const buf = await fetchImageBuffer(url);
  const img = await loadImage(buf);

  // fondo con blur (cover)
  try {
    (ctx as any).filter = "blur(22px)";
  } catch {}
  const s = Math.max(width / img.width, height / img.height);
  ctx.drawImage(
    img,
    (width - img.width * s) / 2,
    (height - img.height * s) / 2,
    img.width * s,
    img.height * s
  );
  try {
    (ctx as any).filter = "none";
  } catch {}

  if (overlayDarken > 0) {
    ctx.fillStyle = `rgba(0,0,0,${overlayDarken})`;
    ctx.fillRect(0, 0, width, height);
  }

  // panel limpio centrado
  const margin = 40;
  const s2 = Math.min(
    (width - margin * 2) / img.width,
    (height - margin * 2) / img.height
  );
  const dw = img.width * s2,
    dh = img.height * s2;
  const dx = (width - dw) / 2,
    dy = (height - dh) / 2;

  roundedRect(ctx, dx, dy, dw, dh, 20);
  ctx.save();
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();

  if (border) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    roundedRect(ctx, dx, dy, dw, dh, 20);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 6;
    ctx.strokeRect(12, 12, width - 24, height - 24);
  }

  return canvas.toBuffer("image/png");
}

function roundedRect(
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 16
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ─── Servidor para Render ───
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_, res) => res.send("Bot is alive 🚀"));
app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
