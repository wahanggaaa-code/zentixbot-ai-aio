// Local diagnostic only: real dashboard router + disposable SQLite and fake Discord.
// This is not a browser rendering benchmark or a measurement of production latency.
import express from 'express';
import { JSDOM, ResourceLoader, CookieJar, VirtualConsole } from 'jsdom';
import { performance } from 'node:perf_hooks';
import { createLevelingFixture, adminId } from '../tests/helpers/leveling-postgres-fixture.js';
import { createDashboardRouter } from '../src/dashboard/router.js';
const cleanup=[]; let server;
try {
const fx=await createLevelingFixture({after:f=>cleanup.push(f)}, {}, {backend:'sqlite'});
fx.addMember(adminId); fx.client.isReady=()=>true; fx.client.ws={ping:25}; fx.client.uptime=123456;
const app=express();
// Optional symmetric latency makes a request waterfall visible without claiming production results.
const delayMs=Number(process.env.ZENTIX_MEASURE_DELAY_MS || 0);
if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 2000) throw Error('ZENTIX_MEASURE_DELAY_MS must be an integer from 0 to 2000');
app.use('/dashboard/api/bot', (req,res,next) => { if (delayMs && ['/control-center','/presence'].includes(req.path)) return setTimeout(next,delayMs); next(); });
app.use('/dashboard',createDashboardRouter(fx.client,{env:{DASHBOARD_TOKEN:'benchmark-token-123456',OWNER_IDS:adminId}}));
server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
const login=await fetch(origin+'/dashboard/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'token=benchmark-token-123456',redirect:'manual'});if(login.status!==303)throw Error(`login ${login.status} ${await login.text()}`);
const session=login.headers.getSetCookie().find(s=>s.startsWith('zx_session='));
const timer=ms=>new Promise(r=>setTimeout(r,ms));
let results=[];
for(let iteration=0;iteration<7;iteration++){
 const events=[];let inflight=0;const errors=[];const jar=new CookieJar();jar.setCookieSync(session,origin+'/dashboard/');
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
 const start=performance.now();
 const dom=await JSDOM.fromURL(origin+'/dashboard/',{cookieJar:jar,resources:new ResourceLoader(),runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(w){
  w.scrollTo=()=>{};w.confirm=()=>true;w.fetch=async (url,opts={})=>{const path=String(url),begin=performance.now();inflight++;try{const r=await fetch(new URL(path,origin),{...opts,headers:{...opts.headers,cookie:session.split(';')[0]}});const body=await r.text();events.push({path,status:r.status,at:begin-start,ms:performance.now()-begin,auth:r.headers.get('server-timing')});return {ok:r.ok,status:r.status,json:async()=>JSON.parse(body),text:async()=>body,headers:r.headers}}finally{inflight--}};
 }});
 const w=dom.window;if(w.document.readyState!=='complete')await new Promise(r=>w.addEventListener('load',r,{once:true}));
 const loaded=performance.now()-start;
 async function settle(){let quiet=0;for(let i=0;i<300;i++){await timer(10);quiet=inflight===0?quiet+1:0;if(quiet>=5)return;}throw Error('requests did not settle')}
 await settle();const overview=performance.now()-start;const overviewEvents=events.splice(0);
 async function go(hash){const before=performance.now();w.location.hash=hash;await new Promise(r=>w.addEventListener('hashchange',r,{once:true}));await settle();return {elapsed:performance.now()-before,requests:events.splice(0)}}
 const settings=await go('#settings');const welcome=await go('#features/welcome/welcome');const ticket=await go('#features/ticket');const settingsAgain=await go('#settings');
 results.push({iteration,loaded,overview,overviewEvents,settings,welcome,ticket,settingsAgain,errors});w.close();
}
console.log('DASHBOARD_MEASUREMENT_JSON_START');
console.log(JSON.stringify(results,null,2));
} finally {
 if (server?.listening) await new Promise(r=>server.close(r));
 for (const f of cleanup.reverse()) await f();
}
