/* Dirty-state actions for saved settings forms. Individual pages own validation and requests. */
(() => {
 const entries=new Set();
 let sequence=0;
 function refresh(doc){
  const candidates=[...entries].filter(entry=>entry.doc===doc&&entry.form.isConnected&&(entry.dirty()||entry.pending()));
  const current=candidates.filter(entry=>entry.pending()).sort((a,b)=>b.order-a.order)[0] || candidates.sort((a,b)=>b.order-a.order)[0];
  for(const entry of entries){
   if(entry.doc!==doc)continue;
   entry.bar.hidden=entry!==current;
   entry.cancel.disabled=entry.pending();entry.save.disabled=entry.pending()||!entry.canSave();
   const text=entry.message() || (candidates.length>1?entry.multiple(candidates.length):(entry.showLabel?entry.label:''));
   if(entry.status.textContent!==text)entry.status.textContent=text;
  }
  if(doc.body)doc.body.classList.toggle('automod-save-active',!!current||!!doc.querySelector('.automod-save-dock:not([hidden])'));
 }
 function attach(form, label, onRestore, {showLabel=false,controlsSelector='input[name],select[name],textarea[name]',submit=null,extraCapture=null,extraRestore=null,canSave=()=>true,dockToBody=false,hideOriginal=false,originalButton=null}={}) {
  const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
  const doc=form.ownerDocument;
  const controls=[...form.querySelectorAll(controlsSelector)].filter(el=>el.type!=='file');
  const capture=()=>[...controls.map(el=>el.type==='checkbox'||el.type==='radio'?el.checked:el.value),...(extraCapture?[extraCapture()]:[])];
  let baseline=capture(), pending=null, message='';
  const bar=doc.createElement('div');bar.className='automod-save-dock';bar.hidden=true;
  bar.setAttribute('role','region');bar.setAttribute('aria-label',tr(`Perubahan ${label}`,`${label} changes`));
  const cancel=doc.createElement('button');cancel.type='button';cancel.className='automod-dock-cancel';cancel.textContent=tr('BATALKAN','CANCEL');
  const save=doc.createElement('button');save.type='button';save.className='automod-dock-save';save.textContent=tr('SIMPAN','SAVE');
  const status=doc.createElement('span');status.className='automod-dock-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');bar.append(cancel,status,save);if(form.tagName==='DETAILS'||dockToBody)doc.body.append(bar);else form.append(bar);
  const bottom=originalButton || form.querySelector('.f-form-actions button[type=submit],.f-form-actions button:not([type])') || form.querySelector('button[type=submit]');
  const wasHidden=bottom?.hidden;
  if(hideOriginal&&bottom){bottom.dataset.saveDockOriginal='';bottom.hidden=true;}
  const entry={doc,form,bar,cancel,save,status,label,showLabel,canSave,order:++sequence,dirty:()=>JSON.stringify(capture())!==JSON.stringify(baseline),pending:()=>!!pending,message:()=>message,multiple:n=>tr(`${label} · ${n} formulir diubah`,`${label} · ${n} forms changed`)};
  entries.add(entry);
  const changed=()=>{if(!pending)message='';entry.order=++sequence;refresh(doc)};
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  cancel.addEventListener('click',()=>{if(pending)return;controls.forEach((el,i)=>{if(el.type==='checkbox'||el.type==='radio')el.checked=baseline[i];else el.value=baseline[i]});if(extraRestore)extraRestore(baseline[controls.length]);onRestore?.();message='';refresh(doc)});
  save.addEventListener('click',()=>{if(!pending&&canSave()){if(submit)submit();else form.requestSubmit(bottom)}});
  function dispose(){observer.disconnect();entries.delete(entry);form.removeEventListener('input',changed);form.removeEventListener('change',changed);bar.remove();if(hideOriginal&&bottom){delete bottom.dataset.saveDockOriginal;bottom.hidden=wasHidden}refresh(doc)}
  const observer=new MutationObserver(()=>{if(!form.isConnected)dispose()});observer.observe(doc.body,{childList:true,subtree:true});refresh(doc);
  return {
   isDirty:entry.dirty,
   isBusy:entry.pending,
   commitFields(names){if(pending)controls.forEach((el,i)=>{if(names.includes(el.name))baseline[i]=pending[i]})},
   dispose,
   start(){if(pending)return false;pending=capture();entry.order=++sequence;message=tr('MENYIMPAN…','SAVING…');refresh(doc);return true},
   finish(success,cancelled=false){if(success)baseline=pending;pending=null;message=success||cancelled?'':tr('Gagal menyimpan','Save failed');refresh(doc)}
  };
 }
 window.ZentixSaveDock={attach};
})();
