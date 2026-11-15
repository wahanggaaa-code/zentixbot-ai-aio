import {MessageFlags} from 'discord.js';
import {createChatStore,requireDMMembership} from '../../../services/ai/chat.js';
import {startDMSession} from '../../../services/ai/dmChat.js';
export default {name:'ai_dm_start',async execute(interaction,client,args){
 const [guildId,userId]=args;
 if(args.length!==2||interaction.guildId||interaction.user.id!==userId||!await requireDMMembership(client,guildId,userId))return interaction.reply({content:'Chat hanya tersedia untuk anggota server utama.',flags:MessageFlags.Ephemeral});
 try{const cfg=await createChatStore(client).read(guildId);if(!cfg.dmEnabled)return interaction.reply({content:'Chat DM tidak aktif.',flags:MessageFlags.Ephemeral});
  startDMSession(guildId,userId);
  await interaction.reply({content:'Siap! Langsung ketik pesanmu di DM ini — AI membalas langsung seperti chat biasa. Dua pertukaran diingat sementara; ketik `akhiri` untuk menutup sesi. Jangan kirim data sensitif.',allowedMentions:{parse:[]}});
 }catch{await interaction.reply({content:'Chat DM belum tersedia.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
}};
