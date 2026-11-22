/* Giveaways on PostgreSQL: list, create, end, reroll, delete and repair of an
   unfinished delivery. Every change is confirmed against freshly loaded data.
   Discord and the database are separate; each message says which may have changed. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 async function request(path,method='GET',body){
  const session=await window.ZentixSession;
  const response=await fetch('/dashboard/api/bot/giveaway/'+path,{
   method,
   cache:'no-store',
   headers:body?{'content-type':'application/json','x-csrf-token':session.csrf}:{},
   ...(body?{body:JSON.stringify(body)}:{}),
  });
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.error||tr('Permintaan gagal.','Request failed.')),{code:data.code});
  return data;
 }

 function render(){
  return `<div class="f-layout"><div>`
   +`<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Daftar Giveaway tersimpan','Saved giveaways')}</h2>`
   +`<p>${tr('Diurutkan berdasarkan ID pesan, bukan waktu.','Sorted by message ID, not time.')}</p></div><span>✳</span></div>`
   +`<div id="giveawayLive" aria-live="polite">${tr('Memuat daftar…','Loading list…')}</div></section></div>`
   +`<aside><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Buat Giveaway','Create giveaway')}</h2>`
   +`<p>${tr('Bot langsung mengirim pesan publik ke channel yang dipilih.','The bot immediately sends a public message to the selected channel.')}</p></div><span>✳</span></div>`
   +`<div id="giveawayCreate" aria-live="polite">${tr('Memuat pilihan…','Loading options…')}</div></section>`
   +`<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Yang perlu diperhatikan','Important information')}</h2>`
   +`<p>${tr('Data berasal dari database bot, bukan hasil pemeriksaan pesan Discord.','Data comes from the bot database, not from checking Discord messages.')}</p></div><span>✳</span></div>`
   +`<p class="f-muted">${tr('Status tersimpan bukan jaminan pesan Discord sudah sesuai. Status pengiriman yang tidak tercatat bukan bukti gagal atau berhasil. Periksa pesan sebelum bertindak.','Saved status does not guarantee the Discord message matches. An unrecorded delivery status is not proof of success or failure. Check the message before acting.')}</p>`
   +`<p class="f-muted">${tr('Mengakhiri atau mengundi ulang akan mengedit pesan dan mengirim atau memperbarui pengumuman. Menghapus akan menghapus pesan Giveaway dan seluruh entrinya; pengumuman pemenang yang sudah ada dibiarkan.','Ending or rerolling edits the message and sends or updates an announcement. Deleting removes the giveaway message and all entries; existing winner announcements remain.')}</p>`
   +`<p class="f-muted">${tr('Jika pengiriman tertunda, periksa channel dulu: tandai terkirim bila pengumumannya sudah ada, atau kirim ulang bila belum. Bot tidak pernah mengulang sendiri.','If delivery is pending, check the channel first: mark delivered if the announcement exists, or resend if it does not. The bot never retries automatically.')}</p>`
   +`</section></aside></div>`;
 }

 // ---- List --------------------------------------------------------------
 const STATUS_TEXT={active:tr('TERCATAT AKTIF','RECORDED ACTIVE'),ended:tr('TERCATAT SELESAI','RECORDED ENDED')};
 const DELIVERY_TEXT={delivered:tr('tercatat selesai','recorded as delivered'),pending:tr('tertunda / tidak diketahui','pending / unknown'),not_recorded:tr('tidak tercatat','not recorded')};
 const ACTION_LABEL={
  end:tr('AKHIRI','END'),
  reroll:tr('UNDI ULANG','REROLL'),
  mark_delivered:tr('TANDAI TERKIRIM','MARK DELIVERED'),
  redeliver:tr('KIRIM ULANG','RESEND'),
  delete:tr('HAPUS','DELETE'),
  delete_record:tr('HAPUS CATATAN SAJA','DELETE RECORD ONLY'),
 };

 /** Which actions a stored row offers. The server decides again on every request. */
 function actionsFor(g,legacyDetected){
  // Unreliable data is never acted on from here.
  const unreliable=g.dataReview===undefined?g.review:g.dataReview;
  if(legacyDetected||(unreliable&&!g.deleting))return [];
  if(g.deleting)return ['delete','delete_record'];
  if(g.delivery==='pending')return ['mark_delivered','redeliver','delete'];
  if(g.status==='active')return ['end','delete'];
  if(g.status==='ended'&&g.delivery==='delivered'&&g.entries>0)return ['reroll','delete'];
  if(g.status==='ended')return ['delete'];
  return [];
 }

 function rowHtml(g,index,legacyDetected){
  const actions=actionsFor(g,legacyDetected);
  const label=action=>g.deleting&&action==='delete'?tr('LANJUTKAN HAPUS','CONTINUE DELETION'):ACTION_LABEL[action];
  const status=g.deleting?tr('PENGHAPUSAN BELUM SELESAI','DELETION INCOMPLETE'):STATUS_TEXT[g.status]||tr('PERLU DIPERIKSA','NEEDS REVIEW');
  const warnings=g.review&&Array.isArray(g.warnings)?`<br><small>${g.warnings.map(esc).join(' ')}</small>`:'';
  const end=g.endAt===null||g.endAt===undefined?'—':esc(new Date(g.endAt).toLocaleString(tr('id-ID','en-US')));
  return `<tr><td><b>${esc(g.prize||tr('Perlu diperiksa','Needs review'))}</b><br><small>${tr('Pesan','Message')} ${esc(g.messageId)}<br>`
   +`Channel ${esc(g.channelId||'—')} · Host ${esc(g.hostId||'—')}</small></td>`
   +`<td>${status}<br><small>${tr('Pengiriman','Delivery')}: ${DELIVERY_TEXT[g.delivery]||tr('perlu diperiksa','needs review')}</small>${warnings}</td>`
   +`<td>${end}<br><small>${tr('Entri','Entries')}: ${esc(g.entries??'—')} · ${tr('Target pemenang','Target winners')}: ${esc(g.winnerCount??'—')}</small></td>`
   +`<td>${actions.length?actions.map(action=>`<button type="button" class="f-link" data-gw-action="${action}" data-index="${index}">${label(action)}</button>`).join('<br>'):'—'}</td></tr>`;
 }

 /** Why the freshly loaded state forbids the action, or null. */
 function refusal(action,latest){
  const waiting=tr('Pengiriman mungkin masih berjalan. Tunggu sekitar dua menit, muat ulang, lalu periksa Discord.','Delivery may still be in progress. Wait about two minutes, reload, then check Discord.');
  if(action==='end'||action==='reroll'){
   if(latest.deleting)return tr('Giveaway ini sedang dalam penghapusan yang belum selesai.','This giveaway has an unfinished deletion.');
   if(latest.deliveryStatus==='pending')return tr('Pengiriman sebelumnya tertunda atau tidak diketahui. Periksa Discord dan database.','The previous delivery is pending or unknown. Check Discord and the database.');
   if((action==='end'&&latest.ended)||(action==='reroll'&&!latest.canReroll))return tr('Status berubah atau pengundian ulang belum aman. Muat ulang dan periksa.','Status changed or rerolling is not yet safe. Reload and check.');
   return null;
  }
  if(action==='mark_delivered'||action==='redeliver'){
   if(latest.canResolve)return null;
   return latest.deliveryStatus==='pending'&&!latest.deleting?waiting:tr('Status berubah. Muat ulang dan periksa.','Status changed. Reload and check.');
  }
  return latest.canDelete?null:waiting;
 }

 function confirmation(action,latest){
  const what=tr(`giveaway “${latest.prize}” (pesan ${latest.messageId}, ${latest.entries} entri tersimpan)`,`giveaway “${latest.prize}” (message ${latest.messageId}, ${latest.entries} saved entries)`);
  if(action==='end')return tr(`Akhiri ${what}? Bot akan mengedit pesan dan mengirim atau memperbarui pengumuman di Discord.`,`End ${what}? The bot will edit the message and send or update the Discord announcement.`);
  if(action==='reroll')return tr(`Undi ulang ${what}? Bot akan mengedit pesan dan mengirim atau memperbarui pengumuman di Discord.`,`Reroll ${what}? The bot will edit the message and send or update the Discord announcement.`);
  if(action==='mark_delivered')return tr(`Tandai hasil ${what} sebagai sudah terkirim? Lakukan hanya jika Anda sudah melihat pengumuman pemenangnya di Discord. Bot tidak mengirim apa pun.`,`Mark the result of ${what} as delivered? Only do this if you have seen the winner announcement in Discord. The bot sends nothing.`);
  if(action==='redeliver')return tr(`Kirim ulang hasil ${what}? Pemenang yang tersimpan diumumkan lagi tanpa undian baru. Jika pengumuman pertama sebenarnya sudah terkirim, akan ada dua pengumuman.`,`Resend the result of ${what}? Saved winners will be announced again without a new draw. If the first announcement was already sent, there will be two announcements.`);
  if(action==='delete_record')return tr(`Hapus HANYA catatan ${what}? Discord tidak disentuh: jika pesannya masih ada, hapus sendiri di Discord. Semua entri hilang dan tidak dapat dikembalikan.`,`Delete ONLY the record for ${what}? Discord is not touched: if the message still exists, delete it manually in Discord. All entries are lost and cannot be restored.`);
  return tr(`Hapus ${what}? Bot menghapus pesan Giveaway di Discord dan catatannya. Semua entri hilang dan tidak dapat dikembalikan. Pengumuman pemenang yang sudah ada tidak dihapus.`,`Delete ${what}? The bot deletes the Discord giveaway message and its record. All entries are lost and cannot be restored. Existing winner announcements are not deleted.`);
 }

 function successText(action,result){
  if(action==='delete')return result.discord==='deleted'?tr('Giveaway dihapus: pesan dan catatan.','Giveaway deleted: message and record.'):tr('Catatan dihapus; pesannya sudah tidak ada di Discord.','Record deleted; the message was already absent from Discord.');
  if(action==='delete_record')return tr('Catatan dihapus. Discord tidak disentuh.','Record deleted. Discord was not touched.');
  if(action==='mark_delivered')return tr('Ditandai terkirim. Tidak ada yang dikirim ke Discord.','Marked delivered. Nothing was sent to Discord.');
  if(action==='redeliver')return tr(`Hasil dikirim ulang: ${result.winners} pemenang tersimpan.`,`Result resent: ${result.winners} saved winners.`);
  return tr(`Selesai: ${result.winners} pemenang dari ${result.entries} entri tersimpan.`,`Done: ${result.winners} winners from ${result.entries} saved entries.`);
 }

 function bindList(root){
  const slot=root.querySelector('#giveawayLive');
  if(!slot)return ()=>{};

  async function load(after,notice=''){
   slot.textContent=tr('Memuat daftar…','Loading list…');
   let data;
   try{data=await request('list'+(after?'?after='+encodeURIComponent(after):''))}
   catch(e){
    if(!slot.isConnected)return;
    slot.textContent=e.message;
    const retry=document.createElement('button');
    retry.type='button';retry.className='f-outline';retry.textContent=tr('COBA LAGI','RETRY');retry.onclick=()=>load(after);
    slot.append(retry);
    return;
   }
   if(!slot.isConnected)return;

   const legacy=data.legacyDetected?`<p role="alert">${tr('Ada data Giveaway lama di penyimpanan lain. Daftar ini mungkin tidak lengkap; periksa database sebelum mengambil keputusan.','Legacy giveaway data exists in another store. This list may be incomplete; check the database before deciding.')}</p>`:'';
   const table=data.giveaways.length
    ?`<div class="f-table-wrap"><table class="f-table"><thead><tr><th>${tr('HADIAH / PESAN','PRIZE / MESSAGE')}</th><th>${tr('STATUS TERSIMPAN','SAVED STATUS')}</th><th>${tr('SELESAI / ENTRI','END / ENTRIES')}</th><th>${tr('AKSI','ACTIONS')}</th></tr></thead>`
     +`<tbody>${data.giveaways.map((g,i)=>rowHtml(g,i,data.legacyDetected)).join('')}</tbody></table></div>`
    :`<p class="f-muted">${tr('Tidak ada data pada halaman ini.','No data on this page.')}</p>`;
   slot.innerHTML=`<p id="giveawayNotice" role="status" class="f-muted">${esc(notice)}</p><div id="giveawayFollowUp"></div>${legacy}`
    +`<p class="f-muted">${tr('Jumlah entri hanya jumlah tersimpan, bukan verifikasi anggota atau kelayakan. Waktu mengikuti zona waktu browser.','Entry counts are stored counts, not verification of members or eligibility. Times use the browser timezone.')}</p>`
    +`${table}<div id="giveawayNav"></div>`;

   const nav=slot.querySelector('#giveawayNav'),noticeEl=slot.querySelector('#giveawayNotice'),followUp=slot.querySelector('#giveawayFollowUp');
   const make=(label,handler)=>{const b=document.createElement('button');b.type='button';b.className='f-outline';b.textContent=label;b.onclick=handler;nav.append(b)};
   make(tr('MULAI DARI AWAL ↻','START OVER ↻'),()=>load(null));
   if(data.next)make(tr('HALAMAN BERIKUTNYA ↗','NEXT PAGE ↗'),()=>load(data.next));

   const buttons=[...slot.querySelectorAll('[data-gw-action]')];
   const setButtons=disabled=>buttons.forEach(b=>b.disabled=disabled);
   const setNav=disabled=>nav.querySelectorAll('button').forEach(b=>b.disabled=disabled);

   async function run(action,g){
    setButtons(true);setNav(true);followUp.innerHTML='';
    noticeEl.textContent=tr('Memeriksa data terbaru…','Checking latest data…');
    let posted=false;
    try{
     const latest=await request('prepare?messageId='+encodeURIComponent(g.messageId));
     const reason=refusal(action,latest);
     if(reason)throw Error(reason);
     if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(confirmation(action,latest)) : Promise.resolve(window.confirm(confirmation(action,latest)))))){
      noticeEl.textContent=tr('Dibatalkan.','Cancelled.');
      setButtons(false);setNav(false);
      return;
     }
     posted=true;
     noticeEl.textContent=action==='mark_delivered'||action==='delete_record'?tr('Menyimpan…','Saving…'):tr('Menyimpan dan menghubungi Discord…','Saving and contacting Discord…');
     const result=await request('action','POST',{messageId:g.messageId,action,revision:latest.revision,confirmed:true});
     await load(after,successText(action,result));
    }catch(e){
     // After a request was sent, the list on screen is out of date: only reloading is offered.
     const uncertain=posted&&(action==='end'||action==='reroll');
     noticeEl.textContent=e.message+(uncertain?tr(' Hasil mungkin tidak diketahui. Periksa Discord dan database sebelum mencoba lagi.',' The result may be unknown. Check Discord and the database before trying again.'):'');
     setNav(false);
     if(!posted)setButtons(false);
     // The bot could not reach the message and changed nothing: offer to drop the record alone.
     if(action==='delete'&&e.code==='GIVEAWAY_DISCORD_UNVERIFIED'){
      const only=document.createElement('button');
      only.type='button';only.className='f-outline';only.id='giveawayRecordOnly';
      only.textContent=tr(`HAPUS CATATAN SAJA (pesan ${g.messageId})`,`DELETE RECORD ONLY (message ${g.messageId})`);
      only.onclick=()=>run('delete_record',g);
      followUp.append(only);
     }
    }
   }
   buttons.forEach(button=>button.onclick=()=>{
    const g=data.giveaways[Number(button.dataset.index)];
    if(g)run(button.dataset.gwAction,g);
   });
  }

  load(null);
  return notice=>load(null,notice);
 }

 // ---- Create ------------------------------------------------------------
 const UNIT_MS={m:60_000,h:3_600_000,d:86_400_000};
 const UNIT_TEXT={m:tr('menit','minutes'),h:tr('jam','hours'),d:tr('hari','days')};
 /** "5 menit", "30 hari": the largest unit that divides the limit exactly. */
 function spanText(ms){
  for(const unit of ['d','h','m'])if(ms%UNIT_MS[unit]===0)return `${ms/UNIT_MS[unit]} ${UNIT_TEXT[unit]}`;
  return `${Math.ceil(ms/1000)} ${tr('detik','seconds')}`;
 }

 function bindCreate(root,reloadList){
  const slot=root.querySelector('#giveawayCreate');
  if(!slot)return;

  async function load(){
   slot.textContent=tr('Memuat pilihan…','Loading options…');
   let options;
   try{options=await request('options')}
   catch(e){if(slot.isConnected)showUnavailable(e.message);return}
   if(!slot.isConnected)return;
   const limits=options.limits;
   if(!Array.isArray(options.channels)||!limits)return showUnavailable(tr('Pilihan channel tidak dapat dimuat.','Could not load channel options.'));
   if(!options.channels.length)return showUnavailable(tr('Tidak ada channel teks yang dapat dipakai. Bot memerlukan izin melihat channel, mengirim pesan dan menyematkan tautan.','No usable text channels. The bot needs permission to view channels, send messages and embed links.'));
   showForm(options.channels,limits,options.channelsTruncated===true);
  }

  function showUnavailable(message){
   slot.innerHTML=`<p class="f-muted" role="status">${esc(message)}</p>`;
   const retry=document.createElement('button');
   retry.type='button';retry.className='f-outline';retry.textContent=tr('MUAT ULANG PILIHAN ↻','RELOAD OPTIONS ↻');retry.onclick=load;
   slot.append(retry);
  }

  function showForm(channels,limits,truncated){
   slot.innerHTML=`<form class="f-form" id="giveawayCreateForm"><fieldset style="border:0;padding:0;margin:0;min-width:0">`
    +`<label class="f-field"><span><b>Channel</b><small>${tr('Hanya channel teks tempat bot boleh mengirim.','Only text channels where the bot can send messages.')}${truncated?tr(' Daftar dipotong; tidak semua channel tampil.',' List truncated; not all channels are shown.'):''}</small></span>`
    +`<select name="channelId" required><option value="">${tr('Pilih channel…','Choose a channel…')}</option>`
    +`${channels.map(c=>`<option value="${esc(c.id)}"># ${esc(c.name)}</option>`).join('')}</select></label>`
    +`<label class="f-field"><span><b>${tr('Hadiah','Prize')}</b><small>${tr(`Tampil sebagai judul pesan. Maksimal ${esc(limits.prizeMaxLength)} karakter.`,`Shown as the message title. Maximum ${esc(limits.prizeMaxLength)} characters.`)}</small></span>`
    +`<input name="prize" type="text" maxlength="${esc(limits.prizeMaxLength)}" autocomplete="off" required></label>`
    +`<label class="f-field"><span><b>${tr('Jumlah pemenang','Number of winners')}</b><small>${esc(limits.minWinners)}–${esc(limits.maxWinners)}</small></span>`
    +`<input name="winnerCount" type="number" min="${esc(limits.minWinners)}" max="${esc(limits.maxWinners)}" step="1" value="1" required></label>`
    +`<label class="f-field"><span><b>${tr('Durasi','Duration')}</b><small>${esc(spanText(limits.minDurationMs))} ${tr('sampai','to')} ${esc(spanText(limits.maxDurationMs))}</small></span>`
    +`<input name="amount" type="number" min="1" max="999" step="1" value="1" required></label>`
    +`<label class="f-field"><span><b>${tr('Satuan','Unit')}</b></span><select name="unit">`
    +`<option value="m">${tr('menit','minutes')}</option><option value="h">${tr('jam','hours')}</option><option value="d" selected>${tr('hari','days')}</option></select></label>`
    +`<p id="giveawayCreateStatus" class="f-muted" role="status"></p>`
    +`<div class="f-form-actions"><span>✳ ${tr('PESAN PUBLIK','PUBLIC MESSAGE')}</span><button type="submit" class="f-primary">${tr('BUAT GIVEAWAY ↗','CREATE GIVEAWAY ↗')}</button></div>`
    +`</fieldset></form>`;
   const form=slot.querySelector('form'),fields=form.querySelector('fieldset'),status=slot.querySelector('#giveawayCreateStatus');

   form.onsubmit=async event=>{
    event.preventDefault();
    const channelId=form.elements.channelId.value;
    const channel=channels.find(c=>c.id===channelId);
    const prize=form.elements.prize.value.trim();
    const winnersText=form.elements.winnerCount.value.trim(),amountText=form.elements.amount.value.trim();
    const unit=form.elements.unit.value;
    const winnerCount=Number(winnersText),amount=Number(amountText);
    if(!channel){status.textContent=tr('Pilih channel.','Choose a channel.');return}
    if(!prize||prize.length>limits.prizeMaxLength){status.textContent=tr(`Hadiah harus 1–${limits.prizeMaxLength} karakter.`,`Prize must be 1–${limits.prizeMaxLength} characters.`);return}
    if(!/^\d{1,3}$/.test(winnersText)||winnerCount<limits.minWinners||winnerCount>limits.maxWinners){status.textContent=tr(`Jumlah pemenang harus ${limits.minWinners}–${limits.maxWinners}.`,`Number of winners must be ${limits.minWinners}–${limits.maxWinners}.`);return}
    const durationMs=amount*UNIT_MS[unit];
    if(!/^[1-9]\d{0,2}$/.test(amountText)||!UNIT_MS[unit]||durationMs<limits.minDurationMs||durationMs>limits.maxDurationMs){
     status.textContent=tr(`Durasi harus ${spanText(limits.minDurationMs)} sampai ${spanText(limits.maxDurationMs)}.`,`Duration must be ${spanText(limits.minDurationMs)} to ${spanText(limits.maxDurationMs)}.`);return;
    }
    const summary=tr(`“${prize}” di #${channel.name}, ${winnerCount} pemenang, durasi ${amount} ${UNIT_TEXT[unit]}`,`“${prize}” in #${channel.name}, ${winnerCount} winners, duration ${amount} ${UNIT_TEXT[unit]}`);
    if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Buat giveaway ${summary}? Bot akan langsung mengirim pesan publik di channel itu.`,`Create giveaway ${summary}? The bot will immediately send a public message in that channel.`)) : Promise.resolve(window.confirm(tr(`Buat giveaway ${summary}? Bot akan langsung mengirim pesan publik di channel itu.`,`Create giveaway ${summary}? The bot will immediately send a public message in that channel.`))))))return;
    fields.disabled=true;status.textContent=tr('Mengirim pesan dan menyimpan…','Sending message and saving…');
    let created;
    try{created=await request('create','POST',{channelId,prize,winnerCount,duration:`${amount}${unit}`,confirmed:true})}
    catch(e){
     if(!slot.isConnected)return;
     // The message says what was left behind; the input stays for a deliberate retry.
     status.textContent=e.message;
     fields.disabled=false;
     return;
    }
    if(!slot.isConnected)return;
    form.elements.prize.value='';
    fields.disabled=false;
    status.textContent=tr(`Giveaway dibuat: ${summary} (pesan ${created.messageId}).`,`Giveaway created: ${summary} (message ${created.messageId}).`);
    reloadList(tr('Giveaway baru dibuat.','New giveaway created.'));
   };
  }

  load();
 }

 function bind(root){
  const reloadList=bindList(root);
  bindCreate(root,reloadList);
 }
 window.ZentixGiveaway={render,bind};
})();
