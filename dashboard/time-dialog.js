/* The form's native time input remains authoritative, including its validation. */
(() => {
 let active = null;
 const eligible = input => input instanceof HTMLInputElement && input.type === 'time' && input.closest('#main') && !input.matches(':disabled') && !input.readOnly;
 function open(input){
  if(active || !eligible(input))return;
  const dialog=document.createElement('dialog');if(typeof dialog.showModal!=='function')return;
  dialog.className='zentix-dialog zentix-time-dialog';dialog.setAttribute('aria-labelledby','zentix-time-title');
  const title=document.createElement('h2');title.id='zentix-time-title';title.textContent=input.getAttribute('aria-label') || input.closest('label')?.querySelector('b')?.textContent || input.closest('.f-field')?.querySelector('b')?.textContent || 'Pilih waktu';
  const label=document.createElement('label');label.textContent='Waktu (24 jam, HH:MM)';label.className='zentix-time-dialog-label';
  const value=document.createElement('input');value.type='text';value.inputMode='numeric';value.placeholder='HH:MM';value.maxLength=5;value.value=input.value.slice(0,5);value.setAttribute('aria-label','Waktu dalam format 24 jam');label.append(value);
  const error=document.createElement('p');error.setAttribute('role','alert');error.className='zentix-time-error';
  const actions=document.createElement('div');actions.className='zentix-dialog-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='f-outline';cancel.textContent='BATAL';
  const save=document.createElement('button');save.type='button';save.className='f-primary';save.textContent='PILIH';actions.append(cancel,save);dialog.append(title,label,error,actions);document.body.append(dialog);active=dialog;
  let finished=false;const observer=new MutationObserver(()=>{if(!input.isConnected)finish()});
  function finish(){if(finished)return;finished=true;observer.disconnect();if(dialog.open)dialog.close();dialog.remove();active=null;if(input.isConnected&&!input.matches(':disabled'))input.focus();}
  cancel.addEventListener('click',finish);dialog.addEventListener('cancel',event=>{event.preventDefault();finish()});dialog.addEventListener('close',finish);
  function apply(){
   if(!eligible(input)){finish();return;}const next=value.value.trim();
   if(next && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(next)){error.textContent='Masukkan waktu 00:00–23:59.';value.focus();return;}
   const probe=input.cloneNode();probe.value=next;
   if(!probe.checkValidity()){error.textContent=input.required && !next?'Waktu wajib diisi.':'Waktu tidak sesuai batas atau interval.';value.focus();return;}
   const changed=input.value!==next;input.value=next;finish();if(changed && input.isConnected){input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  save.addEventListener('click',apply);value.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();apply()}});
  observer.observe(document.getElementById('main'),{childList:true,subtree:true});try{dialog.showModal();value.focus();}catch{finish()}
 }
 const supported=()=>typeof HTMLDialogElement!=='undefined'&&typeof HTMLDialogElement.prototype.showModal==='function';
 for(const type of ['pointerdown','click'])document.addEventListener(type,event=>{const input=event.target.closest?.('input[type=time]');if(!supported()||!eligible(input))return;event.preventDefault();open(input)},true);
 document.addEventListener('keydown',event=>{const input=event.target.closest?.('input[type=time]');if(!supported()||!eligible(input)||!['Enter',' ','ArrowDown'].includes(event.key))return;event.preventDefault();open(input)},true);
})();
