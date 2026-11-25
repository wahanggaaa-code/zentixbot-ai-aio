import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,PermissionFlagsBits} from 'discord.js';
import {createV2Container,v2Message,v2Separator} from '../../utils/componentsV2.js';
const err=(message,status=400)=>Object.assign(new Error(message),{status});
/** The DM welcome panel: same shape as the reference bot, worded our way. Clicking Mulai chatting is the consent. */
export function dmPrompt(guildId,userId){
 const container=createV2Container({title:'Zentix — Chat Pribadi',description:'**Siap ngobrol?**\nKlik **Mulai chatting** — itu persetujuanmu: pesan dan lampiran di DM ini dikirim ke provider AI eksternal untuk dijawab; audio dapat dikirim ke provider transkripsi cadangan jika utama gagal.\n\nSetelah itu:\n• Ketik seperti chat biasa — AI membalas langsung, tidak pakai formulir.\n• Dua pertukaran terakhir diingat 30 menit (tombol di bawah untuk melihat/menghapus).\n• Memori jangka panjang opsional: ketik `!memori` untuk petunjuk.\n• Ketik `akhiri` kapan pun untuk menutup sesi.\n\nJangan kirim data sensitif.\n-# Discord, operator bot dan provider memproses data; jangan kirim rahasia.',color:'info'});
 container.addSeparatorComponents(v2Separator({divider:true,spacing:1}));
 container.addActionRowComponents(new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`ai_dm_start:${guildId}:${userId}`).setLabel('Mulai chatting').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`ai_dm_memory:${guildId}:${userId}`).setLabel('Lihat memori sementara').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`ai_dm_clear:${guildId}:${userId}`).setLabel('Hapus memori sementara').setStyle(ButtonStyle.Secondary)));
 return {...v2Message([container]),allowedMentions:{parse:[]}};
}
/** The public server panel that opens the DM. */
export async function sendDMPublicPanel({client,guild,settings,confirmed}){
 if(guild.id!==client.homeGuildId||confirmed!==true)throw err('Server atau konfirmasi tidak valid.',403);
 if(!settings.dmEnabled||!settings.channelId)throw err('Aktifkan DM dan pilih channel untuk panel.');
 const channel=guild.channels.cache.get(settings.channelId),me=guild.members.me;if(channel?.type!==ChannelType.GuildText||!me||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw err('Channel atau izin bot tidak tersedia.',403);
 const container=createV2Container({title:'Zentix — Chat Pribadi',description:'**Cara kerjanya**\n1. Klik tombol di bawah → bot mengirim pesan ke DM kamu.\n2. Sepakatin dulu → lalu tanya apa saja, AI membalas langsung di DM.\n3. Dua pertukaran terakhir diingat sementara selama 30 menit.\n\n**Kenapa lewat DM?**\nChannel dan thread bisa dibaca anggota server. DM ini tidak tampil di channel server; Discord, operator bot dan provider memproses data.\n\nJangan kirim data sensitif. Pertanyaan dikirim ke provider AI eksternal.\n-# Privat • Tidak ada channel yang dibuat',color:'info'});
 container.addSeparatorComponents(v2Separator({divider:true,spacing:1}));
 container.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ai_dm_open:${guild.id}`).setLabel('💬 Chat via DM').setStyle(ButtonStyle.Primary)));
 const payload={...v2Message([container]),allowedMentions:{parse:[]}};
 const message=await channel.send(payload);return {messageId:message.id};
}
