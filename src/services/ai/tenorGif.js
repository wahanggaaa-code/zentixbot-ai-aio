// Tenor links only: no general web browsing, redirects, cookies, scripts or user URLs in FFmpeg.
import dns from 'node:dns/promises';
import https from 'node:https';
import {parse} from 'parse5';
import {publicAddresses} from './linkSummary.js';
const err=()=>Object.assign(Error('GIF Tenor tidak dapat dibaca.'),{code:'VIDEO_UNAVAILABLE'});
const mediaHosts=new Set(['media.tenor.com','media1.tenor.com','c.tenor.com']);
export function tenorUrl(raw){
 if(typeof raw!=='string'||raw.length>2048)return null;let u;try{u=new URL(raw)}catch{return null}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)return null;
 if((u.hostname==='tenor.com'||u.hostname==='www.tenor.com')&&/^\/view\/[a-zA-Z0-9_-]{1,180}$/.test(u.pathname)){u.search='';return {type:'page',url:u.href}}
 if(mediaHosts.has(u.hostname)&&/^\/(?:[a-zA-Z0-9_-]+\/){1,3}[a-zA-Z0-9_-]+\.gif$/i.test(u.pathname)&&!u.search)return {type:'media',url:u.href};
 return null;
}
export function findTenorLink(message){
 const text=String(message?.content||'').slice(0,4000);for(const token of text.match(/https:\/\/[^\s<>"']+/gi)||[]){const found=tenorUrl(token.replace(/[.,!?;)\]]+$/,''));if(found)return found}return null;
}
function imageFromPage(html){
 const doc=parse(html),nodes=[doc];while(nodes.length){const n=nodes.pop();if(n.tagName==='meta'){const a=Object.fromEntries((n.attrs||[]).map(x=>[x.name.toLowerCase(),x.value]));if(['og:image','og:image:url','twitter:image'].includes((a.property||a.name||'').toLowerCase())){const result=tenorUrl(a.content);if(result?.type==='media')return result.url}}if(n.childNodes)nodes.push(...n.childNodes)}throw err();
}
async function pinnedRequest(raw,{lookup=dns.lookup,request=https.request,maxBytes,type}){
 const u=new URL(raw);let timer;const addresses=await Promise.race([lookup(u.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(err()),5000);timer.unref?.()})]).finally(()=>clearTimeout(timer));const pinned=publicAddresses(addresses);
 return new Promise((resolve,reject)=>{let done=false,req,timeout;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timeout);if(error){req?.destroy();reject(error)}else resolve(value)};
  try{req=request(u,{method:'GET',agent:false,family:pinned.family,autoSelectFamily:false,lookup:(_host,opts,cb)=>opts?.all?cb(null,[pinned]):cb(null,pinned.address,pinned.family),headers:{Accept:type==='page'?'text/html':'image/gif','Accept-Encoding':'identity','User-Agent':'ZentixBot-Gallery/1.0'}},res=>{
   const ct=String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase(),encoding=String(res.headers['content-encoding']||'identity').toLowerCase();
   if(res.statusCode!==200||encoding!=='identity'||(type==='page'?ct!=='text/html':ct!=='image/gif')||Number(res.headers['content-length'])>maxBytes){res.destroy();return finish(err())}
   let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy();finish(err())}else chunks.push(Buffer.from(chunk))});res.on('end',()=>finish(null,Buffer.concat(chunks)));res.on('error',()=>finish(err()));res.on('aborted',()=>finish(err()));
  });timeout=setTimeout(()=>finish(err()),10000);timeout.unref?.();req.on('error',()=>finish(err()));req.end()}catch{finish(err())}
 });
}
export async function downloadTenorGif(selection,options={}){
 const initial=tenorUrl(selection?.url);if(!initial||initial.type!==selection.type)throw err();
 let url=initial.url;if(initial.type==='page'){const page=await pinnedRequest(url,{...options,type:'page',maxBytes:2*1024*1024});url=imageFromPage(page.toString('utf8'))}
 const validated=tenorUrl(url);if(validated?.type!=='media')throw err();return pinnedRequest(validated.url,{...options,type:'media',maxBytes:10*1024*1024});
}
