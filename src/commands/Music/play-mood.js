import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { runMusicDj } from '../../services/ai/musicDj.js';
import { createMusicDjSettingsStore, claimDjCooldown } from '../../services/ai/musicDjSettings.js';
import { createAIFeatureControlsStore } from '../../services/ai/featureControls.js';

export default {
    slashOnly: true,
    category: 'Music',
    data: new SlashCommandBuilder().setName('play-mood').setDescription('Use AI to add songs matching a mood')
        .setDMPermission(false)
        .addStringOption(o => o.setName('mood').setDescription('Mood sent to an external AI provider; do not include sensitive data').setRequired(true).setMaxLength(200))
        .addBooleanOption(o => o.setName('consent').setDescription('Agree to send the mood to an external AI provider').setRequired(true)),
    async execute(interaction, config, client) {
        if (!interaction.inGuild() || interaction.guildId !== client.homeGuildId || interaction.user.bot) return interaction.reply({ content: 'Command hanya tersedia di server.', flags: MessageFlags.Ephemeral });
        if (interaction.options.getBoolean('consent') !== true) return interaction.reply({ content: 'Persetujuan pengiriman suasana ke provider AI diperlukan.', flags: MessageFlags.Ephemeral });
        const mood = interaction.options.getString('mood')?.trim();
        if (!mood) return interaction.reply({ content: 'Isi suasana musik yang diinginkan.', flags: MessageFlags.Ephemeral });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (!(await createAIFeatureControlsStore(client).read(interaction.guildId)).musicDjEnabled) return interaction.editReply({ content: 'AI DJ belum diaktifkan di dashboard.', allowedMentions: { parse: [] } });
            const settings = await createMusicDjSettingsStore(client).read(interaction.guildId);
            const result = await runMusicDj({ client, interaction, mood, songCount:settings.songCount, beforeGenerate:()=>claimDjCooldown(interaction.guildId,settings.cooldownSeconds) });
            const safe = value => String(value || 'Tidak diketahui').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/[@`*_~|\\]/g, '').slice(0, 120);
            const list = result.tracks.map((track, i) => `${i + 1}. ${safe(track.title)} — ${safe(track.author)}`).join('\n');
            return interaction.editReply({ content: `AI DJ: ${result.tracks.length} lagu ditambahkan, ${result.skipped} dilewati.\n${list || 'Tidak ada lagu yang berhasil ditambahkan.'}`.slice(0, 2000), allowedMentions: { parse: [] } });
        } catch (error) {
            return interaction.editReply({ content: error.userMessage || (error.status && error.status < 500 ? error.message : 'AI DJ tidak tersedia. Periksa AI, voice channel, dan Lavalink.'), allowedMentions: { parse: [] } });
        }
    },
};
