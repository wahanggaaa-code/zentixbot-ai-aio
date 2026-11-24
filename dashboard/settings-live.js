/* Control center: live server information and an owner-only bot presence editor. */
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 const errors=new Map([
  ['Parameter tidak valid.','Invalid parameters.'],
  ['Status bot hanya untuk owner bot.','Bot presence is only available to the bot owner.'],
  ['Status bot tidak dapat dimuat atau disimpan; periksa database dan muat ulang untuk memastikan hasilnya.','Bot presence could not be loaded or saved; check the database and reload to verify the outcome.'],
  ['Pengaturan status tidak valid.','Invalid presence settings.'],
  ['Status online tidak valid.','Invalid online status.'],
  ['Tulisan status harus paling banyak 128 karakter tanpa karakter kontrol.','Status text must be at most 128 characters without control characters.'],
  ['Statistik hosting hanya untuk owner bot.','Hosting statistics are only available to the bot owner.'],
  ['Panel hosting belum dikonfigurasi.','The hosting panel is not configured.'],
  ['Kredensial hosting belum dikonfigurasi.','Hosting credentials are not configured.'],
  ['Tidak dapat mengambil data hosting.','Could not retrieve hosting data.'],
 ]);
 const apiError=message=>window.ZentixI18n?.language==='en'?(errors.get(message)??message):message;
 const enabled=location.pathname.startsWith('/dashboard/');
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

 async function request(path,opts={}){
  const session=await window.ZentixSession;
  const response=await fetch('/dashboard/api/bot/'+path,{cache:'no-store',...opts,headers:opts.body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{}});
  const data=await response.json();
  if(!response.ok)throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? apiError(data.error))||tr('Permintaan gagal.','Request failed.'));
  return data;
 }

 const SHORTCUTS=[
  ['features/core',tr('Akses perintah','Command access'),tr('Aktif/nonaktifkan perintah dan kategori.','Enable or disable commands and categories.')],
  ['features/welcome','Welcome & autorole',tr('Sambutan, goodbye, autorole.','Welcome, goodbye and autoroles.')],
  ['features/logging','Logging',tr('Channel audit dan event yang dicatat.','Audit channel and recorded events.')],
  ['features/birthday','Birthday',tr('Channel pengumuman dan tanggal anggota.','Announcement channel and member birthdays.')],
  ['features/giveaway','Giveaway',tr('Buat, akhiri dan hapus giveaway.','Create, end and delete giveaways.')],
  ['features/join-to-create','Join to Create',tr('Trigger voice sementara.','Temporary voice triggers.')],
  ['ai/providers',tr('Pengaturan AI','AI settings'),tr('Provider, model dan batas. Khusus owner bot.','Providers, models and limits. Bot owner only.')],
 ];

 function render(){
  return `<section class="placeholder-head"><div class="kicker"><span class="pill-num">04 / ${tr('PENGATURAN','SETTINGS')}</span><i></i> YOUR CONTROL CENTER</div>`
   +`<h1>${tr('Semua dalam','Everything under')}<br>${tr('kendali.','control.')}</h1><p>${tr('Kondisi server, penyimpanan dan akses dashboard saat ini. Owner bot juga dapat mengatur status bot di sini.','Current server status, storage and dashboard access. The bot owner can also configure bot presence here.')}</p></section>`
   +`<div class="f-layout" style="padding-top:25px"><div>`
   +`<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Server di Discord','Discord server')}</h2>`
   +`<p>${tr('Yang dilihat bot di Discord saat halaman dimuat, bukan data tersimpan.','What the bot sees on Discord when the page loads, not stored data.')}</p></div><span>✳</span></div>`
   +`<div id="settingsDiscord" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
   +`<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Status bot','Bot presence')}</h2><p>${tr('Atur status online dan tulisan di profil Discord · khusus owner bot.','Set the online status and Discord profile activity · bot owner only.')}</p></div><span>◌</span></div>`
   +`<div id="settingsPresence" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
   +`<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Tempat mengatur','Where to configure')}</h2>`
   +`<p>${tr('Pengaturan tersimpan ada di halaman masing-masing fitur.','Saved settings are on each feature page.')}</p></div><span>✳</span></div>`
   +`<div class="f-table-wrap"><table class="f-table f-table-fit"><tbody>${SHORTCUTS.map(([go,title,desc])=>`<tr><td><b>${title}</b><br><small>${desc}</small></td>`
    +`<td><button type="button" class="f-link" data-go="${go}">${tr('BUKA ↗','OPEN ↗')}</button></td></tr>`).join('')}</tbody></table></div></section>`
   +`</div><aside>`
   +`<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Penyimpanan','Storage')}</h2><p>${tr('Database yang dipakai bot.','Database used by the bot.')}</p></div><span>✳</span></div>`
   +`<div id="settingsStorage" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
   +`<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Akses &amp; izin','Access &amp; permissions')}</h2><p>${tr('Mengapa sesi ini boleh membuka dashboard.','Why this session can access the dashboard.')}</p></div><span>✳</span></div>`
   +`<div id="settingsAccess" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
   +`<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Koneksi hosting','Hosting connection')}</h2><p>${tr('Sumber statistik resource. Khusus owner bot.','Source of resource statistics. Bot owner only.')}</p></div><span>✳</span></div>`
   +`<div id="settingsHosting" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
   +`<p class="f-muted" id="settingsReadAt"></p>`
   +`<button type="button" class="f-outline" id="settingsReload">${tr('MUAT ULANG ↻','RELOAD ↻')}</button>`
   +`</aside></div>`;
 }

 const line=(label,value)=>`<tr><td>${label}</td><td>${value}</td></tr>`;
 const table=rows=>`<div class="f-table-wrap"><table class="f-table f-table-fit"><tbody>${rows.join('')}</tbody></table></div>`;
 const unknown=`<i>${tr('tidak tersedia','unavailable')}</i>`;
 const number=value=>value===null||value===undefined?unknown:esc(new Intl.NumberFormat(tr('id-ID','en-US')).format(value));
 const time=value=>value===null||value===undefined?unknown:esc(new Date(value).toLocaleString(tr('id-ID','en-US'),{hour12:false}));
 function duration(ms){
  if(ms===null||ms===undefined)return unknown;
  const minutes=Math.floor(ms/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60);
  const unit=(n,id,en)=>`${n} ${tr(id,en+(n===1?'':'s'))}`;
  return esc(days?`${unit(days,'hari','day')} ${unit(hours,'jam','hour')}`:hours?`${unit(hours,'jam','hour')} ${unit(minutes%60,'menit','minute')}`:unit(minutes,'menit','minute'));
 }

 // Translate only known built-in API descriptions; preserve unexpected server-provided text.
 const permissionText={
  ViewChannel:[['Melihat channel','View channels'],['semua fitur','all features']],
  SendMessages:[['Mengirim pesan','Send messages'],['welcome, goodbye, birthday, giveaway, tiket','welcome, goodbye, birthday, giveaway, tickets']],
  EmbedLinks:[['Menyematkan tautan','Embed links'],['hampir semua pesan bot','most bot messages']],
  AttachFiles:[['Melampirkan file','Attach files'],['tiket','tickets']],
  ReadMessageHistory:[['Membaca riwayat pesan','Read message history'],['tiket','tickets']],
  ManageMessages:[['Mengelola pesan','Manage messages'],['moderation','moderation']],
  ManageRoles:[['Mengelola peran','Manage roles'],['autorole, reaction role','autorole, reaction role']],
  ManageChannels:[['Mengelola channel','Manage channels'],['tiket, Join to Create, server stats','tickets, Join to Create, server stats']],
  MoveMembers:[['Memindahkan anggota','Move members'],['Join to Create','Join to Create']],
  KickMembers:[['Mengeluarkan anggota','Kick members'],['moderation','moderation']],
  BanMembers:[['Memblokir anggota','Ban members'],['moderation','moderation']],
  ModerateMembers:[['Timeout anggota','Timeout members'],['moderation','moderation']],
  Connect:[['Terhubung ke voice','Connect to voice'],['music, Join to Create','music, Join to Create']],
  Speak:[['Berbicara di voice','Speak in voice'],['music','music']],
 };
 function permissionDescription(item,index){const raw=index===0?item.label:item.usedBy,pair=permissionText[item.key]?.[index];return pair&&raw===pair[0]?tr(pair[0],pair[1]):raw;}
 function discordHtml({guild,bot}){
  const rows=[
   line(tr('Nama server','Server name'),`<b>${esc(guild.name)}</b>`),
   line(tr('ID server','Server ID'),esc(guild.id)),
   line(tr('Anggota','Members'),number(guild.memberCount)),
   line(tr('Owner server','Server owner'),guild.ownerId?esc(guild.ownerId):unknown),
   line('Bot',bot.ready?tr('TERHUBUNG','CONNECTED'):tr('<b>TIDAK TERHUBUNG</b>','<b>NOT CONNECTED</b>')),
   line('Ping gateway',bot.ping===null?unknown:`${esc(bot.ping)} ms`),
   line(tr('Aktif selama','Uptime'),duration(bot.uptimeMs)),
  ];
  if(bot.highestRole){
   const above=bot.highestRole.rolesAbove;
   rows.push(line(tr('Peran tertinggi bot','Bot highest role'),`${esc(bot.highestRole.name)}<br><small>${above?`${esc(above)} ${tr('peran berada di atasnya dan tidak dapat diberikan atau dicabut oleh bot.',above===1?'role is above it and cannot be assigned or removed by the bot.':'roles are above it and cannot be assigned or removed by the bot.')}`:tr('Tidak ada peran di atasnya.','There are no roles above it.')}</small>`));
  }
  let permissions=`<p class="f-muted">${tr('Izin bot tidak dapat dibaca dari Discord saat ini.','Bot permissions cannot currently be read from Discord.')}</p>`;
  if(bot.permissions){
   const missing=bot.permissions.items.filter(item=>!item.granted);
   const summary=bot.permissions.administrator
    ?tr('Bot memiliki izin Administrator, sehingga semua izin di bawah berlaku.','The bot has Administrator permission, so all permissions below apply.')
    :missing.length?`${missing.length} ${tr('izin belum dimiliki bot di tingkat server. Fitur yang memakainya bisa gagal.','server-level permissions are missing. Features that use them may fail.')}`
    :tr('Semua izin yang diperiksa dimiliki bot di tingkat server.','The bot has all checked permissions at server level.');
   permissions=`<p id="settingsPermissionSummary" class="f-muted" role="status">${esc(summary)}</p>`
    +`<div class="f-table-wrap"><table class="f-table f-table-fit"><thead><tr><th>${tr('IZIN BOT','BOT PERMISSION')}</th><th>${tr('CONTOH PEMAKAI','EXAMPLE USE')}</th><th>STATUS</th></tr></thead><tbody>`
    +bot.permissions.items.map(item=>`<tr><td>${esc(permissionDescription(item,0))}</td><td>${esc(permissionDescription(item,1))}</td>`
     +`<td data-permission="${esc(item.key)}">${item.granted?tr('ADA','GRANTED'):tr('<b>TIDAK ADA</b>','<b>MISSING</b>')}</td></tr>`).join('')
    +`</tbody></table></div><p class="f-muted">${tr('Ini izin tingkat server. Pengaturan per channel dan urutan peran dapat tetap menghalangi bot di tempat tertentu.','These are server-level permissions. Per-channel settings and role order may still restrict the bot in specific places.')}</p>`;
  }
  return table(rows)+permissions;
 }

 const BACKEND={postgresql:'PostgreSQL',sqlite:'SQLite',memory:tr('Memori (tidak tersimpan)','Memory (not persisted)'),none:tr('Belum ada','None'),unknown:tr('Tidak dikenal','Unknown')};
 const STORAGE_STATUS={
  connected:[tr('TERHUBUNG','CONNECTED'),tr('Database menjawab saat halaman dimuat.','The database responded when the page loaded.')],
  degraded:[tr('MODE CADANGAN','FALLBACK MODE'),tr('Bot berjalan tanpa database utamanya. Perubahan mungkin tidak tersimpan.','The bot is running without its primary database. Changes may not be saved.')],
  unavailable:[tr('TIDAK TERSEDIA','UNAVAILABLE'),tr('Database tidak menjawab. Halaman fitur akan menolak membaca atau menyimpan.','The database is not responding. Feature pages will reject reads and writes.')],
 };
 function storageHtml(storage){
  const [label,note]=STORAGE_STATUS[storage.status]||[tr('TIDAK DIKENAL','UNKNOWN'),''];
  return table([
   line(tr('Jenis','Type'),esc(BACKEND[storage.backend]||BACKEND.unknown)),
   line('Status',`<b id="settingsStorageStatus">${label}</b><br><small>${esc(note)}</small>`),
  ]);
 }

 function accessHtml(access,dashboard){
  const basis=access.isGuildOwner?tr('Owner server','Server owner'):access.isAdministrator?tr('Memiliki izin Administrator','Has Administrator permission'):tr('Tidak dapat dipastikan','Cannot determine');
  const roles=access.adminRoles.length
   ?`<ul>${access.adminRoles.map(role=>`<li>${esc(role.name)}${role.managed?tr(' <small>(milik bot/integrasi)</small>',' <small>(bot/integration managed)</small>'):''}</li>`).join('')}</ul>`
    +(access.adminRolesTruncated?`<p class="f-muted">${tr('Daftar dipotong; ada peran lain.','List truncated; more roles exist.')}</p>`:'')
   :`<p class="f-muted">${tr('Tidak ada peran dengan izin Administrator. Hanya owner server yang dapat masuk.','No roles have Administrator permission. Only the server owner can sign in.')}</p>`;
  return table([
   line(tr('Akun','Account'),`<b>${esc(access.user.username)}</b><br><small>${esc(access.user.id)}</small>`),
   line(tr('Dasar akses','Access basis'),`<span id="settingsAccessBasis">${esc(basis)}</span>`),
   line('Owner bot',access.isBotOwner?tr('YA<br><small>Dapat membuka statistik hosting dan pengaturan AI.</small>','YES<br><small>Can access hosting statistics and AI settings.</small>'):tr('BUKAN<br><small>Statistik hosting dan pengaturan AI tidak tersedia.</small>','NO<br><small>Hosting statistics and AI settings are unavailable.</small>')),
   line(tr('Sesi berakhir','Session expires'),time(access.sessionExpiresAt)),
  ])
   +`<p class="f-muted">${tr('Dashboard terbuka untuk owner server dan siapa pun yang memiliki izin Administrator. Izin diperiksa ulang ke Discord pada setiap permintaan; mencabut peran langsung mencabut akses.','The dashboard is available to the server owner and anyone with Administrator permission. Permissions are rechecked with Discord on every request; removing a role revokes access immediately.')}</p>`
   +(dashboard?.insecureHttp===true?`<p class="f-callout" id="settingsHttpNote"><b>${tr('Tanpa enkripsi.','Not encrypted.')}</b> ${tr('Dashboard ini dibuka lewat HTTP biasa. Sesi login Anda dapat dibaca oleh pihak di jaringan yang sama atau di antara Anda dan server. Hindari Wi-Fi umum, dan tekan KELUAR setelah selesai.','This dashboard uses plain HTTP. Your login session can be read by others on the same network or between you and the server. Avoid public Wi-Fi and log out when finished.')}</p>`:'')
   +(dashboard?.sessionStore==='process'?`<p class="f-muted" id="settingsSessionNote">${tr('Sesi disimpan di memori proses bot. Saat bot dimulai ulang, semua orang harus login lagi.','Sessions are stored in bot process memory. Everyone must log in again after a bot restart.')}</p>`:'')
   +`<p><b>${tr('Peran dengan izin Administrator','Roles with Administrator permission')}</b></p>${roles}`
   +`<button type="button" class="f-outline" id="settingsLogout">${tr('KELUAR','LOG OUT')}</button>`;
 }

 function bind(root){
  const slots={
   discord:root.querySelector('#settingsDiscord'),
   storage:root.querySelector('#settingsStorage'),
   access:root.querySelector('#settingsAccess'),
   hosting:root.querySelector('#settingsHosting'),
   presence:root.querySelector('#settingsPresence'),
  };
  const readAt=root.querySelector('#settingsReadAt'),reload=root.querySelector('#settingsReload');
  if(!slots.discord||!reload)return;

  function hostingState(value){
   const labels={running:tr('berjalan','running'),starting:tr('memulai','starting'),stopping:tr('menghentikan','stopping'),offline:tr('offline','offline'),unknown:tr('tidak diketahui','unknown')};
   return Object.hasOwn(labels,value)?labels[value]:value;
  }

  function bindHosting(hosting){
   const slot=slots.hosting;
   if(hosting.configured===null){slot.innerHTML=`<p class="f-muted">${tr('Hanya owner bot yang dapat melihat koneksi hosting.','Only the bot owner can view the hosting connection.')}</p>`;return}
   if(!hosting.configured){slot.innerHTML=`<p class="f-muted">${tr('Belum dikonfigurasi. Panel, ID server dan kunci API hosting diatur lewat environment bot, bukan dari dashboard.','Not configured. The panel, server ID and hosting API key are configured in the bot environment, not in the dashboard.')}</p>`;return}
   slot.innerHTML=`<p class="f-muted">${tr('Dikonfigurasi lewat environment bot. Nilainya tidak ditampilkan.','Configured in the bot environment. Values are not displayed.')}</p>`
    +'<p id="settingsHostingStatus" class="f-muted" role="status"></p>'
    +`<button type="button" class="f-outline" id="settingsHostingCheck">${tr('PERIKSA KONEKSI ↗','CHECK CONNECTION ↗')}</button>`;
   const status=slot.querySelector('#settingsHostingStatus'),button=slot.querySelector('#settingsHostingCheck');
   button.onclick=async()=>{
    button.disabled=true;status.textContent=tr('Menghubungi panel hosting…','Contacting hosting panel…');
    try{
     const data=await request('hosting');
     if(slot.isConnected)status.textContent=`${tr('Panel menjawab. Status server:','Panel responded. Server status:')} ${hostingState(data.status)}.`;
    }catch(e){if(slot.isConnected)status.textContent=e.message}
    finally{button.disabled=false}
   };
  }

  async function bindPresence(isOwner){
   const slot=slots.presence;
   if(!isOwner){slot.textContent=tr('Hanya owner bot yang dapat mengubah status bot.','Only the bot owner can change bot presence.');return;}
   slot.textContent=tr('Memuat status bot…','Loading bot presence…');
   let data;
   try{data=await request('presence')}catch(e){if(slot.isConnected)slot.textContent=e.message;return;}
   if(!slot.isConnected)return;
   const {status,text}=data.settings;
   const labels={online:'Online',idle:tr('Tidak aktif','Idle'),dnd:tr('Jangan ganggu','Do Not Disturb'),invisible:tr('Tidak terlihat','Invisible')};
   slot.innerHTML=`<form id="botPresenceForm" class="f-form"><label class="f-field"><span><b>${tr('Status online','Online status')}</b><small>${tr('Tidak terlihat membuat bot tampak offline.','Invisible makes the bot appear offline.')}</small></span><select name="status">${Object.entries(labels).map(([id,label])=>`<option value="${id}" ${id===status?'selected':''}>${label}</option>`).join('')}</select></label><label class="f-field"><span><b>${tr('Tulisan status','Status text')}</b><small>${tr('Maksimal 128 karakter. Kosongkan untuk menghapus tulisan.','Maximum 128 characters. Leave empty to clear the text.')}</small></span><input name="text" type="text" maxlength="128" value="${esc(text)}" placeholder="${tr('mis. Siap membantu ✨','e.g. Ready to help ✨')}"></label><div class="f-feature-note"><p><b>${tr('Preview profil bot','Bot profile preview')}</b><br><span id="presencePreviewStatus"></span><br><span id="presencePreviewText"></span></p></div><div class="f-form-actions"><span>✳ ${tr('TERSIMPAN DI DATABASE','SAVED IN DATABASE')}</span><button type="submit" class="f-primary">${tr('SIMPAN STATUS ↗','SAVE STATUS ↗')}</button></div></form><p class="f-muted" id="presenceResult" role="status"></p>`;
   const form=slot.querySelector('form'),out=slot.querySelector('#presenceResult'),button=form.querySelector('button');
   function preview(){slot.querySelector('#presencePreviewStatus').textContent=labels[form.elements.status.value]||'—';slot.querySelector('#presencePreviewText').textContent=form.elements.text.value.trim()||tr('Tanpa tulisan status','No status text');}
   form.addEventListener('input',preview);form.addEventListener('change',preview);preview();
   form.onsubmit=async e=>{e.preventDefault();button.disabled=true;out.textContent=tr('Menyimpan…','Saving…');
    try{const result=await request('presence',{method:'PATCH',body:JSON.stringify({status:form.elements.status.value,text:form.elements.text.value})});form.elements.text.value=result.settings.text;preview();out.textContent=result.sent?tr('Tersimpan dan dikirim ke Discord. Tampilan dapat membutuhkan waktu untuk diperbarui.','Saved and sent to Discord. The display may take time to update.'):tr('Tersimpan, tetapi belum dapat dikirim ke Discord. Status akan dicoba lagi saat bot restart atau Anda menyimpan ulang.','Saved, but could not be sent to Discord yet. It will be retried when the bot restarts or you save again.');}
    catch(error){out.textContent=error.message}finally{button.disabled=false}
   };
  }

  async function load(){
   reload.disabled=true;
   for(const slot of Object.values(slots))slot.textContent=tr('Memuat…','Loading…');
   readAt.textContent='';
   let data;
   try{data=await request('control-center')}
   catch(e){
    if(!slots.discord.isConnected)return;
    // One failed read: nothing on the page may look current.
    for(const slot of Object.values(slots))slot.textContent=tr('Tidak dapat dimuat.','Could not load.');
    slots.discord.textContent=e.message;
    reload.disabled=false;
    return;
   }
   if(!slots.discord.isConnected)return;
   slots.discord.innerHTML=discordHtml(data.discord);
   slots.storage.innerHTML=storageHtml(data.storage);
   slots.access.innerHTML=accessHtml(data.access,data.dashboard);
   slots.access.querySelector('#settingsLogout').onclick=()=>document.getElementById('profileButton').click();
   bindHosting(data.hosting);
   bindPresence(data.access.isBotOwner);
   readAt.textContent=`${tr('Dibaca','Read at')} ${new Date(data.readAt).toLocaleString(tr('id-ID','en-US'),{hour12:false})}. ${tr('Halaman tidak memperbarui diri; muat ulang untuk kondisi terbaru.','This page does not refresh automatically; reload for the latest status.')}`;
   reload.disabled=false;
  }
  reload.onclick=load;
  load();
 }

 window.ZentixSettings={enabled,render,bind};
})();
