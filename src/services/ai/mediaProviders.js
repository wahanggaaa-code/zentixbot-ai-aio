import {createKV} from './kv.js';
import {resolveAudioProvider,resolveImageProvider} from './extraProviders.js';
const bad=()=>Object.assign(new Error('Pengaturan provider tidak valid.'),{status:400});
const model=/^[\w.@/-]{0,100}$/;
export function validateMediaSettings(kind,v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw bad();
 if(kind==='audio'){
  if(Object.keys(v).sort().join(',')!=='backup,backupModel,primary,primaryModel'||!['groq','openai'].includes(v.primary)||!['none','groq','openai'].includes(v.backup)||v.backup===v.primary||typeof v.primaryModel!=='string'||typeof v.backupModel!=='string'||!model.test(v.primaryModel)||!model.test(v.backupModel)||(v.backup==='none'&&v.backupModel!==''))throw bad();
  for(const m of [v.primaryModel,v.backupModel])if(m&&!/^[\w.-]{1,100}$/.test(m))throw bad();
  return {...v};
 }
 if(kind==='image'){
  if(Object.keys(v).sort().join(',')!=='model,provider'||!['openai','cloudflare','pollinations'].includes(v.provider)||typeof v.model!=='string'||!model.test(v.model))throw bad();
  if(v.provider==='openai'&&v.model&&!/^[\w.-]{1,100}$/.test(v.model))throw bad();
  if(v.provider==='cloudflare'&&v.model&&!/^@cf\/[a-z0-9][a-z0-9.-]{0,60}\/[a-z0-9][a-z0-9.-]{0,60}$/.test(v.model))throw bad();
  if(v.provider==='pollinations'&&v.model)throw bad();return {...v};
 }
 throw bad();
}
export function createMediaSettingsStore(client,kv=createKV(client)){
 const key=(id,kind)=>`ai:media-provider:${kind}:${id}`;
 return {async read(id,kind){const v=await kv.get(key(id,kind));return v===null?null:validateMediaSettings(kind,v)},async save(id,kind,v){const checked=validateMediaSettings(kind,v);await kv.set(key(id,kind),checked);return checked}};
}
export function legacySettings(kind,env){
 if(kind==='audio'){const p=resolveAudioProvider(env);if(p.unknown)throw Object.assign(new Error('AI_AUDIO_PROVIDER tidak dikenal. Periksa konfigurasi server.'),{status:400});return {primary:p.id,primaryModel:String(env.AI_AUDIO_MODEL||'').trim(),backup:'none',backupModel:''}}
 const p=resolveImageProvider(env);if(p.unknown)throw Object.assign(new Error('AI_IMAGE_PROVIDER tidak dikenal. Periksa konfigurasi server.'),{status:400});return {provider:p.id,model:p.id==='pollinations'?'':String(env.AI_IMAGE_MODEL||'').trim()};
}
export function mediaEnv(env,kind,provider,model){return {...env,...(kind==='audio'?{AI_AUDIO_PROVIDER:provider,AI_AUDIO_MODEL:model}:{AI_IMAGE_PROVIDER:provider,AI_IMAGE_MODEL:model})}}
export function mediaCredentials(env){return {audio:{groq:Boolean(String(env.AI_GROQ_API_KEY||'').trim()),openai:Boolean(String(env.AI_AUDIO_API_KEY||'').trim())},image:{openai:Boolean(String(env.AI_IMAGE_API_KEY||'').trim()),cloudflare:Boolean(String(env.AI_CLOUDFLARE_API_TOKEN||'').trim()&&/^[a-f0-9]{32}$/i.test(String(env.AI_CLOUDFLARE_ACCOUNT_ID||'').trim())),pollinations:true}}}
