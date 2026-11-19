// Discover articles through the configured search provider, then read only selected publishers.
import {fetchPublicText} from './linkSummary.js';
export const FACT_SITE_ORDER=['en.wikipedia.org','mentalfloss.com','todayifoundout.com','science.nasa.gov','oceanexplorer.noaa.gov'];
const HOSTS=new Set(['en.wikipedia.org','www.mentalfloss.com','mentalfloss.com','www.todayifoundout.com','todayifoundout.com','science.nasa.gov','oceanexplorer.noaa.gov']);
export const allowedFactUrl=u=>u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
export async function discoverFactSources({search,guildId,userId,topics='',read=fetchPublicText,onDiagnostics=()=>{},rotation=0,recent=[]}) {
 const queries=[`site:en.wikipedia.org fun facts nature animals ${topics}`,`site:mentalfloss.com OR site:todayifoundout.com interesting facts ${topics}`,`site:science.nasa.gov OR site:oceanexplorer.noaa.gov discovery facts ${topics}`];
 const urls=[],seen=new Set(), counts={searchOk:0,searchFailed:0,candidates:0,readAttempted:0,readFailed:0,readShort:0,readOk:0};
 for(const query of queries){
  let result;try{result=await search.search({guildId,userId,query:query.slice(0,300),consent:true})}catch(e){if(e?.code==='FORBIDDEN'||e?.code==='CONSENT_REQUIRED'||e?.status===403)throw e;counts.searchFailed++;continue}
  counts.searchOk++;
  for(const item of Array.isArray(result?.results)?result.results:[]){try{const u=new URL(item.url);u.hash='';const href=u.href.replace(/\)/g,'%29');if(!allowedFactUrl(u)||seen.has(href)||href.length>200)continue;seen.add(href);urls.push(href)}catch{}}
 }
 counts.candidates=urls.length;
 // Alternate publishers and prefer pages not recently sent. Reuse older pages when
 // necessary; a missing or blocked publisher must not suppress usable sources.
 const start=Number.isSafeInteger(rotation)&&rotation>=0?rotation%FACT_SITE_ORDER.length:0;
 const siteOrder=[...FACT_SITE_ORDER.slice(start),...FACT_SITE_ORDER.slice(0,start)];
 const recentSet=new Set(Array.isArray(recent)?recent:[]),buckets=new Map(siteOrder.map(host=>[host,[]]));
 const arranged=[];
 for(const isRecent of [false,true]){
  for(const url of urls){const host=new URL(url).hostname.replace(/^www\./,'');if(recentSet.has(url)===isRecent)buckets.get(host)?.push(url)}
  while(siteOrder.some(host=>buckets.get(host).length))for(const host of siteOrder){const url=buckets.get(host).shift();if(url)arranged.push(url)}
 }
 const articles=[];
 for(const url of arranged.slice(0,9)){
  counts.readAttempted++;
  try{const page=await read(url,{allowUrl:allowedFactUrl});if(page.source!=='metadata'&&page.source!=='pdf'&&page.source!=='captions'&&typeof page.text==='string'&&page.text.trim().length>=150){articles.push({url,text:page.text.slice(0,2500)});counts.readOk++}else counts.readShort++;if(articles.length===5)break}catch{counts.readFailed++}
 }
 onDiagnostics(counts);
 return articles;
}
