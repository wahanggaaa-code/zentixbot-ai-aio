// Self-contained HTML: external URLs are text, never loaded or made clickable.
// Attachments themselves are not downloaded or copied; Discord URLs can expire.
const MAX_MESSAGES = 10000;
const MAX_BYTES = 8 * 1024 * 1024;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => typeof value?.toJSON==='function' ? value.toJSON() : value;
function componentLines(components) {
 const lines=[];
 function walk(value,depth=0){
  if(depth>10)throw Error('Component nesting too deep');
  const c=json(value);if(!c||typeof c!=='object')return;
  if(c.type===10 && typeof c.content==='string')lines.push(c.content);
  if(c.type===2 && c.label)lines.push(`[Button] ${c.label}`);
  if(c.type===11 && c.media?.url)lines.push(`[Thumbnail URL] ${c.media.url}`);
  if(c.type===12)for(const item of c.items||[]){if(item.media?.url)lines.push(`[Media URL] ${item.media.url}`);if(item.description)lines.push(`Description: ${item.description}`);}
  if(c.type===13 && c.file?.url)lines.push(`[File URL] ${c.file.url}`);
  if([3,5,6,7,8].includes(c.type)){if(c.placeholder)lines.push(`[Select] ${c.placeholder}`);for(const option of c.options||[])if(option?.label)lines.push(`  - ${option.label}`);}
  if(Array.isArray(c.components))for(const child of c.components)walk(child,depth+1);
  if(c.accessory)walk(c.accessory,depth+1);
 }
 for(const item of components||[])walk(item);
 return lines;
}
function embedLines(raw){
 const e=json(raw)||{},lines=['[Embed]'];
 if(e.author?.name)lines.push(`Author: ${e.author.name}`);
 if(e.title)lines.push(`Title: ${e.title}`);
 if(e.description)lines.push(`Description: ${e.description}`);
 for(const f of e.fields||[])lines.push(`${f.name||'Field'}: ${f.value||''}`);
 if(e.footer?.text)lines.push(`Footer: ${e.footer.text}`);
 if(e.url)lines.push(`URL: ${e.url}`);
 if(e.image?.url)lines.push(`Image URL: ${e.image.url}`);
 if(e.thumbnail?.url)lines.push(`Thumbnail URL: ${e.thumbnail.url}`);
 return lines;
}
function attachmentLines(raw) {
 const a=json(raw)||{},lines=[`[Attachment] ${a.name||'unnamed'}`];
 if(Number.isSafeInteger(a.size)&&a.size>=0)lines.push(`Size: ${a.size} bytes`);
 if(a.contentType||a.content_type)lines.push(`Type: ${a.contentType||a.content_type}`);
 if(a.description)lines.push(`Description: ${a.description}`);
 if(a.url)lines.push(`URL: ${a.url}`);
 return lines;
}
function renderMessage(msg) {
 const lines=[];if(msg.content)lines.push(msg.content);
 for(const embed of msg.embeds||[])lines.push(embedLines(embed).join('\n'));
 for(const attachment of msg.attachments?.values?.()||[])lines.push(attachmentLines(attachment).join('\n'));
 const components=componentLines(msg.components);if(components.length)lines.push(`[Components]\n${components.join('\n')}`);
 if(!lines.length)lines.push('[No text, embed, attachment, or readable component]');
 const date=new Date(msg.createdTimestamp),ts=Number.isFinite(date.getTime())?date.toISOString().replace('T',' ').slice(0,19):'Unknown';
 return `<tr><td class="ts">${escape(ts)}</td><td class="author">${escape(msg.author?.tag??msg.author?.username??'Unknown')}</td><td class="msg">${escape(lines.join('\n\n'))}</td></tr>`;
}
export async function createTicketTranscript(channel,{maxMessages=MAX_MESSAGES,maxBytes=MAX_BYTES}={}) {
 const rows=[];let before,bytes=0;
 while(true){
  const batch=await channel.messages.fetch({limit:100,...(before?{before}:{})});
  if(!batch.size)break;
  if(rows.length+batch.size>maxMessages)throw Error(`Transcript exceeds ${maxMessages} messages`);
  for(const message of batch.values()){
   const row=renderMessage(message);bytes+=Buffer.byteLength(row,'utf8')+1;
   if(bytes>maxBytes)throw Error(`Transcript exceeds ${maxBytes} bytes`);
   rows.push({timestamp:message.createdTimestamp,row});
  }
  const next=batch.last()?.id;if(batch.size<100)break;if(!next||next===before)throw Error('Transcript pagination did not advance');before=next;
 }
 rows.sort((a,b)=>a.timestamp-b.timestamp);
 const html=`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Transcript – #${escape(channel.name)}</title><style>body{font-family:sans-serif;background:#36393f;color:#dcddde;margin:0;padding:16px}h1{color:#fff;font-size:1.2rem}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:6px 8px;border-bottom:1px solid #40444b;text-align:left;vertical-align:top}.ts,.author{white-space:nowrap}.msg{white-space:pre-wrap;overflow-wrap:anywhere}</style></head>
<body><h1>Transcript – #${escape(channel.name)}</h1><p>${rows.length} message(s) exported on ${escape(new Date().toUTCString())} (UTC).</p><p>Private transcript. Attachments are not copied: listed URLs can expire or become inaccessible. Embedded media is not downloaded. URLs are plain text.</p><table><thead><tr><th>Timestamp (UTC)</th><th>Author</th><th>Message</th></tr></thead><tbody>${rows.map(x=>x.row).join('\n')}</tbody></table></body></html>`;
 const buffer=Buffer.from(html,'utf8');if(buffer.length>maxBytes)throw Error(`Transcript exceeds ${maxBytes} bytes`);return {buffer,messageCount:rows.length};
}
