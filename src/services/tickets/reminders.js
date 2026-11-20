import {ChannelType} from 'discord.js';
import {pgConfig} from '../../config/database/postgres.js';
import {sqliteBackend} from '../storage/sqlite.js';
import {getGuildConfig} from '../config/guildConfig.js';
import {getTicketData,saveTicketData} from '../../utils/database.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';
import {logger} from '../../utils/logger.js';

const idPattern=/^\d{17,20}$/;
const validSettings=c=>Number.isInteger(c.ticketReminderMinutes)&&c.ticketReminderMinutes>=10&&c.ticketReminderMinutes<=10080&&Number.isFinite(Date.parse(c.ticketReminderEnabledAt));

async function page(client,guildId,after,cutoff) {
 const sqlite=sqliteBackend(client);if(sqlite)return sqlite.ticketReminderPage(guildId,after,cutoff,50);
 const db=client.db;if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw Error('Database tiket tidak tersedia');
 const rows=await db.db.pool.query(`SELECT channel_id FROM ${pgConfig.tables.tickets} WHERE guild_id=$1 AND channel_id>$2 AND channel_id ~ '^[0-9]{17,20}$' AND (expires_at IS NULL OR expires_at>NOW()) AND data->>'status'='open' AND data->>'claimedBy' IS NULL AND data->>'reminderAttemptedAt' IS NULL AND COALESCE(data->>'unclaimedAt',data->>'createdAt') <= $3 ORDER BY channel_id LIMIT 50`,[guildId,after,cutoff]);
 return rows.rows.map(row=>row.channel_id).filter(id=>idPattern.test(id));
}

// One persisted attempt per unclaimed period. Reserving before sending prevents
// duplicate pings on concurrent workers or restarts; a crash or failed Discord
// send may instead lose that reminder, and is deliberately not retried.
export async function runTicketReminderPage(client,{after='',now=Date.now()}={}) {
 const guildId=client.homeGuildId, guild=client.guilds.cache.get(guildId);if(!idPattern.test(guildId||'')||!guild)return {after:'',attempted:0};
 const config=await getGuildConfig(client,guildId);if(!validSettings(config))return {after:'',attempted:0};
 const cutoff=now-config.ticketReminderMinutes*60000,enabled=Date.parse(config.ticketReminderEnabledAt);
 if(enabled>cutoff)return {after:'',attempted:0};
 const ids=await page(client,guildId,after,new Date(cutoff).toISOString());let attempted=0;
 for(const id of ids){
  try {
   const currentConfig=await getGuildConfig(client,guildId);
   if(!validSettings(currentConfig)||currentConfig.ticketReminderMinutes!==config.ticketReminderMinutes||currentConfig.ticketReminderEnabledAt!==config.ticketReminderEnabledAt)break;
   const ticket=await getTicketData(guildId,id);const start=Date.parse(ticket?.unclaimedAt||ticket?.createdAt);
   if(!ticket||ticket.status!=='open'||ticket.claimedBy||ticket.reminderAttemptedAt||!Number.isFinite(start)||Math.max(start,enabled)>cutoff)continue;
   ticket.reminderAttemptedAt=new Date(now).toISOString();
   try{await saveTicketData(guildId,id,ticket)}catch(e){if(e.code==='TICKET_STALE')continue;throw e}
   attempted++;
   // Recheck after the reservation; Discord and the database cannot be checked atomically.
   const latest=await getTicketData(guildId,id),settings=await getGuildConfig(client,guildId);
   if(!latest||latest.status!=='open'||latest.claimedBy||latest.reminderAttemptedAt!==ticket.reminderAttemptedAt||!validSettings(settings)||settings.ticketReminderEnabledAt!==config.ticketReminderEnabledAt||settings.ticketReminderMinutes!==config.ticketReminderMinutes)continue;
   const channel=guild.channels.cache.get(id)||await guild.channels.fetch(id).catch(()=>null);
   if(!channel || channel.type!==ChannelType.GuildText || !channel.send)throw Error('Channel tiket tidak tersedia');
   const role=idPattern.test(settings.ticketStaffRoleId||'')?settings.ticketStaffRoleId:null;
   const container=createV2Container({title:'Pengingat tiket',description:`${role?`<@&${role}> `:''}Tiket ini belum diklaim setelah ${settings.ticketReminderMinutes} menit. Silakan periksa jika tersedia.`,color:'warning'});
   await channel.send({...v2Message([container]),allowedMentions:{parse:[],roles:role?[role]:[]}});
  }catch(error){logger.warn(`Pengingat tiket ${id} gagal atau tidak terkirim; tidak dicoba ulang untuk periode ini: ${error.message}`)}
 }
 return {after:ids.length===50?ids.at(-1):'',attempted};
}
export function startTicketReminderWorker(client,{interval=60000}={}) {
 let after='',running=false,stopped=false;
 const tick=async()=>{if(running||stopped)return;running=true;try{const result=await runTicketReminderPage(client,{after});after=result.after}catch(error){logger.warn(`Pengingat tiket tidak dapat diperiksa: ${error.message}`)}finally{running=false}};
 const timer=setInterval(tick,interval);timer.unref?.();void tick();return {tick,stop(){stopped=true;clearInterval(timer)}};
}
