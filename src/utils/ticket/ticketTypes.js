import {createHash} from 'node:crypto';

// IDs identify fixed dashboard slots. They never derive from user-provided labels.
export function validateTicketTypes(value) {
  if (!Array.isArray(value) || value.length > 3) throw new Error('Maksimal tiga jenis tiket.');
  const ids=new Set(),names=new Set();
  return value.map(item=>{
    if (!item || typeof item!=='object' || Array.isArray(item) || Object.keys(item).some(k=>!['id','name','questions','categoryId'].includes(k)) || !['id','name','questions'].every(k=>Object.hasOwn(item,k)) || typeof item.id!=='string' || !/^[1-3]$/.test(item.id) || ids.has(item.id)) throw new Error('Jenis tiket tidak valid.');
    if (typeof item.name!=='string' || !item.name.trim() || item.name.length>60 || /[\r\n\u0000-\u001f]/.test(item.name)) throw new Error('Nama jenis harus 1–60 karakter dalam satu baris.');
    const name=item.name.trim(), key=name.toLocaleLowerCase();if(names.has(key))throw new Error('Nama jenis tiket harus berbeda.');
    if(!Array.isArray(item.questions) || item.questions.length<1 || item.questions.length>3 || item.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>45||/[\r\n\u0000-\u001f]/.test(q)))throw new Error('Setiap jenis perlu 1–3 pertanyaan, maksimal 45 karakter per pertanyaan.');
    if(item.categoryId!=null&&(typeof item.categoryId!=='string'||!/^\d{17,20}$/.test(item.categoryId)))throw new Error('Kategori jenis tiket tidak valid.');
    ids.add(item.id);names.add(key);return {id:item.id,name,questions:item.questions.map(q=>q.trim()),...(item.categoryId?{categoryId:item.categoryId}:{})};
  });
}
export function ticketTypesFromConfig(config) {
  if (config.ticketTypes == null) return [];
  return validateTicketTypes(config.ticketTypes);
}
export function ticketTypesRevision(types) {return createHash('sha256').update(JSON.stringify(types)).digest('hex').slice(0,16)}
