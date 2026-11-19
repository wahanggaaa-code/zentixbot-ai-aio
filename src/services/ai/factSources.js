// Discover articles through the configured search provider, then read only selected publishers.
import {fetchPublicText} from './linkSummary.js';
const HOSTS=new Set(['en.wikipedia.org','www.mentalfloss.com','mentalfloss.com','www.todayifoundout.com','todayifoundout.com','science.nasa.gov','oceanexplorer.noaa.gov']);
export const allowedFactUrl=u=>u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
export async function discoverFactSources({search,guildId,userId,topics='',read=fetchPublicText}) {
 const queries=[`site:en.wikipedia.org fun facts nature animals ${topics}`,`site:mentalfloss.com OR site:todayifoundout.com interesting facts ${topics}`,`site:science.nasa.gov OR site:oceanexplorer.noaa.gov discovery facts ${topics}`];
 const urls=[],seen=new Set();
 for(const query of queries){
  let result;try{result=await search.search({guildId,userId,query:query.slice(0,300),consent:true})}catch(e){if(e?.code==='FORBIDDEN'||e?.code==='CONSENT_REQUIRED'||e?.status===403)throw e;continue}
  for(const item of Array.isArray(result?.results)?result.results:[]){try{const u=new URL(item.url);u.hash='';const href=u.href.replace(/\)/g,'%29');if(!allowedFactUrl(u)||seen.has(href)||href.length>200)continue;seen.add(href);urls.push(href)}catch{}}
 }
 const articles=[];
 for(const url of urls.slice(0,9)){
  try{const page=await read(url,{allowUrl:allowedFactUrl});if(typeof page.text==='string'&&page.text.trim().length>=150)articles.push({url,text:page.text.slice(0,2500)});if(articles.length===5)break}catch{/* unavailable, blocked or unreadable source */}
 }
 return articles;
}
