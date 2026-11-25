import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getTicketPermissionContext } from '../../utils/ticket/ticketPermissions.js';
import { createSmartStore } from '../../services/ai/smartSettings.js';
import { matchFaq } from '../../services/ai/faq.js';

export default {
    slashOnly: true,
    category: 'Ticket',
    data: new SlashCommandBuilder().setName('ticket-faq-draft')
        .setDescription('Privately find a FAQ answer for a ticket')
        .setDMPermission(false)
        .addStringOption(option => option.setName('question').setDescription('Question to match against the server FAQ').setRequired(true).setMinLength(3).setMaxLength(500)),
    async execute(interaction, guildConfig, client) {
        if (!interaction.inGuild() || interaction.guildId !== client.homeGuildId || interaction.user.bot) {
            return interaction.reply({content:'Command hanya tersedia di server.',flags:MessageFlags.Ephemeral});
        }
        await interaction.deferReply({flags:MessageFlags.Ephemeral});
        try {
            const context = await getTicketPermissionContext({client,interaction});
            if (!context.ticketData || !context.canManageTicket) return interaction.editReply({content:'Hanya staff dapat mencari draft di channel tiket yang valid.',allowedMentions:{parse:[]}});
            const question = interaction.options.getString('question', true).trim();
            if (question.length < 3 || question.length > 500) return interaction.editReply({content:'Pertanyaan harus berisi 3–500 karakter.',allowedMentions:{parse:[]}});
            const faq = (await createSmartStore(client).read(interaction.guildId)).faq;
            if (!faq.enabled) return interaction.editReply({content:'FAQ belum diaktifkan di AI Studio → Pengetahuan.',allowedMentions:{parse:[]}});
            const match = matchFaq(question, faq.entries, {strict:true});
            if (!match) return interaction.editReply({content:'Tidak ditemukan FAQ yang cukup cocok. Staff perlu menjawab sendiri atau memperbarui FAQ.',allowedMentions:{parse:[]}});
            return interaction.editReply({content:`**Draft dari FAQ (periksa sebelum mengirim)**\nPertanyaan acuan: ${match.question}\n\n${match.answer}\n\n-# Pencocokan kata dapat keliru. Jawaban tidak dikirim ke tiket secara otomatis.`,allowedMentions:{parse:[]}});
        } catch {
            return interaction.editReply({content:'FAQ tidak tersedia. Coba lagi nanti.',allowedMentions:{parse:[]}});
        }
    },
};
