import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteBackend } from '../storage/sqlite.js';
import { createSqliteActivityStore } from './sqliteActivities.js';
import { logger } from '../../utils/logger.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const roundActive=()=>Object.assign(error('Masih ada ronde yang berjalan.',409),{code:'ROUND_ACTIVE'});
// What is stored may be anything; the schedules only ever work with a plain object.
const scheduleValue=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export const DEFAULT_ACTIVITY=Object.freeze({enabled:false,channelId:null,duration:60,language:'id',kind:'trivia',scheduleEnabled:false,scheduleTime:'18:00',scheduleDays:'everyday',timeZone:'WIB',rewardPoints:0,
 // Repeating rounds: each game has its own switch and its own gap, inside shared hours of the day.
 repeatTrivia:false,repeatTriviaMinutes:120,repeatEmoji:false,repeatEmojiMinutes:60,repeatFrom:'08:00',repeatUntil:'22:00',repeatDays:'everyday'});
export const REPEAT_MINUTES=Object.freeze({min:5,max:1440});
export function validateActivity(v,guild){
 const keys=Object.keys(DEFAULT_ACTIVITY);if(!v||typeof v!=='object'||Array.isArray(v)||keys.length!==Object.keys(v).length||keys.some(k=>!Object.hasOwn(v,k)))throw error('Pengaturan activity tidak valid.');
 if(typeof v.enabled!=='boolean'||typeof v.scheduleEnabled!=='boolean'||!Number.isInteger(v.rewardPoints)||v.rewardPoints<0||v.rewardPoints>1000||!Number.isInteger(v.duration)||v.duration<30||v.duration>300||!['id','en'].includes(v.language)||!['trivia','emoji'].includes(v.kind)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.scheduleTime)||!['everyday','weekdays','weekend'].includes(v.scheduleDays)||!['WIB','WITA','WIT'].includes(v.timeZone))throw error('Pengaturan activity tidak valid.');
 const clock=/^([01]\d|2[0-3]):[0-5]\d$/,gap=n=>Number.isInteger(n)&&n>=REPEAT_MINUTES.min&&n<=REPEAT_MINUTES.max;
 if(typeof v.repeatTrivia!=='boolean'||typeof v.repeatEmoji!=='boolean'||!clock.test(v.repeatFrom)||!clock.test(v.repeatUntil)||!['everyday','weekdays','weekend'].includes(v.repeatDays))throw error('Pengaturan ronde berulang tidak valid.');
 if(!gap(v.repeatTriviaMinutes)||!gap(v.repeatEmojiMinutes))throw error(`Jarak ronde berulang harus ${REPEAT_MINUTES.min} menit sampai 24 jam.`);
 if(v.channelId!==null&&(typeof v.channelId!=='string'||!/^\d{17,20}$/.test(v.channelId)))throw error('Channel tidak valid.');
 if(guild&&v.channelId!==null&&guild.channels.cache.get(v.channelId)?.type!==ChannelType.GuildText)throw error('Channel tidak tersedia di server ini.');
 if(v.enabled&&!v.channelId)throw error('Pilih channel activity.');
 if(guild&&v.enabled){const c=guild.channels.cache.get(v.channelId),me=guild.members.me;if(!me||!c?.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks]))throw error('Bot membutuhkan View Channel, Send Messages dan Embed Links.');}
 return {...v};
}
function dbPool(client){const db=client.db;if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw error('Database persisten tidak tersedia.',503);return db.db.pool;}
export function createActivityStore(client){
 const sqlite=sqliteBackend(client);if(sqlite)return createSqliteActivityStore(sqlite,{defaults:DEFAULT_ACTIVITY,validateActivity,validateQuiz,error,scheduleValue,roundActive});
 const table=pgConfig.tables.cache_data,key=id=>`ai:activity:settings:${id}`,roundKey=id=>`ai:activity:round:${id}`;
 async function locked(guildId,fn){const conn=await dbPool(client).connect();try{await conn.query('BEGIN');await conn.query(`INSERT INTO ${table} (key,value) VALUES ($1,'{}'::jsonb) ON CONFLICT (key) DO NOTHING`,[roundKey(guildId)]);const r=await conn.query(`SELECT value FROM ${table} WHERE key=$1 FOR UPDATE`,[roundKey(guildId)]);const value=r.rows[0].value;const result=await fn(value,conn);if(result.write)await conn.query(`UPDATE ${table} SET value=$2::jsonb WHERE key=$1`,[roundKey(guildId),JSON.stringify(result.write)]);await conn.query('COMMIT');return result.result;}catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release();}}
 // Everything the schedules remember is one row: {day, slots, last, recent}. `fn` gets it under a row lock and
 // answers {write?, result}.
 const scheduleKey=id=>`ai:activity:schedule:${id}`;
 async function updateSchedule(id,fn){const conn=await dbPool(client).connect(),k=scheduleKey(id);try{await conn.query('BEGIN');await conn.query(`INSERT INTO ${table} (key,value) VALUES ($1,'{}'::jsonb) ON CONFLICT (key) DO NOTHING`,[k]);const r=await conn.query(`SELECT value FROM ${table} WHERE key=$1 FOR UPDATE`,[k]);const out=fn(scheduleValue(r.rows[0].value));if(out.write)await conn.query(`UPDATE ${table} SET value=$2::jsonb WHERE key=$1`,[k,JSON.stringify(out.write)]);await conn.query('COMMIT');return out.result;}catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release()}}
 return {
  async read(id){const r=await dbPool(client).query(`SELECT value FROM ${table} WHERE key=$1`,[key(id)]);return r.rows[0]?.value?validateActivity({...DEFAULT_ACTIVITY,...r.rows[0].value}):{...DEFAULT_ACTIVITY};},
  async save(id,cfg){const v=validateActivity(cfg);await dbPool(client).query(`INSERT INTO ${table} (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,[key(id),JSON.stringify(v)]);return v;},
  claimSchedule:(id,day)=>updateSchedule(id,v=>v.day===day?{result:false}:{write:{...v,day},result:true}),
  // Gives the day's claim back, for a round that failed before anything was sent. True if that day was the claim.
  releaseSchedule:(id,day)=>updateSchedule(id,v=>{if(v.day!==day)return {result:false};const {day:_,...rest}=v;return {write:rest,result:true};}),
  updateSchedule,
  async readSchedule(id){const r=await dbPool(client).query(`SELECT value FROM ${table} WHERE key=$1`,[scheduleKey(id)]);return scheduleValue(r.rows[0]?.value);},
  async status(id,now=Date.now()){const r=await dbPool(client).query(`SELECT value FROM ${table} WHERE key=$1`,[roundKey(id)]);const v=r.rows[0]?.value;if(!v||!['pending','open','expired','solved','closed'].includes(v.state))return {state:'none'};const state=v.state==='open'&&v.expiresAt<=now?'expired':v.state;const quiz=validateQuiz(v.question);return {state,expiresAt:Number.isFinite(v.expiresAt)?v.expiresAt:null,...(quiz?{question:quiz.question,options:quiz.options,...(state!=='open'&&state!=='pending'?{answer:quiz.answer}:{})}:{})};},
  async points(id,userId){if(!/^\d{17,20}$/.test(userId||''))throw error('Anggota tidak valid.');const r=await dbPool(client).query(`SELECT value FROM ${table} WHERE key=$1`,[`ai:activity:points:${id}:${userId}`]);const n=r.rows[0]?.value?.points??0;if(!Number.isSafeInteger(n)||n<0)throw error('Saldo poin tidak valid.',503);return n;},
  reserve(id,roundId,now){return locked(id,v=>{if(['pending','open'].includes(v.state)&&v.expiresAt>now)throw roundActive();return {write:{state:'pending',id:roundId,expiresAt:now+150000},result:true};});},
  open(id,roundId,question,duration,now,rewardPoints=0){return locked(id,v=>{if(v.state!=='pending'||v.id!==roundId||v.expiresAt<=now)throw error('Reservasi ronde kedaluwarsa.',409);return {write:{state:'open',id:roundId,expiresAt:now+duration*1000,question,answered:[],messageId:null,rewardPoints},result:true}});},
  attach(id,roundId,messageId){return locked(id,v=>{if(v.state!=='open'||v.id!==roundId)throw error('Ronde sudah berubah.',409);return {write:{...v,messageId},result:true}});},
  cancel(id,roundId){return locked(id,v=>v.id===roundId?{write:{state:'closed'},result:true}:{result:false});},
  answer(id,roundId,messageId,userId,choice,now){return locked(id,async(v,conn)=>{
   if(v.id!==roundId||v.messageId!==messageId||v.state!=='open')return {result:{status:'closed'}};
   if(v.expiresAt<=now)return {write:{...v,state:'expired'},result:{status:'expired',question:v.question}};
   if(!Array.isArray(v.answered)||v.answered.length>=1000)return {result:{status:'full'}};
   if(v.answered.includes(userId))return {result:{status:'answered'}};
   const answered=[...v.answered,userId];if(choice===v.question.answer){
    const reward=v.rewardPoints??0;if(!Number.isInteger(reward)||reward<0||reward>1000||!/^\d{17,20}$/.test(userId||''))throw error('Data hadiah tidak valid.',503);let points=null;
    if(reward){const k=`ai:activity:points:${id}:${userId}`;await conn.query(`INSERT INTO ${table} (key,value) VALUES ($1,'{}'::jsonb) ON CONFLICT (key) DO NOTHING`,[k]);const row=await conn.query(`SELECT value FROM ${table} WHERE key=$1 FOR UPDATE`,[k]);const before=row.rows[0].value.points??0;points=before+reward;if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(points))throw error('Saldo poin tidak valid.',503);await conn.query(`UPDATE ${table} SET value=$2::jsonb WHERE key=$1`,[k,JSON.stringify({points})]);}
    return {write:{...v,state:'solved',answered},result:{status:'correct',question:v.question,reward,points}};}

   return {write:{...v,answered},result:{status:'wrong'}};
  });},
  expire(id,roundId,now){return locked(id,v=>v.id===roundId&&v.state==='open'&&v.expiresAt<=now?{write:{...v,state:'expired'},result:v.question}:{result:null});}
 };
}
const FALLBACK={question:'Planet mana yang dikenal sebagai planet merah?',options:['Venus','Mars','Jupiter','Merkurius'],answer:1};
export function validateQuiz(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='answer,options,question')return null;
 const valid=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/https?:\/\/|www\.|discord\.gg|<@|@(everyone|here)/i.test(s);
 if(!valid(raw.question,300)||!Array.isArray(raw.options)||raw.options.length!==4||raw.options.some(x=>!valid(x,80))||new Set(raw.options.map(x=>x.trim().toLowerCase())).size!==4||!Number.isInteger(raw.answer)||raw.answer<0||raw.answer>3)return null;
 return {question:raw.question.trim(),options:raw.options.map(x=>x.trim()),answer:raw.answer};
}
export function quizPayload(quiz,roundId,{ended=null}={}){
 const choices=quiz.options.map((o,i)=>`**${String.fromCharCode(65+i)}.** ${o}`).join('\n');
 const description=`${quiz.question}\n\n${choices}${ended?`\n\n${ended} Jawaban: **${String.fromCharCode(65+quiz.answer)}. ${quiz.options[quiz.answer]}**`:''}`;
 // raw: emoji-kind questions are emoji by design, so the text displays must keep Extended_Pictographic characters.
 const container=createV2Container({title:'✳ AI Activities',description,color:0xb0e52c,raw:true});
 const rows=[
  ...(!ended?[new ActionRowBuilder().addComponents(quiz.options.map((_,i)=>new ButtonBuilder().setCustomId(`ai_quiz:${roundId}:${i}`).setLabel(String.fromCharCode(65+i)).setStyle(ButtonStyle.Secondary)))]:[]),
  new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ai_quiz_points:view').setLabel('Poin saya').setStyle(ButtonStyle.Secondary))
 ];
 return {...v2Message([container,...rows]),allowedMentions:{parse:[]}};
}
// Asking for "one easy question" again and again gets the same few questions back, so every request names a topic
// and lists what was asked lately.
const TOPICS={
 trivia:['geography','science','history','animals and nature','food and drink','sports','technology','music and film','space','the human body','language and literature','Indonesia','inventions','world records'],
 emoji:['animals','food and drink','everyday objects','jobs','sports','places','weather and nature','vehicles','well-known films','fruits and vegetables','hobbies','fairy tales'],
};
const RECENT_KEPT=30;
export function quizPrompt({kind,language,recent=[],random=Math.random}){
 const topics=TOPICS[kind],topic=topics[Math.min(topics.length-1,Math.floor(random()*topics.length))];
 // The newest questions first, within a budget that keeps the request well under the 4000 characters allowed.
 const earlier=[];let size=0;for(const q of [...recent].reverse()){const text=String(q).slice(0,120);if(earlier.length>=15||size+text.length>1500)break;earlier.unshift(text);size+=text.length;}
 return `Generate one easy ${kind==='emoji'?'emoji guessing puzzle, where the question contains emoji representing a familiar object or phrase':'factual general-knowledge multiple choice question'} in ${language==='id'?'Indonesian':'English'}. Topic: ${topic}.${earlier.length?` It must be different from these earlier ones: ${JSON.stringify(earlier)}.`:''} Respond with only JSON object with keys question (string), options (array of exactly 4 short strings), answer (correct index 0 to 3). No URLs or mentions.`;
}
/** The quiz in a provider's answer. Models often wrap the JSON in a code fence or a sentence. */
export function parseQuiz(text){
 if(typeof text!=='string')return null;
 for(const candidate of [text,text.slice(text.indexOf('{'),text.lastIndexOf('}')+1)]){try{const quiz=validateQuiz(JSON.parse(candidate));if(quiz)return quiz;}catch{}}
 return null;
}
const sameQuestion=q=>String(q).toLowerCase().replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu,' ').trim();
const FALLBACKS={
 trivia:{id:FALLBACK,en:{question:'Which planet is known as the Red Planet?',options:['Venus','Mars','Jupiter','Mercury'],answer:1}},
 emoji:{id:{question:'Tebak kata: ☀️🌻',options:['Bunga matahari','Bulan','Laut','Awan'],answer:0},en:{question:'Guess the word: ☀️🌻',options:['Sunflower','Moon','Ocean','Cloud'],answer:0}},
};
/**
 * Starts one round in the configured channel.
 * `kind` picks the game for this round (default: the one in the settings). `requireAI` is for repeating rounds:
 * the fixed fallback question would come back every hour, so the round is refused (code NO_QUESTION) when the AI
 * gives no usable, new question.
 */
export async function startActivity({client,guild,actorId,store=createActivityStore(client),foundation=client.aiFoundation,kind=null,requireAI=false,random=Math.random}){
 if(guild.id!==client.homeGuildId)throw error('Server tidak valid.',403);const cfg=validateActivity(await store.read(guild.id),guild);if(!cfg.enabled)throw error('AI Activities belum diaktifkan.',403);
 const game=kind??cfg.kind;if(!REPEAT_KINDS.includes(game))throw error('Jenis permainan tidak valid.');
 const roundId=crypto.randomBytes(10).toString('hex');await store.reserve(guild.id,roundId,Date.now());let sendAttempted=false;
 try{
  const recent=await recentQuestions(store,guild.id,game),asked=new Set(recent.map(sameQuestion));
  let question=null,source='ai',reason='AI tidak memberi soal.';
  for(let attempt=0;attempt<(requireAI?2:1)&&!question;attempt++){
   try{const r=await foundation.generate({guildId:guild.id,userId:actorId,consent:true,kind:'activity',prompt:quizPrompt({kind:game,language:cfg.language,recent,random})});const quiz=parseQuiz(r.text);
    if(!quiz)reason='AI tidak memberi soal dengan format yang benar.';else if(requireAI&&asked.has(sameQuestion(quiz.question)))reason='AI mengulang soal yang baru saja dipakai.';else question=quiz;
   }catch(e){
    // The AI layer refuses with a code, a status and a text written for the owner (daily limit reached, AI switched
    // off, providers down). Anything else (a database driver's error, a bug) is not shown.
    reason=typeof e?.code==='string'&&Number.isInteger(e?.status)&&e.message?String(e.message).slice(0,200):'AI tidak dapat dihubungi.';break;}
  }
  if(!question){if(requireAI)throw Object.assign(error(reason,503),{code:'NO_QUESTION'});question=FALLBACKS[game][cfg.language==='en'?'en':'id'];source='fallback';}
  await store.open(guild.id,roundId,question,cfg.duration,Date.now(),cfg.rewardPoints);const channel=guild.channels.cache.get(cfg.channelId);sendAttempted=true;let message;
  try{message=await channel.send(quizPayload(question,roundId));}catch{throw error('Hasil pengiriman ronde tidak pasti; periksa channel sebelum mencoba lagi.',409)}
  try{await store.attach(guild.id,roundId,message.id);}catch{throw error('Ronde terkirim tetapi status gagal disimpan; periksa channel sebelum mencoba lagi.',409)}
  if(source==='ai')await rememberQuestion(store,guild.id,game,question.question);
  const timer=setTimeout(async()=>{try{const expired=await store.expire(guild.id,roundId,Date.now());if(expired)await message.edit(quizPayload(expired,roundId,{ended:'Waktu habis.'}));}catch{}},cfg.duration*1000+100);timer.unref?.();
  return {messageId:message.id,source,kind:game};
 }catch(e){if(!sendAttempted)await store.cancel(guild.id,roundId).catch(()=>{});throw e;}
}
// The questions asked lately, per game. Remembering them is a nicety: a store that cannot keep them, or a read
// that fails, must never cost a round.
async function recentQuestions(store,guildId,kind){
 if(!store.readSchedule)return [];
 try{const list=(await store.readSchedule(guildId)).recent?.[kind];return Array.isArray(list)?list.filter(q=>typeof q==='string'):[];}catch{return [];}
}
async function rememberQuestion(store,guildId,kind,question){
 if(!store.updateSchedule)return;
 try{await store.updateSchedule(guildId,v=>{const old=Array.isArray(v.recent?.[kind])?v.recent[kind].filter(q=>typeof q==='string'):[];return {write:{...v,recent:{...v.recent,[kind]:[...old,question].slice(-RECENT_KEPT)}},result:true};});}catch{}
}
const ZONES={WIB:'Asia/Jakarta',WITA:'Asia/Makassar',WIT:'Asia/Jayapura'};
// The check runs once a minute. A round is due from its minute until this many minutes later, so that a check
// that failed (database not answering) or did not run (bot restarting) at that minute does not cost the day's round.
// The period ends at midnight of the chosen zone.
export const SCHEDULE_LATE_MINUTES=10;
/** The local day (YYYY-MM-DD) whose scheduled round is due at `now`, or null. */
export function scheduleMatches(cfg,now=new Date()){
 if(!cfg.enabled||!cfg.scheduleEnabled)return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:ZONES[cfg.timeZone],year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const weekend=['Sat','Sun'].includes(parts.weekday);if(cfg.scheduleDays==='weekdays'&&weekend||cfg.scheduleDays==='weekend'&&!weekend)return null;
 const [hour,minute]=cfg.scheduleTime.split(':').map(Number),late=Number(parts.hour)*60+Number(parts.minute)-(hour*60+minute);if(late<0||late>=SCHEDULE_LATE_MINUTES)return null;
 return `${parts.year}-${parts.month}-${parts.day}`;
}
export async function runScheduledActivity(client,{store=createActivityStore(client),now=new Date(),start=startActivity,cfg=null}={}){
 const guild=client.guilds?.cache.get(client.homeGuildId);if(!guild)return false;cfg??=await store.read(guild.id);const day=scheduleMatches(cfg,now);if(!day)return false;
 // The day is claimed first, so that two checks can never start two rounds.
 if(!await store.claimSchedule(guild.id,day))return false;
 try{await start({client,guild,actorId:client.user.id,store,foundation:client.aiFoundation});}
 catch(e){
  // startActivity refuses with a status (a round is running, the outcome of sending is unknown, ...): the day stays
  // claimed, as before. Anything else failed before the round was sent, so the next minute may try again.
  if(!e?.status)await store.releaseSchedule?.(guild.id,day).catch(()=>{});
  throw e;
 }
 return true;
}

// ---- Repeating rounds -------------------------------------------------------------------------------------------
// Each game repeats on its own: every N minutes, counted from the first hour of the active hours, on the chosen
// days. A slot is a point on the local clock ("2026-11-12T10:00"); it is claimed before the round is started,
// like the daily schedule, so no fault can send a slot twice.
export const REPEAT_KINDS=Object.freeze(['trivia','emoji']);
const KIND_LABEL={trivia:'trivia',emoji:'tebak emoji'};
const MINUTE=60000,DAY_MINUTES=1440;
// WIB, WITA and WIT have no daylight saving time, so the local clock is a fixed shift.
const OFFSET={WIB:7*60*MINUTE,WITA:8*60*MINUTE,WIT:9*60*MINUTE};
const minutesOf=clock=>{const [h,m]=clock.split(':').map(Number);return h*60+m;};
/** `now` on the local clock, cut to the minute, as a Date whose UTC fields are the local ones. */
const localTime=(cfg,now)=>new Date(Math.floor(now.getTime()/MINUTE)*MINUTE+OFFSET[cfg.timeZone]);
const dayAllowed=(days,local)=>days==='everyday'||(days==='weekend')===[0,6].includes(local.getUTCDay());
const repeatRule=(cfg,kind)=>kind==='emoji'?{on:cfg.enabled&&cfg.repeatEmoji,every:cfg.repeatEmojiMinutes}:{on:cfg.enabled&&cfg.repeatTrivia,every:cfg.repeatTriviaMinutes};
/** The active hours: where they start, and how many minutes they last. The same start and end means all day; an end before the start runs past midnight. */
const repeatWindow=cfg=>{const from=minutesOf(cfg.repeatFrom),until=minutesOf(cfg.repeatUntil);return {from,span:from===until?DAY_MINUTES-1:(until-from+DAY_MINUTES)%DAY_MINUTES};};
const slotOf=(cfg,local)=>({slot:local.toISOString().slice(0,16),at:new Date(local.getTime()-OFFSET[cfg.timeZone])});
/** The slot of `kind` that is due at `now` ({slot, at}), or null. A slot stays due for up to SCHEDULE_LATE_MINUTES. */
export function repeatDue(cfg,kind,now=new Date()){
 const {on,every}=repeatRule(cfg,kind);if(!on)return null;
 const {from,span}=repeatWindow(cfg),local=localTime(cfg,now),elapsed=(local.getUTCHours()*60+local.getUTCMinutes()-from+DAY_MINUTES)%DAY_MINUTES,start=Math.floor(elapsed/every)*every;
 if(start>span||elapsed-start>=Math.min(SCHEDULE_LATE_MINUTES,every))return null;
 // The day rule looks at the day the active hours began, so a Saturday night that runs past midnight stays whole.
 const opened=new Date(local.getTime()-elapsed*MINUTE);if(!dayAllowed(cfg.repeatDays,opened))return null;
 return slotOf(cfg,new Date(opened.getTime()+start*MINUTE));
}
/** The first slot of `kind` after `now` ({slot, at}), or null when the game does not repeat. */
export function repeatNext(cfg,kind,now=new Date()){
 const {on,every}=repeatRule(cfg,kind);if(!on)return null;
 const {from,span}=repeatWindow(cfg),local=localTime(cfg,now),midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
 // Yesterday's hours may still be running; a week ahead always holds an allowed day.
 for(let day=-1;day<=7;day++){
  const opened=new Date(midnight+day*DAY_MINUTES*MINUTE+from*MINUTE);if(!dayAllowed(cfg.repeatDays,opened))continue;
  const passed=local.getTime()-opened.getTime(),start=passed<0?0:(Math.floor(passed/(every*MINUTE))+1)*every;
  if(start<=span)return slotOf(cfg,new Date(opened.getTime()+start*MINUTE));
 }
 return null;
}
/** How many rounds of `kind` one day of active hours holds. */
export const repeatPerDay=(cfg,kind)=>{const {on,every}=repeatRule(cfg,kind);return on?Math.floor(repeatWindow(cfg).span/every)+1:0;};
const DAY_NAMES=['Min','Sen','Sel','Rab','Kam','Jum','Sab'],MONTH_NAMES=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
/** "hari ini 14:00", "besok 08:00" or "Sab 14 Nov 08:00" for a slot, seen from `now`. */
function slotLabel(cfg,slot,now){
 const local=localTime(cfg,now),today=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()),when=new Date(`${slot}:00Z`),days=Math.floor((when.getTime()-today)/(DAY_MINUTES*MINUTE)),clock=slot.slice(11);
 return days===0?`hari ini ${clock}`:days===1?`besok ${clock}`:days===-1?`kemarin ${clock}`:`${DAY_NAMES[when.getUTCDay()]} ${when.getUTCDate()} ${MONTH_NAMES[when.getUTCMonth()]} ${clock}`;
}
/** What the settings will do, for the dashboard: per game the gap, the rounds per day and the next round. */
export function activityPlan(cfg,now=new Date(),state={}){
 const repeat={};let perDay=cfg.enabled&&cfg.scheduleEnabled?1:0;
 for(const kind of REPEAT_KINDS){
  const {on,every}=repeatRule(cfg,kind),next=repeatNext(cfg,kind,now),rounds=repeatPerDay(cfg,kind),last=state.last?.[kind];perDay+=rounds;
  repeat[kind]={enabled:Boolean(on),minutes:every,perDay:rounds,next:next?slotLabel(cfg,next.slot,now):null,
   last:last&&typeof last.slot==='string'&&['sent','skipped'].includes(last.result)?{when:slotLabel(cfg,last.slot,now),result:last.result,reason:typeof last.reason==='string'?last.reason:null}:null};
 }
 return {timeZone:cfg.timeZone,perDay,repeat};
}
const claimSlot=(store,guildId,kind,slot)=>store.updateSchedule(guildId,v=>v.slots?.[kind]===slot?{result:false}:{write:{...v,slots:{...v.slots,[kind]:slot}},result:true});
const releaseSlot=(store,guildId,kind,slot)=>store.updateSchedule(guildId,v=>{if(v.slots?.[kind]!==slot)return {result:false};const {[kind]:_,...slots}=v.slots;return {write:{...v,slots},result:true};});
const noteSlot=(store,guildId,kind,entry)=>store.updateSchedule(guildId,v=>({write:{...v,last:{...v.last,[kind]:entry}},result:true})).catch(()=>{});
/** Starts the repeating round that is due, if any: at most one a minute, because only one round can be open. */
export async function runRepeatActivity(client,{store=createActivityStore(client),now=new Date(),start=startActivity,cfg=null,log=logger}={}){
 const guild=client.guilds?.cache.get(client.homeGuildId);if(!guild)return false;cfg??=await store.read(guild.id);
 // When both games are due in the same minute the rarer one goes first; the other follows once that round is over.
 const due=REPEAT_KINDS.map(kind=>({kind,every:repeatRule(cfg,kind).every,slot:repeatDue(cfg,kind,now)?.slot})).filter(x=>x.slot).sort((a,b)=>b.every-a.every);
 if(!due.length||!store.updateSchedule)return false;
 const claimed=(await store.readSchedule(guild.id)).slots??{};
 for(const {kind,slot} of due){
  if(claimed[kind]===slot||!await claimSlot(store,guild.id,kind,slot))continue;
  try{await start({client,guild,actorId:client.user.id,store,foundation:client.aiFoundation,kind,requireAI:true});}
  catch(e){
   // Another round is still open, or the database failed before anything was sent: the slot is given back and the
   // next minute tries again, for as long as the slot is due.
   if(e?.code==='ROUND_ACTIVE'||!e?.status){await releaseSlot(store,guild.id,kind,slot).catch(()=>{});if(e?.code==='ROUND_ACTIVE')return false;throw e;}
   // Everything else keeps the slot: the outcome of sending is unknown, the channel is gone, or the AI had no question.
   const reason=String(e.message||'Ronde gagal dimulai.').slice(0,200);await noteSlot(store,guild.id,kind,{slot,result:'skipped',reason,at:now.getTime()});
   if(e.code!=='NO_QUESTION')throw e;
   log.warn(`AI Activities: ronde ${KIND_LABEL[kind]} ${slot.replace('T',' ')} ${cfg.timeZone} dilewati: ${reason}`);return false;
  }
  await noteSlot(store,guild.id,kind,{slot,result:'sent',at:now.getTime()});return true;
 }
 return false;
}
/** The every-minute task: the daily schedule, then the repeating rounds. One failing does not stop the other. */
export async function runActivitySchedules(client,{store=createActivityStore(client),now=new Date(),start=startActivity,log=logger}={}){
 const guild=client.guilds?.cache.get(client.homeGuildId);if(!guild)return false;const cfg=await store.read(guild.id);let ran=false,failure=null;
 for(const run of [runScheduledActivity,runRepeatActivity]){try{ran=await run(client,{store,now,start,cfg,log})||ran;}catch(e){failure??=e;}}
 if(failure)throw failure;return ran;
}
const SCHEDULE_FIELDS=['enabled','scheduleEnabled','scheduleTime','scheduleDays','timeZone'];
const REPEAT_FIELDS={trivia:['enabled','repeatTrivia','repeatTriviaMinutes','repeatFrom','repeatUntil','repeatDays','timeZone'],emoji:['enabled','repeatEmoji','repeatEmojiMinutes','repeatFrom','repeatUntil','repeatDays','timeZone']};
/**
 * Saves the settings of the dashboard form. A schedule that is changed when its time has already passed today
 * starts on its next day, and a repeating game that is changed while a slot is due starts with its next slot:
 * without this the grace period would start a round a minute after saving.
 */
export async function saveActivitySettings({store,guildId,settings,now=new Date()}){
 const next=validateActivity(settings),before=await store.read(guildId),changed=fields=>fields.some(name=>before[name]!==next[name]),undo=[];
 try{
  // Claims come before the settings are stored: were it the other way round, a claim that failed would leave the
  // new schedule in force and due, and the round would start within a minute after all.
  const day=scheduleMatches(next,now);
  if(day&&changed(SCHEDULE_FIELDS)&&await store.claimSchedule(guildId,day))undo.push(()=>store.releaseSchedule?.(guildId,day));
  if(store.updateSchedule)for(const kind of REPEAT_KINDS){
   const slot=repeatDue(next,kind,now)?.slot;
   if(slot&&changed(REPEAT_FIELDS[kind])&&await claimSlot(store,guildId,kind,slot))undo.push(()=>releaseSlot(store,guildId,kind,slot));
  }
  return (await store.save(guildId,next))??next;
 }catch(e){for(const release of undo)await Promise.resolve().then(release).catch(()=>{});throw e;}
}
