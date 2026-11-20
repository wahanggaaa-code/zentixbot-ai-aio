import {createHash} from 'node:crypto';
export function validateQuickReplies(value){
 if(!Array.isArray(value)||value.length>5)throw Error('Maksimal 5 jawaban cepat.');
 const ids=new Set(),names=new Set();return value.map(item=>{
  if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).sort().join(',')!=='id,name,text'||typeof item.id!=='string'||!/^[1-5]$/.test(item.id)||ids.has(item.id))throw Error('Data jawaban cepat tidak valid.');
  if(typeof item.name!=='string'||!item.name.trim()||item.name.length>40||/[\u0000-\u001f\u007f]/.test(item.name))throw Error('Nama jawaban harus 1–40 karakter dalam satu baris.');
  if(typeof item.text!=='string'||!item.text.trim()||item.text.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item.text))throw Error('Isi jawaban harus 1–500 karakter.');
  const name=item.name.trim(),key=name.toLocaleLowerCase();if(names.has(key))throw Error('Nama jawaban harus berbeda.');ids.add(item.id);names.add(key);return {id:item.id,name,text:item.text.trim()};
 });
}
export function quickRepliesFromConfig(config){return config.ticketQuickReplies==null?[]:validateQuickReplies(config.ticketQuickReplies)}
export function quickRepliesRevision(replies){return createHash('sha256').update(JSON.stringify(replies)).digest('hex').slice(0,16)}
