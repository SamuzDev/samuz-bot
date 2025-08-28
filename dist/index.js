import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } from "discord.js";
import "dotenv/config";
import express from "express";
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client?.user?.tag}`);
});
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    }
});
client.login(process.env.TOKEN);
// Register slash command
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Replies with Pong!')
].map(cmd => cmd.toJSON());
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
        console.log('Slash command registered!');
    }
    catch (error) {
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
//# sourceMappingURL=index.js.map