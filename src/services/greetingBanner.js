import { AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } from 'discord.js';
import { pgConfig } from '../config/database/postgres.js';
import { sqliteBackend } from './storage/sqlite.js';
import { parseBannerAsset } from './selfRoles/store.js';

const key = (guild, kind) => `guild:${guild}:greeting_banner:${kind}`;
function pool(client) {
 const db=client?.db;
 if(!db||db.getStatus?.().isDegraded||!db.isAvailable?.()||!db.db?.isAvailable?.()||!db.db.pool)throw Error('Database tidak tersedia.');
 return db.db.pool;
}
function validKind(kind) { if(!['welcome','goodbye'].includes(kind))throw Error('Jenis banner tidak valid.'); }
export async function readGreetingBanner(client,guild,kind) {
 validKind(kind);const sqlite=sqliteBackend(client);
 if(sqlite)return parseBannerAsset(sqlite.get(key(guild,kind)));
 const result=await pool(client).query(`SELECT value FROM ${pgConfig.tables.cache_data} WHERE key=$1 AND (expires_at IS NULL OR expires_at > NOW())`,[key(guild,kind)]);
 return parseBannerAsset(result.rows[0]?.value);
}
export async function saveGreetingBanner(client,guild,kind,asset) {
 validKind(kind);const parsed=parseBannerAsset(asset);if(!parsed)throw Error('Banner tidak valid.');
 const value={filename:parsed.filename,mime:parsed.mime,base64:parsed.base64},sqlite=sqliteBackend(client);
 if(sqlite){sqlite.set(key(guild,kind),value);return;}
 await pool(client).query(`INSERT INTO ${pgConfig.tables.cache_data} (key,value,expires_at) VALUES ($1,$2::jsonb,NULL) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,expires_at=NULL`,[key(guild,kind),JSON.stringify(value)]);
}
export async function deleteGreetingBanner(client,guild,kind) {
 validKind(kind);const sqlite=sqliteBackend(client);if(sqlite){sqlite.transaction(tx=>tx.delete(key(guild,kind)));return;}
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
