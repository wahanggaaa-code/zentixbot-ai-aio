import {PermissionFlagsBits} from 'discord.js';
import {isHomeGuild} from '../../utils/singleGuild.js';
import {createAutomodStore} from './automod.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';

// Detection state is bounded, transient, and contains no member IDs or message content.
export function createRaidDetector({read,report,now=Date.now,maxGuilds=20}){
 const state=new Map();
 return {async handle(member){
  const guild=member?.guild;if(!guild?.id)return;
  const settings=await read(guild.id);if(!settings.enabled||!settings.raidEnabled){state.delete(guild.id);return}
  const time=now();let current=state.get(guild.id);if(!current){if(state.size>=maxGuilds)state.delete(state.keys().next().value);current={joins:[],nextAlert:0};state.set(guild.id,current)}
  current.joins=current.joins.filter(t=>t>time-settings.raidSeconds*1000);current.joins.push(time);current.joins=current.joins.slice(-100);
  if(current.joins.length>=settings.raidCount&&time>=current.nextAlert){current.nextAlert=time+Math.max(60000,settings.raidSeconds*1000);await report(guild,settings,current.joins.length)}
 }};
}
export async function performRaidLockdown({guild,settings,read,send}){
 const me=guild.members.me;
 if(!settings.raidLockEnabled)return;
   for(const channelId of settings.raidLockChannels){
    try{
     if(JSON.stringify((await read(guild.id)).settings)!==JSON.stringify(settings))break;
     const target=await guild.channels.fetch(channelId,{force:true});
     if(!target?.permissionOverwrites?.cache||!target.permissionOverwrites.edit||!target.permissionsFor(me)?.has([PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageRoles]))throw Error('channel atau izin bot tidak tersedia');
     const overwrite=target.permissionOverwrites.cache.get(guild.id),prior=overwrite?.deny?.has(PermissionFlagsBits.SendMessages)?'deny':overwrite?.allow?.has(PermissionFlagsBits.SendMessages)?'allow':'inherit';
     if(prior==='deny'){await send('AutoMod · Lockdown dilewati',`Channel ${channelId}: izin kirim @everyone sudah ditolak.`);continue}
     // Record the original value before editing. If logging fails no permission is changed.
     await send('AutoMod · Lockdown direncanakan',`Channel ${channelId}: izin kirim @everyone sebelumnya ${prior}. Jika kunci berhasil, moderator harus mengembalikan nilai ini secara manual setelah memeriksa perubahan lain.`);
     if(JSON.stringify((await read(guild.id)).settings)!==JSON.stringify(settings))break;
     await target.permissionOverwrites.edit(guild.id,{SendMessages:false},{reason:'AutoMod anti-raid lockdown'});
     await send('AutoMod · Lockdown berhasil',`Channel ${channelId}: izin kirim @everyone ditolak. Pemulihan manual; periksa catatan nilai sebelumnya.`);
    }catch(e){await send('AutoMod · Lockdown gagal',`Channel ${channelId}: periksa izin, kondisi channel dan audit log Discord. Perubahan mungkin sudah terjadi.`).catch(()=>{});}
   }
}
const detectors=new WeakMap();
export async function handleRaidJoin(member,client){
 if(!isHomeGuild(client,member.guild?.id))return;
 if(!detectors.has(client)){
  const store=createAutomodStore(client);
  detectors.set(client,createRaidDetector({read:async guildId=>(await store.read(guildId)).settings,report:async(guild,settings,count)=>{
   const current=(await store.read(guild.id)).settings;if(JSON.stringify(current)!==JSON.stringify(settings))return;
   const channel=guild.channels.cache.get(settings.logChannelId),me=guild.members.me;
   if(!channel?.send||!me||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('Channel log anti-raid tidak tersedia');
   const send=async(title,description)=>channel.send({...v2Message([createV2Container({title,description,color:'warning'})]),allowedMentions:{parse:[]}});
   await send('AutoMod · Peringatan lonjakan anggota',`${count} anggota masuk dalam ${settings.raidSeconds} detik. Periksa kemungkinan raid.${settings.raidLockEnabled?' Lockdown channel terpilih akan dicoba.':' Tidak ada tindakan otomatis.'}`);
   await performRaidLockdown({guild,settings,read:id=>store.read(id),send});
  }}));
 }
 await detectors.get(client).handle(member);
}
