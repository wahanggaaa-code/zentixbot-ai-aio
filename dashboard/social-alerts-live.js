/* Social Alerts on the logged-in dashboard. The page acts on Discord: the Test button sends a
   real message to the configured channel (mentions suppressed). Everything else is stored data. */
(() => {
  const API = '/dashboard/api/bot/social-alerts';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const notify = (text) => { const t = document.getElementById('toast'); t.textContent = text; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4000); };
  const VARIABLES = ['{creator}', '{title}', '{url}', '{platform}', '{role}'];
  const PLATFORM_LABEL = { youtube: 'YouTube', twitch: 'Twitch' };
  const KIND_LABEL = { video: 'Video', live: 'Live', shorts: 'Shorts' };
  const PLACEHOLDER = { creator: 'Nama Akun', title: 'Judul video baru minggu ini', url: 'https://youtube.com/watch?v=…', platform: 'YouTube', role: '@everyone' };

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Permintaan gagal.');
    return data;
  }
  const clock = (iso) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'belum pernah');
  const kindList = (alert) => (alert.notifyTypes || []).map((kind) => KIND_LABEL[kind] || kind).join(', ');

  function render() {
    return `<div id="socialAlertsLive">
  <section class="f-panel"><div class="f-panel-head"><div><h2>Social Alerts</h2>
    <p>Kirim pengumuman YouTube dan live Twitch ke Discord.</p></div><span>⊚</span></div>
    <div class="f-field" style="border-bottom:0;padding-bottom:4px"><span><b>Aktifkan Social Alerts</b><small>Saat nonaktif, pengumuman berhenti dan feed tetap tersimpan.</small></span>
      <span class="f-check"><input type="checkbox" id="saMasterToggle"><span class="fake-switch"></span></span></div>
    <p class="f-muted" id="saMasterState">Memuat…</p>
  </section>
  <div id="saKeysWarn"></div>
  <section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Feed terhubung</h2>
    <p>Satu feed per akun dan channel.</p></div><span>⊚</span></div>
    <div id="saList" aria-live="polite">Memuat…</div>
  </section>
  <div class="f-layout">
    <section class="f-panel"><div class="f-panel-head"><div><h2 id="saFormTitle">Tambah feed</h2>
      <p>YouTube: @handle, URL, atau ID. Twitch: login atau URL. Akun diverifikasi saat disimpan.</p></div><span>⊚</span></div>
      <form class="f-form" id="saForm">
        <label class="f-field" id="saPlatformRow"><span><b>Platform</b><small>Tidak dapat diubah setelah feed dibuat.</small></span>
          <select name="platform" id="saPlatform"><option value="youtube">YouTube</option><option value="twitch">Twitch</option></select></label>
        <label class="f-field" id="saInputRow"><span><b id="saInputLabel">Channel / akun</b><small id="saInputHint">@handle, URL https://www.youtube.com/@handle, atau ID UC…</small></span>
          <input name="input" id="saInput" maxlength="200" autocomplete="off" spellcheck="false" placeholder="@namaakun"></label>
        <label class="f-field" id="saLabelRow"><span><b>Label (opsional)</b><small>Nama tampilan di pesan. Default: nama dari akun.</small></span>
          <input name="label" id="saLabel" maxlength="100" autocomplete="off" spellcheck="false" placeholder="Kanal Uji"></label>
        <label class="f-field"><span><b>Kirim ke channel</b><small>Hanya channel teks & pengumuman yang dapat ditulis bot.</small></span><select name="targetChannelId" id="saTarget" required></select></label>
        <fieldset class="f-field"><span><b>Tipe konten</b><small id="saNtHint">Kirim hanya untuk jenis konten yang dicentang.</small></span>
          <div class="f-picker" id="saNotifyTypes">
            <label><input type="checkbox" name="notifyTypes" value="video" checked> Video</label>
            <label><input type="checkbox" name="notifyTypes" value="live" checked> Live</label>
            <label id="saNtShortsLabel"><input type="checkbox" name="notifyTypes" value="shorts"> Shorts</label>
          </div></fieldset>
        <label class="f-field"><span><b>Mention</b><small>Butuh izin bot untuk mention role; @everyone butuh izin khusus server.</small></span><select name="mentionRoleId" id="saMention"></select></label>
        <div class="f-field"><span><b>Warna container</b><small>Pilih warna, masukkan kode Hex atau RGB, atau gunakan preset.</small></span>${window.ZentixGreetingColor?.render('#5865f2','#5865f2',{name:'accentColor'}) || '<input name="accentColor" id="saColor" type="color" value="#5865F2">'}</div>
        <div class="f-field" style="grid-template-columns:1fr"><span><b>Pesan kustom</b><small>Baris di atas kartu. Kosong = "📢 <i>{creator}</i> mengunggah …". Klik variabel untuk menyisipkan.</small></span><textarea name="customMessage" id="saCustom" rows="3" maxlength="500" spellcheck="false" placeholder="{role} {creator} baru: {title} {url}"></textarea></div>
        <div class="sa-vars" id="saVars">${VARIABLES.map((v) => `<button type="button" class="f-outline" data-var="${v}">${v}</button>`).join('')}</div>
        <fieldset class="f-field"><span><b>Ringkasan AI</b><small>Ringkasan opsional 1–2 kalimat untuk video dan Shorts baru, menggunakan AI bot.</small></span>
          <span class="f-check"><input type="checkbox" name="aiSummaryEnabled" id="saAi"><span class="fake-switch"></span></span></fieldset>
        <div class="f-form-actions"><span id="saFormState">✳ SIMPAN UNTUK MENERAPKAN</span>
          <div><button type="button" class="f-outline" id="saCancelEdit" hidden>BATAL UBAH</button>
          <button class="f-primary" type="submit" id="saSave">SIMPAN FEED ↗</button></div></div>
      </form>
    </section>
    <aside><section class="f-panel"><div class="f-panel-head"><div><h2>Live preview</h2><p>Perkiraan tampilan pesan di Discord.</p></div><span>⊚</span></div>
      <div class="discord-demo"><div class="discord-avatar">⊚</div><div class="discord-copy"><div><strong>ZentixBot</strong> <span class="discord-bot">BOT</span></div>
        <div class="discord-embed" id="saPreviewCard" style="border-left-color:#5865F2">
          <b id="saPreviewTop">📢 <span id="saPreviewCreatorTop">Nama Akun</span> mengunggah video baru</b>
          <div id="saPreviewTitle" style="margin-top:8px"><a id="saPreviewTitleLink" href="#" onclick="return false" style="color:#00a8fc;text-decoration:none">Judul video baru minggu ini</a></div>
          <p id="saPreviewMeta" style="margin:2px 0 0;color:#a6a7af;font-size:11px">YouTube • Nama Akun</p>
          <p id="saPreviewSummary" hidden><small>✨ <b>Ringkasan AI</b><br>Ringkasan singkat isi video akan tampil di sini saat bot mengirim.</small></p>
          <div id="saPreviewThumb" style="margin-top:10px;background:#1d1e23;color:#7f8087;font:700 10px var(--mono);padding:26px 12px;text-align:center">THUMBNAIL</div>
          <div style="border-top:1px solid #3f4047;margin-top:10px;padding-top:10px"><button type="button" class="discord-button" tabindex="-1">Tonton Sekarang</button></div>
          <small id="saPreviewFooter" style="color:#a6a7af;font-size:9px">-# Zentix Social Alerts</small>
        </div>
      </div></div>
      <div class="f-preview-action"><button type="button" id="saTestPreview" class="f-outline">KIRIM TES ↗</button></div>
      <p class="f-muted">Tes mengirim <b>pesan sungguhan</b> ke channel target dengan pengaturan yang tersimpan — tanpa mention (tes tidak pernah nge-ping, termasuk @everyone).</p>
    </aside>
  </div>
  <div class="f-callout" id="saCallout">ⓘ &nbsp; Deteksi live & Shorts memakai YouTube Data API v3 (gratis, ±2 unit per feed per pemeriksaan) — perlu <code>YOUTUBE_API_KEY</code> di .env. Deteksi tidak 100% untuk Shorts; thumbnail live Twitch bisa placeholder. Belum didukung: TikTok & X (segera).</div>
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
      const accent = /^#[0-9a-f]{6}$/i.test(form.elements.accentColor.value || '') ? form.elements.accentColor.value.toUpperCase() : '#5865F2';
      $('#saPreviewCard').style.borderLeftColor = accent;
      const creator = PLACEHOLDER.creator;
      const custom = form.elements.customMessage.value.trim();
      $('#saPreviewTop').textContent = custom ? sampleFill(custom) : (kind === 'live' ? `🔴 ${creator} sedang live` : `📢 ${creator} mengunggah ${kind === 'shorts' ? 'Shorts baru' : 'video baru'}`);
      $('#saPreviewTitleLink').textContent = PLACEHOLDER.title;
      $('#saPreviewMeta').textContent = `${PLATFORM_LABEL[platform()]} • ${creator}${kind === 'live' ? ' • 🔴 LIVE' : ''}`;
      $('#saPreviewSummary').hidden = !form.elements.aiSummaryEnabled.checked;
      $('#saPreviewFooter').textContent = `-# Zentix Social Alerts${form.elements.aiSummaryEnabled.checked ? ' • Ringkasan oleh Zentix AI' : ''}`;
    }

    // ---------- Feed list ----------
    function feedCard(alert) {
      const badge = alert.platform === 'youtube' ? '<span class="f-tag" style="background:#f03;color:#fff;border-color:#f03">YT</span>' : '<span class="f-tag" style="background:#9146ff;color:#fff;border-color:#9146ff">TW</span>';
      const target = alert.channelName === null ? 'Channel tidak terlihat oleh bot' : `→ #${esc(alert.channelName)}`;
      const mention = alert.mentionRoleId === 'everyone' ? ' · ping @everyone' : alert.mentionRoleId ? ' · ping role' : '';
      const ai = alert.aiSummaryEnabled ? ' · AI' : '';
      const err = alert.lastError ? `<div class="sa-error">⚠ ${esc(alert.lastError)}</div>` : '';
      const status = `${alert.enabled ? 'Aktif' : 'Nonaktif'} · ${kindList(alert)}${mention}${ai} · dicek ${esc(clock(alert.lastCheckedAt))}`;
      return `<div class="sa-feed" data-feed="${esc(alert.id)}"><div class="sa-feed-head">${badge}<div><strong>${esc(alert.label)}</strong><div class="f-muted" style="margin-top:2px">${target}${alert.isLive ? ' · <b>LIVE</b>' : ''}</div></div>
        <div class="sa-feed-actions"><button type="button" class="f-outline" data-action="toggle">${alert.enabled ? 'JEDA' : 'AKTIFKAN'}</button>
        <button type="button" class="f-outline" data-action="test">TES</button>
        <button type="button" class="f-outline" data-action="edit">EDIT</button>
        <button type="button" class="f-outline" data-action="delete">HAPUS</button></div></div>
        <div class="f-muted" style="margin-top:6px">${esc(status)}</div>${err}</div>`;
    }

    function paintList(data) {
      const list = $('#saList');
      const note = data.rejected > 0 ? `<p class="f-muted" style="color:#8a2f2f">⚠ ${data.rejected} baris tersimpan tidak terbaca; dibiarkan apa adanya.</p>` : '';
      list.innerHTML = note + (data.alerts.length
        ? data.alerts.map(feedCard).join('')
        : '<p class="f-muted">Belum ada feed. Tambahkan yang pertama di formulir di bawah.</p>');
    }

    function paintKeys(data) {
      const missing = [];
      if (!data.keys.youtube) missing.push('<code>YOUTUBE_API_KEY</code>');
      if (!data.keys.twitch) missing.push('<code>TWITCH_CLIENT_ID</code> &amp; <code>TWITCH_CLIENT_SECRET</code>');
      $('#saKeysWarn').innerHTML = missing.length
        ? `<div class="f-callout" style="border-color:#8a2f2f">⚠ &nbsp; Belum diisi di .env: ${missing.join(' dan ')}. Feed platform itu tersimpan tapi tidak akan dicek sampai kuncinya ada. Kunci diisi owner di .env, bukan di halaman ini.</div>`
        : '';
    }

    async function reload() {
      const data = await request('GET');
      state.data = data;
      $('#saMasterToggle').checked = data.settings.enabled;
      $('#saMasterState').textContent = data.settings.enabled ? '● Aktif — poller memeriksa feed tiap 10 menit.' : '○ Nonaktif — poller tidak mengirim apa pun.';
      paintKeys(data);
      paintList(data);
      const target = $('#saTarget');
      const selected = target.value;
      target.innerHTML = data.channels.map((channel) => `<option value="${esc(channel.id)}" ${channel.usable ? '' : 'data-usable="0"'}># ${esc(channel.name)}${channel.usable ? '' : ' (bot tidak bisa kirim)'}</option>`).join('');
      if ([...target.options].some((option) => option.value === selected)) target.value = selected;
      const mention = $('#saMention');
      const mentionSelected = mention.value;
      mention.innerHTML = [
        '<option value="">Tidak ada ping</option>',
        '<option value="everyone">@everyone (butuh izin khusus)</option>',
        ...data.roles.map((role) => `<option value="${esc(role.id)}">@ ${esc(role.name)}${role.usable ? '' : ' (tidak dapat di-ping)'}</option>`),
      ].join('');
      if ([...mention.options].some((option) => option.value === mentionSelected)) mention.value = mentionSelected;
      paintPreview();
    }

    function resetForm() {
      state.editingId = null;
      state.editingPlatform = null;
      $('#saFormTitle').textContent = 'Tambah feed';
      $('#saPlatformRow').hidden = false;
      $('#saInputRow').hidden = false;
      $('#saLabelRow').hidden = false;
      $('#saCancelEdit').hidden = true;
      $('#saSave').textContent = 'SIMPAN FEED ↗';
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
      $('#saNtHint').textContent = twitch ? 'Twitch hanya mendukung tipe Live.' : 'Kirim hanya untuk jenis konten yang dicentang.';
      $('#saInputHint').textContent = twitch ? 'Login Twitch, mis. shroud — atau URL https://twitch.tv/shroud' : '@handle, URL https://www.youtube.com/@handle, atau ID UC…';
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
      $('#saSave').textContent = 'SIMPAN PERUBAHAN ↗';
      const color = /^#[0-9a-f]{6}$/i.test(alert.accentColor || '') ? alert.accentColor : '#5865F2';
      if (window.ZentixGreetingColor) window.ZentixGreetingColor.set(form,color); else form.elements.accentColor.value=color;
      form.elements.customMessage.value = alert.customMessage || '';
      form.elements.aiSummaryEnabled.checked = alert.aiSummaryEnabled;
      const target = $('#saTarget');
      if ([...target.options].some((option) => option.value === alert.targetChannelId)) target.value = alert.targetChannelId;
      const mention = $('#saMention');
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
        notify(enabled ? 'Social Alerts dinyalakan.' : 'Social Alerts dimatikan.');
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
          notify(alert.enabled ? 'Feed dijeda.' : 'Feed diaktifkan.');
        } else if (action === 'test') {
          const answer = await act(`/${encodeURIComponent(alert.id)}/test`, {}, `Kirim pesan TES ke #${alert.channelName ?? alert.targetChannelId}? Pesan sungguhan (tanpa mention) akan tampil di channel itu.`);
          if (answer) notify('Pesan tes terkirim.');
        } else if (action === 'delete') {
          if ((await (window.ZentixDialog ? window.ZentixDialog.confirm(`Hapus feed "${alert.label}"? Feed berhenti mengirim; pesan lama di Discord tidak dihapus.`) : Promise.resolve(window.confirm(`Hapus feed "${alert.label}"? Feed berhenti mengirim; pesan lama di Discord tidak dihapus.`))))) {
            await request('DELETE', `/${encodeURIComponent(alert.id)}`, { confirmed: true });
            notify('Feed dihapus.');
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
      if (!notifyTypes.length) { notify('Pilih minimal satu tipe konten.'); return; }
      button.disabled = true;
      try {
        if (state.editingId) {
          await request('PATCH', `/${encodeURIComponent(state.editingId)}`, {
            confirmed: true,
            targetChannelId: x.targetChannelId.value,
            mentionRoleId: x.mentionRoleId.value || null,
            notifyTypes,
            customMessage: x.customMessage.value,
            accentColor: x.accentColor.value,
            aiSummaryEnabled: x.aiSummaryEnabled.checked,
          });
          notify('Perubahan tersimpan.');
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
            accentColor: x.accentColor.value,
            mentionRoleId: x.mentionRoleId.value || null,
            aiSummaryEnabled: x.aiSummaryEnabled.checked,
          });
          notify('Feed ditambahkan.');
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
        if (!alert) { notify('Simpan atau pilih feed dulu — tes mengirim dengan pengaturan yang tersimpan.'); return; }
        const answer = await act(`/${encodeURIComponent(alert.id)}/test`, {}, `Kirim pesan TES ke channel target "${alert.label}"? Pesan sungguhan (tanpa mention) akan tampil di Discord.`);
        if (answer) notify('Pesan tes terkirim.');
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
