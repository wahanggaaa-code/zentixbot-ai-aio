import { PermissionFlagsBits } from 'discord.js';
import { getTicketData, saveTicketData } from '../../utils/database.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { createAIFeatureControlsStore } from './featureControls.js';
import { summarizeTicket } from './ticketSummary.js';

// A best-effort background job, never a precondition for transferring a ticket.
export async function transferTicketSummary({channel, targetId, token}) {
    const {client, guild, id} = channel;
    const enabled = async () => (await createAIFeatureControlsStore(client).read(guild.id)).ticketTransferSummaryEnabled;
    const matches = ticket => ticket?.status === 'open' && ticket.claimedBy === targetId && ticket.aiTransferToken === token;
    if (!client.aiFoundation || !client.user?.id || !(await enabled())) return;
    if (!matches(await getTicketData(guild.id,id))) return;
    const {text,lines} = await summarizeTicket({client,channel,userId:client.user.id});
    if (!(await enabled())) return;
    const latest = await getTicketData(guild.id,id);
    if (!matches(latest)) return;
    latest.aiTransferSummary = {text,lines,targetId,token,createdAt:new Date().toISOString()};
    await saveTicketData(guild.id,id,latest);
    // The DM can only go to the current assignee, after refreshing their staff
    // status and access. Dashboard access to the saved copy is separate.
    if (!(await enabled())) return;
    const [fresh,config,member] = await Promise.all([getTicketData(guild.id,id),getGuildConfig(client,guild.id),guild.members.fetch({user:targetId,force:true}).catch(()=>null)]);
    if (!matches(fresh) || !member || member.user?.bot || !(member.permissions?.has(PermissionFlagsBits.ManageChannels) || (config.ticketStaffRoleId && member.roles?.cache?.has(config.ticketStaffRoleId)))) return;
    if (!channel.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages])) return;
    await member.user.send({content:`**Ringkasan transfer tiket AI** · ${id}\nSampel pesan awal dan terbaru; periksa akurasi.\n${text}`.slice(0,2000),allowedMentions:{parse:[]}});
}
export function scheduleTransferTicketSummary(channel,targetId,token) {
    setImmediate(()=>{void transferTicketSummary({channel,targetId,token}).catch(()=>{});});
}
