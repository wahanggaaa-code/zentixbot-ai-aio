// AI Studio → Server Builder, connected to the bot. Three tabs:
//   design  – draft a plan from a ready-made theme or with the AI, review it, edit it, apply it;
//   history – what the builder created, and taking the newest build down again;
//   manual  – rename, re-permission or delete one existing object.
// Names in a plan come from an AI or from whoever edited it, so everything is put on the page as text
// (textContent), never as markup.
(() => {
 const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
 // Exact bot-generated safety copy only. Discord names, unknown notes and confirmation
 // phrases are server data and must remain unchanged.
 const BUILDER_COPY = new Map([
  ['PENGHAPUSAN PERMANEN: channel dihapus beserta seluruh pesannya dan role dilepas dari semua anggota. Bot tidak dapat memulihkannya.','PERMANENT DELETION: channels are deleted with all their messages and roles are removed from all members. The bot cannot restore them.'],
  ['PENGHAPUSAN PERMANEN: pesan, pengaturan atau keanggotaan role dapat hilang dan tidak bisa dipulihkan oleh bot.','PERMANENT DELETION: messages, settings or role memberships may be lost and cannot be restored by the bot.'],
  ['Perubahan berlaku di Discord; permission overwrite channel dapat mengubah izin efektif.','Changes take effect in Discord; channel permission overwrites can change effective permissions.'],
  ['sudah tidak ada','already gone'],
  ['tidak dapat dihapus bot: role berada di atas role bot atau dikelola integrasi','the bot cannot delete it: the role is above the bot role or managed by an integration'],
  ['izinnya sudah diubah','permissions have changed'],
  ['tidak dihapus: dipakai sebagai channel sistem server','not deleted: used as a server system channel'],
  ['sudah berisi pesan','already contains messages'],
  ['Discord menolak atau tidak menjawab','Discord refused or did not respond'],
  ['AI tidak menghasilkan rancangan yang valid (jawabannya terpotong atau bentuknya salah).','AI did not produce a valid plan (the response was truncated or malformed).'],
  ['Provider AI tidak dapat dihubungi.','The AI provider could not be reached.'],
  ['Draft tersimpan dimuat kembali. Tinjau dan periksa sebelum diterapkan.','The saved draft was loaded. Review and check it before applying.'],
 ]);
 const builderCopy=value=>{
  if(window.ZentixI18n?.language!=='en'||typeof value!=='string')return value;
  const known=BUILDER_COPY.get(value);if(known!==undefined)return known;
  // Only the surrounding fixed copy changes. Names and counts from Discord stay byte-for-byte.
  let m=/^sekarang bernama "([\s\S]*)"$/.exec(value);
  if(m)return `now named "${m[1]}"`;
  m=/^tidak dihapus: masih berisi ([1-9][0-9]*) channel yang bukan bagian bangunan ini$/.exec(value);
  if(m)return `not deleted: still contains ${m[1]} ${m[1]==='1'?'channel':'channels'} outside this build`;
  m=/^masih berisi ([1-9][0-9]*) channel yang tidak terhapus$/.exec(value);
  if(m)return `still contains ${m[1]} ${m[1]==='1'?'channel':'channels'} that could not be deleted`;
  m=/^([1-9][0-9]*) orang sedang di dalam$/.exec(value);
  if(m)return `${m[1]} ${m[1]==='1'?'person is':'people are'} currently inside`;
  return value;
 };
 // The fallback suffix is verified against the returned theme metadata. Keep the
 // theme name and any unfamiliar provider reason verbatim.
 function draftNote(draft){
  const note=draft.note;
  if(window.ZentixI18n?.language!=='en'||typeof note!=='string')return note;
  if(draft.source==='fallback'&&typeof draft.theme?.emoji==='string'&&typeof draft.theme?.label==='string'){
   const suffix=` Sebagai gantinya dipakai tema terdekat: ${draft.theme.emoji} ${draft.theme.label}. Rancangan ini tetap bisa disunting sebelum diterapkan.`;
   if(note.endsWith(suffix)){
    const reason=note.slice(0,-suffix.length);
    const translated=builderCopy(reason);
    return `${translated===reason?(window.ZentixI18n?.aiError?.(reason)??reason):translated} The closest theme is used instead: ${draft.theme.emoji} ${draft.theme.label}. This plan can still be edited before applying.`;
   }
  }
  return builderCopy(note);
 }
 // Status + exact message are required; dynamic names and external diagnostics stay untouched.
 const BUILDER_ERRORS=new Map([
  ['400\0Input tidak valid.','Invalid input.'],
  ['400\0Konfirmasi diperlukan.','Confirmation is required.'],
  ['400\0Konfirmasi penerapan diperlukan.','Apply confirmation is required.'],
  ['400\0Rancangan tidak valid.','Invalid plan.'],
  ['400\0Tema tidak valid.','Invalid theme.'],
  ['400\0Nama tidak valid.','Invalid name.'],
  ['400\0Nama channel harus berupa huruf kecil ASCII, angka, - atau _.','Channel names must use lowercase ASCII letters, numbers, - or _.'],
  ['400\0Pilihan izin role tidak valid.','Invalid role permission selection.'],
  ['400\0Tindakan tidak valid.','Invalid action.'],
  ['400\0Tidak ada perubahan.','There are no changes.'],
  ['400\0Konfirmasi target tidak cocok.','Target confirmation does not match.'],
  ['400\0Konfirmasi tidak cocok.','Confirmation does not match.'],
  ['400\0Deskripsi harus 1–1000 karakter.','The description must be 1–1000 characters.'],
  ['400\0Jawaban AI tidak berisi JSON.','The AI response does not contain JSON.'],
  ['400\0AI tidak boleh memilih role yang sudah ada.','AI cannot select existing roles.'],
  ['403\0Target tidak valid.','Invalid target.'],
  ['403\0Izin bot tidak mencukupi.','The bot does not have sufficient permissions.'],
  ['403\0Role tidak tersedia atau tidak aman diubah.','The role is unavailable or cannot be safely changed.'],
  ['403\0Role berizin tinggi atau di luar daftar aman tidak dapat dikelola di sini.','Roles with elevated permissions or outside the safe list cannot be managed here.'],
  ['403\0Channel tidak tersedia atau tidak aman diubah.','The channel is unavailable or cannot be safely changed.'],
  ['403\0Channel sistem tidak dapat dikelola di sini.','System channels cannot be managed here.'],
  ['403\0Bot memerlukan Manage Channels dan Manage Roles sesuai rencana.','The bot needs Manage Channels and Manage Roles as required by the plan.'],
  ['403\0Izin channel memerlukan Manage Roles dan identitas bot.','Channel permissions require Manage Roles and the bot identity.'],
  ['403\0Bot harus memiliki izin dasar yang akan diatur pada channel sebelum menerapkan.','The bot must have the base permissions to be configured on the channel before applying.'],
  ['403\0Server atau persetujuan tidak valid.','Invalid server or consent.'],
  ['403\0Server atau pengguna tidak valid.','Invalid server or user.'],
  ['403\0Server tidak valid.','Invalid server.'],
  ['403\0Bot memerlukan Manage Channels dan Manage Roles untuk membongkar.','The bot needs Manage Channels and Manage Roles to tear down the build.'],
  ['404\0Tinjauan tidak ditemukan atau kedaluwarsa.','The review was not found or expired.'],
  ['404\0Rancangan tidak ditemukan atau kedaluwarsa.','The plan was not found or expired.'],
  ['404\0Tema tidak dikenal.','Unknown theme.'],
  ['404\0Belum ada draft tersimpan.','There is no saved draft.'],
  ['404\0Belum ada bangunan yang tercatat.','There is no recorded build.'],
  ['409\0Kategori berisi channel; pindahkan dahulu secara manual.','The category contains channels; move them manually first.'],
  ['409\0Tindakan lain sedang berjalan.','Another action is in progress.'],
  ['409\0Target berubah setelah ditinjau; buat tinjauan baru.','The target changed after review; create a new review.'],
  ['409\0Discord gagal atau timeout; hasil mungkin berubah. Periksa Discord sebelum mencoba ulang.','Discord failed or timed out; the outcome may have changed. Check Discord before retrying.'],
  ['409\0Target berubah setelah tindakan; rollback dibatalkan.','The target changed after the action; rollback was cancelled.'],
  ['409\0Rollback gagal atau timeout; periksa Discord sebelum tindakan lain.','Rollback failed or timed out; check Discord before taking another action.'],
  ['409\0Rancangan berubah. Tinjau lagi.','The plan changed. Review it again.'],
  ['409\0Rancangan berubah saat diperiksa. Tinjau lagi.','The plan changed during the check. Review it again.'],
  ['409\0Rencana melewati batas server.','The plan exceeds server limits.'],
  ['409\0Role yang dipilih tidak tersedia, adalah @everyone atau dikelola integrasi. Pilih ulang.','The selected role is unavailable, is @everyone, or is managed by an integration. Choose again.'],
  ['409\0Penerapan atau pembongkaran lain masih berjalan.','Another apply or teardown is still in progress.'],
  ['409\0Riwayat berubah setelah ditinjau; tinjau lagi.','History changed after review; review again.'],
  ['409\0Keadaan server berubah setelah ditinjau; tinjau lagi.','Server state changed after review; review again.'],
  ['409\0Catatan itu bukan bangunan terakhir; muat ulang riwayat.','That record is not the latest build; reload history.'],
  ['409\0Penerapan gagal sebelum ada yang dibuat. Periksa izin bot lalu buat rancangan baru.','Apply failed before anything was created. Check the bot permissions, then create a new plan.'],
  ['409\0Penerapan berhenti di tengah jalan. Yang sudah dibuat tercatat di riwayat dan dapat dibongkar dari sana.','Apply stopped partway through. Created objects were recorded in history and can be torn down there.'],
  ['409\0Penerapan berhenti di tengah jalan dan riwayat tidak dapat disimpan. Periksa Discord dan hapus objek di daftar hasil secara manual.','Apply stopped partway through and history could not be saved. Check Discord and manually delete the objects in the results list.'],
  ['429\0Terlalu banyak tindakan menunggu.','Too many actions are pending.'],
  ['429\0Terlalu banyak rancangan menunggu.','Too many plans are pending.'],
  ['429\0Terlalu banyak tinjauan menunggu.','Too many reviews are pending.'],
  ['503\0Keadaan server tidak dapat dibaca dari Discord. Coba lagi.','Server state could not be read from Discord. Try again.'],
  ['503\0Daftar role Discord tidak dapat dibaca.','The Discord role list could not be read.'],
  ['503\0Daftar role Discord tidak dapat dibaca. Coba lagi.','The Discord role list could not be read. Try again.'],
  ['503\0Riwayat pembangunan tidak dapat dibaca, jadi penerapan dibatalkan. Coba lagi nanti.','Build history could not be read, so apply was cancelled. Try again later.'],
 ]);
 // Plan validation reports locations by number; keep JSON field keys and user names unchanged.
 const VALIDATION_DETAILS=new Map([
  ['harus berisi "name" dan "channels" saja.','must contain only "name" and "channels".'],
  ['nama tidak valid.','invalid name.'],
  ['nama kategori dipakai dua kali.','category name is used twice.'],
  ['paling banyak 15 channel per kategori.','at most 15 channels per category.'],
  ['harus berisi "name" dan "type", boleh ditambah "topic".','must contain "name" and "type", optionally "topic".'],
  ['"type" harus salah satu dari text, voice, forum, news, stage.','"type" must be one of text, voice, forum, news, stage.'],
  ['nama channel dipakai dua kali.','channel name is used twice.'],
  ['"topic" harus berupa teks.','"topic" must be text.'],
  ['"topic" hanya untuk channel text, forum atau news.','"topic" is only for text, forum or news channels.'],
  ['"topic" paling banyak 200 karakter, satu baris, tanpa @, <, >, ` atau tautan.','"topic" must be at most 200 characters, on one line, without @, <, >, ` or links.'],
  ['access harus berisi mode dan daftar role.','access must contain a mode and a role list.'],
  ['daftar role akses tidak valid atau berulang.','the access role list is invalid or contains duplicates.'],
  ['harus berisi "name", boleh ditambah "color".','must contain "name", optionally "color".'],
  ['nama role dipakai dua kali.','role name is used twice.'],
  ['"color" harus berbentuk #RRGGBB.','"color" must be in #RRGGBB format.'],
 ]);
 const VALIDATION_GLOBAL=new Map([
  ['Rancangan harus berupa objek berisi "categories" dan "roles" saja.','The plan must be an object containing only "categories" and "roles".'],
  ['Rancangan harus memiliki 1–8 kategori.','The plan must contain 1–8 categories.'],
  ['Rancangan paling banyak memiliki 12 role.','The plan may contain at most 12 roles.'],
  ['Rancangan harus memiliki 1–40 channel.','The plan must contain 1–40 channels.'],
 ]);
 function validationError(message){
  const global=VALIDATION_GLOBAL.get(message);if(global!==undefined)return global;
  let m=/^Kategori ke-([1-9][0-9]*): ([\s\S]+)$/.exec(message),place;
  if(m)place=`Category ${m[1]}`;
  else if((m=/^Channel ke-([1-9][0-9]*) di kategori ke-([1-9][0-9]*): ([\s\S]+)$/.exec(message)))place=`Channel ${m[1]} in category ${m[2]}`;
  else if((m=/^Role ke-([1-9][0-9]*): ([\s\S]+)$/.exec(message)))place=`Role ${m[1]}`;
  if(m){
   const detail=m[m.length-1],known=VALIDATION_DETAILS.get(detail);
   if(known!==undefined)return `${place}: ${known}`;
   const slug=/^nama channel (text|forum|news) harus huruf kecil tanpa spasi \(pakai -\)\.$/.exec(detail);
   if(slug)return `${place}: ${slug[1]} channel names must be lowercase without spaces (use -).`;
   return message;
  }
  m=/^Kategori ([\s\S]+) privat: channel baca saja harus memakai private-read-only agar tidak membuka akses lihat\.$/.exec(message);
  if(m)return `Private category ${m[1]}: read-only channels must use private-read-only to avoid granting view access.`;
  m=/^Role akses ([\s\S]+) tidak ada di rancangan\.$/.exec(message);
  if(m)return `Access role ${m[1]} is not in the plan.`;
  return message;
 }
 const builderError=(message,status,code)=>{
  if(window.ZentixI18n?.language!=='en'||typeof message!=='string')return message;
  const known=BUILDER_ERRORS.get(`${status}\0${message}`);if(known!==undefined)return known;
  if(status===400 && code==='UNAVAILABLE')return validationError(message);
  if(status===409 && code==='PLAN_NAME_CONFLICT'){
   const m=/^Nama sudah ada di server: ([\s\S]+)\. Sunting nama lalu validasi lagi\.$/.exec(message);
   if(m)return `Names already exist on the server: ${m[1]}. Edit the names and validate again.`;
  }
  if(status===409 && code==='UNAVAILABLE'){
   const m=/^Channel bertipe forum, news dan stage memerlukan fitur Komunitas Discord, yang belum aktif di server ini\. Ubah tipe ([1-9][0-9]*) channel itu menjadi text atau voice, atau aktifkan Komunitas di Pengaturan Server\.$/.exec(message);
   if(m)return `Forum, news and stage channels require Discord Community, which is not enabled on this server. Change those ${m[1]} ${m[1]==='1'?'channel':'channels'} to text or voice, or enable Community in Server Settings.`;
  }
  return message;
 };
 const API = '/dashboard/api/ai/builder/';
 async function req(path, body) {
  const s = await window.ZentixSession;
  const r = await fetch(API + path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-csrf-token': s.csrf }, body: JSON.stringify(body) });
  const b = await r.json();
  if (!r.ok) { const e = Error((window.ZentixI18n?.accessError?.(b.error,r.status) ?? builderError(window.ZentixI18n?.aiError?.(b.error) ?? b.error,r.status,b.code)) || tr('Permintaan gagal','Request failed')); e.created = b.created; e.recorded = b.recorded; e.code = b.code; throw e; }
  return b;
 }
 async function read(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  const b = await r.json();
  if (!r.ok) throw Error((window.ZentixI18n?.accessError?.(b.error,r.status) ?? builderError(window.ZentixI18n?.aiError?.(b.error) ?? b.error,r.status,b.code)) || tr('Data tidak dapat dimuat','Could not load data'));
  return b;
 }
 /** Builds an element: el('li', {className:'x'}, 'text', childNode, …). Strings become text nodes. */
 function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) node[key] = value;
  for (const child of children) if (child !== null && child !== undefined && child !== '') node.append(child);
  return node;
 }
 const TYPE_LABELS = { category: tr('KATEGORI','CATEGORY'), text: tr('TEKS','TEXT'), voice: tr('SUARA','VOICE'), forum: 'FORUM', news: tr('PENGUMUMAN','ANNOUNCEMENT'), stage: tr('PANGGUNG','STAGE'), role: 'ROLE' };
 const SOURCE_LABELS = { ai: 'AI', theme: tr('TEMA','THEME'), fallback: tr('TEMA CADANGAN','FALLBACK THEME') };
 const list = (value) => (Array.isArray(value) ? value : []);
 const countsOf = (plan) => ({ categories: list(plan?.categories).length, channels: list(plan?.categories).reduce((n, c) => n + list(c?.channels).length, 0), roles: list(plan?.roles).length });
 const countsText = (c, separator=' · ') => [tr(`${c.categories} kategori`,`${c.categories} ${c.categories===1?'category':'categories'}`),tr(`${c.channels} channel`,`${c.channels} ${c.channels===1?'channel':'channels'}`),tr(`${c.roles} role`,`${c.roles} ${c.roles===1?'role':'roles'}`)].join(separator);
 function itemCounts(items) {
  const c = { categories: 0, channels: 0, roles: 0 };
  for (const item of list(items)) c[item.type === 'category' ? 'categories' : item.type === 'role' ? 'roles' : 'channels']++;
  return c;
 }
 const when = (at) => { try { return new Date(at).toLocaleString(tr('id-ID','en-GB'), { dateStyle: 'medium', timeStyle: 'short', hour12: false }); } catch { return '-'; } };

 // Display IDs only for ambiguous or unavailable server roles; IDs remain the stored values.
 function serverRoleLabel(id,roles){
  const role=roles.find(r=>r.id===id);
  if(!role)return `${tr('Role tidak ditemukan','Role not found')} · ID ${id}`;
  const name=role.name||tr('Role tanpa nama','Unnamed role');
  return `${name}${!role.name||roles.some(r=>r.id!==id&&r.name===role.name)?` · ID ${id}`:''}`;
 }
 function accessText(access, fallback, existingRoles=[]) {
  if (!access) return fallback;
  const who = [...list(access.roles), ...list(access.existingRoles).map(id => serverRoleLabel(id,existingRoles)) ].join(', ') || tr('(belum ada role)','(no roles yet)');
  if (access.mode === 'private-read-only') return tr(`PRIVAT + BACA SAJA: @everyone ditolak melihat, mengirim dan membuat thread; ${who} dan bot diizinkan.`,`PRIVATE + READ ONLY: @everyone is denied viewing, sending and creating threads; ${who} and the bot are allowed.`);
  return access.mode === 'private' ? tr(`PRIVAT: @everyone ditolak melihat; ${who} dan bot boleh melihat.`,`PRIVATE: @everyone is denied viewing; ${who} and the bot may view.`) : tr(`BACA SAJA: @everyone ditolak mengirim/membuat thread; ${who} dan bot diizinkan. Akses lihat mengikuti default server, bukan pembatasan kategori.`,`READ ONLY: @everyone is denied sending/creating threads; ${who} and the bot are allowed. View access follows server defaults, not category restrictions.`);
 }
 /** The plan as a readable list; editing access updates only the unvalidated JSON draft. */
 function drawPlan(box, plan, onAccessEdit, onStructureEdit, existingRoles=[]) {
  // Renders after each edit. Keep expanded panels and the role review selection stable.
  const opened = new Set([...box.querySelectorAll('details[data-builder-key][open]')].map(d => d.dataset.builderKey));
  const selectedReview = box.querySelector('select[data-builder-role-review]')?.value;
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
   const modes = {'read-only':tr('BACA SAJA','READ ONLY'), private:tr('PRIVAT','PRIVATE'), 'private-read-only':tr('PRIVAT · BACA SAJA','PRIVATE · READ ONLY')};
   return current ? `${!list(current.roles).length && !list(current.existingRoles).length ? tr('PILIH ROLE · ','SELECT ROLES · ') : ''}${!access && inherited ? tr('IKUTI · ','INHERITED · ') : ''}${modes[current.mode] || tr('PERLU DITINJAU','REVIEW NEEDED')}` : tr('DEFAULT SERVER','SERVER DEFAULT');
  };
  box.append(el('div', { className: 'b-counts' }, countsText(countsOf(plan)).toUpperCase()));
  function accessEditor(access, categoryIndex, channelIndex) {
   const select = el('select', { 'ariaLabel': channelIndex === null ? tr('Izin kategori','Category permissions') : tr('Izin channel','Channel permissions') });
   for (const [value, name] of [['', channelIndex === null ? tr('Ikuti default server','Follow server default') : tr('Ikuti kategori','Follow category')], ['read-only', tr('Baca saja','Read only')], ['private', tr('Privat','Private')], ['private-read-only', tr('Privat + baca saja','Private + read only')]]) select.append(el('option', {value}, name));
   select.setAttribute('aria-label', channelIndex === null ? tr('Izin kategori','Category permissions') : tr('Izin channel','Channel permissions'));
   select.value = access?.mode || '';
   select.onchange = () => onAccessEdit(categoryIndex, channelIndex, 'mode', select.value);
   const wrapper = el('div', { className: 'b-access' }, el('label', null, tr('Akses: ','Access: '), select));
   if (access) {
    const names = list(plan?.roles).map(role => typeof role === 'string' ? role : role?.name).filter(name => typeof name === 'string');
    const group = el('fieldset', {className:'b-perms'}, el('legend', null, tr('Role rancangan yang diizinkan','Allowed planned roles')));
    for (const name of names) {
     const input = el('input', {type:'checkbox', checked:list(access.roles).includes(name)});
     input.onchange = () => onAccessEdit(categoryIndex, channelIndex, 'role', {name, checked:input.checked});
     group.append(el('label', null, input, ` ${name} `));
    }
    if (!names.length) group.append(el('p', {className:'f-muted'}, tr('Belum ada role baru.','No new roles yet.')));
    const serverGroup=el('div',{className:'b-existing-roles'},el('p',{className:'f-muted'},tr('Role server dipakai hanya pada channel baru; role tidak diubah.','Server roles are used only on new channels; roles are not changed.')));
    for(const id of list(access.existingRoles)) {
     const item=el('label',null);const input=el('input',{type:'checkbox',checked:true});
     input.onchange=()=>onAccessEdit(categoryIndex,channelIndex,'existingRole',{id,checked:false});
     input.setAttribute('aria-label',`${tr('Role server','Server role')}: ${existingRoles.find(r=>r.id===id)?.name || tr('Role tidak ditemukan','Role not found')} (ID ${id})`);
     item.append(input, ` ${serverRoleLabel(id,existingRoles)} `);serverGroup.append(item);
    }
    if(existingRoles.length){
     const selectRole=el('select',{});selectRole.setAttribute('aria-label',tr('Tambahkan role server','Add server role'));selectRole.append(el('option',{value:''},tr('Pilih role server…','Choose server role…')));
     for(const role of existingRoles.filter(r=>!list(access.existingRoles).includes(r.id)))selectRole.append(el('option',{value:role.id},serverRoleLabel(role.id,existingRoles)));
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
    const typeSelect=el('select',{});typeSelect.setAttribute('aria-label',tr('Jenis channel','Channel type'));
    for(const value of ['text','voice','forum','news','stage'])typeSelect.append(el('option',{value},TYPE_LABELS[value]));
    typeSelect.value=channel.type;typeSelect.onchange=()=>onStructureEdit('channel-type',ci,i,typeSelect.value);
    const move=el('select',{});move.setAttribute('aria-label',tr('Pindah channel ke kategori','Move channel to category'));
    for(const [n,c] of list(plan.categories).entries())move.append(el('option',{value:String(n)},String(c.name)));
    move.value=String(ci);move.onchange=()=>onStructureEdit('channel-move',ci,i,Number(move.value));
    const summary=el('summary',{className:'b-channel-summary'},
     el('span',{className:'b-channel-kind','ariaHidden':'true'},channel?.type==='voice' || channel?.type==='stage'?'♫':'#'),
     el('span',{className:'b-channel-info'},el('strong',null,String(channel?.name ?? '')),el('small',null,type)),
     el('span',{className:'b-access-badge'},accessBadge(channel?.access, category?.access)),
     el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
    const body=el('div',{className:'b-preview-body'},
     el('p',{className:'b-access-explanation'},(!channel?.access && category?.access ? tr('Mengikuti izin kategori. ','Follows category permissions. ') : '') + accessText(channel?.access || category?.access, tr('Mengikuti izin default server.','Follows server default permissions.'), existingRoles)),
     el('div',{className:'b-edit-grid'},
      field(tr('Nama channel','Channel name'),textInput(channel.name,tr('Nama channel','Channel name'),v=>onStructureEdit('channel-name',ci,i,v,true))),
      field(tr('Jenis','Type'),typeSelect),
      field(tr('Topik (opsional)','Topic (optional)'),textInput(channel.topic||'',tr('Topik channel (opsional)','Channel topic (optional)'),v=>onStructureEdit('channel-topic',ci,i,v,true))),
      field(tr('Pindah ke kategori','Move to category'),move)),
     accessEditor(channel?.access,ci,i),
     el('div',{className:'b-preview-actions'},button('↑',()=>onStructureEdit('channel-up',ci,i),i===0,tr(`Pindahkan channel ${channel.name} (kategori ${ci+1}, urutan ${i+1}) ke atas`,`Move channel ${channel.name} (category ${ci+1}, position ${i+1}) up`)),button('↓',()=>onStructureEdit('channel-down',ci,i),i===category.channels.length-1,tr(`Pindahkan channel ${channel.name} (kategori ${ci+1}, urutan ${i+1}) ke bawah`,`Move channel ${channel.name} (category ${ci+1}, position ${i+1}) down`)),button(tr('Hapus channel','Delete channel'),()=>onStructureEdit('channel-delete',ci,i),false,tr(`Hapus channel ${channel.name} (kategori ${ci+1}, urutan ${i+1})`,`Delete channel ${channel.name} (category ${ci+1}, position ${i+1})`))));
    return el('li',null,expandable(`channel:${ci}:${i}`,summary,body));
   });
   const categorySummary=el('summary',{className:'b-category-edit-summary'},tr('EDIT KATEGORI & IZIN','EDIT CATEGORY & PERMISSIONS'),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
   const categoryEdit=expandable(`category:${ci}`,categorySummary,el('div',{className:'b-preview-body'},
    el('p',{className:'b-access-explanation'},accessText(category?.access,tr('Mengikuti izin default server.','Follows server default permissions.'),existingRoles)),
    field(tr('Nama kategori','Category name'),textInput(category.name,tr('Nama kategori','Category name'),v=>onStructureEdit('category-name',ci,null,v,true))),
    accessEditor(category?.access,ci,null),
    el('div',{className:'b-preview-actions'},button('↑',()=>onStructureEdit('category-up',ci),ci===0,tr(`Pindahkan kategori ${category.name} (urutan ${ci+1}) ke atas`,`Move category ${category.name} (position ${ci+1}) up`)),button('↓',()=>onStructureEdit('category-down',ci),ci===plan.categories.length-1,tr(`Pindahkan kategori ${category.name} (urutan ${ci+1}) ke bawah`,`Move category ${category.name} (position ${ci+1}) down`)),button(tr('Hapus kategori','Delete category'),()=>onStructureEdit('category-delete',ci),false,tr(`Hapus kategori ${category.name} (urutan ${ci+1})`,`Delete category ${category.name} (position ${ci+1})`)))));
   box.append(el('section',{className:'b-preview-category'},
    el('div',{className:'b-category-heading'},el('div',null,el('span',{className:'b-category-overline'},`${tr('KATEGORI','CATEGORY')} ${String(ci+1).padStart(2,'0')}`),el('h3',null,String(category?.name ?? ''))),el('div',{className:'b-category-meta'},el('span',{className:'b-category-count'},`${rows.length} CHANNEL`),el('span',{className:'b-access-badge'},accessBadge(category?.access,null)))),
    categoryEdit,
    rows.length ? el('ul',{className:'b-channel-list'},...rows) : el('p',{className:'f-muted'},tr('Kategori kosong.','Empty category.')),
    button(tr('+ TAMBAH CHANNEL','+ ADD CHANNEL'),()=>onStructureEdit('channel-add',ci),false,tr(`Tambah channel ke kategori ${category.name} (urutan ${ci+1})`,`Add channel to category ${category.name} (position ${ci+1})`))));
  }
  const addCategory=button(tr('+ TAMBAH KATEGORI','+ ADD CATEGORY'),()=>onStructureEdit('category-add'));
  addCategory.className='b-preview-add';box.append(addCategory);
  const roles = list(plan?.roles).map((role, index) => {
   const name = typeof role === 'string' ? role : String(role?.name ?? '');
   const color = typeof role?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(role.color) ? role.color : null;
   const swatch = el('span', { className: 'b-swatch' });if (color) swatch.style.background=color;
   const summary=el('summary',{className:'b-role-summary'},swatch,el('span',{className:'b-name'},name),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
   const body=el('div',{className:'b-preview-body'},
    el('div',{className:'b-edit-grid'},field(tr('Nama role','Role name'),textInput(name,tr('Nama role baru','New role name'),v=>onStructureEdit('role-name',index,null,v,true))),field(tr('Warna (opsional)','Color (optional)'),textInput(color||'',tr('Warna role','Role color'),v=>onStructureEdit('role-color',index,null,v,true)))),
    el('div',{className:'b-preview-actions'},button(tr('Hapus role','Delete role'),()=>onStructureEdit('role-delete',index),false,tr(`Hapus role ${name} (urutan ${index+1})`,`Delete role ${name} (position ${index+1})`))));
   return el('li',null,expandable(`role:${index}`,summary,body));
  });
  const roleSummary=el('summary',{className:'b-section-summary'},el('span',null,`${tr('ROLE BARU','NEW ROLES')} · ${roles.length}`),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄'));
  box.append(expandable('roles',roleSummary,el('div',{className:'b-preview-body'},el('p',{className:'f-muted'},tr('Role baru tidak memiliki izin server dan tidak otomatis diberikan kepada anggota.','New roles have no server permissions and are not automatically assigned to members.')),el('ul',{className:'b-role-list'},...roles),button(tr('+ TAMBAH ROLE BARU','+ ADD NEW ROLE'),()=>onStructureEdit('role-add')))));
  const roleView=el('select',{});roleView.dataset.builderRoleReview='';roleView.setAttribute('aria-label',tr('Tinjau overwrite untuk role','Review overwrites for role'));
  roleView.append(el('option',{value:'everyone'},'@everyone'));
  for(const r of list(plan.roles)){const name=typeof r==='string'?r:r.name;roleView.append(el('option',{value:'new:'+name},`${tr('Role baru:','New role:')} ${name}`))}
  for(const r of existingRoles)roleView.append(el('option',{value:'existing:'+r.id},`${tr('Role server','Server role')}: ${serverRoleLabel(r.id,existingRoles)}`));
  const view=el('div',{className:'b-access-summary'});
  const refresh=()=>{
   const selected=roleView.value;view.replaceChildren();
   for(const c of list(plan.categories)) for(const channel of list(c.channels)){
    const a=channel.access||c.access;let detail=tr('Tidak ada overwrite rancangan; mengikuti default server.','No planned overwrites; follows server defaults.');
    if(a){const selectedRole=selected.startsWith('new:')?list(a.roles).includes(selected.slice(4)):selected.startsWith('existing:')?list(a.existingRoles).includes(selected.slice(9)):false;
     const privateMode=['private','private-read-only'].includes(a.mode),readonly=['read-only','private-read-only'].includes(a.mode);
     const fragments=[];if(privateMode)fragments.push(selectedRole?tr('role ini diizinkan melihat','this role may view'):tr('@everyone ditolak melihat','@everyone denied view'));
     if(readonly)fragments.push(selectedRole?tr('role ini diizinkan mengirim/membuat thread','this role may send/create threads'):tr('@everyone ditolak mengirim/membuat thread','@everyone denied send/create threads'));
     detail=fragments.join('; ')+'.';
    }
    view.append(el('p',null,`${c.name} / ${channel.name}: ${detail}`));
   }
  };roleView.onchange=refresh;
  if (selectedReview && [...roleView.options].some(o=>o.value===selectedReview)) roleView.value=selectedReview;
  refresh();
  box.append(expandable('review',el('summary',{className:'b-section-summary'},el('span',null,tr('TINJAU IZIN PER ROLE','REVIEW PERMISSIONS BY ROLE')),el('span',{className:'b-chevron','ariaHidden':'true'},'⌄')),el('div',{className:'b-preview-body'},el('p',{className:'f-muted'},tr('Ini hanya ringkasan overwrite rancangan, bukan izin efektif. Role lain, izin server, pemilik dan Administrator dapat mengubah hasil. Periksa akses di Discord.','This is only a summary of planned overwrites, not effective permissions. Other roles, server permissions, the owner and Administrator can change the outcome. Check access in Discord.')),roleView,view)));
  if (activeKey && (activeIndex >= 0 || activeIsSummary)) {
   const current=[...box.querySelectorAll('details[data-builder-key]')].find(d=>d.dataset.builderKey===activeKey);
   const replacement=activeIsSummary ? current?.querySelector(':scope > summary') : current?.querySelectorAll('input, select, button')[activeIndex];
   if (replacement && (activeIsSummary || current.open)) replacement.focus({preventScroll:true});
  }

 }
 /** Created, removed or kept objects as one list. */
 function drawItems(box, title, items) {
  const rows = list(items).map((item) => el('li', null,
   el('span', { className: 'b-tag' }, TYPE_LABELS[item.type] || tr('OBJEK','OBJECT')),
   el('span', { className: 'b-name' }, String(item.name ?? '')),
   item.reason ? el('small', null, String(builderCopy(item.reason))) : null));
  if (rows.length) box.append(el('div', { className: 'b-group' }, el('div', { className: 'b-group-name' }, title), el('ul', null, ...rows)));
 }

 const aside = (title, lead, note, callout) => `<aside><section class="f-panel"><div class="f-panel-head"><div><h2>${title}</h2><p>${lead}</p></div></div><div class="f-feature-note"><p>${note}</p></div><div class="f-callout">⚠ &nbsp; ${callout}</div></section></aside>`;

 function designMarkup() {
  return `<div class="f-layout"><div>
<section class="f-panel"><div class="f-panel-head"><div><h2>Server Builder</h2><p>${tr('Pilih tema atau jelaskan servernya, tinjau, lalu terapkan dengan konfirmasi terpisah.','Choose a theme or describe the server, review the plan, then apply it with separate confirmation.')}</p></div><span>⌗</span></div>
<form id="aiBuilderThemeForm" class="f-form b-form"><label class="f-field"><span><b>${tr('Tema siap pakai','Ready-made theme')}</b><small>${tr('Tanpa AI, tidak memakai kuota. Hasilnya tetap bisa disunting.','No AI or quota used. The result can still be edited.')}</small></span><select name="themeId" required><option value="">${tr('Memuat tema…','Loading themes…')}</option></select></label><div class="f-form-actions"><span>${tr('SUSUNAN SIAP PAKAI · TANPA KUOTA AI','READY-MADE PLAN · NO AI QUOTA')}</span><button class="f-outline" type="submit">${tr('PAKAI TEMA','USE THEME')}</button></div></form>
<form id="aiBuilderForm" class="f-form b-form"><label class="f-field"><span><b>${tr('Atau jelaskan servernya','Or describe the server')}</b><small>${tr('Dikirim ke provider AI. Jangan masukkan data sensitif. Maksimal 1000 karakter. Rancangan besar dapat diperkecil atau terpotong bila batas output provider rendah; bila AI gagal, dipakai tema terdekat.','Sent to the AI provider. Do not include sensitive data. Maximum 1,000 characters. Large plans may be reduced or truncated if the provider output limit is low; if AI fails, the closest theme is used.')}</small></span><textarea name="description" maxlength="1000" rows="5" required></textarea><small id="aiBuilderCharCount">${tr('0 / 1000 karakter','0 / 1000 characters')}</small></label><div class="f-form-actions"><span id="aiBuilderLimits">${tr('MAKS. 8 KATEGORI, 40 CHANNEL, 12 ROLE','MAX. 8 CATEGORIES, 40 CHANNELS, 12 ROLES')}</span><button class="f-primary" type="submit">${tr('RANCANG DENGAN AI','DESIGN WITH AI')}</button></div></form>
</section>
<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Rancangan untuk ditinjau','Plan for review')}</h2><p>${tr('Belum ada yang dibuat di Discord sampai Anda menekan Terapkan.','Nothing is created in Discord until you press Apply.')}</p></div><span>◉</span></div>
<p class="f-callout" id="aiBuilderNote" hidden></p>
<p class="f-muted">${tr('Ketuk channel atau “Edit kategori & izin” untuk menyunting. Pilih role baru atau role server yang sudah ada untuk izin channel. Setelah mengubah, tekan VALIDASI RANCANGAN. Role baru harus ditetapkan ke anggota secara manual.','Tap a channel or “Edit category & permissions” to edit. Select new or existing server roles for channel permissions. After changes, press VALIDATE PLAN. New roles must be assigned to members manually.')}</p><p id="aiBuilderEditState" class="b-edit-state" aria-live="polite" hidden></p><div class="b-tree" id="aiBuilderPreview"><p class="f-muted">${tr('Belum ada rancangan.','No plan yet.')}</p></div>
<details class="b-details"><summary>${tr('SUNTING RANCANGAN (JSON) / VALIDASI','EDIT PLAN (JSON) / VALIDATE')}</summary><p class="f-muted">${tr('Ubah nama, tipe, topic atau warna role. Untuk izin tambahkan pada kategori/channel: &quot;access&quot;: {&quot;mode&quot;:&quot;read-only&quot;, &quot;roles&quot;:[&quot;Admin&quot;]}; mode lain: private dan private-read-only. Nama role baru wajib ada dalam rancangan; pilih role yang sudah ada melalui preview. Channel tanpa access mengikuti kategori. Access channel menggantikan access kategori sepenuhnya. Validasi sebelum menerapkan. Objek Discord yang sudah ada tidak diubah.','Edit names, types, topics or role colors. To set permissions on a category/channel add: &quot;access&quot;: {&quot;mode&quot;:&quot;read-only&quot;, &quot;roles&quot;:[&quot;Admin&quot;]}; other modes are private and private-read-only. New role names must exist in the plan; select existing roles via preview. Channels without access inherit their category. Channel access entirely replaces category access. Validate before applying. Existing Discord objects are not changed.')}</p><textarea class="b-code" id="aiBuilderPlan" rows="14" maxlength="20000" spellcheck="false" aria-label="${tr('JSON rancangan server','Server plan JSON')}" disabled></textarea></details><div class="b-actions"><button type="button" class="f-outline" id="aiBuilderSave" disabled>${tr('VALIDASI RANCANGAN','VALIDATE PLAN')}</button><button type="button" class="f-outline" id="aiBuilderPreflight" disabled>${tr('PERIKSA SERVER','CHECK SERVER')}</button><button type="button" class="f-outline" id="aiBuilderSaveDraft" disabled>${tr('SIMPAN DRAFT','SAVE DRAFT')}</button><button type="button" class="f-outline" id="aiBuilderRestoreDraft">${tr('MUAT DRAFT','LOAD DRAFT')}</button><button type="button" class="f-outline" id="aiBuilderDeleteDraft">${tr('HAPUS DRAFT','DELETE DRAFT')}</button></div><p id="aiBuilderPreflightStatus" class="f-muted" aria-live="polite"></p>
<div class="b-actions"><button type="button" class="f-primary" id="aiBuilderApply" disabled>${tr('TERAPKAN KE SERVER','APPLY TO SERVER')}</button><button type="button" class="f-outline" id="aiBuilderCancel" disabled>${tr('BATALKAN RANCANGAN','CANCEL PLAN')}</button></div>
<p id="aiBuilderStatus" aria-live="polite" class="f-muted b-status"></p>
<div class="b-tree" id="aiBuilderResult"></div>
</section></div>${aside(tr('Sebelum menerapkan','Before applying'), tr('Hanya owner bot yang dapat menjalankan.','Only the bot owner can run this.'), tr('Penerapan membuat kategori, channel dan role baru. Role baru tidak mendapat izin server dan tidak ditetapkan ke anggota otomatis. Access read-only/private/private-read-only hanya mengatur overwrite tertentu; tanpa access mengikuti default server. Channel dengan access sendiri mengganti seluruh access kategori. Izin efektif dapat dipengaruhi role lain dan Administrator melewati pembatasan. Periksa di Discord dan tetapkan role staff secara manual. Nama baru yang sudah ada di server ditolak. Role server terpilih tidak diubah dan hanya digunakan dalam overwrite channel baru. Tipe forum, news dan stage memerlukan fitur Komunitas Discord.','Applying creates new categories, channels and roles. New roles have no server permissions and are not assigned automatically. Read-only/private/private-read-only access only sets specific overwrites; without access, server defaults apply. Channel access replaces all category access. Other roles can affect effective permissions, and Administrator bypasses restrictions. Check in Discord and assign staff roles manually. Existing names are rejected. Selected server roles are not changed and are used only in new channel overwrites. Forum, news and stage types require Discord Community features.'), tr('Rancangan berlaku 5 menit dan hanya sekali pakai. Semua yang dibuat tercatat di tab Riwayat & bongkar dan dapat dihapus lagi dari sana, juga bila penerapan berhenti di tengah jalan.','Plans expire after 5 minutes and can be used once. Created objects are recorded in History & teardown and can be deleted there, even if application stops partway.'))}</div>`;
 }

 function historyMarkup() {
  return `<div class="f-layout"><div>
<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Riwayat pembangunan','Build history')}</h2><p>${tr('Yang dibuat Server Builder di server ini, terbaru di atas.','Objects created by Server Builder on this server, newest first.')}</p></div><span>◆</span></div>
<div class="b-builds" id="aiBuilderHistory"><p class="f-muted">${tr('Memuat…','Loading…')}</p></div>
</section>
<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Bongkar bangunan terakhir','Tear down latest build')}</h2><p>${tr('Menghapus persis objek yang tercatat pada bangunan terakhir. Tinjau dulu, lalu ketik konfirmasinya.','Deletes exactly the objects recorded in the latest build. Review first, then type the confirmation.')}</p></div><span>⌫</span></div>
<div class="b-actions"><button type="button" class="f-outline" id="aiUndoPrepare" disabled>${tr('TINJAU BONGKAR','REVIEW TEARDOWN')}</button></div>
<div class="b-tree" id="aiUndoPreview"><p class="f-muted">${tr('Belum ada yang ditinjau.','Nothing reviewed yet.')}</p></div>
<label class="f-field"><span><b>${tr('Konfirmasi bongkar','Teardown confirmation')}</b><small id="aiUndoHint" aria-live="polite">${tr('Tinjau dulu; kalimat yang harus diketik muncul di sini.','Review first; the phrase to type appears here.')}</small></span><input id="aiUndoConfirmation" aria-describedby="aiUndoHint" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
<div class="b-actions"><button type="button" class="f-outline b-danger" id="aiUndoApply" disabled>${tr('BONGKAR SEKARANG','TEAR DOWN NOW')}</button><button type="button" class="f-outline" id="aiUndoForget" disabled>${tr('LEPAS DARI RIWAYAT','REMOVE FROM HISTORY')}</button></div>
<p class="f-muted b-status" id="aiUndoStatus" aria-live="polite"></p>
</section></div>${aside(tr('Cara kerja bongkar','How teardown works'), tr('Hanya owner bot yang dapat menjalankan.','Only the bot owner can run this.'), tr('Setiap penerapan dicatat beserta ID objek yang benar-benar dibuat. Bongkar menghapus ID itu saja: channel dulu, lalu kategori, lalu role. Hanya bangunan terakhir yang dapat dibongkar; setelah habis, bangunan sebelumnya menjadi yang terakhir. Objek yang gagal dihapus tetap tercatat untuk dicoba lagi. Kategori yang masih berisi channel lain dan channel sistem server tidak dihapus.','Each application records the IDs of objects actually created. Teardown deletes only those IDs: channels first, then categories, then roles. Only the latest build can be torn down; once removed, the previous build becomes the latest. Objects that fail to delete remain recorded for retry. Categories containing other channels and server system channels are not deleted.'), tr('Channel dihapus beserta seluruh pesannya dan role dilepas dari semua anggota. Bot tidak dapat memulihkannya. "Lepas dari riwayat" hanya menghapus catatan: objeknya tetap ada di Discord dan tidak bisa lagi dibongkar otomatis.','Channels are deleted with all messages and roles removed from all members. The bot cannot restore them. "Remove from history" only removes the record: objects remain in Discord and cannot be torn down automatically afterwards.'))}</div>`;
 }

 function manualMarkup() {
  const names = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'EmbedLinks', 'AttachFiles', 'Connect', 'Speak', 'Stream', 'UseVAD'];
  return `<div class="f-layout"><div><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Ubah objek yang ada','Modify existing objects')}</h2><p>${tr('Manual, satu target per tindakan · tidak dijalankan AI.','Manual, one target per action · not run by AI.')}</p></div></div>
<form id="aiManualForm" class="f-form b-form"><label class="f-field"><span><b>${tr('Jenis target','Target type')}</b><small>${tr('Channel teks/suara/kategori atau role biasa.','Text/voice channel, category or regular role.')}</small></span><select name="kind"><option value="channel">${tr('Channel atau kategori','Channel or category')}</option><option value="role">Role</option></select></label><label class="f-field"><span><b>${tr('ID target Discord','Discord target ID')}</b><small>${tr('Salin ID di Discord, lalu tinjau sebelum mengubah.','Copy the ID in Discord, then review before changing.')}</small></span><input name="targetId" inputmode="numeric" pattern="[0-9]{17,20}" required></label><label class="f-field"><span><b>${tr('Tindakan','Action')}</b><small>${tr('Hapus permanen; rollback hanya untuk nama dan izin role.','Deletion is permanent; rollback is only for names and role permissions.')}</small></span><select name="action"><option value="rename">${tr('Ganti nama','Rename')}</option><option value="permissions">${tr('Atur izin dasar role','Set basic role permissions')}</option><option value="delete">${tr('Hapus permanen','Delete permanently')}</option></select></label><label class="f-field"><span><b>${tr('Nama baru','New name')}</b><small>${tr('Hanya untuk ganti nama; channel teks/suara huruf kecil ASCII, angka, - atau _.','Only for rename; text/voice channels use lowercase ASCII letters, numbers, - or _.')}</small></span><input name="newName" maxlength="40"></label>
<fieldset class="b-perms"><legend>${tr('Izin dasar role (hanya tindakan atur izin)','Basic role permissions (set permissions action only)')}</legend><p class="f-muted">${tr('Daftar lengkap izin dasar baru: centang yang diinginkan. Tidak mengubah permission overwrite channel.','Complete new set of basic permissions: check those wanted. Does not change channel permission overwrites.')}</p><div class="b-perm-grid">${names.map((n) => `<label><input type="checkbox" name="permission" value="${n}"><span>${n}</span></label>`).join('')}</div></fieldset>
<div class="b-actions"><button class="f-outline" type="submit">${tr('TINJAU TINDAKAN','REVIEW ACTION')}</button></div></form>
<pre class="b-pre" id="aiManualPreview">${tr('Belum ada tindakan ditinjau.','No action reviewed yet.')}</pre>
<label class="f-field"><span><b>${tr('Konfirmasi target','Confirm target')}</b><small id="aiManualConfirmationHint">${tr('Untuk rename/izin ketik ID. Untuk hapus ketik HAPUS diikuti spasi dan ID. Hapus tidak bisa di-rollback.','For rename/permissions type the ID. To delete, type HAPUS followed by a space and the ID. Deletion cannot be rolled back.')}</small></span><input id="aiManualConfirmation" aria-describedby="aiManualConfirmationHint" autocomplete="off"></label>
<div class="b-actions"><button type="button" class="f-outline" id="aiManualApply" disabled>${tr('JALANKAN TINDAKAN','RUN ACTION')}</button><button type="button" class="f-outline" id="aiManualUndo" disabled>${tr('ROLLBACK PERUBAHAN TERAKHIR','ROLL BACK LAST CHANGE')}</button></div>
<p class="f-muted b-status" id="aiManualStatus" aria-live="polite"></p>
</section></div>${aside(tr('Sebelum mengubah','Before changing'), tr('Hanya owner bot yang dapat menjalankan.','Only the bot owner can run this.'), tr('Untuk objek yang sudah ada di server, apa pun asalnya. Setiap tindakan ditinjau dulu dan dikonfirmasi dengan mengetik ID target. Permission overwrite channel tidak dapat diubah dari sini.','For objects already on the server, regardless of origin. Each action is reviewed and confirmed by typing the target ID. Channel permission overwrites cannot be changed here.'), tr('Hapus channel dapat menghapus pesan; hapus role menghilangkan penetapan role. Bot tidak dapat memulihkan data tersebut. Tinjauan dan rollback hanya disimpan 5 menit di memori dan hilang saat restart. Perubahan lain dapat membuat rollback ditolak.','Deleting a channel can delete messages; deleting a role removes its assignments. The bot cannot restore them. Reviews and rollback are stored in memory for only 5 minutes and disappear on restart. Other changes may cause rollback to be rejected.'))}</div>`;
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
  window.ZentixPromptAssistant?.offer(root,'builder',description);
  const updateCount=()=>{counter.textContent=`${description.value.length} / 1000 ${tr('karakter','characters')}`};description.addEventListener('input',updateCount);updateCount();
  read('roles').then(r=>{existingRoles=list(r.roles);if(planId && !jsonDirty){try {drawPlan(preview,JSON.parse(out.value),editAccess,editStructure,existingRoles)}catch{}}}).catch(()=>{existingRoles=[];checkStatus.textContent=tr('Daftar role server tidak dapat dimuat; pilihan role yang sudah ada tidak tersedia.','Could not load server roles; existing roles cannot be selected.')});

  function editAccess(ci, index, field, value) {
   if (!planId || out.disabled) return;
   if (jsonDirty) { status.textContent = tr('Validasi perubahan JSON sebelum mengatur izin di preview.','Validate JSON changes before editing permissions in the preview.'); return; }
   let plan;
   try { plan = JSON.parse(out.value); } catch { status.textContent = tr('JSON tidak valid. Perbaiki dan validasi sebelum mengatur izin.','Invalid JSON. Fix and validate it before editing permissions.'); return; }
   const target = index === null ? plan.categories?.[ci] : plan.categories?.[ci]?.channels?.[index];
   if (!target) { status.textContent = tr('Rancangan berubah; validasi JSON terlebih dahulu.','The plan changed; validate JSON first.'); return; }
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
   out.value = JSON.stringify(plan, null, 2); setEditState(tr('PERUBAHAN BELUM DIVALIDASI','CHANGES NOT VALIDATED')); revision++; dirty = true; apply.disabled = true; check.disabled=true; saveDraft.disabled=true; checkStatus.textContent=tr('Validasi sebelum memeriksa server.','Validate before checking the server.'); status.textContent = tr('Izin berubah. Pilih setidaknya satu role lalu validasi sebelum menerapkan.','Permissions changed. Choose at least one role and validate before applying.'); drawPlan(preview, plan, editAccess, editStructure, existingRoles);
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
   if (!planId || out.disabled || jsonDirty) { status.textContent = tr('Validasi perubahan JSON sebelum mengubah preview.','Validate JSON changes before editing the preview.'); return; }
   let p; try {p=JSON.parse(out.value)} catch {status.textContent=tr('JSON tidak valid.','Invalid JSON.');return}
   const swap=(arr,a,b)=>{if (b>=0 && b<arr.length) [arr[a],arr[b]]=[arr[b],arr[a]]};
   const c=p.categories[ci];
   if(action==='category-add') p.categories.push({name:'Kategori Baru',channels:[]});
   else if(action==='category-name') c.name=value;
   else if(action==='category-delete') {if(!window.confirm(tr('Hapus kategori beserta channel-nya dari rancangan? Discord belum berubah.','Remove this category and its channels from the plan? Discord has not changed.')))return;remapDetails(action,ci,index,value,p);p.categories.splice(ci,1)}
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
   out.value=JSON.stringify(p,null,2);setEditState(tr('PERUBAHAN BELUM DIVALIDASI','CHANGES NOT VALIDATED'));revision++;dirty=true;apply.disabled=true;check.disabled=true;saveDraft.disabled=true;checkStatus.textContent=tr('Validasi sebelum memeriksa server.','Validate before checking the server.');status.textContent=tr('Rancangan berubah. Validasi sebelum menerapkan.','Plan changed. Validate before applying.');
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
   const source = SOURCE_LABELS[draft.source] ? `${tr('SUMBER','SOURCE')}: ${SOURCE_LABELS[draft.source]}${draft.theme?.label ? ' · ' + draft.theme.label : ''}` : '';
   if (note) { const text = [source, draftNote(draft)].filter(Boolean).join(' — '); note.textContent = text; note.hidden = !text; }
   result.replaceChildren();
   status.textContent = message;
  }
  async function draft(button, pending, run) {
   if (busy) return;
   busy = true; button.disabled = true;
   reset(tr('Menyusun rancangan…','Preparing plan…')); status.textContent = pending;
   try { show(await run(), tr('Tinjau rancangan. Berlaku 5 menit dan sekali pakai.','Review the plan. Valid for 5 minutes and one use.')); }
   catch (err) { idle(tr('Belum ada rancangan.','No plan yet.')); status.textContent = err.message; }
   finally { busy = false; button.disabled = false; }
  }

  out.oninput = () => { setEditState(tr('PERUBAHAN BELUM DIVALIDASI','CHANGES NOT VALIDATED')); revision++; dirty = true; jsonDirty = true; apply.disabled = true; check.disabled=true; saveDraft.disabled=true; checkStatus.textContent=tr('Validasi sebelum memeriksa server.','Validate before checking the server.'); status.textContent = tr('Rancangan berubah. Validasi sebelum menerapkan.','Plan changed. Validate before applying.'); };
  if (themeForm) themeForm.onsubmit = (e) => {
   e.preventDefault();
   const themeId = themeForm.elements.themeId.value;
   if (!themeId) { status.textContent = tr('Pilih tema lebih dulu.','Choose a theme first.'); return; }
   draft(themeForm.querySelector('button'), tr('Menyiapkan tema…','Preparing theme…'), () => req('theme', { themeId }));
  };
  form.onsubmit = async (e) => {
   e.preventDefault();
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Kirim deskripsi ke provider AI? Ini dapat memakai kuota dan berbiaya. Belum ada perubahan Discord.','Send the description to the AI provider? This may use quota and incur costs. Discord is not changed yet.')) : Promise.resolve(window.confirm(tr('Kirim deskripsi ke provider AI? Ini dapat memakai kuota dan berbiaya. Belum ada perubahan Discord.','Send the description to the AI provider? This may use quota and incur costs. Discord is not changed yet.')))))) return;
   draft(form.querySelector('button'), tr('Menyusun rancangan dengan AI…','Designing with AI…'), () => req('draft', { description: form.elements.description.value, confirmed: true }));
  };
  save.onclick = async () => {
   if (!planId) return;
   let plan;
   try { plan = JSON.parse(out.value); } catch { status.textContent = tr('JSON tidak valid.','Invalid JSON.'); return; }
   const current = revision;
   save.disabled = true; apply.disabled = true; status.textContent = tr('Memvalidasi rancangan…','Validating plan…');
   try {
    const r = await req('edit', { id: planId, plan });
    if (revision !== current) { dirty = true; status.textContent = tr('Rancangan berubah lagi. Validasi ulang sebelum menerapkan.','The plan changed again. Validate again before applying.'); return; }
    out.value = JSON.stringify(r.plan, null, 2);
    drawPlan(preview, r.plan, editAccess, editStructure, existingRoles);
    dirty = false; jsonDirty = false; setEditState(''); apply.disabled = false; check.disabled=false; saveDraft.disabled=false; runPreflight();
    status.textContent = tr(`Rancangan valid. Sisa waktu sekitar ${r.expiresInSeconds} detik.`,`Plan valid. About ${r.expiresInSeconds} seconds remaining.`);
   } catch (err) { dirty = true; status.textContent = err.message; }
   finally { save.disabled = !planId; }
  };
  async function runPreflight() {
   if(!planId || dirty) return;const id=planId,current=revision;checkStatus.textContent=tr('Memeriksa kondisi server…','Checking server conditions…');
   try {const r=await req('preflight',{id});if(planId===id && revision===current)checkStatus.textContent=r.ready?tr('Pemeriksaan awal lolos. Kondisi Discord bisa berubah sebelum penerapan.','Preflight passed. Discord conditions may change before applying.'):tr('Pemeriksaan belum tersedia.','Preflight is unavailable.');}
   catch(e){if(planId===id && revision===current)checkStatus.textContent=`${tr('Perlu perhatian:','Needs attention:')} ${e.message}`;}
  }
  check.onclick=runPreflight;
  saveDraft.onclick=async()=>{if(!planId || dirty)return;try{await req('save-draft',{id:planId});status.textContent=tr('Draft valid tersimpan. Muat kembali kapan saja; penerapan tetap butuh konfirmasi.','Valid draft saved. Load it later; applying still requires confirmation.')}catch(e){status.textContent=e.message}};
  restore.onclick=async()=>{if(planId && !window.confirm(tr('Muat draft tersimpan dan ganti rancangan saat ini?','Load the saved draft and replace the current plan?')))return;draft(restore,tr('Memuat draft…','Loading draft…'),()=>req('restore-draft',{}));};
  deleteDraft.onclick=async()=>{if(!window.confirm(tr('Hapus draft tersimpan? Rancangan yang sedang terbuka tidak diubah.','Delete the saved draft? The currently open plan is not changed.')))return;try{await req('delete-draft',{confirmed:true});status.textContent=tr('Draft tersimpan dihapus.','Saved draft deleted.')}catch(e){status.textContent=e.message}};
  apply.onclick = async () => {
   if (!planId || dirty || !(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Terapkan rancangan yang ditampilkan ke server Discord? Kategori, channel dan role akan dibuat beserta overwrite izin yang ditampilkan; role baru tidak ditetapkan ke anggota. Izin efektif dapat dipengaruhi role lain dan Administrator. Hasilnya tercatat dan dapat dibongkar dari tab Riwayat & bongkar.','Apply the displayed plan to the Discord server? Categories, channels and roles will be created with the displayed permission overwrites; new roles are not assigned to members. Other roles and Administrator can affect effective permissions. The result is recorded and can be torn down from History & teardown.')) : Promise.resolve(window.confirm(tr('Terapkan rancangan yang ditampilkan ke server Discord? Kategori, channel dan role akan dibuat beserta overwrite izin yang ditampilkan; role baru tidak ditetapkan ke anggota. Izin efektif dapat dipengaruhi role lain dan Administrator. Hasilnya tercatat dan dapat dibongkar dari tab Riwayat & bongkar.','Apply the displayed plan to the Discord server? Categories, channels and roles will be created with the displayed permission overwrites; new roles are not assigned to members. Other roles and Administrator can affect effective permissions. The result is recorded and can be torn down from History & teardown.')))))) return;
   const id = planId;
   planId = null; apply.disabled = true; save.disabled = true; cancel.disabled = true; check.disabled=true; saveDraft.disabled=true; out.disabled = true;
   status.textContent = tr('Menerapkan… pada rancangan besar ini bisa memakan waktu sekitar satu menit.','Applying… large plans may take around a minute.');
   result.replaceChildren();
   try {
    const r = await req('apply', { id, confirmed: true });
    status.textContent = `${tr('Selesai:','Done:')} ${countsText(r.counts || itemCounts(r.created))} ${tr('dibuat.','created.')} ${r.recorded === false ? tr('Riwayat tidak dapat disimpan, jadi bangunan ini tidak bisa dibongkar otomatis.','History could not be saved, so this build cannot be torn down automatically.') : tr('Tercatat di tab Riwayat & bongkar.','Recorded in History & teardown.')}`;
    drawItems(result, tr('Yang dibuat','Created'), r.created);
   } catch (err) {
    status.textContent = err.message;
    // Only this explicit preflight rejection guarantees no Discord operation started.
    // Timeouts, partial failures and unknown errors must never re-enable a blind retry.
    if (err.code === 'PLAN_NAME_CONFLICT') {
     planId = id; dirty = true; setEditState(tr('PERUBAHAN PERLU DITINJAU DAN DIVALIDASI','CHANGES NEED REVIEW AND VALIDATION')); out.disabled = false; save.disabled = false; cancel.disabled = false;
     out.closest('details').open = true;
    }
    drawItems(result, tr('Sudah dibuat sebelum berhenti','Created before stopping'), err.created);
   }
  };
  cancel.onclick = async () => {
   if (!planId) return;
   const id = planId;
   reset(tr('Belum ada rancangan.','No plan yet.')); status.textContent = tr('Rancangan dibatalkan. Tidak ada yang dibuat.','Plan cancelled. Nothing was created.');
   try { await req('cancel', { id }); } catch { /* an expired plan is gone already */ }
  };

  // The theme list and limits come from the bot, so the page cannot drift from what the bot accepts.
  read('themes').then((r) => {
   const select = themeForm?.elements.themeId;
   if (!select) return;
   select.replaceChildren(...list(r.themes).map((t) => el('option', { value: t.id }, `${t.emoji || ''} ${t.label} · ${countsText(t, ', ')}`.trim())));
   if (!select.options.length) select.append(el('option', { value: '' }, tr('Tidak ada tema','No themes available')));
   const limits = root.querySelector('#aiBuilderLimits');
   if (limits && r.limits) limits.textContent = tr(`MAKS. ${r.limits.categories} KATEGORI, ${r.limits.channels} CHANNEL, ${r.limits.roles} ROLE`,`MAX. ${r.limits.categories} CATEGORIES, ${r.limits.channels} CHANNELS, ${r.limits.roles} ROLES`);
  }).catch((err) => { const select = themeForm?.elements.themeId; if (select) select.replaceChildren(el('option', { value: '' }, tr('Tema tidak dapat dimuat','Could not load themes'))); status.textContent = err.message; });
  // A plan drafted a moment ago (here or on another tab) is still waiting on the bot.
  read('pending').then((r) => { if (r.pending?.id && !planId && !busy) show(r.pending, tr(`Rancangan yang masih menunggu dimuat kembali. Sisa waktu sekitar ${r.pending.expiresInSeconds} detik.`,`Pending plan restored. About ${r.pending.expiresInSeconds} seconds remaining.`)); }).catch(() => {});
 }

 function bindHistory(root) {
  const box = root.querySelector('#aiBuilderHistory');
  if (!box) return;
  const prepare = root.querySelector('#aiUndoPrepare'), preview = root.querySelector('#aiUndoPreview'), input = root.querySelector('#aiUndoConfirmation'), hint = root.querySelector('#aiUndoHint');
  const apply = root.querySelector('#aiUndoApply'), forget = root.querySelector('#aiUndoForget'), status = root.querySelector('#aiUndoStatus');
  let latest = null, review = null;

  const idle = (text) => { review = null; apply.disabled = true; input.value = ''; hint.textContent = tr('Tinjau dulu; kalimat yang harus diketik muncul di sini.','Review first; the phrase to type appears here.'); preview.replaceChildren(el('p', { className: 'f-muted' }, text)); };
  function drawBuilds(builds) {
   box.replaceChildren();
   latest = builds[0] || null;
   prepare.disabled = !latest; forget.disabled = !latest;
   if (!builds.length) { box.append(el('p', { className: 'f-muted' }, tr('Belum ada bangunan yang tercatat. Terapkan sebuah rancangan di tab Rancang.','No builds recorded yet. Apply a plan on the Design tab.'))); return; }
   builds.forEach((build, index) => {
    const flags = [index === 0 ? tr('TERAKHIR','LATEST') : null, SOURCE_LABELS[build.source] || null, build.edited ? tr('DISUNTING','EDITED') : null, build.partial ? tr('BERHENTI DI TENGAH','STOPPED PARTWAY') : null].filter(Boolean);
    const rows = list(build.items).map((item) => el('li', null, el('span', { className: 'b-tag' }, TYPE_LABELS[item.type] || tr('OBJEK','OBJECT')), el('span', { className: 'b-name' }, String(item.name ?? ''))));
    box.append(el('details', { className: 'b-build' },
     el('summary', null,
      el('span', { className: 'b-build-title' }, String(build.label || tr('Tanpa nama','Untitled'))),
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
   prepare.disabled = true; idle(tr('Memeriksa keadaan di Discord…','Checking Discord state…')); status.textContent = '';
   try {
    const r = await req('undo/prepare', { confirmed: true });
    review = { id: r.id, confirmation: r.confirmation };
    const marks = { delete: tr('DIHAPUS','TO DELETE'), gone: tr('SUDAH TIDAK ADA','ALREADY GONE'), blocked: tr('DILEWATI','SKIPPED') };
    preview.replaceChildren(el('div', { className: 'b-counts' }, tr(`${r.counts.delete} DIHAPUS · ${r.counts.gone} SUDAH TIDAK ADA · ${r.counts.blocked} DILEWATI`,`${r.counts.delete} TO DELETE · ${r.counts.gone} ALREADY GONE · ${r.counts.blocked} SKIPPED`)),
     el('div', { className: 'b-group' }, el('div', { className: 'b-group-name' }, `${String(r.build?.label || tr('Bangunan','Build'))} · ${when(r.build?.at)}`),
      el('ul', null, ...list(r.items).map((item) => el('li', { className: `b-state-${item.state}` },
       el('span', { className: 'b-tag' }, marks[item.state] || tr('OBJEK','OBJECT')),
       el('span', { className: 'b-name' }, `${TYPE_LABELS[item.type] || ''} ${String(item.name ?? '')}`.trim()),
       list(item.notes).length ? el('small', null, list(item.notes).map(builderCopy).join('; ')) : null)))),
     el('p', { className: 'f-callout' }, `⚠ ${builderCopy(r.warning)}`));
    hint.textContent = tr(`Ketik persis: ${r.confirmation}`,`Type exactly: ${r.confirmation}`);
    input.value = ''; apply.disabled = false;
    status.textContent = tr('Tinjau daftar di atas. Berlaku 5 menit.','Review the list above. Valid for 5 minutes.');
   } catch (err) { idle(tr('Belum ada yang ditinjau.','Nothing reviewed yet.')); status.textContent = err.message; }
   finally { prepare.disabled = !latest; }
  };
  apply.onclick = async () => {
   if (!review) return;
   if (input.value.trim() !== review.confirmation) { status.textContent = tr(`Konfirmasi tidak cocok. Ketik persis: ${review.confirmation}`,`Confirmation does not match. Type exactly: ${review.confirmation}`); return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Bongkar bangunan terakhir? Channel dihapus beserta pesannya dan role dilepas dari semua anggota. Ini tidak dapat dipulihkan.','Tear down the latest build? Channels are deleted with their messages and roles removed from all members. This cannot be restored.')) : Promise.resolve(window.confirm(tr('Bongkar bangunan terakhir? Channel dihapus beserta pesannya dan role dilepas dari semua anggota. Ini tidak dapat dipulihkan.','Tear down the latest build? Channels are deleted with their messages and roles removed from all members. This cannot be restored.')))))) return;
   const current = review;
   review = null; apply.disabled = true; status.textContent = tr('Membongkar…','Tearing down…');
   try {
    const r = await req('undo/apply', { id: current.id, confirmation: current.confirmation });
    idle(tr('Belum ada yang ditinjau.','Nothing reviewed yet.'));
    preview.replaceChildren();
    drawItems(preview, tr('Dihapus','Deleted'), r.removed);
    drawItems(preview, tr('Tidak terhapus · tetap tercatat','Not deleted · still recorded'), r.kept);
    if (!preview.children.length) preview.append(el('p', { className: 'f-muted' }, tr('Tidak ada yang perlu dihapus; catatan ditutup.','Nothing needed deletion; the record was closed.')));
    status.textContent = `${tr('Dibongkar:','Torn down:')} ${countsText(r.counts || itemCounts(r.removed))} ${tr('dihapus.','deleted.')}${list(r.kept).length ? tr(' Sebagian tidak terhapus; bereskan penyebabnya lalu tinjau lagi.',' Some objects were not deleted; resolve the cause and review again.') : ''}${r.recorded === false ? tr(' Riwayat tidak dapat diperbarui; muat ulang halaman.',' History could not be updated; reload the page.') : ''}`;
   } catch (err) { idle(tr('Belum ada yang ditinjau.','Nothing reviewed yet.')); status.textContent = `${err.message} ${tr('Tinjau lagi sebelum mencoba.','Review again before retrying.')}`; }
   await load();
  };
  forget.onclick = async () => {
   if (!latest || !(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Lepas bangunan terakhir dari riwayat? Tidak ada yang dihapus di Discord, tetapi bangunan itu tidak bisa lagi dibongkar otomatis.','Remove the latest build from history? Nothing is deleted in Discord, but this build can no longer be torn down automatically.')) : Promise.resolve(window.confirm(tr('Lepas bangunan terakhir dari riwayat? Tidak ada yang dihapus di Discord, tetapi bangunan itu tidak bisa lagi dibongkar otomatis.','Remove the latest build from history? Nothing is deleted in Discord, but this build can no longer be torn down automatically.')))))) return;
   forget.disabled = true; idle(tr('Belum ada yang ditinjau.','Nothing reviewed yet.'));
   try { await req('undo/forget', { buildId: latest.id, confirmed: true }); status.textContent = tr('Catatan dilepas. Objeknya tetap ada di Discord.','Record removed. Objects remain in Discord.'); }
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
  const changed = () => { version++; ticket = null; manualApply.disabled = true; preview.textContent = tr('Input berubah; tinjau lagi sebelum menjalankan.','Input changed; review again before running.'); };
  manual.addEventListener('input', changed); manual.addEventListener('change', changed);
  manual.onsubmit = async (e) => {
   e.preventDefault(); ticket = null; manualApply.disabled = true;
   const x = manual.elements, action = x.action.value, kind = x.kind.value, value = action === 'delete' ? null : action === 'rename' ? x.newName.value : [...manual.querySelectorAll('input[name=permission]:checked')].map((box) => box.value), current = version, button = manual.querySelector('button');
   button.disabled = true; manualStatus.textContent = tr('Mengambil keadaan target…','Fetching target state…');
   try {
    const r = await req('manual/prepare', { kind, action, targetId: x.targetId.value, value });
    if (current !== version) { manualStatus.textContent = tr('Input berubah; tinjau ulang.','Input changed; review again.'); return; }
    ticket = { id: r.id, action, targetId: r.before.id };
    preview.textContent = JSON.stringify({ [tr('tindakan','action')]: r.action, [tr('sebelum','before')]: r.before, [tr('sesudah','after')]: r.after, [tr('izinSebelum','permissionsBefore')]: r.permissionsBefore, [tr('izinSesudah','permissionsAfter')]: r.permissionsAfter, [tr('peringatan','warning')]: builderCopy(r.warning) }, null, 2);
    confirmInput.value = ''; manualApply.disabled = false; manualStatus.textContent = tr('Tinjau detail. Berlaku 5 menit.','Review details. Valid for 5 minutes.');
   } catch (err) { manualStatus.textContent = err.message; }
   finally { button.disabled = false; }
  };
  manualApply.onclick = async () => {
   if (!ticket) return;
   if (confirmInput.value !== (ticket.action === 'delete' ? `HAPUS ${ticket.targetId}` : ticket.targetId)) { manualStatus.textContent = tr('Konfirmasi target tidak cocok.','Target confirmation does not match.'); return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(ticket.action === 'delete' ? tr('Hapus target secara permanen? Pesan atau penetapan role dapat hilang dan tidak dapat dipulihkan.','Permanently delete the target? Messages or role assignments may be lost and cannot be restored.') : tr('Jalankan perubahan pada target Discord yang ditinjau?','Run the reviewed change on the Discord target?')) : Promise.resolve(window.confirm(ticket.action === 'delete' ? tr('Hapus target secara permanen? Pesan atau penetapan role dapat hilang dan tidak dapat dipulihkan.','Permanently delete the target? Messages or role assignments may be lost and cannot be restored.') : tr('Jalankan perubahan pada target Discord yang ditinjau?','Run the reviewed change on the Discord target?')))))) return;
   const current = ticket; ticket = null; manualApply.disabled = true; manualStatus.textContent = tr('Menjalankan…','Running…');
   try {
    const r = await req('manual/apply', { id: current.id, confirmation: confirmInput.value });
    undoTicket = r.undoId ? { id: r.undoId, targetId: r.targetId } : null; undo.disabled = !undoTicket; confirmInput.value = '';
    manualStatus.textContent = r.undoId ? tr('Perubahan diterapkan. Rollback terbatas tersedia 5 menit dengan mengetik ID target.','Change applied. Limited rollback is available for 5 minutes by typing the target ID.') : tr('Tindakan selesai. Rollback tidak tersedia; periksa Discord.','Action completed. Rollback is unavailable; check Discord.');
   } catch (err) { manualStatus.textContent = err.message + tr(' Tinjau ulang sebelum mencoba.',' Review again before retrying.'); }
  };
  undo.onclick = async () => {
   if (!undoTicket) return;
   if (confirmInput.value !== undoTicket.targetId) { manualStatus.textContent = tr('Untuk rollback, ketik ID target.','For rollback, type the target ID.'); return; }
   if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Kembalikan nama atau izin role yang terakhir diubah? Perubahan hanya diterapkan jika target belum berubah sejak itu.','Restore the last changed role name or permissions? The change applies only if the target has not changed since.')) : Promise.resolve(window.confirm(tr('Kembalikan nama atau izin role yang terakhir diubah? Perubahan hanya diterapkan jika target belum berubah sejak itu.','Restore the last changed role name or permissions? The change applies only if the target has not changed since.')))))) return;
   const u = undoTicket; undoTicket = null; undo.disabled = true; manualStatus.textContent = tr('Memproses rollback…','Processing rollback…');
   try { await req('manual/undo', { id: u.id, confirmation: confirmInput.value }); confirmInput.value = ''; manualStatus.textContent = tr('Rollback selesai.','Rollback completed.'); }
   catch (err) { manualStatus.textContent = err.message + tr(' Periksa Discord sebelum tindakan lain.','Check Discord before another action.'); }
  };
 }

 function bind(root) { bindDesign(root); bindHistory(root); bindManual(root); }
 window.ZentixAIBuilder = { render, bind };
})();
