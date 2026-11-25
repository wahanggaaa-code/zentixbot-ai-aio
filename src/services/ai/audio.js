import {readDiscordAttachment} from './attachments.js';
import {validateSettings} from './foundation.js';
import {resolveAudioProvider} from './extraProviders.js';
import {createMediaSettingsStore,mediaEnv} from './mediaProviders.js';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const MAX_AUDIO=2*1024*1024;
let active=0;
function audioType(data){
 if(data.subarray(0,4).toString()==='OggS')return ['audio/ogg','ogg'];
 if(data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WAVE')return ['audio/wav','wav'];
 if(data.subarray(0,3).toString()==='ID3'||data.length>2&&data[0]===255&&(data[1]&0xe0)===0xe0)return ['audio/mpeg','mp3'];
 if(data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return ['audio/webm','webm'];
 if(data.length>12&&data.subarray(4,8).toString()==='ftyp')return ['audio/mp4','m4a'];
 if(data.subarray(0,4).toString()==='fLaC')return ['audio/flac','flac'];
 throw error('Format audio tidak didukung.');
}
async function readJSON(response){
 if(!response.body)throw error('Respons transkripsi tidak valid.',502);const reader=response.body.getReader(),parts=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>32768)throw error('Respons transkripsi terlalu besar.',502);parts.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw error('Respons transkripsi tidak valid.',502)}
}
export function createAudioService({client,foundation=client.aiFoundation,env=process.env,fetchImpl=globalThis.fetch,download=readDiscordAttachment}={}){
 return {async transcribe({guildId,userId,attachment,consent}){
  if(guildId!==client.homeGuildId||!/^\d{17,20}$/.test(userId||''))throw error('Akses server tidak valid.',403);
  if(consent!==true)throw error('Persetujuan audio diperlukan.',403);
  // OpenAI unless AI_AUDIO_PROVIDER names another provider; an unknown name or a missing key keeps the feature off.
  const saved=client.db?await createMediaSettingsStore(client).read(guildId,'audio'):null;
  const providers=saved?[resolveAudioProvider(mediaEnv(env,'audio',saved.primary,saved.primaryModel)),...(saved.backup==='none'?[]:[resolveAudioProvider(mediaEnv(env,'audio',saved.backup,saved.backupModel))])]:[resolveAudioProvider(env)];
  const available=providers.filter(p=>!p.unknown&&!p.missing.length);
  if(!available.length)throw error('Kredensial/model audio belum dikonfigurasi.',503);
  if(active>=2)throw error('Transkripsi sedang sibuk.',429);active++;
  try{
   const cfg=validateSettings(await foundation.store.read(guildId));if(!cfg.enabled||!cfg.providerDataConsent)throw error('AI belum diaktifkan.',403);
   const data=await download(attachment,MAX_AUDIO,fetchImpl);const [mime,extension]=audioType(data);
   await foundation.store.reserve(guildId,userId,cfg);
   for(const provider of available){
    const body=new FormData();body.append('model',provider.model);body.append('file',new Blob([data],{type:mime}),`audio.${extension}`);
    let response;try{response=await fetchImpl(provider.url,{method:'POST',headers:{Authorization:`Bearer ${provider.key}`},body,redirect:'error',signal:AbortSignal.timeout(60000)})}catch{continue}
    if(!response.ok){const status=response.status;await response.body?.cancel().catch(()=>{});if([401,403,404,408,429].includes(status)||status>=500)continue;throw error('Provider menolak audio; periksa format dan isi file.',400)}
    let result;try{result=await readJSON(response)}catch{continue}
    if(typeof result.text==='string'&&result.text.trim()&&result.text.length<=1500)return result.text.trim();
    // A valid empty transcript is not a provider outage; do not resend private audio.
    if(typeof result.text==='string')throw error('Transkripsi kosong atau lebih dari 1500 karakter.',502);
   }
   throw error('Provider transkripsi tidak tersedia.',502);
  }finally{active--;}
 }};
}
