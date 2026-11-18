import {createKV} from './kv.js';
export const SEARCH_PROVIDERS=Object.freeze({tavily:{label:'Tavily',key:'AI_TAVILY_API_KEY'},parallel:{label:'Parallel',key:'AI_PARALLEL_API_KEY'},exa:{label:'Exa',key:'AI_EXA_API_KEY'}});
export const DEFAULT_SEARCH=Object.freeze({primary:'tavily',backup:'parallel',backup2:'exa'});
const invalid=()=>Object.assign(Error('Urutan provider pencarian tidak valid; pilih provider yang berbeda.'),{status:400});
export function validateSearchSettings(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='backup,backup2,primary'||!Object.hasOwn(SEARCH_PROVIDERS,v.primary)||![v.backup,v.backup2].every(x=>x==='none'||Object.hasOwn(SEARCH_PROVIDERS,x)))throw invalid();
 const ids=[v.primary,v.backup,v.backup2].filter(x=>x!=='none');if(new Set(ids).size!==ids.length)throw invalid();return {...v};
}
export function createSearchSettingsStore(client,kv=createKV(client)){
 const key=id=>`ai:search:settings:${id}`;
 return {async read(id){const value=await kv.get(key(id));return value===null?{...DEFAULT_SEARCH}:validateSearchSettings(value)},async save(id,value){const cfg=validateSearchSettings(value);await kv.set(key(id),cfg);return cfg}};
}
