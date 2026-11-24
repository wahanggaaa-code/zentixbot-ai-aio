(() => {
 const key = 'zentix.dashboard.language';
 const strings = {
  id: {features:'Fitur bot',settings:'Pengaturan',logout:'KELUAR',logoutTitle:'Keluar dari akun',menu:'Menu navigasi',mainNavigation:'Navigasi utama',menuHeading:'MENU / NAVIGASI',staticPreview:'PREVIEW STATIS',allSimulated:'SEMUA SIMULASI',openMenu:'Buka menu navigasi',closeMenu:'Tutup menu navigasi',language:'Bahasa dashboard',confirm:'Mengganti bahasa akan memuat ulang dashboard. Perubahan yang belum disimpan akan hilang. Lanjutkan?',imageTitle:'Generator gambar Discord',imageHelp:'Izinkan anggota memakai /gambar pada channel yang dipilih.',imageLoading:'Memuat pengaturan…',imageEnable:'Aktifkan /gambar',imageEnableHelp:'Hanya berlaku di channel yang dipilih.',channels:'Channel teks',channelsHelp:'Pilih maksimal 10 channel untuk /gambar.',roles:'Role yang diizinkan',rolesHelp:'Maksimal 10 role. Kosong berarti semua anggota yang punya izin channel.',cooldown:'Cooldown per anggota',cooldownHelp:'30–86400 detik; berlaku juga setelah restart.',save:'SIMPAN ↗',saved:'Tersimpan.',unavailable:'ID tersimpan tidak tersedia — hapus pilihan sebelum menyimpan: ',empty:'Tidak ada pilihan tersedia.',imagePrivacy:'Nonaktif secara bawaan. Prompt dikirim ke provider dan bisa dikenai biaya; Pollinations dapat memasukkan prompt ke URL. Kuota AI harian bersama dan cooldown tetap berlaku, termasuk bila permintaan gagal setelah diterima. Filter konten bergantung provider dan tidak menjamin hasil aman; awasi penggunaannya.'},
  en: {features:'Bot features',settings:'Settings',logout:'LOG OUT',logoutTitle:'Log out',menu:'Navigation menu',mainNavigation:'Main navigation',menuHeading:'MENU / NAVIGATION',staticPreview:'STATIC PREVIEW',allSimulated:'ALL SIMULATED',openMenu:'Open navigation menu',closeMenu:'Close navigation menu',language:'Dashboard language',confirm:'Changing language will reload the dashboard. Unsaved changes will be lost. Continue?',imageTitle:'Discord image generator',imageHelp:'Allow members to use /gambar in selected channels.',imageLoading:'Loading settings…',imageEnable:'Enable /gambar',imageEnableHelp:'Only applies in selected channels.',channels:'Text channels',channelsHelp:'Choose up to 10 channels for /gambar.',roles:'Allowed roles',rolesHelp:'Up to 10 roles. Leave empty for all members with channel access.',cooldown:'Cooldown per member',cooldownHelp:'30–86400 seconds; still applies after a restart.',save:'SAVE ↗',saved:'Saved.',unavailable:'Saved ID unavailable — remove it before saving: ',empty:'No options available.',imagePrivacy:'Disabled by default. Prompts are sent to a provider and may incur charges; Pollinations may include the prompt in a URL. Shared daily AI quotas and cooldowns still apply, including when an accepted request fails. Content filters depend on the provider and do not guarantee safe results; supervise use.'}
 };
 let lang='id';try{if(localStorage.getItem(key)==='en')lang='en'}catch{}
 // A non-sensitive preference cookie lets self-contained, script-free login pages use the same language.
 const syncLoginLanguage=value=>{try{if(location.pathname.startsWith('/dashboard'))document.cookie=`zentix_language=${value}; Path=/dashboard; Max-Age=31536000; SameSite=Lax`}catch{}};
 syncLoginLanguage(lang);
 const t=id=>strings[lang][id] ?? strings.id[id] ?? id;
 // Authentication middleware messages are matched by both HTTP status and exact text.
 // Return undefined for other errors so module-specific recovery details remain intact.
 const accessErrors=new Map([
  ['401\0Silakan login.','Please log in.'],
  ['403\0Akses hanya untuk owner atau administrator server.','Access is restricted to the server owner or administrators.'],
  ['403\0Keanggotaan atau izin server tidak dapat diverifikasi.','Server membership or permissions could not be verified.'],
  ['403\0Permintaan tidak valid.','Invalid request.'],
  ['503\0Bot belum siap memverifikasi server.','The bot is not ready to verify the server.'],
  ['503\0Bot belum tersedia di server yang dikonfigurasi.','The bot is not available in the configured server.'],
 ]);
 const accessError=(message,status)=>{
  const translated=accessErrors.get(`${status}\0${message}`);
  if(translated!==undefined)return lang==='en'?translated:message;
  // The rate limiter's fixed API message includes its computed wait. Do not change the API
  // response, and never match provider details, arbitrary errors or a different status.
  if(status===429 && typeof message==='string'){
   const match=/^Terlalu banyak permintaan ke dashboard dari alamat ini\. Coba lagi dalam ([1-9][0-9]{0,15}) (detik|menit)\.$/.exec(message);
   if(match){if(lang!=='en')return message;const unit=match[2]==='detik'?'second':'minute';return `Too many dashboard requests from this address. Try again in ${match[1]} ${unit}${match[1]==='1'?'':'s'}.`;}
  }
  return undefined;
 };
 // Only exact, built-in AI API errors are translated. Provider/server details remain untouched.
 const aiErrors = new Map([
  ['Pengaturan dan uji AI hanya untuk owner bot.','AI settings and tests are available only to the bot owner.'],
  ['Layanan AI atau database tidak tersedia.','AI service or database is unavailable.'],
  ['Database persisten tidak tersedia.','Persistent database is unavailable.'],
  ['Batas permintaan AI harian telah tercapai.','The daily AI request limit has been reached.'],
  ['Persetujuan pemrosesan data diperlukan.','Consent to data processing is required.'],
  ['Pengaturan AI tidak valid.','AI settings are invalid.'],
  ['Provider tidak didukung.','Provider is not supported.'],
  ['Provider cadangan harus berbeda dari provider utama dan dari cadangan lain.','Backup providers must differ from the primary and other backup providers.'],
  ['Model atau persetujuan pemrosesan data tidak valid.','Model or data-processing consent is invalid.'],
  ['Batas per anggota tidak boleh melebihi batas server.','The per-member limit cannot exceed the server limit.'],
  ['Respons provider kosong.','The provider response is empty.'],
  ['Respons provider terlalu besar.','The provider response is too large.'],
  ['Respons provider tidak valid.','The provider response is invalid.'],
  ['Respons streaming tidak valid.','The streaming response is invalid.'],
  ['Respons streaming terputus.','The streaming response was interrupted.'],
  ['Respons diblokir oleh kebijakan provider.','The response was blocked by the provider’s policy.'],
  ['Konfirmasi pengujian diperlukan.','Test confirmation is required.'],
  ['Konfirmasi pengiriman diperlukan.','Send confirmation is required.'],
  ['Konfirmasi biaya dan pengiriman ke provider diperlukan.','Confirmation of costs and sending to the provider is required.'],
  ['Channel tersimpan atau anggota tidak tersedia.','The saved channel or member is unavailable.'],
  ['Bot tidak dapat mengirim ke channel ini.','The bot cannot send to this channel.'],
  ['Konfirmasi memulai ronde diperlukan.','Confirmation is required to start the round.'],
  ['Jenis permainan tidak valid.','Game type is invalid.'],
  ['AI belum bisa membuat pertanyaan yang jelas. Silakan tulis sendiri.','AI could not make a clear question. Please write one yourself.'],
  ['Draf AI kosong atau terlalu panjang. Coba lagi.','The AI draft is empty or too long. Try again.'],
 ]);
 const aiError=message=>lang==='en' ? (aiErrors.get(message) ?? message) : message;
 // Only exact errors from validating saved AI foundation settings; callers restrict route and method.
 const aiStoredSettingsErrors=new Map([
  ['Persetujuan dan status harus boolean.','Consent and enabled status must be boolean.'],
  ['Nilai perUserDaily di luar batas.','Requests per member per day are out of range.'],
  ['Nilai guildDaily di luar batas.','Server requests per day are out of range.'],
  ['Nilai timeoutSeconds di luar batas.','Provider timeout is out of range.'],
  ['Nilai maxOutputTokens di luar batas.','Maximum output tokens are out of range.'],
 ]);
 const aiStoredSettingsError=(status,code,message)=>lang==='en'&&status===400&&code==='INVALID_SETTINGS' ? (aiStoredSettingsErrors.get(message) ?? message) : message;
 // Only errors produced by the AI foundation for these two draft endpoints.
 const aiDraftFoundationErrors=new Map([
  ['503|STORAGE_UNAVAILABLE|Penghitung AI tidak valid.','The AI usage counter is invalid.'],
  ['403|FORBIDDEN|Identitas server atau anggota tidak valid.','Invalid server or member identity.'],
  ['429|BUSY|Terlalu banyak permintaan AI yang berjalan.','Too many AI requests are in progress.'],
  ['403|DISABLED|AI belum diaktifkan atau belum disetujui.','AI is not enabled or consented to.'],
  ['503|NO_CREDENTIALS|Kredensial provider belum dikonfigurasi.','Provider credentials are not configured.'],
  ['502|REQUEST_REJECTED|Provider menolak permintaan.','The provider rejected the request.'],
  ['503|PROVIDERS_UNAVAILABLE|Semua provider gagal atau timeout.','All providers failed or timed out.'],
  ['503|PROVIDERS_UNAVAILABLE|Tidak ada kredensial provider tersedia.','No provider credentials are available.'],
 ]);
 // These draft validation responses are returned directly, without an API error code.
 const aiDraftError=(path,status,code,message)=>{
  if(lang!=='en'||!['faq-question-draft','announcement-draft'].includes(path))return message;
  const settings=aiStoredSettingsError(status,code,message);if(settings!==message)return settings;
  const foundation=aiDraftFoundationErrors.get(`${status}|${code}|${message}`);
  if(foundation!==undefined)return foundation;
  if(status!==400||code!==undefined)return message;
  if(path==='faq-question-draft'&&message==='Konfirmasi dan pertanyaan pilihan (3–600 karakter) diperlukan.')return 'Confirmation and a selected question (3–600 characters) are required.';
  if(path==='announcement-draft'&&message==='Konfirmasi dan poin pengumuman (1–1200 karakter) diperlukan.')return 'Confirmation and announcement points (1–1200 characters) are required.';
  return message;
 };
 // API-owned Activities diagnostics. Match route, HTTP status, code and exact message.
 const activityErrors=new Map([
  ['activities|PATCH|400|UNAVAILABLE|Pengaturan activity tidak valid.','Invalid Activities settings.'],
  ['activities|PATCH|400|UNAVAILABLE|Pengaturan ronde berulang tidak valid.','Invalid repeating-round settings.'],
  ['activities|PATCH|400|UNAVAILABLE|Jarak ronde berulang harus 5 menit sampai 24 jam.','Repeating-round intervals must be between 5 minutes and 24 hours.'],
  ['activities|PATCH|400|UNAVAILABLE|Channel tidak valid.','Invalid channel.'],
  ['activities|PATCH|400|UNAVAILABLE|Channel tidak tersedia di server ini.','The channel is unavailable in this server.'],
  ['activities|PATCH|400|UNAVAILABLE|Pilih channel activity.','Choose an Activities channel.'],
  ['activities|PATCH|400|UNAVAILABLE|Bot membutuhkan View Channel, Send Messages dan Embed Links.','The bot needs View Channel, Send Messages and Embed Links permissions.'],
  ['activities/start|POST|403|UNAVAILABLE|Server tidak valid.','Invalid server.'],
  ['activities/start|POST|403|UNAVAILABLE|AI Activities belum diaktifkan.','AI Activities is not enabled.'],
  ['activities/start|POST|409|ROUND_ACTIVE|Masih ada ronde yang berjalan.','A round is still in progress.'],
  ['activities/start|POST|409|UNAVAILABLE|Reservasi ronde kedaluwarsa.','The round reservation expired.'],
  ['activities/start|POST|409|UNAVAILABLE|Hasil pengiriman ronde tidak pasti; periksa channel sebelum mencoba lagi.','The round may or may not have been sent; check the channel before trying again.'],
  ['activities/start|POST|409|UNAVAILABLE|Ronde terkirim tetapi status gagal disimpan; periksa channel sebelum mencoba lagi.','The round was sent but its status could not be saved; check the channel before trying again.'],
  ['activities/points|GET|400|UNAVAILABLE|Server tidak valid.','Invalid server.'],
  ['activities/points|GET|503|UNAVAILABLE|Terlalu banyak data poin untuk ditampilkan.','There is too much points data to display.'],
  ['activities/points|GET|503|UNAVAILABLE|Saldo poin tidak valid.','The points balance is invalid.'],
 ]);
 const activityError=(path,method,status,code,message)=>{if(lang!=='en')return message;const direct=activityErrors.get(`${path}|${method}|${status}|${code}|${message}`);if(direct!==undefined)return direct;
  // Reads validate saved settings without a guild, so only those validation errors can occur on GET.
  const readErrors=['Pengaturan activity tidak valid.','Pengaturan ronde berulang tidak valid.','Jarak ronde berulang harus 5 menit sampai 24 jam.','Channel tidak valid.','Pilih channel activity.'];
  const validatesSettings=(path==='activities'&&method==='GET'&&readErrors.includes(message))||(path==='activities/start'&&method==='POST');
  return validatesSettings ? (activityErrors.get(`activities|PATCH|${status}|${code}|${message}`)??message) : message;
 };
 // Exact Join to Create API messages only; never rewrite unknown details or saved templates.
 const jtcErrors=new Map([
  ['Pengaturan berubah sejak halaman dimuat. Muat ulang, periksa, lalu ulangi.','Settings changed since the page was loaded. Reload, check, then try again.'],
  ['Bot sedang membuat channel sementara. Coba lagi beberapa detik lagi.','The bot is creating a temporary channel. Try again in a few seconds.'],
  ['Trigger tidak lagi terdaftar. Muat ulang halaman.','The trigger is no longer registered. Reload the page.'],
  ['Join to Create sudah memiliki trigger, atau channel itu tidak dapat dipakai. Muat ulang halaman.','Join to Create already has a trigger, or that channel cannot be used. Reload the page.'],
  ['Data Join to Create tersimpan perlu diperiksa sebelum dapat diubah.','Saved Join to Create data must be reviewed before it can be changed.'],
  ['Ada data Join to Create berformat lama. Periksa data sebelum mengubah pengaturan.','Legacy Join to Create data exists. Check the data before changing settings.'],
  ['Record Join to Create memiliki masa berlaku. Periksa data sebelum mengubah pengaturan.','The Join to Create record has an expiry. Check the data before changing settings.'],
  ['Server ini bukan server yang dikonfigurasi untuk bot.','This is not the server configured for the bot.'],
  ['Database tidak tersedia.','The database is unavailable.'],
  ['Pengaturan Join to Create tidak dapat dibaca dari database.','Join to Create settings could not be read from the database.'],
  ['Perubahan tidak dapat disimpan saat ini. Muat ulang untuk melihat keadaan terbaru sebelum mencoba lagi.','Changes cannot be saved right now. Reload to see the latest state before trying again.'],
  ['Permintaan tidak valid.','Invalid request.'],
  ['Konfirmasi diperlukan.','Confirmation is required.'],
  ['Parameter tidak valid.','Invalid parameter.'],
  ['Template nama tidak valid.','Invalid name template.'],
  ['Template nama tidak valid. Maksimal 100 karakter, tanpa @ # : atau backtick, dan hanya placeholder yang didukung.','Invalid name template. Maximum 100 characters, without @, #, : or backticks, and only supported placeholders are allowed.'],
  ['Batas user harus bilangan bulat 0 sampai 99.','User limit must be an integer from 0 to 99.'],
  ['Bitrate harus 8 sampai 384 kbps.','Bitrate must be between 8 and 384 kbps.'],
  ['Channel tidak valid.','Invalid channel.'],
  ['Bot belum siap.','The bot is not ready.'],
  ['Pilih channel suara dari server ini.','Choose a voice channel from this server.'],
  ['Bot membutuhkan izin Manage Channels, Move Members dan Connect pada channel itu.','The bot needs Manage Channels, Move Members and Connect permissions in that channel.'],
  ['Tidak ada perubahan yang dikirim.','No changes were sent.'],
  ['Parameter halaman tidak valid.','Invalid page parameter.'],
  ['Data Join to Create perlu diperiksa.','Join to Create data needs review.'],
  ['Daftar channel sementara terlalu besar untuk ditampilkan.','The temporary channel list is too large to display.'],
  ['Data channel sementara perlu diperiksa.','Temporary channel data needs review.'],
  ['Data operasi tertunda Join to Create perlu diperiksa.','Pending Join to Create operation data needs review.'],
  ['Opsi channel Join to Create perlu diperiksa.','Join to Create channel options need review.'],
  ['Gagal membaca Join to Create dari database.','Could not read Join to Create from the database.'],
  ['Parameter pemeriksaan tidak valid.','Invalid check parameter.'],
  ['Data berubah atau perlu diperiksa; muat ulang inventaris.','Data changed or needs review; reload the inventory.'],
  ['Operasi tertunda berubah; muat ulang inventaris.','The pending operation changed; reload the inventory.'],
  ['Bot belum siap memeriksa Discord.','The bot is not ready to check Discord.'],
  ['Pemeriksaan sedang berlangsung atau terlalu sering.','A check is already in progress or checks are too frequent.'],
  ['Discord tidak dapat diperiksa. Ini bukan bukti channel tidak ada.','Discord could not be checked. This is not proof that the channel does not exist.'],
  ['Data berubah selama pemeriksaan; muat ulang inventaris.','Data changed during the check; reload the inventory.'],
  ['Pemeriksaan tidak tersedia; periksa Discord dan database secara manual.','The check is unavailable; inspect Discord and the database manually.'],
 ]);
 const jtcError=message=>lang==='en'?(jtcErrors.get(message)??message):message;
 // Exact messages from the bot modules API; unrecognized server details stay untouched.
 const moduleErrors=new Map([
  ['Maksimal 5 jawaban cepat.','Maximum 5 quick replies.'],
  ['Data jawaban cepat tidak valid.','Invalid quick reply data.'],
  ['Nama jawaban harus 1–40 karakter dalam satu baris.','Reply names must be 1–40 characters on one line.'],
  ['Isi jawaban harus 1–500 karakter.','Reply content must be 1–500 characters.'],
  ['Nama jawaban harus berbeda.','Reply names must be unique.'],
  ['Maksimal tiga jenis tiket.','Maximum three ticket types.'],
  ['Jenis tiket tidak valid.','Invalid ticket type.'],
  ['Nama jenis harus 1–60 karakter dalam satu baris.','Type names must be 1–60 characters on one line.'],
  ['Nama jenis tiket harus berbeda.','Ticket type names must be unique.'],
  ['Setiap jenis perlu 1–3 pertanyaan, maksimal 45 karakter per pertanyaan.','Each type needs 1–3 questions, with a maximum of 45 characters per question.'],
  ['Kategori jenis tiket tidak valid.','Invalid ticket type category.'],
  ['Bot memerlukan izin View Channel, Send Messages, Embed Links, dan Read Message History.','The bot needs View Channel, Send Messages, Embed Links and Read Message History permissions.'],
  ['Channel panel tidak tersedia.','The panel channel is unavailable.'],
  ['Channel tidak valid.','Invalid channel.'],
  ['Daftar channel tidak valid.','Invalid channel list.'],
  ['Daftar pengecualian harus berisi maksimal 100 ID Discord yang berbeda.','The exclusion list must contain at most 100 distinct Discord IDs.'],
  ['Daftar role tidak valid.','Invalid role list.'],
  ['Event logging tidak valid.','Invalid logging event.'],
  ['Konfirmasi atau versi SLA tidak valid.','Invalid SLA confirmation or revision.'],
  ['Konfirmasi atau versi auto-close tidak valid.','Invalid auto-close confirmation or revision.'],
  ['Konfirmasi atau versi jawaban cepat tidak valid.','Invalid quick reply confirmation or revision.'],
  ['Level reward harus 1–500.','Reward level must be 1–500.'],
  ['Modul tidak tersedia.','Module unavailable.'],
  ['Mutasi konfigurasi harus sinkron.','The configuration update must be synchronous.'],
  ['Nilai boolean tidak valid.','Invalid boolean value.'],
  ['Panel tidak tersedia.','Panel unavailable.'],
  ['Pengingat harus 0 (nonaktif) atau 10–10080 menit.','Reminder must be 0 (disabled) or 10–10080 minutes.'],
  ['Role reward tidak valid.','Invalid reward role.'],
  ['Role staf tidak tersedia.','Staff role unavailable.'],
  ['Teks tidak valid atau terlalu panjang.','Text is invalid or too long.'],
  ['Versi jenis tiket tidak valid.','Invalid ticket type revision.'],
  ['Versi pengingat tidak valid.','Invalid reminder revision.'],
  ['Database persisten tidak tersedia.','Persistent database is unavailable.'],
  ['Format konfigurasi lama perlu dimigrasi.','The legacy configuration format needs migration.'],
  ['Konfigurasi server perlu diperiksa.','Server configuration needs review.'],
  ['Gagal mengakses database atau Discord.','Could not access the database or Discord.'],
  ['Data tidak valid.','Invalid data.'],
  ['Konfirmasi diperlukan.','Confirmation is required.'],
  ['Channel tidak valid untuk server ini.','The channel is invalid for this server.'],
  ['Angka di luar rentang.','The number is outside the allowed range.'],
  ['Pengaturan SLA berubah. Muat ulang.','SLA settings changed. Reload.'],
  ['Pengaturan auto-close berubah. Muat ulang.','Auto-close settings changed. Reload.'],
  ['Jawaban cepat sudah berubah. Muat ulang sebelum menyimpan.','Quick replies changed. Reload before saving.'],
  ['Aktifkan dan simpan Logging terlebih dahulu.','Enable and save Logging first.'],
  ['Pilih dan simpan channel audit terlebih dahulu.','Choose and save an audit channel first.'],
  ['Channel audit tersimpan tidak tersedia.','The saved audit channel is unavailable.'],
  ['Bot perlu izin View Channel, Send Messages, dan Embed Links di channel audit.','The bot needs View Channel, Send Messages and Embed Links permissions in the audit channel.'],
  ['Tunggu 10 detik sebelum mengirim tes lagi.','Wait 10 seconds before sending another test.'],
  ['Pengiriman tes gagal atau hasilnya tidak diketahui. Periksa channel sebelum mencoba lagi.','The test delivery failed or its outcome is unknown. Check the channel before trying again.'],
  ['Leveling sedang dinonaktifkan.','Leveling is disabled.'],
  ['Belum ada role hadiah yang tersimpan.','No reward roles are saved.'],
  ['Sinkronisasi masih berjalan.','Sync is still running.'],
  ['Sinkronisasi baru saja selesai. Tunggu satu menit.','Sync just finished. Wait one minute.'],
  ['XP minimum melebihi maksimum.','Minimum XP exceeds maximum XP.'],
  ['Pengaturan leveling sudah diubah di tempat lain, misalnya lewat /level dashboard. Tidak ada yang disimpan. Muat ulang halaman lalu ulangi perubahan.','Leveling settings were changed elsewhere, for example through /level dashboard. Nothing was saved. Reload the page and repeat the changes.'],
  ['Jenis tiket sudah berubah. Muat ulang sebelum menyimpan.','Ticket types changed. Reload before saving.'],
  ['Pengingat tiket sudah berubah. Muat ulang sebelum menyimpan.','The ticket reminder changed. Reload before saving.'],
  ['Panel lama masih tercatat di channel lain.','The old panel is still recorded in another channel.'],
  ['Panel lama tidak dapat diperiksa. Tidak membuat panel baru.','The old panel could not be checked. No new panel was created.'],
  ['Pesan lama bukan panel bot yang sesuai.','The old message is not the matching bot panel.'],
  ['Konfigurasi berubah; periksa panel Discord.','Configuration changed; check the Discord panel.'],
  ['Panel dikirim/diperbarui tetapi ID tidak dapat disimpan. Periksa Discord sebelum mencoba lagi.','The panel was sent or updated, but its ID could not be saved. Check Discord before trying again.'],
 ]);
 const moduleError=message=>lang==='en'?(moduleErrors.get(message)??message):message;
 // Exact greeting and banner API errors only; custom content is never translated.
 const greetingErrors=new Map([
  ['Database tidak tersedia.','The database is unavailable.'],
  ['Tidak dapat membaca database persisten.','Could not read the persistent database.'],
  ['Gagal mengakses database persisten.','Could not access the persistent database.'],
  ['Gagal menyimpan ke database persisten.','Could not save to the persistent database.'],
  ['Format welcome lama perlu dimigrasikan sebelum diubah.','The legacy welcome format must be migrated before it can be changed.'],
  ['Format welcome/goodbye perlu diperiksa sebelum diedit.','The welcome/goodbye format needs review before editing.'],
  ['Pengaturan goodbye perlu diperiksa sebelum diedit.','Goodbye settings need review before editing.'],
  ['Channel goodbye tersimpan tidak valid.','The saved goodbye channel is invalid.'],
  ['Pesan goodbye tersimpan perlu diperiksa.','The saved goodbye message needs review.'],
  ['Embed goodbye tersimpan perlu diperiksa.','The saved goodbye embed needs review.'],
  ['Judul goodbye tersimpan perlu diperiksa.','The saved goodbye title needs review.'],
  ['Footer goodbye tersimpan perlu diperiksa.','The saved goodbye footer needs review.'],
  ['Pengaturan tampilan goodbye perlu diperiksa.','Goodbye display settings need review.'],
  ['Warna goodbye tersimpan perlu diperiksa.','The saved goodbye color needs review.'],
  ['Gambar goodbye tersimpan perlu diperiksa.','The saved goodbye image needs review.'],
  ['Pengaturan welcome tidak valid.','Invalid welcome settings.'],
  ['Pengaturan welcome perlu diperiksa.','Welcome settings need review.'],
  ['Pilih maksimal 5 autorole (ID role Discord, tidak boleh ganda).','Choose up to 5 autoroles (Discord role IDs, no duplicates).'],
  ['Pengaturan goodbye tidak valid.','Invalid goodbye settings.'],
  ['Versi pengaturan tidak valid.','Invalid settings revision.'],
  ['Nilai aktif dan ping harus boolean.','Enabled and ping must be boolean values.'],
  ['Status dan ping harus boolean.','Enabled and ping must be boolean values.'],
  ['Pesan harus berisi 1–1500 karakter.','The message must be 1–1500 characters.'],
  ['Judul, footer atau warna tidak valid.','Invalid title, footer or color.'],
  ['Judul, footer atau warna embed tidak valid.','Invalid embed title, footer or color.'],
  ['Pilih channel teks dari server ini.','Choose a text channel from this server.'],
  ['Pilih channel untuk mengaktifkan welcome.','Choose a channel to enable welcome.'],
  ['Pilih channel untuk mengaktifkan goodbye.','Choose a channel to enable goodbye.'],
  ['Salah satu autorole tidak tersedia atau tidak dapat dikelola bot.','An autorole is unavailable or cannot be managed by the bot.'],
  ['Bot tidak memiliki izin melihat dan mengirim di channel itu.','The bot lacks permission to view and send messages in that channel.'],
  ['URL gambar tidak valid.','Invalid image URL.'],
  ['URL gambar harus HTTPS.','The image URL must use HTTPS.'],
  ['URL gambar harus HTTPS tanpa kredensial.','The image URL must use HTTPS without credentials.'],
  ['Konfirmasi pengiriman diperlukan.','Send confirmation is required.'],
  ['Channel welcome tersimpan tidak tersedia.','The saved welcome channel is unavailable.'],
  ['Channel atau anggota tidak tersedia.','The channel or member is unavailable.'],
  ['Bot tidak memiliki izin melihat dan mengirim pesan di channel.','The bot lacks permission to view the channel and send messages.'],
  ['Gagal mengirim pesan percobaan atau membaca database.','Could not send the test message or read the database.'],
  ['Pengaturan berubah. Muat ulang sebelum menyimpan.','Settings changed. Reload before saving.'],
  ['Jenis banner tidak valid.','Invalid banner type.'],
  ['Banner tidak tersedia.','Banner unavailable.'],
  ['Banner harus PNG, JPEG, WebP atau GIF yang valid, maksimal 5 MB.','The banner must be a valid PNG, JPEG, WebP or GIF, maximum 5 MB.'],
  ['Banner gagal disimpan.','The banner could not be saved.'],
  ['Banner gagal dihapus.','The banner could not be deleted.'],
  ['File terlalu besar. Banner maksimal 5 MB.','File too large. Banners are limited to 5 MB.'],
 ]);
 const greetingError=message=>lang==='en'?(greetingErrors.get(message)??message):message;
 // Explanations for bot-owned audit event identifiers; unknown identifiers are left intact.
 const LOG_LABELS={
  'moderation.ban':['Ban oleh Zentix','Zentix ban'], 'moderation.kick':['Kick oleh Zentix','Zentix kick'], 'moderation.mute':['Mute oleh Zentix','Zentix mute'], 'moderation.warn':['Peringatan oleh Zentix','Zentix warning'], 'moderation.purge':['Hapus pesan oleh Zentix','Messages purged by Zentix'],
  'moderation.timeout':['Timeout oleh Zentix','Zentix timeout'], 'moderation.untimeout':['Timeout dicabut oleh Zentix','Timeout removed by Zentix'], 'moderation.unban':['Ban dicabut oleh Zentix','Ban removed by Zentix'], 'moderation.lock':['Channel dikunci oleh Zentix','Channel locked by Zentix'], 'moderation.unlock':['Channel dibuka oleh Zentix','Channel unlocked by Zentix'], 'moderation.dm':['DM moderasi oleh Zentix','Zentix moderation DM'], 'moderation.config':['Konfigurasi moderasi diubah','Moderation configuration changed'],
  'leveling.levelup':['Anggota naik level','Member level up'], 'leveling.milestone':['Pencapaian level','Level milestone'],
  'message.delete':['Pesan dihapus','Message deleted'], 'message.edit':['Pesan disunting','Message edited'], 'message.bulkdelete':['Pesan dihapus massal','Messages bulk deleted'],
  'role.create':['Role dibuat','Role created'], 'role.delete':['Role dihapus','Role deleted'], 'role.update':['Role diubah','Role updated'], 'channel.create':['Channel dibuat','Channel created'], 'channel.delete':['Channel dihapus','Channel deleted'], 'voice.move':['Pindah channel suara','Voice channel move'],
  'discordmod.ban':['Ban dari audit Discord','Ban from Discord audit'], 'discordmod.unban':['Ban dicabut dari audit Discord','Unban from Discord audit'], 'discordmod.kick':['Kick dari audit Discord','Kick from Discord audit'], 'discordmod.timeout':['Timeout dari audit Discord','Timeout from Discord audit'],
  'member.join':['Anggota masuk','Member joined'], 'member.leave':['Anggota keluar','Member left'], 'member.namechange':['Nama anggota berubah','Member name changed'],
  'reactionrole.add':['Role reaksi diberikan','Reaction role added'], 'reactionrole.remove':['Role reaksi dicabut','Reaction role removed'], 'reactionrole.create':['Panel role reaksi dibuat','Reaction role panel created'], 'reactionrole.delete':['Panel role reaksi dihapus','Reaction role panel deleted'], 'reactionrole.update':['Panel role reaksi diubah','Reaction role panel updated'],
  'selfrole.add':['Self Role diberikan','Self Role added'], 'selfrole.remove':['Self Role dicabut','Self Role removed'], 'selfrole.create':['Panel Self Role dibuat','Self Role panel created'], 'selfrole.delete':['Panel Self Role dihapus','Self Role panel deleted'], 'selfrole.update':['Panel Self Role diubah','Self Role panel updated'],
  'giveaway.create':['Giveaway dibuat','Giveaway created'], 'giveaway.winner':['Pemenang giveaway','Giveaway winner'], 'giveaway.reroll':['Pemenang diundi ulang','Giveaway winner rerolled'], 'giveaway.delete':['Giveaway dihapus','Giveaway deleted'], 'counter.update':['Counter diperbarui','Counter updated'], 'counter.config':['Pengaturan counter diubah','Counter settings changed'], 'application.submit':['Application dikirim','Application submitted'], 'application.review':['Application ditinjau','Application reviewed'], 'report.file':['Laporan dibuat','Report filed']
 };
 const LOG_GROUPS={moderation:['Moderasi Zentix','Zentix moderation'],leveling:['Leveling','Leveling'],message:['Pesan','Messages'],role:['Role','Roles'],channel:['Channel','Channels'],voice:['Suara','Voice'],discordmod:['Moderasi Discord','Discord moderation'],member:['Anggota','Members'],reactionrole:['Role reaksi','Reaction roles'],selfrole:['Self Role','Self Role'],giveaway:['Giveaway','Giveaway'],counter:['Counter','Counters'],application:['Application','Applications'],report:['Laporan','Reports']};
 const logLabel=(kind,key)=>{const map=kind==='event'?LOG_LABELS:kind==='group'?LOG_GROUPS:null;return map&&Object.hasOwn(map,key)?map[key][lang==='en'?1:0]:undefined;};
 window.ZentixI18n={t,logLabel,accessError,aiError,aiDraftError,aiStoredSettingsError,activityError,jtcError,moduleError,greetingError, get language(){return lang}};
 document.documentElement.lang=lang;
 const apply=()=>{
  document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)});
  document.querySelectorAll('[data-i18n-label]').forEach(el=>el.setAttribute('aria-label',t(el.dataset.i18nLabel)));
  const logout=document.querySelector('#profileButton');if(logout)logout.title=t('logoutTitle');
  const trigger=document.querySelector('#dashboardLanguage'),menu=document.querySelector('#languageMenu');
  if(!trigger||!menu)return;
  trigger.textContent=lang==='en'?'ENG':'ID';trigger.setAttribute('aria-label',t('language'));menu.setAttribute('aria-label',t('language'));
  const close=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false')};
  const choices=[...menu.querySelectorAll('[data-language]')];
  choices.forEach(button=>{
   button.setAttribute('aria-pressed',String(button.dataset.language===lang));
   button.addEventListener('click',()=>{
    const next=button.dataset.language;close();if(next===lang){trigger.focus();return}
    if(!window.confirm(t('confirm'))){trigger.focus();return}
    try{localStorage.setItem(key,next)}catch{}syncLoginLanguage(next);window.location.reload();
   });
  });
  trigger.addEventListener('click',()=>{
   if(!menu.hidden){close();return}
   const navigation=document.querySelector('#mobileTrigger');if(navigation?.getAttribute('aria-expanded')==='true')navigation.click();
   menu.hidden=false;trigger.setAttribute('aria-expanded','true');
  });
  document.querySelector('#mobileTrigger')?.addEventListener('click',close);
  document.addEventListener('click',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!trigger.contains(event.target))close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){close();trigger.focus()}});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
})();
