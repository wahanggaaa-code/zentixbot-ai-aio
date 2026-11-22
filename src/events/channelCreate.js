import { Events } from 'discord.js';
import { EVENT_TYPES, logEvent } from '../services/loggingService.js';
export default {
 name: Events.ChannelCreate,
 async execute(channel) {
  if (!channel.guild) return;
  await logEvent({client:channel.client,guildId:channel.guild.id,eventType:EVENT_TYPES.CHANNEL_CREATE,data:{title:'Channel dibuat',lines:[`Channel: ${channel.name || 'Tanpa nama'} (${channel.id})`,`Tipe: ${channel.type}`],channelId:channel.id,parentChannelId:channel.parentId}});
 }
};
