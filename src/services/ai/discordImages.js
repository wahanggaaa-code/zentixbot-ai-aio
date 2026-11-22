// Member image generation is separate from the owner-only dashboard generator.
// Fail closed if settings or cooldown storage cannot be read.
import { ChannelType } from 'discord.js';
import { createKV } from './kv.js';
const id = v => typeof v === 'string' && /^\d{17,20}$/.test(v);
const error = (message, status=400) => Object.assign(new Error(message), {status});
export const DEFAULT_DISCORD_IMAGES = Object.freeze({enabled:false, channelIds:[], roleIds:[], cooldownSeconds:60});
export function validateDiscordImages(value, guild) {
 const keys=Object.keys(DEFAULT_DISCORD_IMAGES);
 if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==keys.length || keys.some(k=>!Object.hasOwn(value,k)) || typeof value.enabled!=='boolean') throw error('Pengaturan gambar Discord tidak valid.');
 for (const field of ['channelIds','roleIds']) if (!Array.isArray(value[field]) || value[field].length>10 || value[field].some(x=>!id(x)) || new Set(value[field]).size!==value[field].length) throw error('Pilih maksimal 10 channel dan 10 role yang berbeda.');
 if (!Number.isInteger(value.cooldownSeconds) || value.cooldownSeconds<30 || value.cooldownSeconds>86400) throw error('Cooldown harus 30–86400 detik.');
 if (value.enabled && !value.channelIds.length) throw error('Pilih minimal satu channel teks.');
 if (guild && value.channelIds.some(x=>guild.channels.cache.get(x)?.type!==ChannelType.GuildText)) throw error('Pilih channel teks yang tersedia di server.');
 if (guild && value.roleIds.some(x=>!guild.roles.cache.has(x) || x===guild.id)) throw error('Pilih role yang tersedia; jangan gunakan @everyone.');
 return {enabled:value.enabled,channelIds:[...value.channelIds],roleIds:[...value.roleIds],cooldownSeconds:value.cooldownSeconds};
}
export function createDiscordImageStore(client,{kv=createKV(client),now=Date.now}={}) {
 const key=guildId=>`ai:discord-images:settings:${guildId}`;
 return {
  async read(guildId){if(!id(guildId) || guildId!==client.homeGuildId)throw error('Server tidak valid.',403); const value=await kv.get(key(guildId));return value===null?validateDiscordImages(DEFAULT_DISCORD_IMAGES):validateDiscordImages(value);},
  async save(guildId,value,guild){if(!id(guildId)||guildId!==client.homeGuildId || guild?.id!==guildId)throw error('Server tidak valid.',403);const settings=validateDiscordImages(value,guild);await kv.set(key(guildId),settings);return settings;},
  async reserve(guildId,userId,seconds){
   if(!id(guildId)||guildId!==client.homeGuildId||!id(userId)||!Number.isInteger(seconds)||seconds<30||seconds>86400)throw error('Identitas atau cooldown tidak valid.');
   const time=now();
   // One bounded record avoids accumulating an expired row for every member on PostgreSQL.
   const next=await kv.update(`ai:discord-images:cooldown:${guildId}`,old=>{
    if(old!==null && (!old || typeof old!=='object' || Array.isArray(old) || !old.users || typeof old.users!=='object' || Array.isArray(old.users)))throw error('Data cooldown tidak valid.',503);
    const entries=Object.entries(old?.users??{});
    if(entries.length>500 || entries.some(([key,until])=>!id(key)||!Number.isSafeInteger(until)||until<0))throw error('Data cooldown tidak valid.',503);
    const users=Object.fromEntries(entries.filter(([,until])=>until>time));
    if(Object.hasOwn(users,userId) || Object.keys(users).length>=500)return undefined;
    users[userId]=time+seconds*1000;return {users};
   });
   if(!next)throw error('Tunggu cooldown atau coba lagi saat antrean pengguna berkurang.',429);
  }
 };
}
