/* Dashboard mode switch, shared request helper, connected overview and welcome. Other pages have their own *-live.js module. */
(() => {
  const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
  const enabled=location.pathname.startsWith('/dashboard/');
  if (enabled) {
    const strip = document.querySelector('.demo-strip');
    if (strip) strip.remove();   // the connected dashboard needs no simulation banner
  }
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notify=text=>{const t=document.getElementById('toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4000)};
  // Translate only messages defined by the system usage API.
  const usageErrors=new Map([
    ['Pemakaian sistem hanya untuk owner bot.','System usage is only available to the bot owner.'],
    ['Pemakaian sistem tidak dapat dibaca.','System usage cannot be read.'],
  ]);
  async function request(path,opts={}) {
    const session=(!opts.method || opts.method==='GET')&&!opts.body?null:await window.ZentixSession;
    const res=await fetch('/dashboard/api/bot/'+path,{cache:'no-store',...opts,headers:{...(opts.body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{}),...opts.headers}});
    const data=await res.json(); const greeting=path==='welcome'||path.startsWith('welcome/')||path.startsWith('greeting-banner/'); const error=greeting ? (window.ZentixI18n?.greetingError?.(data.error) ?? data.error) : path==='system-usage' && window.ZentixI18n?.language==='en' ? (usageErrors.get(data.error) ?? data.error) : data.error; if(!res.ok)throw Object.assign(Error((window.ZentixI18n?.accessError?.(data.error,res.status) ?? error) || tr('Permintaan gagal.','Request failed.')),{status:res.status}); return data;
  }

  // ---- Overview, "02 / PEMAKAIAN SISTEM": CPU, memory, network and disk of the bot's host, asked every 3 seconds.
  const USAGE_EVERY=3000, USAGE_FIRST=1000, USAGE_AFTER_ERROR=15000;
  const amount=(value,unit)=>[value>=100?String(Math.round(value)):value.toFixed(1).replace(/\.0$/,''),unit];
  const bytes=value=>value>=1073741824?amount(value/1073741824,' GB'):value>=1048576?amount(value/1048576,' MB'):value>=1024?amount(value/1024,' KB'):amount(value,' B');
  const plain=value=>value===null||value===undefined?'—':bytes(value).join('');
  const share=(part,whole)=>part===null||part===undefined||!(whole>0)?0:Math.max(0,Math.min(100,part/whole*100));
  function usage(root) {
    const box=root.querySelector('#systemUsage'); if(!box)return;
    clearTimeout(window.ZentixUsageTimer);document.removeEventListener('visibilitychange',window.ZentixUsageWake);
    const state=box.querySelector('.usage-state'), foot=box.querySelectorAll('.usage-foot span');
    const card=name=>box.querySelector(`[data-usage="${name}"]`);
    // Every value goes in as text: nothing from the server is read as HTML.
    const big=(name,pair)=>{const el=card(name)?.querySelector('.usage-value');if(!el)return;el.textContent=pair?pair[0]:'—';if(pair){const unit=document.createElement('span');unit.textContent=pair[1];el.append(unit)}};
    const sub=(name,text)=>{const el=card(name)?.querySelector('.usage-sub');if(el)el.textContent=text};
    const bar=(name,percent)=>{const el=card(name)?.querySelector('.progress i');if(el)el.style.width=`${percent}%`;card(name)?.classList.toggle('usage-high',percent>=90)};
    const flow=(index,value)=>{const row=card('network')?.querySelectorAll('.usage-net div')[index];if(!row)return;const pair=value===null?null:bytes(value);row.querySelector('b').textContent=pair?pair[0]:'—';row.querySelector('span').textContent=pair?`${pair[1]}/s`:''};
    const blank=(text,left,right)=>{for(const name of ['cpu','memory','disk']){big(name,null);sub(name,text);bar(name,0)}flow(0,null);flow(1,null);sub('network',text);foot[0].textContent=left;foot[1].textContent=right};
    const paint=d=>{
      const container=d.scope==='container';
      big('cpu',d.cpu.percent===null?null:amount(d.cpu.percent,'%'));
      sub('cpu',d.cpu.limitPercent===null?`${d.cpu.cores} ${tr('INTI · TANPA BATAS','CORES · NO LIMIT')}`:`${tr('DARI','OF')} ${d.cpu.limitPercent}%`);
      bar('cpu',share(d.cpu.percent,d.cpu.limitPercent??d.cpu.cores*100));
      big('memory',bytes(d.memory.usedBytes));
      sub('memory',`${d.memory.limited?tr('DARI','OF'):tr('RAM MESIN','HOST RAM')} ${plain(d.memory.totalBytes)}`);
      bar('memory',share(d.memory.usedBytes,d.memory.totalBytes));
      flow(0,d.network.inBytesPerSecond);flow(1,d.network.outBytesPerSecond);
      sub('network',d.network.inBytes===null?tr('TIDAK TERBACA','UNAVAILABLE'):`TOTAL ↓ ${plain(d.network.inBytes)} · ↑ ${plain(d.network.outBytes)}`);
      big('disk',d.disk.usedBytes===null?null:bytes(d.disk.usedBytes));
      sub('disk',d.disk.usedBytes===null?tr('MENGHITUNG…','CALCULATING…'):`${d.disk.complete===false?tr('LEBIH DARI INI · ','AT LEAST · '):''}${d.disk.limitBytes===null?tr('KUOTA BELUM DIISI','QUOTA NOT SET'):`${tr('DARI','OF')} ${plain(d.disk.limitBytes)}`}`);
      bar('disk',share(d.disk.usedBytes,d.disk.limitBytes));
      state.textContent=d.panel?.state?`● LIVE · ${String(d.panel.state).toUpperCase()}`:'● LIVE';
      foot[0].textContent=container?tr('DIUKUR DI DALAM KONTAINER BOT','MEASURED INSIDE BOT CONTAINER'):tr('DI LUAR KONTAINER: CPU & RAM MILIK PROSES BOT','OUTSIDE CONTAINER: CPU & RAM OF BOT PROCESS');
      foot[1].textContent=`REFRESH / ${USAGE_EVERY/1000} ${tr('DETIK','SECONDS')} · DISK / ${d.disk.source==='panel'?'PANEL':tr('5 MENIT','5 MINUTES')}`;
    };
    const later=ms=>{window.ZentixUsageTimer=setTimeout(tick,ms)};
    async function tick() {
      if(!box.isConnected)return;   // another page is shown: stop asking
      if(document.hidden)return;    // nobody is looking: wait for the tab to come back (see `wake`)
      try {
        const d=await request('system-usage'); if(!box.isConnected)return;
        paint(d); later(d.cpu.percent===null?USAGE_FIRST:USAGE_EVERY);   // the first answer has no rates yet
      } catch(e) {
        if(!box.isConnected)return;
        const denied=e.status===403, gone=e.status===401;
        state.textContent=denied?tr('KHUSUS OWNER BOT','BOT OWNER ONLY'):tr('○ TIDAK TERSEDIA','○ UNAVAILABLE');
        blank(denied?tr('KHUSUS OWNER','OWNER ONLY'):tr('TIDAK TERSEDIA','UNAVAILABLE'),e.message||tr('Pemakaian sistem tidak dapat dibaca.','System usage cannot be read.'),denied||gone?'':tr('MENCOBA LAGI / 15 DETIK','RETRYING / 15 SECONDS'));
        if(!denied&&!gone)later(USAGE_AFTER_ERROR);
      }
    }
    const wake=window.ZentixUsageWake=()=>{if(!box.isConnected)return document.removeEventListener('visibilitychange',wake);if(!document.hidden){clearTimeout(window.ZentixUsageTimer);tick()}};
    document.addEventListener('visibilitychange',wake);
    state.textContent=tr('MEMUAT','LOADING');blank(tr('MEMUAT…','LOADING…'),tr('MENGAMBIL DATA DARI BOT…','FETCHING DATA FROM BOT…'),'');
    tick();
  }
  function welcome() {return `<div class="f-layout"><div><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Welcome terhubung','Connected welcome')}</h2><p>${tr('Memuat pengaturan yang tersimpan di bot…','Loading settings saved in the bot…')}</p></div></div><div id="liveWelcome">${tr('Memuat…','Loading…')}</div></section></div><aside><section class="f-panel"><div class="f-panel-head"><div><h2>Preview Discord</h2><p>${tr('Perkiraan tampilan dari pengaturan di formulir.','Approximate preview of the form settings.')}</p></div></div><div class="discord-demo"><div class="discord-avatar">Z</div><div class="discord-copy"><div><strong>ZentixBot</strong> <span class="discord-bot">BOT</span></div><div class="welcome-container-preview greeting-preview-container" style="background:#2b2d31;border:1px solid #1e1f22;border-left:4px solid #57f287;border-radius:14px;padding:16px;color:#dbdee1;white-space:pre-wrap"><b id="livePreviewTitle">🎉 Welcome!</b><p id="livePreviewMessage"></p><div id="livePreviewUser" class="greeting-preview-field"><b>User</b><br>${tr('anggota-contoh','example-member')} (123456789012345678)</div><div id="livePreviewCount" class="greeting-preview-field"><b>Member Count</b><br>100</div><small id="livePreviewFooter"></small><img id="livePreviewImage" alt="${tr('Preview gambar welcome','Welcome image preview')}" style="display:block;max-width:100%;max-height:180px;margin-top:12px" hidden></div></div></div><div class="f-preview-action"><button type="button" id="liveTest" class="f-outline" disabled>${tr('KIRIM TES','SEND TEST')}</button></div><p class="f-muted greeting-test-note">${tr('Tes menggunakan pengaturan yang sudah disimpan dan tidak melakukan ping.','The test uses saved settings and does not ping.')}</p></section></aside></div>`;}
  const field=(label,help,control)=>`<label class="f-field"><span><b>${label}</b><small>${help}</small></span>${control}</label>`;
  function bindWelcome(root) {
    const slot=root.querySelector('#liveWelcome'); if(!slot)return;
    request('welcome').then(({welcome:w,channels,roles})=>{
      if(!slot.isConnected)return;
      const options=(list,selected,prefix)=>[['',tr('Belum dipilih','Not selected')],...list.map(i=>[i.id,`${prefix}${i.name}${list.filter(x=>x.name===i.name).length>1?` · ID ${i.id}`:''}`]),...(selected && !list.some(i=>i.id===selected)?[[selected,`${tr('ID tersimpan — tidak tersedia / tidak dapat dikelola','Saved ID — unavailable / not manageable')} · ${selected}`]]:[])].map(([v,l])=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(l)}</option>`).join('');
      const embed=w.welcomeEmbed||{}; const color=embed.color===null?null:Number.isInteger(embed.color)?embed.color:0x57f287;
      slot.innerHTML=`<form class="f-form" id="realWelcome">${field(tr('Aktifkan welcome','Enable welcome'),tr('Kirim pesan saat anggota bergabung.','Send a message when a member joins.'),`<span class="f-check"><input type="checkbox" name="enabled" ${w.enabled?'checked':''}><span class="fake-switch"></span></span>`)}${field(tr('Channel welcome','Welcome channel'),tr('Channel teks server.','Server text channel.'),`<select name="channelId">${options(channels,w.channelId||'','# ')}</select>`)}${field(tr('Pesan','Message'),tr('Variabel: {user}, {server}, {memberCount}.','Variables: {user}, {server}, {memberCount}.'),`<textarea name="welcomeMessage" rows="4" maxlength="1500" required>${esc(w.welcomeMessage)}</textarea>`)}${field(tr('Ping anggota','Ping member'),tr('Mention anggota di konten pesan.','Mention the member in message content.'),`<span class="f-check"><input type="checkbox" name="welcomePing" ${w.welcomePing?'checked':''}><span class="fake-switch"></span></span>`)}${field(tr('URL gambar','Image URL'),tr('HTTPS, opsional.','HTTPS, optional.'),`<input name="welcomeImage" type="url" value="${esc(w.welcomeImage||'')}" maxlength="1000">`)}<fieldset class="f-field" aria-labelledby="welcomeAutoroleTitle" aria-describedby="welcomeAutoroleHelp"><span><b id="welcomeAutoroleTitle">Autorole</b><small id="welcomeAutoroleHelp">${tr('Bot harus dapat mengelola role. Boleh lebih dari satu, paling banyak 5; yang tidak dapat dikelola dihapus saat menyimpan.','The bot must be able to manage roles. Select up to 5; roles it cannot manage are removed on save.')}</small></span><div class="f-picker">${roles.length ? roles.map(r=>`<label><input type="checkbox" name="roleIds" value="${esc(r.id)}" aria-label="${esc(`Autorole ${r.name} (ID ${r.id})`)}" ${(w.roleIds||[]).includes(r.id)?'checked':''}> @ ${esc(r.name)}${!r.name||roles.filter(other=>other.name===r.name).length>1?` · ID ${esc(r.id)}`:''}</label>`).join('') : `<small>${tr('Tidak ada role yang dapat dikelola bot.','No roles the bot can manage.')}</small>`}${(w.roleIds||[]).filter(id=>!roles.some(r=>r.id===id)).map(id=>`<label><input type="checkbox" value="${esc(id)}" aria-label="${esc(tr(`Autorole ID ${id} tersimpan — akan dihapus saat disimpan`,`Saved autorole ID ${id} — will be removed on save`))}" disabled> ${tr('ID tersimpan — akan dihapus saat disimpan','Saved ID — will be removed on save')} · ${esc(id)}</label>`).join('')}</div></fieldset>${field(tr('Judul container','Container title'),tr('Maksimum 256 karakter.','Maximum 256 characters.'),`<input name="title" maxlength="256" required value="${esc(embed.title||'🎉 Welcome!')}">`)}${field(tr('Tampilkan User','Show User'),tr('Tampilkan nama dan ID anggota di container (tidak mengubah isi pesan atau ping).','Show member name and ID in the container (does not change message content or pings).'),`<span class="f-check"><input type="checkbox" name="showUser" ${embed.showUser!==false?'checked':''}><span class="fake-switch"></span></span>`)}${field(tr('Tampilkan Member Count','Show Member Count'),tr('Tampilkan jumlah anggota di container.','Show member count in the container.'),`<span class="f-check"><input type="checkbox" name="showMemberCount" ${embed.showMemberCount!==false?'checked':''}><span class="fake-switch"></span></span>`)}${field(tr('Footer container','Container footer'),tr('Variabel welcome didukung.','Welcome variables are supported.'),`<input name="footer" maxlength="1024" value="${esc(embed.footer||'Welcome to {server}!')}">`)}<div class="f-field"><span><b>${tr('Warna container','Container color')}</b><small>${tr('Pilih warna, masukkan kode Hex atau RGB, atau gunakan preset.','Choose a color, enter a Hex or RGB code, or use a preset.')}</small></span>${window.ZentixGreetingColor?.render(color===null?'':'#'+color.toString(16).padStart(6,'0'),'#57f287',{optional:true})||`<input name="color" type="color" value="#${(color??0x57f287).toString(16).padStart(6,'0')}">`}</div><div class="f-form-actions"><span>${tr('PERUBAHAN TERSIMPAN KE BOT','CHANGES SAVED TO BOT')}</span><button class="f-primary" type="submit">${tr('SIMPAN','SAVE')}</button></div></form>`;
      const form=slot.querySelector('form'), test=root.querySelector('#liveTest');window.ZentixGreetingColor?.bind(form);test.disabled=false;
      const preview=()=>{root.querySelector('#livePreviewTitle').textContent=form.elements.title.value;root.querySelector('#livePreviewMessage').textContent=form.elements.welcomeMessage.value.replaceAll('{user}',tr('@anggota','@member')).replaceAll('{server}','Server').replaceAll('{memberCount}','100');root.querySelector('#livePreviewFooter').textContent=form.elements.footer.value.replaceAll('{server}','Server');root.querySelector('#livePreviewUser').hidden=!form.elements.showUser.checked;root.querySelector('#livePreviewCount').hidden=!form.elements.showMemberCount.checked;const box=root.querySelector('.welcome-container-preview');box.style.borderLeftColor=form.elements.color.value||'transparent';const image=root.querySelector('#livePreviewImage'),uploaded=root.querySelector('#greetingBanner')?.dataset.previewUrl;if(uploaded){image.src=uploaded;image.hidden=false;return}try{const url=new URL(form.elements.welcomeImage.value);if(url.protocol!=='https:')throw Error();image.src=url.href;image.hidden=false}catch{image.removeAttribute('src');image.hidden=true}};
      form.addEventListener('input',preview);root.querySelector('#greetingBanner')?.addEventListener('greeting-image-change',preview);preview();
      const dock=window.ZentixSaveDock?.attach(form,'Welcome',()=>{window.ZentixGreetingColor?.set(form,form.elements.color.value);preview()},{showLabel:true});
      form.addEventListener('submit',async e=>{e.preventDefault();if(dock&&!dock.start())return;const x=form.elements;const b={enabled:x.enabled.checked,channelId:x.channelId.value||null,welcomeMessage:x.welcomeMessage.value,welcomePing:x.welcomePing.checked,welcomeImage:x.welcomeImage.value.trim()||null,roleIds:[...form.querySelectorAll('input[name="roleIds"]:checked:not(:disabled)')].map(b=>b.value),welcomeEmbed:{title:x.title.value,footer:x.footer.value,showUser:x.showUser.checked,showMemberCount:x.showMemberCount.checked,color:x.color.value?parseInt(x.color.value.slice(1),16):null}};const button=form.querySelector('.f-form-actions button[type=submit]');button.disabled=true;let success=false;try{await request('welcome',{method:'PATCH',body:JSON.stringify(b)});success=true;notify(tr('Pengaturan welcome berhasil disimpan.','Welcome settings saved.'))}catch(err){notify(err.message)}finally{button.disabled=false;dock?.finish(success)}});
      test.addEventListener('click',async()=>{if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Kirim pesan tes ke channel welcome yang sudah disimpan? Tes menggunakan akunmu dan tidak melakukan ping.','Send a test message to the saved welcome channel? It uses your account and does not ping.')) : Promise.resolve(window.confirm(tr('Kirim pesan tes ke channel welcome yang sudah disimpan? Tes menggunakan akunmu dan tidak melakukan ping.','Send a test message to the saved welcome channel? It uses your account and does not ping.'))))))return;test.disabled=true;try{await request('welcome/test',{method:'POST',body:JSON.stringify({confirmed:true})});notify(tr('Pesan tes berhasil dikirim.','Test message sent.'))}catch(err){notify(err.message)}finally{test.disabled=false}});
    }).catch(e=>{if(slot.isConnected)slot.textContent=e.message});
  }
  function greetingBanner(){return `<section id="greetingBanner" class="f-panel"><div class="f-panel-head"><div><h2>${tr('Banner gambar','Image banner')}</h2><p>${tr('Banner ini dipakai untuk mode template dan AI. Upload disimpan langsung; hapus untuk kembali memakai URL gambar yang diatur di atas.','This banner is used for template and AI modes. Uploads are saved immediately; delete it to use the image URL configured above again.')}</p></div><span>▧</span></div><label class="f-field"><span><b>${tr('Unggah banner','Upload banner')}</b><small>${tr('PNG, JPEG, WebP atau GIF, maksimal 5 MB.','PNG, JPEG, WebP or GIF, maximum 5 MB.')}</small></span><input type="file" id="greetingBannerFile" accept="image/png,image/jpeg,image/webp,image/gif"></label><p class="f-muted" id="greetingBannerStatus" role="status">${tr('Memeriksa banner tersimpan…','Checking saved banner…')}</p><div class="f-form-actions"><button type="button" class="f-primary" id="greetingBannerSave">${tr('UNGGAH BANNER','UPLOAD BANNER')}</button><button type="button" class="f-outline" id="greetingBannerDelete">${tr('HAPUS BANNER','DELETE BANNER')}</button></div></section>`;}
  function bindGreetingBanner(root,kind){
    const box=root.querySelector('#greetingBanner'),input=box.querySelector('#greetingBannerFile'),status=box.querySelector('#greetingBannerStatus'),save=box.querySelector('#greetingBannerSave'),remove=box.querySelector('#greetingBannerDelete');
    const path='greeting-banner/'+kind,url='/dashboard/api/bot/'+path;let generation=0,objectUrl='',observer;
    // The stored banner can be several MB. Reuse the fetched bytes for the preview
    // instead of downloading the same image a second time through <img>.
    const revoke=()=>{if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=''}};
    const show=(src,owned='')=>{const old=objectUrl;objectUrl=owned;box.dataset.previewUrl=src||'';box.dispatchEvent(new Event('greeting-image-change'));if(old)URL.revokeObjectURL(old)};
    const watchRemoval=()=>{if(observer||typeof MutationObserver==='undefined')return;observer=new MutationObserver(()=>{if(!box.isConnected){generation++;revoke();observer.disconnect();observer=null}});observer.observe(document.documentElement,{childList:true,subtree:true})};
    const stored=async()=>{const current=++generation;try{const r=await fetch(url,{cache:'no-store'});if(!box.isConnected||current!==generation)return;if(r.status===404){show('');status.textContent=tr('Tidak ada banner upload; URL gambar digunakan jika tersedia.','No uploaded banner; the image URL is used if available.');return}if(!r.ok)throw Error(tr('Gagal memuat banner tersimpan.','Could not load saved banner.'));
      if(typeof r.blob==='function'&&typeof URL.createObjectURL==='function'&&typeof URL.revokeObjectURL==='function'){
        const blob=await r.blob();if(!box.isConnected||current!==generation)return;const src=URL.createObjectURL(blob);show(src,src);watchRemoval();
      }else show(url+'?v='+Date.now()); // Fallback for environments without object URLs.
      status.textContent=tr('Banner tersimpan. Banner ini menggantikan URL gambar.','Banner saved. This banner overrides the image URL.')}catch(e){if(box.isConnected&&current===generation)status.textContent=e.message||tr('Gagal memuat banner tersimpan.','Could not load saved banner.')}};
    const read=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error(tr('Gagal membaca file.','Could not read file.')));r.readAsDataURL(file)});
    const mimeOf=file=>file?.type||({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[file?.name?.split('.').pop().toLowerCase()]||'');
    const valid=file=>file&&['image/png','image/jpeg','image/webp','image/gif'].includes(mimeOf(file))&&file.size>0&&file.size<=5*1024*1024;
    stored();
    input.addEventListener('change',async()=>{generation++;const file=input.files?.[0];if(!file){await stored();return}if(!valid(file)){status.textContent=tr('Pilih PNG, JPEG, WebP atau GIF, maksimal 5 MB.','Choose PNG, JPEG, WebP or GIF, maximum 5 MB.');return}try{const data=await read(file);if(input.files?.[0]!==file)return;show(`data:${mimeOf(file)};base64,${data.split(',')[1]}`);status.textContent=tr('Preview file baru — tekan Unggah Banner untuk menyimpan.','New file preview — press Upload Banner to save.')}catch(e){status.textContent=e.message}});
    save.onclick=async()=>{const file=input.files?.[0];if(!valid(file)){status.textContent=tr('Pilih PNG, JPEG, WebP atau GIF, maksimal 5 MB.','Choose PNG, JPEG, WebP or GIF, maximum 5 MB.');return}save.disabled=remove.disabled=true;try{const data=await read(file);await request(path,{method:'PUT',body:JSON.stringify({mime:mimeOf(file),base64:data.split(',')[1]})});input.value='';await stored();notify(tr('Banner berhasil disimpan.','Banner saved.'))}catch(e){status.textContent=e.message}finally{save.disabled=remove.disabled=false}};
    remove.onclick=async()=>{if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Hapus banner upload? URL gambar lama akan digunakan bila ada.','Delete the uploaded banner? The previous image URL will be used if available.')) : Promise.resolve(window.confirm(tr('Hapus banner upload? URL gambar lama akan digunakan bila ada.','Delete the uploaded banner? The previous image URL will be used if available.'))))))return;save.disabled=remove.disabled=true;try{const session=await window.ZentixSession;const r=await fetch('/dashboard/api/bot/'+path,{method:'DELETE',headers:{'x-csrf-token':session.csrf}});const data=await r.json();if(!r.ok)throw Error((window.ZentixI18n?.accessError?.(data.error,r.status) ?? window.ZentixI18n?.greetingError?.(data.error) ?? data.error)||tr('Gagal menghapus banner.','Could not delete banner.'));input.value='';await stored();notify(tr('Banner upload dihapus.','Uploaded banner deleted.'))}catch(e){status.textContent=e.message}finally{save.disabled=remove.disabled=false}};
  }
  function afterRender(root,page) {
    if(!enabled || page!=='overview')return;
    usage(root);
    const label=root.querySelector('.small-badge');if(label)label.textContent=tr('MEMUAT STATUS','LOADING STATUS');
    const lamp=root.querySelector('.lamp');if(lamp)lamp.textContent=tr('● MEMUAT','● LOADING');
    const status=root.querySelector('.card-bottomline strong');if(status)status.textContent=tr(' / MEMUAT',' / LOADING');
    request('overview').then(data=>{
      if(!root.querySelector('.metrics'))return;
      const values=root.querySelectorAll('.metric strong');
      const duration=ms=>{let n=Math.floor(ms/60000);return `${Math.floor(n/60)}${tr('j','h')} ${n%60}m`};
      [data.online?'ONLINE':'OFFLINE', data.guild.memberCount??'—',data.ping===null?'—':data.ping,data.uptime===null?'—':duration(data.uptime)].forEach((v,i)=>{if(values[i])values[i].textContent=v});
      if(label)label.textContent=tr('DATA BOT','BOT DATA');if(lamp)lamp.textContent=data.online?'● ONLINE':'○ OFFLINE';
      if(status)status.textContent=` / ${data.online?'ONLINE':'OFFLINE'} · DB ${data.database==='connected'?tr('TERHUBUNG','CONNECTED'):tr('TIDAK TERSEDIA','UNAVAILABLE')}`;
    }).catch(()=>{if(label)label.textContent=tr('STATUS TIDAK TERSEDIA','STATUS UNAVAILABLE');if(lamp)lamp.textContent=tr('○ TIDAK TERSEDIA','○ UNAVAILABLE');if(status)status.textContent=tr(' / TIDAK TERSEDIA',' / UNAVAILABLE');});
  }
  window.ZentixLive={enabled,welcome,bindWelcome,greetingBanner,bindGreetingBanner,afterRender};
})();
