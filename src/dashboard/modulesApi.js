import express from 'express';
import { createHash } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { pgConfig } from '../config/database/postgres.js';
import { sqliteBackend } from '../services/storage/sqlite.js';
import { unwrapReplitData } from '../utils/database/guildConfigStorage.js';
import { normalizeGuildConfig } from '../utils/schemas.js';
import { GUILD_CONFIG_DEFAULTS } from '../config/guild/guildConfigDefaults.js';
import { EVENT_TYPES, OPT_IN_LOG_EVENTS, getRecentLogStatus } from '../services/loggingService.js';
import { messageHasPanelMarker } from '../utils/panelStatus.js';
import { createV2Container, v2Message } from '../utils/componentsV2.js';
import { Mutex } from '../utils/mutex.js';
import {validateQuickReplies,quickRepliesFromConfig,quickRepliesRevision} from '../services/tickets/quickReplies.js';
import {readAutoCloseConfig,autoCloseRevision,newAutoCloseConfig} from '../services/tickets/autoCloseConfig.js';
import {readResponseSlaConfig,responseSlaRevision,newResponseSlaConfig} from '../services/tickets/responseSla.js';
import {validateTicketTypes, ticketTypesFromConfig, ticketTypesRevision} from '../utils/ticket/ticketTypes.js';
import { assertOnboardingCompatible, assertOnboardingShape } from '../services/config/onboardingConflict.js';
import { checkRewardRole, listRewardEntries } from '../services/leveling/rewardRoles.js';
import { canonicalJson } from '../services/leveling/leveling.js';
import { getRewardSyncStatus, startRewardSync } from '../services/leveling/levelRoleSyncService.js';

const tables=pgConfig.tables;
const events=[...new Set(Object.values(EVENT_TYPES))];
const groups=[...new Set(events.map(x=>x.split('.')[0]))];
export const TICKET_SETTINGS_FIELDS=Object.freeze(['channelId','staffRoleId','categoryId','closedCategoryId','message','buttonText','logsChannelId','transcriptChannelId','maxTicketsPerUser','dmOnClose']);
export const TICKET_SETTINGS_OPTIONAL_FIELDS=Object.freeze(['ticketTypes','ticketTypesRevision','reminderMinutes','reminderRevision']);
export const LEVEL_DEFAULTS={enabled:true,xpPerMessage:{min:15,max:25},xpCooldown:20,levelUpMessage:'{user} has leveled up to level {level}!',levelUpChannel:null,ignoredChannels:[],ignoredRoles:[],blacklistedUsers:[],roleRewards:{},announceLevelUp:true,xpMultiplier:1};
const bad=(message,status=400)=>Object.assign(new Error(message),{status});

// Why a reward role cannot be given, in the words shown on the dashboard.
const REWARD_ROLE_REASONS = {
    ROLE_MISSING: 'Role sudah tidak ada di server.',
    ROLE_EVERYONE: '@everyone tidak dapat dijadikan hadiah.',
    ROLE_MANAGED: 'Role dikelola integrasi dan tidak dapat diberikan bot.',
    ROLE_DANGEROUS: 'Role memiliki izin pengelolaan atau moderasi server.',
    BOT_MEMBER_UNKNOWN: 'Data bot di server belum tersedia.',
    BOT_NO_MANAGE_ROLES: 'Bot tidak memiliki izin Manage Roles.',
    ROLE_TOO_HIGH: 'Posisi role tidak di bawah role tertinggi bot.',
};
const REWARD_SYNC_PAUSE_MS = 60_000;

// Fingerprint of the stored leveling settings. The page sends it back when it
// saves; if the settings changed in between (for example through
// /level dashboard), the save is refused instead of overwriting that change.
function levelingRevision(cfg) {
    const state = { leveling: cfg.leveling ?? null, publicLeaderboard: cfg.publicLeaderboard === true };
    return createHash('sha256').update(canonicalJson(state)).digest('hex').slice(0, 24);
}
const ticketReminderRevision = cfg => createHash('sha256').update(JSON.stringify([cfg.ticketReminderMinutes??0,cfg.ticketReminderEnabledAt??null])).digest('hex').slice(0,16);
const LEVELING_STALE_TEXT = 'Pengaturan leveling sudah diubah di tempat lain, misalnya lewat /level dashboard. '
    + 'Tidak ada yang disimpan. Muat ulang halaman lalu ulangi perubahan.';

// One line per configured reward: can the bot give this role right now?
// Reads the role cache only; it does not call Discord.
function rewardRoleStatus(guild, leveling) {
    return listRewardEntries(leveling).map(({ level, roleId: id }) => {
        const role = guild.roles.cache.get(id) ?? null;
        const verdict = checkRewardRole(guild, role);
        return {
            level,
            roleId: id,
            name: role?.name ?? null,
            ok: verdict.ok,
            code: verdict.ok ? null : verdict.code,
            reason: verdict.ok ? null : REWARD_ROLE_REASONS[verdict.code] ?? 'Role tidak dapat diberikan.',
        };
    });
}

function rewardRoleOrThrow(guild, level, id) {
    if (typeof id !== 'string') throw bad('Role reward tidak valid.');
    const verdict = checkRewardRole(guild, guild.roles.cache.get(id) ?? null);
    if (!verdict.ok) {
        const reason = REWARD_ROLE_REASONS[verdict.code] ?? 'Role tidak dapat diberikan.';
        throw bad(`Role hadiah level ${level} tidak dapat dipakai: ${reason}`);
    }
    return id;
}

function pool(client){const db=client.db;if(!db || db.getStatus?.().isDegraded || !db.isAvailable?.() || !db.db?.isAvailable?.() || !db.db.pool) throw bad('Database persisten tidak tersedia.',503);return db.db.pool;}
async function read(client,id){const sqlite=sqliteBackend(client);if(sqlite)return normalizeGuildConfig(unwrapReplitData(sqlite.botGet(`guild:${id}:config`)||{}),GUILD_CONFIG_DEFAULTS);const rows=await pool(client).query(`SELECT config FROM ${tables.guilds} WHERE id=$1`,[id]);return normalizeGuildConfig(unwrapReplitData(rows.rows[0]?.config || {}),GUILD_CONFIG_DEFAULTS);}
async function transaction(client,id,fn,includeWelcome=false) {
 const sqlite=sqliteBackend(client);if(sqlite)return sqlite.transaction(tx=>{
  const key=`guild:${id}:config`,raw=tx.botGet(key)||{};if(raw.ok!==undefined&&raw.value!==undefined)throw bad('Format konfigurasi lama perlu dimigrasi.',409);
  const config=normalizeGuildConfig(raw,GUILD_CONFIG_DEFAULTS),welcome=includeWelcome?unwrapReplitData(tx.botGet(`guild:${id}:welcome`)||{}):null;
  const result=fn(config,welcome);if(result&&typeof result.then==='function')throw bad('Mutasi konfigurasi harus sinkron.',503);tx.botSet(key,config);return result;
 });
 const conn=await pool(client).connect();try{
  await conn.query('BEGIN');await conn.query(`INSERT INTO ${tables.guilds} (id,created_at) VALUES ($1,CURRENT_TIMESTAMP) ON CONFLICT (id) DO NOTHING`,[id]);
  const rows=await conn.query(`SELECT config FROM ${tables.guilds} WHERE id=$1 FOR UPDATE`,[id]);const raw=rows.rows[0]?.config;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('Konfigurasi server perlu diperiksa.',409);
  if(raw.ok!==undefined && raw.value!==undefined)throw bad('Format konfigurasi lama perlu dimigrasi.',409);
  const welcomeRows=await conn.query(`SELECT config FROM ${tables.welcome_configs} WHERE guild_id=$1 FOR UPDATE`,[id]);
  const storedWelcome=welcomeRows.rows.length?welcomeRows.rows[0].config:{};
  assertOnboardingShape(raw,storedWelcome);
  const config=normalizeGuildConfig(raw,GUILD_CONFIG_DEFAULTS);const welcome=includeWelcome?storedWelcome:null;
  const result=fn(config,welcome);if(result&&typeof result.then==='function')throw bad('Mutasi konfigurasi harus sinkron.',503);
  assertOnboardingCompatible(config,storedWelcome);
  await conn.query(`UPDATE ${tables.guilds} SET config=$2::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[id,JSON.stringify(config)]);await conn.query('COMMIT');return result;
 }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
}
function listChannels(guild,type=ChannelType.GuildText){return [...guild.channels.cache.values()].filter(c=>c.type===type).map(({id,name})=>({id,name}));}
function listStaffRoles(guild){return [...guild.roles.cache.values()].filter(r=>r.id!==guild.id && !r.managed).map(({id,name})=>({id,name}));}
function listRoles(guild){const me=guild.members.me;return [...guild.roles.cache.values()].filter(r=>r.id!==guild.id && !r.managed && me?.permissions.has(PermissionFlagsBits.ManageRoles) && me.roles.highest.comparePositionTo(r)>0).map(({id,name})=>({id,name}));}
function channelId(guild,id,type=ChannelType.GuildText){if(id===null)return null;if(typeof id!=='string'||guild.channels.cache.get(id)?.type!==type)throw bad('Channel tidak valid untuk server ini.');return id;}
function exact(b,keys){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length!==keys.length||Object.keys(b).some(x=>!keys.includes(x)))throw bad('Data tidak valid.');}
function str(v,min,max){if(typeof v!=='string'||v.length>max||v.trim().length<min)throw bad('Teks tidak valid atau terlalu panjang.');return v;}
function bool(v){if(typeof v!=='boolean')throw bad('Nilai boolean tidak valid.');return v;}
function number(v,min,max){if(!Number.isInteger(v)||v<min||v>max)throw bad('Angka di luar rentang.');return v;}
function answer(res,error){if(!error.status)console.error('[dashboard modules]',error.message);res.status(error.status||503).json({error:error.status?error.message:'Gagal mengakses database atau Discord.'});}
const channelsRoles=guild=>({channels:listChannels(guild),categories:listChannels(guild,ChannelType.GuildCategory),roles:listRoles(guild)});

export function createModulesApi(client,{auth,csrf}) {
 const router=express.Router();router.use(express.json({limit:'32kb'}));
 router.get('/ticket-response-sla',auth,async(req,res)=>{try{const settings=readResponseSlaConfig(await read(client,req.guild.id));res.json({settings,revision:responseSlaRevision(settings)})}catch(e){answer(res,e)}});
 router.patch('/ticket-response-sla',auth,csrf,async(req,res)=>{try{const b=req.body;exact(b,['enabled','minutes','revision','confirmed']);bool(b.enabled);number(b.minutes,10,10080);if(b.confirmed!==true||typeof b.revision!=='string'||!/^[a-f0-9]{16}$/.test(b.revision))throw bad('Konfirmasi atau versi SLA tidak valid.');const settings=await transaction(client,req.guild.id,cfg=>{const current=readResponseSlaConfig(cfg);if(responseSlaRevision(current)!==b.revision)throw bad('Pengaturan SLA berubah. Muat ulang.',409);if(current.enabled===b.enabled&&current.minutes===b.minutes)return current;cfg.ticketResponseSla=newResponseSlaConfig(b.enabled,b.minutes);return cfg.ticketResponseSla});res.json({ok:true,settings,revision:responseSlaRevision(settings)})}catch(e){answer(res,e)}});
 router.get('/ticket-auto-close',auth,async(req,res)=>{try{const settings=readAutoCloseConfig(await read(client,req.guild.id));res.json({settings,revision:autoCloseRevision(settings)})}catch(e){answer(res,e)}});
 router.patch('/ticket-auto-close',auth,csrf,async(req,res)=>{try{
  const b=req.body;exact(b,['enabled','idleMinutes','warningMinutes','revision','confirmed']);bool(b.enabled);number(b.idleMinutes,60,43200);number(b.warningMinutes,60,10080);if(b.confirmed!==true||typeof b.revision!=='string'||!/^[a-f0-9]{16}$/.test(b.revision))throw bad('Konfirmasi atau versi auto-close tidak valid.');
  const settings=await transaction(client,req.guild.id,cfg=>{const current=readAutoCloseConfig(cfg);if(autoCloseRevision(current)!==b.revision)throw bad('Pengaturan auto-close berubah. Muat ulang.',409);if(current.enabled===b.enabled&&current.idleMinutes===b.idleMinutes&&current.warningMinutes===b.warningMinutes)return current;cfg.ticketAutoClose=newAutoCloseConfig(b.enabled,b.idleMinutes,b.warningMinutes);return cfg.ticketAutoClose});res.json({ok:true,settings,revision:autoCloseRevision(settings)});
 }catch(e){answer(res,e)}});
 router.get('/ticket-quick-replies',auth,async(req,res)=>{try{const replies=quickRepliesFromConfig(await read(client,req.guild.id));res.json({replies,revision:quickRepliesRevision(replies)});}catch(e){answer(res,e)}});
 router.patch('/ticket-quick-replies',auth,csrf,async(req,res)=>{try{
  const b=req.body;exact(b,['replies','revision','confirmed']);if(b.confirmed!==true||typeof b.revision!=='string'||!/^[a-f0-9]{16}$/.test(b.revision))throw bad('Konfirmasi atau versi jawaban cepat tidak valid.');let replies;try{replies=validateQuickReplies(b.replies)}catch(e){throw bad(e.message)}
  const result=await transaction(client,req.guild.id,cfg=>{if(quickRepliesRevision(quickRepliesFromConfig(cfg))!==b.revision)throw bad('Jawaban cepat sudah berubah. Muat ulang sebelum menyimpan.',409);cfg.ticketQuickReplies=replies;return {replies,revision:quickRepliesRevision(replies)}});res.json({ok:true,...result});
 }catch(e){answer(res,e)}});
 // A diagnostic send, not a synthetic moderation event; it uses the saved audit destination.
 const loggingTests=new Map();
 router.post('/logging/test',auth,csrf,async(req,res)=>{try{
  exact(req.body,['confirmed']);if(req.body.confirmed!==true)throw bad('Konfirmasi diperlukan.');
  const cfg=await read(client,req.guild.id);if(!cfg.logging?.enabled)throw bad('Aktifkan dan simpan Logging terlebih dahulu.',409);
  const id=cfg.logging?.channels?.audit;if(!id)throw bad('Pilih dan simpan channel audit terlebih dahulu.',409);
  const channel=req.guild.channels.cache.get(id);if(!channel||channel.type!==ChannelType.GuildText)throw bad('Channel audit tersimpan tidak tersedia.',409);
  const perms=channel.permissionsFor(req.guild.members.me);if(!perms?.has(['ViewChannel','SendMessages','EmbedLinks']))throw bad('Bot perlu izin View Channel, Send Messages, dan Embed Links di channel audit.',403);
  const now=Date.now();for(const [key,at] of loggingTests)if(now-at>=10000)loggingTests.delete(key);
  if(loggingTests.has(req.guild.id))throw bad('Tunggu 10 detik sebelum mengirim tes lagi.',429);loggingTests.set(req.guild.id,now);
  try{await channel.send({...v2Message([createV2Container({title:'Tes Logging',description:'Channel audit menerima pesan tes dari dashboard.'})]),allowedMentions:{parse:[]}})}catch{throw bad('Pengiriman tes gagal atau hasilnya tidak diketahui. Periksa channel sebelum mencoba lagi.',502)}
  res.json({ok:true});
 }catch(e){answer(res,e)}});
 router.get('/settings/:kind',auth,async(req,res)=>{try{
  if(!['logging','leveling','ticket'].includes(req.params.kind))throw bad('Modul tidak tersedia.',404);
  const cfg=await read(client,req.guild.id);const kind=req.params.kind;
  let data;
  if(kind==='logging')data=cfg.logging;
  if(kind==='leveling')data={...LEVEL_DEFAULTS,...(cfg.leveling||{}),publicLeaderboard:cfg.publicLeaderboard===true};
  if(kind==='ticket')data={channelId:cfg.ticketPanelChannelId||null,messageId:cfg.ticketPanelMessageId||null,staffRoleId:cfg.ticketStaffRoleId||null,categoryId:cfg.ticketCategoryId||null,closedCategoryId:cfg.ticketClosedCategoryId||null,message:cfg.ticketPanelMessage||'Click the button below to create a support ticket.',buttonText:cfg.ticketButtonLabel||'Create Ticket',logsChannelId:cfg.ticketLogsChannelId||null,transcriptChannelId:cfg.ticketTranscriptChannelId||null,maxTicketsPerUser:cfg.maxTicketsPerUser||3,dmOnClose:cfg.dmOnClose!==false,reminderMinutes:Number.isInteger(cfg.ticketReminderMinutes)?cfg.ticketReminderMinutes:0,reminderRevision:ticketReminderRevision(cfg),ticketTypes:ticketTypesFromConfig(cfg),ticketTypesRevision:ticketTypesRevision(ticketTypesFromConfig(cfg))};
  const levelingExtra=kind==='leveling'?{revision:levelingRevision(cfg),rewardRoles:rewardRoleStatus(req.guild,data),rewardSync:getRewardSyncStatus(req.guild.id)}:{};
  res.json({settings:data,...channelsRoles(req.guild),...(kind==='ticket'?{roles:listStaffRoles(req.guild)}:{}),...levelingExtra,...(kind==='logging'?{loggingStatus:getRecentLogStatus(req.guild.id)}:{}),events,groups,optInEvents:[...OPT_IN_LOG_EVENTS]});
 }catch(e){answer(res,e)}});
 router.patch('/settings/:kind',auth,csrf,async(req,res)=>{try{
  const b=req.body,g=req.guild,kind=req.params.kind;let updated;
  if(kind==='logging'){
   if(!b||typeof b!=='object'||Array.isArray(b)||['enabled','channels','enabledEvents'].some(k=>!(k in b))||Object.keys(b).some(k=>!['enabled','channels','enabledEvents','ignore'].includes(k)))throw bad('Data tidak valid.');bool(b.enabled);
   if('ignore' in b){exact(b.ignore,['users','channels']);for(const list of [b.ignore.users,b.ignore.channels])if(!Array.isArray(list)||list.length>100||new Set(list).size!==list.length||list.some(id=>typeof id!=='string'||!/^\d{17,20}$/.test(id)))throw bad('Daftar pengecualian harus berisi maksimal 100 ID Discord yang berbeda.');}exact(b.channels,['audit','applications','reports']);Object.values(b.channels).forEach(x=>channelId(g,x));
   if(!b.enabledEvents||typeof b.enabledEvents!=='object'||Array.isArray(b.enabledEvents)||Object.entries(b.enabledEvents).some(([k,v])=>!([...events,...groups.map(x=>x+'.*')].includes(k))||typeof v!=='boolean'))throw bad('Event logging tidak valid.');
   updated=await transaction(client,g.id,cfg=>{cfg.logging={...(cfg.logging||{}),enabled:b.enabled,channels:{...cfg.logging?.channels,...b.channels},enabledEvents:{...cfg.logging?.enabledEvents,...b.enabledEvents},...('ignore' in b?{ignore:b.ignore}:{})};return cfg.logging});
  } else if(kind==='leveling'){
   const required=['enabled','min','max','cooldown','channelId','announce','publicLeaderboard'];
   const optional=['levelUpMessage','ignoredChannels','ignoredRoles','roleRewards'];
   if (!b || typeof b!=='object' || Array.isArray(b) || required.some(k=>!(k in b)) || Object.keys(b).some(k=>!required.includes(k)&&!optional.includes(k)&&k!=='revision')) throw bad('Data tidak valid.');
   if ('revision' in b && (typeof b.revision!=='string' || !/^[0-9a-f]{24}$/.test(b.revision))) throw bad('Data tidak valid.');
   if ('levelUpMessage' in b) str(b.levelUpMessage,1,2000);
   if ('ignoredChannels' in b) { if(!Array.isArray(b.ignoredChannels)||b.ignoredChannels.length>100||new Set(b.ignoredChannels).size!==b.ignoredChannels.length)throw bad('Daftar channel tidak valid.'); b.ignoredChannels.forEach(id=>{if(id===null)throw bad('Channel tidak valid.');channelId(g,id)}); }
   if ('ignoredRoles' in b) { if(!Array.isArray(b.ignoredRoles)||b.ignoredRoles.length>100||new Set(b.ignoredRoles).size!==b.ignoredRoles.length||b.ignoredRoles.some(id=>typeof id!=='string'||!g.roles.cache.has(id)||id===g.id))throw bad('Daftar role tidak valid.'); }
   if ('roleRewards' in b) { if(!b.roleRewards||typeof b.roleRewards!=='object'||Array.isArray(b.roleRewards)||Object.keys(b.roleRewards).length>100)throw bad('Role reward tidak valid.'); for(const [level,id] of Object.entries(b.roleRewards)){if(!/^[1-9]\d{0,2}$/.test(level)||Number(level)>500||id===null)throw bad('Level reward harus 1–500.');rewardRoleOrThrow(g,level,id);} }
   bool(b.enabled);bool(b.announce);bool(b.publicLeaderboard);number(b.min,1,10000);number(b.max,1,10000);number(b.cooldown,1,3600);channelId(g,b.channelId);if(b.min>b.max)throw bad('XP minimum melebihi maksimum.');
   updated=await transaction(client,g.id,cfg=>{if('revision' in b&&levelingRevision(cfg)!==b.revision)throw bad(LEVELING_STALE_TEXT,409);cfg.publicLeaderboard=b.publicLeaderboard;cfg.leveling={...LEVEL_DEFAULTS,...(cfg.leveling||{}),...Object.fromEntries(optional.filter(k=>k in b).map(k=>[k,b[k]])),enabled:b.enabled,xpPerMessage:{min:b.min,max:b.max},xpRange:{min:b.min,max:b.max},xpCooldown:b.cooldown,levelUpChannel:b.channelId,announceLevelUp:b.announce};return cfg.leveling});
  } else if(kind==='ticket'){
   if(!b||typeof b!=='object'||Array.isArray(b)||TICKET_SETTINGS_FIELDS.some(k=>!(k in b))||Object.keys(b).some(k=>!TICKET_SETTINGS_FIELDS.includes(k)&&!TICKET_SETTINGS_OPTIONAL_FIELDS.includes(k)))throw bad('Data tidak valid.');let ticketTypes;if('ticketTypes' in b){if(typeof b.ticketTypesRevision!=='string'||!/^[a-f0-9]{16}$/.test(b.ticketTypesRevision))throw bad('Versi jenis tiket tidak valid.');try{ticketTypes=validateTicketTypes(b.ticketTypes);for(const type of ticketTypes)if(type.categoryId)channelId(g,type.categoryId,ChannelType.GuildCategory)}catch(e){throw bad(e.message)}}else if('ticketTypesRevision' in b)throw bad('Data tidak valid.');if('reminderMinutes' in b&&(!/^[a-f0-9]{16}$/.test(b.reminderRevision||'')))throw bad('Versi pengingat tidak valid.');if(!('reminderMinutes' in b)&&'reminderRevision' in b)throw bad('Data tidak valid.');if('reminderMinutes' in b&&(!Number.isInteger(b.reminderMinutes)||(b.reminderMinutes!==0&&(b.reminderMinutes<10||b.reminderMinutes>10080))))throw bad('Pengingat harus 0 (nonaktif) atau 10–10080 menit.');channelId(g,b.channelId);if(b.staffRoleId!==null && !listStaffRoles(g).some(r=>r.id===b.staffRoleId))throw bad('Role staf tidak tersedia.');channelId(g,b.categoryId,ChannelType.GuildCategory);channelId(g,b.closedCategoryId,ChannelType.GuildCategory);str(b.message,1,2000);str(b.buttonText,1,80);channelId(g,b.logsChannelId);channelId(g,b.transcriptChannelId);number(b.maxTicketsPerUser,1,50);bool(b.dmOnClose);
   updated=await transaction(client,g.id,cfg=>{if('reminderMinutes' in b&&ticketReminderRevision(cfg)!==b.reminderRevision)throw bad('Pengingat tiket sudah berubah. Muat ulang sebelum menyimpan.',409);if(ticketTypes&&ticketTypesRevision(ticketTypesFromConfig(cfg))!==b.ticketTypesRevision)throw bad('Jenis tiket sudah berubah. Muat ulang sebelum menyimpan.',409);if(cfg.ticketPanelMessageId && cfg.ticketPanelChannelId!==b.channelId)throw bad('Panel lama masih tercatat di channel lain.',409);Object.assign(cfg,{ticketPanelChannelId:b.channelId,ticketStaffRoleId:b.staffRoleId,ticketCategoryId:b.categoryId,ticketClosedCategoryId:b.closedCategoryId,ticketPanelMessage:b.message,ticketButtonLabel:b.buttonText,ticketLogsChannelId:b.logsChannelId,ticketTranscriptChannelId:b.transcriptChannelId,maxTicketsPerUser:b.maxTicketsPerUser,dmOnClose:b.dmOnClose});if(ticketTypes)cfg.ticketTypes=ticketTypes;if('reminderMinutes' in b){if(b.reminderMinutes>0&&(!cfg.ticketReminderMinutes||!cfg.ticketReminderEnabledAt))cfg.ticketReminderEnabledAt=new Date().toISOString();if(b.reminderMinutes===0)cfg.ticketReminderEnabledAt=null;cfg.ticketReminderMinutes=b.reminderMinutes;}return {ok:true,ticketTypesRevision:ticketTypesRevision(ticketTypesFromConfig(cfg)),reminderRevision:ticketReminderRevision(cfg)}});
  } else throw bad('Modul tidak tersedia.',404);
  res.json({ok:true,settings:updated});
 }catch(e){answer(res,e)}});
 // Manual reward role sync. It runs in the background of this process and
 // only adds roles; the page reads the result with the GET route.
 router.get('/leveling/reward-sync', auth, (req, res) => {
     res.set('Cache-Control', 'no-store');
     res.json({ status: getRewardSyncStatus(req.guild.id) });
 });
 router.post('/leveling/reward-sync', auth, csrf, async (req, res) => {
     try {
         exact(req.body, ['confirmed']);
         if (req.body.confirmed !== true) throw bad('Konfirmasi diperlukan.');
         const cfg = await read(client, req.guild.id);
         if (cfg.leveling?.enabled === false) throw bad('Leveling sedang dinonaktifkan.', 409);
         if (listRewardEntries(cfg.leveling).length === 0) throw bad('Belum ada role hadiah yang tersimpan.', 409);

         const before = getRewardSyncStatus(req.guild.id);
         if (before.running) {
             return res.status(409).json({ error: 'Sinkronisasi masih berjalan.', status: before });
         }
         if (before.finishedAt && Date.now() - Date.parse(before.finishedAt) < REWARD_SYNC_PAUSE_MS) {
             return res.status(429).json({ error: 'Sinkronisasi baru saja selesai. Tunggu satu menit.', status: before });
         }

         const { started, status } = startRewardSync(client, req.guild.id);
         if (!started) return res.status(409).json({ error: 'Sinkronisasi masih berjalan.', status });
         console.info(`[dashboard] reward role sync started guild=${req.guild.id} by=${req.member?.id}`);
         res.status(202).json({ ok: true, status });
     } catch (e) { answer(res, e); }
 });
 router.post('/panel/:kind',auth,csrf,async(req,res)=>{try{
  exact(req.body,['confirmed']);if(req.body.confirmed!==true)throw bad('Konfirmasi diperlukan.');
  const kind=req.params.kind;if(kind!=='ticket')throw bad('Panel tidak tersedia.',404);
  const result=await Mutex.runExclusive(`web-panel:${kind}:${req.guild.id}`,async()=>{
   const cfg=await read(client,req.guild.id);
   const cid=cfg?.ticketPanelChannelId, mid=cfg?.ticketPanelMessageId;
   const channel=req.guild.channels.cache.get(cid), me=req.guild.members.me;
   if(!channel || channel.type!==ChannelType.GuildText || !me)throw bad('Channel panel tidak tersedia.');
   if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ReadMessageHistory]))throw bad('Bot memerlukan izin View Channel, Send Messages, Embed Links, dan Read Message History.',403);
   const marker='create_ticket';let msg=null;
   if(mid){try{msg=await channel.messages.fetch(mid)}catch(e){if(e.code!==10008)throw bad('Panel lama tidak dapat diperiksa. Tidak membuat panel baru.',409)}
    if(msg && (msg.author?.id!==client.user.id || !messageHasPanelMarker(msg,{buttonCustomId:marker})))throw bad('Pesan lama bukan panel bot yang sesuai.',409);
   }
   if (!msg) {const recent=await channel.messages.fetch({limit:50});msg=[...recent.values()].find(m=>m.author?.id===client.user.id && messageHasPanelMarker(m,{buttonCustomId:marker}))||null;}
   const body={...v2Message([createV2Container({title:'Support Tickets',description:cfg.ticketPanelMessage||'Click to create a ticket.',color:'blurple'}),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(marker).setLabel(cfg.ticketButtonLabel||'Create Ticket').setStyle(ButtonStyle.Primary).setEmoji('📩'))]),allowedMentions:{parse:[]}};
   if(msg){await msg.edit(body);}else{msg=await channel.send(body);}
   try{await transaction(client,req.guild.id,c=>{if(c.ticketPanelChannelId!==cid)throw bad('Konfigurasi berubah; periksa panel Discord.',409);c.ticketPanelMessageId=msg.id;});}catch(e){if(e?.status===409)throw e;throw bad('Panel dikirim/diperbarui tetapi ID tidak dapat disimpan. Periksa Discord sebelum mencoba lagi.',409);}
   return {messageId:msg.id};
  });res.json({ok:true,...result});
 }catch(e){answer(res,e)}});
 return router;
}
