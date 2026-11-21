// Discover articles through the configured search provider, then read only selected publishers.
import {fetchPublicText} from './linkSummary.js';
import {FACT_COUNTRIES, factCountryName, nextFactCountries} from './factCountries.js';
export const FACT_SITE_ORDER=['en.wikipedia.org','mentalfloss.com','todayifoundout.com','science.nasa.gov','oceanexplorer.noaa.gov','britannica.com','nationalgeographic.com','smithsonianmag.com','nhm.ac.uk','guinnessworldrecords.com','whc.unesco.org'];
const HOSTS=new Set(FACT_SITE_ORDER.flatMap(host=>[host,`www.${host}`]));
export const allowedFactUrl=u=>u.protocol==='https:' && !u.username && !u.password && !u.port && HOSTS.has(u.hostname.toLowerCase());
const SITE_GROUPS=[
 'site:en.wikipedia.org OR site:britannica.com OR site:nhm.ac.uk OR site:whc.unesco.org',
 'site:mentalfloss.com OR site:todayifoundout.com OR site:guinnessworldrecords.com',
 'site:science.nasa.gov OR site:oceanexplorer.noaa.gov OR site:smithsonianmag.com OR site:nationalgeographic.com',
];
export async function discoverFactSources({search,guildId,userId,topics='',read=fetchPublicText,onDiagnostics=()=>{},rotation=0,recent=[],countries=null}) {
 const index=Number.isSafeInteger(rotation)&&rotation>=0?rotation:0;
 // A saved custom topic always wins; general searches draw three countries.
 const custom=typeof topics==='string'&&topics.trim()?topics.trim():null;
 const validCountries=Array.isArray(countries)&&countries.length===3&&new Set(countries).size===3&&countries.every(c=>FACT_COUNTRIES.includes(c));
 const selected=custom?[]:validCountries?countries:nextFactCountries(null).picked;
 const queries=SITE_GROUPS.map((group,i)=>{
  const theme=custom||`${factCountryName(selected[i])} geography nature culture history`;
  return `(${group}) interesting facts ${theme}`;
 });
 const urls=[],seen=new Set(), counts={searchOk:0,searchFailed:0,candidates:0,readAttempted:0,readFailed:0,readShort:0,readOk:0};
 for(const query of queries){
  let result;try{result=await search.search({guildId,userId,query:query.slice(0,300),consent:true})}catch(e){if(e?.code==='FORBIDDEN'||e?.code==='CONSENT_REQUIRED'||e?.status===403)throw e;counts.searchFailed++;continue}
  counts.searchOk++;
  for(const item of Array.isArray(result?.results)?result.results:[]){try{const u=new URL(item.url);u.hash='';const href=u.href.replace(/\)/g,'%29');if(!allowedFactUrl(u)||seen.has(href)||href.length>200)continue;seen.add(href);urls.push(href)}catch{}}
 }
 counts.candidates=urls.length;
 // Prefer new URLs and publishers less represented in the last three successful editions.
 // Recent publishers are not banned: keep useful sources when the others cannot be read.
 const start=index%FACT_SITE_ORDER.length;
 const siteOrder=[...FACT_SITE_ORDER.slice(start),...FACT_SITE_ORDER.slice(0,start)];
 const recentList=Array.isArray(recent)?recent.filter(x=>typeof x==='string'):[];
 const recentSet=new Set(recentList), frequency=new Map();
 for(const url of recentList.slice(-9)){try{const host=new URL(url).hostname.replace(/^www\./,'');frequency.set(host,(frequency.get(host)||0)+1)}catch{}}
 siteOrder.sort((a,b)=>(frequency.get(a)||0)-(frequency.get(b)||0));
 const buckets=new Map(siteOrder.map(host=>[host,[]])),arranged=[];
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
