import {createHash,randomUUID} from 'node:crypto';
import {ChannelType,PermissionFlagsBits} from 'discord.js';
import {getGuildConfig} from '../config/guildConfig.js';
import {getTicketData,saveTicketData} from '../../utils/database.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';
import {logger} from '../../utils/logger.js';
import {openTicketPage} from './autoClose.js';
const id=/^\d{17,20}$/;
export function readResponseSlaConfig(cfg){
 const x=cfg.ticketResponseSla;if(x==null)return {enabled:false,minutes:60,epoch:null,enabledAt:null};
 if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.enabled!=='boolean'||!Number.isInteger(x.minutes)||x.minutes<10||x.minutes>10080||(x.enabled&&(!/^[a-f0-9-]{36}$/.test(x.epoch||'')||!Number.isFinite(Date.parse(x.enabledAt)))))throw Error('Pengaturan SLA tiket tidak valid.');
 return {enabled:x.enabled,minutes:x.minutes,epoch:x.epoch??null,enabledAt:x.enabledAt??null};
}
export const responseSlaRevision=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,16);
export const newResponseSlaConfig=(enabled,minutes)=>({enabled,minutes,epoch:enabled?randomUUID():null,enabledAt:enabled?new Date().toISOString():null});
// A bounded, current-role view of Discord history, not a retrospective audit.
// Unknown members/permissions fail closed rather than asserting no staff response.
export async function inspectTicketResponses(guild,channel,ticket,config){
 if(channel?.type!==ChannelType.GuildText||!guild.members.me||!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory]))throw Error('Bot tidak dapat membaca riwayat tiket.');
 if(!id.test(ticket.userId||''))throw Error('Pembuat tiket tidak valid.');
 const fetched=await channel.messages.fetch({limit:100});const messages=[...fetched.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp||String(a.id).localeCompare(String(b.id)));
 let pending=null,lastResponse=null;const members=new Map();
 const opened=ticket.reopenedAt?Date.parse(ticket.reopenedAt):0;if(!Number.isFinite(opened))throw Error('Waktu reopen tidak valid.');
 for(const m of messages){
  if(!m.author||typeof m.author.bot!=='boolean'||!id.test(m.author.id||'')||!id.test(m.id||'')||!Number.isFinite(m.createdTimestamp))throw Error('Riwayat pesan tidak valid.');
  if(m.createdTimestamp<opened||m.author.bot)continue;
  if(m.author.id===ticket.userId){if(!pending)pending={id:m.id,at:m.createdTimestamp};continue;}
  if(!pending)continue;
  let member=members.get(m.author.id);if(!member){member=await guild.members.fetch({user:m.author.id,force:true}).catch(()=>null);if(!member||!member.permissions||!member.roles?.cache)throw Error('Status staff pengirim tidak dapat diverifikasi.');members.set(m.author.id,member)}
  const staff=member.permissions.has(PermissionFlagsBits.ManageChannels)||(id.test(config.ticketStaffRoleId||'')&&member.roles.cache.has(config.ticketStaffRoleId));
  if(staff&&pending){lastResponse={requestAt:new Date(pending.at).toISOString(),responseAt:new Date(m.createdTimestamp).toISOString(),minutes:(m.createdTimestamp-pending.at)/60000,staffId:m.author.id};pending=null;}
 }
 return {pending, lastResponse, truncated:fetched.size>=100};
}
export async function runResponseSlaPage(client,{after='',now=Date.now()}={}){
 const guildId=client.homeGuildId,guild=client.guilds.cache.get(guildId);if(!id.test(guildId||'')||!guild)return {after:'',attempted:0};
 const initial=await getGuildConfig(client,guildId),settings=readResponseSlaConfig(initial);if(!settings.enabled)return {after:'',attempted:0};
 const ids=await openTicketPage(client,guildId,after);let attempted=0;
 for(const channelId of ids)try{
  const cfg=await getGuildConfig(client,guildId);if(responseSlaRevision(readResponseSlaConfig(cfg))!==responseSlaRevision(settings))break;
  const ticket=await getTicketData(guildId,channelId);if(!ticket||ticket.status!=='open')continue;
  const channel=guild.channels.cache.get(channelId)||await guild.channels.fetch(channelId).catch(()=>null);if(!channel?.send||!channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages))continue;
  const result=await inspectTicketResponses(guild,channel,ticket,cfg),pending=result.pending;if(!pending)continue;
  const start=Math.max(pending.at,Date.parse(settings.enabledAt));if(start>now||now-start<settings.minutes*60000)continue;
  const token=`${settings.epoch}:${pending.id}`;if(ticket.responseReminderToken===token)continue;
  ticket.responseReminderToken=token;try{await saveTicketData(guildId,channelId,ticket)}catch(e){if(e.code==='TICKET_STALE')continue;throw e}attempted++;
  const latest=await getTicketData(guildId,channelId),freshCfg=await getGuildConfig(client,guildId);if(!latest||latest.status!=='open'||latest.responseReminderToken!==token||responseSlaRevision(readResponseSlaConfig(freshCfg))!==responseSlaRevision(settings)||freshCfg.ticketStaffRoleId!==cfg.ticketStaffRoleId)continue;
  const current=await inspectTicketResponses(guild,channel,latest,freshCfg);if(current.pending?.id!==pending.id)continue;
  const role=id.test(freshCfg.ticketStaffRoleId||'')?freshCfg.ticketStaffRoleId:null;
  await channel.send({...v2Message([createV2Container({title:'Pengingat respons tiket',description:`${role?`<@&${role}> `:''}Pesan pembuat tiket belum mendapat respons staff selama setidaknya ${settings.minutes} menit. Silakan periksa tiket.`,color:'warning'})]),allowedMentions:{parse:[],roles:role?[role]:[]}});
 }catch(e){logger.warn(`Pengingat respons tiket ${channelId} dilewati: ${e.message}`)}
 return {after:ids.length===50?ids.at(-1):'',attempted};
}
export function startResponseSlaWorker(client,{interval=60000}={}){let after='',running=false,stopped=false;const tick=async()=>{if(running||stopped)return;running=true;try{after=(await runResponseSlaPage(client,{after})).after}catch(e){logger.warn(`Pengingat respons tidak tersedia: ${e.message}`)}finally{running=false}};const timer=setInterval(tick,interval);timer.unref?.();void tick();return {tick,stop(){stopped=true;clearInterval(timer)}}}
