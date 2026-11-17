/* Legacy goodbye settings; available only from the authenticated bot dashboard. */
(() => {
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const field=(title,help,control)=>`<label class="f-field"><span><b>${title}</b><small>${help}</small></span>${control}</label>`;
 const show=text=>{const t=document.getElementById('toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),4000)};
 async function request(method='GET',body,path=''){
  const session=await window.ZentixSession;
  const response=await fetch('/dashboard/api/bot/goodbye'+path,{method,cache:'no-store',headers:body?{'Content-Type':'application/json','x-csrf-token':session.csrf}:{},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Permintaan gagal.');return data;
 }
 function render(){return `<div class="f-layout"><div><section class="f-panel"><div class="f-panel-head"><div><h2>Goodbye</h2><p>Pengaturan bersama untuk mode template dan AI.</p></div><span>✳</span></div><div id="liveGoodbye" aria-live="polite">Memuat pengaturan…</div></section><div class="f-callout">ⓘ &nbsp; Setelah mode gabungan disimpan, AI memakai channel dan template ini sebagai cadangan.</div></div><aside><section class="f-panel"><div class="f-panel-head"><div><h2>Pratinjau lokal</h2><p>Perkiraan teks; tidak mengirim pesan Discord.</p></div><span>✳</span></div><div class="discord-demo"><div class="discord-avatar">✳</div><div class="discord-copy"><strong>ZentixBot</strong><div id="goodbyePreviewBox" style="background:#2b2d31;border:1px solid #1e1f22;border-left:4px solid #ed4245;border-radius:14px;padding:16px;color:#dbdee1;white-space:pre-wrap"><b id="goodbyePreviewTitle"></b><p id="goodbyePreviewMessage"></p><small id="goodbyePreviewFooter"></small></div></div></div><div class="f-preview-action"><button class="f-outline" id="goodbyeTest" type="button">KIRIM TES KE DISCORD ↗</button></div><p class="f-muted">Tes ini memakai template biasa yang tersimpan tanpa ping; tombol tes AI ada di bawah. Gambar tidak dimuat dalam pratinjau. Pesan nyata dapat berbeda menurut izin bot.</p></section></aside></div>`;}
 function bind(root){
  const slot=root.querySelector('#liveGoodbye');if(!slot)return;
  async function load(){
   slot.textContent='Memuat pengaturan…';
   try{
    const data=await request();if(!slot.isConnected)return;const w=data.goodbye;let revision=data.revision;
    const channels=[['','Belum dipilih'],...data.channels.map(c=>[c.id,'# '+c.name])];
    if(w.channelId&&!data.channels.some(c=>c.id===w.channelId))channels.push([w.channelId,'ID tersimpan — tidak tersedia']);
    const options=channels.map(([v,n])=>`<option value="${esc(v)}" ${v===(w.channelId||'')?'selected':''}>${esc(n)}</option>`).join('');
    slot.innerHTML=`<p class="f-muted">Perubahan channel dan pesan juga digunakan AI setelah mode gabungan disimpan. Simpan hanya setelah memeriksa channel.</p><p id="goodbyeError" class="f-muted" role="status"></p><form class="f-form" id="goodbyeForm"><fieldset style="border:0;padding:0;margin:0;min-width:0">
    ${field('Aktifkan goodbye','Kirim pesan saat anggota keluar.',`<span class="f-check"><input name="enabled" type="checkbox" ${w.enabled?'checked':''}><span class="fake-switch"></span></span>`)}
    ${field('Channel goodbye','Channel teks yang dapat dilihat dan dikirimi pesan oleh bot.',`<select name="channelId">${options}</select>`)}
    ${field('Pesan','Variabel: {user}, {username}, {user.tag}, {server}, {memberCount}.',`<textarea name="message" rows="4" maxlength="1500" required>${esc(w.message)}</textarea>`)}
    ${field('Ping anggota','Mention di konten pesan, jika diaktifkan.',`<span class="f-check"><input name="ping" type="checkbox" ${w.ping?'checked':''}><span class="fake-switch"></span></span>`)}
    ${field('URL gambar','HTTPS tanpa kredensial; kosongkan untuk menghapus.',`<input name="image" type="url" maxlength="1000" value="${esc(w.image||'')}">`)}
    ${field('Judul container','Maksimum 256 karakter.',`<input name="title" maxlength="256" required value="${esc(w.title)}">`)}
    ${field('Footer container','Maksimum 1024 karakter.',`<input name="footer" maxlength="1024" value="${esc(w.footer)}">`)}
    ${field('Warna container','Warna pesan container.',`<input name="color" type="color" value="#${w.color.toString(16).padStart(6,'0')}">`)}
    <div class="f-form-actions"><span>✳ SIMPAN KE BOT</span><button class="f-primary" type="submit">SIMPAN ↗</button></div></fieldset></form><button type="button" class="f-outline" id="reloadGoodbye">MUAT ULANG ↻</button>`;
    const form=slot.querySelector('form'),inputs=form.elements,fieldset=form.querySelector('fieldset'),reload=slot.querySelector('#reloadGoodbye'),error=slot.querySelector('#goodbyeError');
    const sample=v=>v.replaceAll('{user.tag}','anggota-contoh').replaceAll('{username}','anggota-contoh').replaceAll('{user}','@anggota').replaceAll('{server}','Server').replaceAll('{memberCount}','100');
    function preview(){root.querySelector('#goodbyePreviewTitle').textContent=sample(inputs.title.value);root.querySelector('#goodbyePreviewMessage').textContent=sample(inputs.message.value);root.querySelector('#goodbyePreviewFooter').textContent=sample(inputs.footer.value);root.querySelector('#goodbyePreviewBox').style.borderLeftColor=inputs.color.value;}
    form.addEventListener('input',preview);preview();
    root.querySelector('#goodbyeTest').onclick=async e=>{const button=e.currentTarget;if(!confirm('Kirim tes goodbye biasa ke channel yang tersimpan? Tidak ada ping.'))return;button.disabled=true;try{await request('POST',{confirmed:true},'/test');show('Pesan uji goodbye dikirim.')}catch(err){error.textContent=err.message}finally{button.disabled=false}};
    reload.onclick=()=>{if(confirm('Muat ulang? Perubahan yang belum disimpan akan hilang.'))load()};
    form.onsubmit=async e=>{e.preventDefault();const payload={revision,enabled:inputs.enabled.checked,channelId:inputs.channelId.value||null,message:inputs.message.value,ping:inputs.ping.checked,image:inputs.image.value.trim()||null,title:inputs.title.value,footer:inputs.footer.value,color:parseInt(inputs.color.value.slice(1),16)};
     fieldset.disabled=true;reload.disabled=true;error.textContent='';
     try{const saved=await request('PATCH',payload);revision=saved.revision;show('Pengaturan goodbye disimpan.');}
     catch(e){error.textContent=e.message;}
     finally{fieldset.disabled=false;reload.disabled=false;}
    };
   }catch(e){if(slot.isConnected)slot.textContent=e.message;}
  }
  load();
 }
 window.ZentixGoodbye={render,bind};
})();
