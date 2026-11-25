import {createKV} from './kv.js';

export const DEFAULT_MUSIC_DJ_SETTINGS=Object.freeze({songCount:5,cooldownSeconds:60,smartAutoplay:false});
export function validateMusicDjSettings(value){
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join(',')!=='cooldownSeconds,smartAutoplay,songCount' || !Number.isInteger(value.songCount) || value.songCount<1 || value.songCount>5 || !Number.isInteger(value.cooldownSeconds) || value.cooldownSeconds<30 || value.cooldownSeconds>3600 || typeof value.smartAutoplay!=='boolean') throw Object.assign(new Error('Pengaturan AI DJ tidak valid.'),{status:400});
 return {songCount:value.songCount,cooldownSeconds:value.cooldownSeconds,smartAutoplay:value.smartAutoplay};
}
export function createMusicDjSettingsStore(client,kv=createKV(client)){
 const key=id=>`ai:music-dj:settings:${id}`;
 return {async read(id){const value=await kv.get(key(id));return value===null?{...DEFAULT_MUSIC_DJ_SETTINGS}:validateMusicDjSettings(value)},async save(id,value){const checked=validateMusicDjSettings(value);await kv.set(key(id),checked);return checked}};
}
// Per-process shared cooldown: a provider attempt counts even if it fails.
const lastAttempts=new Map();
export function claimDjCooldown(guildId,seconds,now=Date.now()){
 const previous=lastAttempts.get(guildId);const remaining=previous===undefined?0:Math.ceil((previous+seconds*1000-now)/1000);
 if(remaining>0)throw Object.assign(new Error(`AI DJ sedang cooldown. Coba lagi dalam ${remaining} detik.`),{status:429});
 lastAttempts.set(guildId,now);
}
