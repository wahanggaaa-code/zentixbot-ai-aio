/* Social Alerts on the logged-in dashboard. The page acts on Discord: the Test button sends a
   real message to the configured channel (mentions suppressed). Everything else is stored data. */
(() => {
  const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
  const API = '/dashboard/api/bot/social-alerts';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (text) => { const t = document.getElementById('toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); };
  const VARIABLES = ['{creator}', '{title}', '{url}', '{platform}', '{role}'];
  const PLATFORM_LABEL = { youtube: 'YouTube', twitch: 'Twitch' };
  const KIND_LABEL = { video: 'Video', live: 'Live', shorts: 'Shorts' };
  const PLACEHOLDER = { creator: 'Nama Akun', title: 'Judul video baru minggu ini', url: 'https://youtube.com/watch?v=…', platform: 'YouTube', role: '@everyone' };

  // Translate only exact built-in API messages, never feed labels or external details.
  const API_ERRORS = new Map([
    ['Permintaan tidak valid.','Invalid request.'],
    ['Konfirmasi diperlukan.','Confirmation is required.'],
    ['Parameter tidak valid.','Invalid parameter.'],
    ['Bot belum siap.','The bot is not ready.'],
    ['Social Alerts tidak dapat dibaca dari database.','Social Alerts could not be read from the database.'],
    ['Pengaturan tidak dapat disimpan.','Settings could not be saved.'],
    ['Platform tidak dikenal.','Unknown platform.'],
    ['Input channel tidak valid.','Invalid channel input.'],
    ['Channel target tidak valid.','Invalid target channel.'],
    ['Twitch hanya mendukung tipe Live.','Twitch only supports the Live type.'],
    ['Tipe konten tidak valid.','Invalid content type.'],
    ['Pesan kustom terlalu panjang.','The custom message is too long.'],
    ['Warna tidak valid.','Invalid color.'],
    ['Role mention tidak valid atau tidak ada di server ini.','The mention role is invalid or does not exist on this server.'],
    ['Label terlalu panjang.','The label is too long.'],
    ['Channel target tidak ada di server ini.','The target channel does not exist on this server.'],
    ['Feed tidak dapat disimpan.','The feed could not be saved.'],
    ['Perubahan tidak dapat disimpan.','Changes could not be saved.'],
    ['Feed tidak ditemukan.','Feed not found.'],
    ['Feed tidak dapat dihapus.','The feed could not be deleted.'],
    ['Pesan tes gagal dikirim. Periksa izin bot dan channel target.','The test message could not be sent. Check the bot permissions and target channel.'],
    ['URL atau handle YouTube tidak valid.','Invalid YouTube URL or handle.'],
    ['YOUTUBE_API_KEY belum diisi di .env.','YOUTUBE_API_KEY is missing from .env.'],
    ['Channel tidak ditemukan.','Channel not found.'],
    ['Channel tidak ditemukan atau tidak dapat dibaca.','Channel not found or cannot be read.'],
    ['Login Twitch tidak valid (4-25 karakter a-z 0-9 _).','Invalid Twitch login (4–25 characters a-z, 0-9, _).'],
    ['Data alert tidak valid.','Invalid alert data.'],
    ['Alert untuk akun dan channel ini sudah ada.','An alert for this account and channel already exists.'],
    ['Data ubah tidak valid.','Invalid update data.'],
    ['Alert tidak ditemukan.','Alert not found.'],
  ]);
  // Some coded store errors are returned in English by the API. Match status and exact
  // built-in text; unknown upstream and provider messages must remain unchanged.
  const STORE_ERRORS_ID = new Map([
    ['503\0Database unavailable for social alerts','Database Social Alerts tidak tersedia'],
    ['409\0Alert limit reached','Batas jumlah alert telah tercapai'],
    ['400\0Invalid guild id','ID server tidak valid'],
    ['400\0Invalid alert mutation result','Hasil perubahan alert tidak valid'],
    ['400\0Invalid alert id','ID alert tidak valid'],
    ['400\0Refusing to store an invalid alert','Alert tidak valid tidak dapat disimpan'],
    ['400\0Alert mutation must be synchronous','Perubahan alert harus dilakukan secara sinkron'],
  ]);
  const apiError = (message,status) => window.ZentixI18n?.language === 'en' ? (API_ERRORS.get(message) ?? message) : (STORE_ERRORS_ID.get(`${status}\0${message}`) ?? message);
  // Poller stores short error messages from Discord and providers as well as these two
  // built-in delivery diagnostics. Translate exact built-in text only; keep other details.
  const DELIVERY_ERRORS = new Map([
    ['Channel tidak tersedia atau bot tidak dapat mengaksesnya.','The channel is unavailable or the bot cannot access it.'],
    ['Bot tidak punya izin View Channel / Send Messages di channel target.','The bot lacks View Channel / Send Messages permissions in the target channel.'],
  ]);
  const deliveryError = message => window.ZentixI18n?.language === 'en' ? (DELIVERY_ERRORS.get(message) ?? message) : message;

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? apiError(data.error,response.status)) || tr('Permintaan gagal.','Request failed.'));
    return data;
  }
  const clock = (iso) => (iso ? new Date(iso).toLocaleString(tr('id-ID','en-GB'), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : tr('belum pernah','never'));
  const kindList = (alert) => (alert.notifyTypes || []).map((kind) => KIND_LABEL[kind] || kind).join(', ');

  function render() {
    return `<div id="socialAlertsLive">
  <section class="f-panel"><div class="f-panel-head"><div><h2>Social Alerts</h2>
    <p>${tr('Kirim pengumuman YouTube dan live Twitch ke Discord.','Send YouTube announcements and Twitch live alerts to Discord.')}</p></div></div>
    <div class="f-field" style="border-bottom:0;padding-bottom:4px"><span><b>${tr('Aktifkan Social Alerts','Enable Social Alerts')}</b><small>${tr('Saat nonaktif, pengumuman berhenti dan feed tetap tersimpan.','When disabled, announcements stop and feeds remain saved.')}</small></span>
      <span class="f-check"><input type="checkbox" id="saMasterToggle" aria-label="${tr('Aktifkan Social Alerts','Enable Social Alerts')}"><span class="fake-switch"></span></span></div>
    <p class="f-muted" id="saMasterState">${tr('Memuat…','Loading…')}</p>
  </section>
  <div id="saKeysWarn"></div>
  <section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Feed terhubung','Connected feeds')}</h2>
    <p>${tr('Satu feed per akun dan channel.','One feed per account and channel.')}</p></div></div>
    <div id="saList" aria-live="polite">${tr('Memuat…','Loading…')}</div>
  </section>
  <div class="f-layout">
    <section class="f-panel"><div class="f-panel-head"><div><h2 id="saFormTitle">${tr('Tambah feed','Add feed')}</h2>
      <p>${tr('YouTube: @handle, URL, atau ID. Twitch: login atau URL. Akun diverifikasi saat disimpan.','YouTube: @handle, URL or ID. Twitch: login or URL. Accounts are verified on save.')}</p></div></div>
      <form class="f-form" id="saForm">
        <label class="f-field" id="saPlatformRow"><span><b>Platform</b><small>${tr('Tidak dapat diubah setelah feed dibuat.','Cannot be changed after the feed is created.')}</small></span>
          <select name="platform" id="saPlatform"><option value="youtube">YouTube</option><option value="twitch">Twitch</option></select></label>
        <label class="f-field" id="saInputRow"><span><b id="saInputLabel">${tr('Channel / akun','Channel / account')}</b><small id="saInputHint">${tr('@handle, URL https://www.youtube.com/@handle, atau ID UC…','@handle, URL https://www.youtube.com/@handle, or UC ID…')}</small></span>
          <input name="input" id="saInput" maxlength="200" autocomplete="off" spellcheck="false" placeholder="${tr('@namaakun','@accountname')}"></label>
        <label class="f-field" id="saLabelRow"><span><b>${tr('Label (opsional)','Label (optional)')}</b><small>${tr('Nama tampilan di pesan. Default: nama dari akun.','Display name in messages. Defaults to the account name.')}</small></span>
          <input name="label" id="saLabel" maxlength="100" autocomplete="off" spellcheck="false" placeholder="${tr('Kanal Uji','Sample Channel')}"></label>
        <label class="f-field"><span><b>${tr('Kirim ke channel','Send to channel')}</b><small>${tr('Hanya channel teks & pengumuman yang dapat ditulis bot.','Only text and announcement channels the bot can write to.')}</small></span><select name="targetChannelId" id="saTarget" required></select></label>
        <fieldset class="f-field" aria-label="${tr('Tipe konten','Content type')}" aria-describedby="saNtHint"><span><b>${tr('Tipe konten','Content type')}</b><small id="saNtHint">${tr('Kirim hanya untuk jenis konten yang dicentang.','Send only for selected content types.')}</small></span>
          <div class="f-picker" id="saNotifyTypes">
            <label><input type="checkbox" name="notifyTypes" value="video" checked> Video</label>
            <label><input type="checkbox" name="notifyTypes" value="live" checked> Live</label>
            <label id="saNtShortsLabel"><input type="checkbox" name="notifyTypes" value="shorts"> Shorts</label>
          </div></fieldset>
        <label class="f-field"><span><b>Mention</b><small>${tr('Butuh izin bot untuk mention role; @everyone butuh izin khusus server.','The bot needs permission to mention roles; @everyone requires a special server permission.')}</small></span><select name="mentionRoleId" id="saMention"></select></label>
        <div class="f-field"><span><b>${tr('Warna container','Container color')}</b><small>${tr('Pilih warna, masukkan kode Hex atau RGB, atau gunakan preset.','Choose a color, enter a Hex or RGB code, or use a preset.')}</small></span>${window.ZentixGreetingColor?.render('#5865f2','#5865f2',{name:'accentColor',optional:true}) || '<input name="accentColor" id="saColor" type="color" value="#5865F2">'}</div>
        <div class="f-field" style="grid-template-columns:1fr"><span><b>${tr('Pesan kustom','Custom message')}</b><small>${tr('Baris di atas kartu. Kosong = "📢 <i>{creator}</i> mengunggah …". Klik variabel untuk menyisipkan.','Line above the card. Empty uses the default Indonesian announcement. Click a variable to insert it.')}</small></span><textarea name="customMessage" id="saCustom" aria-label="${tr('Pesan kustom','Custom message')}" rows="3" maxlength="500" spellcheck="false" placeholder="${tr('{role} {creator} baru: {title} {url}','{role} new from {creator}: {title} {url}')}"></textarea></div>
        <div class="sa-vars" id="saVars">${VARIABLES.map((v) => `<button type="button" class="f-outline" data-var="${v}" aria-label="${esc(tr(`Sisipkan ${v}`,`Insert ${v}`))}">${v}</button>`).join('')}</div>
        <fieldset class="f-field" aria-labelledby="saAiTitle" aria-describedby="saAiHint"><span><b id="saAiTitle">${tr('Ringkasan AI','AI summary')}</b><small id="saAiHint">${tr('Ringkasan opsional 1–2 kalimat untuk video dan Shorts baru, menggunakan AI bot. Judul dan deskripsi dikirim ke provider AI; ringkasan diminta dalam bahasa Indonesia.','Optional 1–2 sentence summary for new videos and Shorts, using the bot’s AI. The title and description are sent to the AI provider; the summary is requested in Indonesian.')}</small></span>
          <span class="f-check"><input type="checkbox" name="aiSummaryEnabled" id="saAi" aria-label="${tr('Ringkasan AI','AI summary')}" aria-describedby="saAiHint"><span class="fake-switch"></span></span></fieldset>
        <div class="f-form-actions"><span id="saFormState">${tr('SIMPAN UNTUK MENERAPKAN','SAVE TO APPLY')}</span>
          <div><button type="button" class="f-outline" id="saCancelEdit" hidden>${tr('BATAL UBAH','CANCEL EDIT')}</button>
          <button class="f-primary" type="submit" id="saSave">${tr('SIMPAN FEED','SAVE FEED')}</button></div></div>
      </form>
    </section>
    <aside><section class="f-panel"><div class="f-panel-head"><div><h2>Live preview</h2><p>${tr('Perkiraan tampilan pesan di Discord; teks bawaan bot tetap berbahasa Indonesia.','Approximate appearance of the Discord message. Default bot message text remains Indonesian.')}</p></div></div>
      <div class="discord-demo"><div class="discord-avatar">Z</div><div class="discord-copy"><div><strong>ZentixBot</strong> <span class="discord-bot">BOT</span></div>
        <div class="discord-embed" id="saPreviewCard" style="border-left-color:#5865F2">
          <b id="saPreviewTop">📢 <span id="saPreviewCreatorTop">Nama Akun</span> mengunggah video baru</b>
          <div id="saPreviewTitle" style="margin-top:8px"><a id="saPreviewTitleLink" href="#" onclick="return false" style="color:#00a8fc;text-decoration:none">Judul video baru minggu ini</a></div>
          <p id="saPreviewMeta" style="margin:2px 0 0;color:#a6a7af;font-size:11px">YouTube • Nama Akun</p>
          <p id="saPreviewSummary" hidden><small>✨ <b>${tr('Ringkasan AI','AI summary')}</b><br>${tr('Ringkasan singkat isi video akan tampil di sini saat bot mengirim.','A short summary of the video will appear here when the bot sends it.')}</small></p>
          <div id="saPreviewThumb" style="margin-top:10px;background:#1d1e23;color:#7f8087;font:700 10px var(--mono);padding:26px 12px;text-align:center">THUMBNAIL</div>
          <div style="border-top:1px solid #3f4047;margin-top:10px;padding-top:10px"><button type="button" class="discord-button" id="saPreviewWatch" tabindex="-1">Tonton Sekarang</button></div>
          <small id="saPreviewFooter" style="color:#a6a7af;font-size:9px">-# Zentix Social Alerts</small>
        </div>
      </div></div>
      <div class="f-preview-action"><button type="button" id="saTestPreview" class="f-outline">${tr('KIRIM TES','SEND TEST')}</button></div>
      <p class="f-muted">${tr('Tes mengirim <b>pesan sungguhan</b> ke channel target dengan pengaturan yang tersimpan — tanpa mention (tes tidak pernah nge-ping, termasuk @everyone).','The test sends a <b>real message</b> to the target channel using saved settings — without mentions (tests never ping, including @everyone).')}</p>
    </aside>
  </div>
  <div class="f-callout" id="saCallout">ⓘ &nbsp; ${tr('Deteksi live & Shorts memakai YouTube Data API v3 (gratis, ±2 unit per feed per pemeriksaan) — perlu <code>YOUTUBE_API_KEY</code> di .env. Deteksi tidak 100% untuk Shorts; thumbnail live Twitch bisa placeholder. Belum didukung: TikTok & X (segera).','Live & Shorts detection uses YouTube Data API v3 (free, about 2 units per feed per check) — requires <code>YOUTUBE_API_KEY</code> in .env. Shorts detection is not guaranteed; Twitch live thumbnails may be placeholders. TikTok & X are not supported.')}</div>
</div>`;
  }

  function bind(root) {
    const state = { data: null, editingId: null };
    const $ = (id) => root.querySelector(id);
    const form = $('#saForm');
    if (!form) return;
    window.ZentixGreetingColor?.bind(form);

    const sampleFill = (template) => String(template || '')
      .replace(/\{creator\}/gi, PLACEHOLDER.creator).replace(/\{title\}/gi, PLACEHOLDER.title)
      .replace(/\{url\}/gi, PLACEHOLDER.url).replace(/\{platform\}/gi, PLATFORM_LABEL[platform()] || 'YouTube')
      .replace(/\{role\}/gi, roleText());
    const platform = () => (state.editingId ? state.editingPlatform : form.elements.platform.value);
    const roleText = () => {
      const value = form.elements.mentionRoleId.value;
      if (value === 'everyone') return '@everyone';
      const role = (state.data?.roles || []).find((entry) => entry.id === value);
      return role ? `@${role.name}` : '';
    };

    // ---------- Live preview ----------
    function paintPreview() {
      const checkedKinds = [...form.querySelectorAll('input[name=notifyTypes]:checked')].map((box) => box.value);
      const kind = checkedKinds[0] || (platform() === 'twitch' ? 'live' : 'video');
      const accent = /^#[0-9a-f]{6}$/i.test(form.elements.accentColor.value || '') ? form.elements.accentColor.value.toUpperCase() : 'transparent';
      $('#saPreviewCard').style.borderLeftColor = accent;
      const creator = PLACEHOLDER.creator;
      const custom = form.elements.customMessage.value.trim();
      $('#saPreviewTop').textContent = custom ? sampleFill(custom) : (kind === 'live' ? `🔴 ${creator} sedang live` : `📢 ${creator} mengunggah ${kind === 'shorts' ? 'Shorts baru' : 'video baru'}`);
      $('#saPreviewTitleLink').textContent = PLACEHOLDER.title;
      $('#saPreviewMeta').textContent = `${PLATFORM_LABEL[platform()]} • ${creator}${kind === 'live' ? ' • 🔴 LIVE' : ''}`;
      $('#saPreviewWatch').textContent = kind === 'live' ? 'Tonton Live' : 'Tonton Sekarang';
      $('#saPreviewSummary').hidden = !form.elements.aiSummaryEnabled.checked;
      $('#saPreviewFooter').textContent = `-# Zentix Social Alerts${form.elements.aiSummaryEnabled.checked ? ' • Ringkasan oleh Zentix AI' : ''}`;
    }

    // ---------- Feed list ----------
    function feedCard(alert) {
      const accessibleFeed = `${alert.label} (ID ${alert.id})`;
      const badge = alert.platform === 'youtube' ? '<span class="f-tag" style="background:#f03;color:#fff;border-color:#f03">YT</span>' : '<span class="f-tag" style="background:#9146ff;color:#fff;border-color:#9146ff">TW</span>';
      const target = alert.channelName === null ? tr('Channel tidak terlihat oleh bot','Channel not visible to the bot') : `→ #${esc(alert.channelName)}`;
      const mention = alert.mentionRoleId === 'everyone' ? ' · ping @everyone' : alert.mentionRoleId ? tr(' · ping role',' · role ping') : '';
      const ai = alert.aiSummaryEnabled ? ' · AI' : '';
      const err = alert.lastError ? `<div class="sa-error">⚠ ${esc(deliveryError(alert.lastError))}</div>` : '';
      const status = `${alert.enabled ? tr('Aktif','Active') : tr('Nonaktif','Disabled')} · ${kindList(alert)}${mention}${ai} · ${tr('dicek','checked')} ${esc(clock(alert.lastCheckedAt))}`;
      return `<div class="sa-feed" data-feed="${esc(alert.id)}"><div class="sa-feed-head">${badge}<div><strong>${esc(alert.label)}</strong><div class="f-muted" style="margin-top:2px">${target}${alert.isLive ? ' · <b>LIVE</b>' : ''}</div></div>
        <div class="sa-feed-actions"><button type="button" class="f-outline" data-action="toggle" aria-label="${esc(alert.enabled ? tr(`Jeda feed ${accessibleFeed}`,`Pause feed ${accessibleFeed}`) : tr(`Aktifkan feed ${accessibleFeed}`,`Enable feed ${accessibleFeed}`))}">${alert.enabled ? tr('JEDA','PAUSE') : tr('AKTIFKAN','ENABLE')}</button>
        <button type="button" class="f-outline" data-action="test" aria-label="${esc(tr(`Tes feed ${accessibleFeed}`,`Test feed ${accessibleFeed}`))}">${tr('TES','TEST')}</button>
        <button type="button" class="f-outline" data-action="edit" aria-label="${esc(tr(`Ubah feed ${accessibleFeed}`,`Edit feed ${accessibleFeed}`))}">EDIT</button>
        <button type="button" class="f-outline" data-action="delete" aria-label="${esc(tr(`Hapus feed ${accessibleFeed}`,`Delete feed ${accessibleFeed}`))}">${tr('HAPUS','DELETE')}</button></div></div>
        <div class="f-muted" style="margin-top:6px">${esc(status)}</div>${err}</div>`;
    }

    function paintList(data) {
      const list = $('#saList');
      const note = data.rejected > 0 ? `<p class="f-muted" style="color:#8a2f2f">⚠ ${data.rejected} ${tr('baris tersimpan tidak terbaca; dibiarkan apa adanya.','saved rows could not be read; they were left unchanged.')}</p>` : '';
      list.innerHTML = note + (data.alerts.length
        ? data.alerts.map(feedCard).join('')
        : `<p class="f-muted">${tr('Belum ada feed. Tambahkan yang pertama di formulir di bawah.','No feeds yet. Add the first one using the form below.')}</p>`);
    }

    function paintKeys(data) {
      const missing = [];
      if (!data.keys.youtube) missing.push('<code>YOUTUBE_API_KEY</code>');
      if (!data.keys.twitch) missing.push('<code>TWITCH_CLIENT_ID</code> &amp; <code>TWITCH_CLIENT_SECRET</code>');
      $('#saKeysWarn').innerHTML = missing.length
        ? `<div class="f-callout" style="border-color:#8a2f2f">⚠ &nbsp; ${tr('Belum diisi di .env:','Missing from .env:')} ${missing.join(tr(' dan ',' and '))}. ${tr('Feed platform itu tersimpan tapi tidak akan dicek sampai kuncinya ada. Kunci diisi owner di .env, bukan di halaman ini.','Feeds for those platforms are saved but will not be checked until keys are available. The owner adds keys in .env, not on this page.')}</div>`
        : '';
    }

    function keepUnavailable(select, value, kind) {
      if (!value || [...select.options].some(option => option.value === value)) return;
      const option = document.createElement('option');
      option.value = value;
      option.dataset.unavailable = '1';
      option.textContent = kind === 'channel'
        ? tr(`Channel tersimpan tidak tersedia · ID ${value}`,`Saved channel unavailable · ID ${value}`)
        : tr(`Role tersimpan tidak tersedia · ID ${value}`,`Saved role unavailable · ID ${value}`);
      select.append(option);
    }
    function clearUnavailable(select) {
      select.querySelectorAll('option[data-unavailable="1"]').forEach(option => option.remove());
    }

    async function reload() {
      const data = await request('GET');
      state.data = data;
      $('#saMasterToggle').checked = data.settings.enabled;
      $('#saMasterState').textContent = data.settings.enabled ? tr('● Aktif — poller memeriksa feed tiap 10 menit.','● Enabled — poller checks feeds every 10 minutes.') : tr('○ Nonaktif — poller tidak mengirim apa pun.','○ Disabled — poller sends nothing.');
      paintKeys(data);
      paintList(data);
      const target = $('#saTarget');
      const selected = target.value;
      target.innerHTML = data.channels.map((channel) => `<option value="${esc(channel.id)}" ${channel.usable ? '' : 'data-usable="0"'}># ${esc(channel.name)}${data.channels.filter(c=>c.name===channel.name).length>1?` · ID ${esc(channel.id)}`:''}${channel.usable ? '' : tr(' (bot tidak bisa kirim)',' (bot cannot send)')}</option>`).join('');
      if (state.editingId) keepUnavailable(target, selected, 'channel');
      if ([...target.options].some((option) => option.value === selected)) target.value = selected;
      const mention = $('#saMention');
      const mentionSelected = mention.value;
      mention.innerHTML = [
        `<option value="">${tr('Tidak ada ping','No ping')}</option>`,
        `<option value="everyone">@everyone (${tr('butuh izin khusus','requires special permission')})</option>`,
        ...data.roles.map((role) => `<option value="${esc(role.id)}">@ ${esc(role.name)}${data.roles.filter(r=>r.name===role.name).length>1?` · ID ${esc(role.id)}`:''}${role.usable ? '' : tr(' (tidak dapat di-ping)',' (cannot be pinged)')}</option>`),
      ].join('');
      if (state.editingId) keepUnavailable(mention, mentionSelected, 'role');
      if ([...mention.options].some((option) => option.value === mentionSelected)) mention.value = mentionSelected;
      paintPreview();
    }

    function resetForm() {
      state.editingId = null;
      state.editingPlatform = null;
      $('#saFormTitle').textContent = tr('Tambah feed','Add feed');
      $('#saPlatformRow').hidden = false;
      $('#saInputRow').hidden = false;
      $('#saLabelRow').hidden = false;
      $('#saCancelEdit').hidden = true;
      $('#saSave').textContent = tr('SIMPAN FEED','SAVE FEED');
      clearUnavailable($('#saTarget'));
      clearUnavailable($('#saMention'));
      form.reset();
      window.ZentixGreetingColor?.set(form,'#5865f2');
      syncNotifyFieldsets();
      paintPreview();
    }

    function syncNotifyFieldsets() {
      const twitch = platform() === 'twitch';
      const boxes = [...form.querySelectorAll('input[name=notifyTypes]')];
      const shorts = form.querySelector('input[name=notifyTypes][value=shorts]');
      $('#saNtShortsLabel').hidden = twitch;
      $('#saNtHint').textContent = twitch ? tr('Twitch hanya mendukung tipe Live.','Twitch only supports the Live type.') : tr('Kirim hanya untuk jenis konten yang dicentang.','Send only for selected content types.');
      $('#saInputHint').textContent = twitch ? tr('Login Twitch, mis. shroud — atau URL https://twitch.tv/shroud','Twitch login, e.g. shroud — or URL https://twitch.tv/shroud') : tr('@handle, URL https://www.youtube.com/@handle, atau ID UC…','@handle, URL https://www.youtube.com/@handle, or UC ID…');
      $('#saInputLabel').textContent = twitch ? 'Channel Twitch' : 'Channel YouTube';
      $('#saPlatform').disabled = Boolean(state.editingId);
      if (twitch) {
        for (const box of boxes) box.checked = box.value === 'live';
        for (const box of boxes) box.disabled = box.value !== 'live';
      } else {
        for (const box of boxes) box.disabled = false;
        if (shorts.disabled) shorts.disabled = false;
      }
    }

    function fillForEdit(alert) {
      state.editingId = alert.id;
      state.editingPlatform = alert.platform;
      $('#saFormTitle').textContent = `Edit feed — ${alert.label}`;
      $('#saPlatformRow').hidden = true;
      $('#saInputRow').hidden = true;
      $('#saLabelRow').hidden = true;
      $('#saCancelEdit').hidden = false;
      $('#saSave').textContent = tr('SIMPAN PERUBAHAN','SAVE CHANGES');
      const color = /^#[0-9a-f]{6}$/i.test(alert.accentColor || '') ? alert.accentColor : '';
      if (window.ZentixGreetingColor) window.ZentixGreetingColor.set(form,color); else form.elements.accentColor.value=color;
      form.elements.customMessage.value = alert.customMessage || '';
      form.elements.aiSummaryEnabled.checked = alert.aiSummaryEnabled;
      const target = $('#saTarget');
      clearUnavailable(target);
      keepUnavailable(target, alert.targetChannelId, 'channel');
      target.value = alert.targetChannelId;
      const mention = $('#saMention');
      clearUnavailable(mention);
      keepUnavailable(mention, alert.mentionRoleId, 'role');
      mention.value = alert.mentionRoleId ?? '';
      for (const box of form.querySelectorAll('input[name=notifyTypes]')) box.checked = alert.notifyTypes.includes(box.value);
      syncNotifyFieldsets();
      paintPreview();
      root.querySelector('#saFormTitle')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }

    const findFeed = (id) => (state.data?.alerts || []).find((alert) => alert.id === id);

    async function act(path, body, confirmText) {
      if (confirmText && !(await (window.ZentixDialog ? window.ZentixDialog.confirm(confirmText) : Promise.resolve(window.confirm(confirmText))))) return null;
      return request('POST', path, { confirmed: true, ...(body || {}) });
    }

    // ---------- events ----------
    $('#saMasterToggle').addEventListener('change', async (event) => {
      const enabled = event.target.checked;
      event.target.disabled = true;
      try {
        await request('POST', '/settings', { confirmed: true, enabled });
        notify(enabled ? tr('Social Alerts dinyalakan.','Social Alerts enabled.') : tr('Social Alerts dimatikan.','Social Alerts disabled.'));
        await reload();
      } catch (error) {
        notify(error.message);
        event.target.checked = !enabled;
      } finally {
        event.target.disabled = false;
      }
    });

    $('#saList').addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const card = button.closest('[data-feed]');
      const alert = findFeed(card?.dataset.feed);
      if (!alert) return;
      const action = button.dataset.action;
      button.disabled = true;
      try {
        if (action === 'edit') { fillForEdit(alert); return; }
        if (action === 'toggle') {
          await request('PATCH', `/${encodeURIComponent(alert.id)}`, { confirmed: true, enabled: !alert.enabled });
          notify(alert.enabled ? tr('Feed dijeda.','Feed paused.') : tr('Feed diaktifkan.','Feed enabled.'));
        } else if (action === 'test') {
          const answer = await act(`/${encodeURIComponent(alert.id)}/test`, {}, tr(`Kirim pesan TES ke #${alert.channelName ?? alert.targetChannelId}${!alert.channelName||(state.data?.channels||[]).filter(c=>c.name===alert.channelName).length>1?` (ID ${alert.targetChannelId})`:''}? Pesan sungguhan (tanpa mention) akan tampil di channel itu.`,`Send a TEST message to #${alert.channelName ?? alert.targetChannelId}${!alert.channelName||(state.data?.channels||[]).filter(c=>c.name===alert.channelName).length>1?` (ID ${alert.targetChannelId})`:''}? A real message without mentions will appear there.`));
          if (answer) notify(tr('Pesan tes terkirim.','Test message sent.'));
        } else if (action === 'delete') {
          if ((await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Hapus feed "${alert.label}"? Feed berhenti mengirim; pesan lama di Discord tidak dihapus.`,`Delete feed "${alert.label}"? It will stop sending; old Discord messages will not be deleted.`)) : Promise.resolve(window.confirm(tr(`Hapus feed "${alert.label}"? Feed berhenti mengirim; pesan lama di Discord tidak dihapus.`,`Delete feed "${alert.label}"? It will stop sending; old Discord messages will not be deleted.`)))))) {
            await request('DELETE', `/${encodeURIComponent(alert.id)}`, { confirmed: true });
            notify(tr('Feed dihapus.','Feed deleted.'));
          }
        }
        await reload();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    });

    $('#saVars').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-var]');
      if (!button) return;
      const field = $('#saCustom');
      const [start, end] = [field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length];
      field.setRangeText(button.dataset.var, start, end, 'end');
      field.focus();
      paintPreview();
    });

    $('#saCancelEdit').addEventListener('click', resetForm);
    form.addEventListener('input', paintPreview);
    form.addEventListener('change', () => { if (!state.editingId) syncNotifyFieldsets(); paintPreview(); });
    form.elements.platform.addEventListener('change', syncNotifyFieldsets);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#saSave');
      const x = form.elements;
      const notifyTypes = [...form.querySelectorAll('input[name=notifyTypes]:checked')].map((box) => box.value);
      if (!notifyTypes.length) { notify(tr('Pilih minimal satu tipe konten.','Select at least one content type.')); return; }
      if (x.targetChannelId.selectedOptions[0]?.dataset.unavailable === '1') { notify(tr('Channel tersimpan tidak tersedia. Pilih channel yang tersedia sebelum menyimpan.','The saved channel is unavailable. Choose an available channel before saving.')); return; }
      if (x.mentionRoleId.selectedOptions[0]?.dataset.unavailable === '1') { notify(tr('Role tersimpan tidak tersedia. Pilih role yang tersedia atau tanpa ping sebelum menyimpan.','The saved role is unavailable. Choose an available role or no ping before saving.')); return; }
      button.disabled = true;
      try {
        if (state.editingId) {
          await request('PATCH', `/${encodeURIComponent(state.editingId)}`, {
            confirmed: true,
            targetChannelId: x.targetChannelId.value,
            mentionRoleId: x.mentionRoleId.value || null,
            notifyTypes,
            customMessage: x.customMessage.value,
            accentColor: x.accentColor.value || null,
            aiSummaryEnabled: x.aiSummaryEnabled.checked,
          });
          notify(tr('Perubahan tersimpan.','Changes saved.'));
          resetForm();
        } else {
          await request('POST', '', {
            confirmed: true,
            platform: x.platform.value,
            input: x.input.value.trim(),
            label: x.label.value.trim(),
            targetChannelId: x.targetChannelId.value,
            notifyTypes,
            customMessage: x.customMessage.value,
            accentColor: x.accentColor.value || null,
            mentionRoleId: x.mentionRoleId.value || null,
            aiSummaryEnabled: x.aiSummaryEnabled.checked,
          });
          notify(tr('Feed ditambahkan.','Feed added.'));
          resetForm();
        }
        await reload();
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    });

    $('#saTestPreview').addEventListener('click', async () => {
      const button = $('#saTestPreview');
      button.disabled = true;
      try {
        const alert = state.editingId ? findFeed(state.editingId) : (state.data?.alerts || [])[0];
        if (!alert) { notify(tr('Simpan atau pilih feed dulu — tes mengirim dengan pengaturan yang tersimpan.','Save or select a feed first — the test uses saved settings.')); return; }
        const answer = await act(`/${encodeURIComponent(alert.id)}/test`, {}, tr(`Kirim pesan TES ke channel target "${alert.label}"? Pesan sungguhan (tanpa mention) akan tampil di Discord.`,`Send a TEST message to the target channel for "${alert.label}"? A real message without mentions will appear in Discord.`));
        if (answer) notify(tr('Pesan tes terkirim.','Test message sent.'));
      } catch (error) {
        notify(error.message);
      } finally {
        button.disabled = false;
      }
    });

    reload().catch((error) => { $('#saList').textContent = error.message; });
  }

  window.ZentixSocialAlerts = { render, bind };
})();
