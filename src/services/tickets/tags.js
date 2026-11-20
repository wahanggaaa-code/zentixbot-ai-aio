import {getTicketData,saveTicketData} from '../../utils/database.js';
import {appendTicketActivity} from './activity.js';
const idPattern=/^\d{17,20}$/;
export function validateTicketTags(value){
 if(!Array.isArray(value)||value.length>5)throw Error('Maksimal 5 tag.');
 const seen=new Set();return value.map(tag=>{
  if(typeof tag!=='string'||!tag.trim()||tag.length>24||/[,\u0000-\u001f\u007f]/.test(tag))throw Error('Tag harus 1–24 karakter, tanpa koma atau karakter kontrol.');
  const cleaned=tag.trim(),key=cleaned.toLocaleLowerCase();if(seen.has(key))throw Error('Tag duplikat tidak diperbolehkan.');seen.add(key);return cleaned;
 });
}
export async function updateTicketTags(guildId,channelId,actorId,tags,expectedTags){
 if(!idPattern.test(guildId||'')||!idPattern.test(channelId||'')||!idPattern.test(actorId||''))throw Object.assign(Error('ID tidak valid.'),{code:'TICKET_TAG_INVALID'});
 const normalized=validateTicketTags(tags),expected=validateTicketTags(expectedTags);
 const record=await getTicketData(guildId,channelId);if(!record)throw Object.assign(Error('Tiket tidak ditemukan.'),{code:'TICKET_TAG_NOT_FOUND'});
 let current;try{current=validateTicketTags(record.tags??[])}catch{throw Object.assign(Error('Tag tersimpan tidak valid; perlu diperiksa.'),{code:'TICKET_TAG_INVALID_STORED'})}
 if(JSON.stringify(expected)!==JSON.stringify(current))throw Object.assign(Error('Tag berubah. Muat ulang tiket.'),{code:'TICKET_STALE'});
 record.tags=normalized;record.tagsUpdatedAt=new Date().toISOString();record.tagsUpdatedBy=actorId;
 appendTicketActivity(record,{type:'tags',actorId,at:record.tagsUpdatedAt});
 await saveTicketData(guildId,channelId,record);return normalized;
}
