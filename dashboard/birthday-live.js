/* Birthday channel and existing member records in the authenticated dashboard. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Only fixed messages from the birthday API; unexpected details remain as received.
 const API_ERRORS=new Map([
  ['Anggota ini sudah memiliki tanggal. Muat ulang daftar dan gunakan KELOLA.','This member already has a date. Reload the list and use MANAGE.'],
  ['Data berubah atau memerlukan pemeriksaan. Muat ulang dan periksa cadangan.','Data changed or needs review. Reload and check the backup.'],
  ['Gagal mengakses database persisten; hasil penyimpanan mungkin tidak diketahui. Muat ulang sebelum mencoba lagi.','Could not access the persistent database; the save outcome may be unknown. Reload before trying again.'],
  ['Halaman tidak valid.','Invalid page.'],
 ]);
 const VALIDATION_ERRORS=new Map([
  ['503\0Database tidak tersedia.','The database is unavailable.'],
  ['409\0Konfigurasi server perlu diperiksa sebelum diedit.','Server configuration needs review before editing.'],
  ['409\0Channel ulang tahun tersimpan perlu diperiksa.','The saved birthday channel needs review.'],
  ['409\0Keanggotaan tidak dapat diverifikasi. Coba lagi atau tinjau data anggota.','Membership could not be verified. Try again or review the member data.'],
  ['400\0Pengaturan channel tidak valid.','Invalid channel settings.'],
  ['400\0Pilih channel teks dari server ini.','Choose a text channel from this server.'],
  ['403\0Bot memerlukan izin View Channel, Send Messages, dan Embed Links.','The bot needs View Channel, Send Messages and Embed Links permissions.'],
  ['409\0Channel ulang tahun berubah. Muat ulang sebelum menyimpan.','The birthday channel changed. Reload before saving.'],
  ['400\0Parameter daftar tidak valid.','Invalid list parameters.'],
  ['409\0Data ulang tahun pada halaman ini perlu diperiksa.','Birthday data on this page needs review.'],
  ['400\0Tanggal ulang tahun tidak valid.','Invalid birthday date.'],
  ['400\0ID anggota tidak valid.','Invalid member ID.'],
  ['400\0Akun bot tidak dapat diberi tanggal ulang tahun.','Bot accounts cannot be given a birthday.'],
 ]);
 const apiError=(message,status)=>window.ZentixI18n?.language==='en' ? (VALIDATION_ERRORS.get(`${status}\0${message}`) ?? API_ERRORS.get(message) ?? message) : message;
 async function request(path,method='GET',body){const session=await window.ZentixSession;const response=await fetch('/dashboard/api/bot/birthday/'+path,{method,cache:'no-store',headers:body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? apiError(data.error,response.status))||tr('Permintaan gagal.','Request failed.'));return data;}
 function render(){return `<div class="f-layout"><div><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Channel ulang tahun','Birthday channel')}</h2><p>${tr('Pengumuman bot menggunakan channel ini. Kosongkan untuk menonaktifkan.','The bot posts announcements in this channel. Clear it to disable announcements.')}</p></div><span>✳</span></div><div id="liveBirthdaySettings" aria-live="polite">${tr('Memuat pengaturan…','Loading settings…')}</div></section><div class="f-callout">ⓘ &nbsp; ${tr('Pengiriman dijalankan oleh scheduler bot, bukan dashboard. Izin dan ketersediaan channel dapat berubah setelah disimpan.','Delivery is handled by the bot scheduler, not the dashboard. Channel permissions and availability can change after saving.')}</div>${renderAdd()}</div><aside><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Daftar ulang tahun','Birthday list')}</h2><p>${tr('ID anggota dan tanggal, tanpa tahun.','Member IDs and dates, without years.')}</p></div><span>✳</span></div><div id="liveBirthdayList" aria-live="polite">${tr('Memuat daftar…','Loading list…')}</div></section><p class="f-muted">${tr('Data pribadi: hanya admin/owner. Ubah atau hapus hanya dengan dasar dan izin yang sesuai. Daftar bukan backup.','Personal data: admin/owner only. Modify or delete only with an appropriate basis and permission. This list is not a backup.')}</p></aside></div>`;}
 function bind(root){
  const settings=root.querySelector('#liveBirthdaySettings'),list=root.querySelector('#liveBirthdayList');if(!settings||!list)return;
  async function loadSettings(){settings.textContent=tr('Memuat pengaturan…','Loading settings…');try{const data=await request('settings');if(!settings.isConnected)return;let expected=data.channelId;const choices=[['',tr('Nonaktif','Disabled')],...data.channels.map(c=>[c.id,'# '+c.name])];if(expected&&!data.channels.some(c=>c.id===expected))choices.push([expected,tr('ID tersimpan — tidak tersedia','Saved ID — unavailable')]);settings.innerHTML=`<p role="status" id="birthdayError" class="f-muted"></p><form class="f-form" id="birthdayForm"><fieldset style="border:0;padding:0;margin:0;min-width:0"><label class="f-field"><span><b>${tr('Channel pengumuman','Announcement channel')}</b><small>${tr('Bot memerlukan izin melihat, mengirim, dan menyematkan tautan.','The bot needs view, send and embed link permissions.')}</small></span><select name="channelId">${choices.map(([id,name])=>`<option value="${esc(id)}" ${id===(expected||'')?'selected':''}>${esc(name)}</option>`).join('')}</select></label><div class="f-form-actions"><span>✳ ${tr('SIMPAN KE BOT','SAVE TO BOT')}</span><button type="submit" class="f-primary">${tr('SIMPAN ↗','SAVE ↗')}</button></div></fieldset></form><button type="button" class="f-outline" id="reloadBirthday">${tr('MUAT ULANG ↻','RELOAD ↻')}</button>`;
   const form=settings.querySelector('form'),field=form.querySelector('fieldset'),reload=settings.querySelector('#reloadBirthday'),error=settings.querySelector('#birthdayError');reload.onclick=async ()=>{if((await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Muat ulang? Perubahan yang belum disimpan akan hilang.','Reload? Unsaved changes will be lost.')) : Promise.resolve(window.confirm(tr('Muat ulang? Perubahan yang belum disimpan akan hilang.','Reload? Unsaved changes will be lost.'))))))loadSettings()};form.onsubmit=async e=>{e.preventDefault();field.disabled=true;reload.disabled=true;error.textContent='';try{const saved=await request('settings','PATCH',{channelId:form.elements.channelId.value||null,expectedChannelId:expected});expected=saved.channelId;error.textContent=tr('Channel disimpan.','Channel saved.')}catch(e){error.textContent=e.message}finally{field.disabled=false;reload.disabled=false}};
  }catch(e){if(settings.isConnected)settings.textContent=e.message}}
  async function loadList(after){
   list.textContent=tr('Memuat daftar…','Loading list…');try{
    const data=await request('list'+(after?'?after='+encodeURIComponent(after):''));if(!list.isConnected)return;
    list.innerHTML=data.birthdays.length?`<div class="f-table-wrap"><table class="f-table"><thead><tr><th>${tr('ID ANGGOTA','MEMBER ID')}</th><th>${tr('TANGGAL','DATE')}</th><th>${tr('AKSI','ACTION')}</th></tr></thead><tbody>${data.birthdays.map((b,i)=>`<tr><td>${esc(b.userId)}</td><td>${esc(String(b.day).padStart(2,'0'))}/${esc(String(b.month).padStart(2,'0'))}</td><td><button type="button" class="f-link" data-edit="${i}" aria-label="${esc(tr(`Kelola tanggal ulang tahun anggota ${b.userId}`,`Manage birthday for member ${b.userId}`))}">${tr('KELOLA ↗','MANAGE ↗')}</button></td></tr>`).join('')}</tbody></table></div>`:`<p class="f-muted">${tr('Tidak ada data pada halaman ini.','No data on this page.')}</p>`;
    const navigation=document.createElement('div');list.append(navigation);const reload=document.createElement('button');reload.type='button';reload.className='f-outline';reload.textContent=tr('MULAI DARI AWAL ↻','START OVER ↻');reload.onclick=()=>loadList(null);navigation.append(reload);
    if(data.next){const next=document.createElement('button');next.type='button';next.className='f-outline';next.textContent=tr('HALAMAN BERIKUTNYA ↗','NEXT PAGE ↗');next.onclick=()=>loadList(data.next);navigation.append(next)}
    const editor=document.createElement('div');list.prepend(editor);
    list.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>{
     const record=data.birthdays[Number(button.dataset.edit)];if(!record)return;
     list.querySelectorAll('[data-edit]').forEach(b=>b.disabled=true);navigation.hidden=true;
     editor.innerHTML=`<form id="birthdayMemberForm" class="f-form"><fieldset style="border:0;padding:0;margin:0;min-width:0"><p><b>${tr('Anggota ','Member ')}${esc(record.userId)}</b><br><small>${tr('Periksa identitas dan izin sebelum mengubah data pribadi.','Check identity and authorization before changing personal data.')}</small></p><label class="f-field"><span><b>${tr('Hari','Day')}</b></span><input name="day" type="number" min="1" max="31" step="1" required value="${esc(record.day)}"></label><label class="f-field"><span><b>${tr('Bulan','Month')}</b></span><input name="month" type="number" min="1" max="12" step="1" required value="${esc(record.month)}"></label><p id="birthdayMemberError" class="f-muted" role="status"></p><div class="f-form-actions"><button type="submit" class="f-primary">${tr('SIMPAN TANGGAL ↗','SAVE DATE ↗')}</button><button type="button" class="f-outline" id="birthdayDelete">${tr('HAPUS TANGGAL','DELETE DATE')}</button><button type="button" class="f-outline" id="birthdayCancel">${tr('BATAL','CANCEL')}</button></div></fieldset></form>`;
     const form=editor.querySelector('form'),fields=form.querySelector('fieldset'),error=editor.querySelector('#birthdayMemberError');editor.querySelector('#birthdayCancel').onclick=()=>{editor.innerHTML='';navigation.hidden=false;list.querySelectorAll('[data-edit]').forEach(b=>b.disabled=false)};
     const save=async next=>{const label=next===null?tr('Hapus','Delete'):tr('Ubah','Change');if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(`${label} ${tr('tanggal ulang tahun anggota','birthday for member')} ${record.userId}? ${tr('Pastikan Anda memiliki izin yang sesuai.','Make sure you have the appropriate authorization.')}`) : Promise.resolve(window.confirm(`${label} ${tr('tanggal ulang tahun anggota','birthday for member')} ${record.userId}? ${tr('Pastikan Anda memiliki izin yang sesuai.','Make sure you have the appropriate authorization.')}`)))))return;fields.disabled=true;error.textContent='';try{await request('member/'+encodeURIComponent(record.userId),'PATCH',{expected:{month:record.month,day:record.day},next});const toast=document.getElementById('toast');toast.textContent=next===null?tr('Tanggal dihapus.','Date deleted.'):tr('Tanggal disimpan.','Date saved.');toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),4000);await loadList(null)}catch(e){error.textContent=e.message+tr(' Jika hasil tidak diketahui, muat ulang dan periksa sebelum mengulang.',' If the result is unknown, reload and check before retrying.');fields.disabled=false}};
     form.onsubmit=e=>{e.preventDefault();save({month:Number(form.elements.month.value),day:Number(form.elements.day.value)})};editor.querySelector('#birthdayDelete').onclick=()=>save(null);
    });
   }catch(e){if(list.isConnected){list.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.className='f-outline';retry.textContent=tr('COBA LAGI','RETRY');retry.onclick=()=>loadList(after);list.append(retry)}}
  }
  loadSettings();loadList(null);bindAdd(root,()=>{if(!list.querySelector('#birthdayMemberForm'))loadList(null)});
 }

 // ---- Add a date for a member who has none -------------------------------
 const DAYS_IN_MONTH=[31,29,31,30,31,30,31,31,30,31,30,31];
 const two=n=>String(n).padStart(2,'0');
 function renderAdd(){
  return `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Tambah tanggal','Add a date')}</h2>`
   +`<p>${tr('Untuk anggota yang belum punya tanggal. Tanggal yang sudah ada diubah lewat KELOLA pada daftar.','For members without a date. Edit existing dates using MANAGE in the list.')}</p></div><span>✳</span></div>`
   +`<div id="liveBirthdayAdd" aria-live="polite"></div></section>`;
 }
 function bindAdd(root,reloadList){
  const slot=root.querySelector('#liveBirthdayAdd');if(!slot)return;

  function askId(message=''){
   slot.innerHTML=`<form class="f-form" id="birthdayLookupForm"><label class="f-field"><span><b>${tr('ID anggota','Member ID')}</b>`
    +`<small>${tr('ID Discord 17–20 digit. Identitas diperiksa ke Discord sebelum tanggal dapat diisi.','Discord ID, 17–20 digits. Identity is checked with Discord before entering the date.')}</small></span>`
    +`<input name="userId" type="text" inputmode="numeric" maxlength="20" autocomplete="off" required></label>`
    +`<p id="birthdayAddStatus" class="f-muted" role="status">${esc(message)}</p>`
    +`<div class="f-form-actions"><span>✳ ${tr('DATA PRIBADI','PERSONAL DATA')}</span><button type="submit" class="f-primary">${tr('PERIKSA ANGGOTA ↗','CHECK MEMBER ↗')}</button></div></form>`;
   const form=slot.querySelector('form'),status=slot.querySelector('#birthdayAddStatus'),button=form.querySelector('button');
   form.onsubmit=async event=>{
    event.preventDefault();
    const userId=form.elements.userId.value.trim();
    if(!/^\d{17,20}$/.test(userId)){status.textContent=tr('ID anggota harus 17 sampai 20 digit.','Member ID must be 17 to 20 digits.');return}
    button.disabled=true;status.textContent=tr('Memeriksa anggota…','Checking member…');
    let member;
    try{member=await request('member/'+encodeURIComponent(userId))}
    catch(error){if(slot.isConnected){status.textContent=error.message;button.disabled=false}return}
    if(!slot.isConnected)return;
    if(member.bot){status.textContent=tr('ID itu milik akun bot; tidak dapat diberi tanggal.','That ID belongs to a bot account and cannot be given a birthday.');button.disabled=false;return}
    if(member.hasBirthday){status.textContent=`${member.name||member.userId} ${tr('sudah memiliki tanggal. Gunakan KELOLA pada daftar.','already has a birthday. Use MANAGE in the list.')}`;button.disabled=false;return}
    askDate(member);
   };
  }

  function askDate(member){
   const fallback=member.leapDayFallback;
   slot.innerHTML=`<form class="f-form" id="birthdayAddForm"><fieldset style="border:0;padding:0;margin:0;min-width:0">`
    +`<p><b>${esc(member.name||tr('Nama tidak tersedia','Name unavailable'))}</b><br><small>ID ${esc(member.userId)}${tr(' · anggota server saat diperiksa',' · server member at the time of the check')}</small></p>`
    +`<label class="f-field"><span><b>${tr('Hari','Day')}</b></span><input name="day" type="number" min="1" max="31" step="1" required></label>`
    +`<label class="f-field"><span><b>${tr('Bulan','Month')}</b></span><input name="month" type="number" min="1" max="12" step="1" required></label>`
    +(fallback?`<p class="f-muted">${tr('29 Februari dapat disimpan. Pada tahun tanpa tanggal itu, bot merayakannya pada ','February 29 can be saved. In years without that date, the bot celebrates on ')}${esc(two(fallback.day))}/${esc(two(fallback.month))}.</p>`:'')
    +`<p id="birthdayAddStatus" class="f-muted" role="status"></p>`
    +`<div class="f-form-actions"><button type="submit" class="f-primary">${tr('TAMBAH TANGGAL ↗','ADD DATE ↗')}</button>`
    +`<button type="button" class="f-outline" id="birthdayAddCancel">${tr('BATAL','CANCEL')}</button></div></fieldset></form>`;
   const form=slot.querySelector('form'),fields=form.querySelector('fieldset'),status=slot.querySelector('#birthdayAddStatus');
   slot.querySelector('#birthdayAddCancel').onclick=()=>askId();
   form.onsubmit=async event=>{
    event.preventDefault();
    const dayText=form.elements.day.value.trim(),monthText=form.elements.month.value.trim();
    const day=Number(dayText),month=Number(monthText);
    if(!/^\d{1,2}$/.test(dayText)||!/^\d{1,2}$/.test(monthText)||month<1||month>12||day<1||day>DAYS_IN_MONTH[month-1]){status.textContent=tr('Tanggal tidak ada di kalender. Periksa hari dan bulan.','That date does not exist. Check the day and month.');return}
    const who=`${member.name||tr('anggota','member')} (${member.userId})`;
    if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(`${tr('Tambah tanggal','Add date')} ${two(day)}/${two(month)} ${tr('untuk','for')} ${who}? ${tr('Ini data pribadi; pastikan Anda memiliki izin yang sesuai.','This is personal data; make sure you have appropriate authorization.')}`) : Promise.resolve(window.confirm(`${tr('Tambah tanggal','Add date')} ${two(day)}/${two(month)} ${tr('untuk','for')} ${who}? ${tr('Ini data pribadi; pastikan Anda memiliki izin yang sesuai.','This is personal data; make sure you have appropriate authorization.')}`)))))return;
    fields.disabled=true;status.textContent=tr('Menyimpan…','Saving…');
    try{await request('member','POST',{userId:member.userId,month,day,confirmed:true})}
    catch(error){if(slot.isConnected){status.textContent=error.message+tr(' Jika hasil tidak diketahui, muat ulang daftar dan periksa sebelum mengulang.',' If the result is unknown, reload the list and check before retrying.');fields.disabled=false}return}
    if(!slot.isConnected)return;
    askId(`${tr('Tanggal','Date')} ${two(day)}/${two(month)} ${tr('ditambahkan untuk','added for')} ${who}.`);
    reloadList();
   };
  }

  askId();
 }
 window.ZentixBirthday={render,bind};
})();
