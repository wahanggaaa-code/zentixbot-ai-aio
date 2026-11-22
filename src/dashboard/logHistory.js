// Extract only displayed text from supported Discord Components V2 log containers.
// Do not interpret markdown, follow links, fetch media, or expose spoiler containers.
const MAX_DESCRIPTION = 6000;
const MAX_VISITS = 100;
export function summarizeAuditMessage(message) {
 const pieces=[];let visits=0, size=0;
 function walk(items,depth){
  if(!Array.isArray(items)||depth>4)return;
  for(const component of items){
   if(++visits>MAX_VISITS || size>=MAX_DESCRIPTION)return;
   if(!component || typeof component!=='object')continue;
   const type=component.type??component.data?.type;
   if(type===10){
    const content=component.content??component.data?.content;
    if(typeof content==='string'&&content.trim()){const text=content.slice(0,MAX_DESCRIPTION-size);pieces.push(text);size+=text.length;}
   }else if((type===17 || type===9) && !(type===17 && (component.spoiler===true||component.data?.spoiler===true))){
    walk(component.components??component.data?.components,depth+1);
   }
  }
 }
 walk(message?.components,0);
 let title='Log',description='',eventType=null;
 const marker=pieces.at(-1)?.match(/^-# Zentix event: ([a-z]+\.[a-z]+)$/);
 if(marker){eventType=marker[1];pieces.pop();}
 if(pieces.length){
  const heading=pieces[0].match(/^#{1,3}\s+([^\n]+)(?:\n|$)/);
  if(heading){title=heading[1].trim().slice(0,256)||'Log';pieces[0]=pieces[0].slice(heading[0].length);}
  description=pieces.filter(Boolean).join('\n\n').slice(0,MAX_DESCRIPTION);
 }else{
  const embed=message?.embeds?.[0];
  if(typeof embed?.title==='string'&&embed.title.trim())title=embed.title.slice(0,256);
  const lines=[];
  if(typeof embed?.description==='string')lines.push(embed.description);
  if(Array.isArray(embed?.fields))for(const field of embed.fields.slice(0,25))if(typeof field?.name==='string'&&typeof field?.value==='string')lines.push(`${field.name}: ${field.value}`);
  if(!lines.length && typeof message?.content==='string')lines.push(message.content);
  description=lines.join('\n\n').slice(0,MAX_DESCRIPTION);
 }
 return {id:message.id,at:message.createdAt,title,description,eventType};
}
