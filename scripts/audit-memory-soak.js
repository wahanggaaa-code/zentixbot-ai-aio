// Isolated synthetic exercise, not a full-bot or production soak test.
// Run: node --expose-gc scripts/audit-memory-soak.js
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createRateLimiter } from '../src/utils/rateLimiter.js';
import { createBlockedAttemptTracker } from '../src/utils/abuseProtection.js';
import { createChannelBudget } from '../src/services/ai/channelBudget.js';
import { createFixedWindowCounter } from '../src/utils/webRateLimit.js';
import { readDiscordAttachment } from '../src/services/ai/attachments.js';

const rounds=10, keys=5000, imageSize=1024*1024;let clock=1_000_000;
const now=()=>clock;
const rate=createRateLimiter({now,maxEntries:10000});
const anomalies=createBlockedAttemptTracker({now,maxEntries:10000});
const budget=createChannelBudget({now,maxChannels:10000});
const web=createFixedWindowCounter({now,maxEntries:10000,windowMs:60000,max:3});
const attachment={url:'https://cdn.discordapp.com/attachments/123456789012345678/223456789012345678/dummy.png',size:imageSize};
const snapshot=()=>{global.gc?.();const {rss,heapUsed,external,arrayBuffers}=process.memoryUsage();return {rss,heapUsed,external,arrayBuffers}};
const baseline=snapshot();let peak=0;
for(let round=0;round<rounds;round++){
 for(let i=0;i<keys;i++){
  const key=`${round}:${i}`;
  assert.equal(await rate.check(key,1,60000),true);
  anomalies.record(key,{threshold:3,windowMs:60000});
  assert.equal(budget.underLimit(key,2),true);budget.record(key);
  assert.equal(web.hit(key).allowed,true);
 }
 peak=Math.max(peak,rate.size,anomalies.size,budget.size,web.size);
 for(let i=0;i<4;i++){
  const bytes=await readDiscordAttachment(attachment,imageSize,async()=>new Response(new Uint8Array(imageSize)));
  assert.equal(bytes.length,imageSize);
 }
 await assert.rejects(readDiscordAttachment(attachment,imageSize,async()=>new Response(new Uint8Array(imageSize+1))));
 clock+=3600001;rate.sweep();anomalies.sweep();budget.sweep();
 // A new hit triggers web-counter expiry; it then expires in the next round.
 web.hit(`sweep:${round}`);
 assert.equal(rate.size,0);assert.equal(anomalies.size,0);assert.equal(budget.size,0);assert.equal(web.size,1);
 await wait(1000);
}
const final=snapshot();
console.log(JSON.stringify({kind:'synthetic-only',rounds,keysPerRound:keys,imageDownloadsPerRound:5,peakEntriesPerStore:peak,finalEntries:{rate:rate.size,anomalies:anomalies.size,budget:budget.size,web:web.size},gcAvailable:typeof global.gc==='function',baselineBytes:baseline,finalBytes:final},null,2));
