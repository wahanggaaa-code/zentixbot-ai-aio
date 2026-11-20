// Media is untrusted: Discord CDN only, no shell and no network protocols for FFmpeg.
// APNG uses a private temporary file and permits file access because its demuxer requires seek.
// Inputs/outputs are bounded, with one decoder at a time and a hard timeout.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readDiscordAttachment} from './attachments.js';
const MAX_VIDEO=10*1024*1024, MAX_IMAGE=1024*1024, TIMEOUT=15000;
let active=false;
const bad=message=>Object.assign(new Error(message),{code:'VIDEO_UNAVAILABLE'});
// Build sticker URLs from Discord IDs rather than accepting arbitrary URLs.
export function findGalleryAnimation(message){
 for(const a of message.attachments?.values?.()??[]){const type=String(a.contentType||'').toLowerCase();if(['video/mp4','video/webm','image/gif'].includes(type))return {kind:type==='image/gif'?'gif':'video',attachment:a};}
 for(const sticker of message.stickers?.values?.()??[]){if(/^\d{17,20}$/.test(sticker.id||'')&&(sticker.format===2||sticker.format===4))return {kind:'sticker',sticker};}
 return null;
}
async function readSticker(sticker,fetchImpl){
 const ext=sticker.format===2?'png':'gif';const url=`https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`;
 const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||!response.body)throw bad('Stiker tidak dapat diunduh.');
 if(Number(response.headers.get('content-length'))>MAX_VIDEO){await response.body.cancel().catch(()=>{});throw bad('Stiker terlalu besar.')}
 const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_VIDEO)throw bad('Stiker terlalu besar.');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{})}return Buffer.concat(chunks);
}
export async function readGalleryVideo(message,fetchImpl=globalThis.fetch,{binary='ffmpeg',spawnImpl=spawn}={}){
 const selection=findGalleryAnimation(message);if(!selection)return null;if(active)throw bad('Pemrosesan animasi sedang sibuk.');active=true;
 let temp=null;
 try{
  const input=selection.attachment?await readDiscordAttachment(selection.attachment,MAX_VIDEO,fetchImpl):await readSticker(selection.sticker,fetchImpl);
  const mp4=selection.kind==='video'&&input.length>=12&&input.subarray(4,8).toString()==='ftyp';
  const webm=selection.kind==='video'&&input.length>=4&&input.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  const gif=selection.kind!=='video'&&['GIF87a','GIF89a'].includes(input.subarray(0,6).toString());
  const apng=selection.kind==='sticker'&&selection.sticker.format===2&&input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&input.includes(Buffer.from('acTL'));
  if(!mp4&&!webm&&!gif&&!apng)throw bad('Format animasi tidak dikenali.');
  const format=mp4?'mov':webm?'matroska':gif?'gif':'apng',seconds=selection.kind==='video'?15:3,step=selection.kind==='video'?5:0.25;
  let inputPath='pipe:0';if(apng){temp=await mkdtemp(join(tmpdir(),'zentix-animation-'));inputPath=join(temp,'sticker.png');await writeFile(inputPath,input,{mode:0o600,flag:'wx'});}
  const args=['-hide_banner','-loglevel','error','-nostdin','-protocol_whitelist',apng?'file,pipe':'pipe','-threads','1','-filter_threads','1','-max_pixels','2073600','-probesize','2097152','-analyzeduration','3000000','-t',String(seconds),'-f',format,'-i',inputPath,'-an','-sn','-dn','-vf',`select='isnan(prev_selected_t)+gte(t-prev_selected_t,${step})',scale=384:216:force_original_aspect_ratio=decrease,pad=384:216:(ow-iw)/2:(oh-ih)/2,tile=3x1:padding=4`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1'];
  const data=await new Promise((resolve,reject)=>{
   let process,settled=false,bytes=0,parts=[];const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){process?.kill('SIGKILL');reject(error)}else resolve(value)};
   const timer=setTimeout(()=>finish(bad('Pemrosesan video melewati batas waktu.')),TIMEOUT);timer.unref?.();
   try{process=spawnImpl(binary,args,{stdio:['pipe','pipe','ignore'],windowsHide:true})}catch{finish(bad('FFmpeg tidak tersedia.'));return}
   process.on('error',()=>finish(bad('FFmpeg tidak tersedia.')));process.stdin.on('error',()=>{});process.stdout.on('error',()=>finish(bad('Frame video gagal dibaca.')));
   process.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_IMAGE){finish(bad('Frame video terlalu besar.'));return}parts.push(chunk)});
   process.on('close',code=>{if(code!==0)return finish(bad('Video tidak dapat diproses.'));const output=Buffer.concat(parts);if(output.length<4||output[0]!==255||output[1]!==216||output.at(-2)!==255||output.at(-1)!==217)return finish(bad('Frame video tidak valid.'));finish(null,output)});
   process.stdin.end(apng?undefined:input);
  });
  return {mime:'image/jpeg',base64:data.toString('base64')};
 }finally{if(temp)await rm(temp,{recursive:true,force:true}).catch(()=>{});active=false}
}
