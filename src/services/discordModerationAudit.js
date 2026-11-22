import { AuditLogEvent } from 'discord.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

// Audit entries are unique Discord snowflakes. Bound the in-memory replay guard;
// it is not a durable archive and cannot recover events missed while offline.
const seen=new Map();
export function clearDiscordAuditReplayGuard(){seen.clear();}
export function describeDiscordModeration(entry,botId){
 if(!entry?.id || !entry.executorId || !entry.targetId || !botId || entry.executorId===botId) return null;
 let eventType,title;
 if(entry.action===AuditLogEvent.MemberBanAdd){eventType=EVENT_TYPES.DISCORD_MOD_BAN;title='Ban lewat Discord';}
 else if(entry.action===AuditLogEvent.MemberBanRemove){eventType=EVENT_TYPES.DISCORD_MOD_UNBAN;title='Unban lewat Discord';}
 else if(entry.action===AuditLogEvent.MemberKick){eventType=EVENT_TYPES.DISCORD_MOD_KICK;title='Kick lewat Discord';}
 else if(entry.action===AuditLogEvent.MemberUpdate){
  const change=entry.changes?.find(x=>x.key==='communication_disabled_until');if(!change)return null;
  eventType=EVENT_TYPES.DISCORD_MOD_TIMEOUT;title=change.new?'Timeout lewat Discord':'Timeout dicabut lewat Discord';
 } else return null;
 const lines=[`Target: ${entry.targetId}`,`Pelaku: ${entry.executorId}`,`Audit ID: ${entry.id}`];
 if(entry.reason)lines.push(`Alasan: ${String(entry.reason).slice(0,900)}`);
 return {eventType,data:{title,lines,userId:entry.targetId,userIds:[entry.executorId]}};
}
export async function handleDiscordModerationAudit(entry,guild,client,{send=logEvent,now=Date.now()}={}){
 if(!guild?.id || !client?.homeGuildId || guild.id!==client.homeGuildId)return false;
 const detail=describeDiscordModeration(entry,client.user?.id);if(!detail)return false;
 for(const [key,time] of seen) if(now-time>600000)seen.delete(key);
 const key=`${guild.id}:${entry.id}`;if(seen.has(key))return false;
 if(seen.size>=5000)seen.delete(seen.keys().next().value);
 seen.set(key,now);await send({client,guildId:guild.id,...detail});return true;
}
