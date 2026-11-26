/* The form's native time input remains authoritative, including its validation. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 // Only normalize unambiguous input. Keep malformed or overlong text visible
 // so validation rejects it rather than silently changing the chosen time.
 function formatTime(text){
  if(/^\d{0,4}$/.test(text))return text.length>2?`${text.slice(0,2)}:${text.slice(2)}`:text;
  if(/^\d{2}[.:]\d{0,2}$/.test(text))return text.replace('.',':');
  return text;
 }
 let active = null;
 const eligible = input => input instanceof HTMLInputElement && input.type === 'time' && input.closest('#main') && !input.matches(':disabled') && !input.readOnly;
 function open(input){
  if(active || !eligible(input))return;
  const dialog=document.createElement('dialog');if(typeof dialog.showModal!=='function')return;
  dialog.className='zentix-dialog zentix-time-dialog';dialog.setAttribute('aria-labelledby','zentix-time-title');
  const title=document.createElement('h2');title.id='zentix-time-title';title.textContent=input.getAttribute('aria-label') || input.closest('label')?.querySelector('b')?.textContent || input.closest('.f-field')?.querySelector('b')?.textContent || tr('Pilih waktu','Choose a time');
  const label=document.createElement('label');label.textContent=tr('Waktu (24 jam, HH:MM; contoh 1200)','Time (24-hour, HH:MM; e.g. 1200)');label.className='zentix-time-dialog-label';
  const value=document.createElement('input');value.type='text';value.inputMode='numeric';value.placeholder='HH:MM';value.maxLength=64;value.value=input.value.slice(0,5);value.setAttribute('aria-label',tr('Waktu dalam format 24 jam','Time in 24-hour format'));label.append(value);
  const error=document.createElement('p');error.setAttribute('role','alert');error.className='zentix-time-error';
  const actions=document.createElement('div');actions.className='zentix-dialog-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='f-outline';cancel.textContent=tr('BATAL','CANCEL');
  const save=document.createElement('button');save.type='button';save.className='f-primary';save.textContent=tr('PILIH','SELECT');actions.append(cancel,save);dialog.append(title,label,error,actions);document.body.append(dialog);active=dialog;
  let finished=false;const observer=new MutationObserver(()=>{if(!input.isConnected)finish()});
  function finish(){if(finished)return;finished=true;observer.disconnect();if(dialog.open)dialog.close();dialog.remove();active=null;if(input.isConnected&&!input.matches(':disabled'))input.focus();}
  window.ZentixDismissOnBackdrop?.(dialog,finish);
  cancel.addEventListener('click',finish);dialog.addEventListener('cancel',event=>{event.preventDefault();finish()});dialog.addEventListener('close',finish);
  value.addEventListener('input',()=>{
   const raw=value.value, start=value.selectionStart, end=value.selectionEnd, formatted=formatTime(raw);
   if(formatted!==raw){
    const position=offset=>{const before=raw.slice(0,offset),digits=(before.match(/\d/g)||[]).length;return digits+(digits>2||(digits===2&&/[.:]$/.test(before))?1:0)};
    value.value=formatted;
    if(start!==null&&end!==null)value.setSelectionRange(position(start),position(end));
   }
   error.textContent='';
  });
  function apply(){
   if(!eligible(input)){finish();return;}const next=formatTime(value.value.trim());
   if(next && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next)){error.textContent=tr('Masukkan waktu 00:00–23:59.','Enter a time from 00:00 to 23:59.');value.focus();return;}
   const probe=input.cloneNode();probe.value=next;
   if(!probe.checkValidity()){error.textContent=input.required && !next?tr('Waktu wajib diisi.','Time is required.'):tr('Waktu tidak sesuai batas atau interval.','Time is outside the allowed range or interval.');value.focus();return;}
   const changed=input.value!==next;input.value=next;finish();if(changed && input.isConnected){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  save.addEventListener('click',apply);value.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply()}});
  observer.observe(document.getElementById('main'),{childList:true,subtree:true});try{dialog.showModal();value.focus();}catch{finish()}
 }
 const supported=()=>typeof HTMLDialogElement!=='undefined'&&typeof HTMLDialogElement.prototype.showModal==='function';
 // Open only after the click, not on press, so touch release cannot dismiss the dialog.
 document.addEventListener('pointerdown',event=>{const input=event.target.closest?.('input[type=time]');if(!supported()||!eligible(input))return;event.preventDefault()},true);
 document.addEventListener('click',event=>{const input=event.target.closest?.('input[type=time]');if(!supported()||!eligible(input))return;event.preventDefault();open(input)},true);
 document.addEventListener('keydown',event=>{const input=event.target.closest?.('input[type=time]');if(!supported()||!eligible(input)||!['Enter',' ','ArrowDown'].includes(event.key))return;event.preventDefault();open(input)},true);
})();
