/* Asynchronous dashboard confirmations; no action is taken on cancel or dismissal. */
(() => {
 let active = false;
 // A backdrop click is retargeted to the dialog itself. Check both ends of the
 // gesture so dragging from inside to outside never dismisses accidentally.
 function dismissOnBackdrop(dialog, dismiss) {
  let startedOutside = false;
  const outside = event => {
   const rect=dialog.getBoundingClientRect();
   return event.target===dialog && (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom);
  };
  dialog.addEventListener('pointerdown',event=>{startedOutside=outside(event)});
  dialog.addEventListener('pointercancel',()=>{startedOutside=false});
  dialog.addEventListener('click',event=>{const shouldDismiss=startedOutside && outside(event);startedOutside=false;if(shouldDismiss)dismiss()});
 }
 window.ZentixDismissOnBackdrop=dismissOnBackdrop;
 async function confirmAction(message, notice = false) {
  if (active) return false;
  const dialog = document.createElement('dialog');
  if (typeof dialog.showModal !== 'function') { if (notice) { window.alert(message); return true; } return window.confirm(message); }
  active = true;
  dialog.className = 'zentix-dialog';
  const title = document.createElement('h2'); title.textContent = notice ? 'Informasi' : 'Konfirmasi';
  const description = document.createElement('p'); description.textContent = String(message);
  const actions = document.createElement('div'); actions.className = 'zentix-dialog-actions';
  const cancel = document.createElement('button'); cancel.type='button'; cancel.className='f-outline'; cancel.textContent='BATAL';
  const accept = document.createElement('button'); accept.type='button'; accept.className='f-primary'; accept.textContent=notice?'TUTUP':'LANJUTKAN';
  if(!notice) actions.append(cancel); actions.append(accept); dialog.append(title,description,actions); document.body.append(dialog);
  const previous = document.activeElement, originalUrl = location.href;
  const wasInMain = Boolean(previous?.closest?.('#main'));
  try {
   return await new Promise(resolve => {
    let finished = false;
    const finish = result => { if (finished) return; finished = true; if (dialog.open) dialog.close(); resolve(result); };
    dismissOnBackdrop(dialog,()=>finish(false));
    cancel.addEventListener('click',()=>finish(false)); accept.addEventListener('click',()=>finish(location.href === originalUrl && (!wasInMain || previous.isConnected)));
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false)});
    dialog.addEventListener('close',()=>finish(false));
    try { dialog.showModal(); (notice ? accept : cancel).focus(); } catch { finish(false); }
   });
  } finally { dialog.remove(); active=false; if(previous?.isConnected && typeof previous.focus==='function') previous.focus(); }
 }
 window.ZentixDialog = { confirm: confirmAction, alert: message => confirmAction(message, true) };
})();
