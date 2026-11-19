// Discover articles through the configured search provider, then read only selected publishers.
import {fetchPublicText} from './linkSummary.js';
const HOSTS=new Set(['en.wikipedia.org','www.mentalfloss.com','mentalfloss.com','www.todayifoundout.com','todayifoundout.com','science.nasa.gov','oceanexplorer.noaa.gov']);
export const allowedFactUrl=u=>u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
export async function discoverFactSources({search,guildId,userId,topics='',read=fetchPublicText,onDiagnostics=()=>{}}) {
 const queries=[`site:en.wikipedia.org fun facts nature animals ${topics}`,`site:mentalfloss.com OR site:todayifoundout.com interesting facts ${topics}`,`site:science.nasa.gov OR site:oceanexplorer.noaa.gov discovery facts ${topics}`];
 const urls=[],seen=new Set(), counts={searchOk:0,searchFailed:0,candidates:0,readAttempted:0,readFailed:0,readShort:0,readOk:0};
 for(const query of queries){
  let result;try{result=await search.search({guildId,userId,query:query.slice(0,300),consent:true})}catch(e){if(e?.code==='FORBIDDEN'||e?.code==='CONSENT_REQUIRED'||e?.status===403)throw e;counts.searchFailed++;continue}
  counts.searchOk++;
  for(const item of Array.isArray(result?.results)?result.results:[]){try{const u=new URL(item.url);u.hash='';const href=u.href.replace(/\)/g,'%29');if(!allowedFactUrl(u)||seen.has(href)||href.length>200)continue;seen.add(href);urls.push(href)}catch{}}
 }
 counts.candidates=urls.length;
 const articles=[];
 for(const url of urls.slice(0,9)){
  counts.readAttempted++;
  try{const page=await read(url,{allowUrl:allowedFactUrl});if(typeof page.text==='string'&&page.text.trim().length>=150){articles.push({url,text:page.text.slice(0,2500)});counts.readOk++}else counts.readShort++;if(articles.length===5)break}catch{counts.readFailed++}
 }
 onDiagnostics(counts);
 return articles;
}
