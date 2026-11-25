import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getTicketPermissionContext } from '../../utils/ticket/ticketPermissions.js';
import { getTicketData, saveTicketData } from '../../utils/database.js';
import { summarizeTicket } from '../../services/ai/ticketSummary.js';
import { createAIFeatureControlsStore } from '../../services/ai/featureControls.js';

const labels={positive:'Positif',neutral:'Netral',negative:'Negatif',mixed:'Campuran',unknown:'Belum dapat ditentukan'};
export default {
    slashOnly:true, category:'Ticket',
    data:new SlashCommandBuilder().setName('ticket-sentiment-ai').setDescription('Analyze and save an approximate ticket sentiment for statistics')
        .setDMPermission(false).addBooleanOption(o=>o.setName('consent').setDescription('Send ticket text to an AI provider and save the result').setRequired(true)),
    async execute(interaction,guildConfig,client){
        if(!interaction.inGuild() || interaction.guildId!==client.homeGuildId || interaction.user.bot) return interaction.reply({content:'Command hanya tersedia di server.',flags:MessageFlags.Ephemeral});
        await interaction.deferReply({flags:MessageFlags.Ephemeral});
        const reply=content=>interaction.editReply({content,allowedMentions:{parse:[]}});
        try {
            if(interaction.options.getBoolean('consent')!==true) return reply('Persetujuan pengiriman teks ke AI dan penyimpanan hasil diperlukan.');
            const context=await getTicketPermissionContext({client,interaction});
            if(!context.ticketData || context.ticketData.status==='deleted' || !context.canManageTicket) return reply('Hanya staff dapat menganalisis di channel tiket yang valid.');
            const store=createAIFeatureControlsStore(client);
            if(!(await store.read(interaction.guildId)).ticketSentimentEnabled) return reply('Analisis sentimen tiket belum diaktifkan di dashboard.');
            const result=await summarizeTicket({client,channel:interaction.channel,userId:interaction.user.id,purpose:'sentiment'});
            // Reload after the provider call and let the ticket store's compare-and-swap
            // reject concurrent writes instead of overwriting another ticket action.
            const current=await getTicketPermissionContext({client,interaction});
            if(!current.canManageTicket || !current.ticketData || current.ticketData.status==='deleted' || !(await store.read(interaction.guildId)).ticketSentimentEnabled) return reply('Akses atau pengaturan berubah; hasil tidak disimpan.');
            const latest=await getTicketData(interaction.guildId,interaction.channelId);
            if(!latest || latest.status==='deleted') return reply('Tiket tidak tersedia; hasil tidak disimpan.');
            latest.aiSentiment={sentiment:result.sentiment,lines:result.lines,createdAt:new Date().toISOString()};
            await saveTicketData(interaction.guildId,interaction.channelId,latest);
            return reply(`**Perkiraan sentimen: ${labels[result.sentiment]}**\nHasil disimpan untuk statistik dashboard. Berdasarkan sampel teks, dapat keliru dan bukan fakta pasti.`);
        } catch(error) {
            return reply(error.code==='TICKET_STALE'?'Tiket berubah saat menyimpan; hasil tidak disimpan. Coba lagi.':error.status&&error.status<500?error.message:'Analisis sentimen tidak tersedia; hasil tidak disimpan.');
        }
    },
};
