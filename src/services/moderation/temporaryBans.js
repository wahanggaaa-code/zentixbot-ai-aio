import {randomUUID} from 'node:crypto';
import {PermissionFlagsBits} from 'discord.js';
import {pgConfig} from '../../config/database/postgres.js';
import {sqliteBackend} from '../storage/sqlite.js';
import {logger} from '../../utils/logger.js';
import {createV2Container,v2Message} from '../../utils/componentsV2.js';

const snowflake=/^\d{17,20}$/;
const token=/^[a-f0-9-]{36}$/;
const storeKey=guildId=>`automod:temporary-bans:${guildId}`;
const reasonFor=id=>`Zentix AutoMod temporary ban ${id}`;
function validate(records){
 if(!Array.isArray(records)||records.length>500||records.some(r=>!r||!snowflake.test(r.userId||'')||!token.test(r.id||'')||!Number.isSafeInteger(r.due)||r.due<=0||!Number.isSafeInteger(r.leaseUntil)||r.leaseUntil<0||typeof r.lease!=='string'||(r.lease&&!token.test(r.lease))))throw Error('Jadwal ban sementara rusak');return records;
}
export function createTemporaryBanStore(client,guildId){
 if(!snowflake.test(guildId||''))throw Error('Server tidak valid');const key=storeKey(guildId),sqlite=sqliteBackend(client);
 async function mutate(fn){
  if(sqlite)return sqlite.transaction(tx=>{const records=validate(tx.get(key)??[]),out=fn(records);tx.set(key,records);return out});
  const wrapper=client?.db;if(!wrapper||wrapper.getStatus?.().isDegraded||!wrapper.isAvailable?.()||!wrapper.db?.isAvailable?.()||!wrapper.db.pool)throw Error('Database tidak tersedia');
  const conn=await wrapper.db.pool.connect();try{await conn.query('BEGIN');await conn.query('SELECT pg_advisory_xact_lock(hashtext($1))',[key]);const row=await conn.query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1 FOR UPDATE`,[key]);const records=validate(row.rows[0]?.value??[]),out=fn(records);await conn.query(`INSERT INTO ${pgConfig.tables.cache_data}(key,value,expires_at) VALUES($1,$2::jsonb,NULL) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,expires_at=NULL`,[key,JSON.stringify(records)]);await conn.query('COMMIT');return out}catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release()}
 }
 return {
  async schedule(userId,due){if(!snowflake.test(userId||'')||!Number.isSafeInteger(due)||due<=Date.now())throw Error('Jadwal ban sementara tidak valid');return mutate(records=>{if(records.length>=500||records.some(r=>r.userId===userId))throw Error('Jadwal ban anggota sudah ada atau penuh');const record={id:randomUUID(),userId,due,lease:'',leaseUntil:0};records.push(record);return record})},
  async claim(now){return mutate(records=>{const r=records.find(x=>x.due<=now&&x.leaseUntil<=now);if(!r)return null;r.lease=randomUUID();r.leaseUntil=now+120000;return {...r}})},
  async finish(record){return mutate(records=>{const i=records.findIndex(r=>r.id===record.id&&r.lease===record.lease);if(i<0)return false;records.splice(i,1);return true})},
  async release(record){return mutate(records=>{const r=records.find(r=>r.id===record.id&&r.lease===record.lease);if(!r)return false;r.lease='';r.leaseUntil=0;return true})}
 };
}
// Discord has no atomic compare-and-unban. Compare its stored ban reason immediately before unbanning;
// a concurrent external ban change between those two API calls cannot be fully excluded.
export async function runTemporaryBans({store,guild,notify=async()=>{},now=Date.now()}){
 let handled=0;for(let i=0;i<20;i++){
  const task=await store.claim(now);if(!task)break;
  try{
   if(!guild.members.me?.permissions?.has(PermissionFlagsBits.BanMembers))throw Error('Izin Ban Members tidak tersedia');
   let ban;try{ban=await guild.bans.fetch(task.userId)}catch(e){if(e?.code===10026||e?.rawError?.code===10026){await store.finish(task);continue}throw e}
   if(ban.reason!==reasonFor(task.id)){await store.finish(task);await notify(`Ban ${task.userId} berubah atau bukan ban sementara Zentix; tidak dibuka otomatis.`).catch(()=>{});continue}
   await guild.members.unban(task.userId,'Zentix: durasi ban sementara selesai');await store.finish(task);handled++;await notify(`Ban sementara ${task.userId} selesai dan telah dibuka.`).catch(()=>{});
  }catch(e){await store.release(task).catch(()=>{});logger.warn('Ban sementara: pemeriksaan gagal; akan dicoba lagi.');break}
 }return handled;
}
export async function scheduleTemporaryBan(client,guild,userId,minutes){
 if(!Number.isInteger(minutes)||minutes<1||minutes>40320)throw Error('Durasi ban sementara tidak valid');
 // Never repurpose a pre-existing ban: that could cause an unrelated permanent ban to be removed.
 if(!guild.bans?.fetch)throw Error('Pemeriksaan ban tidak tersedia');
 try{await guild.bans.fetch(userId);throw Error('Anggota sudah diban; ban sementara tidak dibuat')}catch(e){if(e?.code!==10026&&e?.rawError?.code!==10026)throw e}
 const record=await createTemporaryBanStore(client,guild.id).schedule(userId,Date.now()+minutes*60000);return {reason:reasonFor(record.id)};
}
export function startTemporaryBanWorker(client,{interval=30000}={}){
 let running=false;const tick=async()=>{if(running)return;running=true;try{const guild=client.guilds.cache.get(client.homeGuildId);if(!guild)return;const store=createTemporaryBanStore(client,guild.id);await runTemporaryBans({store,guild,notify:async text=>{
  const {createAutomodStore}=await import('./automod.js');const config=(await createAutomodStore(client).read(guild.id)).settings,channel=guild.channels.cache.get(config.logChannelId),me=guild.members.me;if(!channel?.send||!me||!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages]))return;
  await channel.send({...v2Message([createV2Container({title:'AutoMod · Ban sementara',description:text,color:'warning'})]),allowedMentions:{parse:[]}});
 }});}catch{logger.warn('Ban sementara: worker tidak tersedia; akan dicoba lagi.')}finally{running=false}};
 const timer=setInterval(tick,interval);timer.unref?.();void tick();return {stop:()=>clearInterval(timer),tick};
}
