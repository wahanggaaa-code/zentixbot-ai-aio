import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getTicketPermissionContext } from '../../utils/ticket/ticketPermissions.js';
import { summarizeTicket } from '../../services/ai/ticketSummary.js';
import { createAIFeatureControlsStore } from '../../services/ai/featureControls.js';

export default {
    slashOnly: true,
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-priority-ai')
        .setDescription('Privately request an AI priority suggestion without changing the ticket')
        .setDMPermission(false)
        .addBooleanOption(option => option.setName('consent').setDescription('Send ticket text to an external AI provider').setRequired(true)),
    async execute(interaction, guildConfig, client) {
        if (!interaction.inGuild() || interaction.guildId !== client.homeGuildId || interaction.user.bot) return interaction.reply({content:'Command hanya tersedia di server.',flags:MessageFlags.Ephemeral});
        await interaction.deferReply({flags:MessageFlags.Ephemeral});
        try {
            if (interaction.options.getBoolean('consent') !== true) return interaction.editReply({content:'Persetujuan pengiriman teks tiket ke provider AI diperlukan.',allowedMentions:{parse:[]}});
            const context = await getTicketPermissionContext({client,interaction});
            if (!context.ticketData || !context.canManageTicket) return interaction.editReply({content:'Hanya staff dapat meminta saran di channel tiket yang valid.',allowedMentions:{parse:[]}});
            if (!(await createAIFeatureControlsStore(client).read(interaction.guildId)).ticketPrioritySuggestionEnabled) return interaction.editReply({content:'Saran urgensi AI belum diaktifkan di dashboard.',allowedMentions:{parse:[]}});
            const result = await summarizeTicket({client,channel:interaction.channel,userId:interaction.user.id,purpose:'priority'});
            const labels = {urgent:'Mendesak',high:'Tinggi',medium:'Sedang',low:'Rendah',unknown:'Belum dapat ditentukan'};
            return interaction.editReply({content:`**Saran urgensi AI: ${labels[result.level]}**\n${result.reason}\n\n-# Hanya saran berdasarkan sampel pesan, bukan keputusan otomatis. Staff harus memeriksa dan menentukan prioritas.`,allowedMentions:{parse:[]}});
        } catch (error) {
            return interaction.editReply({content:error.status && error.status < 500 ? error.message : 'Saran urgensi AI tidak tersedia. Coba lagi nanti.',allowedMentions:{parse:[]}});
        }
    },
};
