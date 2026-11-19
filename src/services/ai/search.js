import {createSearchSettingsStore,SEARCH_PROVIDERS} from './searchSettings.js';
const error=(message,status=400)=>Object.assign(new Error(message),{status});

async function readJSON(response){
 const reader=response.body?.getReader();if(!reader)throw error('Respons pencarian tidak valid.',502);let size=0,chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288)throw error('Respons pencarian terlalu besar.',502);chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{})}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw error('Respons pencarian tidak valid.',502)}
}

// Tavily: POST with a bearer key. Items carry title, url and content; "basic" depth costs one credit.
// Request and response fields follow https://docs.tavily.com/documentation/api-reference/endpoint/search
async function tavily({key,query,fetchImpl}){
 const body=JSON.stringify({query,search_depth:'basic',max_results:5,chunks_per_source:1,safe_search:true,include_answer:false,include_raw_content:false,include_images:false});
 const r=await fetchImpl('https://api.tavily.com/search',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${key}`},body,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok){
  await r.body?.cancel().catch(()=>{});
  if(r.status===401)throw error('Tavily menolak kunci API. Periksa AI_TAVILY_API_KEY.',502);
  if([429,432,433].includes(r.status))throw error('Batas laju atau kuota Tavily tercapai.',429);
  throw error('Pencarian tidak tersedia.',503);
 }
 const data=await readJSON(r);if(!Array.isArray(data?.results))throw error('Respons Tavily tidak valid.',502);return data.results.map(item=>({title:item?.title,url:item?.url,description:item?.content}));
}

// Fixed endpoints and provider-specific credentials; redirects are refused.
async function exa({key,query,fetchImpl}){
 const r=await fetchImpl('https://api.exa.ai/search',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','x-api-key':key},body:JSON.stringify({query,type:'auto',numResults:5,contents:{highlights:true}}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok){await r.body?.cancel().catch(()=>{});throw error('Exa tidak tersedia.',503)}
 const data=await readJSON(r);if(!Array.isArray(data?.results))throw error('Respons Exa tidak valid.',502);
 return data.results.map(item=>({title:item?.title,url:item?.url,description:Array.isArray(item?.highlights)?item.highlights.filter(x=>typeof x==='string').join(' '):item?.text}));
}
async function parallel({key,query,fetchImpl}){
 const keywords=query.trim().split(/\s+/u).slice(0,12).join(' ');
 const r=await fetchImpl('https://api.parallel.ai/v1/search',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json','x-api-key':key},body:JSON.stringify({objective:`Cari sumber web yang relevan untuk: ${query}`,search_queries:[keywords],mode:'fast',advanced_settings:{max_results:5}}),redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok){await r.body?.cancel().catch(()=>{});throw error('Parallel tidak tersedia.',503)}
 const data=await readJSON(r);if(!Array.isArray(data?.results))throw error('Respons Parallel tidak valid.',502);
 return data.results.map(item=>({title:item?.title,url:item?.url,description:Array.isArray(item?.excerpts)?item.excerpts.filter(x=>typeof x==='string').join(' '):undefined}));
}
const callers={tavily,parallel,exa};
export function createSearchService({client,foundation=client.aiFoundation,env=process.env,fetchImpl=globalThis.fetch,store=createSearchSettingsStore(client)}){
 let active=0;
 const credentials=()=>Object.fromEntries(Object.entries(SEARCH_PROVIDERS).map(([id,p])=>[id,Boolean(env[p.key]?.trim())]));
 return {store,credentials,async status(guildId){const settings=await store.read(guildId),keys=credentials();return {settings,credentials:keys,configured:[settings.primary,settings.backup,settings.backup2].some(id=>keys[id])};},async search({guildId,userId,query,consent}){
  if(guildId!==client.homeGuildId||!/^\d{17,20}$/.test(userId||'')||consent!==true)throw error('Server atau persetujuan tidak valid.',403);
  if(typeof query!=='string'||!query.trim()||query.length>300)throw error('Kata kunci harus 1–300 karakter.');
  if(active>=2)throw error('Pencarian sedang sibuk.',429);active++;
  try{
   const settings=await store.read(guildId);const chain=[settings.primary,settings.backup,settings.backup2].filter(id=>id!=='none'&&env[SEARCH_PROVIDERS[id].key]?.trim());
   if(!chain.length)throw error('Kunci provider pencarian belum dikonfigurasi.',503);
   const cfg=await foundation.store.read(guildId);if(!cfg.enabled||!cfg.providerDataConsent)throw error('Fondasi AI belum aktif atau disetujui.',403);await foundation.store.reserve(guildId,userId,cfg);
   let lastEmpty=null;
   for(const id of chain){
    try{
     const items=await callers[id]({key:env[SEARCH_PROVIDERS[id].key].trim(),query:query.trim(),fetchImpl});
     const results=[];for(const item of items){if(results.length>=5)break;try{const u=new URL(item.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;if(typeof item.title!=='string'||typeof item.description!=='string'||!item.title.trim()||!item.description.trim())continue;results.push({title:item.title.slice(0,200),url:u.href,description:item.description.slice(0,500)})}catch{}}
     const response={results,provider:SEARCH_PROVIDERS[id].label,usedFallback:id!==settings.primary};
     if(results.length)return response;
     lastEmpty=response; // A valid but empty response may be improved by a backup.
    }catch{/* Never include provider responses, keys or queries in errors. Try next provider. */}
   }
   if(lastEmpty)return lastEmpty;
   throw error('Semua provider pencarian gagal atau timeout. Periksa kunci dan kuota masing-masing provider.',503);
  }finally{active--}
 }};
}
