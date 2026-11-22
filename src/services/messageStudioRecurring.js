// Persistent recurring schedules. A claimed occurrence is never replayed after
// an ambiguous failure; operators must inspect Discord and recreate the schedule.
import crypto from 'node:crypto';
const DAY=86400000, OFFSETS={WIB:7,WITA:8,WIT:9}, MAX=20, GRACE=60000;
const fail=message=>Object.assign(new Error(message),{status:400,code:'MESSAGE_STUDIO_RECURRING_INVALID'});
const safeId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,48}$/.test(x);
export function normalizeRecurrence(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['frequency','time','zone','weekday','day'].includes(k)))throw fail('Jadwal tidak valid.');
 const {frequency,time,zone,weekday,day}=value;
 if(!['daily','weekly','monthly'].includes(frequency)||!Object.hasOwn(OFFSETS,zone)||typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw fail('Frekuensi, jam atau zona waktu tidak valid.');
 if(frequency==='weekly'&&(!Number.isInteger(weekday)||weekday<0||weekday>6))throw fail('Pilih hari mingguan.');
 if(frequency==='monthly'&&(!Number.isInteger(day)||day<1||day>31))throw fail('Tanggal bulanan harus 1–31.');
 if((frequency!=='weekly'&&weekday!==undefined)||(frequency!=='monthly'&&day!==undefined))throw fail('Jadwal tidak valid.');
 return {frequency,time,zone,...(frequency==='weekly'?{weekday}:{}),...(frequency==='monthly'?{day}:{})};
}
export function nextRecurrence(value,after){
 const r=normalizeRecurrence(value);if(!Number.isSafeInteger(after))throw fail('Waktu tidak valid.');
 const offset=OFFSETS[r.zone]*3600000, local=new Date(after+offset), [hour,minute]=r.time.split(':').map(Number);
 const base=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),hour,minute)-offset;
 if(r.frequency==='daily')return base>after?base:base+DAY;
 if(r.frequency==='weekly'){let candidate=base+((r.weekday-local.getUTCDay()+7)%7)*DAY;return candidate>after?candidate:candidate+7*DAY;}
 // Skip months without the requested day, rather than silently changing dates.
 for(let i=0;i<24;i++){const first=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+i,1));const y=first.getUTCFullYear(),m=first.getUTCMonth();const candidate=Date.UTC(y,m,r.day,hour,minute)-offset;if(new Date(Date.UTC(y,m,r.day)).getUTCMonth()===m&&candidate>after)return candidate;}
 throw fail('Tidak dapat menghitung jadwal berikutnya.');
}
export function createStudioRecurring({kv,guildId,now=Date.now,makeToken=()=>crypto.randomBytes(16).toString('hex'),leaseMs=60000}){
 if(!kv?.update||!/^\d{17,20}$/.test(guildId))throw fail('Penyimpanan jadwal tidak tersedia.');
 const key=`message-studio:v1:recurring:${guildId}`;
 const state=raw=>{if(raw===null)return {version:1,jobs:[]};if(raw?.version!==1||!Array.isArray(raw.jobs)||raw.jobs.length>MAX)throw fail('Data jadwal tidak valid.');return raw};
 async function add({id,recurrence,payload}){
  const r=normalizeRecurrence(recurrence),at=now();if(!safeId(id)||!Number.isSafeInteger(at)||!payload||typeof payload!=='object')throw fail('Jadwal tidak valid.');
  const job={id,recurrence:r,payload:structuredClone(payload),runAt:nextRecurrence(r,at),status:'pending',createdAt:at};
  await kv.update(key,raw=>{const s=state(raw);if(s.jobs.length>=MAX)throw fail('Maksimal 20 jadwal berkala.');if(s.jobs.some(j=>j.id===id))throw fail('ID jadwal sudah ada.');s.jobs.push(job);return s});return structuredClone(job);
 }
 async function claim({skipOverdue=false}={}){
  const at=now(),token=makeToken();let claimed=null;
  await kv.update(key,raw=>{const s=state(raw);for(const j of s.jobs){if(j.status==='running'&&j.leaseUntil<=at){j.status='uncertain';delete j.token;delete j.leaseUntil;}if(j.status==='pending'&&(j.runAt<=at-GRACE||(skipOverdue&&j.runAt<at))){j.runAt=nextRecurrence(j.recurrence,at);j.lastResult='skipped';}}
   const j=s.jobs.filter(j=>j.status==='pending'&&j.runAt<=at).sort((a,b)=>a.runAt-b.runAt)[0];if(j){j.status='running';j.token=token;j.leaseUntil=at+leaseMs;claimed=structuredClone(j)}return s});return claimed;
 }
 async function finish(id,token,outcome){
  if(!safeId(id)||!safeId(token)||!['done','failed','uncertain'].includes(outcome))throw fail('Hasil jadwal tidak valid.');let updated=false;const at=now();
  await kv.update(key,raw=>{const s=state(raw),j=s.jobs.find(j=>j.id===id);if(!j||j.status!=='running'||j.token!==token)return undefined;
   const result=j.leaseUntil<=at?'uncertain':outcome;j.lastResult=result;j.lastAttemptAt=at;delete j.token;delete j.leaseUntil;
   if(result==='done'){j.status='pending';j.runAt=nextRecurrence(j.recurrence,at)}else j.status=result;updated=true;return s});return updated;
 }
 async function list(){return state(await kv.get(key)).jobs.map(({token,payload,...j})=>({...structuredClone(j),channelId:payload.channelId,templateName:payload.templateName,sender:payload.sender}));}
 async function remove(id){if(!safeId(id))throw fail('ID jadwal tidak valid.');let removed=false;await kv.update(key,raw=>{const s=state(raw),j=s.jobs.find(j=>j.id===id);if(!j||j.status==='running')return undefined;s.jobs=s.jobs.filter(j=>j.id!==id);removed=true;return s});return removed;}
 return {add,claim,finish,list,remove};
}
export function createStudioRecurringWorker({client,queue,send,intervalMs=5000,onError=()=>{}}){
 let timer=null,current=null,stopped=true,first=true;
 async function run(){if(typeof client.isReady==='function'&&!client.isReady()){first=true;return;}const guild=client.guilds?.cache?.get(client.homeGuildId);if(!guild||!guild.members?.me){first=true;return;}const job=await queue.claim({skipOverdue:first});first=false;if(!job)return;
  let outcome='done';try{const {templateName,...args}=job.payload;await send({guild,...args});}catch{outcome='uncertain';}await queue.finish(job.id,job.token,outcome);
 }
 function tick(){if(stopped||current)return current;current=run().catch(()=>{try{onError()}catch{}}).finally(()=>{current=null});return current;}
 return {start(){if(!stopped)return;stopped=false;first=true;timer=setInterval(tick,intervalMs);timer.unref?.();tick()},async stop(){stopped=true;if(timer)clearInterval(timer);timer=null;if(current)await current},tick};
}
