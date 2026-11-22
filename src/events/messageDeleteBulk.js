import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';

// Discord.js may only expose cached/partial messages. Never log their content or
// identities here; count only what the event actually supplies, not the original batch.
export default {
 name: Events.MessageBulkDelete,
 async execute(messages, channel, client) {
  if (!channel?.guild || !messages?.size) return;
  const isThread = channel.isThread?.() === true;
  await logEvent({client,guildId:channel.guild.id,eventType:EVENT_TYPES.MESSAGE_BULK_DELETE,data:{
   title:'Pesan dihapus secara massal',
   lines:[`Channel: ${channel.name || 'Tidak diketahui'} (${channel.id})`,`Jumlah pesan yang tersedia dalam event: ${messages.size}`, 'Isi dan identitas pengirim tidak dicatat. Jumlah dapat kurang dari total penghapusan.'],
   channelId:channel.id,parentChannelId:isThread ? channel.parentId : undefined,
   requireKnownParentForIgnore:isThread,skipWhenUsersIgnored:true,
  }});
 }
};
