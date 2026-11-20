import {randomUUID} from 'node:crypto';
import {ChannelType,PermissionFlagsBits} from 'discord.js';
import {pgConfig} from '../../config/database/postgres.js';
import {sqliteBackend} from '../storage/sqlite.js';
import {getGuildConfig} from '../config/guildConfig.js';
import {getTicketData,saveTicketData} from '../../utils/database.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';
import {logger} from '../../utils/logger.js';
import {closeTicket} from '../ticket.js';
import {readAutoCloseConfig,autoCloseRevision} from './autoCloseConfig.js';
const id=/^\d{17,20}$/;
async function openPage(client,guildId,after){
 const sqlite=sqliteBackend(client);if(sqlite)return sqlite.ticketOpenPage(guildId,after,50);
 const db=client.db;if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw Error('Database tiket tidak tersedia');
 const rows=await db.db.pool.query(`SELECT channel_id FROM ${pgConfig.tables.tickets} WHERE guild_id=$1 AND channel_id>$2 AND channel_id ~ '^[0-9]{17,20}$' AND (expires_at IS NULL OR expires_at>NOW()) AND data->>'status'='open' ORDER BY channel_id LIMIT 50`,[guildId,after]);return rows.rows.map(r=>r.channel_id);
}
// When the newest 100 messages contain no human, older activity is unknown.
// Never guess; doing nothing is safer than closing an active ticket.
async function lastHumanMessage(channel){
 const messages=await channel.messages.fetch({limit:100});let latest=null;
 for(const m of messages.values()){
  if(!m.author||typeof m.author.bot!=='boolean'||!Number.isFinite(m.createdTimestamp)||!id.test(m.id||''))throw Error('Aktivitas pesan tidak dapat diperiksa');
  const activeAt=Number.isFinite(m.editedTimestamp)?Math.max(m.createdTimestamp,m.editedTimestamp):m.createdTimestamp;
  if(!m.author.bot&&(!latest||activeAt>latest.at||(activeAt===latest.at&&m.id>latest.id)))latest={id:m.id,at:activeAt};
 }
 if(!latest&&messages.size>=100)throw Error('Aktivitas manusia tidak terlihat dalam 100 pesan terbaru');
 return latest?{key:`${latest.id}:${latest.at}`,at:latest.at}:{key:null,at:null};
}
function channelReadable(channel,guild){return channel?.type===ChannelType.GuildText&&channel.messages&&channel.send&&guild.members.me&&channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.SendMessages]);}
async function settingsFor(client,guildId){return readAutoCloseConfig(await getGuildConfig(client,guildId))}
export async function runTicketAutoClosePage(client,{after='',now=Date.now()}={}){
 const guildId=client.homeGuildId,guild=client.guilds.cache.get(guildId);if(!id.test(guildId||'')||!guild||!id.test(client.user?.id||''))return {after:'',warned:0,closed:0};
 const settings=await settingsFor(client,guildId);if(!settings.enabled)return {after:'',warned:0,closed:0};
 const ids=await openPage(client,guildId,after);let warned=0,closed=0;
 for(const channelId of ids){try{
  const config=await settingsFor(client,guildId);if(autoCloseRevision(config)!==autoCloseRevision(settings))break;
  let ticket=await getTicketData(guildId,channelId);if(!ticket||ticket.status!=='open'||!id.test(ticket.userId||''))continue;
  const channel=guild.channels.cache.get(channelId)||await guild.channels.fetch(channelId).catch(()=>null);if(!channelReadable(channel,guild))continue;
  const human=await lastHumanMessage(channel),created=Date.parse(ticket.createdAt),enabled=Date.parse(settings.enabledAt);if(!Number.isFinite(created)||!Number.isFinite(enabled))continue;
  const reopened=ticket.reopenedAt?Date.parse(ticket.reopenedAt):0;if(!Number.isFinite(reopened))continue;
  const baseline=Math.max(created,enabled,reopened,human.at??0);if(baseline>now)continue;
  let state=ticket.autoClose;
  if(state?.epoch===settings.epoch&&state.phase==='pending')continue; // an uncertain warning is never treated as delivered
  if(state?.epoch===settings.epoch&&state.phase==='warned'&&state.lastHumanKey!==human.key){ticket.autoClose=null;try{await saveTicketData(guildId,channelId,ticket)}catch(e){if(e.code!=='TICKET_STALE')throw e}continue;}
  if(!state||state.epoch!==settings.epoch){
   if(now-baseline<settings.idleMinutes*60000)continue;
   state={phase:'pending',token:randomUUID(),epoch:settings.epoch,lastHumanKey:human.key};ticket.autoClose=state;
   try{await saveTicketData(guildId,channelId,ticket)}catch(e){if(e.code==='TICKET_STALE')continue;throw e}
   const fresh=await getTicketData(guildId,channelId),cfg=await settingsFor(client,guildId);
   if(!fresh||fresh.status!=='open'||fresh.autoClose?.token!==state.token||autoCloseRevision(cfg)!==autoCloseRevision(settings))continue;
   const warning=createV2Container({title:'Peringatan penutupan tiket',description:`<@${ticket.userId}> Tiket ini tidak aktif. Jika tidak ada pesan dari anggota selama ${settings.warningMinutes} menit setelah peringatan ini, bot akan menutup tiket. Kirim pesan untuk membatalkan penutupan. Channel tidak dihapus.`,color:'warning'});
   const sent=await channel.send({...v2Message([warning]),allowedMentions:{parse:[],users:[ticket.userId]}});
   if(!id.test(sent?.id||''))throw Error('ID peringatan tidak tersedia');
   ticket=await getTicketData(guildId,channelId);if(!ticket||ticket.status!=='open'||ticket.autoClose?.token!==state.token)continue;
   ticket.autoClose={...state,phase:'warned',messageId:sent.id,warnedAt:new Date(Math.max(now,Date.now())).toISOString()};await saveTicketData(guildId,channelId,ticket);warned++;continue;
  }
  if(state.phase!=='warned'||!id.test(state.messageId||'')||!Number.isFinite(Date.parse(state.warnedAt))||now-Date.parse(state.warnedAt)<settings.warningMinutes*60000)continue;
  const check=async()=>{try{const cfg=await settingsFor(client,guildId);if(autoCloseRevision(cfg)!==autoCloseRevision(settings)||!channelReadable(channel,guild))return false;const notice=await channel.messages.fetch(state.messageId);if(!notice||notice.author?.id!==client.user.id)return false;const latest=await lastHumanMessage(channel);return latest.key===state.lastHumanKey}catch{return false}};
  if(!(await check()))continue;
  try{await closeTicket(channel,client.user,'Automatically closed after inactivity.',{autoCloseGuard:{epoch:settings.epoch,token:state.token,warnedAt:state.warnedAt,now,check}});closed++;}catch(e){if(e?.context?.ticketCode!=='TICKET_AUTOCLOSE_CANCELLED'&&e?.context?.ticketCode!=='TICKET_STALE')throw e}
 }catch(e){logger.warn(`Auto-close tiket ${channelId} dilewati: ${e.message}`)}}
 return {after:ids.length===50?ids.at(-1):'',warned,closed};
}
export function startTicketAutoCloseWorker(client,{interval=60000}={}){
 let after='',running=false,stopped=false;const tick=async()=>{if(running||stopped)return;running=true;try{after=(await runTicketAutoClosePage(client,{after})).after}catch(e){logger.warn(`Auto-close tiket tidak dapat diperiksa: ${e.message}`)}finally{running=false}};
 const timer=setInterval(tick,interval);timer.unref?.();void tick();return {tick,stop(){stopped=true;clearInterval(timer)}};
}
