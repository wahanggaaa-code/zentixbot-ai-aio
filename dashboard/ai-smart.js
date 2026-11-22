/* "Fitur pintar" room of AI Studio: FAQ and reply cache, message menu, morning digest,
   automatic translation and the usage report. (The greeting extras are edited in the Welcome & goodbye room.) Owner only. Every feature has its own switch and its own
   save button; features that work in channels let the owner tick several channels. */
(() => {
 const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 async function req(path, opts = {}) {
  const s = await window.ZentixSession;
  const r = await fetch('/dashboard/api/ai/' + path, { cache: 'no-store', ...opts, headers: opts.body ? { 'Content-Type': 'application/json', 'x-csrf-token': s.csrf } : {} });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || 'Permintaan gagal');
  return b;
 }
 const row = (title, help, control) => `<label class="f-field"><span><b>${esc(title)}</b><small>${esc(help)}</small></span>${control}</label>`;
 const toggle = (name, title, help, value) => row(title, help, `<span class="f-check"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span class="fake-switch"></span></span>`);
 const number = (name, title, help, value, min, max) => row(title, `${help} (${min}–${max})`, `<input name="${name}" type="number" min="${min}" max="${max}" value="${esc(value)}" required>`);
 const options = (map, chosen) => Object.entries(map).map(([value, label]) => `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''}>${esc(label)}</option>`).join('');
 // Tick boxes instead of a multi-select: the same on a phone and on a desktop.
 const channelPicker = (name, title, help, channels, chosen, max) => {
  const known = new Set(channels.map((c) => c.id));
  const items = [...channels.map((c) => [c.id, '# ' + c.name]), ...chosen.filter((id) => !known.has(id)).map((id) => [id, 'ID tersimpan — tidak tersedia'])];
  return `<fieldset class="f-field" data-picker="${name}" data-max="${max}"><span><b>${esc(title)}</b><small>${esc(help)} Boleh lebih dari satu, paling banyak ${max}.</small></span><div class="f-picker">${items.length ? items.map(([id, label]) => `<label><input type="checkbox" name="${name}" value="${esc(id)}" ${chosen.includes(id) ? 'checked' : ''}> ${esc(label)}</label>`).join('') : '<small>Tidak ada channel teks.</small>'}</div></fieldset>`;
 };
 const actions = (note, extra = '') => `<div class="f-form-actions"><span>✳ ${esc(note)}</span><span class="f-inline">${extra}<button class="f-primary" type="submit">SIMPAN ↗</button></span></div>`;
 const panel = (title, sub, id) => `<section class="f-panel"><div class="f-panel-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><span>✦</span></div><div id="${id}">Memuat…</div></section>`;
 const side = (title, sub, text) => `<section class="f-panel"><div class="f-panel-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><span>◇</span></div><p class="f-muted">${esc(text)}</p></section>`;

 const PAGES = {
  faq: { title: 'FAQ & cache jawaban', sub: 'Jawaban acuan dan variasi AI opsional · khusus owner bot.', aside: ['Hemat kuota', 'FAQ acuan dan cache bisa menjawab tanpa AI.', 'FAQ dicocokkan berdasarkan kata di mesin bot; jika belum cocok, pertanyaan anggota dan daftar pertanyaan FAQ dikirim ke provider AI untuk mencari kecocokan dan memakai kuota. AI dapat keliru; jika ragu atau gagal, FAQ tidak menjawab. Jawaban acuan tidak dikirim untuk pencocokan; jika variasi AI diaktifkan, jawaban acuan juga dikirim ke provider. Saat bot dipanggil (AI interaktif aktif), FAQ diperiksa lebih dulu. Dengan "Jawab otomatis", bot juga menjawab pertanyaan yang cocok di channel pilihan tanpa dipanggil; di sana kecocokan harus lebih ketat dan entri yang sama tidak diulang dalam 2 menit. Cache hanya berlaku untuk balasan AI interaktif pada pertanyaan yang sama persis (minimal 3 kata, tanpa gambar, bukan balasan lanjutan) dan hilang saat bot restart. Pertanyaan tentang diri penanya ("aku", "saya", "namaku") atau tentang obrolan sebelumnya ("tadi", "barusan"), dan jawaban yang menyebut nama penanya, tidak di-cache.'] },
  menu: { title: 'Menu pesan', sub: 'Tekan-tahan pesan → Apps · khusus owner bot.', aside: ['Cara kerja', 'Baca sebelum mengaktifkan.', 'Anggota menekan-tahan sebuah pesan (di komputer: klik kanan) lalu memilih Apps. Jawaban hanya terlihat oleh anggota itu dan memakai kuota hariannya. Teks pesan yang dipilih, yang bisa saja ditulis anggota lain, dikirim ke provider AI. Entri yang dimatikan tidak didaftarkan ke Discord. Discord mengizinkan 5 menu pesan per server, terpisah dari 100 slash command. Menu baru bisa perlu beberapa saat atau memuat ulang Discord sampai terlihat.'] },
  digest: { title: 'Koran hari ini', sub: 'Berita harian · khusus owner bot.', aside: ['Kuota & sumber', 'Baca sebelum mengaktifkan.', 'Hingga tiga edisi per hari: persiapan dimulai 15 menit sebelum jadwal, tanpa mengirim lebih awal. Tiap percobaan memakai hingga tiga pencarian web dan dua permintaan AI; jika belum siap, gagal, atau hasilnya sudah dikirim pada slot lain, bot dapat mencoba lagi dan memakai kuota serta biaya tambahan. Berita yang berhasil dikirim disaring dari riwayat tujuh hari; duplikat berbeda judul atau sumber masih mungkin lolos. Setiap slot kirim hanya dicoba sekali. Berita memerlukan kunci pencarian web (Tavily, Parallel atau Exa); tanpa kunci edisi tidak dikirim. Berita ditulis dari cuplikan hasil pencarian, bukan artikel lengkap. AI memeriksa dukungan cuplikan dan bahasa Indonesia; pemeriksaan dapat keliru dan tanggal berita tidak selalu tersedia. Jika bot mati, edisi dicoba setelah hidup kembali dalam batas keterlambatan kurang dari 60 menit pada hari lokal yang sama. Isi yang panjang memerlukan batas output AI minimal 512 token (Provider & fallback).'] },
  translate: { title: 'Terjemahan otomatis', sub: 'Per channel · khusus owner bot.', aside: ['Privasi & kuota', 'Baca sebelum mengaktifkan.', 'Pesan anggota di channel yang dipilih dikirim ke provider AI tanpa persetujuan per pesan; beri tahu anggota. Pesan yang terlihat sudah dalam bahasa tujuan, pesan pendek, link, emoji dan perintah bot dilewati tanpa permintaan AI. Teks yang sama tidak diterjemahkan dua kali dalam 24 jam. Setiap permintaan AI memakai kuota harian anggota yang menulis pesan, juga bila AI menilai pesannya tidak perlu diterjemahkan; batas per jam menghitung permintaan itu. Bot memerlukan izin melihat channel dan mengirim pesan. Bahasa tujuan default berlaku di semua channel terpilih kecuali channel yang diberi bahasa khusus. Channel dua arah menerjemahkan ke dan dari dua bahasa yang dipilih (prioritas di atas bahasa khusus dan default); bahasa lain dibiarkan. Hapus balasan otomatis menghapus balasan 🌐 sendiri setelah sekian detik, juga untuk balasan reaksi bendera (tidak bertahan melewati restart). Dengan reaksi bendera, anggota menerjemahkan satu pesan kapan pun dengan menempeli bendera bahasa yang didukung; itu memakai kuota anggota yang bereaksi dan batas per jam yang sama. Command /terjemahkan terpisah dari saklar dan channel terjemahan otomatis: anggota memilih bahasa dan memberi persetujuan untuk mengirim teks ke provider; hasilnya tampil di channel dan memakai kuota AI harian. Anggota juga bisa mengatur bahasa pribadinya dengan perintah /personal; menu Terjemahkan (tahan pesan → Apps) memakai bahasa itu, atau bahasa tujuan di tab Menu pesan bila belum diatur.'] },
  usage: { title: 'Laporan pemakaian AI', sub: 'Per hari, per jenis, per anggota · khusus owner bot.', aside: ['Yang dicatat', 'Hanya angka.', 'Saat aktif, bot mencatat jumlah permintaan AI yang dijawab provider: per hari (UTC, sama dengan reset kuota), per jenis fitur dan per anggota (ID). Isi pesan tidak dicatat. Catatan disimpan 45 hari. Pencarian web dan permintaan yang gagal tidak dihitung, jadi angkanya bisa sedikit di bawah kuota yang terpakai. Token hanya terisi bila provider melaporkannya.'] },
 };
 const KINDS = { reply: 'Balasan saat dipanggil', join: 'Nimbrung', gallery: 'Komentar galeri', idle: 'Sapaan saat sepi', link: 'Rangkum link', search: 'Cari berita', recap: 'Rangkum obrolan', 'menu-translate': 'Menu: terjemahkan', 'menu-explain': 'Menu: jelaskan', 'menu-fact': 'Menu: cek fakta', support: 'Bantuan troubleshooting', announcement: 'Draf pengumuman', 'bug-draft': 'Draf laporan bug', 'faq-suggestion': 'Saran pertanyaan FAQ', digest: 'Koran hari ini', 'digest-check': 'Pemeriksaan koran', facts: 'Fakta hari ini', 'facts-check': 'Pemeriksaan fakta', 'facts-translate': 'Terjemahan fakta', 'auto-translate': 'Terjemahan otomatis', 'slash-translate': '/terjemahkan', aichat: '/aichat', icebreaker: 'Icebreaker harian', welcome: 'AI Welcome', goodbye: 'AI Goodbye', activity: 'Activities', trivia: 'Trivia', builder: 'Server builder', knowledge: 'Pengetahuan', tools: 'AI tools', research: 'Riset web', ocr: 'Baca teks gambar', test: 'Uji koneksi', other: 'Lainnya' };
 const ZONES = { WIB: 'WIB', WITA: 'WITA', WIT: 'WIT' };

 function render(tab) {
  const page = PAGES[tab] || PAGES.faq;
  return `<div class="f-layout"><div>${panel(page.title, page.sub, 'aiSmart')}</div><aside>${tab==='digest'?panel('Fakta hari ini','Pengaturan terpisah · lima fun facts ringan dalam satu pesan.','aiFacts'):''}${side(...page.aside)}</aside></div>`;
 }

 /** Deterministic id for a new FAQ entry: the same question added at the same position gets the same id. */
 function entryId(question, taken) {
  let h = 2166136261;
  for (const c of question + '|' + taken.size) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  let id = 'q' + h.toString(36).padStart(7, '0');
  while (taken.has(id)) id += '0';
  return id;
 }

 // TXT has explicit Q:/A: pairs separated by a blank line; no guessing from prose.
 // Continuation lines belong to the answer, but a new label without separation is rejected.
 function parseFaqImport(raw){
  const input=String(raw).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!/^Q\s*:/i.test(input)){
   try{return JSON.parse(input)}catch{throw Error('JSON tidak valid. Untuk TXT, mulai setiap pasangan dengan Q: lalu A:.')}
  }
  return input.split(/\n[ \t]*\n+/).map((block,i)=>{
   const lines=block.split('\n'),question=lines[0]?.match(/^Q\s*:\s*(.*)$/i),answer=lines[1]?.match(/^A\s*:\s*(.*)$/i);
   if(!question||!answer||lines.slice(2).some(line=>/^[ \t]*[QA]\s*:/i.test(line)))throw Error(`Pasangan TXT ${i+1} tidak valid. Gunakan Q: dan A:, lalu baris kosong sebelum pasangan berikutnya.`);
   return {question:question[1],answer:[answer[1],...lines.slice(2)].join('\n')};
  });
 }

 function bind(root, tab, notify) {
  const slot = root.querySelector('#aiSmart');
  if (!slot) return;
  const name = PAGES[tab] ? tab : 'faq';
  req('smart').then((data) => { if (slot.isConnected) {views[name](slot, data, notify);if(name==='digest')factsView(root,data,notify);} }).catch((e) => { if (slot.isConnected) slot.textContent = e.message; });
 }

 /** Wires a form: checks the pickers, sends `body()` as PATCH smart/<section>, reports the outcome. */
 function wire(form, section, body, notify, done) {
  const picked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);
  form.onsubmit = async (e) => {
   e.preventDefault();
   for (const set of form.querySelectorAll('[data-picker]')) {
    if (picked(set.dataset.picker).length > Number(set.dataset.max)) { notify(`${set.querySelector('b').textContent}: paling banyak ${set.dataset.max} channel.`); return; }
   }
   const btn = form.querySelector('button[type=submit]');
   btn.disabled = true;
   try { const out = await req('smart/' + section, { method: 'PATCH', body: JSON.stringify(body(form.elements, picked)) }); done(out); }
   catch (err) { notify(err.message); }
   finally { btn.disabled = false; }
  };
 }

 function factsView(root,data,notify) {
  const slot=root.querySelector('#aiFacts');if(!slot)return;const s=data.settings.facts || {enabled:false,channelId:null,times:['07:00'],zone:'WIB',topics:''};
  const channels=[['','Pilih channel'],...data.channels.map(c=>[c.id,'# '+c.name])];if(s.channelId&&!data.channels.some(c=>c.id===s.channelId))channels.push([s.channelId,'ID tersimpan — tidak tersedia']);
  slot.innerHTML=`<p class="f-muted">Terpisah dari Koran hari ini. Bot mencari artikel dari situs terpilih, termasuk Wikipedia, Britannica, Smithsonian, NASA dan NOAA. Jika topik kosong, tiga negara diundi tanpa pengulangan hingga daftar 197 negara dan wilayah habis. Hasil tetap bergantung pada sumber yang terbaca, jadi negara yang diundi belum tentu muncul dalam fakta. Urutan situs dirotasi dan sumber yang baru dipakai dikurangi prioritasnya. Situs berbeda diutamakan jika cukup artikel terbaca, tetapi variasi tidak dijamin. Persiapan dimulai hingga 15 menit sebelum jadwal, tanpa mengirim lebih awal. Maksimal 3 pencarian dan 14 permintaan AI per percobaan; persiapan yang macet dapat diulang sekali, sehingga kuota dan biaya bisa bertambah; provider cadangan dapat dicoba jika hasil kosong atau gagal dan dapat menambah biaya. AI menerjemahkan ke bahasa Indonesia dan memeriksa bahasa, kesetaraan makna serta klaim terhadap artikel; pemeriksaan bisa keliru; artikel tidak selalu baru atau memuat temuan terbaru. Fakta yang lolos dipertahankan dan dicoba penggantinya sekali; kekurangan dilengkapi fakta cadangan umum. Topik khusus tidak berlaku untuk cadangan. Jika bot offline atau persiapan belum siap saat jadwal, bot memakai cadangan. Artikel dikirim ke provider AI. ${data.search.configured ? 'Kunci pencarian tersedia (bukan tes koneksi).' : 'Kunci pencarian belum tersedia; hanya paket yang disiapkan sebelumnya dapat dikirim.'}</p><form id="aiFactsForm" class="f-form">${toggle('enabled','Aktifkan fakta harian','Kirim lima fun facts ringan untuk setiap waktu yang disimpan.',s.enabled)}${row('Channel fakta','Pilih satu channel teks.',`<select name="channelId">${channels.map(([id,name])=>`<option value="${esc(id)}" ${id===(s.channelId||'')?'selected':''}>${esc(name)}</option>`).join('')}</select>`)}${[0,1,2].map(i=>row(`Waktu ${i+1}`,i===0?'Wajib diisi.':'Opsional; kosongkan jika tidak digunakan.',`<input name="time${i+1}" type="time" value="${esc(s.times?.[i]||'')}" ${i===0?'required':''}>`)).join('')}${row('Zona waktu','Berlaku untuk ketiga waktu.',`<select name="zone">${options(ZONES,s.zone)}</select>`)}${row('Topik','Opsional, paling banyak 120 karakter. Kosong = topik umum.',`<input name="topics" type="text" maxlength="120" value="${esc(s.topics)}" placeholder="mis. sains, sejarah, alam">`)}${actions('SIMPAN SEBELUM TES','<button class="f-outline" type="button" id="aiFactsTest">KIRIM TES KE DISCORD</button> ')}</form><p class="f-muted" id="aiFactsStatus" role="status">Memeriksa status terakhir…</p><div id="aiFactsEvidence" class="f-muted"></div><p class="f-muted">Tes menggunakan pengaturan tersimpan, mengirim pesan sungguhan tanpa ping dan dapat memakai kuota. Bot harus online; jadwal terlambat maksimal 60 menit. Maksimal tiga waktu berbeda per hari; satu percobaan per waktu, termasuk jika gagal.</p>`;
  const form=slot.querySelector('form'),out=slot.querySelector('#aiFactsStatus');
  async function refresh(){try{const data=await req('smart/facts/status');if(!out.isConnected)return;const x=data.status,evidence=slot.querySelector('#aiFactsEvidence');out.textContent=x?`Terakhir (${x.mode==='test'?'tes':'jadwal'+(x.slot?' '+x.slot:'')}, ${x.at}): ${x.message}`:'Belum ada percobaan fakta yang tercatat.';if(data.preparation?.length)out.textContent+=' Persiapan: '+data.preparation.map(p=>p.slot+' '+({working:'sedang berlangsung',ready:'siap',failed:'gagal',blocked:'ditolak akses atau persetujuan'}[p.state]||'tidak tersedia')+(p.source==='mixed'?' (campuran)':p.source==='fallback'?' (cadangan)':p.source==='ai'?' (AI diperiksa)':'')).join(', ')+'.';evidence.replaceChildren();if(Array.isArray(x?.evidence)){const heading=document.createElement('p');heading.textContent='Sumber fakta terakhir (hanya dashboard owner; bukan jaminan kebenaran):';evidence.append(heading);for(const item of x.evidence){const p=document.createElement('p');p.textContent=String(item.fact||'')+(item.origin==='fallback'?' (cadangan)':item.origin==='ai'?' (AI diperiksa)':'')+' — ';for(const raw of Array.isArray(item.urls)?item.urls:[]){try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=u.hostname;p.append(a,document.createTextNode(' '))}catch{}}evidence.append(p)}}}catch(e){if(out.isConnected)out.textContent='Status fakta tidak tersedia: '+e.message}}
  wire(form,'facts',x=>({enabled:x.enabled.checked,channelId:x.channelId.value||null,times:[x.time1.value,x.time2.value,x.time3.value].filter(Boolean),zone:x.zone.value,topics:x.topics.value}),notify,()=>notify('Pengaturan fakta disimpan.'));
  const test=slot.querySelector('#aiFactsTest');test.addEventListener('click',async()=>{if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm('Kirim tes lima fakta ke channel tersimpan? Ini memakai hingga 3 pencarian dan 14 permintaan AI; dapat menggunakan paket fakta yang disiapkan sebelumnya. Teks artikel dikirim ke provider AI; pesan Discord tanpa ping.') : Promise.resolve(window.confirm('Kirim tes lima fakta ke channel tersimpan? Ini memakai hingga 3 pencarian dan 14 permintaan AI; dapat menggunakan paket fakta yang disiapkan sebelumnya. Teks artikel dikirim ke provider AI; pesan Discord tanpa ping.')))))return;test.disabled=true;try{const result=await req('smart/facts/test',{method:'POST',body:JSON.stringify({confirmed:true})});notify(`Tes fakta terkirim ke ${result.sent} channel.`)}catch(e){notify(e.message)}finally{test.disabled=false;await refresh()}});refresh();
 }

 const views = {
  faq(slot, data, notify) {
   let { faq, cache } = data.settings;
   const max = data.limits.faqEntries;
   const draw = () => {
    slot.innerHTML = `<form id="aiFaqForm" class="f-form">${toggle('enabled', 'Aktifkan FAQ', 'Pertanyaan yang cocok dijawab dari daftar. Jika pencocokan kata gagal, AI mencoba memilih FAQ dan menggunakan kuota.', faq.enabled)}${toggle('varyWithAI', 'Variasikan jawaban dengan AI', 'Opsional: jawaban acuan dikirim ke provider dan memakai kuota. AI bisa keliru; jawaban acuan tetap ditampilkan. Jika gagal, gunakan jawaban asli.', faq.varyWithAI)}${toggle('autoAnswer', 'Jawab otomatis tanpa dipanggil', 'Di channel pilihan, pertanyaan anggota dapat dikirim ke provider AI untuk dicocokkan dengan FAQ dan memakai kuota, walau bot tidak dipanggil.', faq.autoAnswer)}${channelPicker('channelIds', 'Channel jawab otomatis', 'Tempat bot menjawab FAQ tanpa dipanggil.', data.channels, faq.channelIds, data.limits.channels)}${actions('BERLAKU PADA PESAN BERIKUTNYA')}</form>
     <details class="faq-import"><summary>Asisten troubleshooting otomatis</summary><p class="f-muted">Opsional untuk channel bantuan yang dipilih. Pertanyaan terkait masalah bot dapat dikirim ke provider AI dan memakai kuota tanpa mention. Beri tahu anggota. Jangan bagikan token, API key, password, isi .env, URL database atau webhook; penyaringan rahasia tidak sempurna. Konteks pertanyaan awal disimpan sementara di memori hingga 10 menit untuk balasan ke bot dan hilang saat restart. AI bisa salah; FAQ acuan didahulukan.</p><div id="supportSettings">Memuat…</div></details>
     <h3 class="s-head">Daftar FAQ <small>${faq.entries.length} dari ${max}</small></h3>
     <div class="s-list">${faq.entries.length ? faq.entries.map((entry) => `<div class="s-item"><div><b>${esc(entry.question)}</b><p>${esc(entry.answer)}</p></div><button type="button" class="f-outline" data-faq-remove="${esc(entry.id)}">HAPUS</button></div>`).join('') : '<p class="f-muted">Belum ada entri. Tambahkan pertanyaan yang sering muncul di server Anda.</p>'}</div>
     <details class="faq-import"><summary>Saran FAQ dari pertanyaan pilihan</summary><p class="f-muted">Pilih pesan secara manual dari Discord, sensor data pribadi atau rahasia, lalu tempel di sini. Tidak ada pengumpulan otomatis. Pertanyaan dikirim ke provider AI dan memakai kuota. Periksa dan sunting hasil; tulis jawaban sendiri sebelum menyimpan.</p><label class="f-field"><span><b>Pertanyaan yang dipilih</b></span><textarea id="faqCandidate" rows="3" maxlength="600"></textarea></label><div class="f-inline"><button type="button" class="f-outline" id="faqSuggest">BUAT SARAN</button></div><p class="f-muted" id="faqSuggestStatus" role="status"></p></details>
     <form id="aiFaqAddForm" class="f-form">${row('Pertanyaan', 'Tulis seperti anggota bertanya, 3–150 karakter. Kata-kata pentingnya yang dicocokkan.', '<input name="question" type="text" minlength="3" maxlength="150" required placeholder="mis. Bagaimana cara dapat role member?">')}${row('Jawaban', 'Dikirim apa adanya, 1–800 karakter. Mention di dalamnya tidak memanggil siapa pun.', '<textarea name="answer" rows="3" maxlength="800" required></textarea>')}<div class="f-form-actions"><span>✳ LANGSUNG TERSIMPAN</span><button class="f-primary" type="submit" ${faq.entries.length >= max ? 'disabled' : ''}>TAMBAH ENTRI ↗</button></div></form>
     <details class="faq-import"><summary>Impor FAQ dari JSON / TXT</summary><p class="f-muted">Pilih file atau tempel JSON berupa array dengan <code>question</code> dan <code>answer</code>, atau TXT dengan pasangan <code>Q:</code> dan <code>A:</code> dipisah satu baris kosong. Pratinjau dulu; entri baru ditambahkan, FAQ lama dan pengaturan tetap ada. Maksimal ${max} entri total, file maksimal 64 KB.</p><p class="f-muted">Contoh: <code>[{"question":"Bagaimana cara bergabung?","answer":"Baca panduan server."}]</code></p><p class="f-muted">Contoh TXT: <code>Q: Bagaimana cara bergabung?</code> lalu di baris berikutnya <code>A: Baca panduan server.</code> Pisahkan pasangan dengan baris kosong. Jawaban boleh beberapa baris.</p><label class="f-field"><span><b>File JSON / TXT</b><small>Pilih file UTF-8 .json atau .txt.</small></span><input type="file" id="faqImportFile" accept=".json,.txt,application/json,text/plain"></label><label class="f-field"><span><b>Atau tempel JSON / TXT</b><small>Data hanya dipakai untuk membuat FAQ, bukan dokumen rujukan AI.</small></span><textarea id="faqImportText" rows="5" spellcheck="false" placeholder="Tempel JSON atau TXT FAQ di sini"></textarea></label><div class="f-inline"><button class="f-outline" type="button" id="faqImportPreview">PRATINJAU</button><button class="f-primary" type="button" id="faqImportSave" disabled>IMPOR FAQ</button></div><p class="f-muted" id="faqImportStatus" role="status"></p><div id="faqImportResult"></div></details>
     <h3 class="s-head">Cache jawaban</h3>
     <form id="aiCacheForm" class="f-form">${toggle('enabled', 'Aktifkan cache jawaban', 'Pertanyaan yang sama kepada AI interaktif dalam rentang waktu ini memakai jawaban sebelumnya, tanpa kuota.', cache.enabled)}${number('minutes', 'Lama cache (menit)', 'Sejak jawaban dibuat', cache.minutes, 1, 120)}${actions('BERLAKU PADA PESAN BERIKUTNYA')}</form>`;
    const supportSlot=slot.querySelector('#supportSettings');
    req('support/settings').then(({settings:s})=>{
     if(!supportSlot.isConnected)return;
     supportSlot.innerHTML=`<form id="supportForm" class="f-form">${toggle('enabled','Aktifkan asisten bantuan','AI dapat membaca pertanyaan masalah di channel pilihan dan mengirimnya ke provider.',s.enabled)}${channelPicker('channelIds','Channel bantuan','Pilih hanya channel yang diberi tahu tentang penggunaan AI.',data.channels,s.channelIds,data.limits.channels)}<div class="f-form-actions"><button type="submit" class="f-primary">SIMPAN BANTUAN</button></div></form>`;
     const form=supportSlot.querySelector('#supportForm');form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const channelIds=[...form.querySelectorAll('input[name="channelIds"]:checked')].map(x=>x.value);await req('support/settings',{method:'PATCH',body:JSON.stringify({enabled:form.elements.enabled.checked,channelIds})});notify('Pengaturan bantuan disimpan.')}catch(e){notify(e.message)}finally{button.disabled=false}};
    }).catch(()=>{if(supportSlot.isConnected)supportSlot.textContent='Pengaturan bantuan tidak tersedia.'});
    const saveFaq = async (next, message) => {
     try { faq = (await req('smart/faq', { method: 'PATCH', body: JSON.stringify(next) })).settings.faq; notify(message); draw(); }
     catch (err) { notify(err.message); }
    };
    wire(slot.querySelector('#aiFaqForm'), 'faq', (x, picked) => ({ enabled: x.enabled.checked, autoAnswer: x.autoAnswer.checked, varyWithAI: x.varyWithAI.checked, channelIds: picked('channelIds'), entries: faq.entries }), notify, (out) => { faq = out.settings.faq; notify('Pengaturan FAQ disimpan.'); });
    slot.querySelector('#faqSuggest').onclick=async()=>{
     const candidate=slot.querySelector('#faqCandidate').value.trim(),status=slot.querySelector('#faqSuggestStatus'),button=slot.querySelector('#faqSuggest'),form=slot.querySelector('#aiFaqAddForm');
     if(candidate.length<3){status.textContent='Tempel pertanyaan pilihan (minimal 3 karakter).';return;}
     if(!(await (window.ZentixDialog?window.ZentixDialog.confirm('Kirim pertanyaan pilihan ke provider AI? Ini memakai kuota.'):Promise.resolve(window.confirm('Kirim pertanyaan pilihan ke provider AI? Ini memakai kuota.')))))return;
     const previous=form.elements.question.value;button.disabled=true;status.textContent='Membuat saran…';
     try{const result=await req('faq-question-draft',{method:'POST',body:JSON.stringify({confirmed:true,question:candidate})});if(!form.isConnected)return;if(form.elements.question.value!==previous){status.textContent='Pertanyaan di formulir berubah; saran tidak menggantinya.';return;}
      if(previous.trim()&&!(await (window.ZentixDialog?window.ZentixDialog.confirm('Ganti pertanyaan pada formulir dengan saran ini?'):Promise.resolve(window.confirm('Ganti pertanyaan pada formulir dengan saran ini?')))))return;
      if(form.elements.question.value!==previous){status.textContent='Pertanyaan berubah; saran tidak menggantinya.';return;}form.elements.question.value=result.question;status.textContent='Saran siap diperiksa. Tulis jawaban dan tekan TAMBAH ENTRI untuk menyimpan.';
     }catch(e){if(status.isConnected)status.textContent=e.message}finally{button.disabled=false}
    };
    slot.querySelector('#aiFaqAddForm').onsubmit = (e) => {
     e.preventDefault();
     const x = e.target.elements, question = x.question.value.trim(), answer = x.answer.value.trim();
     if (question.length < 3 || !answer) { notify('Isi pertanyaan (minimal 3 karakter) dan jawabannya.'); return; }
     if (faq.entries.length >= max) { notify(`FAQ paling banyak ${max} entri.`); return; }
     saveFaq({ ...faq, entries: [...faq.entries, { id: entryId(question, new Set(faq.entries.map((entry) => entry.id))), question, answer }] }, 'Entri FAQ ditambahkan.');
    };
    slot.querySelectorAll('[data-faq-remove]').forEach((button) => button.addEventListener('click', () => saveFaq({ ...faq, entries: faq.entries.filter((entry) => entry.id !== button.dataset.faqRemove) }, 'Entri FAQ dihapus.')));
    const file=slot.querySelector('#faqImportFile'), text=slot.querySelector('#faqImportText'), preview=slot.querySelector('#faqImportResult'), importStatus=slot.querySelector('#faqImportStatus'), importButton=slot.querySelector('#faqImportSave');
    let draft=null, revision=0;
    const resetImport=()=>{revision++;draft=null;importButton.disabled=true;preview.replaceChildren();importStatus.textContent='';};
    text.addEventListener('input',resetImport);
    file.addEventListener('change',()=>{
     resetImport();text.value='';const selected=file.files?.[0];file.value='';if(!selected)return;
     if(selected.size>64*1024){importStatus.textContent='File maksimal 64 KB.';return;}
     const stamp=revision,reader=new FileReader();reader.onload=()=>{if(stamp!==revision||!slot.isConnected)return;text.value=String(reader.result||'');importStatus.textContent='File dibaca. Tekan PRATINJAU untuk memeriksa.';};reader.onerror=()=>{if(stamp===revision)importStatus.textContent='File tidak dapat dibaca.'};reader.readAsText(selected,'UTF-8');
    });
    slot.querySelector('#faqImportPreview').addEventListener('click',()=>{
     resetImport();try{
      if(new Blob([text.value]).size>64*1024)throw Error('File atau teks maksimal 64 KB.');
      const items=parseFaqImport(text.value);
      if(!Array.isArray(items)||!items.length||items.length>max)throw Error(`File harus berisi 1–${max} FAQ; JSON harus berupa array.`);
      if(faq.entries.length+items.length>max)throw Error(`FAQ maksimal ${max} entri termasuk yang sudah ada.`);
      const questions=new Set(faq.entries.map(e=>e.question.toLocaleLowerCase('id')));
      const entries=items.map((item,i)=>{
       if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==2||typeof item.question!=='string'||typeof item.answer!=='string')throw Error(`Entri ${i+1} harus berisi question dan answer berupa teks.`);
       const question=item.question.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim(),answer=item.answer.trim();
       if(question.length<3||question.length>150||!answer||answer.length>800)throw Error(`Entri ${i+1}: pertanyaan 3–150 dan jawaban 1–800 karakter.`);
       const key=question.toLocaleLowerCase('id');if(questions.has(key))throw Error(`Entri ${i+1}: pertanyaan sama dengan entri lain atau FAQ tersimpan.`);questions.add(key);return {question,answer};
      });
      draft={entries,expected:JSON.parse(JSON.stringify(faq))};
      preview.innerHTML=`<p class="f-muted">${entries.length} entri baru · ${faq.entries.length} tersimpan · ${faq.entries.length+entries.length}/${max} total</p><div class="s-list">${entries.map(e=>`<div class="s-item"><div><b>${esc(e.question)}</b><p style="white-space:pre-wrap">${esc(e.answer)}</p></div></div>`).join('')}</div>`;
      importStatus.textContent='Pratinjau siap. Belum ada data yang disimpan.';importButton.disabled=false;
     }catch(error){importStatus.textContent=error.message;}
    });
    importButton.addEventListener('click',async()=>{
     if(!draft)return;const current=draft,stamp=revision;importButton.disabled=true;
     try{
      const ok=await (window.ZentixDialog?window.ZentixDialog.confirm(`Tambahkan ${current.entries.length} FAQ? Entri dan pengaturan yang sudah ada tidak dihapus.`):Promise.resolve(window.confirm(`Tambahkan ${current.entries.length} FAQ? Entri dan pengaturan yang sudah ada tidak dihapus.`)));
      if(!ok||revision!==stamp||!slot.isConnected)return;
      const out=await req('smart/faq/import',{method:'POST',body:JSON.stringify({confirmed:true,entries:current.entries,expected:current.expected})});
      faq=out.settings.faq;notify(`${current.entries.length} FAQ berhasil diimpor.`);draw();
     }catch(error){importStatus.textContent=error.message;notify(error.message);}
     finally{if(draft===current&&slot.isConnected)importButton.disabled=false;}
    });
    wire(slot.querySelector('#aiCacheForm'), 'cache', (x) => ({ enabled: x.enabled.checked, minutes: Number(x.minutes.value) }), notify, (out) => { cache = out.settings.cache; notify('Pengaturan cache disimpan.'); });
   };
   draw();
  },

  menu(slot, data, notify) {
   const s = data.settings.menu;
   const help = { translate: 'Menerjemahkan pesan yang dipilih ke bahasa tujuan di bawah.', explain: 'Menjelaskan maksud pesan, istilah dan bahasa gaulnya.', factCheck: data.search.configured ? 'Membandingkan klaim dengan cuplikan pencarian web dan menyebut sumbernya. Memakai 2 kuota.' : 'Kunci pencarian web belum terpasang: AI hanya meninjau klaim tanpa sumber dan mengatakannya.', recap: 'Merangkum sampai 150 pesan yang ditulis setelah pesan yang dipilih. Perlu izin membaca riwayat pesan.' };
   slot.innerHTML = `<form id="aiMenuForm" class="f-form">${data.menus.map((menu) => toggle(menu.key, `Menu "${menu.name}"`, help[menu.key], s[menu.key])).join('')}${row('Bahasa tujuan terjemahan', 'Dipakai oleh menu "Terjemahkan" bila anggota belum mengatur bahasa pribadinya (/personal).', `<select name="language">${options(data.languages, s.language)}</select>`)}${actions('DIDAFTARKAN KE DISCORD SAAT DISIMPAN')}</form>`;
   wire(slot.querySelector('form'), 'menu', (x) => ({ translate: x.translate.checked, explain: x.explain.checked, factCheck: x.factCheck.checked, recap: x.recap.checked, language: x.language.value }), notify,
    (out) => notify(out.menuSync === false ? 'Tersimpan, tetapi menu belum bisa didaftarkan ke Discord. Restart bot untuk mendaftarkannya.' : out.menuSync === true ? 'Tersimpan dan menu didaftarkan ke Discord.' : 'Pengaturan menu pesan disimpan.'));
  },

  digest(slot, data, notify) {
   const s = data.settings.digest;
   const channels=[['','Pilih channel'],...data.channels.map(c=>[c.id,'# '+c.name])];if(s.channelIds[0]&&!data.channels.some(c=>c.id===s.channelIds[0]))channels.push([s.channelIds[0],'ID tersimpan — tidak tersedia']);
   slot.innerHTML = `<form id="aiDigestForm" class="f-form">${toggle('enabled', 'Aktifkan koran hari ini', 'Satu kiriman untuk setiap waktu yang disimpan.', s.enabled)}${row('Channel koran hari ini','Pilih satu channel teks. Jika sebelumnya lebih dari satu, channel pertama dipertahankan.',`<select name="channelId">${channels.map(([id,name])=>`<option value="${esc(id)}" ${id===(s.channelIds[0]||'')?'selected':''}>${esc(name)}</option>`).join('')}</select>`)}${[0,1,2].map(i=>row(`Waktu ${i+1}`,i===0?'Wajib diisi.':'Opsional; kosongkan jika tidak digunakan.',`<input name="time${i+1}" type="time" value="${esc(s.times?.[i]||'')}" ${i===0?'required':''}>`)).join('')}${row('Zona waktu','Berlaku untuk ketiga waktu.',`<select name="zone">${options(ZONES,s.zone)}</select>`)}<p class="f-muted">${data.search.configured ? 'Berita selalu aktif: tiga sampai empat butir dari hasil pencarian web, dengan sumbernya.' : 'Berita selalu aktif, tetapi kunci pencarian web belum terpasang; edisi dilewati sampai pencarian tersedia.'}</p>${row('Topik', 'Opsional, paling banyak 120 karakter. Kosong = berita utama Indonesia.', `<input name="topics" type="text" maxlength="120" value="${esc(s.topics)}" placeholder="mis. teknologi, game, anime">`)}${actions('BERLAKU PADA JAM KIRIM BERIKUTNYA', '<button class="f-outline" type="button" id="aiDigestTest">KIRIM TES SEKARANG</button> ')}</form>`;
   const form = slot.querySelector('form');
   wire(form, 'digest', (x) => ({ enabled: x.enabled.checked, channelIds: x.channelId.value ? [x.channelId.value] : [], times: [x.time1.value,x.time2.value,x.time3.value].filter(Boolean), zone: x.zone.value, topics: x.topics.value }), notify, () => notify('Pengaturan koran hari ini disimpan.'));
   const test = slot.querySelector('#aiDigestTest');
   test.addEventListener('click', async () => {
    if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm('Kirim satu edisi sekarang ke channel yang TERSIMPAN? Ini memakai kuota AI bot.') : Promise.resolve(window.confirm('Kirim satu edisi sekarang ke channel yang TERSIMPAN? Ini memakai kuota AI bot.'))))) return;
    test.disabled = true;
    try { const out = await req('smart/digest/test', { method: 'POST', body: JSON.stringify({ confirmed: true }) }); notify(`Terkirim ke ${out.sent} channel${out.failed ? `, gagal di ${out.failed} channel (periksa izin bot)` : ''}.${out.note ? ' Catatan: ' + out.note : ''}`); }
    catch (err) { notify(err.message); }
    finally { test.disabled = false; }
   });
  },

  translate(slot, data, notify) {
   const s = data.settings.translate;
   const escId = (v) => String(v).replace(/[^0-9]/g, '');
   const langOpts = (chosen) => options(data.languages, chosen);
   const overrideRows = () => (s.channelIds.length ? s.channelIds.map((id) => {
      const known = data.channels.find((x) => x.id === id);
      const label = known ? '# ' + known.name : 'ID tersimpan — tidak tersedia';
      const current = (s.channelLanguages && s.channelLanguages[id]) || '';
      return `<label class="f-field"><span><b>${esc(label)}</b><small>Bahasa khusus untuk channel ini; kosong = ikut bahasa tujuan.</small></span><select name="cl_${escId(id)}"><option value="">Ikut bahasa tujuan</option>${options(data.languages, current)}</select></label>`;
   }).join('') : '<small>Centang minimal satu channel di atas untuk mengatur bahasa khusus.</small>');
   const revRow = (pair) => `<div class="f-inline ai-reverse-row" style="gap:.5rem;margin:.35rem 0;align-items:center"><select name="rvChannel">${data.channels.map((x) => `<option value="${esc(x.id)}" ${pair && pair.channelId === x.id ? 'selected' : ''}># ${esc(x.name)}</option>`).join('')}</select><select name="rvA">${langOpts(pair ? pair.langA : 'id')}</select><span>⇄</span><select name="rvB">${langOpts(pair ? pair.langB : 'en')}</select><button type="button" class="f-outline" data-rev-remove>HAPUS</button></div>`;
   slot.innerHTML = `<form id="aiTranslateForm" class="f-form">${toggle('enabled', 'Aktifkan terjemahan otomatis', 'Pesan berbahasa lain di channel pilihan dibalas dengan terjemahannya.', s.enabled)}${channelPicker('channelIds', 'Channel terjemahan', 'Tempat bot menerjemahkan pesan anggota. Dibagikan dengan reaksi bendera.', data.channels, s.channelIds, data.limits.channels)}${row('Bahasa tujuan', 'Default untuk semua channel terpilih; pesan yang sudah dalam bahasa ini dilewati.', `<select name="target">${options(data.languages, s.target)}</select>`)}${number('hourlyLimit', 'Batas permintaan AI per jam', 'Per channel, termasuk pesan yang ternyata tidak perlu diterjemahkan', s.hourlyLimit, 1, 120)}${number('deleteAfterSeconds', 'Hapus balasan otomatis', 'Detik sebelum balasan 🌐 dihapus sendiri; 0 = dibiarkan. Berlaku untuk balasan otomatis dan balasan reaksi bendera', s.deleteAfterSeconds, 0, 3600)}${toggle('reactionEnabled', 'Terjemahkan dengan reaksi bendera', 'Anggota menempelkan bendera pada pesan dan bot membalas terjemahannya ke bahasa bendera itu. Hanya di channel terpilih; memakai kuota anggota yang bereaksi.', s.reactionEnabled)}<fieldset class="f-field"><span><b>Bahasa khusus per channel</b><small>Mengoveride bahasa tujuan, hanya untuk channel yang dicentang. Reaksi bendera tidak terpengaruh.</small></span><div id="aiChannelLangs">${overrideRows()}</div></fieldset><fieldset class="f-field"><span><b>Terjemahan dua arah</b><small>Pesan dalam bahasa A diterjemahkan ke B dan sebaliknya; bahasa lain dibiarkan. Mengabaikan bahasa khusus dan default pada channel itu. Paling banyak 5 pasang.</small></span><div id="aiReverseRows">${(s.reverse || []).map(revRow).join('')}</div><button type="button" class="f-outline" id="aiReverseAdd">+ TAMBAH PASANGAN</button></fieldset><p class="f-muted">Anggota mengatur bahasa pribadinya dengan perintah <code>/personal</code> (mis. <code>/personal bahasa:Indonesia</code>). Menu Terjemahkan (tahan pesan → Apps) menerjemahkan ke bahasa itu, atau bahasa tujuan di tab Menu pesan bila belum diatur.</p>${actions('BERLAKU PADA PESAN BERIKUTNYA')}</form>`;
   const rowsBox = slot.querySelector('#aiReverseRows');
   const addRow = () => {
      if (rowsBox.querySelectorAll('.ai-reverse-row').length >= 5) { notify('Paling banyak 5 pasangan dua arah.'); return; }
      rowsBox.insertAdjacentHTML('beforeend', revRow(null));
   };
   slot.querySelector('#aiReverseAdd').onclick = addRow;
   slot.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-rev-remove]');
      if (btn) btn.closest('.ai-reverse-row')?.remove();
   });
   const form = slot.querySelector('#aiTranslateForm');
   const pickedIds = () => [...form.querySelectorAll('input[name="channelIds"]:checked')].map((x) => x.value);
   form.onsubmit = async (e) => {
    e.preventDefault();
    for (const set of form.querySelectorAll('[data-picker]')) {
     if (pickedIds().length > Number(set.dataset.max)) { notify(`${set.querySelector('b').textContent}: paling banyak ${set.dataset.max} channel.`); return; }
    }
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
     const channelIds = pickedIds();
     const channelLanguages = {};
     for (const sel of form.querySelectorAll('select[name^="cl_"]')) { const id = sel.name.slice(3); if (sel.value && channelIds.includes(id)) channelLanguages[id] = sel.value; }
     const reverse = [...form.querySelectorAll('.ai-reverse-row')].map((row) => ({ channelId: row.querySelector('select[name="rvChannel"]').value, langA: row.querySelector('select[name="rvA"]').value, langB: row.querySelector('select[name="rvB"]').value }));
     await req('smart/translate', { method: 'PATCH', body: JSON.stringify({
       enabled: form.elements.enabled.checked,
       channelIds,
       target: form.elements.target.value,
       hourlyLimit: Number(form.elements.hourlyLimit.value),
       reactionEnabled: form.elements.reactionEnabled.checked,
       deleteAfterSeconds: Math.max(0, Math.min(3600, Number(form.elements.deleteAfterSeconds.value) || 0)),
       channelLanguages,
       reverse,
     }) });
     notify('Pengaturan terjemahan otomatis disimpan.');
    } catch (err) { notify(err.message); } finally { btn.disabled = false; }
   };
  },

  usage(slot, data, notify) {
   let enabled = data.settings.usage.enabled;
   slot.innerHTML = `<form id="aiUsageForm" class="f-form">${toggle('enabled', 'Catat pemakaian AI', 'Mati = tidak ada yang dicatat; catatan lama tetap ada sampai kedaluwarsa (45 hari).', enabled)}${actions('BERLAKU PADA PERMINTAAN BERIKUTNYA')}</form><div class="s-report-bar"><h3 class="s-head">Laporan</h3><span class="f-inline"><button type="button" class="f-outline" data-days="7">7 HARI</button><button type="button" class="f-outline" data-days="14">14 HARI</button><button type="button" class="f-outline" data-days="30">30 HARI</button></span></div><div id="aiUsageReport" class="s-report">Memuat…</div>`;
   const report = slot.querySelector('#aiUsageReport');
   const n = (value) => Number(value || 0).toLocaleString('id-ID');
   const load = async (days) => {
    try {
     const r = await req('smart/usage?days=' + days);
     if (!report.isConnected) return;
     const peak = Math.max(1, ...r.days.map((d) => d.calls));
     const saved = r.total.cacheHits + r.total.faqHits;
     report.innerHTML = `${r.enabled ? '' : '<p class="f-muted">Pencatatan sedang mati. Angka di bawah berasal dari catatan sebelumnya, bila ada.</p>'}
      <div class="s-stats"><div><b>${n(r.total.calls)}</b><span>permintaan AI · ${days} hari</span></div><div><b>${n(saved)}</b><span>dijawab tanpa AI (FAQ ${n(r.total.faqHits)} · cache ${n(r.total.cacheHits)})</span></div><div><b>${n(r.total.tokens)}</b><span>token dilaporkan provider</span></div><div><b>${n(r.limits.guildDaily)}</b><span>batas server per hari · ${n(r.limits.perUserDaily)} per anggota</span></div></div>
      <h4>Per hari (UTC)</h4><div class="s-bars">${r.days.map((d) => `<div class="s-bar" title="${esc(d.day)}"><span>${esc(d.day.slice(5))}</span><i><em style="width:${Math.round(d.calls / peak * 100)}%"></em></i><b>${n(d.calls)}</b></div>`).join('')}</div>
      <h4>Per jenis</h4>${r.kinds.length ? `<div class="s-bars s-long">${r.kinds.map((k) => `<div class="s-bar"><span>${esc(KINDS[k.kind] || k.kind)}</span><i><em style="width:${Math.round(k.calls / Math.max(1, r.kinds[0].calls) * 100)}%"></em></i><b>${n(k.calls)}</b></div>`).join('')}</div>` : '<p class="f-muted">Belum ada catatan pada rentang ini.</p>'}
      <h4>Lima anggota teratas</h4>${r.members.length ? `<div class="s-bars s-long">${r.members.map((m) => `<div class="s-bar" title="ID ${esc(m.userId)}"><span>${esc(m.name || 'ID ' + m.userId)}</span><i><em style="width:${Math.round(m.calls / Math.max(1, r.members[0].calls) * 100)}%"></em></i><b>${n(m.calls)}</b></div>`).join('')}</div>` : '<p class="f-muted">Belum ada catatan pada rentang ini.</p>'}`;
     slot.querySelectorAll('[data-days]').forEach((button) => button.classList.toggle('active', Number(button.dataset.days) === days));
    } catch (err) { if (report.isConnected) report.textContent = err.message; }
   };
   slot.querySelectorAll('[data-days]').forEach((button) => button.addEventListener('click', () => load(Number(button.dataset.days))));
   wire(slot.querySelector('form'), 'usage', (x) => ({ enabled: x.enabled.checked }), notify, (out) => { enabled = out.settings.usage.enabled; notify(enabled ? 'Pencatatan pemakaian diaktifkan.' : 'Pencatatan pemakaian dimatikan.'); load(7); });
   load(7);
  },
 };

 window.ZentixAISmart = { render, bind };
})();
