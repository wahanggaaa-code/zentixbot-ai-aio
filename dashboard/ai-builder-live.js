// AI Studio → Server Builder, connected to the bot. Three tabs:
//   design  – draft a plan from a ready-made theme or with the AI, review it, edit it, apply it;
//   history – what the builder created, and taking the newest build down again;
//   manual  – rename, re-permission or delete one existing object.
// Names in a plan come from an AI or from whoever edited it, so everything is put on the page as text
// (textContent), never as markup.
(() => {
 const API = '/dashboard/api/ai/builder/';
 async function req(path, body) {
  const s = await window.ZentixSession;
  const r = await fetch(API + path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-csrf-token': s.csrf }, body: JSON.stringify(body) });
  const b = await r.json();
  if (!r.ok) { const e = Error(b.error || 'Permintaan gagal'); e.created = b.created; e.recorded = b.recorded; e.code = b.code; throw e; }
  return b;
 }
 async function read(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || 'Data tidak dapat dimuat');
  return b;
 }
 /** Builds an element: el('li', {className:'x'}, 'text', childNode, …). Strings become text nodes. */
 function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) node[key] = value;
  for (const child of children) if (child !== null && child !== undefined && child !== '') node.append(child);
  return node;
 }
 const TYPE_LABELS = { category: 'KATEGORI', text: 'TEKS', voice: 'SUARA', forum: 'FORUM', news: 'PENGUMUMAN', stage: 'PANGGUNG', role: 'ROLE' };
 const SOURCE_LABELS = { ai: 'AI', theme: 'TEMA', fallback: 'TEMA CADANGAN' };
 const list = (value) => (Array.isArray(value) ? value : []);
 const countsOf = (plan) => ({ categories: list(plan?.categories).length, channels: list(plan?.categories).reduce((n, c) => n + list(c?.channels).length, 0), roles: list(plan?.roles).length });
 const countsText = (c) => `${c.categories} kategori · ${c.channels} channel · ${c.roles} role`;
 function itemCounts(items) {
  const c = { categories: 0, channels: 0, roles: 0 };
  for (const item of list(items)) c[item.type === 'category' ? 'categories' : item.type === 'role' ? 'roles' : 'channels']++;
  return c;
 }
 const when = (at) => { try { return new Date(at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return '-'; } };

 function accessText(access, fallback, existingRoles=[]) {
  if (!access) return fallback;
  const who = [...list(access.roles), ...list(access.existingRoles).map(id => existingRoles.find(r=>r.id===id)?.name || `Role ${id} (perlu diperiksa)`) ].join(', ') || '(belum ada role)';
  if (access.mode === 'private-read-only') return `PRIVAT + BACA SAJA: @everyone ditolak melihat, mengirim dan membuat thread; ${who} dan bot diizinkan.`;
  return access.mode === 'private' ? `PRIVAT: @everyone ditolak melihat; ${who} dan bot boleh melihat.` : `BACA SAJA: @everyone ditolak mengirim/membuat thread; ${who} dan bot diizinkan. Akses lihat mengikuti default server, bukan pembatasan kategori.`;
 }
 /** The plan as a readable list; editing access updates only the unvalidated JSON draft. */
 function drawPlan(box, plan, onAccessEdit, onStructureEdit, existingRoles=[]) {
  // Renders after each edit. Keep expanded panels and the role review selection stable.
  const opened = new Set([...box.querySelectorAll('details[data-builder-key][open]')].map(d => d.dataset.builderKey));
  const selectedReview = box.querySelector('select[aria-label="Tinjau overwrite untuk role"]')?.value;
  const active = document.activeElement;
  const activePanel = active?.closest?.('details[data-builder-key]');
  const activeKey = activePanel?.dataset.builderKey;
  const activeIndex = activePanel ? [...activePanel.querySelectorAll('input, select, button')].indexOf(active) : -1;
  const activeIsSummary = active?.tagName === 'SUMMARY' && active?.parentElement === activePanel;
  box.replaceChildren();
  const expandable = (key, summary, ...children) => {
   const details = el('details', {className:'b-preview-details', open:opened.has(key)}, summary, ...children);
   details.dataset.builderKey = key;
   return details;
  };
  const accessBadge = (access, inherited) => {
   const current = access || inherited;
   const modes = {'read-only':'BACA SAJA', private:'PRIVAT', 'private-read-only':'PRIVAT · BACA SAJA'};
   return current ? `${!list(current.roles).length && !list(current.existingRoles).length ? 'PILIH ROLE · ' : ''}${!access && inherited ? 'IKUTI · ' : ''}${modes[current.mode] || 'PERLU DITINJAU'}` : 'DEFAULT SERVER';
  };
  box.append(el('div', { className: 'b-counts' }, countsText(countsOf(plan)).toUpperCase()));
  function accessEditor(access, categoryIndex, channelIndex) {
   const select = el('select', { 'ariaLabel': channelIndex === null ? 'Izin kategori' : 'Izin channel' });
   for (const [value, name] of [['', channelIndex === null ? 'Ikuti default server' : 'Ikuti kategori'], ['read-only', 'Baca saja'], ['private', 'Privat'], ['private-read-only', 'Privat + baca saja']]) select.append(el('option', {value}, name));
   select.setAttribute('aria-label', channelIndex === null ? 'Izin kategori' : 'Izin channel');
   select.value = access?.mode || '';
   select.onchange = () => onAccessEdit(categoryIndex, channelIndex, 'mode', select.value);
   const wrapper = el('div', { className: 'b-access' }, el('label', null, 'Akses: ', select));
   if (access) {
    const names = list(plan?.roles).map(role => typeof role === 'string' ? role : role?.name).filter(name => typeof name === 'string');
    const group = el('fieldset', {className:'b-perms'}, el('legend', null, 'Role rancangan yang diizinkan'));
    for (const name of names) {
     const input = el('input', {type:'checkbox', checked:list(access.roles).includes(name)});
     input.onchange = () => onAccessEdit(categoryIndex, channelIndex, 'role', {name, checked:input.checked});
     group.append(el('label', null, input, ` ${name} `));
    }
    if (!names.length) group.append(el('p', {className:'f-muted'}, 'Belum ada role baru.'));
    const serverGroup=el('div',{className:'b-existing-roles'},el('p',{className:'f-muted'},'Role server dipakai hanya pada channel baru; role tidak diubah.'));
    for(const id of list(access.existingRoles)) {
     const item=el('label',null);const input=el('input',{type:'checkbox',checked:true});
     input.onchange=()=>onAccessEdit(categoryIndex,channelIndex,'existingRole',{id,checked:false});
     item.append(input, ` ${existingRoles.find(r=>r.id===id)?.name || 'Role tidak ditemukan'} (${id}) `);serverGroup.append(item);
    }
    if(existingRoles.length){
     const selectRole=el('select',{});selectRole.setAttribute('aria-label','Tambahkan role server');selectRole.append(el('option',{value:''},'Pilih role server…'));
     for(const role of existingRoles.filter(r=>!list(access.existingRoles).includes(r.id)))selectRole.append(el('option',{value:role.id},`${role.name} (${role.id})`));
     selectRole.onchange=()=>{if(selectRole.value)onAccessEdit(categoryIndex,channelIndex,'existingRole',{id:selectRole.value,checked:true})};serverGroup.append(selectRole);
    }
    group.append(serverGroup);
    wrapper.append(group);
   }
   return wrapper;
  }
  const textInput=(value, aria, changed)=>{const input=el('input',{type:'text',value:String(value??'')});input.setAttribute('aria-label',aria);input.onchange=()=>changed(input.value);return input};
  const button=(name,action,disabled=false,aria='')=>{const b=el('button',{type:'button',disabled},name);if(aria)b.setAttribute('aria-label',aria);b.onclick=action;return b};
  const field=(title,control)=>el('label',{className:'b-edit-field'},el('span',null,title),control);
  for (const [ci, category] of list(plan?.categories).entries()) {
   const rows = list(category?.channels).map((channel, i) => {
    const type = TYPE_LABELS[channel?.type] || 'CHANNEL';
    const typeSelect=el('select',{});typeSelect.setAttribute('aria-label','Jenis channel');
    for(const value of ['text','voice','forum','news','stage'])typeSelect.append(el('option',{value},TYPE_LABELS[value]));
    typeSelect.value=channel.type;typeSelect.onchange=()=>onStructureEdit('channel-type',ci,i,typeSelect.value);
    const move=el('select',{});move.setAttribute('aria-label','Pindah channel ke kategori');
    for(const [n,c] of list(plan.categories).entries())move.append(el('option',{value:String(n)},String(c.name)));
    move.value=String(ci);move.onchange=()=>onStructureEdit('channel-move',ci,i,Number(move.value));
    const summary=el('summary',{className:'b-channel-summary'},
     el('span',{className:'b-channel-kind','ariaHidden':'true'},channel?.type==='voice' || channel?.type==='stage'?'♫':'#'),
     el('span',{className:'b-channel-info'},el('strong',null,String(channel?.name ?? '')),el('small',null,type)),
     el('span',{className:'b-access-badge'},accessBadge(channel?.access, category?.access)),
     el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
    const body=el('div',{className:'b-preview-body'},
     el('p',{className:'b-access-explanation'},(!channel?.access && category?.access ? 'Mengikuti izin kategori. ' : '') + accessText(channel?.access || category?.access, 'Mengikuti izin default server.', existingRoles)),
     el('div',{className:'b-edit-grid'},
      field('Nama channel',textInput(channel.name,'Nama channel',v=>onStructureEdit('channel-name',ci,i,v,true))),
      field('Jenis',typeSelect),
      field('Topik (opsional)',textInput(channel.topic||'','Topik channel (opsional)',v=>onStructureEdit('channel-topic',ci,i,v,true))),
      field('Pindah ke kategori',move)),
     accessEditor(channel?.access,ci,i),
     el('div',{className:'b-preview-actions'},button('↑',()=>onStructureEdit('channel-up',ci,i),i===0,'Pindahkan channel ke atas'),button('↓',()=>onStructureEdit('channel-down',ci,i),i===category.channels.length-1,'Pindahkan channel ke bawah'),button('Hapus channel',()=>onStructureEdit('channel-delete',ci,i))));
    return el('li',null,expandable(`channel:${ci}:${i}`,summary,body));
   });
   const categorySummary=el('summary',{className:'b-category-edit-summary'},'EDIT KATEGORI & IZIN',el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
   const categoryEdit=expandable(`category:${ci}`,categorySummary,el('div',{className:'b-preview-body'},
    el('p',{className:'b-access-explanation'},accessText(category?.access,'Mengikuti izin default server.',existingRoles)),
    field('Nama kategori',textInput(category.name,'Nama kategori',v=>onStructureEdit('category-name',ci,null,v,true))),
    accessEditor(category?.access,ci,null),
    el('div',{className:'b-preview-actions'},button('↑',()=>onStructureEdit('category-up',ci),ci===0,'Pindahkan kategori ke atas'),button('↓',()=>onStructureEdit('category-down',ci),ci===plan.categories.length-1,'Pindahkan kategori ke bawah'),button('Hapus kategori',()=>onStructureEdit('category-delete',ci)))));
   box.append(el('section',{className:'b-preview-category'},
    el('div',{className:'b-category-heading'},el('div',null,el('span',{className:'b-category-overline'},`KATEGORI ${String(ci+1).padStart(2,'0')}`),el('h3',null,String(category?.name ?? ''))),el('div',{className:'b-category-meta'},el('span',{className:'b-category-count'},`${rows.length} CHANNEL`),el('span',{className:'b-access-badge'},accessBadge(category?.access,null)))),
    categoryEdit,
    rows.length ? el('ul',{className:'b-channel-list'},...rows) : el('p',{className:'f-muted'},'Kategori kosong.'),
    button('+ TAMBAH CHANNEL',()=>onStructureEdit('channel-add',ci),false)));
  }
  const addCategory=button('+ TAMBAH KATEGORI',()=>onStructureEdit('category-add'));
  addCategory.className='b-preview-add';box.append(addCategory);
  const roles = list(plan?.roles).map((role, index) => {
   const name = typeof role === 'string' ? role : String(role?.name ?? '');
   const color = typeof role?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(role.color) ? role.color : null;
   const swatch = el('span', { className: 'b-swatch' });if (color) swatch.style.background=color;
   const summary=el('summary',{className:'b-role-summary'},swatch,el('span',{className:'b-name'},name),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
   const body=el('div',{className:'b-preview-body'},
    el('div',{className:'b-edit-grid'},field('Nama role',textInput(name,'Nama role baru',v=>onStructureEdit('role-name',index,null,v,true))),field('Warna (opsional)',textInput(color||'','Warna role',v=>onStructureEdit('role-color',index,null,v,true)))),
    el('div',{className:'b-preview-actions'},button('Hapus role',()=>onStructureEdit('role-delete',index))));
   return el('li',null,expandable(`role:${index}`,summary,body));
  });
  const roleSummary=el('summary',{className:'b-section-summary'},el('span',null,`ROLE BARU · ${roles.length}`),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
  box.append(expandable('roles',roleSummary,el('div',{className:'b-preview-body'},el('p',{className:'f-muted'},'Role baru tidak memiliki izin server dan tidak otomatis diberikan kepada anggota.'),el('ul',{className:'b-role-list'},...roles),button('+ TAMBAH ROLE BARU',()=>onStructureEdit('role-add')))));
  const roleView=el('select',{});roleView.setAttribute('aria-label','Tinjau overwrite untuk role');
  roleView.append(el('option',{value:'everyone'},'@everyone'));
  for(const r of list(plan.roles)){const name=typeof r==='string'?r:r.name;roleView.append(el('option',{value:'new:'+name},`Role baru: ${name}`))}
  for(const r of existingRoles)roleView.append(el('option',{value:'existing:'+r.id},`Role server: ${r.name} (${r.id})`));
  const view=el('div',{className:'b-access-summary'});
  const refresh=()=>{
   const selected=roleView.value;view.replaceChildren();
   for(const c of list(plan.categories)) for(const channel of list(c.channels)){
    const a=channel.access||c.access;let detail='Tidak ada overwrite rancangan; mengikuti default server.';
    if(a){const selectedRole=selected.startsWith('new:')?list(a.roles).includes(selected.slice(4)):selected.startsWith('existing:')?list(a.existingRoles).includes(selected.slice(9)):false;
     const privateMode=['private','private-read-only'].includes(a.mode),readonly=['read-only','private-read-only'].includes(a.mode);
     const fragments=[];if(privateMode)fragments.push(selectedRole?'role ini diizinkan melihat':'@everyone ditolak melihat');
     if(readonly)fragments.push(selectedRole?'role ini diizinkan mengirim/membuat thread':'@everyone ditolak mengirim/membuat thread');
     detail=fragments.join('; ')+'.';
    }
    view.append(el('p',null,`${c.name} / ${channel.name}: ${detail}`));
   }
  };roleView.onchange=refresh;
  if (selectedReview && [...roleView.options].some(o=>o.value===selectedReview)) roleView.value=selectedReview;
  refresh();
  box.append(expandable('review',el('summary',{className:'b-section-summary'},el('span',null,'TINJAU IZIN PER ROLE'),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄')),el('div',{className:'b-preview-body'},el('p',{className:'f-muted'},'Ini hanya ringkasan overwrite rancangan, bukan izin efektif. Role lain, izin server, pemilik dan Administrator dapat mengubah hasil. Periksa akses di Discord.'),roleView,view)));
  if (activeKey && (activeIndex >= 0 || activeIsSummary)) {
   const current=[...box.querySelectorAll('details[data-builder-key]')].find(d=>d.dataset.builderKey===activeKey);
   const replacement=activeIsSummary ? current?.querySelector(':scope > summary') : current?.querySelectorAll('input, select, button')[activeIndex];
   if (replacement && (activeIsSummary || current.open)) replacement.focus({preventScroll:true});
  }

 }
 /** Created, removed or kept objects as one list. */
 function drawItems(box, title, items) {
  const rows = list(items).map((item) => el('li', null,
   el('span', { className: 'b-tag' }, TYPE_LABELS[item.type] || 'OBJEK'),
   el('span', { className: 'b-name' }, String(item.name ?? '')),
   item.reason ? el('small', null, String(item.reason)) : null));
  if (rows.length) box.append(el('div', { className: 'b-group' }, el('div', { className: 'b-group-name' }, title), el('ul', null, ...rows)));
 }

 const aside = (title, lead, note, callout) => `<aside><section class="f-panel"><div class="f-panel-head"><div><h2>${title}</h2><p>${lead}</p></div><span>◇</span></div><div class="f-feature-note"><p>${note}</p></div><div class="f-callout">⚠ &nbsp; ${callout}</div></section></aside>`;

 function designMarkup() {
  return `<div class="f-layout"><div>
<section class="f-panel"><div class="f-panel-head"><div><h2>Server Builder</h2><p>Pilih tema atau jelaskan servernya, tinjau, lalu terapkan dengan konfirmasi terpisah.</p></div><span>⌗</span></div>
<form id="aiBuilderThemeForm" class="f-form b-form"><label class="f-field"><span><b>Tema siap pakai</b><small>Tanpa AI, tidak memakai kuota. Hasilnya tetap bisa disunting.</small></span><select name="themeId" required><option value="">Memuat tema…</option></select></label><div class="f-form-actions"><span>✳ SUSUNAN SIAP PAKAI · TANPA KUOTA AI</span><button class="f-outline" type="submit">PAKAI TEMA ↗</button></div></form>
<form id="aiBuilderForm" class="f-form b-form"><label class="f-field"><span><b>Atau jelaskan servernya</b><small>Dikirim ke provider AI. Jangan masukkan data sensitif. Maksimal 1000 karakter. Rancangan besar dapat diperkecil atau terpotong bila batas output provider rendah; bila AI gagal, dipakai tema terdekat.</small></span><textarea name="description" maxlength="1000" rows="5" required></textarea><small id="aiBuilderCharCount">0 / 1000 karakter</small></label><div class="f-form-actions"><span id="aiBuilderLimits">✳ MAKS. 8 KATEGORI, 40 CHANNEL, 12 ROLE</span><button class="f-primary" type="submit">RANCANG DENGAN AI ↗</button></div></form>
</section>
<section class="f-panel"><div class="f-panel-head"><div><h2>Rancangan untuk ditinjau</h2><p>Belum ada yang dibuat di Discord sampai Anda menekan Terapkan.</p></div><span>◉</span></div>
<p class="f-callout" id="aiBuilderNote" hidden></p>
<p class="f-muted">Ketuk channel atau “Edit kategori & izin” untuk menyunting. Pilih role baru atau role server yang sudah ada untuk izin channel. Setelah mengubah, tekan VALIDASI RANCANGAN. Role baru harus ditetapkan ke anggota secara manual.</p><p id="aiBuilderEditState" class="b-edit-state" aria-live="polite" hidden></p><div class="b-tree" id="aiBuilderPreview"><p class="f-muted">Belum ada rancangan.</p></div>
<details class="b-details"><summary>SUNTING RANCANGAN (JSON) / VALIDASI</summary><p class="f-muted">Ubah nama, tipe, topic atau warna role. Untuk izin tambahkan pada kategori/channel: &quot;access&quot;: {&quot;mode&quot;:&quot;read-only&quot;, &quot;roles&quot;:[&quot;Admin&quot;]}; mode lain: private dan private-read-only. Nama role baru wajib ada dalam rancangan; pilih role yang sudah ada melalui preview. Channel tanpa access mengikuti kategori. Access channel menggantikan access kategori sepenuhnya. Validasi sebelum menerapkan. Objek Discord yang sudah ada tidak diubah.</p><textarea class="b-code" id="aiBuilderPlan" rows="14" maxlength="20000" spellcheck="false" aria-label="JSON rancangan server" disabled></textarea></details><div class="b-actions"><button type="button" class="f-outline" id="aiBuilderSave" disabled>VALIDASI RANCANGAN ↗</button><button type="button" class="f-outline" id="aiBuilderPreflight" disabled>PERIKSA SERVER</button><button type="button" class="f-outline" id="aiBuilderSaveDraft" disabled>SIMPAN DRAFT</button><button type="button" class="f-outline" id="aiBuilderRestoreDraft">MUAT DRAFT</button><button type="button" class="f-outline" id="aiBuilderDeleteDraft">HAPUS DRAFT</button></div><p id="aiBuilderPreflightStatus" class="f-muted" aria-live="polite"></p>
<div class="b-actions"><button type="button" class="f-primary" id="aiBuilderApply" disabled>TERAPKAN KE SERVER ↗</button><button type="button" class="f-outline" id="aiBuilderCancel" disabled>BATALKAN RANCANGAN</button></div>
<p id="aiBuilderStatus" aria-live="polite" class="f-muted b-status"></p>
<div class="b-tree" id="aiBuilderResult"></div>
</section></div>${aside('Sebelum menerapkan', 'Hanya owner bot yang dapat menjalankan.', 'Penerapan membuat kategori, channel dan role baru. Role baru tidak mendapat izin server dan tidak ditetapkan ke anggota otomatis. Access read-only/private/private-read-only hanya mengatur overwrite tertentu; tanpa access mengikuti default server. Channel dengan access sendiri mengganti seluruh access kategori. Izin efektif dapat dipengaruhi role lain dan Administrator melewati pembatasan. Periksa di Discord dan tetapkan role staff secara manual. Nama baru yang sudah ada di server ditolak. Role server terpilih tidak diubah dan hanya digunakan dalam overwrite channel baru. Tipe forum, news dan stage memerlukan fitur Komunitas Discord.', 'Rancangan berlaku 5 menit dan hanya sekali pakai. Semua yang dibuat tercatat di tab Riwayat & bongkar dan dapat dihapus lagi dari sana, juga bila penerapan berhenti di tengah jalan.')}</div>`;
 }

 function historyMarkup() {
  return `<div class="f-layout"><div>
<section class="f-panel"><div class="f-panel-head"><div><h2>Riwayat pembangunan</h2><p>Yang dibuat Server Builder di server ini, terbaru di atas.</p></div><span>◆</span></div>
<div class="b-builds" id="aiBuilderHistory"><p class="f-muted">Memuat…</p></div>
</section>
<section class="f-panel"><div class="f-panel-head"><div><h2>Bongkar bangunan terakhir</h2><p>Menghapus persis objek yang tercatat pada bangunan terakhir. Tinjau dulu, lalu ketik konfirmasinya.</p></div><span>⌫</span></div>
<div class="b-actions"><button type="button" class="f-outline" id="aiUndoPrepare" disabled>TINJAU BONGKAR ↗</button></div>
<div class="b-tree" id="aiUndoPreview"><p class="f-muted">Belum ada yang ditinjau.</p></div>
<label class="f-field"><span><b>Konfirmasi bongkar</b><small id="aiUndoHint">Tinjau dulu; kalimat yang harus diketik muncul di sini.</small></span><input id="aiUndoConfirmation" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
<div class="b-actions"><button type="button" class="f-outline b-danger" id="aiUndoApply" disabled>BONGKAR SEKARANG ↗</button><button type="button" class="f-outline" id="aiUndoForget" disabled>LEPAS DARI RIWAYAT</button></div>
<p class="f-muted b-status" id="aiUndoStatus" aria-live="polite"></p>
</section></div>${aside('Cara kerja bongkar', 'Hanya owner bot yang dapat menjalankan.', 'Setiap penerapan dicatat beserta ID objek yang benar-benar dibuat. Bongkar menghapus ID itu saja: channel dulu, lalu kategori, lalu role. Hanya bangunan terakhir yang dapat dibongkar; setelah habis, bangunan sebelumnya menjadi yang terakhir. Objek yang gagal dihapus tetap tercatat untuk dicoba lagi. Kategori yang masih berisi channel lain dan channel sistem server tidak dihapus.', 'Channel dihapus beserta seluruh pesannya dan role dilepas dari semua anggota. Bot tidak dapat memulihkannya. "Lepas dari riwayat" hanya menghapus catatan: objeknya tetap ada di Discord dan tidak bisa lagi dibongkar otomatis.')}</div>`;
 }

 function manualMarkup() {
  const names = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'EmbedLinks', 'AttachFiles', 'Connect', 'Speak', 'Stream', 'UseVAD'];
  return `<div class="f-layout"><div><section class="f-panel"><div class="f-panel-head"><div><h2>Ubah objek yang ada</h2><p>Manual, satu target per tindakan · tidak dijalankan AI.</p></div><span>◇</span></div>
<form id="aiManualForm" class="f-form b-form"><label class="f-field"><span><b>Jenis target</b><small>Channel teks/suara/kategori atau role biasa.</small></span><select name="kind"><option value="channel">Channel atau kategori</option><option value="role">Role</option></select></label><label class="f-field"><span><b>ID target Discord</b><small>Salin ID di Discord, lalu tinjau sebelum mengubah.</small></span><input name="targetId" inputmode="numeric" pattern="[0-9]{17,20}" required></label><label class="f-field"><span><b>Tindakan</b><small>Hapus permanen; rollback hanya untuk nama dan izin role.</small></span><select name="action"><option value="rename">Ganti nama</option><option value="permissions">Atur izin dasar role</option><option value="delete">Hapus permanen</option></select></label><label class="f-field"><span><b>Nama baru</b><small>Hanya untuk ganti nama; channel teks/suara huruf kecil ASCII, angka, - atau _.</small></span><input name="newName" maxlength="40"></label>
<fieldset class="b-perms"><legend>Izin dasar role (hanya tindakan atur izin)</legend><p class="f-muted">Daftar lengkap izin dasar baru: centang yang diinginkan. Tidak mengubah permission overwrite channel.</p><div class="b-perm-grid">${names.map((n) => `<label><input type="checkbox" name="permission" value="${n}"><span>${n}</span></label>`).join('')}</div></fieldset>
<div class="b-actions"><button class="f-outline" type="submit">TINJAU TINDAKAN ↗</button></div></form>
<pre class="b-pre" id="aiManualPreview">Belum ada tindakan ditinjau.</pre>
<label class="f-field"><span><b>Konfirmasi target</b><small>Untuk rename/izin ketik ID. Untuk hapus ketik HAPUS diikuti spasi dan ID. Hapus tidak bisa di-rollback.</small></span><input id="aiManualConfirmation" autocomplete="off"></label>
<div class="b-actions"><button type="button" class="f-outline" id="aiManualApply" disabled>JALANKAN TINDAKAN ↗</button><button type="button" class="f-outline" id="aiManualUndo" disabled>ROLLBACK PERUBAHAN TERAKHIR ↗</button></div>
<p class="f-muted b-status" id="aiManualStatus" aria-live="polite"></p>
</section></div>${aside('Sebelum mengubah', 'Hanya owner bot yang dapat menjalankan.', 'Untuk objek yang sudah ada di server, apa pun asalnya. Setiap tindakan ditinjau dulu dan dikonfirmasi dengan mengetik ID target. Permission overwrite channel tidak dapat diubah dari sini.', 'Hapus channel dapat menghapus pesan; hapus role menghilangkan penetapan role. Bot tidak dapat memulihkan data tersebut. Tinjauan dan rollback hanya disimpan 5 menit di memori dan hilang saat restart. Perubahan lain dapat membuat rollback ditolak.')}</div>`;
 }

 function render(tab) { return tab === 'history' ? historyMarkup() : tab === 'manual' ? manualMarkup() : designMarkup(); }

 function bindDesign(root) {
  const form = root.querySelector('#aiBuilderForm'), themeForm = root.querySelector('#aiBuilderThemeForm');
  if (!form) return;
  const out = root.querySelector('#aiBuilderPlan'), status = root.querySelector('#aiBuilderStatus'), apply = root.querySelector('#aiBuilderApply'), save = root.querySelector('#aiBuilderSave');
  const cancel = root.querySelector('#aiBuilderCancel'), preview = root.querySelector('#aiBuilderPreview'), note = root.querySelector('#aiBuilderNote'), result = root.querySelector('#aiBuilderResult');
  let planId = null, revision = 0, dirty = false, jsonDirty = false, busy = false, existingRoles = [];
  const check=root.querySelector('#aiBuilderPreflight'), checkStatus=root.querySelector('#aiBuilderPreflightStatus'), saveDraft=root.querySelector('#aiBuilderSaveDraft'), restore=root.querySelector('#aiBuilderRestoreDraft'), deleteDraft=root.querySelector('#aiBuilderDeleteDraft');
  const counter=root.querySelector('#aiBuilderCharCount'), description=form.elements.description, editState=root.querySelector('#aiBuilderEditState');
  const setEditState = (text) => { editState.hidden=!text; editState.textContent=text; };
  const updateCount=()=>{counter.textContent=`${description.value.length} / 1000 karakter`};description.addEventListener('input',updateCount);updateCount();
  read('roles').then(r=>{existingRoles=list(r.roles);if(planId && !jsonDirty){try {drawPlan(preview,JSON.parse(out.value),editAccess,editStructure,existingRoles)}catch{}}}).catch(()=>{existingRoles=[];checkStatus.textContent='Daftar role server tidak dapat dimuat; pilihan role yang sudah ada tidak tersedia.'});

  function editAccess(ci, index, field, value) {
   if (!planId || out.disabled) return;
   if (jsonDirty) { status.textContent = 'Validasi perubahan JSON sebelum mengatur izin di preview.'; return; }
   let plan;
   try { plan = JSON.parse(out.value); } catch { status.textContent = 'JSON tidak valid. Perbaiki dan validasi sebelum mengatur izin.'; return; }
   const target = index === null ? plan.categories?.[ci] : plan.categories?.[ci]?.channels?.[index];
   if (!target) { status.textContent = 'Rancangan berubah; validasi JSON terlebih dahulu.'; return; }
   if (field === 'mode') {
    if (!value) delete target.access;
    else target.access = {mode:value, roles:Array.isArray(target.access?.roles) ? target.access.roles : [], ...(target.access?.existingRoles ? {existingRoles:target.access.existingRoles} : {})};
   } else if (field === 'existingRole' && target.access) {
    target.access.existingRoles = list(target.access.existingRoles).filter(id=>id!==value.id);
    if (value.checked) target.access.existingRoles.push(value.id);
   } else if (target.access && Array.isArray(target.access.roles)) {
    target.access.roles = target.access.roles.filter(name => name !== value.name);
    if (value.checked) target.access.roles.push(value.name);
   } else return;
   out.value = JSON.stringify(plan, null, 2); setEditState('PERUBAHAN BELUM DIVALIDASI'); revision++; dirty = true; apply.disabled = true; check.disabled=true; saveDraft.disabled=true; checkStatus.textContent='Validasi sebelum memeriksa server.'; status.textContent = 'Izin berubah. Pilih setidaknya satu role lalu validasi sebelum menerapkan.'; drawPlan(preview, plan, editAccess, editStructure, existingRoles);
  }
  // Keep expanded editors attached to the same item when it moves or siblings are removed.
  function remapDetails(action, ci, index, value, plan) {
   const shiftCategory = n => {
    if(action==='category-delete') return n===ci ? null : n>ci ? n-1 : n;
    if(action==='category-up' && ci>0) return n===ci ? ci-1 : n===ci-1 ? ci : n;
    if(action==='category-down' && ci<plan.categories.length-1) return n===ci ? ci+1 : n===ci+1 ? ci : n;
    return n;
   };
   for(const details of preview.querySelectorAll('details[data-builder-key]')) {
    const key=details.dataset.builderKey; let m=key.match(/^category:(\d+)$/);
    if(m){const next=shiftCategory(Number(m[1]));if(next===null)delete details.dataset.builderKey;else details.dataset.builderKey=`category:${next}`;continue;}
    m=key.match(/^channel:(\d+):(\d+)$/);
    if(m){let c=Number(m[1]),i=Number(m[2]);const mapped=shiftCategory(c);if(mapped===null){delete details.dataset.builderKey;continue}
     if(c===ci && action==='channel-delete'){if(i===index){delete details.dataset.builderKey;continue}if(i>index)i--;}
     else if(c===ci && action==='channel-up' && index>0){if(i===index)i--;else if(i===index-1)i++;}
     else if(c===ci && action==='channel-down' && index<plan.categories[ci].channels.length-1){if(i===index)i++;else if(i===index+1)i--;}
     else if(action==='channel-move' && value!==ci && plan.categories[value] && c===ci){if(i===index){c=value;i=plan.categories[value].channels.length;}else if(i>index)i--;}
     details.dataset.builderKey=`channel:${c===Number(m[1])?mapped:c}:${i}`;continue;
    }
    m=key.match(/^role:(\d+)$/);
    if(m && action==='role-delete'){let n=Number(m[1]);if(n===ci)delete details.dataset.builderKey;else details.dataset.builderKey=`role:${n>ci?n-1:n}`;}
   }
  }
  function editStructure(action, ci, index, value, deferRender=false) {
   if (!planId || out.disabled || jsonDirty) { status.textContent = 'Validasi perubahan JSON sebelum mengubah preview.'; return; }
   let p; try {p=JSON.parse(out.value)} catch {status.textContent='JSON tidak valid.';return}
   const swap=(arr,a,b)=>{if (b>=0 && b<arr.length) [arr[a],arr[b]]=[arr[b],arr[a]]};
   const c=p.categories[ci];
   if(action==='category-add') p.categories.push({name:'Kategori Baru',channels:[]});
   else if(action==='category-name') c.name=value;
   else if(action==='category-delete') {if(!window.confirm('Hapus kategori beserta channel-nya dari rancangan? Discord belum berubah.'))return;remapDetails(action,ci,index,value,p);p.categories.splice(ci,1)}
   else if(action==='category-up') {remapDetails(action,ci,index,value,p);swap(p.categories,ci,ci-1)}
   else if(action==='category-down') {remapDetails(action,ci,index,value,p);swap(p.categories,ci,ci+1)}
   else if(action==='channel-add') c.channels.push({name:'channel-baru',type:'text'});
   else if(action==='channel-name') c.channels[index].name=value;
   else if(action==='channel-type') {c.channels[index].type=value;if(['voice','stage'].includes(value)) delete c.channels[index].topic}
   else if(action==='channel-topic') {if(value.trim()) c.channels[index].topic=value;else delete c.channels[index].topic}
   else if(action==='channel-delete') {remapDetails(action,ci,index,value,p);c.channels.splice(index,1)}
   else if(action==='channel-up') {remapDetails(action,ci,index,value,p);swap(c.channels,index,index-1)}
   else if(action==='channel-down') {remapDetails(action,ci,index,value,p);swap(c.channels,index,index+1)}
   else if(action==='channel-move') {
    if(p.categories[value] && value!==ci){
     remapDetails(action,ci,index,value,p);
     const channel=c.channels.splice(index,1)[0];
     // Preserve explicit inherited restrictions when moving out of a category; never silently open a private channel.
     if(!channel.access && c.access) channel.access=JSON.parse(JSON.stringify(c.access));
     p.categories[value].channels.push(channel);
    }
   }
   else if(action==='role-add') p.roles.push({name:'Role Baru'});
   else if(action==='role-name') {
    const role=p.roles[ci],old=typeof role==='string'?role:role.name;
    if(typeof role==='string')p.roles[ci]={name:value};else role.name=value;
    for(const cat of p.categories) for(const a of [cat.access,...cat.channels.map(ch=>ch.access)].filter(Boolean)) a.roles=list(a.roles).map(n=>n===old?value:n);
   }
   else if(action==='role-color') {const r=p.roles[ci];if(typeof r==='string') p.roles[ci]={name:r};if(value.trim()) p.roles[ci].color=value;else delete p.roles[ci].color}
   else if(action==='role-delete') {remapDetails(action,ci,index,value,p);const r=p.roles.splice(ci,1)[0], name=typeof r==='string'?r:r.name;for(const cat of p.categories) for(const a of [cat.access,...cat.channels.map(ch=>ch.access)].filter(Boolean)) a.roles=list(a.roles).filter(n=>n!==name)}
   else return;
   out.value=JSON.stringify(p,null,2);setEditState('PERUBAHAN BELUM DIVALIDASI');revision++;dirty=true;apply.disabled=true;check.disabled=true;saveDraft.disabled=true;checkStatus.textContent='Validasi sebelum memeriksa server.';status.textContent='Rancangan berubah. Validasi sebelum menerapkan.';
   // A text field changes on blur, before the next click. Do not replace that click target synchronously.
   if (deferRender) window.setTimeout(()=>{if(planId && !jsonDirty){try{drawPlan(preview,JSON.parse(out.value),editAccess,editStructure,existingRoles)}catch{}}},0);
   else drawPlan(preview,p,editAccess,editStructure,existingRoles);
  }
  const idle = (text) => preview.replaceChildren(el('p', { className: 'f-muted' }, text));
  function reset(text) {
   planId = null; dirty = false; jsonDirty = false; revision++; setEditState('');
   apply.disabled = true; save.disabled = true; cancel.disabled = true; check.disabled=true; saveDraft.disabled=true; checkStatus.textContent=''; out.disabled = true; out.value = '';
   if (note) { note.hidden = true; note.textContent = ''; }
   idle(text);
  }
  function show(draft, message) {
   planId = draft.id; dirty = false; jsonDirty = false; revision++; setEditState('');
   drawPlan(preview, draft.plan, editAccess, editStructure, existingRoles);
   out.value = JSON.stringify(draft.plan, null, 2);
   out.disabled = false; save.disabled = false; apply.disabled = false; cancel.disabled = false; check.disabled=false; saveDraft.disabled=false; runPreflight();
   const source = SOURCE_LABELS[draft.source] ? `SUMBER: ${SOURCE_LABELS[draft.source]}${draft.theme?.label ? ' · ' + draft.theme.label : ''}` : '';
   if (note) { const text = [source, draft.note].filter(Boolean).join(' — '); note.textContent = text; note.hidden = !text; }
   result.replaceChildren();
   status.textContent = message;
  }
  async function draft(button, pending, run) {
   if (busy) return;
   busy = true; button.disabled = true;
   reset('Menyusun rancangan…'); status.textContent = pending;
   try { show(await run(), 'Tinjau rancangan. Berlaku 5 menit dan sekali pakai.'); }
   catch (err) { idle('Belum ada rancangan.'); status.textContent = err.message; }
   finally { busy = false; button.disabled = false; }
  }

  out.oninput = () => { setEditState('PERUBAHAN BELUM DIVALIDASI'); revision++; dirty = true; jsonDirty = true; apply.disabled = true; check.disabled=true; saveDraft.disabled=true; checkStatus.textContent='Validasi sebelum memeriksa server.'; status.textContent = 'Rancangan berubah. Validasi sebelum menerapkan.'; };
  if (themeForm) themeForm.onsubmit = (e) => {
   e.preventDefault();
   const themeId = themeForm.elements.themeId.value;
   if (!themeId) { status.textContent = 'Pilih tema lebih dulu.'; return; }
   draft(themeForm.querySelector('button'), 'Menyiapkan tema…', () => req('theme', { themeId }));
  };
  form.onsubmit = async (e) => {
   e.preventDefault();
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm('Kirim deskripsi ke provider AI? Ini dapat memakai kuota dan berbiaya. Belum ada perubahan Discord.') : Promise.resolve(window.confirm('Kirim deskripsi ke provider AI? Ini dapat memakai kuota dan berbiaya. Belum ada perubahan Discord.'))))) return;
   draft(form.querySelector('button'), 'Menyusun rancangan dengan AI…', () => req('draft', { description: form.elements.description.value, confirmed: true }));
  };
  save.onclick = async () => {
   if (!planId) return;
   let plan;
   try { plan = JSON.parse(out.value); } catch { status.textContent = 'JSON tidak valid.'; return; }
   const current = revision;
   save.disabled = true; apply.disabled = true; status.textContent = 'Memvalidasi rancangan…';
   try {
    const r = await req('edit', { id: planId, plan });
    if (revision !== current) { dirty = true; status.textContent = 'Rancangan berubah lagi. Validasi ulang sebelum menerapkan.'; return; }
    out.value = JSON.stringify(r.plan, null, 2);
    drawPlan(preview, r.plan, editAccess, editStructure, existingRoles);
    dirty = false; jsonDirty = false; setEditState(''); apply.disabled = false; check.disabled=false; saveDraft.disabled=false; runPreflight();
    status.textContent = `Rancangan valid. Sisa waktu sekitar ${r.expiresInSeconds} detik.`;
   } catch (err) { dirty = true; status.textContent = err.message; }
   finally { save.disabled = !planId; }
  };
  async function runPreflight() {
   if(!planId || dirty) return;const id=planId,current=revision;checkStatus.textContent='Memeriksa kondisi server…';
   try {const r=await req('preflight',{id});if(planId===id && revision===current)checkStatus.textContent=r.ready?'Pemeriksaan awal lolos. Kondisi Discord bisa berubah sebelum penerapan.':'Pemeriksaan belum tersedia.';}
   catch(e){if(planId===id && revision===current)checkStatus.textContent=`Perlu perhatian: ${e.message}`;}
  }
  check.onclick=runPreflight;
  saveDraft.onclick=async()=>{if(!planId || dirty)return;try{await req('save-draft',{id:planId});status.textContent='Draft valid tersimpan. Muat kembali kapan saja; penerapan tetap butuh konfirmasi.'}catch(e){status.textContent=e.message}};
  restore.onclick=async()=>{if(planId && !window.confirm('Muat draft tersimpan dan ganti rancangan saat ini?'))return;draft(restore,'Memuat draft…',()=>req('restore-draft',{}));};
  deleteDraft.onclick=async()=>{if(!window.confirm('Hapus draft tersimpan? Rancangan yang sedang terbuka tidak diubah.'))return;try{await req('delete-draft',{confirmed:true});status.textContent='Draft tersimpan dihapus.'}catch(e){status.textContent=e.message}};
  apply.onclick = async () => {
   if (!planId || dirty || !(await (window.ZentixDialog ? window.ZentixDialog.confirm('Terapkan rancangan yang ditampilkan ke server Discord? Kategori, channel dan role akan dibuat beserta overwrite izin yang ditampilkan; role baru tidak ditetapkan ke anggota. Izin efektif dapat dipengaruhi role lain dan Administrator. Hasilnya tercatat dan dapat dibongkar dari tab Riwayat & bongkar.') : Promise.resolve(window.confirm('Terapkan rancangan yang ditampilkan ke server Discord? Kategori, channel dan role akan dibuat beserta overwrite izin yang ditampilkan; role baru tidak ditetapkan ke anggota. Izin efektif dapat dipengaruhi role lain dan Administrator. Hasilnya tercatat dan dapat dibongkar dari tab Riwayat & bongkar.'))))) return;
   const id = planId;
   planId = null; apply.disabled = true; save.disabled = true; cancel.disabled = true; check.disabled=true; saveDraft.disabled=true; out.disabled = true;
   status.textContent = 'Menerapkan… pada rancangan besar ini bisa memakan waktu sekitar satu menit.';
   result.replaceChildren();
   try {
    const r = await req('apply', { id, confirmed: true });
    status.textContent = `Selesai: ${countsText(r.counts || itemCounts(r.created))} dibuat. ${r.recorded === false ? 'Riwayat tidak dapat disimpan, jadi bangunan ini tidak bisa dibongkar otomatis.' : 'Tercatat di tab Riwayat & bongkar.'}`;
    drawItems(result, 'Yang dibuat', r.created);
   } catch (err) {
    status.textContent = err.message;
    // Only this explicit preflight rejection guarantees no Discord operation started.
    // Timeouts, partial failures and unknown errors must never re-enable a blind retry.
    if (err.code === 'PLAN_NAME_CONFLICT') {
     planId = id; dirty = true; setEditState('PERUBAHAN PERLU DITINJAU DAN DIVALIDASI'); out.disabled = false; save.disabled = false; cancel.disabled = false;
     out.closest('details').open = true;
    }
    drawItems(result, 'Sudah dibuat sebelum berhenti', err.created);
   }
  };
  cancel.onclick = async () => {
   if (!planId) return;
   const id = planId;
   reset('Belum ada rancangan.'); status.textContent = 'Rancangan dibatalkan. Tidak ada yang dibuat.';
   try { await req('cancel', { id }); } catch { /* an expired plan is gone already */ }
  };

  // The theme list and limits come from the bot, so the page cannot drift from what the bot accepts.
  read('themes').then((r) => {
   const select = themeForm?.elements.themeId;
   if (!select) return;
   select.replaceChildren(...list(r.themes).map((t) => el('option', { value: t.id }, `${t.emoji || ''} ${t.label} · ${t.categories} kategori, ${t.channels} channel, ${t.roles} role`.trim())));
   if (!select.options.length) select.append(el('option', { value: '' }, 'Tidak ada tema'));
   const limits = root.querySelector('#aiBuilderLimits');
   if (limits && r.limits) limits.textContent = `✳ MAKS. ${r.limits.categories} KATEGORI, ${r.limits.channels} CHANNEL, ${r.limits.roles} ROLE`;
  }).catch((err) => { const select = themeForm?.elements.themeId; if (select) select.replaceChildren(el('option', { value: '' }, 'Tema tidak dapat dimuat')); status.textContent = err.message; });
  // A plan drafted a moment ago (here or on another tab) is still waiting on the bot.
  read('pending').then((r) => { if (r.pending?.id && !planId && !busy) show(r.pending, `Rancangan yang masih menunggu dimuat kembali. Sisa waktu sekitar ${r.pending.expiresInSeconds} detik.`); }).catch(() => {});
 }

 function bindHistory(root) {
  const box = root.querySelector('#aiBuilderHistory');
  if (!box) return;
  const prepare = root.querySelector('#aiUndoPrepare'), preview = root.querySelector('#aiUndoPreview'), input = root.querySelector('#aiUndoConfirmation'), hint = root.querySelector('#aiUndoHint');
  const apply = root.querySelector('#aiUndoApply'), forget = root.querySelector('#aiUndoForget'), status = root.querySelector('#aiUndoStatus');
  let latest = null, review = null;

  const idle = (text) => { review = null; apply.disabled = true; input.value = ''; hint.textContent = 'Tinjau dulu; kalimat yang harus diketik muncul di sini.'; preview.replaceChildren(el('p', { className: 'f-muted' }, text)); };
  function drawBuilds(builds) {
   box.replaceChildren();
   latest = builds[0] || null;
   prepare.disabled = !latest; forget.disabled = !latest;
   if (!builds.length) { box.append(el('p', { className: 'f-muted' }, 'Belum ada bangunan yang tercatat. Terapkan sebuah rancangan di tab Rancang.')); return; }
   builds.forEach((build, index) => {
    const flags = [index === 0 ? 'TERAKHIR' : null, SOURCE_LABELS[build.source] || null, build.edited ? 'DISUNTING' : null, build.partial ? 'BERHENTI DI TENGAH' : null].filter(Boolean);
    const rows = list(build.items).map((item) => el('li', null, el('span', { className: 'b-tag' }, TYPE_LABELS[item.type] || 'OBJEK'), el('span', { className: 'b-name' }, String(item.name ?? ''))));
    box.append(el('details', { className: 'b-build' },
     el('summary', null,
      el('span', { className: 'b-build-title' }, String(build.label || 'Tanpa nama')),
      el('span', { className: 'b-build-meta' }, `${when(build.at)} · ${countsText(build.counts || itemCounts(build.items))}`),
      el('span', { className: 'b-build-flags' }, ...flags.map((flag) => el('span', { className: 'b-tag' }, flag)))),
     el('ul', null, ...rows)));
   });
  }
  async function load() {
   try { drawBuilds(list((await read('history')).builds)); }
   catch (err) { box.replaceChildren(el('p', { className: 'f-muted' }, err.message)); prepare.disabled = true; forget.disabled = true; }
  }

  prepare.onclick = async () => {
   prepare.disabled = true; idle('Memeriksa keadaan di Discord…'); status.textContent = '';
   try {
    const r = await req('undo/prepare', { confirmed: true });
    review = { id: r.id, confirmation: r.confirmation };
    const marks = { delete: 'DIHAPUS', gone: 'SUDAH TIDAK ADA', blocked: 'DILEWATI' };
    preview.replaceChildren(el('div', { className: 'b-counts' }, `${r.counts.delete} DIHAPUS · ${r.counts.gone} SUDAH TIDAK ADA · ${r.counts.blocked} DILEWATI`),
     el('div', { className: 'b-group' }, el('div', { className: 'b-group-name' }, `${String(r.build?.label || 'Bangunan')} · ${when(r.build?.at)}`),
      el('ul', null, ...list(r.items).map((item) => el('li', { className: `b-state-${item.state}` },
       el('span', { className: 'b-tag' }, marks[item.state] || 'OBJEK'),
       el('span', { className: 'b-name' }, `${TYPE_LABELS[item.type] || ''} ${String(item.name ?? '')}`.trim()),
       list(item.notes).length ? el('small', null, list(item.notes).join('; ')) : null)))),
     el('p', { className: 'f-callout' }, `⚠ ${r.warning}`));
    hint.textContent = `Ketik persis: ${r.confirmation}`;
    input.value = ''; apply.disabled = false;
    status.textContent = 'Tinjau daftar di atas. Berlaku 5 menit.';
   } catch (err) { idle('Belum ada yang ditinjau.'); status.textContent = err.message; }
   finally { prepare.disabled = !latest; }
  };
  apply.onclick = async () => {
   if (!review) return;
   if (input.value.trim() !== review.confirmation) { status.textContent = `Konfirmasi tidak cocok. Ketik persis: ${review.confirmation}`; return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm('Bongkar bangunan terakhir? Channel dihapus beserta pesannya dan role dilepas dari semua anggota. Ini tidak dapat dipulihkan.') : Promise.resolve(window.confirm('Bongkar bangunan terakhir? Channel dihapus beserta pesannya dan role dilepas dari semua anggota. Ini tidak dapat dipulihkan.'))))) return;
   const current = review;
   review = null; apply.disabled = true; status.textContent = 'Membongkar…';
   try {
    const r = await req('undo/apply', { id: current.id, confirmation: current.confirmation });
    idle('Belum ada yang ditinjau.');
    preview.replaceChildren();
    drawItems(preview, 'Dihapus', r.removed);
    drawItems(preview, 'Tidak terhapus · tetap tercatat', r.kept);
    if (!preview.children.length) preview.append(el('p', { className: 'f-muted' }, 'Tidak ada yang perlu dihapus; catatan ditutup.'));
    status.textContent = `Dibongkar: ${countsText(r.counts || itemCounts(r.removed))} dihapus.${list(r.kept).length ? ' Sebagian tidak terhapus; bereskan penyebabnya lalu tinjau lagi.' : ''}${r.recorded === false ? ' Riwayat tidak dapat diperbarui; muat ulang halaman.' : ''}`;
   } catch (err) { idle('Belum ada yang ditinjau.'); status.textContent = `${err.message} Tinjau lagi sebelum mencoba.`; }
   await load();
  };
  forget.onclick = async () => {
   if (!latest || !(await (window.ZentixDialog ? window.ZentixDialog.confirm('Lepas bangunan terakhir dari riwayat? Tidak ada yang dihapus di Discord, tetapi bangunan itu tidak bisa lagi dibongkar otomatis.') : Promise.resolve(window.confirm('Lepas bangunan terakhir dari riwayat? Tidak ada yang dihapus di Discord, tetapi bangunan itu tidak bisa lagi dibongkar otomatis.'))))) return;
   forget.disabled = true; idle('Belum ada yang ditinjau.');
   try { await req('undo/forget', { buildId: latest.id, confirmed: true }); status.textContent = 'Catatan dilepas. Objeknya tetap ada di Discord.'; }
   catch (err) { status.textContent = err.message; }
   await load();
  };
  load();
 }

 function bindManual(root) {
  const manual = root.querySelector('#aiManualForm');
  if (!manual) return;
  const preview = root.querySelector('#aiManualPreview'), manualStatus = root.querySelector('#aiManualStatus'), confirmInput = root.querySelector('#aiManualConfirmation'), manualApply = root.querySelector('#aiManualApply'), undo = root.querySelector('#aiManualUndo');
  let ticket = null, undoTicket = null, version = 0;
  const changed = () => { version++; ticket = null; manualApply.disabled = true; preview.textContent = 'Input berubah; tinjau lagi sebelum menjalankan.'; };
  manual.addEventListener('input', changed); manual.addEventListener('change', changed);
  manual.onsubmit = async (e) => {
   e.preventDefault(); ticket = null; manualApply.disabled = true;
   const x = manual.elements, action = x.action.value, kind = x.kind.value, value = action === 'delete' ? null : action === 'rename' ? x.newName.value : [...manual.querySelectorAll('input[name=permission]:checked')].map((box) => box.value), current = version, button = manual.querySelector('button');
   button.disabled = true; manualStatus.textContent = 'Mengambil keadaan target…';
   try {
    const r = await req('manual/prepare', { kind, action, targetId: x.targetId.value, value });
    if (current !== version) { manualStatus.textContent = 'Input berubah; tinjau ulang.'; return; }
    ticket = { id: r.id, action, targetId: r.before.id };
    preview.textContent = JSON.stringify({ tindakan: r.action, sebelum: r.before, sesudah: r.after, izinSebelum: r.permissionsBefore, izinSesudah: r.permissionsAfter, peringatan: r.warning }, null, 2);
    confirmInput.value = ''; manualApply.disabled = false; manualStatus.textContent = 'Tinjau detail. Berlaku 5 menit.';
   } catch (err) { manualStatus.textContent = err.message; }
   finally { button.disabled = false; }
  };
  manualApply.onclick = async () => {
   if (!ticket) return;
   if (confirmInput.value !== (ticket.action === 'delete' ? `HAPUS ${ticket.targetId}` : ticket.targetId)) { manualStatus.textContent = 'Konfirmasi target tidak cocok.'; return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(ticket.action === 'delete' ? 'Hapus target secara permanen? Pesan atau penetapan role dapat hilang dan tidak dapat dipulihkan.' : 'Jalankan perubahan pada target Discord yang ditinjau?') : Promise.resolve(window.confirm(ticket.action === 'delete' ? 'Hapus target secara permanen? Pesan atau penetapan role dapat hilang dan tidak dapat dipulihkan.' : 'Jalankan perubahan pada target Discord yang ditinjau?'))))) return;
   const current = ticket; ticket = null; manualApply.disabled = true; manualStatus.textContent = 'Menjalankan…';
   try {
    const r = await req('manual/apply', { id: current.id, confirmation: confirmInput.value });
    undoTicket = r.undoId ? { id: r.undoId, targetId: r.targetId } : null; undo.disabled = !undoTicket; confirmInput.value = '';
    manualStatus.textContent = r.undoId ? 'Perubahan diterapkan. Rollback terbatas tersedia 5 menit dengan mengetik ID target.' : 'Tindakan selesai. Rollback tidak tersedia; periksa Discord.';
   } catch (err) { manualStatus.textContent = err.message + ' Tinjau ulang sebelum mencoba.'; }
  };
  undo.onclick = async () => {
   if (!undoTicket) return;
   if (confirmInput.value !== undoTicket.targetId) { manualStatus.textContent = 'Untuk rollback, ketik ID target.'; return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm('Kembalikan nama atau izin role yang terakhir diubah? Perubahan hanya diterapkan jika target belum berubah sejak itu.') : Promise.resolve(window.confirm('Kembalikan nama atau izin role yang terakhir diubah? Perubahan hanya diterapkan jika target belum berubah sejak itu.'))))) return;
   const u = undoTicket; undoTicket = null; undo.disabled = true; manualStatus.textContent = 'Memproses rollback…';
   try { await req('manual/undo', { id: u.id, confirmation: confirmInput.value }); confirmInput.value = ''; manualStatus.textContent = 'Rollback selesai.'; }
   catch (err) { manualStatus.textContent = err.message + ' Periksa Discord sebelum tindakan lain.'; }
  };
 }

 function bind(root) { bindDesign(root); bindHistory(root); bindManual(root); }
 window.ZentixAIBuilder = { render, bind };
})();
