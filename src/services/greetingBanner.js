import { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { pgConfig } from '../config/database/postgres.js';
import { sqliteBackend } from './storage/sqlite.js';
import { parseBannerAsset } from './selfRoles/store.js';

const key = (guild, kind) => `guild:${guild}:greeting_banner:${kind}`;
// Keep each SQLite JSON value below its 2 MiB limit. The metadata and chunks
// are replaced together in one transaction; old single-row assets remain readable.
const CHUNK_SIZE = 1024 * 1024, MAX_CHUNKS = 7;
const chunkKey = (guild,kind,index) => `${key(guild,kind)}:part:${index}`;
function pool(client) {
 const db=client?.db;
 if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw Error('Database tidak tersedia.');
 return db.db.pool;
}
function validKind(kind) { if(!['welcome','goodbye'].includes(kind))throw Error('Jenis banner tidak valid.'); }
export async function readGreetingBanner(client,guild,kind) {
 validKind(kind);const sqlite=sqliteBackend(client);
 if(sqlite)return sqlite.transaction(tx=>{
  const row=tx.get(key(guild,kind));
  if(!row?.chunks)return parseBannerAsset(row);
  if(!Number.isInteger(row.chunks)||row.chunks<1||row.chunks>MAX_CHUNKS)return null;
  const parts=[];for(let i=0;i<row.chunks;i++){const part=tx.get(chunkKey(guild,kind,i));if(typeof part!=='string')return null;parts.push(part)}
  return parseBannerAsset({...row,base64:parts.join('')});
 });
 const result=await pool(client).query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1 AND (expires_at IS NULL OR expires_at > NOW())`,[key(guild,kind)]);
 return parseBannerAsset(result.rows[0]?.value);
}
export async function saveGreetingBanner(client,guild,kind,asset) {
 validKind(kind);const parsed=parseBannerAsset(asset);if(!parsed)throw Error('Banner tidak valid.');
 const value={filename:parsed.filename,mime:parsed.mime,base64:parsed.base64},sqlite=sqliteBackend(client);
 if(sqlite){sqlite.transaction(tx=>{
  for(let i=0;i<MAX_CHUNKS;i++)tx.delete(chunkKey(guild,kind,i));
  const parts=value.base64.match(new RegExp(`.{1,${CHUNK_SIZE}}`,'g'))||[];
  if(!parts.length||parts.length>MAX_CHUNKS)throw Error('Banner terlalu besar.');
  parts.forEach((part,i)=>tx.set(chunkKey(guild,kind,i),part));
  tx.set(key(guild,kind),{filename:value.filename,mime:value.mime,chunks:parts.length});
 });return;}
 await pool(client).query(`INSERT INTO ${pgConfig.tables.cache_data} (key,value,expires_at) VALUES ($1,$2::jsonb,NULL) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,expires_at=NULL`,[key(guild,kind),JSON.stringify(value)]);
}
export async function deleteGreetingBanner(client,guild,kind) {
 validKind(kind);const sqlite=sqliteBackend(client);if(sqlite){sqlite.transaction(tx=>{tx.delete(key(guild,kind));for(let i=0;i<MAX_CHUNKS;i++)tx.delete(chunkKey(guild,kind,i))});return;}
 await pool(client).query(`DELETE FROM ${pgConfig.tables.cache_data} WHERE key=$1`,[key(guild,kind)]);
}
// Call only on a freshly built container; uploaded banner takes precedence over the URL.
export function attachGreetingBanner(payload,asset) {
 if(!asset)return payload;
 payload.components[0].addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${asset.filename}`)));
 payload.files=[new AttachmentBuilder(asset.buffer,{name:asset.filename})];
 return payload;
}
export function withoutGreetingImage(config,kind) {
 return kind==='welcome'?{...config,welcomeImage:null,welcomeEmbed:{...config.welcomeEmbed,image:null}}:{...config,leaveEmbed:{...config.leaveEmbed,image:null}};
}
