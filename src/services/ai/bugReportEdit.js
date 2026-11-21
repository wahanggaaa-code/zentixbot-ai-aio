import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';

const buttonId = userId => `bugedit:${userId}`;
const suffix = userId => `\n\n-# Dikirim oleh <@${userId}>`;
const busy = new Set();
export function bugEditButton(userId) {
 return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(buttonId(userId)).setLabel('Edit laporan').setStyle(ButtonStyle.Secondary));
}
const deny = interaction => interaction.reply({content:'Laporan tidak tersedia atau kamu tidak memiliki izin untuk mengeditnya.',flags:MessageFlags.Ephemeral});
async function getReport(interaction, client, owner) {
 if (!/^\d{17,20}$/.test(owner || '') || interaction.user.id !== owner || interaction.guildId !== client.homeGuildId) return null;
 const thread = interaction.channel;
 if (!thread || thread.type !== ChannelType.PublicThread || thread.parent?.type !== ChannelType.GuildForum || thread.guildId !== interaction.guildId) return null;
 const permissions = thread.permissionsFor(interaction.member);
 if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessagesInThreads])) return null;
 const message = await thread.messages.fetch(thread.id).catch(() => null);
 if (!message || message.id !== thread.id || message.author?.id !== client.user.id || !message.content.endsWith(suffix(owner))) return null;
 if (!message.components?.some(row => row.components?.some(component => (component.customId ?? component.custom_id) === buttonId(owner)))) return null;
 return {thread,message};
}
export async function openBugEdit(interaction, client, args) {
 const owner=args[0];
 const report=await getReport(interaction,client,owner);
 if (!report) return deny(interaction);
 const body=report.message.content.slice(0,-suffix(owner).length);
 if (!body || body.length>1200 || report.thread.name.length>80) return deny(interaction);
 const modal=new ModalBuilder().setCustomId(`bugeditmodal:${owner}`).setTitle('Edit laporan bug').addComponents(
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Judul').setStyle(TextInputStyle.Short).setMinLength(1).setMaxLength(80).setRequired(true).setValue(report.thread.name)),
  new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('body').setLabel('Isi laporan').setStyle(TextInputStyle.Paragraph).setMinLength(1).setMaxLength(1200).setRequired(true).setValue(body))
 );
 return interaction.showModal(modal);
}
export async function submitBugEdit(interaction, client, args) {
 const owner=args[0];
 // Re-fetch and authorize again: permissions or the report may have changed while the form was open.
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 const fail=content=>interaction.editReply({content,allowedMentions:{parse:[]}});
 const report=await getReport(interaction,client,owner);
 if (!report) return fail('Laporan tidak tersedia atau kamu tidak memiliki izin untuk mengeditnya.');
 const title=interaction.fields.getTextInputValue('title').trim();
 const body=interaction.fields.getTextInputValue('body').trim();
 if (!title || title.length>80 || /[\r\n]/.test(title) || !body || body.length>1200) return fail('Judul atau isi tidak valid.');
 if (busy.has(report.thread.id)) return fail('Laporan sedang diedit. Coba lagi.');
 busy.add(report.thread.id);
 try {
  // Discord uses separate operations for title and message, so partial success is possible.
  let renamed=false;
  if (title!==report.thread.name) { await report.thread.setName(title); renamed=true; }
  try { await report.message.edit({content:body+suffix(owner),allowedMentions:{parse:[]}}); }
  catch { return fail(renamed?'Judul berhasil diubah, tetapi isi gagal diperbarui. Periksa laporan dan coba lagi.':'Isi laporan gagal diperbarui. Periksa laporan dan coba lagi.'); }
  return fail('Laporan berhasil diperbarui. Gambar yang sudah ada tetap dipertahankan.');
 } catch { return fail('Judul gagal diperbarui; isi belum diubah. Periksa izin bot dan status thread.'); }
 finally { busy.delete(report.thread.id); }
}
