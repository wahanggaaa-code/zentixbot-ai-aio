/* Keep native selects as the form source of truth; offer a themed picker for single selects. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 let active = null;
 const enabled = select => select instanceof HTMLSelectElement && select.closest('#main') && !select.closest('dialog, .ms-discord, .discord-demo') && !select.matches(':disabled') && !select.multiple && select.size <= 1;
 function open(select) {
  if (!enabled(select) || active) return;
  const dialog=document.createElement('dialog');
  if(typeof dialog.showModal !== 'function') return;
  dialog.className='zentix-dialog zentix-select-dialog';
  const title=document.createElement('h2'); title.id='zentix-select-title';
  const parentLabel=select.closest('label');
  title.textContent=select.getAttribute('aria-label') || select.labels?.[0]?.querySelector('b')?.textContent || parentLabel?.querySelector('b')?.textContent || select.closest('.f-field')?.querySelector('b')?.textContent || tr('Pilih opsi','Choose an option');
  dialog.setAttribute('aria-labelledby',title.id);
  const search=document.createElement('input');search.type='search';search.placeholder=tr('Cari pilihan','Search options');search.setAttribute('aria-label',tr('Cari pilihan','Search options'));search.className='zentix-select-search';
  const list=document.createElement('div');list.className='zentix-select-list';list.setAttribute('role','group');list.setAttribute('aria-label',tr('Pilihan','Options'));
  const cancel=document.createElement('button');cancel.type='button';cancel.className='f-outline zentix-select-cancel';cancel.textContent=tr('BATAL','CANCEL');
  const options=[...select.options];
  for(const [index,option] of options.entries()){
   const button=document.createElement('button');button.type='button';button.className='zentix-select-option';button.textContent=(option.parentElement?.tagName==='OPTGROUP'?`${option.parentElement.label} · `:'')+option.textContent;
   button.disabled=option.disabled || Boolean(option.closest('optgroup:disabled'));button.setAttribute('aria-pressed',String(option.selected));
   button.addEventListener('click',()=>{
    if(!select.isConnected || select.matches(':disabled') || option.disabled || option.closest('optgroup:disabled') || select.options[index]!==option){finish();return;}
    const changed=select.selectedIndex!==index;select.selectedIndex=index;finish();
    if(changed && select.isConnected){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
   });list.append(button);
  }
  search.hidden=options.length<8;
  search.addEventListener('input',()=>{const query=search.value.trim().toLocaleLowerCase();for(const button of list.children)button.hidden=!button.textContent.toLocaleLowerCase().includes(query);});
  dialog.append(title,search,list,cancel);document.body.append(dialog);active=dialog;
  let finished=false;const observer=new MutationObserver(()=>{if(!select.isConnected)finish()});
  function finish(){if(finished)return;finished=true;observer.disconnect();if(dialog.open)dialog.close();dialog.remove();active=null;if(select.isConnected&&!select.disabled)select.focus();}
  window.ZentixDismissOnBackdrop?.(dialog,finish);
  cancel.addEventListener('click',finish);dialog.addEventListener('cancel',e=>{e.preventDefault();finish()});dialog.addEventListener('close',finish);
  observer.observe(document.getElementById('main'),{childList:true,subtree:true});
  try{dialog.showModal();(search.hidden?list.querySelector('button:not(:disabled)'):search)?.focus();}catch{finish()}
 }
 function supported(){return typeof HTMLDialogElement!=='undefined' && typeof HTMLDialogElement.prototype.showModal==='function';}
 // Block the native picker on press; wait for click so the release cannot hit the new dialog.
 document.addEventListener('pointerdown',event=>{const select=event.target.closest?.('select');if(!supported()||!enabled(select))return;event.preventDefault();},true);
 document.addEventListener('click',event=>{const select=event.target.closest?.('select');if(!supported()||!enabled(select))return;event.preventDefault();open(select);},true);
 document.addEventListener('keydown',event=>{const select=event.target.closest?.('select');if(!supported()||!enabled(select)||!['Enter',' ','ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();open(select);},true);
})();
