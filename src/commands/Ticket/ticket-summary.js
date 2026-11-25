import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getTicketPermissionContext } from '../../utils/ticket/ticketPermissions.js';
import { summarizeTicket } from '../../services/ai/ticketSummary.js';
import { createAIFeatureControlsStore } from '../../services/ai/featureControls.js';

export default {
    slashOnly: true,
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-summary')
        .setDescription('Privately summarize ticket messages with AI')
        .setDMPermission(false)
        .addBooleanOption(option => option.setName('consent').setDescription('Send ticket text to an external AI provider').setRequired(true)),
    async execute(interaction, guildConfig, client) {
        if (!interaction.inGuild() || interaction.guildId !== client.homeGuildId || interaction.user.bot) {
            return interaction.reply({ content: 'Command hanya tersedia di server.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            if (interaction.options.getBoolean('consent') !== true) return interaction.editReply({ content: 'Persetujuan pengiriman teks tiket ke provider AI diperlukan.', allowedMentions: { parse: [] } });
            const context = await getTicketPermissionContext({ client, interaction });
            if (!context.ticketData || !context.canManageTicket) return interaction.editReply({ content: 'Hanya staff dapat merangkum di channel tiket yang valid.', allowedMentions: { parse: [] } });
            if (!(await createAIFeatureControlsStore(client).read(interaction.guildId)).ticketSummaryEnabled) return interaction.editReply({ content: 'AI Ticket Summary belum diaktifkan di dashboard.', allowedMentions: { parse: [] } });
            const summary = await summarizeTicket({ client, channel: interaction.channel, userId: interaction.user.id });
            return interaction.editReply({ content: `**Ringkasan AI** (sampel pesan awal dan terbaru; hanya teks, bisa terpotong)\n${summary.text}`.slice(0, 2000), allowedMentions: { parse: [] } });
        } catch (error) {
            return interaction.editReply({ content: error.status && error.status < 500 ? error.message : 'Ringkasan AI tidak tersedia. Coba lagi nanti.', allowedMentions: { parse: [] } });
        }
    },
};
