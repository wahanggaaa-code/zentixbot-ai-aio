/* Command access from the running bot registry and persistent guild configuration. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 const errors=new Map([
  ['Pengaturan berubah atau data akses perlu diperiksa. Muat ulang.','Settings changed or access data needs review. Reload.'],
  ['Tidak dapat mengakses database; jika hasil simpan tidak diketahui, muat ulang sebelum mencoba lagi.','Cannot access the database; if the save outcome is unknown, reload before retrying.'],
  ['Daftar perintah bot belum tersedia.','The bot command list is not available yet.'],
  ['Jumlah perintah melebihi batas dashboard.','The number of commands exceeds the dashboard limit.'],
  ['Permintaan akses command terbatas tidak valid.','Invalid restricted command access request.'],
  ['Daftar role tidak valid.','Invalid role list.'],
  ['Permintaan pengaturan akses tidak valid.','Invalid access settings request.'],
  ['Perintah tidak tersedia.','The command is unavailable.'],
  ['Perintah pemulihan tidak dapat dinonaktifkan.','Recovery commands cannot be disabled.'],
  ['Kategori tidak tersedia.','The category is unavailable.'],
 ]);
 const apiError=message=>window.ZentixI18n?.language==='en'?(errors.get(message)??message):message;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function request(method='GET',body){const session=method==='GET'&&!body?null:await window.ZentixSession;const r=await fetch('/dashboard/api/bot/core/commands',{method,cache:'no-store',headers:body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error((window.ZentixI18n?.accessError?.(data.error,r.status) ?? apiError(data.error))||tr('Permintaan gagal.','Request failed.'));return data;}
 // Localize only descriptions that match the loaded built-in command exactly.
 const descriptions=new Map([
  ['ban\0Ban a user from the server','Blokir anggota dari server'],
  ['kick\0Kick a user from the server','Keluarkan anggota dari server'],
  ['massban\0Ban multiple users from the server at once','Blokir beberapa anggota dari server sekaligus'],
  ['masskick\0Kick multiple users from the server at once','Keluarkan beberapa anggota dari server sekaligus'],
  ['purge\0Delete a specific amount of messages','Hapus sejumlah pesan'],
  ['timeout\0Timeout a user for a specific duration.','Timeout anggota selama durasi tertentu.'],
  ['untimeout\0Remove timeout from a user','Hapus timeout anggota'],
  ['unban\0Unban a user from the server','Buka blokir anggota dari server'],
  ['warn\0Warn a user','Beri peringatan kepada anggota'],
  ['warnings\0View all warnings for a user','Lihat semua peringatan seorang anggota'],
  ['dm\0Send a direct message to a user (Staff only)','Kirim pesan langsung kepada anggota (khusus staff)'],
  ['lock\0Locks the current channel (prevents @everyone from sending messages).','Kunci channel ini (mencegah @everyone mengirim pesan).'],
  ['unlock\0Unlocks the current channel (allows @everyone to send messages again).','Buka kunci channel ini (mengizinkan @everyone mengirim pesan lagi).'],
  ['firstmsg\0Get a link to the first message in this channel','Ambil tautan ke pesan pertama di channel ini'],
  ['report\0Report a user to server staff, or configure where reports are sent.','Laporkan anggota kepada pengelola server, atau atur tujuan laporan.'],
  ['serverinfo\0Get detailed information about the server','Lihat informasi lengkap server'],
  ['userinfo\0Get detailed information about a user','Lihat informasi lengkap anggota'],
  ['weather\0Get real-time weather information for a location','Lihat informasi cuaca terkini untuk suatu lokasi'],
  ['wipedata\0Request removal of your personal bot data','Minta penghapusan data pribadi di bot'],
  ['define\0Look up an English word definition','Cari definisi kata bahasa Inggris'],
  ['search\0Create a Google search link','Buat tautan pencarian Google'],
  ['urban\0Search Urban Dictionary (age-restricted channels only)','Cari di Urban Dictionary (hanya channel dengan pembatasan usia)'],
  ['music\0Manage playback, queue, and voice session settings','Kelola pemutaran, antrean, dan pengaturan sesi voice'],
  ['nowplaying\0Show the currently playing track','Tampilkan lagu yang sedang diputar'],
  ['play\0Play a song or add it to the queue','Putar lagu atau tambahkan ke antrean'],
  ['queue\0Show the current music queue','Tampilkan antrean musik saat ini'],
  ['poll\0Create a simple poll with up to 10 options','Buat polling sederhana dengan maksimal 10 pilihan'],
  ['time\0Get the current time in a timezone','Lihat waktu saat ini di suatu zona waktu'],
  ['commands\0Enable or disable bot commands and categories for this server','Aktifkan atau nonaktifkan perintah dan kategori bot untuk server ini'],
  ['configwizard\0Open the server configuration dashboard and setup wizard','Buka dashboard konfigurasi dan panduan setup server'],
  ['help\0Displays the help menu with all available commands','Tampilkan menu bantuan dengan semua perintah yang tersedia'],
  ['support\0Get the link to contact the bot owner','Dapatkan tautan untuk menghubungi owner bot'],
  ['uptime\0Bot health summary: uptime, latency and statistics (owner only)','Ringkasan kondisi bot: waktu aktif, latensi, dan statistik (khusus owner)'],
  ['aichat\0Ask AI in the configured channel; content is sent to an external provider.','Tanya AI di channel yang ditentukan; isi dikirim ke provider eksternal.'],
  ["claim\u0000Claims an open ticket, assigning it to you.","Klaim tiket terbuka dan tetapkan kepada Anda."],
  ["close\u0000Closes the current ticket.","Tutup tiket saat ini."],
  ["priority\u0000Sets the priority level for the current support ticket.","Atur tingkat prioritas tiket bantuan saat ini."],
  ["ticket\u0000Manages the server's ticket system.","Kelola sistem tiket server."],
  ["transfer-ticket\u0000Transfer a claimed ticket to another staff member.","Pindahkan tiket yang telah diklaim ke staff lain."],
  ["birthday\u0000Birthday system commands","Perintah sistem ulang tahun"],
  ["jointocreate\u0000Manage Join to Create voice channels system.","Kelola sistem channel voice Join to Create."],
  ["gcreate\u0000Starts a new giveaway in a specified channel.","Mulai giveaway baru di channel yang ditentukan."],
  ["gdelete\u0000Deletes a giveaway message and removes it from the database.","Hapus pesan giveaway dan catatannya dari database."],
  ["gend\u0000Ends an active giveaway immediately and picks the winner(s).","Akhiri giveaway aktif sekarang dan pilih pemenangnya."],
  ["greroll\u0000Rerolls the winner(s) for an ended giveaway.","Pilih ulang pemenang giveaway yang telah berakhir."],
  ["leaderboard\u0000Shows the server's level leaderboard","Tampilkan papan peringkat level server"],
  ["level\u0000Manage the leveling system","Kelola sistem leveling"],
  ["rank\u0000Check your or another user's rank and level","Lihat peringkat dan level Anda atau anggota lain"],
  ["logging\u0000Manage server logging — channels, filters, and event categories.","Kelola logging server — channel, filter, dan kategori event."],
  ["birthday info\u0000View birthday information","Lihat informasi ulang tahun"],
  ["birthday list\u0000List all birthdays in the server","Lihat daftar ulang tahun di server"],
  ["birthday next\u0000Show upcoming birthdays","Tampilkan ulang tahun yang akan datang"],
  ["birthday remove\u0000Remove your birthday","Hapus tanggal ulang tahun Anda"],
  ["birthday set\u0000Set your birthday","Atur tanggal ulang tahun Anda"],
  ["birthday setchannel\u0000Set or disable the channel for birthday announcements. (Manage Server required)","Atur atau nonaktifkan channel pengumuman ulang tahun. (Memerlukan Manage Server)"],
  ["logging channel\u0000Quick-set a log channel without opening the dashboard.","Atur channel log dengan cepat tanpa membuka dashboard."],
  ["logging dashboard\u0000Open the logging dashboard — set channels, filters, and toggle categories.","Buka dashboard logging — atur channel, filter, dan kategori."],
  ["level dashboard\u0000Open the interactive leveling configuration dashboard","Buka dashboard konfigurasi leveling interaktif"],
  ["level setup\u0000Set up the leveling system — this also enables it","Atur sistem leveling — tindakan ini juga mengaktifkannya"],
  ["ticket dashboard\u0000Open the interactive ticket system dashboard","Buka dashboard sistem tiket interaktif"],
  ["ticket setup\u0000Sets up the ticket creation panel in a specified channel.","Atur panel pembuatan tiket di channel yang ditentukan."],
  ["jointocreate dashboard\u0000Configure an existing Join to Create system.","Atur sistem Join to Create yang sudah ada."],
  ["jointocreate setup\u0000Set up a new Join to Create voice channel.","Siapkan channel voice Join to Create baru."],
  ["commands dashboard\u0000Open the interactive command access dashboard","Buka dashboard akses command interaktif"],
  ["commands disable\u0000Disable a command or entire category","Nonaktifkan perintah atau seluruh kategori"],
  ["commands enable\u0000Enable a command or entire category","Aktifkan perintah atau seluruh kategori"],
  ["report file\u0000Report a user to the server moderation team.","Laporkan anggota kepada pengelola moderasi server."],
  ["report setchannel\u0000Set the channel where user reports are sent. (Manage Server required)","Atur channel tujuan laporan anggota. (Memerlukan Manage Server)"],
  ["music 247\u0000Toggle 24/7 mode (stay in voice channel when idle)","Aktifkan atau nonaktifkan mode 24/7 (tetap di channel voice saat tidak memutar)"],
  ["music clear\u0000Clear the queue","Kosongkan antrean"],
  ["music leave\u0000Disconnect the bot from the voice channel","Putuskan bot dari channel voice"],
  ["music loop\u0000Set loop mode","Atur mode pengulangan"],
  ["music move\u0000Move a track in the queue","Pindahkan lagu dalam antrean"],
  ["music pause\u0000Pause playback","Jeda pemutaran"],
  ["music remove\u0000Remove a track from the queue","Hapus lagu dari antrean"],
  ["music resume\u0000Resume playback","Lanjutkan pemutaran"],
  ["music seek\u0000Seek to a position in the current track","Pindah ke posisi tertentu pada lagu saat ini"],
  ["music shuffle\u0000Shuffle the queue","Acak antrean"],
  ["music skip\u0000Skip the current track","Lewati lagu saat ini"],
  ["music stop\u0000Stop playback and clear the queue","Hentikan pemutaran dan kosongkan antrean"],
  ["music volume\u0000Set playback volume","Atur volume pemutaran"],
 ]);
 const englishDescriptions=new Map([
  ['drafbug\0Buat draf laporan bug dengan AI lalu tinjau sebelum dikirim.','Create a bug report draft with AI and review it before sending.'],
  ['gambar\0Buat gambar AI di channel yang diizinkan; prompt dikirim ke provider eksternal.','Generate an AI image in an allowed channel; the prompt is sent to an external provider.'],
  ['personal\0Atur bahasa pribadimu untuk terjemahan (menu Terjemahkan).','Set your personal language for translation (Translate menu).'],
  ['terjemahkan\0Terjemahkan teks ke bahasa pilihan dan tampilkan hasil di channel.','Translate text into a chosen language and display the result in the channel.'],
 ]);
 const commandDescription=cmd=>(window.ZentixI18n?.language==='en'?englishDescriptions:descriptions).get(`${cmd.name}\0${cmd.description}`)??cmd.description;
 // Category names are registry data; translate only recognized key/name pairs.
 const categoryLabels=new Map([
  ['birthday\0Birthday','Ulang tahun'],['core\0Core','Inti'],['moderation\0Moderation','Moderasi'],
  ['music\0Music','Musik'],['search\0Search','Pencarian'],['ticket\0Ticket','Tiket'],
  ['tools\0Tools','Alat'],['utility\0Utility','Utilitas'],['welcome\0Welcome','Sambutan'],
 ]);
 const categoryName=cat=>window.ZentixI18n?.language==='en'?cat.name:(categoryLabels.get(`${cat.key}\0${cat.name}`)??cat.name);
 const RESTRICTED_API='/dashboard/api/bot/core/access-roles';
 async function requestRestricted(method='GET',body){const session=method==='GET'&&!body?null:await window.ZentixSession;const r=await fetch(RESTRICTED_API,{method,cache:'no-store',headers:body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error((window.ZentixI18n?.accessError?.(data.error,r.status) ?? apiError(data.error))||tr('Permintaan gagal.','Request failed.'));return data;}
 function render(){return `<div class="f-layout"><div><section class="f-panel" style="margin-bottom:12px"><div class="f-panel-head"><div><h2>${tr('Akses command terbatas','Restricted command access')}</h2><p>${tr('13 perintah moderasi + /serverinfo + /userinfo — hanya owner bot dan role yang dipilih di sini. Izin native dan Administrator tidak berlaku.','13 moderation commands + /serverinfo + /userinfo — only the bot owner and roles selected here. Native permissions and Administrator do not apply.')}</p></div></div><div id="restrictedLive" aria-live="polite">${tr('Memuat daftar role…','Loading roles…')}</div></section><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Akses perintah','Command access')}</h2><p>${tr('Daftar perintah yang dimuat bot dan pengaturan akses server.','Commands loaded by the bot and server access settings.')}</p></div></div><div id="coreLive" aria-live="polite">${tr('Memuat daftar…','Loading list…')}</div></section></div><aside><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Cara kerja','How it works')}</h2><p>${tr('Perubahan berlaku pada pemeriksaan akses bot.','Changes apply when the bot checks access.')}</p></div></div><p class="f-muted">${tr('Akses command terbatas (kartu atas) mengatur 15 perintah khusus terpisah dari daftar nonaktif di halaman ini: izin native, Administrator, dan modRole tidak berlaku; hanya owner bot + role pilihan. Kosongkan semua role → hanya owner bot.','Restricted command access (above) controls 15 special commands separately from this page’s disabled list: native permissions, Administrator and modRole do not apply; only the bot owner and selected roles. Clear all roles → bot owner only.')}</p><p class="f-muted">${tr('Nonaktif kategori memengaruhi seluruh perintah di dalamnya, kecuali perintah pemulihan yang dilindungi. Mengaktifkan perintah individu tidak mengaktifkan kategori atau induk yang nonaktif.','Disabling a category affects every command in it except protected recovery commands. Enabling an individual command does not enable a disabled category or parent.')}</p><p class="f-muted">${tr('Daftar mencerminkan kode bot yang dimuat, bukan bukti bahwa perintah sudah terdaftar di Discord atau dapat dijalankan oleh semua anggota.','This list reflects loaded bot code, not proof that commands are registered in Discord or available to every member.')}</p></section></aside></div>`;}
 function bind(root){
  const restricted=root.querySelector('#restrictedLive');
  if(restricted){
   async function loadRestricted(){restricted.textContent=tr('Memuat daftar role…','Loading roles…');try{const data=await requestRestricted('GET');let revision=data.revision;const selected=new Set(data.roleIds);
    restricted.innerHTML=`<p id="restrictedError" class="f-muted" role="status"></p><label class="f-field"><span><b>${tr('Cari role','Search roles')}</b><small>${tr('Filter daftar role server. Maksimal','Filter server roles. Maximum')} ${esc(data.limits.roles)} ${tr('role dipilih.','roles selected.')}</small></span><input id="restrictedSearch" type="search" placeholder="${tr('Cari role','Search roles')}"></label><div id="restrictedRoles" role="group" aria-label="${tr('Role akses command terbatas','Restricted command access roles')}" aria-describedby="restrictedHelp restrictedCount">${data.roles.length?data.roles.map(role=>`<label style="display:block;padding:4px 0" data-role-row><input type="checkbox" name="roleIds" value="${esc(role.id)}" aria-label="${esc(`Role ${role.name} (ID ${role.id})${role.managed ? tr(' — terkelola integrasi',' — integration managed') : ''}`)}"${selected.has(role.id)?' checked':''}${role.managed?' disabled':''}> <span>${esc(role.name||tr('Role tanpa nama','Unnamed role'))}${!role.name||data.roles.filter(other=>other.name===role.name).length>1?` · ID ${esc(role.id)}`:''}</span>${role.managed?tr(' <small>— terkelola integrasi</small>',' <small>— integration managed</small>'):''}</label>`).join(''):`<p class="f-muted">${tr('Server ini belum punya role selain @everyone. Buat role di Discord, lalu muat ulang.','This server has no roles other than @everyone. Create roles in Discord, then reload.')}</p>`}${data.roleIds.filter(id=>!data.roles.some(role=>role.id===id)).map(id=>`<label style="display:block;padding:4px 0" data-role-row><input type="checkbox" name="roleIds" value="${esc(id)}" aria-label="${esc(tr(`Role ID ${id} tersimpan — tidak ada dalam daftar`,`Saved role ID ${id} — not in the list`))}" checked> <span>${esc(tr(`Role ID ${id} tersimpan — tidak ada dalam daftar`,`Saved role ID ${id} — not in the list`))}</span></label>`).join('')}</div><p id="restrictedHelp" class="f-muted">${tr('Kosongkan semua pilihan → hanya owner bot yang boleh memakai command terbatas.','Clear all selections → only the bot owner may use restricted commands.')}${data.rolesTruncated?tr(' Daftar role dipotong; hanya 100 role pertama yang ditampilkan.',' Role list truncated; only the first 100 roles are shown.'):''}</p><div class="f-form-actions"><span id="restrictedCount" class="f-muted"></span><button type="button" id="restrictedSave" class="f-primary">${tr('SIMPAN','SAVE')}</button></div>`;
    const error=restricted.querySelector('#restrictedError'),search=restricted.querySelector('#restrictedSearch'),save=restricted.querySelector('#restrictedSave'),count=restricted.querySelector('#restrictedCount');const boxes=[...restricted.querySelectorAll('input[name=roleIds]')];
    const updateCount=()=>{const n=boxes.filter(b=>b.checked).length;count.textContent=`${tr('Terpilih:','Selected:')} ${n} / ${data.limits.roles}`;save.disabled=n>data.limits.roles};
    updateCount();boxes.forEach(b=>b.addEventListener('change',updateCount));
    search.oninput=()=>{const q=search.value.toLowerCase().trim();restricted.querySelectorAll('[data-role-row]').forEach(row=>{row.hidden=Boolean(q)&&!row.textContent.toLowerCase().includes(q)})};
    const dock=window.ZentixSaveDock?.attach(restricted,tr('Akses command terbatas','Restricted command access'),updateCount,{showLabel:true,hideOriginal:true,originalButton:save,controlsSelector:'input[name=roleIds]',submit:()=>save.click(),canSave:()=>boxes.filter(b=>b.checked).length<=data.limits.roles});let busy=false;
    save.onclick=async()=>{
     if(busy||boxes.filter(b=>b.checked).length>data.limits.roles||(dock&&!dock.start()))return;
     busy=true;save.disabled=true;const roleIds=boxes.filter(b=>b.checked).map(b=>b.value);let success=false,cancelled=false;
     const inputStates=[...restricted.querySelectorAll('input')].map(input=>[input,input.disabled]);
     try{
      const message=roleIds.length?`${tr('Simpan','Save')} ${roleIds.length} ${tr('role sebagai pemegang akses command terbatas?',roleIds.length===1?'role as a holder of restricted command access?':'roles as holders of restricted command access?')}`:tr('Kosongkan daftar role? Setelah disimpan, hanya owner bot yang boleh memakai command terbatas.','Clear the role list? After saving, only the bot owner may use restricted commands.');
      if(!(await (window.ZentixDialog?window.ZentixDialog.confirm(message):Promise.resolve(window.confirm(message))))||!restricted.isConnected){cancelled=true;return;}
      error.textContent='';inputStates.forEach(([input])=>{input.disabled=true});const result=await requestRestricted('PATCH',{confirmed:true,roleIds,revision});revision=result.revision;success=true;
      error.textContent=tr('Akses command terbatas disimpan.','Restricted command access saved.');
     }catch(e){error.textContent=e.message+tr(' Jika hasil tidak diketahui, muat ulang dan periksa sebelum mencoba lagi.',' If the result is unknown, reload and check before retrying.');}
     finally{inputStates.forEach(([input,disabled])=>{input.disabled=disabled});busy=false;updateCount();dock?.finish(success,cancelled)}
    };
   }catch(e){if(restricted.isConnected){restricted.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.className='f-outline';retry.textContent=tr('COBA LAGI','RETRY');retry.onclick=loadRestricted;restricted.append(retry)}}}
   loadRestricted();
  }
  const slot=root.querySelector('#coreLive');if(!slot)return;
  async function load(){slot.textContent=tr('Memuat daftar…','Loading list…');try{const data=await request();if(!slot.isConnected)return;let revision=data.revision;
   slot.innerHTML=`<p id="coreError" class="f-muted" role="status"></p><label class="f-field"><span><b>${tr('Cari perintah','Search commands')}</b><small>${tr('Filter berdasarkan nama atau kategori.','Filter by name or category.')}</small></span><input id="coreSearch" type="search" placeholder="${tr('Cari perintah','Search commands')}"></label><button type="button" id="coreReload" class="f-outline">${tr('MUAT ULANG ↻','RELOAD ↻')}</button><div id="coreCategories">${data.categories.map((cat,i)=>`<details class="f-panel" data-category="${i}" style="margin-top:12px"><summary><b>${esc(categoryName(cat))}</b> · ${cat.disabled?tr('KATEGORI NONAKTIF','CATEGORY DISABLED'):tr('KATEGORI AKTIF','CATEGORY ENABLED')} · ${cat.commands.length} ${tr('perintah/subperintah','commands/subcommands')}</summary><button type="button" class="f-outline" data-kind="category" data-category-index="${i}" aria-label="${esc(cat.disabled?tr(`Aktifkan kategori ${categoryName(cat)} (${cat.key})`,`Enable category ${categoryName(cat)} (${cat.key})`):tr(`Nonaktifkan kategori ${categoryName(cat)} (${cat.key})`,`Disable category ${categoryName(cat)} (${cat.key})`))}">${cat.disabled?tr('AKTIFKAN KATEGORI','ENABLE CATEGORY'):tr('NONAKTIFKAN KATEGORI','DISABLE CATEGORY')}</button><div class="f-table-wrap"><table class="f-table"><thead><tr><th>${tr('PERINTAH','COMMAND')}</th><th>${tr('STATUS EFEKTIF','EFFECTIVE STATUS')}</th><th>${tr('AKSI INDIVIDU','INDIVIDUAL ACTION')}</th></tr></thead><tbody>${cat.commands.map((cmd,j)=>`<tr data-command-row="${j}"><td><b>/${esc(cmd.name)}</b><br><small>${esc(commandDescription(cmd))}</small></td><td>${cmd.enabled?tr('AKTIF','ENABLED'):tr('NONAKTIF','DISABLED')}${cmd.protected?tr(' · DILINDUNGI',' · PROTECTED'):''}</td><td>${cmd.protected?tr('Dilindungi','Protected'):`<button type="button" class="f-link" data-kind="command" data-category-index="${i}" data-command-index="${j}" aria-label="${esc(cmd.ownDisabled?tr(`Aktifkan perintah /${cmd.name}`,`Enable command /${cmd.name}`):tr(`Nonaktifkan perintah /${cmd.name}`,`Disable command /${cmd.name}`))}">${cmd.ownDisabled?tr('AKTIFKAN','ENABLE'):tr('NONAKTIFKAN','DISABLE')}</button>`}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</div>`;
   const error=slot.querySelector('#coreError'),reload=slot.querySelector('#coreReload'),search=slot.querySelector('#coreSearch');reload.onclick=load;
   search.oninput=()=>{const q=search.value.toLowerCase().trim();slot.querySelectorAll('[data-category]').forEach(el=>{const cat=data.categories[Number(el.dataset.category)],matchCat=cat.name.toLowerCase().includes(q)||categoryName(cat).toLowerCase().includes(q);let visible=0;el.querySelectorAll('[data-command-row]').forEach(row=>{const cmd=cat.commands[Number(row.dataset.commandRow)],match=matchCat||cmd.name.toLowerCase().includes(q)||cmd.description.toLowerCase().includes(q)||commandDescription(cmd).toLowerCase().includes(q);row.hidden=!match;if(match)visible++});el.hidden=!visible&&!matchCat;if(q&&visible)el.open=true})};
   slot.querySelectorAll('[data-kind]').forEach(button=>button.onclick=async()=>{const cat=data.categories[Number(button.dataset.categoryIndex)],kind=button.dataset.kind,cmd=kind==='command'?cat.commands[Number(button.dataset.commandIndex)]:null,target=cmd?cmd.name:cat.key,disabled=cmd?!cmd.ownDisabled:!cat.disabled;if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(`${disabled?tr('Nonaktifkan','Disable'):tr('Aktifkan','Enable')} ${cmd?tr('perintah /','command /')+target:tr('kategori ','category ')+categoryName(cat)}? ${tr('Periksa dampaknya terlebih dahulu.','Review the impact first.')}`) : Promise.resolve(window.confirm(`${disabled?tr('Nonaktifkan','Disable'):tr('Aktifkan','Enable')} ${cmd?tr('perintah /','command /')+target:tr('kategori ','category ')+categoryName(cat)}? ${tr('Periksa dampaknya terlebih dahulu.','Review the impact first.')}`)))))return;
    const controls=[...slot.querySelectorAll('button,input')].map(input=>[input,input.disabled]);controls.forEach(([input])=>{input.disabled=true});error.textContent='';try{await request('PATCH',{kind,target,disabled,revision,confirmed:true});await load()}catch(e){error.textContent=e.message+tr(' Jika hasil tidak diketahui, muat ulang dan periksa sebelum mencoba lagi.',' If the result is unknown, reload and check before retrying.');controls.forEach(([input,wasDisabled])=>{input.disabled=wasDisabled})}});
  }catch(e){if(slot.isConnected){slot.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.className='f-outline';retry.textContent=tr('COBA LAGI','RETRY');retry.onclick=load;slot.append(retry)}}}
  load();
 }
 window.ZentixCore={render,bind};
})();
