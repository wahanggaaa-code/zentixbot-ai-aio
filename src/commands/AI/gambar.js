import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createDiscordImageStore } from '../../services/ai/discordImages.js';
const ephemeral=MessageFlags.Ephemeral;
const permissions=[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.AttachFiles];
function allowed(interaction, settings) {
 const channel=interaction.channel, member=interaction.member, bot=interaction.guild?.members?.me;
 return settings.enabled && channel?.type===ChannelType.GuildText && channel.guildId===interaction.guildId && settings.channelIds.includes(channel.id)
  && (!settings.roleIds.length || settings.roleIds.some(id=>member?.roles?.cache?.has(id)))
  && Boolean(channel.permissionsFor?.(member)?.has(permissions)) && Boolean(channel.permissionsFor?.(bot)?.has(permissions));
}
export default {
 data:new SlashCommandBuilder().setName('gambar').setDescription('Buat gambar AI di channel yang diizinkan; prompt dikirim ke provider eksternal.')
  .setDMPermission(false)
  .addStringOption(o=>o.setName('deskripsi').setDescription('Jelaskan gambar; jangan masukkan informasi sensitif.').setRequired(true).setMinLength(1).setMaxLength(1000))
  .addBooleanOption(o=>o.setName('persetujuan').setDescription('Setuju kirim prompt ke provider; Pollinations dapat membuatnya publik.').setRequired(true))
  .addStringOption(o=>o.setName('gaya').setDescription('Gaya gambar').addChoices({name:'Default',value:'default'},{name:'Ilustrasi',value:'illustration'},{name:'Fotografi',value:'photo'},{name:'Pixel art',value:'pixel'}))
  .addStringOption(o=>o.setName('ukuran').setDescription('Bentuk gambar; hasil bergantung provider').addChoices({name:'Persegi',value:'1024x1024'},{name:'Landscape',value:'1536x1024'},{name:'Portrait',value:'1024x1536'})),
 async execute(interaction,_guildConfig,client){
  if(!interaction.inGuild() || interaction.guildId!==client.homeGuildId || interaction.user?.bot)return interaction.reply({content:'Hanya untuk anggota server utama.',flags:ephemeral});
  if(interaction.options.getBoolean('persetujuan',true)!==true)return interaction.reply({content:'Persetujuan diperlukan: deskripsi dikirim ke provider eksternal. Jangan masukkan data sensitif.',flags:ephemeral});
  const prompt=interaction.options.getString('deskripsi',true).trim();
  if(!prompt || prompt.length>1000)return interaction.reply({content:'Deskripsi harus berisi 1–1000 karakter.',flags:ephemeral});
  await interaction.deferReply({flags:ephemeral});
  const store=createDiscordImageStore(client);
  try {
   const settings=await store.read(interaction.guildId);
   if(!allowed(interaction,settings))return interaction.editReply({content:'Fitur belum aktif di channel ini atau izin kamu/bot tidak mencukupi.',allowedMentions:{parse:[]}});
   if(!client.aiImageService?.generate)return interaction.editReply({content:'Generator gambar belum tersedia.',allowedMentions:{parse:[]}});
   await store.reserve(interaction.guildId,interaction.user.id,settings.cooldownSeconds);
   const result=await client.aiImageService.generate({guildId:interaction.guildId,userId:interaction.user.id,prompt,mode:'create',imageBase64:null,consent:true,style:interaction.options.getString('gaya')||'default',size:interaction.options.getString('ukuran')||'1024x1024'});
   const current=await store.read(interaction.guildId);
   if(!allowed(interaction,current))return interaction.editReply({content:'Pengaturan atau izin berubah; gambar tidak dikirim.',allowedMentions:{parse:[]}});
   if(!['image/png','image/jpeg'].includes(result.mime) || typeof result.imageBase64!=='string' || result.imageBase64.length>10666672)throw Error('Invalid image');
   const bytes=Buffer.from(result.imageBase64,'base64');if(!bytes.length || bytes.length>8000000)throw Error('Invalid image');
   try { await interaction.channel.send({content:'Gambar AI untuk <@'+interaction.user.id+'>.',files:[{attachment:bytes,name:result.mime==='image/png'?'zentix-ai.png':'zentix-ai.jpg'}],allowedMentions:{parse:[]}}); }
   catch {return interaction.editReply({content:'Pengiriman gagal atau belum pasti. Periksa channel sebelum mencoba lagi.',allowedMentions:{parse:[]}});}
   return interaction.editReply({content:'Gambar telah dikirim ke channel.',allowedMentions:{parse:[]}});
  } catch(e) {return interaction.editReply({content:e.status && e.status<500 ? e.message : 'Generator gambar atau penyimpanan tidak tersedia. Coba lagi nanti.',allowedMentions:{parse:[]}});}
 }
};
