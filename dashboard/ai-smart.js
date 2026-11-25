/* "Fitur pintar" room of AI Studio: FAQ and reply cache, message menu, morning digest,
   automatic translation and the usage report. (The greeting extras are edited in the Welcome & goodbye room.) Owner only. Every feature has its own switch and its own
   save button; features that work in channels let the owner tick several channels. */
(() => {
 const tr = (id,en) => window.ZentixI18n?.language === 'en' ? en : id;
 const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
 // Smart settings validation messages are built by the bot, never by the provider.
 // Match status, code and exact copy; keep unknown diagnostics and all user data untouched.
 const SMART_ERRORS=new Map([
  ['Pengaturan tidak valid.','Invalid settings.'],
  ['Pilihan aktif/nonaktif tidak valid.','Invalid enabled/disabled option.'],
  ['Bahasa khusus per channel tidak valid.','Invalid channel-specific languages.'],
  ['Bahasa khusus: paling banyak 10 channel.','Channel-specific languages: at most 10 channels.'],
  ['Bahasa khusus: ID channel tidak valid.','Channel-specific languages: invalid channel ID.'],
  ['Bahasa khusus: bahasa tujuan tidak valid.','Channel-specific languages: invalid target language.'],
  ['Bahasa khusus: pilih channel teks server.','Channel-specific languages: choose a server text channel.'],
  ['Pasangan dua arah: paling banyak 5 pasangan.','Bidirectional translation: at most 5 pairs.'],
  ['Pasangan dua arah tidak valid.','Invalid bidirectional pair.'],
  ['Pasangan dua arah: dua bahasa harus berbeda.','Bidirectional translation: the two languages must differ.'],
  ['Pasangan dua arah: channel yang sama dipakai dua kali.','Bidirectional translation: the same channel is used twice.'],
  ['Pasangan dua arah: pilih channel teks server.','Bidirectional translation: choose a server text channel.'],
  ['FAQ: paling banyak 25 entri.','FAQ: at most 25 entries.'],
  ['Entri FAQ tidak valid.','Invalid FAQ entry.'],
  ['Pertanyaan FAQ harus 3–150 karakter.','FAQ questions must be 3–150 characters.'],
  ['Jawaban FAQ harus 1–800 karakter.','FAQ answers must be 1–800 characters.'],
  ['Entri FAQ ganda.','Duplicate FAQ entry.'],
  ['Jawab otomatis memerlukan minimal satu channel.','Automatic answers require at least one channel.'],
  ['Lama cache harus 1–120 menit.','Cache duration must be 1–120 minutes.'],
  ['Bahasa tujuan tidak valid.','Invalid target language.'],
  ['Pilih paling banyak satu channel koran hari ini.','Choose at most one daily news channel.'],
  ['Jam kirim harus 1–3 waktu yang valid dan berbeda.','Choose 1–3 valid, distinct sending times.'],
  ['Zona waktu tidak valid.','Invalid time zone.'],
  ['Topik paling banyak 120 karakter.','Topics must be at most 120 characters.'],
  ['Koran hari ini memerlukan minimal satu channel.','Daily news requires at least one channel.'],
  ['Channel fakta tidak valid.','Invalid facts channel.'],
  ['Pilih satu channel teks untuk fakta.','Choose one text channel for facts.'],
  ['Pilih satu channel untuk fakta.','Choose one channel for facts.'],
  ['Pilih 1–3 jam fakta yang valid dan berbeda.','Choose 1–3 valid, distinct facts times.'],
  ['Zona waktu fakta tidak valid.','Invalid facts time zone.'],
  ['Batas per jam harus 1–120.','The hourly limit must be 1–120.'],
  ['Hapus balasan otomatis harus antara 0–3600 detik.','Auto-delete replies must be between 0–3600 seconds.'],
  ['Terjemahan otomatis dan reaksi bendera memerlukan minimal satu channel.','Automatic translation and flag reactions require at least one channel.'],
  ['Impor FAQ harus berisi 1–25 entri.','FAQ import must contain 1–25 entries.'],
  ['FAQ maksimal 25 entri termasuk yang sudah ada.','FAQ is limited to 25 entries, including existing entries.'],
  ['Ada pertanyaan yang sama di file atau FAQ tersimpan.','A question is duplicated in the file or saved FAQ.'],
 ]);
 const smartError=(message,status,code)=>{
  if(window.ZentixI18n?.language!=='en'||typeof message!=='string')return message;
  if(status===409&&code==='UNAVAILABLE'&&message==='FAQ berubah sejak pratinjau. Muat ulang halaman dan periksa kembali.')return 'FAQ changed since the preview. Reload the page and check again.';
  if(status===400&&code===undefined&&message==='Konfirmasi dan data impor FAQ diperlukan.')return 'FAQ import confirmation and data are required.';
  if(code!=='INVALID_SMART')return message;
  if(status===404&&message==='Bagian pengaturan tidak dikenal.')return 'Unknown settings section.';
  if(status!==400)return message;
  const fixed=SMART_ERRORS.get(message);if(fixed!==undefined)return fixed;
  const labels={'Channel FAQ':'FAQ channels','Channel koran hari ini':'Daily news channels','Channel terjemahan':'Translation channels'};
  const details={'paling banyak 10 channel.':'at most 10 channels.','channel tidak valid.':'invalid channel.','pilih channel teks server.':'choose a server text channel.'};
  const channel=/^(Channel FAQ|Channel koran hari ini|Channel terjemahan): (paling banyak 10 channel\.|channel tidak valid\.|pilih channel teks server\.)$/.exec(message);
  if(channel)return `${labels[channel[1]]}: ${details[channel[2]]}`;
  let entry=/^Entri ([1-9][0-9]*) harus berisi question dan answer berupa teks\.$/.exec(message);
  if(entry)return `Entry ${entry[1]} must contain question and answer as text.`;
  entry=/^Entri ([1-9][0-9]*): pertanyaan 3–150 dan jawaban 1–800 karakter\.$/.exec(message);
  if(entry)return `Entry ${entry[1]}: question 3–150 and answer 1–800 characters.`;
  return message;
 };
 // Test endpoints return only these bot-owned errors; preserve provider details and unfamiliar diagnostics.
 const SEND_TEST_ERRORS=new Map([
  ['smart/facts/test|400|UNAVAILABLE|Pilih dan simpan satu channel fakta.','Choose and save a facts channel first.'],
  ['smart/facts/test|403|UNAVAILABLE|Bot tidak memiliki akses kirim pada channel fakta.','The bot cannot send messages in the facts channel.'],
  ['smart/facts/test|503|UNAVAILABLE|Fakta yang aman tidak mencukupi.','Not enough safe facts are available.'],
  ['smart/facts/test|400|UNAVAILABLE|Pesan fakta terlalu panjang untuk dikirim.','The facts message is too long to send.'],
  ['smart/facts/test|409|UNAVAILABLE|Hasil pengiriman fakta tidak pasti; periksa channel sebelum mencoba lagi.','The facts message may or may not have been sent; check the channel before trying again.'],
  ['smart/facts/test|503|UNAVAILABLE|Gagal memeriksa atau mengirim fakta. Periksa pencarian, provider AI, kuota, sumber dan izin channel.','Could not check or send facts. Check search, AI providers, quotas, sources and channel permissions.'],
  ['smart/digest/test|400|DIGEST|Pilih dan simpan minimal satu channel dahulu.','Choose and save at least one channel first.'],
  ['smart/digest/test|502|DIGEST|Edisi koran terlalu panjang.','The newspaper edition is too long.'],
  ['smart/digest/test|503|DIGEST|AI atau pencarian belum tersedia.','AI or search is not available yet.'],
  ['smart/digest/test|503|DIGEST|Tidak ada artikel berita baru yang layak dikirim.','No suitable new news articles are available to send.'],
  ['smart/digest/test|502|DIGEST|Cuplikan berita terlalu panjang.','News snippets are too long.'],
  ['smart/digest/test|502|DIGEST|Format koran tidak valid.','Invalid newspaper format.'],
  ['smart/digest/test|502|DIGEST|Tidak ada berita valid.','No valid news items are available.'],
  ['smart/digest/test|502|DIGEST|Pemeriksaan berita terlalu panjang.','The news review is too long.'],
  ['smart/digest/test|502|DIGEST|Pemeriksaan koran tidak valid.','Invalid newspaper review.'],
  ['smart/digest/test|502|DIGEST|Tidak ada berita lolos pemeriksaan.','No news items passed the review.'],
 ]);
 const sendTestError=(path,method,status,code,message)=>window.ZentixI18n?.language==='en'&&method==='POST'?(SEND_TEST_ERRORS.get(`${path}|${status}|${code}|${message}`)??message):message;
 const FACT_REASONS=new Map([
  ['Provider AI atau pencarian belum tersedia','AI provider or search is not available yet'],['Semua permintaan pencarian gagal','All search requests failed'],['Hasil pencarian dari situs yang diizinkan tidak cukup','Not enough search results from allowed sites'],['Artikel yang berhasil dibaca tidak cukup','Not enough articles could be read'],['Pencarian atau pembacaan artikel gagal','Search or article reading failed'],['Permintaan AI untuk memilih fakta gagal','The AI request to select facts failed'],['Respons AI atau pilihan sumber tidak valid','Invalid AI response or source selection'],['Permintaan terjemahan fakta gagal','The fact translation request failed'],['Terjemahan fakta tidak valid','Invalid fact translation'],['Permintaan AI untuk memeriksa fakta gagal','The AI request to check facts failed'],['Respons pemeriksaan AI tidak valid','Invalid AI review response'],['Klaim tidak lolos pemeriksaan AI','Claims did not pass the AI review'],['Tahap pemrosesan fakta gagal','Fact processing failed'],['Persiapan tidak tersedia atau belum selesai saat jadwal','Preparation was unavailable or unfinished at the scheduled time'],['Fakta AI belum siap','AI facts were not ready'],
 ]);
 const FACT_STATUS=new Map([
  ['Pemeriksaan selesai; menyiapkan pengiriman.','Review complete; preparing delivery.'],
  ['Lima fakta dari artikel terkirim; pemeriksaan AI dapat keliru.','Five article-based facts were sent; the AI review can be wrong.'],
  ['Pilih dan simpan satu channel fakta.','Choose and save a facts channel first.'],
  ['Bot tidak memiliki akses kirim pada channel fakta.','The bot cannot send messages in the facts channel.'],
  ['Pesan fakta terlalu panjang untuk dikirim.','The facts message is too long to send.'],
  ['Hasil pengiriman fakta tidak pasti; periksa channel sebelum mencoba lagi.','The facts message may or may not have been sent; check the channel before trying again.'],
  ['Gagal memeriksa atau mengirim fakta. Periksa pencarian, provider AI, kuota, sumber dan izin channel.','Could not check or send facts. Check search, AI providers, quotas, sources and channel permissions.'],
 ]);
 function factsStatus(message){
  if(window.ZentixI18n?.language!=='en'||typeof message!=='string')return message;
  const fixed=FACT_STATUS.get(message);if(fixed!==undefined)return fixed;
  const prefixes=[['Fakta campuran atau cadangan disiapkan; ','Mixed or fallback facts prepared; '],['Fakta terverifikasi AI dan cadangan umum terkirim; topik khusus tidak berlaku untuk fakta cadangan. Alasan: ','AI-checked and general fallback facts were sent; custom topics do not apply to fallback facts. Reason: '],['Lima fakta cadangan umum terkirim; topik khusus tidak diterapkan. Alasan: ','Five general fallback facts were sent; custom topics were not applied. Reason: ']];
  for(const [id,en] of prefixes){if(!message.startsWith(id))continue;const reason=message.slice(id.length);const m=/^([^.]+)\.(?: Pencarian berhasil ([0-9]{1,4})\/3; kandidat ([0-9]{1,4}); artikel terbaca ([0-9]{1,4})\/([0-9]{1,4}) \(gagal ([0-9]{1,4}), terlalu pendek ([0-9]{1,4})\)\.)?$/.exec(reason);if(!m||!FACT_REASONS.has(m[1]))return message;return en+FACT_REASONS.get(m[1])+'.'+(m[2]?` Searches succeeded ${m[2]}/3; candidates ${m[3]}; articles read ${m[4]}/${m[5]} (failed ${m[6]}, too short ${m[7]}).`:'');}
  return message;
 }
 function supportError(path,method,message,status,code){
  if(window.ZentixI18n?.language!=='en'||path!=='support/settings'||method!=='PATCH'||status!==400||code!=='INVALID_SUPPORT')return message;
  if(message==='Pengaturan bantuan tidak valid.')return 'Invalid support settings.';
  if(message==='Pilih minimal satu channel bantuan.')return 'Choose at least one support channel.';
  return message;
 }
 async function req(path, opts = {}) {
  const s=(!opts.method || opts.method==='GET')&&!opts.body?null:await window.ZentixSession;
  const r = await fetch('/dashboard/api/ai/' + path, { cache: 'no-store', ...opts, headers: opts.body ? { 'Content-Type': 'application/json', 'x-csrf-token': s.csrf } : {} });
  const b = await r.json();
  if (!r.ok) {let message=window.ZentixI18n?.aiDraftError?.(path,r.status,b.code,b.error) ?? b.error;message=supportError(path,opts.method,message,r.status,b.code);if(path.startsWith('smart/'))message=smartError(sendTestError(path,opts.method,r.status,b.code,message),r.status,b.code);if(/^smart\/usage\?days=\d+$/.test(path)&&(!opts.method||opts.method==='GET'))message=window.ZentixI18n?.aiStoredSettingsError?.(r.status,b.code,message) ?? message;throw Error((window.ZentixI18n?.accessError?.(b.error,r.status) ?? window.ZentixI18n?.aiError?.(message) ?? message) || tr('Permintaan gagal','Request failed'));}
  return b;
 }
 const row = (title, help, control) => `<label class="f-field"><span><b>${esc(title)}</b><small>${esc(help)}</small></span>${control}</label>`;
 const toggle = (name, title, help, value) => row(title, help, `<span class="f-check"><input name="${name}" type="checkbox" ${value ? 'checked' : ''}><span class="fake-switch"></span></span>`);
 const number = (name, title, help, value, min, max) => row(title, `${help} (${min}–${max})`, `<input name="${name}" type="number" min="${min}" max="${max}" value="${esc(value)}" required>`);
 const options = (map, chosen) => Object.entries(map).map(([value, label]) => `<option value="${esc(value)}" ${value === chosen ? 'selected' : ''}>${esc(label)}</option>`).join('');
 // Tick boxes instead of a multi-select: the same on a phone and on a desktop.
 const channelPicker = (name, title, help, channels, chosen, max, groupId) => {
  const known = new Set(channels.map((c) => c.id));
  const items = [...channels.map((c) => [c.id, '# ' + (c.name || tr('Channel tanpa nama','Unnamed channel')), !c.name || channels.filter(other => other.name === c.name).length > 1]), ...chosen.filter((id) => !known.has(id)).map((id) => [id, tr('ID tersimpan — tidak tersedia','Saved ID — unavailable'), true])];
  return `<fieldset class="f-field" data-picker="${name}" data-max="${max}" aria-labelledby="${groupId}Title" aria-describedby="${groupId}Help"><span><b id="${groupId}Title">${esc(title)}</b><small id="${groupId}Help">${esc(help)} ${tr('Boleh lebih dari satu, paling banyak','Multiple choices allowed, maximum')} ${max}.</small></span><div class="f-picker">${items.length ? items.map(([id, label, showId]) => `<label><input type="checkbox" name="${name}" value="${esc(id)}" aria-label="${esc(`${title}: ${label} (ID ${id})`)}" ${chosen.includes(id) ? 'checked' : ''}> ${esc(label)}${showId ? ` · ID ${esc(id)}` : ''}</label>`).join('') : `<small>${tr('Tidak ada channel teks.','No text channels.')}</small>`}</div></fieldset>`;
 };
 const actions = (note, extra = '') => `<div class="f-form-actions"><span>${esc(note)}</span><span class="f-inline">${extra}<button class="f-primary" type="submit">${tr('SIMPAN','SAVE')}</button></span></div>`;
 const panel = (title, sub, id) => `<section class="f-panel"><div class="f-panel-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div><div id="${id}">${tr('Memuat…','Loading…')}</div></section>`;
 const side = (title, sub, text) => `<section class="f-panel"><div class="f-panel-head"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div><p class="f-muted">${esc(text)}</p></section>`;

 const PAGES = {
  faq: { title: 'FAQ & cache jawaban', sub: 'Jawaban acuan dan variasi AI opsional · khusus owner bot.', aside: ['Hemat kuota', 'FAQ acuan dan cache bisa menjawab tanpa AI.', 'FAQ dicocokkan berdasarkan kata di mesin bot; jika belum cocok, pertanyaan anggota dan daftar pertanyaan FAQ dikirim ke provider AI untuk mencari kecocokan dan memakai kuota. AI dapat keliru; jika ragu atau gagal, FAQ tidak menjawab. Jawaban acuan tidak dikirim untuk pencocokan; jika variasi AI diaktifkan, jawaban acuan juga dikirim ke provider. Saat bot dipanggil (AI interaktif aktif), FAQ diperiksa lebih dulu. Dengan "Jawab otomatis", bot juga menjawab pertanyaan yang cocok di channel pilihan tanpa dipanggil; di sana kecocokan harus lebih ketat dan entri yang sama tidak diulang dalam 2 menit. Cache hanya berlaku untuk balasan AI interaktif pada pertanyaan yang sama persis (minimal 3 kata, tanpa gambar, bukan balasan lanjutan) dan hilang saat bot restart. Pertanyaan tentang diri penanya ("aku", "saya", "namaku") atau tentang obrolan sebelumnya ("tadi", "barusan"), dan jawaban yang menyebut nama penanya, tidak di-cache.'] },
  menu: { title: 'Menu pesan', sub: 'Tekan-tahan pesan → Apps · khusus owner bot.', aside: ['Cara kerja', 'Baca sebelum mengaktifkan.', 'Anggota menekan-tahan sebuah pesan (di komputer: klik kanan) lalu memilih Apps. Jawaban hanya terlihat oleh anggota itu dan memakai kuota hariannya. Teks pesan yang dipilih, yang bisa saja ditulis anggota lain, dikirim ke provider AI. Entri yang dimatikan tidak didaftarkan ke Discord. Discord mengizinkan 5 menu pesan per server, terpisah dari 100 slash command. Menu baru bisa perlu beberapa saat atau memuat ulang Discord sampai terlihat.'] },
  digest: { title: 'Koran hari ini', sub: 'Berita harian · khusus owner bot.', aside: ['Kuota & sumber', 'Baca sebelum mengaktifkan.', 'Hingga tiga edisi per hari: persiapan dimulai 15 menit sebelum jadwal, tanpa mengirim lebih awal. Tiap percobaan memakai hingga tiga pencarian web dan dua permintaan AI; jika belum siap, gagal, atau hasilnya sudah dikirim pada slot lain, bot dapat mencoba lagi dan memakai kuota serta biaya tambahan. Berita yang berhasil dikirim disaring dari riwayat tujuh hari; duplikat berbeda judul atau sumber masih mungkin lolos. Setiap slot kirim hanya dicoba sekali. Berita memerlukan kunci pencarian web (Tavily, Parallel atau Exa); tanpa kunci edisi tidak dikirim. Berita ditulis dari cuplikan hasil pencarian, bukan artikel lengkap. AI memeriksa dukungan cuplikan dan bahasa Indonesia; pemeriksaan dapat keliru dan tanggal berita tidak selalu tersedia. Jika bot mati, edisi dicoba setelah hidup kembali dalam batas keterlambatan kurang dari 60 menit pada hari lokal yang sama. Isi yang panjang memerlukan batas output AI minimal 512 token (Provider & fallback).'] },
  translate: { title: 'Terjemahan otomatis', sub: 'Per channel · khusus owner bot.', aside: ['Privasi & kuota', 'Baca sebelum mengaktifkan.', 'Pesan anggota di channel yang dipilih dikirim ke provider AI tanpa persetujuan per pesan; beri tahu anggota. Pesan yang terlihat sudah dalam bahasa tujuan, pesan pendek, link, emoji dan perintah bot dilewati tanpa permintaan AI. Teks yang sama tidak diterjemahkan dua kali dalam 24 jam. Setiap permintaan AI memakai kuota harian anggota yang menulis pesan, juga bila AI menilai pesannya tidak perlu diterjemahkan; batas per jam menghitung permintaan itu. Bot memerlukan izin melihat channel dan mengirim pesan. Bahasa tujuan default berlaku di semua channel terpilih kecuali channel yang diberi bahasa khusus. Channel dua arah menerjemahkan ke dan dari dua bahasa yang dipilih (prioritas di atas bahasa khusus dan default); bahasa lain dibiarkan. Hapus balasan otomatis menghapus balasan 🌐 sendiri setelah sekian detik, juga untuk balasan reaksi bendera (tidak bertahan melewati restart). Dengan reaksi bendera, anggota menerjemahkan satu pesan kapan pun dengan menempeli bendera bahasa yang didukung; itu memakai kuota anggota yang bereaksi dan batas per jam yang sama. Command /terjemahkan terpisah dari saklar dan channel terjemahan otomatis: anggota memilih bahasa dan memberi persetujuan untuk mengirim teks ke provider; hasilnya tampil di channel dan memakai kuota AI harian. Anggota juga bisa mengatur bahasa pribadinya dengan perintah /personal; menu Terjemahkan (tahan pesan → Apps) memakai bahasa itu, atau bahasa tujuan di tab Menu pesan bila belum diatur.'] },
  usage: { title: 'Laporan pemakaian AI', sub: 'Per hari, per jenis, per anggota · khusus owner bot.', aside: ['Yang dicatat', 'Hanya angka.', 'Saat aktif, bot mencatat jumlah permintaan AI yang dijawab provider: per hari (UTC, sama dengan reset kuota), per jenis fitur dan per anggota (ID). Isi pesan tidak dicatat. Catatan disimpan 45 hari. Pencarian web dan permintaan yang gagal tidak dihitung, jadi angkanya bisa sedikit di bawah kuota yang terpakai. Token hanya terisi bila provider melaporkannya.'] },
 };
 if(window.ZentixI18n?.language==='en') PAGES.translate = {
  title:'Automatic translation', sub:'Per channel · bot owner only.', aside:['Privacy & quota','Read before enabling.',
   'Messages in selected channels are sent to an AI provider without per-message consent; inform members. Messages that appear to be in the target language, short messages, links, emoji and bot commands are skipped without an AI request. The same text is not translated twice within 24 hours. Each AI request uses the author’s daily quota even when AI decides not to translate; the hourly limit counts that request. The bot needs permission to view channels and send messages. The default target applies to selected channels unless overridden. Bidirectional channels translate between two selected languages (taking priority over channel-specific and default targets); other languages are left alone. Auto-delete removes the bot’s own 🌐 reply after the configured number of seconds, including flag-reaction replies (timers do not survive restart). With flag reactions, a member can translate one message by adding a supported flag, using the reacting member’s quota and the same hourly limit. /terjemahkan is independent of the automatic translation switch and channels: members choose a language and consent to sending text to a provider; results appear in the channel and use the daily AI quota. Members can also set a personal language with /personal; the “Terjemahkan” message menu (hold a message → Apps) uses it, or the Message menu tab’s target if none is set.']
 };
 if(window.ZentixI18n?.language==='en') {
  PAGES.faq={title:'FAQ & answer cache',sub:'Reference answers and optional AI variation · bot owner only.',aside:['Save quota','Reference FAQ and cache can answer without AI.','FAQ matching starts with words in the bot. If no match is found, the member’s question and FAQ question list are sent to the AI provider for matching and use quota. AI may be wrong; when uncertain or failing, FAQ does not answer. Reference answers are not sent for matching; if AI variation is enabled, the reference answer is also sent. When called with interactive AI enabled, FAQ is checked first. With automatic answers, the bot also answers matches in selected channels without being called; matching there is stricter and the same entry is not repeated for 2 minutes. Cache applies only to identical interactive AI questions (at least 3 words, no image, not a follow-up) and is cleared on restart. Questions about the asker or prior conversation, and answers containing the asker’s name, are not cached.']};
  PAGES.digest={title:'Daily newspaper',sub:'Daily news · bot owner only.',aside:['Quota & sources','Read before enabling.','Up to three editions per day: preparation starts 15 minutes before the scheduled time and is never sent early. Each attempt uses up to three web searches and two AI requests; if it is not ready, fails, or the result was already sent in another slot, the bot may retry and use additional quota and cost. Successfully sent news is filtered against seven days of history; duplicates with different titles or sources may still pass. Each send slot is attempted only once. News requires a web search key (Tavily, Parallel or Exa); without a key, the edition is not sent. News is written from search snippets, not full articles. AI checks snippet support and Indonesian language; checks can be wrong and publication dates are not always available. If the bot is down, the edition is attempted after it restarts within a delay of less than 60 minutes on the same local day. Long content requires an AI output limit of at least 512 tokens (Provider & fallback).']};
  PAGES.menu={title:'Message menus',sub:'Hold a message → Apps · bot owner only.',aside:['How it works','Read before enabling.','Members hold a message (or right-click on desktop), then choose Apps. The answer is visible only to that member and uses their daily quota. The selected message text, which may have been written by another member, is sent to the AI provider. Disabled entries are not registered with Discord. Discord allows 5 message menus per server, separate from 100 slash commands. New menus may take time or require reloading Discord to appear.']};
  PAGES.usage={title:'AI usage report',sub:'Per day, type and member · bot owner only.',aside:['What is recorded','Numbers only.','When enabled, the bot records counts of AI requests answered by a provider: per UTC day (the quota reset), feature type and member ID. Message contents are not recorded. Records are kept for 45 days. Web searches and failed requests are not counted, so totals may be slightly below quota consumed. Tokens are recorded only if the provider reports them.']};
 }
 const englishLanguages={id:'Indonesian',en:'English',ja:'Japanese',ko:'Korean',zh:'Mandarin Chinese',ar:'Arabic',fr:'French',de:'German',es:'Spanish',it:'Italian',pt:'Portuguese',ru:'Russian',nl:'Dutch',tr:'Turkish',pl:'Polish',uk:'Ukrainian',cs:'Czech',ro:'Romanian',hu:'Hungarian',el:'Greek',th:'Thai',vi:'Vietnamese',ms:'Malay',sv:'Swedish'};
 const languageOptions=(map,chosen)=>options(window.ZentixI18n?.language==='en'?Object.fromEntries(Object.entries(map).map(([key,label])=>[key,englishLanguages[key]||label])):map,chosen);
 const KINDS = { reply: 'Balasan saat dipanggil', join: 'Nimbrung', gallery: 'Komentar galeri', idle: 'Sapaan saat sepi', link: 'Rangkum link', search: 'Cari berita', recap: 'Rangkum obrolan', 'menu-translate': 'Menu: terjemahkan', 'menu-explain': 'Menu: jelaskan', 'menu-fact': 'Menu: cek fakta', support: 'Bantuan troubleshooting', faq: 'Variasi jawaban FAQ', 'faq-match': 'Pencocokan FAQ', announcement: 'Draf pengumuman', 'bug-draft': 'Draf laporan bug', 'faq-suggestion': 'Saran pertanyaan FAQ', digest: 'Koran hari ini', 'digest-check': 'Pemeriksaan koran', facts: 'Fakta hari ini', 'facts-check': 'Pemeriksaan fakta', 'facts-translate': 'Terjemahan fakta', 'auto-translate': 'Terjemahan otomatis', 'slash-translate': '/terjemahkan', aichat: '/aichat', icebreaker: 'Icebreaker harian', welcome: 'AI Welcome', goodbye: 'AI Goodbye', activity: 'Activities', trivia: 'Trivia', builder: 'Server builder', knowledge: 'Pengetahuan', tools: 'AI tools', research: 'Riset web', ocr: 'Baca teks gambar', test: 'Uji koneksi', other: 'Lainnya' };
 if(window.ZentixI18n?.language==='en') Object.assign(KINDS, {reply:'Reply when called',join:'Join conversation',gallery:'Gallery comment',idle:'Quiet-channel greeting',link:'Summarize link',search:'Search news',recap:'Conversation recap','menu-translate':'Menu: translate','menu-explain':'Menu: explain','menu-fact':'Menu: fact check',support:'Troubleshooting assistance',faq:'FAQ answer variation','faq-match':'FAQ matching',announcement:'Announcement draft','bug-draft':'Bug report draft','faq-suggestion':'FAQ suggestion',digest:'Daily newspaper','digest-check':'Newspaper check',facts:'Daily facts','facts-check':'Facts check','facts-translate':'Facts translation','auto-translate':'Automatic translation',icebreaker:'Daily icebreaker',knowledge:'Knowledge',research:'Web research',ocr:'Read image text',test:'Connection test',other:'Other'});
 const ZONES = { WIB: 'WIB', WITA: 'WITA', WIT: 'WIT' };

 function render(tab) {
  const page = PAGES[tab] || PAGES.faq;
  return `<div class="f-layout"><div>${panel(page.title, page.sub, 'aiSmart')}</div><aside>${tab==='digest'?panel(tr('Fakta hari ini','Facts today'),tr('Pengaturan terpisah · lima fun facts ringan dalam satu pesan.','Separate settings · five light fun facts in one message.'),'aiFacts'):''}${side(...page.aside)}</aside></div>`;
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
   try{return JSON.parse(input)}catch{throw Error(tr('JSON tidak valid. Untuk TXT, mulai setiap pasangan dengan Q: lalu A:.','Invalid JSON. For TXT, start each pair with Q: then A:.'))}
  }
  return input.split(/\n[ \t]*\n+/).map((block,i)=>{
   const lines=block.split('\n'),question=lines[0]?.match(/^Q\s*:\s*(.*)$/i),answer=lines[1]?.match(/^A\s*:\s*(.*)$/i);
   if(!question||!answer||lines.slice(2).some(line=>/^[ \t]*[QA]\s*:/i.test(line)))throw Error(`${tr('Pasangan TXT','TXT pair')} ${i+1} ${tr('tidak valid. Gunakan Q: dan A:, lalu baris kosong sebelum pasangan berikutnya.','is invalid. Use Q: and A:, then a blank line before the next pair.')}`);
   return {question:question[1],answer:[answer[1],...lines.slice(2)].join('\n')};
  });
 }

 function bind(root, tab, notify) {
  const slot = root.querySelector('#aiSmart');
  if (!slot) return;
  const name = PAGES[tab] ? tab : 'faq';
  // FAQ and support settings are independent reads. Start both together, but
  // keep their errors separate so one unavailable section does not hide the other.
  const support = name==='faq' ? req('support/settings').then(value=>({value}),error=>({error})) : null;
  const factsStatusRequest = name==='digest' ? req('smart/facts/status').then(value=>({value}),error=>({error})) : null;
  req(name==='translate'?'smart/translate/settings':'smart').then((data) => { if (slot.isConnected) {views[name](slot, data, notify, support);if(name==='digest')factsView(root,data,notify,factsStatusRequest);} }).catch((e) => { if (slot.isConnected) slot.textContent = e.message; });
 }

 /** Wires a form: checks the pickers, sends `body()` as PATCH smart/<section>, reports the outcome. */
 function wire(form, section, body, notify, done) {
  const picked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((x) => x.value);
  form.onsubmit = async (e) => {
   e.preventDefault();
   for (const set of form.querySelectorAll('[data-picker]')) {
    if (picked(set.dataset.picker).length > Number(set.dataset.max)) { notify(`${set.querySelector('b').textContent}: ${tr(`paling banyak ${set.dataset.max} channel.`,`maximum ${set.dataset.max} ${Number(set.dataset.max)===1?'channel':'channels'}.`)}`); return; }
   }
   const btn = form.querySelector('button[type=submit]');
   btn.disabled = true;
   try { const out = await req('smart/' + section, { method: 'PATCH', body: JSON.stringify(body(form.elements, picked)) }); done(out); }
   catch (err) { notify(err.message); }
   finally { btn.disabled = false; }
  };
 }

 // The facts service stores UTC ISO timestamps. Keep malformed or unfamiliar values unchanged.
 function factsTime(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return value;
  const date=new Date(value);return Number.isNaN(date.getTime())||date.toISOString()!==value?value:date.toLocaleString(tr('id-ID','en-US'),{hour12:false});
 }
 function factsPreparationState(state){
  const labels={working:tr('sedang berlangsung','in progress'),ready:tr('siap','ready'),failed:tr('gagal','failed'),blocked:tr('ditolak akses atau persetujuan','access or consent denied')};
  return Object.hasOwn(labels,state)?labels[state]:state||tr('tidak tersedia','unavailable');
 }
 function factsView(root,data,notify,initialStatus) {
  const slot=root.querySelector('#aiFacts');if(!slot)return;const s=data.settings.facts || {enabled:false,channelId:null,times:['07:00'],zone:'WIB',topics:''};
  const channels=[['',tr('Pilih channel','Select a channel')],...data.channels.map(c=>[c.id,`# ${c.name}${data.channels.filter(x=>x.name===c.name).length>1?` · ID ${c.id}`:''}`])];if(s.channelId&&!data.channels.some(c=>c.id===s.channelId))channels.push([s.channelId,`${tr('ID tersimpan — tidak tersedia','Saved ID — unavailable')} · ${s.channelId}`]);
  slot.innerHTML=`<p class="f-muted">${tr('Terpisah dari Koran hari ini. Bot mencari artikel dari situs terpilih, termasuk Wikipedia, Britannica, Smithsonian, NASA dan NOAA. Jika topik kosong, tiga negara diundi tanpa pengulangan hingga daftar 197 negara dan wilayah habis. Hasil tetap bergantung pada sumber yang terbaca, jadi negara yang diundi belum tentu muncul dalam fakta. Urutan situs dirotasi dan sumber yang baru dipakai dikurangi prioritasnya. Situs berbeda diutamakan jika cukup artikel terbaca, tetapi variasi tidak dijamin. Persiapan dimulai hingga 15 menit sebelum jadwal, tanpa mengirim lebih awal. Maksimal 3 pencarian dan 14 permintaan AI per percobaan; persiapan yang macet dapat diulang sekali, sehingga kuota dan biaya bisa bertambah; provider cadangan dapat dicoba jika hasil kosong atau gagal dan dapat menambah biaya. AI menerjemahkan ke bahasa Indonesia dan memeriksa bahasa, kesetaraan makna serta klaim terhadap artikel; pemeriksaan bisa keliru; artikel tidak selalu baru atau memuat temuan terbaru. Fakta yang lolos dipertahankan dan dicoba penggantinya sekali; kekurangan dilengkapi fakta cadangan umum. Topik khusus tidak berlaku untuk cadangan. Jika bot offline atau persiapan belum siap saat jadwal, bot memakai cadangan. Artikel dikirim ke provider AI.','Separate from the daily newspaper. The bot searches selected sites including Wikipedia, Britannica, Smithsonian, NASA and NOAA. With no topic, three countries are drawn without repetition until the list of 197 countries and territories is exhausted. Results depend on readable sources, so drawn countries may not appear in the facts. Site order rotates and recently used sources are deprioritized. Different sites are preferred when enough articles are readable, but variety is not guaranteed. Preparation starts up to 15 minutes before schedule without sending early. Each attempt uses up to 3 searches and 14 AI requests; stalled preparation can be retried once, increasing quota and cost. Fallback providers may be tried on empty results or failure and add cost. AI translates into Indonesian and checks language, meaning and claims against articles; checks may be wrong and articles are not necessarily new or up to date. Passing facts are retained and replacements attempted once; gaps use general fallback facts. Custom topics do not apply to fallback. If the bot is offline or preparation is not ready at the scheduled time, the bot uses fallback. Articles are sent to the AI provider.')} ${data.search.configured ? tr('Kunci pencarian tersedia (bukan tes koneksi).','Search key available (not a connection test).') : tr('Kunci pencarian belum tersedia; hanya paket yang disiapkan sebelumnya dapat dikirim.','Search key unavailable; only previously prepared packages can be sent.')}</p><form id="aiFactsForm" class="f-form">${toggle('enabled',tr('Aktifkan fakta harian','Enable daily facts'),tr('Kirim lima fun facts ringan untuk setiap waktu yang disimpan.','Send five light fun facts for each saved time.'),s.enabled)}${row(tr('Channel fakta','Facts channel'),tr('Pilih satu channel teks.','Choose one text channel.'),`<select name="channelId">${channels.map(([id,name])=>`<option value="${esc(id)}" ${id===(s.channelId||'')?'selected':''}>${esc(name)}</option>`).join('')}</select>`)}${[0,1,2].map(i=>row(`${tr('Waktu','Time')} ${i+1}`,i===0?tr('Wajib diisi.','Required.'):tr('Opsional; kosongkan jika tidak digunakan.','Optional; leave empty if unused.'),`<input name="time${i+1}" type="time" value="${esc(s.times?.[i]||'')}" ${i===0?'required':''}>`)).join('')}${row(tr('Zona waktu','Time zone'),tr('Berlaku untuk ketiga waktu.','Applies to all three times.'),`<select name="zone">${options(ZONES,s.zone)}</select>`)}${row(tr('Topik','Topics'),tr('Opsional, paling banyak 120 karakter. Kosong = topik umum.','Optional, up to 120 characters. Empty = general topics.'),`<input name="topics" type="text" maxlength="120" value="${esc(s.topics)}" placeholder="${tr('mis. sains, sejarah, alam','e.g. science, history, nature')}">`)}${actions(tr('SIMPAN SEBELUM TES','SAVE BEFORE TESTING'),`<button class="f-outline" type="button" id="aiFactsTest">${tr('KIRIM TES KE DISCORD','SEND TEST TO DISCORD')}</button> `)}</form><p class="f-muted" id="aiFactsStatus" role="status">${tr('Memeriksa status terakhir…','Checking latest status…')}</p><div id="aiFactsEvidence" class="f-muted"></div><p class="f-muted">${tr('Tes menggunakan pengaturan tersimpan, mengirim pesan sungguhan tanpa ping dan dapat memakai kuota. Bot harus online; jadwal terlambat maksimal 60 menit. Maksimal tiga waktu berbeda per hari; satu percobaan per waktu, termasuk jika gagal.','Tests use saved settings, send a real message without pings and may use quota. The bot must be online; scheduled lateness is at most 60 minutes. Up to three distinct times per day; one attempt per time, including failures.')}</p>`;
  const form=slot.querySelector('form'),out=slot.querySelector('#aiFactsStatus');
  let statusGeneration=0;
  async function refresh(prefetched){const current=++statusGeneration;try{const result=prefetched ? await prefetched : {value:await req('smart/facts/status')};if(result.error)throw result.error;const data=result.value;if(!out.isConnected||current!==statusGeneration)return;const x=data.status,evidence=slot.querySelector('#aiFactsEvidence');out.textContent=x?`${tr('Terakhir','Last')} (${x.mode==='test'?tr('tes','test'):x.mode==='schedule'?tr('jadwal','schedule')+(x.slot?' '+x.slot:''):String(x.mode??tr('tidak tersedia','unavailable'))}, ${factsTime(x.at)}): ${factsStatus(x.message)}`:tr('Belum ada percobaan fakta yang tercatat.','No facts attempts recorded yet.');if(data.preparation?.length)out.textContent+=tr(' Persiapan: ',' Preparation: ')+data.preparation.map(p=>p.slot+' '+factsPreparationState(p.state)+(p.source==='mixed'?tr(' (campuran)',' (mixed)'):p.source==='fallback'?tr(' (cadangan)',' (fallback)'):p.source==='ai'?tr(' (AI diperiksa)',' (AI checked)'):'')).join(', ')+'.';evidence.replaceChildren();if(Array.isArray(x?.evidence)){const heading=document.createElement('p');heading.textContent=tr('Sumber fakta terakhir (hanya dashboard owner; bukan jaminan kebenaran):','Latest fact sources (owner dashboard only; not a guarantee of accuracy):');evidence.append(heading);for(const item of x.evidence){const p=document.createElement('p');p.textContent=String(item.fact||'')+(item.origin==='fallback'?tr(' (cadangan)',' (fallback)'):item.origin==='ai'?tr(' (AI diperiksa)',' (AI checked)'):'')+' — ';for(const raw of Array.isArray(item.urls)?item.urls:[]){try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)continue;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=u.hostname;p.append(a,document.createTextNode(' '))}catch{}}evidence.append(p)}}}catch(e){if(out.isConnected&&current===statusGeneration)out.textContent=tr('Status fakta tidak tersedia: ','Facts status unavailable: ')+e.message}}
  wire(form,'facts',x=>({enabled:x.enabled.checked,channelId:x.channelId.value||null,times:[x.time1.value,x.time2.value,x.time3.value].filter(Boolean),zone:x.zone.value,topics:x.topics.value}),notify,()=>notify(tr('Pengaturan fakta disimpan.','Facts settings saved.')));
  const test=slot.querySelector('#aiFactsTest');test.addEventListener('click',async()=>{if(!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Kirim tes lima fakta ke channel tersimpan? Ini memakai hingga 3 pencarian dan 14 permintaan AI; dapat menggunakan paket fakta yang disiapkan sebelumnya. Teks artikel dikirim ke provider AI; pesan Discord tanpa ping.','Send a five-fact test to the saved channel? This uses up to 3 searches and 14 AI requests and may use a previously prepared facts package. Article text is sent to the AI provider; the Discord message has no pings.')) : Promise.resolve(window.confirm(tr('Kirim tes lima fakta ke channel tersimpan? Ini memakai hingga 3 pencarian dan 14 permintaan AI; dapat menggunakan paket fakta yang disiapkan sebelumnya. Teks artikel dikirim ke provider AI; pesan Discord tanpa ping.','Send a five-fact test to the saved channel? This uses up to 3 searches and 14 AI requests and may use a previously prepared facts package. Article text is sent to the AI provider; the Discord message has no pings.'))))))return;test.disabled=true;try{const result=await req('smart/facts/test',{method:'POST',body:JSON.stringify({confirmed:true})});notify(`${tr('Tes fakta terkirim ke','Facts test sent to')} ${result.sent} ${tr('channel.','channels.')}`)}catch(e){notify(e.message)}finally{test.disabled=false;await refresh()}});refresh(initialStatus);
 }

 const views = {
  faq(slot, data, notify, initialSupport) {
   let { faq, cache } = data.settings;
   const max = data.limits.faqEntries;
   const draw = () => {
    slot.innerHTML = `<form id="aiFaqForm" class="f-form">${toggle('enabled', tr('Aktifkan FAQ','Enable FAQ'), tr('Pertanyaan yang cocok dijawab dari daftar. Jika pencocokan kata gagal, AI mencoba memilih FAQ dan menggunakan kuota.','Matching questions are answered from the list. If word matching fails, AI attempts to select an FAQ and uses quota.'), faq.enabled)}${toggle('varyWithAI', tr('Variasikan jawaban dengan AI','Vary answers with AI'), tr('Opsional: jawaban acuan dikirim ke provider dan memakai kuota. AI bisa keliru; jawaban acuan tetap ditampilkan. Jika gagal, gunakan jawaban asli.','Optional: the reference answer is sent to the provider and uses quota. AI may be wrong; the reference answer is still shown. On failure, use the original answer.'), faq.varyWithAI)}${toggle('autoAnswer', tr('Jawab otomatis tanpa dipanggil','Answer automatically without being called'), tr('Di channel pilihan, pertanyaan anggota dapat dikirim ke provider AI untuk dicocokkan dengan FAQ dan memakai kuota, walau bot tidak dipanggil.','In selected channels, member questions may be sent to the AI provider to match FAQs and use quota, even when the bot is not called.'), faq.autoAnswer)}${channelPicker('channelIds', tr('Channel jawab otomatis','Automatic-answer channels'), tr('Tempat bot menjawab FAQ tanpa dipanggil.','Where the bot answers FAQs without being called.'), data.channels, faq.channelIds, data.limits.channels, 'faqChannels')}${actions(tr('BERLAKU PADA PESAN BERIKUTNYA','APPLIES TO FUTURE MESSAGES'))}</form>
     <details class="faq-import"><summary>${tr('Asisten troubleshooting otomatis','Automatic troubleshooting assistant')}</summary><p class="f-muted">${tr('Opsional untuk channel bantuan yang dipilih. Pertanyaan terkait masalah bot dapat dikirim ke provider AI dan memakai kuota tanpa mention. Beri tahu anggota. Jangan bagikan token, API key, password, isi .env, URL database atau webhook; penyaringan rahasia tidak sempurna. Konteks pertanyaan awal disimpan sementara di memori hingga 10 menit untuk balasan ke bot dan hilang saat restart. AI bisa salah; FAQ acuan didahulukan.','Optional for selected support channels. Bot troubleshooting questions may be sent to the AI provider and use quota without a mention. Inform members. Do not share tokens, API keys, passwords, .env contents, database URLs or webhooks; secret filtering is imperfect. Initial question context is kept in memory for up to 10 minutes for replies to the bot and is cleared on restart. AI replies are requested in Indonesian and can be wrong; reference FAQs take priority.')}</p><div id="supportSettings">${tr('Memuat…','Loading…')}</div></details>
     <h3 class="s-head">${tr('Daftar FAQ ','FAQ list ')}<small>${faq.entries.length} ${tr('dari','of')} ${max}</small></h3>
     <div class="s-list">${faq.entries.length ? faq.entries.map((entry, index) => `<div class="s-item"><div><b>${esc(entry.question)}</b><p>${esc(entry.answer)}</p></div><button type="button" class="f-outline" aria-label="${esc(`${tr('Hapus FAQ','Remove FAQ')} ${index + 1}: ${entry.question}`)}" data-faq-remove="${esc(entry.id)}">${tr('HAPUS','REMOVE')}</button></div>`).join('') : `<p class="f-muted">${tr('Belum ada entri. Tambahkan pertanyaan yang sering muncul di server Anda.','No entries yet. Add frequently asked questions from your server.')}</p>`}</div>
     <details class="faq-import"><summary>${tr('Saran FAQ dari pertanyaan pilihan','FAQ suggestions from selected questions')}</summary><p class="f-muted">${tr('Pilih pesan secara manual dari Discord, sensor data pribadi atau rahasia, lalu tempel di sini. Tidak ada pengumpulan otomatis. Pertanyaan dikirim ke provider AI dan memakai kuota. Periksa dan sunting hasil; tulis jawaban sendiri sebelum menyimpan.','Manually select a Discord message, redact private data or secrets, then paste it here. There is no automatic collection. The question is sent to an AI provider and uses quota. The suggestion is requested in Indonesian. Review and edit the result; write your own answer before saving.')}</p><label class="f-field"><span><b>${tr('Pertanyaan yang dipilih','Selected question')}</b></span><textarea id="faqCandidate" rows="3" maxlength="600"></textarea></label><div class="f-inline"><button type="button" class="f-outline" id="faqSuggest">${tr('BUAT SARAN','CREATE SUGGESTION')}</button></div><p class="f-muted" id="faqSuggestStatus" role="status"></p></details>
     <form id="aiFaqAddForm" class="f-form">${row(tr('Pertanyaan','Question'), tr('Tulis seperti anggota bertanya, 3–150 karakter. Kata-kata pentingnya yang dicocokkan.','Write it as a member would ask, 3–150 characters. Important words are matched.'), tr('<input name="question" type="text" minlength="3" maxlength="150" required placeholder="mis. Bagaimana cara dapat role member?">','<input name="question" type="text" minlength="3" maxlength="150" required placeholder="e.g. How do I get the member role?">'))}${row(tr('Jawaban','Answer'), tr('Dikirim apa adanya, 1–800 karakter. Mention di dalamnya tidak memanggil siapa pun.','Sent as written, 1–800 characters. Mentions do not ping anyone.'), '<textarea name="answer" rows="3" maxlength="800" required></textarea>')}<div class="f-form-actions"><span>${tr('LANGSUNG TERSIMPAN','SAVED IMMEDIATELY')}</span><button class="f-primary" type="submit" ${faq.entries.length >= max ? 'disabled' : ''}>${tr('TAMBAH ENTRI','ADD ENTRY')}</button></div></form>
     <details class="faq-import"><summary>${tr('Impor FAQ dari JSON / TXT','Import FAQ from JSON / TXT')}</summary><p class="f-muted">${tr('Pilih file atau tempel JSON berupa array dengan','Choose a file or paste a JSON array with')} <code>question</code> ${tr('dan','and')} <code>answer</code>, ${tr('atau TXT dengan pasangan','or TXT with')} <code>Q:</code> ${tr('dan','and')} <code>A:</code> ${tr('dipisah satu baris kosong. Pratinjau dulu; entri baru ditambahkan, FAQ lama dan pengaturan tetap ada. Maksimal','pairs separated by a blank line. Preview first; new entries are added and existing FAQs and settings remain. Maximum')} ${max} ${tr('entri total, file maksimal 64 KB.','entries total; file maximum 64 KB.')}</p><p class="f-muted">${tr('Contoh:','Example:')} ${tr('<code>[{"question":"Bagaimana cara bergabung?","answer":"Baca panduan server."}]</code>','<code>[{"question":"How do I join?","answer":"Read the server guide."}]</code>')}</p><p class="f-muted">${tr('Contoh TXT:','TXT example:')} <code>${tr('Q: Bagaimana cara bergabung?','Q: How do I join?')}</code> ${tr('lalu di baris berikutnya','then on the next line')} <code>${tr('A: Baca panduan server.','A: Read the server guide.')}</code> ${tr('Pisahkan pasangan dengan baris kosong. Jawaban boleh beberapa baris.','Separate pairs with a blank line. Answers can span multiple lines.')}</p><label class="f-field"><span><b>${tr('File JSON / TXT','JSON / TXT file')}</b><small>${tr('Pilih file UTF-8 .json atau .txt.','Choose a UTF-8 .json or .txt file.')}</small></span><input type="file" id="faqImportFile" accept=".json,.txt,application/json,text/plain"></label><label class="f-field"><span><b>${tr('Atau tempel JSON / TXT','Or paste JSON / TXT')}</b><small>${tr('Data hanya dipakai untuk membuat FAQ, bukan dokumen rujukan AI.','Data is used only to create FAQs, not as AI reference documents.')}</small></span><textarea id="faqImportText" rows="5" spellcheck="false" placeholder="${tr('Tempel JSON atau TXT FAQ di sini','Paste FAQ JSON or TXT here')}"></textarea></label><div class="f-inline"><button class="f-outline" type="button" id="faqImportPreview">${tr('PRATINJAU','PREVIEW')}</button><button class="f-primary" type="button" id="faqImportSave" disabled>${tr('IMPOR FAQ','IMPORT FAQ')}</button></div><p class="f-muted" id="faqImportStatus" role="status"></p><div id="faqImportResult"></div></details>
     <h3 class="s-head">${tr('Cache jawaban','Answer cache')}</h3>
     <form id="aiCacheForm" class="f-form">${toggle('enabled', tr('Aktifkan cache jawaban','Enable answer cache'), tr('Pertanyaan yang sama kepada AI interaktif dalam rentang waktu ini memakai jawaban sebelumnya, tanpa kuota.','Identical questions to interactive AI within this period reuse the previous answer without quota.'), cache.enabled)}${number('minutes', tr('Lama cache (menit)','Cache duration (minutes)'), tr('Sejak jawaban dibuat','Since the answer was created'), cache.minutes, 1, 120)}${actions(tr('BERLAKU PADA PESAN BERIKUTNYA','APPLIES TO FUTURE MESSAGES'))}</form>`;
    const supportSlot=slot.querySelector('#supportSettings');
    const supportRequest=initialSupport ? initialSupport.then(result=>{if(result.error)throw result.error;return result.value}) : req('support/settings');
    initialSupport=null;
    supportRequest.then(({settings:s})=>{
     if(!supportSlot.isConnected)return;
     supportSlot.innerHTML=`<form id="supportForm" class="f-form">${toggle('enabled',tr('Aktifkan asisten bantuan','Enable support assistant'),tr('AI dapat membaca pertanyaan masalah di channel pilihan dan mengirimnya ke provider.','AI can read troubleshooting questions in selected channels and send them to the provider.'),s.enabled)}${channelPicker('channelIds',tr('Channel bantuan','Support channels'),tr('Pilih hanya channel yang diberi tahu tentang penggunaan AI.','Select only channels informed about AI use.'),data.channels,s.channelIds,data.limits.channels,'supportChannels')}<div class="f-form-actions"><button type="submit" class="f-primary">${tr('SIMPAN BANTUAN','SAVE SUPPORT')}</button></div></form>`;
     const form=supportSlot.querySelector('#supportForm');form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const channelIds=[...form.querySelectorAll('input[name="channelIds"]:checked')].map(x=>x.value);await req('support/settings',{method:'PATCH',body:JSON.stringify({enabled:form.elements.enabled.checked,channelIds})});notify(tr('Pengaturan bantuan disimpan.','Support settings saved.'))}catch(e){notify(e.message)}finally{button.disabled=false}};
    }).catch(()=>{if(supportSlot.isConnected)supportSlot.textContent=tr('Pengaturan bantuan tidak tersedia.','Support settings unavailable.')});
    const saveFaq = async (next, message) => {
     try { faq = (await req('smart/faq', { method: 'PATCH', body: JSON.stringify(next) })).settings.faq; notify(message); draw(); }
     catch (err) { notify(err.message); }
    };
    wire(slot.querySelector('#aiFaqForm'), 'faq', (x, picked) => ({ enabled: x.enabled.checked, autoAnswer: x.autoAnswer.checked, varyWithAI: x.varyWithAI.checked, channelIds: picked('channelIds'), entries: faq.entries }), notify, (out) => { faq = out.settings.faq; notify(tr('Pengaturan FAQ disimpan.','FAQ settings saved.')); });
    slot.querySelector('#faqSuggest').onclick=async()=>{
     const candidate=slot.querySelector('#faqCandidate').value.trim(),status=slot.querySelector('#faqSuggestStatus'),button=slot.querySelector('#faqSuggest'),form=slot.querySelector('#aiFaqAddForm');
     if(candidate.length<3){status.textContent=tr('Tempel pertanyaan pilihan (minimal 3 karakter).','Paste the selected question (at least 3 characters).');return;}
     if(!(await (window.ZentixDialog?window.ZentixDialog.confirm(tr('Kirim pertanyaan pilihan ke provider AI? Ini memakai kuota.','Send the selected question to the AI provider? This uses quota.')):Promise.resolve(window.confirm(tr('Kirim pertanyaan pilihan ke provider AI? Ini memakai kuota.','Send the selected question to the AI provider? This uses quota.'))))))return;
     const previous=form.elements.question.value;button.disabled=true;status.textContent=tr('Membuat saran…','Creating suggestion…');
     try{const result=await req('faq-question-draft',{method:'POST',body:JSON.stringify({confirmed:true,question:candidate})});if(!form.isConnected)return;if(form.elements.question.value!==previous){status.textContent=tr('Pertanyaan di formulir berubah; saran tidak menggantinya.','The form question changed; the suggestion will not replace it.');return;}
      if(previous.trim()&&!(await (window.ZentixDialog?window.ZentixDialog.confirm(tr('Ganti pertanyaan pada formulir dengan saran ini?','Replace the form question with this suggestion?')):Promise.resolve(window.confirm(tr('Ganti pertanyaan pada formulir dengan saran ini?','Replace the form question with this suggestion?'))))))return;
      if(form.elements.question.value!==previous){status.textContent=tr('Pertanyaan berubah; saran tidak menggantinya.','The question changed; the suggestion will not replace it.');return;}form.elements.question.value=result.question;status.textContent=tr('Saran siap diperiksa. Tulis jawaban dan tekan TAMBAH ENTRI untuk menyimpan.','Suggestion ready for review. Write an answer and press ADD ENTRY to save.');
     }catch(e){if(status.isConnected)status.textContent=e.message}finally{button.disabled=false}
    };
    slot.querySelector('#aiFaqAddForm').onsubmit = (e) => {
     e.preventDefault();
     const x = e.target.elements, question = x.question.value.trim(), answer = x.answer.value.trim();
     if (question.length < 3 || !answer) { notify(tr('Isi pertanyaan (minimal 3 karakter) dan jawabannya.','Enter a question (at least 3 characters) and its answer.')); return; }
     if (faq.entries.length >= max) { notify(`${tr('FAQ paling banyak','Maximum FAQ entries:')} ${max}.`); return; }
     saveFaq({ ...faq, entries: [...faq.entries, { id: entryId(question, new Set(faq.entries.map((entry) => entry.id))), question, answer }] }, tr('Entri FAQ ditambahkan.','FAQ entry added.'));
    };
    slot.querySelectorAll('[data-faq-remove]').forEach((button) => button.addEventListener('click', () => saveFaq({ ...faq, entries: faq.entries.filter((entry) => entry.id !== button.dataset.faqRemove) }, tr('Entri FAQ dihapus.','FAQ entry removed.'))));
    const file=slot.querySelector('#faqImportFile'), text=slot.querySelector('#faqImportText'), preview=slot.querySelector('#faqImportResult'), importStatus=slot.querySelector('#faqImportStatus'), importButton=slot.querySelector('#faqImportSave');
    let draft=null, revision=0;
    const resetImport=()=>{revision++;draft=null;importButton.disabled=true;preview.replaceChildren();importStatus.textContent='';};
    text.addEventListener('input',resetImport);
    file.addEventListener('change',()=>{
     resetImport();text.value='';const selected=file.files?.[0];file.value='';if(!selected)return;
     if(selected.size>64*1024){importStatus.textContent=tr('File maksimal 64 KB.','File maximum is 64 KB.');return;}
     const stamp=revision,reader=new FileReader();reader.onload=()=>{if(stamp!==revision||!slot.isConnected)return;text.value=String(reader.result||'');importStatus.textContent=tr('File dibaca. Tekan PRATINJAU untuk memeriksa.','File read. Press PREVIEW to inspect it.');};reader.onerror=()=>{if(stamp===revision)importStatus.textContent=tr('File tidak dapat dibaca.','Could not read the file.')};reader.readAsText(selected,'UTF-8');
    });
    slot.querySelector('#faqImportPreview').addEventListener('click',()=>{
     resetImport();try{
      if(new Blob([text.value]).size>64*1024)throw Error(tr('File atau teks maksimal 64 KB.','File or text maximum is 64 KB.'));
      const items=parseFaqImport(text.value);
      if(!Array.isArray(items)||!items.length||items.length>max)throw Error(`${tr('File harus berisi','File must contain')} 1–${max} FAQ; ${tr('JSON harus berupa array.','JSON must be an array.')}`);
      if(faq.entries.length+items.length>max)throw Error(`${tr('FAQ maksimal','Maximum FAQ entries:')} ${max} ${tr('entri termasuk yang sudah ada.','including existing entries.')}`);
      const questions=new Set(faq.entries.map(e=>e.question.toLocaleLowerCase('id')));
      const entries=items.map((item,i)=>{
       if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).length!==2||typeof item.question!=='string'||typeof item.answer!=='string')throw Error(`${tr('Entri','Entry')} ${i+1} ${tr('harus berisi question dan answer berupa teks.','must contain question and answer as text.')}`);
       const question=item.question.replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim(),answer=item.answer.trim();
       if(question.length<3||question.length>150||!answer||answer.length>800)throw Error(`${tr('Entri','Entry')} ${i+1}: ${tr('pertanyaan 3–150 dan jawaban 1–800 karakter.','question 3–150 and answer 1–800 characters.')}`);
       const key=question.toLocaleLowerCase('id');if(questions.has(key))throw Error(`${tr('Entri','Entry')} ${i+1}: ${tr('pertanyaan sama dengan entri lain atau FAQ tersimpan.','question duplicates another entry or saved FAQ.')}`);questions.add(key);return {question,answer};
      });
      draft={entries,expected:JSON.parse(JSON.stringify(faq))};
      preview.innerHTML=`<p class="f-muted">${entries.length} ${tr('entri baru','new entries')} · ${faq.entries.length} ${tr('tersimpan','saved')} · ${faq.entries.length+entries.length}/${max} total</p><div class="s-list">${entries.map(e=>`<div class="s-item"><div><b>${esc(e.question)}</b><p style="white-space:pre-wrap">${esc(e.answer)}</p></div></div>`).join('')}</div>`;
      importStatus.textContent=tr('Pratinjau siap. Belum ada data yang disimpan.','Preview ready. No data has been saved.');importButton.disabled=false;
     }catch(error){importStatus.textContent=error.message;}
    });
    importButton.addEventListener('click',async()=>{
     if(!draft)return;const current=draft,stamp=revision;importButton.disabled=true;
     try{
      const ok=await (window.ZentixDialog?window.ZentixDialog.confirm(`${tr('Tambahkan','Add')} ${current.entries.length} FAQ? ${tr('Entri dan pengaturan yang sudah ada tidak dihapus.','Existing entries and settings will not be deleted.')}`):Promise.resolve(window.confirm(`${tr('Tambahkan','Add')} ${current.entries.length} FAQ? ${tr('Entri dan pengaturan yang sudah ada tidak dihapus.','Existing entries and settings will not be deleted.')}`)));
      if(!ok||revision!==stamp||!slot.isConnected)return;
      const out=await req('smart/faq/import',{method:'POST',body:JSON.stringify({confirmed:true,entries:current.entries,expected:current.expected})});
      faq=out.settings.faq;notify(`${current.entries.length} ${tr('FAQ berhasil diimpor.','FAQs imported successfully.')}`);draw();
     }catch(error){importStatus.textContent=error.message;notify(error.message);}
     finally{if(draft===current&&slot.isConnected)importButton.disabled=false;}
    });
    wire(slot.querySelector('#aiCacheForm'), 'cache', (x) => ({ enabled: x.enabled.checked, minutes: Number(x.minutes.value) }), notify, (out) => { cache = out.settings.cache; notify(tr('Pengaturan cache disimpan.','Cache settings saved.')); });
   };
   draw();
  },

  menu(slot, data, notify) {
   const s = data.settings.menu;
   const help = { translate: tr('Menerjemahkan pesan yang dipilih ke bahasa tujuan di bawah.','Translates the selected message into the target language below.'), explain: tr('Menjelaskan maksud pesan, istilah dan bahasa gaulnya.','Explains the message, terms and slang in Indonesian.'), factCheck: data.search.configured ? tr('Membandingkan klaim dengan cuplikan pencarian web dan menyebut sumbernya. Memakai 2 kuota.','Compares claims with web search snippets and cites sources in Indonesian. Uses 2 quotas.') : tr('Kunci pencarian web belum terpasang: AI hanya meninjau klaim tanpa sumber dan mengatakannya.','No web search key configured: AI reviews claims in Indonesian without sources and says so.'), recap: tr('Merangkum sampai 150 pesan yang ditulis setelah pesan yang dipilih. Perlu izin membaca riwayat pesan.','Summarizes up to 150 messages written after the selected message in Indonesian. Requires read message history permission.') };
   slot.innerHTML = `<form id="aiMenuForm" class="f-form">${data.menus.map((menu) => toggle(menu.key, `Menu "${menu.name}"`, help[menu.key], s[menu.key])).join('')}${row(tr('Bahasa tujuan terjemahan','Translation target language'), tr('Dipakai oleh menu "Terjemahkan" bila anggota belum mengatur bahasa pribadinya (/personal).','Used by the “Terjemahkan” menu when the member has not set a personal language (/personal).'), `<select name="language">${languageOptions(data.languages, s.language)}</select>`)}${actions(tr('DIDAFTARKAN KE DISCORD SAAT DISIMPAN','REGISTERED WITH DISCORD ON SAVE'))}</form>`;
   wire(slot.querySelector('form'), 'menu', (x) => ({ translate: x.translate.checked, explain: x.explain.checked, factCheck: x.factCheck.checked, recap: x.recap.checked, language: x.language.value }), notify,
    (out) => notify(out.menuSync === false ? tr('Tersimpan, tetapi menu belum bisa didaftarkan ke Discord. Restart bot untuk mendaftarkannya.','Saved, but menus could not be registered with Discord. Restart the bot to register them.') : out.menuSync === true ? tr('Tersimpan dan menu didaftarkan ke Discord.','Saved and menus registered with Discord.') : tr('Pengaturan menu pesan disimpan.','Message menu settings saved.')));
  },

  digest(slot, data, notify) {
   const s = data.settings.digest;
   const channels=[['',tr('Pilih channel','Select a channel')],...data.channels.map(c=>[c.id,`# ${c.name}${data.channels.filter(x=>x.name===c.name).length>1?` · ID ${c.id}`:''}`])];if(s.channelIds[0]&&!data.channels.some(c=>c.id===s.channelIds[0]))channels.push([s.channelIds[0],`${tr('ID tersimpan — tidak tersedia','Saved ID — unavailable')} · ${s.channelIds[0]}`]);
   slot.innerHTML = `<form id="aiDigestForm" class="f-form">${toggle('enabled', tr('Aktifkan koran hari ini','Enable daily newspaper'), tr('Satu kiriman untuk setiap waktu yang disimpan.','One post for each saved time.'), s.enabled)}${row(tr('Channel koran hari ini','Daily newspaper channel'),tr('Pilih satu channel teks. Jika sebelumnya lebih dari satu, channel pertama dipertahankan.','Choose one text channel. If more than one was previously set, the first is retained.'),`<select name="channelId">${channels.map(([id,name])=>`<option value="${esc(id)}" ${id===(s.channelIds[0]||'')?'selected':''}>${esc(name)}</option>`).join('')}</select>`)}${[0,1,2].map(i=>row(`${tr('Waktu','Time')} ${i+1}`,i===0?tr('Wajib diisi.','Required.'):tr('Opsional; kosongkan jika tidak digunakan.','Optional; leave empty if unused.'),`<input name="time${i+1}" type="time" value="${esc(s.times?.[i]||'')}" ${i===0?'required':''}>`)).join('')}${row(tr('Zona waktu','Time zone'),tr('Berlaku untuk ketiga waktu.','Applies to all three times.'),`<select name="zone">${options(ZONES,s.zone)}</select>`)}<p class="f-muted">${data.search.configured ? tr('Berita selalu aktif: tiga sampai empat butir dari hasil pencarian web, dengan sumbernya.','News is always active: three to four items from web search results, with sources.') : tr('Berita selalu aktif, tetapi kunci pencarian web belum terpasang; edisi dilewati sampai pencarian tersedia.','News is always active, but the web search key is missing; editions are skipped until search is available.')}</p>${row(tr('Topik','Topics'), tr('Opsional, paling banyak 120 karakter. Kosong = berita utama Indonesia.','Optional, up to 120 characters. Empty = top Indonesian news.'), `<input name="topics" type="text" maxlength="120" value="${esc(s.topics)}" placeholder="${tr('mis. teknologi, game, anime','e.g. technology, games, anime')}">`)}${actions(tr('BERLAKU PADA JAM KIRIM BERIKUTNYA','APPLIES AT THE NEXT SEND TIME'), `<button class="f-outline" type="button" id="aiDigestTest">${tr('KIRIM TES SEKARANG','SEND TEST NOW')}</button> `)}</form>`;
   const form = slot.querySelector('form');
   wire(form, 'digest', (x) => ({ enabled: x.enabled.checked, channelIds: x.channelId.value ? [x.channelId.value] : [], times: [x.time1.value,x.time2.value,x.time3.value].filter(Boolean), zone: x.zone.value, topics: x.topics.value }), notify, () => notify(tr('Pengaturan koran hari ini disimpan.','Daily newspaper settings saved.')));
   const test = slot.querySelector('#aiDigestTest');
   test.addEventListener('click', async () => {
    if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Kirim satu edisi sekarang ke channel yang TERSIMPAN? Ini memakai kuota AI bot.','Send one edition now to the SAVED channel? This uses the bot’s AI quota.')) : Promise.resolve(window.confirm(tr('Kirim satu edisi sekarang ke channel yang TERSIMPAN? Ini memakai kuota AI bot.','Send one edition now to the SAVED channel? This uses the bot’s AI quota.')))))) return;
    test.disabled = true;
    try { const out = await req('smart/digest/test', { method: 'POST', body: JSON.stringify({ confirmed: true }) }); notify(`${tr('Terkirim ke','Sent to')} ${out.sent} ${tr('channel','channels')}${out.failed ? `, ${tr('gagal di','failed in')} ${out.failed} ${tr('channel (periksa izin dan channel sebelum mencoba lagi; pengiriman mungkin sudah terjadi)','channels (check permissions and the channel before retrying; delivery may already have happened)')}` : ''}.${out.note ? tr(' Catatan: ',' Note: ') + out.note : ''}`); }
    catch (err) { notify(err.message); }
    finally { test.disabled = false; }
   });
  },

  translate(slot, data, notify) {
   const s = data.settings.translate;
   const escId = (v) => String(v).replace(/[^0-9]/g, '');
   const langOpts = (chosen) => languageOptions(data.languages, chosen);
   const overrideRows = () => (s.channelIds.length ? s.channelIds.map((id) => {
      const known = data.channels.find((x) => x.id === id);
      const label = known ? `# ${known.name}${data.channels.filter(x=>x.name===known.name).length>1?` · ID ${id}`:''}` : `${tr('ID tersimpan — tidak tersedia','Saved ID — unavailable')} · ${id}`;
      const current = (s.channelLanguages && s.channelLanguages[id]) || '';
      return `<label class="f-field"><span><b>${esc(label)}</b><small>${tr('Bahasa khusus untuk channel ini; kosong = ikut bahasa tujuan.','Language for this channel; empty = use the target language.')}</small></span><select name="cl_${escId(id)}"><option value="">${tr('Ikut bahasa tujuan','Use target language')}</option>${languageOptions(data.languages, current)}</select></label>`;
   }).join('') : `<small>${tr('Centang minimal satu channel di atas untuk mengatur bahasa khusus.','Select at least one channel above to set a channel-specific language.')}</small>`);
   const revRow = (pair) => `<div class="f-inline ai-reverse-row" style="gap:.5rem;margin:.35rem 0;align-items:center"><select name="rvChannel">${data.channels.map((x) => `<option value="${esc(x.id)}" ${pair && pair.channelId === x.id ? 'selected' : ''}># ${esc(x.name)}${data.channels.filter(c=>c.name===x.name).length>1?` · ID ${esc(x.id)}`:''}</option>`).join('')}${pair?.channelId && !data.channels.some(x=>x.id===pair.channelId) ? `<option value="${esc(pair.channelId)}" selected>${esc(tr('ID tersimpan — tidak tersedia','Saved ID — unavailable'))} · ${esc(pair.channelId)}</option>` : ''}</select><select name="rvA">${langOpts(pair ? pair.langA : 'id')}</select><span>⇄</span><select name="rvB">${langOpts(pair ? pair.langB : 'en')}</select><button type="button" class="f-outline" data-rev-remove>${tr('HAPUS','REMOVE')}</button></div>`;
   slot.innerHTML = `<form id="aiTranslateForm" class="f-form">${toggle('enabled', tr('Aktifkan terjemahan otomatis','Enable automatic translation'), tr('Pesan berbahasa lain di channel pilihan dibalas dengan terjemahannya.','Messages in other languages in selected channels receive a translated reply.'), s.enabled)}${channelPicker('channelIds', tr('Channel terjemahan','Translation channels'), tr('Tempat bot menerjemahkan pesan anggota. Dibagikan dengan reaksi bendera.','Where the bot translates member messages. Shared with flag reactions.'), data.channels, s.channelIds, data.limits.channels, 'translateChannels')}${row(tr('Bahasa tujuan','Target language'), tr('Default untuk semua channel terpilih; pesan yang sudah dalam bahasa ini dilewati.','Default for all selected channels; messages already in this language are skipped.'), `<select name="target">${languageOptions(data.languages, s.target)}</select>`)}${number('hourlyLimit', tr('Batas permintaan AI per jam','AI requests per hour'), tr('Per channel, termasuk pesan yang ternyata tidak perlu diterjemahkan','Per channel, including messages later judged not to need translation'), s.hourlyLimit, 1, 120)}${number('deleteAfterSeconds', tr('Hapus balasan otomatis','Auto-delete replies'), tr('Detik sebelum balasan 🌐 dihapus sendiri; 0 = dibiarkan. Berlaku untuk balasan otomatis dan balasan reaksi bendera','Seconds before the 🌐 reply is deleted; 0 = keep. Applies to automatic and flag-reaction replies'), s.deleteAfterSeconds, 0, 3600)}${toggle('reactionEnabled', tr('Terjemahkan dengan reaksi bendera','Translate with flag reactions'), tr('Anggota menempelkan bendera pada pesan dan bot membalas terjemahannya ke bahasa bendera itu. Hanya di channel terpilih; memakai kuota anggota yang bereaksi.','Members add a flag to a message and the bot replies in that flag’s language. Only in selected channels; uses the reacting member’s quota.'), s.reactionEnabled)}<fieldset class="f-field" aria-labelledby="aiChannelLanguagesTitle" aria-describedby="aiChannelLanguagesHelp"><span><b id="aiChannelLanguagesTitle">${tr('Bahasa khusus per channel','Per-channel language')}</b><small id="aiChannelLanguagesHelp">${tr('Mengoveride bahasa tujuan, hanya untuk channel yang dicentang. Reaksi bendera tidak terpengaruh.','Overrides the target only for selected channels. Flag reactions are unaffected.')}</small></span><div id="aiChannelLangs">${overrideRows()}</div></fieldset><fieldset class="f-field" aria-labelledby="aiReverseTitle" aria-describedby="aiReverseHelp"><span><b id="aiReverseTitle">${tr('Terjemahan dua arah','Bidirectional translation')}</b><small id="aiReverseHelp">${tr('Pesan dalam bahasa A diterjemahkan ke B dan sebaliknya; bahasa lain dibiarkan. Mengabaikan bahasa khusus dan default pada channel itu. Paling banyak 5 pasang.','Messages in language A are translated to B and vice versa; other languages are left alone. Overrides channel-specific and default language. Maximum 5 pairs.')}</small></span><div id="aiReverseRows">${(s.reverse || []).map(revRow).join('')}</div><button type="button" class="f-outline" id="aiReverseAdd">${tr('+ TAMBAH PASANGAN','+ ADD PAIR')}</button></fieldset><p class="f-muted">${tr('Anggota mengatur bahasa pribadinya dengan perintah','Members set their personal language with')} <code>/personal</code> (${tr('mis.','e.g.')} <code>/personal bahasa:Indonesia</code>). ${tr('Menu Terjemahkan (tahan pesan → Apps) menerjemahkan ke bahasa itu, atau bahasa tujuan di tab Menu pesan bila belum diatur.','The “Terjemahkan” message menu (hold a message → Apps) uses that language, or the Message menu target if none is set.')}</p>${actions(tr('BERLAKU PADA PESAN BERIKUTNYA','APPLIES TO FUTURE MESSAGES'))}</form>`;
   const rowsBox = slot.querySelector('#aiReverseRows');
   // Each row has three independent controls. Number them for screen readers and the themed select dialog.
   const labelReverseRows = () => rowsBox.querySelectorAll('.ai-reverse-row').forEach((row,index) => {
      const n=index+1;
      row.querySelector('[name="rvChannel"]').setAttribute('aria-label',tr(`Channel pasangan dua arah ${n}`,`Bidirectional pair ${n} channel`));
      row.querySelector('[name="rvA"]').setAttribute('aria-label',tr(`Bahasa pertama pasangan ${n}`,`Pair ${n} first language`));
      row.querySelector('[name="rvB"]').setAttribute('aria-label',tr(`Bahasa kedua pasangan ${n}`,`Pair ${n} second language`));
      row.querySelector('[data-rev-remove]').setAttribute('aria-label',tr(`Hapus pasangan dua arah ${n}`,`Remove bidirectional pair ${n}`));
   });
   labelReverseRows();
   const addRow = () => {
      if (rowsBox.querySelectorAll('.ai-reverse-row').length >= 5) { notify(tr('Paling banyak 5 pasangan dua arah.','At most 5 bidirectional pairs.')); return; }
      rowsBox.insertAdjacentHTML('beforeend', revRow(null));
      labelReverseRows();
   };
   slot.querySelector('#aiReverseAdd').onclick = addRow;
   slot.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-rev-remove]');
      if (btn) { btn.closest('.ai-reverse-row')?.remove(); labelReverseRows(); }
   });
   const form = slot.querySelector('#aiTranslateForm');
   const pickedIds = () => [...form.querySelectorAll('input[name="channelIds"]:checked')].map((x) => x.value);
   form.onsubmit = async (e) => {
    e.preventDefault();
    for (const set of form.querySelectorAll('[data-picker]')) {
     if (pickedIds().length > Number(set.dataset.max)) { notify(`${set.querySelector('b').textContent}: ${tr(`paling banyak ${set.dataset.max} channel.`,`maximum ${set.dataset.max} ${Number(set.dataset.max)===1?'channel':'channels'}.`)}`); return; }
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
     notify(tr('Pengaturan terjemahan otomatis disimpan.','Automatic translation settings saved.'));
    } catch (err) { notify(err.message); } finally { btn.disabled = false; }
   };
  },

  usage(slot, data, notify) {
   let enabled = data.settings.usage.enabled;
   slot.innerHTML = `<form id="aiUsageForm" class="f-form">${toggle('enabled', tr('Catat pemakaian AI','Record AI usage'), tr('Mati = tidak ada yang dicatat; catatan lama tetap ada sampai kedaluwarsa (45 hari).','Off = nothing is recorded; old records remain until expiry (45 days).'), enabled)}${actions(tr('BERLAKU PADA PERMINTAAN BERIKUTNYA','APPLIES TO FUTURE REQUESTS'))}</form><div class="s-report-bar"><h3 class="s-head">${tr('Laporan','Report')}</h3><span class="f-inline"><button type="button" class="f-outline" data-days="7" aria-pressed="false">${tr('7 HARI','7 DAYS')}</button><button type="button" class="f-outline" data-days="14" aria-pressed="false">${tr('14 HARI','14 DAYS')}</button><button type="button" class="f-outline" data-days="30" aria-pressed="false">${tr('30 HARI','30 DAYS')}</button></span></div><div id="aiUsageReport" class="s-report">${tr('Memuat…','Loading…')}</div>`;
   const report = slot.querySelector('#aiUsageReport');
   const n = (value) => Number(value || 0).toLocaleString(tr('id-ID','en-US'));
   let loadVersion = 0;
   const load = async (days) => {
    const version=++loadVersion;
    report.textContent=tr('Memuat…','Loading…');report.setAttribute('aria-busy','true');
    slot.querySelectorAll('[data-days]').forEach(button=>{button.classList.remove('active');button.setAttribute('aria-pressed','false')});
    try {
     const r = await req('smart/usage?days=' + days);
     if (!report.isConnected || version!==loadVersion) return;
     const peak = Math.max(1, ...r.days.map((d) => d.calls));
     const saved = r.total.cacheHits + r.total.faqHits;
     report.innerHTML = `${r.enabled ? '' : tr('<p class="f-muted">Pencatatan sedang mati. Angka di bawah berasal dari catatan sebelumnya, bila ada.</p>','<p class="f-muted">Recording is off. Figures below are from previous records, if any.</p>')}
      <div class="s-stats"><div><b>${n(r.total.calls)}</b><span>${tr('permintaan AI','AI requests')} · ${days} ${tr('hari','days')}</span></div><div><b>${n(saved)}</b><span>${tr('dijawab tanpa AI','answered without AI')} (FAQ ${n(r.total.faqHits)} · cache ${n(r.total.cacheHits)})</span></div><div><b>${n(r.total.tokens)}</b><span>${tr('token dilaporkan provider','tokens reported by provider')}</span></div><div><b>${n(r.limits.guildDaily)}</b><span>${tr('batas server per hari','daily server limit')} · ${n(r.limits.perUserDaily)} ${tr('per anggota','per member')}</span></div></div>
      <h4>${tr('Per hari (UTC)','Per day (UTC)')}</h4><div class="s-bars">${r.days.map((d) => `<div class="s-bar" title="${esc(d.day)}"><span>${esc(d.day.slice(5))}</span><i><em style="width:${Math.round(d.calls / peak * 100)}%"></em></i><b>${n(d.calls)}</b></div>`).join('')}</div>
      <h4>${tr('Per jenis','By type')}</h4>${r.kinds.length ? `<div class="s-bars s-long">${r.kinds.map((k) => `<div class="s-bar"><span>${esc(Object.hasOwn(KINDS,k.kind) ? KINDS[k.kind] : k.kind)}</span><i><em style="width:${Math.round(k.calls / Math.max(1, r.kinds[0].calls) * 100)}%"></em></i><b>${n(k.calls)}</b></div>`).join('')}</div>` : tr('<p class="f-muted">Belum ada catatan pada rentang ini.</p>','<p class="f-muted">No records in this range.</p>')}
      <h4>${tr('Lima anggota teratas','Top five members')}</h4>${r.members.length ? `<div class="s-bars s-long">${r.members.map((m) => `<div class="s-bar" title="ID ${esc(m.userId)}"><span>${esc(m.name ? m.name+(r.members.some(other=>other.name===m.name&&other.userId!==m.userId)?' · ID '+m.userId:'') : 'ID ' + m.userId)}</span><i><em style="width:${Math.round(m.calls / Math.max(1, r.members[0].calls) * 100)}%"></em></i><b>${n(m.calls)}</b></div>`).join('')}</div>` : tr('<p class="f-muted">Belum ada catatan pada rentang ini.</p>','<p class="f-muted">No records in this range.</p>')}`;
     slot.querySelectorAll('[data-days]').forEach((button) => {const selected=Number(button.dataset.days)===days;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
    } catch (err) { if (report.isConnected && version===loadVersion) report.textContent = err.message; }
    finally { if(report.isConnected && version===loadVersion)report.setAttribute('aria-busy','false'); }
   };
   slot.querySelectorAll('[data-days]').forEach((button) => button.addEventListener('click', () => load(Number(button.dataset.days))));
   wire(slot.querySelector('form'), 'usage', (x) => ({ enabled: x.enabled.checked }), notify, (out) => { enabled = out.settings.usage.enabled; notify(enabled ? tr('Pencatatan pemakaian diaktifkan.','Usage recording enabled.') : tr('Pencatatan pemakaian dimatikan.','Usage recording disabled.')); load(7); });
   load(7);
  },
 };

 window.ZentixAISmart = { render, bind };
})();
