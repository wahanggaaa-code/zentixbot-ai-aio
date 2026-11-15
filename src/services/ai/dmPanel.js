import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits} from 'discord.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';
const err=(message,status=400)=>Object.assign(new Error(message),{status});
export function dmPrompt(guildId,userId){const container=createV2Container({title:'Chat AI DM',description:'Pertanyaan dan lampiran dikirim ke provider eksternal; audio ke OpenAI lalu transkrip ke provider chat. Jangan kirim data sensitif. Memori opsional disimpan sementara; tombol hanya untukmu.',color:'info'});const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ai_dm_compose:${guildId}:${userId}`).setLabel('Setuju dan tulis pertanyaan').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`ai_dm_memory:${guildId}:${userId}`).setLabel('Lihat memori DM').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`ai_dm_clear:${guildId}:${userId}`).setLabel('Hapus memori DM').setStyle(ButtonStyle.Secondary));return {...v2Message([container,row]),allowedMentions:{parse:[]}};}
export async function sendDMPublicPanel({client,guild,settings,confirmed}){
 if(guild.id!==client.homeGuildId||confirmed!==true)throw err('Server atau konfirmasi tidak valid.',403);
 if(!settings.dmEnabled||!settings.channelId)throw err('Aktifkan DM dan pilih channel untuk panel.');
 const channel=guild.channels.cache.get(settings.channelId),me=guild.members.me;if(channel?.type!==ChannelType.GuildText||!me||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw err('Channel atau izin bot tidak tersedia.',403);
 const container=createV2Container({title:'Chat AI pribadi',description:'Klik untuk memulai di DM. Konten dikirim ke provider eksternal setelah persetujuan; jangan kirim data sensitif.',color:'info'});const payload={...v2Message([container,new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ai_dm_open:${guild.id}`).setLabel('Chat via DM').setStyle(ButtonStyle.Primary))]),allowedMentions:{parse:[]}};
 const message=await channel.send(payload);return {messageId:message.id};
}
