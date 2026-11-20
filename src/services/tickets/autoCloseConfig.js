import {createHash,randomUUID} from 'node:crypto';
const DEFAULT={enabled:false,idleMinutes:1440,warningMinutes:1440,epoch:null,enabledAt:null};
export function readAutoCloseConfig(config){
 const value=config.ticketAutoClose;
 if(value==null)return {...DEFAULT};
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.enabled!=='boolean'||!Number.isInteger(value.idleMinutes)||value.idleMinutes<60||value.idleMinutes>43200||!Number.isInteger(value.warningMinutes)||value.warningMinutes<60||value.warningMinutes>10080||(value.enabled&&(!/^[0-9a-f-]{36}$/.test(value.epoch||'')||!Number.isFinite(Date.parse(value.enabledAt)))))throw Error('Konfigurasi auto-close tidak valid.');
 return {enabled:value.enabled,idleMinutes:value.idleMinutes,warningMinutes:value.warningMinutes,epoch:value.epoch??null,enabledAt:value.enabledAt??null};
}
export function autoCloseRevision(settings){return createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0,16)}
export function newAutoCloseConfig(enabled,idleMinutes,warningMinutes){
 return {enabled,idleMinutes,warningMinutes,epoch:enabled?randomUUID():null,enabledAt:enabled?new Date().toISOString():null};
}
