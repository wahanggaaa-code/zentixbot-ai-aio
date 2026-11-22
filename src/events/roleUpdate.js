import { Events } from 'discord.js';
import { EVENT_TYPES, logEvent } from '../services/loggingService.js';

export default {
 name: Events.GuildRoleUpdate,
 async execute(before, after) {
  if (!after.guild) return;
  const changes=[];
  if (before.name!==after.name) changes.push(`Nama: ${before.name} → ${after.name}`);
  if (before.hexColor!==after.hexColor) changes.push(`Warna: ${before.hexColor} → ${after.hexColor}`);
  if (before.hoist!==after.hoist) changes.push(`Ditampilkan terpisah: ${before.hoist?'ya':'tidak'} → ${after.hoist?'ya':'tidak'}`);
  if (before.mentionable!==after.mentionable) changes.push(`Dapat disebut: ${before.mentionable?'ya':'tidak'} → ${after.mentionable?'ya':'tidak'}`);
  if (before.permissions?.bitfield!==after.permissions?.bitfield) changes.push('Izin role berubah (detail tidak ditampilkan).');
  if (!changes.length) return;
  await logEvent({client:after.client,guildId:after.guild.id,eventType:EVENT_TYPES.ROLE_UPDATE,data:{title:'Role berubah',lines:[`Role: ${after.name} (${after.id})`,...changes]}});
 }
};
