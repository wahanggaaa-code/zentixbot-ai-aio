import { createKV } from './kv.js';
const id = /^\d{17,20}$/;
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const empty = () => ({ enabled:false, items:[] });
function validate(row) {
 if (row === null) return empty();
 if (!row || typeof row !== 'object' || typeof row.enabled !== 'boolean' || !Array.isArray(row.items) || row.items.length > 10 || row.items.some(x=>typeof x!=='string'||!x.trim()||x.length>120)) throw fail('Memori tidak tersedia.',503);
 return {enabled:row.enabled,items:[...row.items]};
}
/** Explicit, user-controlled DM memory. No automatic extraction from messages. */
export function createLongTermMemory(client,kv=createKV(client)) {
 const key=(guildId,userId)=>{if(guildId!==client.homeGuildId||!id.test(guildId||'')||!id.test(userId||''))throw fail('Akses memori tidak valid.',403);return `ai:member-memory:${guildId}:${userId}`;};
 return {
  async read(guildId,userId) { return validate(await kv.get(key(guildId,userId))); },
  async enable(guildId,userId) { return kv.update(key(guildId,userId),current=>({...validate(current),enabled:true})); },
  async disable(guildId,userId) { return kv.update(key(guildId,userId),()=>empty()); },
  async clear(guildId,userId) { return kv.update(key(guildId,userId),current=>({...validate(current),items:[]})); },
  async add(guildId,userId,value) {
   if(typeof value!=='string'||!value.trim()||value.length>120||/[\x00-\x1f\x7f]/.test(value))throw fail('Memori harus 1–120 karakter dalam satu baris.');
   return kv.update(key(guildId,userId),current=>{const row=validate(current);if(!row.enabled)throw fail('Aktifkan memori dulu dengan !memori aktif.',403);if(row.items.length>=10)throw fail('Memori penuh (maksimal 10). Hapus dulu dengan !memori hapus.');return {...row,items:[...row.items,value.trim()]};});
  },
  async remove(guildId,userId,index) { return kv.update(key(guildId,userId),current=>{const row=validate(current);if(!Number.isInteger(index)||index<1||index>row.items.length)throw fail('Nomor memori tidak ditemukan.');row.items.splice(index-1,1);return row;}); }
 };
}
