// Independent daily facts: one saved channel, three validated AI-generated facts, no mentions.
import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { digestDue } from './digest.js';
import { cleanReply } from './interactive.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger as defaultLogger } from '../../utils/logger.js';
const err=(message,status=400)=>Object.assign(new Error(message),{status});
export function parseFacts(text,botName) {
 const raw=String(text??'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let values;
 try { values=JSON.parse(raw); } catch { throw err('Respons AI tidak berisi tiga fakta dalam format yang diminta.',502); }
 if(!Array.isArray(values)||values.length!==3||values.some(v=>typeof v!=='string'||!v.trim()||v.length>400))throw err('Respons AI harus berisi tepat tiga fakta singkat.',502);
 const facts=values.map(v=>(cleanReply(v,botName)||'').replace(/\s+/g,' ').trim());
 if(facts.some(v=>!v||v.length>400)||new Set(facts.map(v=>v.toLowerCase())).size!==3)throw err('Tiga fakta AI tidak valid atau berulang.',502);
 return facts;
}
export function createDailyFacts({client,settings,kv,foundation=()=>client.aiFoundation,now=Date.now,logger=defaultLogger}={}) {
 const key=id=>`ai:facts:status:${id}`;
 const status=async(guild,mode,state,message)=>{try{await kv.set(key(guild.id),{at:new Date(now()).toISOString(),mode,state,message})}catch(e){logger.warn('AI facts: gagal menyimpan status.')}};
 const target=(guild,cfg)=>{const channel=guild.channels.cache.get(cfg.channelId),me=guild.members?.me;if(!cfg.channelId)throw err('Pilih dan simpan satu channel fakta.');if(!me||channel?.type!==ChannelType.GuildText||!channel.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))throw err('Bot tidak memiliki akses kirim pada channel fakta.',403);return channel};
 async function send(guild,cfg,mode){
  try{
   const channel=target(guild,cfg),ai=typeof foundation==='function'?foundation():foundation;if(!ai||!client.user)throw err('Provider AI belum tersedia.',503);
   const response=await ai.generate({guildId:guild.id,userId:client.user.id,consent:true,kind:'facts',prompt:'Tulis tepat tiga fakta menarik yang berbeda dan umum diketahui dalam bahasa Indonesia. Hindari klaim yang tidak pasti. Jawab HANYA sebagai array JSON berisi tiga string singkat, tanpa markdown, tautan, atau mention.'});
   const facts=parseFacts(response.text,client.user.username);
   const container=createV2Container({title:mode==='test'?'Fakta hari ini — pesan tes':'Fakta hari ini',description:facts.map((x,i)=>`**${i+1}.** ${x}`).join('\n\n'),footer:'Ditulis AI · informasi dapat keliru.',color:'info'});
   await channel.send({...v2Message([container]),allowedMentions:{parse:[]}});
   await status(guild,mode,'sent','Tiga fakta terkirim.');return {sent:1};
  }catch(e){const message=e.status&&e.status<500?e.message:'Gagal membuat atau mengirim fakta. Periksa provider, kuota, format AI dan izin channel.';await status(guild,mode,'failed',message);if(e.status)throw e;throw err(message,503);}
 }
 return {
  async lastStatus(guild){return await kv.get(key(guild.id));},
  async sendNow(guild,cfg){return send(guild,cfg,'test')},
  async run(){try{const guild=client.guilds?.cache?.get(client.homeGuildId);if(!guild)return null;const cfg=(await settings())?.facts,day=digestDue(cfg,now());if(!day)return null;const claim=await kv.update(`ai:facts:sent:${guild.id}`,old=>old?.day===day?undefined:{day});if(!claim)return null;return (await send(guild,cfg,'schedule')).sent;}catch(e){logger.warn(`AI facts: skipped (${e?.status?e.message:'unexpected error'})`);return null;}}
 };
}
