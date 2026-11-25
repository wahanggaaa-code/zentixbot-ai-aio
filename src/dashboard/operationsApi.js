import express from 'express';
import {ChannelType, PermissionFlagsBits} from 'discord.js';
import { pgConfig } from '../config/database/postgres.js';
import { sqliteBackend } from '../services/storage/sqlite.js';
import { readSQLiteBotValue } from '../services/storage/sqliteBotDatabase.js';
import {mutateLevelInTransaction} from '../services/leveling/sqliteLevels.js';
import { getGuildMusicData } from '../services/music/playerStore.js';
import {getPlayer,applyPause,applyResume,destroyPlayerSession,playQuery} from '../services/music/musicActions.js';
import {createAutomodStore,validateAutomod,invalidateAutomod,escalateManualWarning} from '../services/moderation/automod.js';
import {ModerationService} from '../services/moderation/moderationService.js';
import {WarningService} from '../services/moderation/warningService.js';
import {logModerationAction} from '../utils/moderation.js';
import {closeTicket,reopenTicket,claimTicket,transferTicket} from '../services/ticket.js';
import {getGuildConfig} from '../services/config/guildConfig.js';
import {createV2Container,v2Message} from '../utils/componentsV2.js';
import {quickRepliesFromConfig,quickRepliesRevision} from '../services/tickets/quickReplies.js';
import {validateTicketTags,updateTicketTags} from '../services/tickets/tags.js';
import {inspectTicketResponses,readResponseSlaConfig} from '../services/tickets/responseSla.js';
import {calculateTotalXp, getLevelingConfig, getLevelLockKey} from '../services/leveling/leveling.js';
import {syncMemberRewardRoles} from '../services/leveling/rewardRoles.js';
import { Mutex } from '../utils/mutex.js';
import { summarizeAuditMessage } from './logHistory.js';

const tables=pgConfig.tables;
const idRe=/^\d{17,20}$/;

// After a level was stored from the web: give the reward roles the member is
// now entitled to. The level stays stored whatever happens here; the answer
// only reports what was given and what was not.
async function rewardRolesAfterLevel(client, guild, member, level) {
    try {
        const config = await getLevelingConfig(client, guild.id);
        const result = await syncMemberRewardRoles(guild, member, level, config, { source: 'web dashboard' });
        return {
            added: result.added.map(({ level: at, roleId }) => ({ level: at, roleId })),
            notGiven: [...result.skipped, ...result.failed].map(({ level: at, roleId, code }) => ({ level: at, roleId, code })),
        };
    } catch (error) {
        console.error('[dashboard] reward role sync failed:', error?.message);
        return null;
    }
}
function safeMusicQuery(value){
 if(typeof value!=='string'||!value.trim()||value.length>300)throw bad('Masukkan judul lagu atau tautan.');
 const query=value.trim();
 if (/^[a-z][a-z0-9+.-]*:/i.test(query)) {
  let url;try{url=new URL(query)}catch{throw bad('Tautan tidak valid.')}
  const host=url.hostname.toLowerCase();const allowed=['soundcloud.com','spotify.com','deezer.com','bandcamp.com','music.apple.com'];
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed.some(domain=>host===domain||host.endsWith('.'+domain)))throw bad('Tautan hanya didukung dari layanan musik HTTPS yang diizinkan.');
 }
 return query;
}

const bad=(message,status=400)=>Object.assign(new Error(message),{status});
function pool(client){const d=client.db;if(!d||d.getStatus?.().isDegraded||!d.isAvailable?.()||!d.db?.isAvailable?.()||!d.db.pool)throw bad('Database persisten tidak tersedia.',503);return d.db.pool;}
function requireStorage(client){const sqlite=sqliteBackend(client);if(sqlite)return sqlite;return pool(client)}
const TICKET_REFUSALS={
 TICKET_STALE:'Tiket baru saja diubah oleh tindakan lain. Tindakan Anda tidak diterapkan; muat ulang lalu coba lagi.',
 TICKET_NOT_OPEN:'Tiket sudah ditutup.',
 TICKET_NOT_CLOSED:'Tiket tidak dalam keadaan tertutup.',
 TICKET_CLAIMED:'Tiket sudah diklaim.',
 TICKET_TRANSFER_INVALID:'Staff atau penanggung jawab tidak valid.',
 TICKET_TRANSFER_TARGET:'Staff harus anggota aktif dengan izin ticket staff atau Manage Channels serta akses melihat dan mengirim pesan di tiket.',
};
function fail(res,e){if(!e.status)console.error('[dashboard operations]',e.message);res.status(e.status||503).json({error:e.status?e.message:'Operasi gagal; periksa izin bot dan log server. Bila tindakan Discord sudah terjadi, periksa sebelum mencoba lagi.'});}
function sqliteLeaderboard(sqlite,guildId){return sqlite.botLevels(guildId).map(({userId,data})=>{
 if(!data||typeof data!=='object'||Array.isArray(data))throw bad('Data leveling tidak valid.',503);
 const level=Number(data.level??0),totalXp=Number(data.totalXp??0);if(!Number.isSafeInteger(level)||level<0||!Number.isSafeInteger(totalXp)||totalXp<0)throw bad('Data leveling tidak valid.',503);return {userId,level,totalXp};
}).filter(x=>x.totalXp>0).sort((a,b)=>b.totalXp-a.totalXp||a.userId.localeCompare(b.userId)).slice(0,50)}
const track=t=>t?{title:String(t.info?.title||'Unknown').slice(0,300),author:String(t.info?.author||'Unknown').slice(0,200),uri:t.info?.uri||null,length:t.info?.length||null}:null;
export function createOperationsApi(client,{auth,csrf}) {
 const router=express.Router();router.use(express.json({limit:'16kb'}));
 router.get('/automod',auth,async(req,res)=>{try{
  const saved=await createAutomodStore(client).read(req.guild.id);const channels=[...req.guild.channels.cache.values()].filter(c=>c.type===ChannelType.GuildText).map(({id,name})=>({id,name}));const roles=[...req.guild.roles.cache.values()].filter(r=>r.id!==req.guild.id).map(({id,name})=>({id,name}));res.json({...saved,channels,roles});
 }catch(e){fail(res,e)}});
 router.patch('/automod',auth,csrf,async(req,res)=>{try{
  const body=req.body;if(!body||Object.keys(body).some(k=>!['confirmBan','confirmAi','confirmLock','revision','settings'].includes(k))||typeof body.revision!=='string')throw bad('Pengaturan AutoMod tidak valid.');const settings=validateAutomod(body.settings,req.guild);if(typeof body.confirmBan!=='boolean')throw bad('Konfirmasi ban tidak valid.');if(settings.enabled&&((settings.spamEnabled&&settings.spamAction==='ban')||(settings.mentionsEnabled&&settings.mentionsAction==='ban')||(settings.wordsEnabled&&settings.wordsAction==='ban')||(settings.linksEnabled&&settings.linksAction==='ban')||(settings.repeatEnabled&&settings.repeatAction==='ban')||(settings.capsEnabled&&settings.capsAction==='ban'))&&!body.confirmBan)throw bad('Konfirmasi ban otomatis diperlukan.');if(settings.enabled&&settings.aiReviewEnabled&&body.confirmAi!==true)throw bad('Konfirmasi pengiriman pesan ke penyedia AI diperlukan.');if(settings.enabled&&settings.raidEnabled&&settings.raidLockEnabled&&body.confirmLock!==true)throw bad('Konfirmasi lockdown otomatis diperlukan.');const saved=await createAutomodStore(client).save(req.guild.id,body.revision,settings);invalidateAutomod(client,req.guild.id);res.json({ok:true,...saved});
 }catch(e){fail(res,e)}});
 router.get('/cases',auth,async(req,res)=>{try{const sqlite=sqliteBackend(client);let cases;if(sqlite)cases=sqlite.botGet(`moderation_cases_list_${req.guild.id}`)||[];else{const row=await pool(client).query(`SELECT value FROM ${tables.temp_data} WHERE key=$1 AND (expires_at IS NULL OR expires_at>NOW())`,[`moderation_cases_list_${req.guild.id}`]);cases=row.rows[0]?.value||[]}res.json({cases:Array.isArray(cases)?cases.slice(-100).reverse():[]});}catch(e){fail(res,e)}});
 router.get('/moderation/members',auth,async(req,res)=>{try{
  const query=req.query.q;
  if(typeof query!=='string'||query.trim().length<2||query.trim().length>80||/[\u0000-\u001f]/.test(query))throw bad('Masukkan nama anggota 2–80 karakter.');
  if(typeof req.guild.members.search!=='function')throw bad('Pencarian anggota tidak tersedia. Gunakan ID Discord.',503);
  const found=await req.guild.members.search({query:query.trim(),limit:10});
  res.json({members:[...found.values()].filter(member=>idRe.test(member.id||'')).slice(0,10).map(member=>({id:member.id,name:String(member.displayName||member.user?.username||'Anggota').slice(0,100),username:String(member.user?.username||'').slice(0,100)}))});
 }catch(e){fail(res,e)}});
 router.post('/moderation',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||Object.keys(b).some(k=>!['action','userId','reason','minutes','banMinutes','confirmed'].includes(k))||b.confirmed!==true||!['warn','timeout','kick','ban'].includes(b.action)||!idRe.test(b.userId||'')||typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>400)throw bad('Tindakan, anggota, alasan, atau konfirmasi tidak valid.');
  if(b.userId===req.member.id || b.userId===client.user.id || b.userId===req.guild.ownerId)throw bad('Tidak dapat menindak diri sendiri, bot, atau owner server.');
  if(b.action==='ban'&&b.banMinutes!==undefined&&(!Number.isInteger(b.banMinutes)||b.banMinutes<0||b.banMinutes>40320))throw bad('Ban sementara harus 0–40320 menit.');
  if(b.action==='timeout' && (!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>40320))throw bad('Timeout harus 1–40320 menit.');
  requireStorage(client);const target=await req.guild.members.fetch({user:b.userId,force:true}).catch(()=>null);if(!target)throw bad('Anggota tidak ditemukan di server.');
  const required={warn:PermissionFlagsBits.ModerateMembers,timeout:PermissionFlagsBits.ModerateMembers,kick:PermissionFlagsBits.KickMembers,ban:PermissionFlagsBits.BanMembers};
  if(!req.guild.members.me?.permissions.has(required[b.action]))throw bad('Bot tidak memiliki izin untuk tindakan ini.',403);
  ModerationService.assertModerationHierarchy(req.member,target,b.action);
  let result;
  if(b.action==='warn'){
   result=await WarningService.addWarning({guildId:req.guild.id,userId:target.id,moderatorId:req.member.id,reason:b.reason});
   const caseId=await logModerationAction({client,guild:req.guild,event:{action:'User Warned',target:`${target.user.tag} (${target.id})`,executor:`${req.member.user.tag} (${req.member.id})`,reason:b.reason,metadata:{userId:target.id,moderatorId:req.member.id,warningId:result.id}}});
   const escalation=await escalateManualWarning(client,req.guild,target.id,result);result={...result,caseId,escalation};
  }else if(b.action==='timeout')result=await ModerationService.timeoutUser({guild:req.guild,member:target,moderator:req.member,reason:b.reason,durationMs:b.minutes*60000});
  else if(b.action==='kick')result=await ModerationService.kickUser({guild:req.guild,member:target,moderator:req.member,reason:b.reason});
  else result=await ModerationService.banUser({guild:req.guild,user:target.user,moderator:req.member,reason:b.reason,temporaryMinutes:b.banMinutes||0});
  res.json({ok:true,caseId:result?.caseId||null,...(result?.escalation?{escalation:result.escalation}:{})});
 }catch(e){fail(res,e)}});
 router.get('/tickets',auth,async(req,res)=>{try{const sqlite=sqliteBackend(client);let rows;if(sqlite){const prefix=`guild:${req.guild.id}:ticket:`;rows=sqlite.botTickets(req.guild.id,100).map(x=>({channel_id:x.key.slice(prefix.length),data:x.value,updated_at:x.updatedAt}));}else rows=(await pool(client).query(`SELECT channel_id,data,updated_at FROM ${tables.tickets} WHERE guild_id=$1 ORDER BY updated_at DESC LIMIT 100`,[req.guild.id])).rows;res.json({tickets:rows.map(x=>({channelId:x.channel_id,userId:x.data?.userId,status:x.data?.status,createdAt:x.data?.createdAt,closedAt:x.data?.closedAt??null,rating:x.data?.feedback?.rating??null,sentiment:['positive','neutral','negative','mixed','unknown'].includes(x.data?.aiSentiment?.sentiment)?x.data.aiSentiment.sentiment:null,updatedAt:x.updated_at,claimedBy:x.data?.claimedBy,priority:x.data?.priority||'none',ticketNumber:x.data?.ticketNumber??null,ticketType:x.data?.ticketType?.name||null,tags:Array.isArray(x.data?.tags)?x.data.tags:[],reason:x.data?.reason||''})),limit:100});}catch(e){fail(res,e)}});
 async function ticket(client,guild,id){if(!idRe.test(id))throw bad('ID tiket tidak valid.');const sqlite=sqliteBackend(client);if(sqlite){const data=sqlite.botGet(`guild:${guild.id}:ticket:${id}`);if(data===null)throw bad('Tiket tidak ditemukan.',404);return data;}const r=await pool(client).query(`SELECT data FROM ${tables.tickets} WHERE guild_id=$1 AND channel_id=$2`,[guild.id,id]);if(!r.rows[0])throw bad('Tiket tidak ditemukan.',404);return r.rows[0].data;}
 router.get('/tickets/:id',auth,async(req,res)=>{try{const data=await ticket(client,req.guild,req.params.id);res.json({ticket:data});}catch(e){fail(res,e)}});
 router.get('/tickets/:id/response-sla',auth,async(req,res)=>{try{
  const data=await ticket(client,req.guild,req.params.id),channel=req.guild.channels.cache.get(req.params.id);if(!channel)throw bad('Channel tiket tidak tersedia.',404);const cfg=await getGuildConfig(client,req.guild.id);const result=await inspectTicketResponses(req.guild,channel,data,cfg);const settings=readResponseSlaConfig(cfg);const pending=result.pending?{at:new Date(result.pending.at).toISOString(),overdue:settings.enabled&&data.status==='open'&&Date.now()-Math.max(result.pending.at,Date.parse(settings.enabledAt))>=settings.minutes*60000}:null;res.json({pending,lastResponse:result.lastResponse,truncated:result.truncated,settings:{enabled:settings.enabled,minutes:settings.minutes}});
 }catch(e){fail(res,e.status?e:Object.assign(new Error('Respons tidak dapat diperiksa. Pastikan bot dapat membaca riwayat dan status anggota tersedia.'),{status:503}))}});
 router.get('/tickets/:id/transcript',auth,async(req,res)=>{try{
  await ticket(client,req.guild,req.params.id);const c=req.guild.channels.cache.get(req.params.id);if(!c?.messages)throw bad('Channel tiket tidak tersedia; transcript tersimpan tidak tersedia.',404);
  if(!c.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory]))throw bad('Bot tidak memiliki izin membaca channel tiket.',403);
  const m=await c.messages.fetch({limit:100});
  const messages=[...m.values()].reverse().map(x=>({
   id:x.id,author:x.author?.tag||'Unknown',at:x.createdAt,content:String(x.content||'').slice(0,4000),
   attachments:[...(x.attachments?.values?.()||[])].slice(0,10).map(a=>({name:String(a.name||'Tanpa nama').slice(0,300),size:Number.isSafeInteger(a.size)?a.size:null})),
   embeds:(x.embeds||[]).slice(0,10).map(e=>({title:String(e.title||'').slice(0,256),description:String(e.description||'').slice(0,2000),fields:(e.fields||[]).slice(0,25).map(f=>({name:String(f.name||'').slice(0,256),value:String(f.value||'').slice(0,1024)}))})),
  }));res.json({messages,limit:100});
 }catch(e){fail(res,e)}});
 router.post('/tickets/:id/quick-reply',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='confirmed,replyId,revision'||b.confirmed!==true||typeof b.replyId!=='string'||!/^[1-5]$/.test(b.replyId)||typeof b.revision!=='string'||!/^[a-f0-9]{16}$/.test(b.revision))throw bad('Jawaban atau konfirmasi tidak valid.');
  const data=await ticket(client,req.guild,req.params.id);if(data.status!=='open')throw bad('Jawaban cepat hanya untuk tiket terbuka.',409);
  const replies=quickRepliesFromConfig(await getGuildConfig(client,req.guild.id));if(quickRepliesRevision(replies)!==b.revision)throw bad('Jawaban cepat berubah. Muat ulang tiket.',409);const reply=replies.find(x=>x.id===b.replyId);if(!reply)throw bad('Jawaban cepat tidak tersedia.',404);
  const channel=req.guild.channels.cache.get(req.params.id);if(!channel||channel.type!==ChannelType.GuildText||!channel.send)throw bad('Channel tiket tidak tersedia.',404);
  if(!req.guild.members.me||!channel.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw bad('Bot tidak memiliki izin mengirim di tiket.',403);
  if(!idRe.test(req.member?.id||''))throw bad('Identitas pengirim tidak tersedia.',403);
  await channel.send({...v2Message([createV2Container({title:'Jawaban staff',description:reply.text,footer:{text:`Dikirim oleh ${req.member.id}`,always:true},color:'primary',raw:true})]),allowedMentions:{parse:[]}});res.json({ok:true});
 }catch(e){fail(res,e)}});
 router.patch('/tickets/:id/tags',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='confirmed,expectedTags,tags'||b.confirmed!==true)throw bad('Tag atau konfirmasi tidak valid.');
  try{validateTicketTags(b.tags);validateTicketTags(b.expectedTags)}catch(e){throw bad(e.message)}
  await ticket(client,req.guild,req.params.id);
  const tags=await updateTicketTags(req.guild.id,req.params.id,req.member.id,b.tags,b.expectedTags);res.json({ok:true,tags});
 }catch(e){if(e.code==='TICKET_STALE')return res.status(409).json({error:'Tag atau tiket berubah. Muat ulang dan coba lagi.',code:e.code});if(e.code==='TICKET_TAG_NOT_FOUND')return res.status(404).json({error:'Tiket tidak ditemukan.'});if(e.code==='TICKET_TAG_INVALID_STORED')return res.status(409).json({error:'Tag tersimpan tidak valid; perlu diperiksa.'});fail(res,e)}});
 // Category changes keep the existing channel overwrites, never inherit the target category.
 router.get('/tickets/:id/category',auth,async(req,res)=>{try{
  const data=await ticket(client,req.guild,req.params.id),channel=req.guild.channels.cache.get(req.params.id);
  if(!channel||channel.type!==ChannelType.GuildText)throw bad('Channel tiket tidak tersedia.',404);
  if(data.status!=='open')throw bad('Hanya tiket terbuka yang dapat dipindahkan.',409);
  if(!req.member?.permissions?.has(PermissionFlagsBits.ManageChannels))throw bad('Izin Manage Channels diperlukan.',403);
  const categories=[...req.guild.channels.cache.values()].filter(c=>c.type===ChannelType.GuildCategory&&idRe.test(c.id||'')&&c.permissionsFor?.(req.member)?.has(PermissionFlagsBits.ViewChannel)&&c.permissionsFor?.(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels])).map(c=>({id:c.id,name:String(c.name||'Kategori').slice(0,100)})).slice(0,100);
  res.json({parentId:channel.parentId??null,categories});
 }catch(e){fail(res,e)}});
 router.post('/tickets/:id/category',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='categoryId,confirmed,expectedParentId'||b.confirmed!==true||!idRe.test(b.categoryId||'')||!(b.expectedParentId===null||idRe.test(b.expectedParentId||'')))throw bad('Kategori atau konfirmasi tidak valid.');
  if(!req.member?.permissions?.has(PermissionFlagsBits.ManageChannels))throw bad('Izin Manage Channels diperlukan.',403);
  await Mutex.runExclusive(`ticket-category:${req.guild.id}:${req.params.id}`,async()=>{
   const data=await ticket(client,req.guild,req.params.id);if(data.status!=='open')throw bad('Hanya tiket terbuka yang dapat dipindahkan.',409);
   // Fetch fresh Discord state where possible. Discord offers no atomic compare-and-move.
   const channel=await req.guild.channels.fetch(req.params.id,{force:true}).catch(()=>null),category=await req.guild.channels.fetch(b.categoryId,{force:true}).catch(()=>null);
   if(!channel||channel.type!==ChannelType.GuildText||typeof channel.setParent!=='function'||!category||category.type!==ChannelType.GuildCategory)throw bad('Channel atau kategori tidak tersedia.',404);
   if((channel.parentId??null)!==b.expectedParentId)throw bad('Kategori tiket berubah. Muat ulang.',409);
   if(channel.parentId===category.id)throw bad('Tiket sudah berada di kategori itu.',409);
   if(!channel.permissionsFor(req.member)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels])||!category.permissionsFor(req.member)?.has(PermissionFlagsBits.ViewChannel)||!req.guild.members.me||!channel.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels])||!category.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]))throw bad('Akses channel atau kategori tidak mencukupi.',403);
   if((await ticket(client,req.guild,req.params.id)).status!=='open')throw bad('Tiket berubah. Muat ulang.',409);
   await channel.setParent(category.id,{lockPermissions:false,reason:`Ticket category moved by ${req.member.id}`});
  });res.json({ok:true});
 }catch(e){fail(res,e)}});
 router.post('/tickets/:id/transfer',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||b.confirmed!==true||!idRe.test(b.targetId||'')||!idRe.test(b.expectedClaimer||'')||Object.keys(b).some(k=>!['targetId','expectedClaimer','confirmed'].includes(k)))throw bad('Staff, penanggung jawab, atau konfirmasi tidak valid.');
  await ticket(client,req.guild,req.params.id);const channel=req.guild.channels.cache.get(req.params.id);if(!channel)throw bad('Channel tiket tidak tersedia.',404);
  const result=await transferTicket(channel,req.member.user,b.targetId,b.expectedClaimer);res.json({ok:true,displayUpdated:result.displayUpdated});
 }catch(e){const refused=TICKET_REFUSALS[e?.context?.ticketCode];if(refused)return res.status(409).json({error:refused,code:e.context.ticketCode});fail(res,e)}});
 router.post('/tickets/:id/action',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||b.confirmed!==true||!['close','reopen','claim'].includes(b.action)||Object.keys(b).some(k=>!['action','confirmed'].includes(k)))throw bad('Tindakan atau konfirmasi tidak valid.');
  const data=await ticket(client,req.guild,req.params.id),channel=req.guild.channels.cache.get(req.params.id);if(!channel)throw bad('Channel tiket tidak tersedia.',404);
  if(b.action==='close' && data.status!=='open')throw bad('Tiket tidak terbuka.');if(b.action==='reopen' && data.status!=='closed')throw bad('Tiket tidak tertutup.');if(b.action==='claim'&&data.status!=='open')throw bad('Tiket tidak terbuka.');
  if(b.action==='close')await closeTicket(channel,req.member.user,'Ditutup melalui dashboard');else if(b.action==='reopen')await reopenTicket(channel,req.member.user);else await claimTicket(channel,req.member.user);res.json({ok:true});
 }catch(e){
  // The ticket service refused before changing anything: say why instead of a generic failure.
  const refused=TICKET_REFUSALS[e?.context?.ticketCode];
  if(refused)return res.status(409).json({error:refused,code:e.context.ticketCode});
  fail(res,e);
 }});
 router.get('/public/leaderboard',async(req,res)=>{try{
  if(!client.isReady?.()||!client.guilds.cache.has(client.homeGuildId))throw bad('Server tidak tersedia.',503);
  const sqlite=sqliteBackend(client);let leaderboard;
  if(sqlite){if(sqlite.botGet(`guild:${client.homeGuildId}:config`)?.publicLeaderboard!==true)throw bad('Leaderboard publik tidak diaktifkan.',404);leaderboard=sqliteLeaderboard(sqlite,client.homeGuildId);}
  else{const db=pool(client),config=await db.query(`SELECT config FROM ${tables.guilds} WHERE id=$1`,[client.homeGuildId]);if(config.rows[0]?.config?.publicLeaderboard!==true)throw bad('Leaderboard publik tidak diaktifkan.',404);const rows=await db.query(`SELECT user_id,level,total_xp FROM ${tables.user_levels} WHERE guild_id=$1 AND total_xp>0 ORDER BY total_xp DESC LIMIT 50`,[client.homeGuildId]);leaderboard=rows.rows.map(x=>({userId:x.user_id,level:x.level,totalXp:Number(x.total_xp)}));}
  res.json({guild:client.guilds.cache.get(client.homeGuildId).name,leaderboard});
 }catch(e){fail(res,e)}});
 router.get('/leaderboard',auth,async(req,res)=>{try{const sqlite=sqliteBackend(client);if(sqlite)return res.json({leaderboard:sqliteLeaderboard(sqlite,req.guild.id)});const r=await pool(client).query(`SELECT user_id,level,total_xp FROM ${tables.user_levels} WHERE guild_id=$1 AND total_xp>0 ORDER BY total_xp DESC LIMIT 50`,[req.guild.id]);res.json({leaderboard:r.rows.map(x=>({userId:x.user_id,level:x.level,totalXp:Number(x.total_xp)}))});}catch(e){fail(res,e)}});
 router.get('/members/:id',auth,async(req,res)=>{try{
  if(!idRe.test(req.params.id))throw bad('ID anggota tidak valid.');const member=await req.guild.members.fetch({user:req.params.id,force:true}).catch(()=>null);if(!member)throw bad('Anggota tidak ditemukan.',404);
  const sqlite=sqliteBackend(client);if(sqlite){const lvl=readSQLiteBotValue({botGet:sqlite.botGet,get:sqlite.get},`guild:${req.guild.id}:leveling:users:${member.id}`);return res.json({member:{id:member.id,name:member.user.tag},level:lvl?{level:lvl.level??0,xp:Number(lvl.xp??0),totalXp:Number(lvl.totalXp??0)}:null});}
  const db=pool(client);const lvl=await db.query(`SELECT xp,level,total_xp FROM ${tables.user_levels} WHERE guild_id=$1 AND user_id=$2`,[req.guild.id,member.id]);
  res.json({member:{id:member.id,name:member.user.tag},level:lvl.rows[0]?{level:lvl.rows[0].level,xp:Number(lvl.rows[0].xp),totalXp:Number(lvl.rows[0].total_xp)}:null});
 }catch(e){fail(res,e)}});
 router.post('/members/:id',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!idRe.test(req.params.id)||!b||b.confirmed!==true||b.type!=='level'||!Number.isSafeInteger(b.value)||b.value<0||b.value>1000||!Number.isSafeInteger(b.expected)||b.expected<0||Object.keys(b).some(k=>!['type','value','expected','confirmed'].includes(k)))throw bad('Data atau konfirmasi tidak valid.');
  const member=await req.guild.members.fetch({user:req.params.id,force:true}).catch(()=>null);if(!member)throw bad('Anggota tidak ditemukan.',404);
  const sqlite=sqliteBackend(client);if(sqlite){if(client.homeGuildId&&client.homeGuildId!==req.guild.id)throw bad('Server tidak valid.',403);sqlite.transaction(tx=>{
   mutateLevelInTransaction(tx,req.guild.id,member.id,(data,exists)=>{if(!exists)throw bad('Data leveling belum tersedia.',404);if(data.level!==b.expected)throw bad('Level berubah; muat ulang sebelum menyimpan.',409);data.level=b.value;data.xp=0;data.totalXp=calculateTotalXp(b.value,0);return {result:true}});
  });console.info(`[dashboard] member update guild=${req.guild.id} moderator=${req.member.id} member=${member.id} type=${b.type}`);
   return res.json({ok:true,rewardRoles:await rewardRolesAfterLevel(client,req.guild,member,b.value)});}
  // A level write takes the lock shared with XP awards and the level commands,
  // so a message that arrives at the same moment cannot overwrite it.
  const db=pool(client);await Mutex.runExclusive(`dashboard-member:${req.guild.id}:${member.id}`,()=>Mutex.runExclusive(getLevelLockKey(req.guild.id,member.id),async()=>{
   const c=await db.connect();try{await c.query('BEGIN');
    const r=await c.query(`SELECT level FROM ${tables.user_levels} WHERE guild_id=$1 AND user_id=$2 FOR UPDATE`,[req.guild.id,member.id]);if(!r.rows[0])throw bad('Data leveling belum tersedia.',404);if(Number(r.rows[0].level)!==b.expected)throw bad('Level berubah; muat ulang sebelum menyimpan.',409);
    await c.query(`UPDATE ${tables.user_levels} SET level=$3,xp=0,total_xp=$4,updated_at=CURRENT_TIMESTAMP WHERE guild_id=$1 AND user_id=$2`,[req.guild.id,member.id,b.value,calculateTotalXp(b.value,0)]);
    await c.query('COMMIT');console.info(`[dashboard] member update guild=${req.guild.id} moderator=${req.member.id} member=${member.id} type=${b.type}`);
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}
  }));
  res.json({ok:true,rewardRoles:await rewardRolesAfterLevel(client,req.guild,member,b.value)});
 }catch(e){fail(res,e)}});
 router.get('/logs',auth,async(req,res)=>{try{
  res.set('Cache-Control','no-store');
  if(Object.keys(req.query).some(k=>!['before','channel'].includes(k)) || (req.query.before!==undefined && (typeof req.query.before!=='string'||!idRe.test(req.query.before))) || (req.query.channel!==undefined && (typeof req.query.channel!=='string'||!idRe.test(req.query.channel))) || Boolean(req.query.before)!==Boolean(req.query.channel))throw bad('Cursor riwayat tidak valid.');
  const sqlite=sqliteBackend(client);const config=sqlite?sqlite.botGet(`guild:${req.guild.id}:config`):(await pool(client).query(`SELECT config FROM ${tables.guilds} WHERE id=$1`,[req.guild.id])).rows[0]?.config;const id=config?.logging?.channels?.audit;
  if(!id)throw bad('Channel audit logging belum dikonfigurasi.',404);if(req.query.channel && req.query.channel!==id)throw bad('Channel audit berubah. Muat ulang riwayat.',409);const channel=req.guild.channels.cache.get(id);if(!channel?.messages||!channel.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory]))throw bad('Bot tidak dapat membaca channel audit.',403);
  const m=await channel.messages.fetch({limit:100,...(req.query.before?{before:req.query.before}:{})});const all=[...m.values()],bot=all.filter(x=>x.author?.id===client.user.id),selected=bot.slice(0,50);
  const cursor=bot.length>50 ? selected.at(-1)?.id : all.length===100 ? all.at(-1)?.id : null;
  res.json({logs:selected.map(summarizeAuditMessage),nextBefore:cursor&&idRe.test(cursor)?cursor:null,channelId:id});
 }catch(e){fail(res,e)}});
 router.get('/music',auth,(req,res)=>{const player=getPlayer(client,req.guild.id);const channels=[...req.guild.channels.cache.values()];res.json({voiceChannels:channels.filter(c=>c.type===ChannelType.GuildVoice).map(c=>({id:c.id,name:c.name})),textChannels:channels.filter(c=>c.type===ChannelType.GuildText).map(c=>({id:c.id,name:c.name})),available:!!client.riffy?.nodeMap && [...client.riffy.nodeMap.values()].some(n=>n.connected),active:!!player,paused:!!player?.paused,voiceChannel:player?.voiceChannel||null,current:track(player?.current),queue:player?.queue?[...player.queue].slice(0,50).map(track):[],volume:player?getGuildMusicData(req.guild.id).volume:null,loop:getGuildMusicData(req.guild.id).loop,twentyFourSeven:getGuildMusicData(req.guild.id).twentyFourSeven});});
 router.post('/music/search',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||Object.keys(b).length!==1)throw bad('Pencarian tidak valid.');const query=safeMusicQuery(b.query);
  if(!client.riffy?.nodeMap||![...client.riffy.nodeMap.values()].some(x=>x.connected))throw bad('Lavalink tidak tersedia.',503);
  const data=await client.riffy.resolve({query,requester:req.member.user});res.json({tracks:(data.tracks||[]).slice(0,10).map(track)});
 }catch(e){fail(res,e)}});
 router.post('/music',auth,csrf,async(req,res)=>{try{
  const b=req.body;if(!b||!['pause','resume','skip','stop','volume','play','loop','always'].includes(b.action)||b.confirmed!==true||Object.keys(b).some(k=>!['action','confirmed','volume','query','voiceChannelId','textChannelId','mode','enabled'].includes(k)))throw bad('Tindakan atau konfirmasi tidak valid.');
  const p=getPlayer(client,req.guild.id),g=req.guild.id;if(!p && b.action!=='play')throw bad('Belum ada player aktif.',409);
  if(b.action==='pause'){if(!await applyPause(client,g))throw bad('Tidak ada lagu yang dapat dijeda.');}
  if(b.action==='resume'){if(!await applyResume(client,g))throw bad('Tidak ada lagu yang dapat dilanjutkan.');}
  if(b.action==='skip'){if(!p.current)throw bad('Tidak ada lagu aktif.');if(p.loop==='track')p.setLoop('none');p.stop();}
  if(b.action==='stop')await destroyPlayerSession(client,g,p,getGuildMusicData(g));
  if(b.action==='volume'){if(!Number.isInteger(b.volume)||b.volume<0||b.volume>100)throw bad('Volume harus 0–100.');p.setVolume(b.volume);getGuildMusicData(g).volume=b.volume;}
  if(b.action==='loop'){if(!['none','track','queue'].includes(b.mode))throw bad('Mode loop tidak valid.');p.setLoop(b.mode);getGuildMusicData(g).loop=b.mode;}
  if(b.action==='always'){if(typeof b.enabled!=='boolean')throw bad('Nilai 24/7 tidak valid.');getGuildMusicData(g).twentyFourSeven=b.enabled;}
  if(b.action==='play'){
   const query=safeMusicQuery(b.query);
   const voice=req.guild.channels.cache.get(p?.voiceChannel||b.voiceChannelId),text=req.guild.channels.cache.get(p?.textChannel||b.textChannelId);
   if(!voice || voice.type!==ChannelType.GuildVoice || !text || text.type!==ChannelType.GuildText)throw bad('Pilih channel voice dan teks server yang valid.');
   if(!voice.permissionsFor(req.guild.members.me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]))throw bad('Bot tidak memiliki izin voice yang diperlukan.',403);
   await playQuery(client,{guild:req.guild,member:{voice:{channel:voice}},channel:{id:text.id},user:req.member.user},query);
  }
  res.json({ok:true});
 }catch(e){fail(res,e)}});
 return router;
}
