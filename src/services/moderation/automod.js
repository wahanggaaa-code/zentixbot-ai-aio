import {randomUUID,createHash} from 'node:crypto';
import {ChannelType,PermissionFlagsBits} from 'discord.js';
import {RE2} from 're2-wasm';
import {pgConfig} from '../../config/database/postgres.js';
import {sqliteBackend} from '../storage/sqlite.js';
import {isHomeGuild} from '../../utils/singleGuild.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';
import {logger} from '../../utils/logger.js';
import {WarningService} from './warningService.js';
import {logModerationAction} from '../../utils/moderation.js';
import {scheduleTemporaryBan} from './temporaryBans.js';

const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const id=/^\d{17,20}$/;
const protectedMember=member=>[PermissionFlagsBits.Administrator,PermissionFlagsBits.ModerateMembers,PermissionFlagsBits.BanMembers,PermissionFlagsBits.KickMembers,PermissionFlagsBits.ManageGuild].some(permission=>member.permissions.has(permission));
export const DEFAULT_AUTOMOD=Object.freeze({enabled:false,spamEnabled:false,spamCount:6,spamSeconds:10,mentionsEnabled:false,mentionCount:5,wordsEnabled:false,wholeWords:[],partialWords:[],wildcardWords:[],regexWords:[],spamAction:'log',mentionsAction:'log',wordsAction:'log',spamDeleteAfter:false,mentionsDeleteAfter:false,wordsDeleteAfter:false,linksEnabled:false,blockInvites:true,allowedDomains:[],linksAction:'log',linksDeleteAfter:false,repeatEnabled:false,repeatCount:3,repeatSeconds:10,repeatAction:'log',repeatDeleteAfter:false,capsEnabled:false,capsMinimum:12,capsPercent:75,capsAction:'log',capsDeleteAfter:false,raidEnabled:false,raidCount:10,raidSeconds:30,raidLockEnabled:false,raidLockChannels:[],aiReviewEnabled:false,aiVisionEnabled:false,aiReviewChannels:[],escalationEnabled:false,escalationThreshold:3,escalationMinutes:60,ruleChannels:{spam:[],mentions:[],words:[],links:[],repeat:[],caps:[]},channelOverrides:{},temporaryBanMinutes:0,timeoutMinutes:10,logChannelId:null,ignoredChannels:[],ignoredRoles:[]});
const key=guild=>`automod:settings:${guild}`;
function pool(client){const db=client?.db;if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw bad('Database tidak tersedia.',503);return db.db.pool}
export const AUTOMOD_OVERRIDE_KEYS=Object.freeze(['spamCount','spamSeconds','mentionCount','repeatCount','repeatSeconds','capsMinimum','capsPercent','wholeWords','partialWords','wildcardWords','regexWords','allowedDomains','blockInvites']);
const regexCache=new Map();
function compilePattern(pattern){let re=regexCache.get(pattern);if(!re){re=new RE2(pattern,'iu');if(regexCache.size>=256)regexCache.delete(regexCache.keys().next().value);regexCache.set(pattern,re)}return re;}
// Shared by AutoMod and the draft-only copilot; keep exactly the production rules.
export function validateAutomodRegex(patterns){
 if(!Array.isArray(patterns)||patterns.length>20||new Set(patterns).size!==patterns.length||patterns.some(p=>typeof p!=='string'||!p.trim()||p.length>80||/[\r\n\u0000-\u001f]/.test(p)))throw bad('Pola regex tidak valid: maksimal 20 pola, 1–80 karakter.');
 try{for(const pattern of patterns){if(compilePattern(pattern).test(''))throw Error('empty match')}}catch{throw bad('Pola regex tidak valid, tidak didukung RE2, atau cocok dengan teks kosong.');}
 return patterns;
}
export function validateAutomod(value,guild,internal=false){
 const keys=Object.keys(DEFAULT_AUTOMOD);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw bad('Pengaturan AutoMod tidak valid.');
 if(['enabled','spamEnabled','mentionsEnabled','wordsEnabled','spamDeleteAfter','mentionsDeleteAfter','wordsDeleteAfter','linksEnabled','blockInvites','linksDeleteAfter','repeatEnabled','repeatDeleteAfter','capsEnabled','capsDeleteAfter','raidEnabled','raidLockEnabled','escalationEnabled','aiReviewEnabled','aiVisionEnabled'].some(k=>typeof value[k]!=='boolean')||!Number.isInteger(value.spamCount)||value.spamCount<3||value.spamCount>20||!Number.isInteger(value.spamSeconds)||value.spamSeconds<3||value.spamSeconds>120||!Number.isInteger(value.mentionCount)||value.mentionCount<2||value.mentionCount>20)throw bad('Batas AutoMod tidak valid.');
 const actions=['log','delete','warn','timeout','ban'];if(['spamAction','mentionsAction','wordsAction','linksAction','repeatAction','capsAction'].some(k=>!actions.includes(value[k]))||!Number.isInteger(value.timeoutMinutes)||value.timeoutMinutes<1||value.timeoutMinutes>40320)throw bad('Tindakan AutoMod tidak valid.');
 if(!Number.isInteger(value.repeatCount)||value.repeatCount<2||value.repeatCount>20||!Number.isInteger(value.repeatSeconds)||value.repeatSeconds<3||value.repeatSeconds>120||!Number.isInteger(value.capsMinimum)||value.capsMinimum<5||value.capsMinimum>500||!Number.isInteger(value.capsPercent)||value.capsPercent<50||value.capsPercent>100)throw bad('Batas deteksi tambahan tidak valid.');
 if(!Array.isArray(value.allowedDomains)||value.allowedDomains.length>50||value.allowedDomains.some(d=>typeof d!=='string'||d.length>253||! /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d))||new Set(value.allowedDomains).size!==value.allowedDomains.length)throw bad('Domain yang diizinkan tidak valid. Gunakan domain huruf kecil tanpa protokol.');
 if(!Number.isInteger(value.temporaryBanMinutes)||value.temporaryBanMinutes<0||value.temporaryBanMinutes>40320)throw bad('Durasi ban sementara tidak valid.');
 if(!Number.isInteger(value.escalationThreshold)||value.escalationThreshold<2||value.escalationThreshold>20||!Number.isInteger(value.escalationMinutes)||value.escalationMinutes<1||value.escalationMinutes>40320)throw bad('Batas eskalasi warning tidak valid.');
 if(!Number.isInteger(value.raidCount)||value.raidCount<3||value.raidCount>100||!Number.isInteger(value.raidSeconds)||value.raidSeconds<5||value.raidSeconds>300)throw bad('Batas anti-raid tidak valid.');
 const ruleNames=['spam','mentions','words','links','repeat','caps'];if(!value.ruleChannels||typeof value.ruleChannels!=='object'||Array.isArray(value.ruleChannels)||Object.keys(value.ruleChannels).length!==ruleNames.length||ruleNames.some(k=>!Array.isArray(value.ruleChannels[k])||value.ruleChannels[k].length>50||new Set(value.ruleChannels[k]).size!==value.ruleChannels[k].length||value.ruleChannels[k].some(x=>typeof x!=='string'||!id.test(x))))throw bad('Channel per aturan tidak valid.');
 validateAutomodRegex(value.regexWords);
 if(!value.channelOverrides||typeof value.channelOverrides!=='object'||Array.isArray(value.channelOverrides)||Object.keys(value.channelOverrides).length>10)throw bad('Pengaturan khusus channel tidak valid.');
 if(!internal)for(const [channelId,override] of Object.entries(value.channelOverrides)){
  if(!id.test(channelId)||!override||typeof override!=='object'||Array.isArray(override)||Object.keys(override).length!==AUTOMOD_OVERRIDE_KEYS.length||AUTOMOD_OVERRIDE_KEYS.some(k=>!Object.hasOwn(override,k)))throw bad('Pengaturan khusus channel tidak valid.');
  validateAutomod({...value,...override,channelOverrides:{}},null,true);
 }
 for(const k of ['wholeWords','partialWords','wildcardWords'])if(!Array.isArray(value[k])||value[k].length>50||value[k].some(word=>typeof word!=='string'||word.trim().length<2||word.length>40||/[\r\n\u0000-\u001f]/.test(word))||new Set(value[k].map(word=>word.trim().normalize('NFKC').toLocaleLowerCase())).size!==value[k].length)throw bad('Daftar filter kata tidak valid: maksimal 50 entri per mode, 2–40 karakter.');
 if(value.wildcardWords.some(x=>!x.includes('*')||!x.replace(/\*/g,'').trim()||x.split('*').length>6))throw bad('Wildcard harus mengandung teks dan maksimal 5 tanda bintang.');
 for(const k of ['ignoredChannels','ignoredRoles','aiReviewChannels','raidLockChannels'])if(!Array.isArray(value[k])||value[k].length>50||new Set(value[k]).size!==value[k].length||value[k].some(x=>typeof x!=='string'||!id.test(x)))throw bad('Pengecualian AutoMod tidak valid.');
 if(value.logChannelId!==null&&(typeof value.logChannelId!=='string'||!id.test(value.logChannelId)))throw bad('Channel log tidak valid.');
 if(guild){
  if(value.raidLockChannels.length>10||value.raidLockChannels.some(x=>guild.channels.cache.get(x)?.type!==ChannelType.GuildText)||Object.keys(value.channelOverrides).some(x=>guild.channels.cache.get(x)?.type!==ChannelType.GuildText)||value.aiReviewChannels.some(x=>!guild.channels.cache.has(x)||guild.channels.cache.get(x)?.type!==ChannelType.GuildText)||Object.values(value.ruleChannels).some(list=>list.some(x=>!guild.channels.cache.has(x)))||value.ignoredChannels.some(x=>!guild.channels.cache.has(x))||value.ignoredRoles.some(x=>!guild.roles.cache.has(x)))throw bad('Channel atau role pengecualian tidak ditemukan.');
  const channel=value.logChannelId&&guild.channels.cache.get(value.logChannelId);if(value.logChannelId&&channel?.type!==ChannelType.GuildText)throw bad('Pilih channel teks untuk log.');
  if(value.enabled){if(!channel||!guild.members.me||!channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw bad('Pilih channel log yang dapat dilihat dan dikirimi pesan oleh bot.');if(!value.spamEnabled&&!value.mentionsEnabled&&!value.wordsEnabled&&!value.linksEnabled&&!value.repeatEnabled&&!value.capsEnabled&&!value.raidEnabled&&!value.aiReviewEnabled)throw bad('Aktifkan minimal satu deteksi.');if(value.raidEnabled&&value.raidLockEnabled&&!value.raidLockChannels.length)throw bad('Pilih channel lockdown anti-raid.');if(value.raidLockChannels.includes(value.logChannelId))throw bad('Channel log tidak dapat digunakan untuk lockdown.');if(value.aiReviewEnabled&&!value.aiReviewChannels.length)throw bad('Pilih channel untuk tinjauan AI.');if(value.wordsEnabled&&!value.wholeWords.length&&!value.partialWords.length&&!value.wildcardWords.length&&!value.regexWords.length&&!Object.values(value.channelOverrides).some(o=>o.wholeWords.length||o.partialWords.length||o.wildcardWords.length||o.regexWords.length))throw bad('Masukkan minimal satu kata atau frasa filter.');}
 }
 return {...value,wholeWords:value.wholeWords.map(x=>x.trim()),partialWords:value.partialWords.map(x=>x.trim()),wildcardWords:value.wildcardWords.map(x=>x.trim()),ignoredChannels:[...value.ignoredChannels],ignoredRoles:[...value.ignoredRoles]};
}
function unpack(raw){if(raw===null)return {revision:'missing',settings:{...DEFAULT_AUTOMOD,ignoredChannels:[],ignoredRoles:[]}};if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.revision!=='string'||!/^[-a-f0-9]{36}$/.test(raw.revision))throw bad('Pengaturan AutoMod tersimpan tidak valid.',409);return {revision:raw.revision,settings:validateAutomod({...DEFAULT_AUTOMOD,...raw.settings})};}
export function createAutomodStore(client){
 const sqlite=sqliteBackend(client);
 return {
  async read(guildId){if(sqlite)return unpack(sqlite.get(key(guildId)));const rows=await pool(client).query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1`,[key(guildId)]);return unpack(rows.rows[0]?.value??null)},
  async save(guildId,revision,settings){const next={revision:randomUUID(),settings:validateAutomod(settings)};if(sqlite)return sqlite.transaction(tx=>{const previous=unpack(tx.get(key(guildId)));if(previous.revision!==revision)throw bad('Pengaturan berubah. Muat ulang sebelum menyimpan.',409);tx.set(key(guildId),next);return next});
   const conn=await pool(client).connect();try{await conn.query('BEGIN');await conn.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[key(guildId)]);const rows=await conn.query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1 FOR UPDATE`,[key(guildId)]);if(unpack(rows.rows[0]?.value??null).revision!==revision)throw bad('Pengaturan berubah. Muat ulang sebelum menyimpan.',409);await conn.query(`INSERT INTO ${pgConfig.tables.cache_data} (key,value,expires_at) VALUES ($1,$2::jsonb,NULL) ON CONFLICT (key) DO UPDATE SET value=excluded.value,expires_at=NULL`,[key(guildId),JSON.stringify(next)]);await conn.query('COMMIT');return next}catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release()}
  }
 };
}
// Literal matching only; normalize Unicode and require letter/number boundaries for whole-word rules.
export function matchesFilteredWords(content,wholeWords,partialWords,wildcardWords=[],regexWords=[]){
 if(typeof content!=='string'||!content)return false;const text=content.normalize('NFKC').toLocaleLowerCase();
 for(const pattern of regexWords){if(compilePattern(pattern).test(text))return true;}
 for(const word of partialWords){if(text.includes(word.normalize('NFKC').toLocaleLowerCase()))return true;}
 // Wildcards are ordered literal segments, not executable regular expressions.
 for(const pattern of wildcardWords){let cursor=0,found=true;for(const part of pattern.normalize('NFKC').toLocaleLowerCase().split('*').filter(Boolean)){const at=text.indexOf(part,cursor);if(at<0){found=false;break}cursor=at+part.length}if(found)return true;}
 for(const word of wholeWords){const part=word.normalize('NFKC').toLocaleLowerCase(),escaped=part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(new RegExp(`(^|[^\\p{L}\\p{N}\\p{M}_])${escaped}(?=$|[^\\p{L}\\p{N}\\p{M}_])`,'u').test(text))return true;}return false;
}
// Detect conventional web links without making network requests. Allowlist matches domain and subdomains only.
export function matchesBlockedLink(content,allowedDomains=[],blockInvites=true){
 if(typeof content!=='string')return false;
 const text=content.normalize('NFKC');
 const pattern=/(?<![\w@.-])(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[\/?#][^\s<>]*)?/gi;
 for(const match of text.matchAll(pattern)){
  let host;try{host=new URL(/^https?:\/\//i.test(match[0])?match[0]:'https://'+match[0]).hostname.toLowerCase()}catch{continue}
  const invite=host==='discord.gg'||host==='discord.com'&&/^\/invite(?:\/|$)/i.test(new URL(/^https?:\/\//i.test(match[0])?match[0]:'https://'+match[0]).pathname)||host==='discordapp.com'&&/^\/invite(?:\/|$)/i.test(new URL(/^https?:\/\//i.test(match[0])?match[0]:'https://'+match[0]).pathname);
  if(invite&&blockInvites)return true;
  if(!allowedDomains.some(domain=>host===domain||host.endsWith('.'+domain)))return true;
 }
 return false;
}
export function matchesExcessiveCaps(content,minimum,percent){
 const letters=[...String(content||'')].filter(c=>/\p{L}/u.test(c)&&c.toLocaleLowerCase()!==c.toLocaleUpperCase());
 return letters.length>=minimum&&letters.filter(c=>c===c.toLocaleUpperCase()).length*100>=letters.length*percent;
}
// In-memory, bounded detection state: restart resets windows and cooldowns; never store message contents.
export function createAutomodDetector({read,report,now=Date.now,maxEntries=5000}){
 const windows=new Map(),repeats=new Map(),cooldowns=new Map(),reportWindows=new Map(),actionCooldowns=new Map();
 const bounded=(map,key,value)=>{if(!map.has(key)&&map.size>=maxEntries)map.delete(map.keys().next().value);map.set(key,value)};
 return {async handle(message){
  if(!message.guild||!message.member||typeof message.member.permissions?.has!=='function'||message.author?.bot||message.webhookId||!id.test(message.author?.id||'')||!id.test(message.channelId||'')||!id.test(message.id||''))return;
  const savedConfig=await read(message.guild.id);const config={...savedConfig,...(savedConfig.channelOverrides[message.channelId]??savedConfig.channelOverrides[message.channel?.parentId]??{})};if(!config.enabled||config.logChannelId===message.channelId||config.logChannelId===message.channel?.parentId||config.ignoredChannels.includes(message.channelId)||config.ignoredChannels.includes(message.channel?.parentId))return;
  if(message.author.id===message.guild.ownerId||protectedMember(message.member))return;
  if(config.ignoredRoles.length&&!message.member.roles?.cache?.has)return;
  if(config.ignoredRoles.some(role=>message.member.roles?.cache?.has(role)))return;
  const applies=rule=>{const channels=config.ruleChannels[rule];return !channels.length||channels.includes(message.channelId)||channels.includes(message.channel?.parentId)};
  const time=now(),scope=`${message.guild.id}:${message.channelId}:${message.author.id}`,hits=[];
  if(config.spamEnabled&&applies('spam')){const times=(windows.get(scope)||[]).filter(t=>t>time-config.spamSeconds*1000);times.push(time);bounded(windows,scope,times.slice(-20));if(times.length>=config.spamCount)hits.push('spam');}
  if(config.mentionsEnabled&&applies('mentions')){const users=message.mentions?.users;const unique=new Set(users?[...users.values()].filter(u=>!u.bot&&u.id!==message.author.id&&id.test(u.id||'')).map(u=>u.id):[]);if(unique.size>=config.mentionCount)hits.push('mass-mention');}
  if(config.wordsEnabled&&applies('words')&&matchesFilteredWords(message.content,config.wholeWords,config.partialWords,config.wildcardWords,config.regexWords))hits.push('words');
  if(config.linksEnabled&&applies('links')&&matchesBlockedLink(message.content,config.allowedDomains,config.blockInvites))hits.push('links');
  if(config.capsEnabled&&applies('caps')&&matchesExcessiveCaps(message.content,config.capsMinimum,config.capsPercent))hits.push('caps');
  if(config.repeatEnabled&&applies('repeat')&&typeof message.content==='string'&&message.content.trim().length>=3){const hash=createHash('sha256').update(message.content.normalize('NFKC').trim().toLocaleLowerCase()).digest('hex');const records=(repeats.get(scope)||[]).filter(x=>x.time>time-config.repeatSeconds*1000);records.push({hash,time});bounded(repeats,scope,records.slice(-20));if(records.filter(x=>x.hash===hash).length>=config.repeatCount)hits.push('repeat');}
  const rank={log:0,delete:1,warn:2,timeout:3,ban:4};const actionFor={spam:config.spamAction,'mass-mention':config.mentionsAction,words:config.wordsAction,links:config.linksAction,repeat:config.repeatAction,caps:config.capsAction};const eligible=hits.filter(type=>(cooldowns.get(scope+':'+type)||0)<=time);eligible.sort((a,b)=>rank[actionFor[b]]-rank[actionFor[a]]);
  for(const type of eligible.slice(0,1)){const k=scope+':'+type;if((cooldowns.get(k)||0)>time)continue;const recent=(reportWindows.get(message.guild.id)||[]).filter(t=>t>time-60000);if(recent.length>=30)continue;recent.push(time);bounded(reportWindows,message.guild.id,recent);bounded(cooldowns,k,time+60000);const action=actionFor[type];if(action!=='log'){const account=message.guild.id+':'+message.author.id;if((actionCooldowns.get(account)||0)>time)continue;bounded(actionCooldowns,account,time+60000)}try{await report(message,savedConfig,type)}catch(e){logger.warn(`AutoMod: gagal mengirim laporan ${type}: ${e?.message||e}`)}}
 }};
}
export async function performAutomodAction(message,client,action,minutes,label,ignoredRoles=[],{warn=WarningService.addWarning.bind(WarningService),log=logModerationAction,deleteAfter=false,escalation=null,temporaryBanMinutes=0,scheduleBan=scheduleTemporaryBan}={}){
 if(action==='log')return 'Catat saja';
 const guild=message.guild,me=guild.members?.me;
 try{
  // Re-fetch before any destructive action: never act on stale privileges or hierarchy.
  const member=await guild.members.fetch({user:message.author.id,force:true});
  if(!member||!me||member.id===guild.ownerId||member.id===client.user?.id||typeof member.permissions?.has!=='function'||protectedMember(member))throw Error('Anggota dikecualikan atau izin tidak tersedia');
  if(ignoredRoles.length&&(!member.roles?.cache||ignoredRoles.some(role=>member.roles.cache.has(role))))throw Error('Role dikecualikan atau tidak tersedia');
  const botRole=me.roles?.highest,targetRole=member.roles?.highest;if(!botRole||!targetRole||botRole.position<=targetRole.position)throw Error('Hierarki role bot tidak cukup');
  const required={delete:PermissionFlagsBits.ManageMessages,warn:PermissionFlagsBits.ModerateMembers,timeout:PermissionFlagsBits.ModerateMembers,ban:PermissionFlagsBits.BanMembers}[action];if(!required||!me.permissions?.has(required))throw Error('Izin bot tidak cukup');
  if(action==='delete'){if(!message.channel?.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)||!message.deletable)throw Error('Pesan tidak dapat dihapus');await message.delete();return 'Pesan dihapus';}
  const reason=`AutoMod: ${label}`;
  let warningResult;
  if(action==='warn'){warningResult=await warn({guildId:guild.id,userId:member.id,moderatorId:client.user.id,reason});}
  else if(action==='timeout'){if(!member.moderatable)throw Error('Anggota tidak dapat di-timeout');if(member.communicationDisabledUntilTimestamp>Date.now())throw Error('Anggota sudah timeout; durasi tidak diubah');await member.timeout(minutes*60000,reason);}
  else if(action==='ban'){if(!member.bannable)throw Error('Anggota tidak dapat di-ban');const banReason=temporaryBanMinutes?(await scheduleBan(client,guild,member.id,temporaryBanMinutes)).reason:reason;await member.ban({reason:banReason,deleteMessageSeconds:0});}
  let result=`${action} berhasil${action==='ban'&&temporaryBanMinutes?` (sementara ${temporaryBanMinutes} menit)`:''}`;
  try{await log({client,guild,event:{action:action==='warn'?'User Warned':action==='timeout'?'Member Timed Out':'Member Banned',target:`${member.user?.tag||member.id} (${member.id})`,executor:`AutoMod (${client.user.id})`,reason,metadata:{userId:member.id,moderatorId:client.user.id}}});}catch(e){logger.warn(`AutoMod: tindakan ${action} terjadi tetapi kasus gagal disimpan: ${e?.message||e}`);result+='; kasus gagal disimpan';}
  if(action==='warn'){const outcome=await applyWarningEscalation({client,guild,userId:message.author.id,activeCount:warningResult?.activeCount,ignoredRoles,escalation,log});if(outcome)result+=`; ${outcome}`;}
  // Delete only after the sanction succeeded. A deletion failure must not conceal a successful sanction.
  if(deleteAfter&&(action==='warn'||action==='timeout'||action==='ban')){
   try{if(!me.permissions?.has(PermissionFlagsBits.ManageMessages)||!message.channel?.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages)||!message.deletable)throw Error('izin tidak cukup atau pesan tidak dapat dihapus');await message.delete();result+='; pesan dihapus';}
   catch(e){logger.warn(`AutoMod: gagal menghapus pesan setelah ${action}: ${e?.message||e}`);result+='; pesan gagal dihapus';}
  }
  return result;
 }catch(e){return `${action} gagal: ${String(e?.message||'periksa izin').slice(0,160)}`;}
}
// The threshold comes from the same transaction that writes the warning, preventing duplicate crossing on concurrent warnings.
export async function applyWarningEscalation({client,guild,userId,activeCount,ignoredRoles=[],escalation,log=logModerationAction}){
 if(!escalation?.enabled||activeCount!==escalation.threshold)return '';
 try{
  if(!await escalation.stillEnabled())throw Error('pengaturan berubah');
  const fresh=await guild.members.fetch({user:userId,force:true});const bot=guild.members.me;
  if(!fresh||!bot||fresh.id===guild.ownerId||fresh.id===client.user?.id||typeof fresh.permissions?.has!=='function'||protectedMember(fresh)||ignoredRoles.length&&(!fresh.roles?.cache||ignoredRoles.some(role=>fresh.roles.cache.has(role)))||!bot.roles?.highest||!fresh.roles?.highest||bot.roles.highest.position<=fresh.roles.highest.position||!bot.permissions?.has(PermissionFlagsBits.ModerateMembers)||!fresh.moderatable)throw Error('anggota dikecualikan, hierarki, atau izin tidak cukup');
  if(fresh.communicationDisabledUntilTimestamp>Date.now())throw Error('anggota sudah timeout');
  const reason=`AutoMod: ${escalation.threshold} warning aktif`;await fresh.timeout(escalation.minutes*60000,reason);let result='eskalasi timeout berhasil';
  try{await log({client,guild,event:{action:'Member Timed Out',target:`${fresh.user?.tag||fresh.id} (${fresh.id})`,executor:`AutoMod (${client.user.id})`,reason,metadata:{userId:fresh.id,moderatorId:client.user.id}}});}catch(e){logger.warn(`AutoMod: kasus eskalasi gagal disimpan: ${e?.message||e}`);result+='; kasus eskalasi gagal disimpan';}
  return result;
 }catch(e){return `eskalasi timeout gagal: ${String(e?.message||'periksa izin').slice(0,120)}`;}
}
export async function escalateManualWarning(client,guild,userId,warning){
 if(!isHomeGuild(client,guild?.id))return '';
 try{
  const store=createAutomodStore(client),cfg=(await store.read(guild.id)).settings;
  return await applyWarningEscalation({client,guild,userId,activeCount:warning.activeCount,ignoredRoles:cfg.ignoredRoles,escalation:{enabled:cfg.enabled&&cfg.escalationEnabled,threshold:cfg.escalationThreshold,minutes:cfg.escalationMinutes,stillEnabled:async()=>JSON.stringify((await store.read(guild.id)).settings)===JSON.stringify(cfg)}});
 }catch{ return 'eskalasi tidak diperiksa: pengaturan tidak tersedia'; }
}
export function deleteAfterForRule(settings,type){return ({spam:settings.spamDeleteAfter,'mass-mention':settings.mentionsDeleteAfter,words:settings.wordsDeleteAfter,links:settings.linksDeleteAfter,repeat:settings.repeatDeleteAfter,caps:settings.capsDeleteAfter})[type]===true;}
const detectors=new WeakMap(),cache=new WeakMap();
export function invalidateAutomod(client,guildId){cache.get(client)?.delete(guildId);detectors.delete(client)}
export async function handleAutomod(message,client){
 if(!isHomeGuild(client,message.guild?.id))return;
 if(!detectors.has(client)){
  const saved=new Map();cache.set(client,saved);const store=createAutomodStore(client);
  detectors.set(client,createAutomodDetector({read:async guild=>{const current=saved.get(guild);if(current&&current.until>Date.now())return current.settings;const data=await store.read(guild);if(saved.size>=20&&!saved.has(guild))saved.delete(saved.keys().next().value);saved.set(guild,{settings:data.settings,until:Date.now()+5000});return data.settings},report:async(msg,cfg,type)=>{
   const current=(await store.read(msg.guild.id)).settings;if(JSON.stringify(current)!==JSON.stringify(cfg))return;
   const channel=msg.guild.channels.cache.get(cfg.logChannelId);if(!channel?.send||!msg.guild.members.me||!channel.permissionsFor(msg.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw Error('Channel log tidak tersedia');const names={spam:['Spam','spamAction'],words:['Filter kata','wordsAction'],'mass-mention':['Mass mention','mentionsAction'],links:['Filter link','linksAction'],repeat:['Pesan berulang','repeatAction'],caps:['Huruf kapital','capsAction']};const [label,actionKey]=names[type];const action=cfg[actionKey];const result=await performAutomodAction(msg,client,action,cfg.timeoutMinutes,label,cfg.ignoredRoles,{deleteAfter:deleteAfterForRule(cfg,type),temporaryBanMinutes:cfg.temporaryBanMinutes,escalation:{enabled:cfg.escalationEnabled,threshold:cfg.escalationThreshold,minutes:cfg.escalationMinutes,stillEnabled:async()=>JSON.stringify((await store.read(msg.guild.id)).settings)===JSON.stringify(cfg)}});const container=createV2Container({title:`AutoMod · ${label}`,description:`Tindakan: ${result}\nAnggota: ${msg.author.id}\nChannel: ${msg.channelId}\nPesan: ${msg.id}`,color:'warning'});await channel.send({...v2Message([container]),allowedMentions:{parse:[]}});
  }}));
 }
 await detectors.get(client).handle(message);
}
