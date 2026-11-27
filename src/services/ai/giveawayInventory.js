// Read a bounded, anonymous inventory. No prize, participant, channel, message,
// host or delivery token is included in the returned summary.
import {pgConfig} from '../../config/database/postgres.js';
import {listSQLiteGiveawayRows} from '../storage/postgresGiveawayTransactions.js';

const bad=(message,status=503)=>Object.assign(new Error(message),{status});
const LIMIT=100;
function flags(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return {status:'unknown',pending:null,deleting:null};
 const a=data.ended,b=data.isEnded;
 // The giveaway writer requires both flags and they must agree. This is not
 // full record validation; all other potentially private fields stay excluded.
 const valid=typeof a==='boolean'&&typeof b==='boolean'&&a===b;
 const delivery=data.deliveryStatus;
 const pending=delivery==null?false:delivery==='pending'?true:delivery==='delivered'?false:null;
 return {status:valid?(a===true||b===true?'ended':'active'):'unknown',pending,deleting:data.deletion!==undefined};
}
export async function readGiveawayInventory(client,guildId){
 if(!/^\d{17,20}$/.test(guildId||'')||client?.homeGuildId!==guildId)throw bad('Server tidak valid.',403);
 let rows,legacyDetected=false;
 const sqlite=listSQLiteGiveawayRows(client,guildId);
 if(sqlite)rows=sqlite.slice(0,LIMIT+1).map(row=>flags(row.data));
 else{
  const db=client?.db,status=db?.getStatus?.();if(status?.connectionType!=='postgresql'||status.isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool?.connect)throw bad('Database persisten tidak tersedia.');
  const conn=await db.db.pool.connect();try{
   await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await conn.query("SET LOCAL statement_timeout = '10s'");
   const key=`guild:${guildId}:giveaways`;
   legacyDetected=(await conn.query(`SELECT 1 FROM ${pgConfig.tables.temp_data} WHERE key=$1 UNION ALL SELECT 1 FROM ${pgConfig.tables.cache_data} WHERE key=$1 LIMIT 1`,[key])).rows.length>0;
   // Limit stored JSON before extracting booleans; all arbitrary strings remain server-side.
   const result=await conn.query(`SELECT CASE WHEN octet_length(data::text)<=262144 THEN data->'ended' END AS ended, CASE WHEN octet_length(data::text)<=262144 THEN (data ? 'ended') ELSE false END AS "hasEnded", CASE WHEN octet_length(data::text)<=262144 THEN data->'isEnded' END AS "isEnded", CASE WHEN octet_length(data::text)<=262144 THEN (data ? 'isEnded') ELSE false END AS "hasIsEnded", CASE WHEN octet_length(data::text)>262144 OR jsonb_typeof(data)<>'object' THEN NULL WHEN data->'deliveryStatus' IS NULL OR data->'deliveryStatus'='null'::jsonb THEN false WHEN data->>'deliveryStatus'='pending' AND jsonb_typeof(data->'deliveryStatus')='string' THEN true WHEN data->>'deliveryStatus'='delivered' AND jsonb_typeof(data->'deliveryStatus')='string' THEN false ELSE NULL END AS pending, CASE WHEN octet_length(data::text)<=262144 AND jsonb_typeof(data)='object' THEN (data ? 'deletion') ELSE NULL END AS deleting FROM ${pgConfig.tables.giveaways} WHERE guild_id=$1 ORDER BY message_id COLLATE "C" LIMIT 101`,[guildId]);
   rows=result.rows.map(row=>{const f=flags({ended:row.hasEnded?row.ended:undefined,isEnded:row.hasIsEnded?row.isEnded:undefined});return {...f,pending:typeof row.pending==='boolean'?row.pending:null,deleting:typeof row.deleting==='boolean'?row.deleting:null}});
   await conn.query('COMMIT');
  }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e}finally{conn.release()}
 }
 const sample=rows.slice(0,LIMIT);
 return {sampleSize:sample.length,truncated:rows.length>LIMIT,legacyDetected,activeCount:sample.filter(x=>x.status==='active').length,endedCount:sample.filter(x=>x.status==='ended').length,unknownStatusCount:sample.filter(x=>x.status==='unknown').length,pendingDeliveryCount:sample.filter(x=>x.pending===true).length,unknownDeliveryCount:sample.filter(x=>x.pending===null).length,deletionMarkedCount:sample.filter(x=>x.deleting===true).length,unknownDeletionMarkerCount:sample.filter(x=>x.deleting===null).length};
}
