import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { pgConfig } from '../../config/database/postgres.js';
import { sqliteBackend } from '../storage/sqlite.js';
import { buildWelcomePayload, buildGoodbyePayload } from '../welcomePayload.js';
import { formatWelcomeMessage } from '../../utils/welcome.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import {readGreetingBanner, attachGreetingBanner, withoutGreetingImage} from '../greetingBanner.js';

export const DEFAULT_AI_WELCOME=Object.freeze({enabled:false,toChannel:true,toDm:false,channelId:null,tone:'warm',language:'id',fallback:'Selamat datang {user} di {server}!'});
export const DEFAULT_AI_GOODBYE=Object.freeze({...DEFAULT_AI_WELCOME,fallback:'Sampai jumpa {user}, terima kasih sudah bersama {server}.'});
const invalid=message=>Object.assign(new Error(message),{status:400,code:'INVALID_WELCOME'});
export function validateAIWelcome(v,guild){
 const keys=Object.keys(DEFAULT_AI_WELCOME);
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)&&k!=='shared'&&k!=='persona')||!keys.every(k=>Object.hasOwn(v,k))||(v.shared!==undefined&&typeof v.shared!=='boolean'))throw invalid('Pengaturan AI Welcome tidak valid.');
 if(['enabled','toChannel','toDm'].some(k=>typeof v[k]!=='boolean'))throw invalid('Status harus boolean.');
 if(v.channelId!==null&&(typeof v.channelId!=='string'||!/^\d{17,20}$/.test(v.channelId)))throw invalid('ID channel tidak valid.');
 if(guild&&v.channelId!==null&&guild.channels.cache.get(v.channelId)?.type!==ChannelType.GuildText)throw invalid('Pilih channel teks pada server ini.');
 if(v.enabled&&(!v.toChannel&&!v.toDm))throw invalid('Pilih channel atau DM.');
 if(v.enabled&&v.toChannel&&!v.channelId)throw invalid('Pilih channel untuk AI Welcome.');
 if(guild&&v.enabled&&v.toChannel){const channel=guild.channels.cache.get(v.channelId),me=guild.members.me;const perms=me&&channel?.permissionsFor?.(me);if(!perms?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw invalid('Bot memerlukan izin View Channel dan Send Messages pada channel.');}
 if(!['warm','casual','funny','formal'].includes(v.tone)||!['id','en'].includes(v.language))throw invalid('Gaya atau bahasa tidak valid.');
 if(v.persona!==undefined&&!['default','friendly','cheerful','thoughtful','concise'].includes(v.persona))throw invalid('Template persona tidak valid.');
 if(typeof v.fallback!=='string'||!v.fallback.trim()||v.fallback.length>1000)throw invalid('Template cadangan harus 1–1000 karakter.');
 return {...v};
}
export function createAIWelcomeStore(client,kind='welcome'){
 if(!['welcome','goodbye'].includes(kind))throw invalid('Jenis greeting tidak valid.');
 const defaults=kind==='goodbye'?DEFAULT_AI_GOODBYE:DEFAULT_AI_WELCOME;
 const validate=v=>{const result=validateAIWelcome(v);if(kind==='goodbye' && result.toDm)throw invalid('AI Goodbye tidak mendukung DM.');return result;};
 const key=id=>`ai:${kind}:settings:${id}`,table=pgConfig.tables.cache_data;
 const pool=()=>{const db=client.db;if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw new Error('Persistent database unavailable');return db.db.pool;};
 return {async read(id){const sqlite=sqliteBackend(client);if(sqlite){const v=sqlite.get(key(id));return v?validate(v):{...defaults};}const r=await pool().query(`SELECT value FROM ${table} WHERE key=$1`,[key(id)]);return r.rows[0]?.value?validate(r.rows[0].value):{...defaults};},async save(id,settings){const v=validate(settings),sqlite=sqliteBackend(client);if(sqlite){sqlite.set(key(id),v);return v;}await pool().query(`INSERT INTO ${table} (key,value,expires_at) VALUES ($1,$2::jsonb,NULL) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, expires_at=NULL`,[key(id),JSON.stringify(v)]);return v;}};
}
// Old AI settings remain independent until the owner explicitly saves shared mode.
// Once shared, the template and destination always come from the ordinary greeting settings.
export function sharedGreetingConfig(cfg, legacy, kind='welcome') {
 if(!cfg.shared||!legacy)return cfg;
 return {...cfg,channelId:kind==='goodbye'?legacy.goodbyeChannelId:legacy.channelId,
  fallback:kind==='goodbye'?legacy.leaveMessage:legacy.welcomeMessage};
}
// No guild or user data is sent to the provider; only fixed instructions and validated enum values.
const GREETING_PERSONAS=Object.freeze({friendly:'Use a caring community host voice, warm and welcoming without being overly familiar.',cheerful:'Use a cheerful community host voice with light, appropriate playfulness.',thoughtful:'Use a thoughtful, considerate community host voice, sincere and respectful.',concise:'Use a concise, direct community host voice with no unnecessary details.'});
export function welcomePrompt(cfg,kind='welcome'){const style=Object.hasOwn(GREETING_PERSONAS,cfg.persona)?` ${GREETING_PERSONAS[cfg.persona]}`:'';return `Write one short, friendly Discord server ${kind==='goodbye'?'farewell':'welcome'} in ${cfg.language==='id'?'Indonesian':'English'} with a ${cfg.tone} tone.${style} Output only the message. Include the exact placeholders {user} and {server}; do not include URLs, mentions or other placeholders.`;}
export function safeGeneratedTemplate(text){
 if(typeof text!=='string')return null;const s=text.trim();
 if(!s||s.length>1000||!s.includes('{user}')||!s.includes('{server}')||/https?:\/\/|www\.|discord\.gg|<@|@(everyone|here)/i.test(s)||/\{(?!user\}|server\})[^}]*\}/.test(s))return null;
 return s;
}
export async function generateWelcomeTemplate({foundation,guildId,actorId,cfg,kind='welcome'}){
 try{if(!foundation)throw Error('unavailable');const result=await foundation.generate({guildId,userId:actorId,consent:true,prompt:welcomePrompt(cfg,kind),kind:'welcome'});const template=safeGeneratedTemplate(result.text);if(!template)throw Error('invalid');return {template,source:'ai'};}catch{return {template:cfg.fallback,source:'fallback'};}
}
// The returned text is rendered locally, after generation, without passing Discord names to AI.
export function renderAIWelcome(template,member){return formatWelcomeMessage(template,{member,user:member.user,guild:member.guild}).slice(0,1900);}
// Both channel and DM use Components V2; allow no automatic mentions.
export function buildAIGreetingPayload(content, kind = 'welcome') {
 const container = createV2Container({ description: content, color: kind === 'goodbye' ? 'error' : 'success', raw: true });
 return { ...v2Message([container]), allowedMentions: { parse: [] } };
}
// Greeting word in another language and time spent in the server: added by the bot, switched on in AI Studio → Welcome & goodbye → Sapaan multibahasa.
async function withExtras(content,member,kind){try{return (await member.client.aiSmart?.decorateGreeting?.(content,member,kind))??content}catch{return content}}
export async function deliverJoinWelcome(member,legacyConfig,{store,foundation}={}){
 const guild=member.guild, client=member.client;
 if(!guild||!client||guild.id!==client.homeGuildId)return {source:'blocked'};
 let cfg;try{cfg=await (store||createAIWelcomeStore(client)).read(guild.id);}catch{cfg={...DEFAULT_AI_WELCOME};}
 cfg=sharedGreetingConfig(cfg,legacyConfig,'welcome');
 if(cfg.shared&&cfg.enabled&&!legacyConfig?.enabled)return {source:'disabled'};
 if(!cfg.enabled){
  if(!legacyConfig?.enabled||!legacyConfig.channelId)return {source:'disabled'};
  const ch=guild.channels.cache.get(legacyConfig.channelId),me=guild.members.me,perms=ch?.isTextBased?.()&&me?ch.permissionsFor(me):null;
  if(!perms?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return {source:'legacy-unavailable'};
  const banner=await readGreetingBanner(client,guild.id,'welcome').catch(()=>null);
  await ch.send(attachGreetingBanner(buildWelcomePayload({member,config:banner?withoutGreetingImage(legacyConfig,'welcome'):legacyConfig}),banner));return {source:'legacy'};
 }
 const channel=cfg.toChannel?guild.channels.cache.get(cfg.channelId):null, me=guild.members.me;
 const perms=channel?.type===ChannelType.GuildText && me?channel.permissionsFor(me):null;
 const canChannel=Boolean(perms?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]));
 if(!canChannel&&!cfg.toDm)return {source:'unavailable'};
 const generated=await generateWelcomeTemplate({foundation:foundation||client.aiFoundation,guildId:guild.id,actorId:client.user?.id,cfg});
 const content=await withExtras(renderAIWelcome(generated.template,member),member,'welcome');const banner=await readGreetingBanner(client,guild.id,'welcome').catch(()=>null);
 const visual=cfg.shared?{...legacyConfig,welcomeMessage:content,welcomePing:false}:null;
 const payload=attachGreetingBanner(visual?buildWelcomePayload({member,config:banner?withoutGreetingImage(visual,'welcome'):visual}):buildAIGreetingPayload(content,'welcome'),banner);
 const sends=[];if(canChannel)sends.push(Promise.resolve().then(()=>channel.send(payload)));if(cfg.toDm)sends.push(Promise.resolve().then(()=>member.send(payload)));
 const results=await Promise.allSettled(sends);return {source:generated.source,sent:results.filter(r=>r.status==='fulfilled').length,failed:results.filter(r=>r.status==='rejected').length+(cfg.toChannel&&!canChannel?1:0)};
}

export async function deliverLeaveGoodbye(member,legacy,{store,foundation,legacyConfig}={}){
 const guild=member.guild,client=member.client;if(!guild||!client||guild.id!==client.homeGuildId)return {source:'blocked'};
 let cfg;try{cfg=await (store||createAIWelcomeStore(client,'goodbye')).read(guild.id);}catch{cfg={...DEFAULT_AI_GOODBYE};}
 cfg=sharedGreetingConfig(cfg,legacyConfig,'goodbye');
 if(cfg.shared&&cfg.enabled&&!legacyConfig?.goodbyeEnabled)return {source:'disabled'};
 if(!cfg.enabled){await legacy();return {source:'legacy'};}
 const channel=guild.channels.cache.get(cfg.channelId),me=guild.members.me,perms=channel?.type===ChannelType.GuildText&&me?channel.permissionsFor(me):null;
 if(!perms?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return {source:'unavailable'};
 const generated=await generateWelcomeTemplate({foundation:foundation||client.aiFoundation,guildId:guild.id,actorId:client.user?.id,cfg,kind:'goodbye'});
 const banner=await readGreetingBanner(client,guild.id,'goodbye').catch(()=>null);
 const content=await withExtras(renderAIWelcome(generated.template,member),member,'goodbye');
 const visual=cfg.shared&&legacyConfig?{...legacyConfig,leaveMessage:content,goodbyePing:false}:null;
 await channel.send(attachGreetingBanner(visual?buildGoodbyePayload({member,config:banner?withoutGreetingImage(visual,'goodbye'):visual}):buildAIGreetingPayload(content,'goodbye'),banner));return {source:generated.source};
}
