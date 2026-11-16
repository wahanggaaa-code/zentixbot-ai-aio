/* Server stats counters on the logged-in dashboard. Unlike most settings pages this one acts on Discord:
   creating a counter creates a channel, deleting a counter deletes its channel. */
(() => {
  const API = '/dashboard/api/bot/server-stats';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STANDARD_BUNDLE_NAMES = 'Anggota + bot, Semua channel, Roles, Emoji (semua), Boost dan Level boost';
  const NOTATION_OPTIONS = [
    { id: 'plain', label: '1211', hint: 'Angka biasa' },
    { id: 'dot', label: '1.211', hint: 'Pemisah ribuan (Indonesia)' },
    { id: 'comma', label: '1,211', hint: 'Pemisah ribuan (Inggris)' },
    { id: 'compact', label: '1.21K', hint: 'Ringkas, mis. 1.21K atau 2.5M' }
  ];
  const TYPE_NAMES = {
    members: 'Anggota + bot', members_only: 'Anggota saja', bots: 'Bot saja',
    pending: 'Menunggu screening', norole: 'Anggota tanpa role',
    channels: 'Semua channel', text_channels: 'Channel teks', voice_channels: 'Channel suara',
    announcement_channels: 'Channel pengumuman', forum_channels: 'Channel forum', stage_channels: 'Channel panggung',
    categories: 'Kategori', roles: 'Roles',
    emojis: 'Emoji (semua)', static_emojis: 'Emoji statis', animated_emojis: 'Emoji animasi', stickers: 'Sticker',
    boosts: 'Boost', boost_tier: 'Level boost', bans: 'Ban', role: 'Role tertentu', goal: 'Goal',
    connected: 'Terhubung (online + idle + dnd)', online: 'Online', idle: 'Idle', dnd: 'Jangan ganggu (DND)',
    offline: 'Offline', streaming: 'Sedang streaming',
    game: 'Counter game', social: 'Counter sosial'
  };
  const KIND_NAMES = { voice: 'Channel suara', text: 'Channel teks' };
  const typeName = (type) => TYPE_NAMES[type] || `Jenis tidak dikenal (${type})`;
  const clock = (ms) => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

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

  function render() {
    return `<div id="serverStatsLive"><section class="f-panel"><div class="f-panel-head"><div><h2>Counter aktif</h2>`
      + `<p>Channel yang namanya mengikuti jumlah anggota. Satu per jenis, ditambah maksimal 10 counter role dan 10 counter goal.</p></div><span>✳</span></div>`
      + `<div id="serverStatsList" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Setup standar</h2>`
      + `<p>Buat paket counter umum sekaligus. Jenis yang sudah ada dilewati; yang lain dibuat dengan nama yang benar sejak awal.</p></div><span>✳</span></div>`
      + `<div id="serverStatsSetup" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Buat counter</h2>`
      + `<p>Membuat channel baru di Discord, di kategori yang dipilih.</p></div><span>✳</span></div>`
      + `<div id="serverStatsCreate" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Counter eksternal — game & sosial</h2>`
      + `<p>Pemain game yang sedang online dan pengikut akun sosial. Angka diambil dari layanan luar, bukan dari Discord; counter tampil "tidak diketahui" bila sumbernya tidak menjawab. Kunci API (kalau perlu) diisi owner di .env, bukan di sini.</p></div><span>✳</span></div>`
      + `<div id="serverStatsExternal" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Format angka</h2>`
      + `<p>Cara bot menulis angka pada nama channel counter. Berlaku untuk semua counter di server ini.</p></div><span>✳</span></div>`
      + `<div id="serverStatsNotation" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Diagnostik</h2>`
      + `<p>Periksa apakah counter berjalan: izin bot, jumlah yang terbaca, entri rusak. Tidak mengubah apa pun.</p></div><span>✳</span></div>`
      + `<div id="serverStatsCheck"><button type="button" class="f-outline" id="serverStatsCheckBtn">PERIKSA ↗</button><div id="serverStatsCheckResult" aria-live="polite"></div></div></section>`
      + `<div class="f-callout">ⓘ &nbsp; Discord membatasi seberapa sering nama channel boleh diganti, jadi angka pada nama channel dapat tertinggal beberapa menit dari jumlah sebenarnya. `
      + `Ganti nama channel counter di Discord sesuai keinginan, asalkan ada angka di dalamnya — bot hanya mengganti angka itu. `
      + `Channel counter memakai izin kategorinya: kunci kategori bila anggota tidak boleh masuk atau menulis di sana.</div></div>`;
  }

  function notationForm(data) {
    const options = NOTATION_OPTIONS.map((option) => `<label class="f-field" style="display:flex;align-items:center;gap:10px;flex-direction:row"><input type="radio" name="notation" value="${esc(option.id)}"${option.id === data.notation ? ' checked' : ''}>`
      + `<span><b>${esc(option.label)}</b><small>${esc(option.hint)}</small></span></label>`).join('');
    return `<form class="f-form" id="serverStatsNotationForm"><div>${options}</div>`
      + `<div class="f-form-actions"><span>BERLAKU UNTUK SEMUA COUNTER</span><button type="submit" class="f-primary">SIMPAN FORMAT ↗</button></div></form>`;
  }

  /** What the page says about one counter, from the fields of the API. */
  function statusText(counter) {
    if (!counter.known) return 'Jenis tidak dikenal; tidak diperbarui';
    if (counter.channelName === null) return 'Channel tidak terlihat oleh bot; mungkin sudah dihapus di Discord';
    if (!counter.enabled) return 'Nonaktif';
    if (counter.botCanManage === false) return 'Bot tidak dapat mengganti nama channel ini (perlu View Channel dan Manage Channels)';
    if (counter.count === null) return counter.type === 'game' || counter.type === 'social'
      ? 'Sumber luar belum menjawab (kunci, host, atau jaringan)'
      : 'Daftar anggota belum dapat dibaca';
    if (counter.current) return 'Sesuai jumlah saat ini';
    if (counter.nextRenameAt) return `Menunggu batas ganti nama Discord, sekitar pukul ${clock(counter.nextRenameAt)}`;
    return 'Nama akan diperbarui pada penyegaran berikutnya';
  }

  function refreshText(refresh) {
    switch (refresh?.status) {
      case 'renamed': case 'current': return 'Nama channel sudah mengikuti.';
      case 'deferred': return `Nama channel menyusul setelah batas ganti nama Discord${refresh.retryAt ? `, sekitar pukul ${clock(refresh.retryAt)}` : ''}.`;
      case 'pending': case 'slow': return 'Discord menahan pergantian nama; nama channel menyusul.';
      case 'no_permission': return 'Bot tidak dapat mengganti nama channel itu (perlu View Channel dan Manage Channels).';
      case 'count_unknown': return 'Daftar anggota belum dapat dibaca; nama channel belum diganti.';
      case 'missing': return 'Channel itu sudah tidak ada di Discord.';
      default: return 'Nama channel belum dapat diganti; akan dicoba lagi pada penyegaran berikutnya.';
    }
  }

  function counterForm(counter, index, data) {
    const free = data.types.filter((type) => type.id !== 'role' && type.id !== 'goal' && type.id !== 'game' && type.id !== 'social' && (!type.taken || type.id === counter.type));
    const options = (counter.known ? [] : [`<option value="${esc(counter.type)}" selected>${esc(typeName(counter.type))}</option>`])
      .concat(free.map((type) => `<option value="${esc(type.id)}"${type.id === counter.type ? ' selected' : ''}>${esc(typeName(type.id))}</option>`)).join('');
    const name = counter.channelName === null ? 'Channel tidak terlihat' : counter.channelName;
    const bindingLine = () => {
      if (counter.type === 'game' && counter.game) {
        const g = counter.game;
        if (g.provider === 'steam') return ` · Game Steam AppID ${esc(g.appId)}`;
        return ` · ${esc(g.provider === 'minecraft' ? 'Minecraft Java' : 'FiveM/FXServer')} ${esc(g.host)}:${esc(g.port)}`;
      }
      if (counter.type === 'social' && counter.social) {
        const sc = counter.social;
        const target = sc.channelId ?? sc.login ?? sc.username ?? sc.userId ?? '';
        return ` · ${esc(sc.platform)}: ${esc(target)}`;
      }
      return '';
    };
    const roleLine = counter.type === 'role'
      ? ` · Role: ${counter.roleName ? esc(counter.roleName) : '<span class="f-warn">sudah dihapus — counter ini bisa dihapus</span>'}`
      : counter.type === 'goal'
        ? ` · Target: <b>${esc(counter.goal)}</b> (stat ${esc(typeName(counter.goalStat))})`
        : bindingLine();
    return `<form class="f-form" data-counter="${index}"><h3>${esc(name)}</h3>`
      + `<p class="f-muted">${esc(KIND_NAMES[counter.channelType] || 'Jenis channel tidak diketahui')} · ID counter ${esc(counter.id)} · ID channel ${esc(counter.channelId)}${roleLine}</p>`
      + `<p><b>Jumlah saat ini:</b> ${counter.count === null ? 'tidak diketahui' : esc(counter.count)} &nbsp;·&nbsp; <b>Status:</b> ${esc(statusText(counter))}</p>`
      + `<label class="f-field"><span><b>Jenis hitungan</b><small>Jenis yang sudah dipakai counter lain tidak ditawarkan.</small></span><select name="type">${options}</select></label>`
      + `<div class="f-form-actions"><button type="button" class="f-outline" data-delete="${index}">HAPUS COUNTER & CHANNEL</button>`
      + `<button type="submit" class="f-primary">UBAH JENIS ↗</button></div></form>`;
  }

  function createForm(data) {
    const rolesAvailable = (data.roles ?? []).length > 0;
    const free = data.types.filter((type) => !type.taken && type.id !== 'game' && type.id !== 'social' && (type.id !== 'role' || rolesAvailable));
    if (!free.length) return '<p class="f-muted">Semua jenis counter sudah dipakai. Hapus salah satu untuk membuat yang baru.</p>';
    if (!data.categories.length) return '<p class="f-muted">Bot tidak melihat kategori di server ini. Buat kategori di Discord terlebih dahulu.</p>';
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : ' (izin bot kurang)'}</option>`).join('');
    const roleOptions = (data.roles ?? []).map((role) => `<option value="${esc(role.id)}">${esc(role.name)}${role.managed ? ' (bot)' : ''}</option>`).join('');
    return `<form class="f-form" id="serverStatsCreateForm">`
      + `<label class="f-field"><span><b>Jenis hitungan</b><small>Apa yang dihitung pada nama channel.</small></span>`
      + `<select name="type">${free.map((type) => `<option value="${esc(type.id)}">${esc(typeName(type.id))}</option>`).join('')}</select></label>`
      + `<label class="f-field" id="serverStatsRoleField" hidden><span><b>Role</b><small>Wajib untuk counter jenis "Role tertentu"; jumlah anggota dengan role itu.</small></span>`
      + `<select name="roleId"><option value="">Pilih role</option>${roleOptions}</select></label>`
      + `<label class="f-field" id="serverStatsGoalStatField" hidden><span><b>Stat</b><small>Stat yang dilacak oleh counter Goal ini.</small></span>`
      + `<select name="goalStat"><option value="">Pilih stat</option>${(data.goalStats ?? []).map((stat) => `<option value="${esc(stat.id)}">${esc(stat.label)}</option>`).join('')}</select></label>`
      + `<label class="f-field" id="serverStatsGoalTargetField" hidden><span><b>Target</b><small>Bilangan bulat minimal 1, mis. 2000 untuk "Anggota 1.204 / 2.000". Nama channel menampilkan angka saat ini dibanding target.</small></span>`
      + `<input type="number" name="goal" min="1" max="2000000000" step="1" inputmode="numeric" placeholder="2000"></label>`
      + `<label class="f-field"><span><b>Jenis channel</b><small>Channel suara disarankan: namanya tampil apa adanya.</small></span>`
      + `<select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>Kategori</b><small>Bot memerlukan View Channel dan Manage Channels di kategori itu.${data.categoriesTruncated ? ' Daftar dipotong; kategori yang tidak tampil mungkin dibatasi oleh izin bot.' : ''}</small></span>`
      + `<select name="categoryId"><option value="">Pilih kategori</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>MEMBUAT CHANNEL DI DISCORD</span><button type="submit" class="f-primary">BUAT COUNTER ↗</button></div></form>`;
  }

  const GAME_PROVIDER_LABELS = { steam: 'Steam (AppID)', minecraft: 'Minecraft Java (host)', fivem: 'FiveM / FXServer (host)' };
  const SOCIAL_PLATFORM_LABELS = { youtube: 'YouTube (channel UC…)', twitch: 'Twitch (login)', x: 'X / Twitter (username)', instagram: 'Instagram bisnis (ID angka)' };

  /** Keys line + two creation forms; the counters themselves render in the "Counter aktif" list above. */
  function externalForm(data) {
    const ext = data.external ?? { gameProviders: [], socialPlatforms: [], keysPresent: {}, missing: {} };
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : ' (izin bot kurang)'}</option>`).join('');
    const keysLine = Object.entries(ext.keysPresent ?? {}).map(([name, present]) =>
      `<code>${esc(name)}</code> ${present ? '✓ terbaca' : '✗ kosong'}`).join(' &nbsp;·&nbsp; ');
    const missingNote = (platform) => {
      const missing = ext.missing?.[platform] ?? [];
      return missing.length
        ? `<small class="f-warn">Belum ada di .env: ${missing.map((name) => `<code>${esc(name)}</code>`).join(', ')} — counternya bisa dibuat, angkanya tampil "tidak diketahui" sampai kuncinya diisi.</small>`
        : '<small>Kunci tersedia di .env.</small>';
    };
    return `<p class="f-muted">Kunci owner di .env: ${keysLine || 'tidak ada yang diperlukan'}. Kunci tidak pernah ditampilkan nilainya.</p>`
      + `<form class="f-form" id="serverStatsGameForm" style="margin-bottom:16px"><h3>🎮 Game</h3>`
      + `<p class="f-muted">Steam butuh AppID game (mis. 730 = CS2); Minecraft/FiveM butuh alamat server yang DAPAT DIAKSES PUBLIK (maks. 10 counter game).</p>`
      + `<label class="f-field"><span><b>Provider</b></span><select name="provider">${Object.entries(GAME_PROVIDER_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>`
      + `<label class="f-field" data-game="steam"><span><b>AppID Steam</b><small>Angka dari halaman game di store.steampowered.com.</small></span><input type="number" name="appId" min="1" step="1" inputmode="numeric" placeholder="730"></label>`
      + `<label class="f-field" data-game="host" hidden><span><b>Alamat server</b><small>Domain publik atau IP publik, tanpa http:// — mis. mc.contoh.com. Tidak boleh alamat lokal/privat.</small></span><input type="text" name="host" maxlength="253" autocomplete="off" placeholder="mc.contoh.com"></label>`
      + `<label class="f-field" data-game="host" hidden><span><b>Port</b><small>Kosong = default (Minecraft 25565, FiveM 30120).</small></span><input type="number" name="port" min="1" max="65535" step="1" inputmode="numeric" placeholder="25565"></label>`
      + `<label class="f-field"><span><b>Label</b><small>Nama pendek pada channel counter, mis. "CS2" atau "Server MC" (maks. 30 karakter).</small></span><input type="text" name="label" maxlength="30" required placeholder="CS2"></label>`
      + `<label class="f-field"><span><b>Jenis channel</b></span><select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>Kategori</b></span><select name="categoryId"><option value="">Pilih kategori</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>MEMBUAT CHANNEL DI DISCORD</span><button type="submit" class="f-primary">BUAT COUNTER GAME ↗</button></div></form>`
      + `<form class="f-form" id="serverStatsSocialForm"><h3>🔗 Sosial</h3>`
      + `<p class="f-muted">Pengikut akun sosial kamu (maks. 10 counter sosial). Masing-masing butuh kunci owner di .env.</p>`
      + `<label class="f-field"><span><b>Platform</b></span><select name="platform">${Object.entries(SOCIAL_PLATFORM_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>`
      + `<p class="f-muted" id="serverStatsSocialKeyNote">${missingNote('youtube')}</p>`
      + `<label class="f-field" data-social="youtube"><span><b>Channel ID YouTube</b><small>UC… (Channel → Tentang → ID).</small></span><input type="text" name="channelId" maxlength="24" autocomplete="off" placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"></label>`
      + `<label class="f-field" data-social="twitch" hidden><span><b>Login Twitch</b><small>Nama login channel, huruf kecil.</small></span><input type="text" name="login" maxlength="25" autocomplete="off" placeholder="namaakun"></label>`
      + `<label class="f-field" data-social="x" hidden><span><b>Username X</b><small>Tanpa @.</small></span><input type="text" name="username" maxlength="15" autocomplete="off" placeholder="akun"></label>`
      + `<label class="f-field" data-social="instagram" hidden><span><b>ID akun bisnis Instagram</b><small>ID ANGKA akun bisnis/kreator (bukan username). Token owner di .env harus boleh membaca akun ini.</small></span><input type="text" name="userId" maxlength="25" autocomplete="off" inputmode="numeric" placeholder="17841400000000000"></label>`
      + `<label class="f-field"><span><b>Label</b><small>Nama pendek pada channel counter (maks. 30 karakter).</small></span><input type="text" name="label" maxlength="30" required placeholder="YouTube"></label>`
      + `<label class="f-field"><span><b>Jenis channel</b></span><select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>Kategori</b></span><select name="categoryId"><option value="">Pilih kategori</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>MEMBUAT CHANNEL DI DISCORD</span><button type="submit" class="f-primary">BUAT COUNTER SOSIAL ↗</button></div></form>`;
  }

  function setupForm(data) {
    if (!data.categories.length) return '<p class="f-muted">Bot tidak melihat kategori di server ini. Buat kategori di Discord terlebih dahulu.</p>';
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : ' (izin bot kurang)'}</option>`).join('');
    return `<form class="f-form" id="serverStatsSetupForm">`
      + `<p class="f-muted">Bundle membuat counter: ${STANDARD_BUNDLE_NAMES}.</p>`
      + `<label class="f-field"><span><b>Kategori</b><small>Ke mana channel counter dibuat.</small></span>`
      + `<select name="categoryId"><option value="">Pilih kategori</option>${categories}</select></label>`
      + `<label class="f-field"><span><b>Jenis channel</b><small>Channel suara disarankan: namanya tampil apa adanya.</small></span>`
      + `<select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<div class="f-form-actions"><span>MEMBUAT SAMPAI 6 CHANNEL</span><button type="submit" class="f-primary">SETUP STANDAR ↗</button></div></form>`;
  }

  const LEVEL_NAMES = { error: 'MASALAH', warn: 'CATATAN', info: 'INFO' };

  /** The diagnostic report as safe HTML lines. */
  function renderCheck(report) {
    const checked = Number.isInteger(report.checked) ? ` (${report.checked} counter diperiksa.)` : '';
    const lines = [`<p class="f-muted" role="status">${esc(report.ok ? `Semua counter tampak beres.${checked}` : 'Ada hal yang perlu diperhatikan.')}</p>`];
    if (report.memberList === 'failed') lines.push('<p>• Daftar anggota tidak dapat diambil — periksa izin intent Guild Members (privileged) di Discord Developer Portal.</p>');
    if (report.rejected > 0) lines.push(`<p>• ${esc(report.rejected)} entri tersimpan tidak dapat dibaca dan tidak akan ditampilkan atau diubah.</p>`);
    for (const counter of report.counters) {
      const name = counter.type === null ? 'Server' : (TYPE_NAMES[counter.type] || counter.type);
      lines.push(`<p>• [${LEVEL_NAMES[counter.level] || esc(counter.level)}] ${esc(name)} — ${esc(counter.text)}</p>`);
    }
    return lines.join('');
  }

  function bind(root) {
    const list = root.querySelector('#serverStatsList');
    const create = root.querySelector('#serverStatsCreate');
    const notationBox = root.querySelector('#serverStatsNotation');
    const setupBox = root.querySelector('#serverStatsSetup');
    const externalBox = root.querySelector('#serverStatsExternal');
    if (!list || !create || !notationBox || !setupBox) return;

    const checkBtn = root.querySelector('#serverStatsCheckBtn');
    const checkResult = root.querySelector('#serverStatsCheckResult');
    if (checkBtn && checkResult) {
      checkBtn.onclick = async () => {
        checkBtn.disabled = true;
        checkResult.textContent = 'Memeriksa…';
        try {
          const report = await request('GET', '/check');
          checkResult.innerHTML = renderCheck(report);
        } catch (error) {
          checkResult.innerHTML = `<p role="alert">${esc(error.message)}</p>`;
        } finally {
          checkBtn.disabled = false;
        }
      };
    }
    const say = (text) => {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = text;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2600);
    };

    async function load(message = '') {
      list.textContent = 'Memuat…';
      create.textContent = 'Memuat…';
      let data;
      try {
        data = await request();
      } catch (error) {
        if (!list.isConnected) return;
        list.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="f-outline" id="serverStatsRetry">COBA LAGI ↻</button>`;
        list.querySelector('#serverStatsRetry').onclick = () => load();
        create.innerHTML = '<p class="f-muted">Tidak tersedia sampai daftar counter dapat dibaca.</p>';
        if (notationBox.isConnected) notationBox.innerHTML = '<p class="f-muted">Tidak tersedia.</p>';
        if (setupBox.isConnected) setupBox.innerHTML = '<p class="f-muted">Tidak tersedia.</p>';
        if (externalBox?.isConnected) externalBox.innerHTML = '<p class="f-muted">Tidak tersedia.</p>';
        return;
      }
      if (!list.isConnected) return;

      const note = `<p id="serverStatsStatus" class="f-muted" role="status">${esc(message)}</p>`;
      const rejected = data.rejected > 0 ? `<p role="alert">${esc(data.rejected)} entri tersimpan tidak dapat dibaca dan tidak ditampilkan.</p>` : '';
      list.innerHTML = note + rejected + (data.counters.length
        ? data.counters.map((counter, index) => counterForm(counter, index, data)).join('')
        : '<p class="f-muted">Belum ada counter.</p>')
        + '<div class="f-form-actions"><button type="button" class="f-outline" id="serverStatsReload">MUAT ULANG ↻</button></div>';
      create.innerHTML = '<p id="serverStatsCreateStatus" class="f-muted" role="status"></p>' + createForm(data);
      if (notationBox.isConnected) notationBox.innerHTML = '<p id="serverStatsNotationStatus" class="f-muted" role="status"></p>' + notationForm(data);
      if (setupBox.isConnected) setupBox.innerHTML = '<p id="serverStatsSetupStatus" class="f-muted" role="status"></p>' + setupForm(data);
      if (externalBox?.isConnected) externalBox.innerHTML = '<p id="serverStatsExternalStatus" class="f-muted" role="status"></p>' + externalForm(data);
      list.querySelector('#serverStatsReload').onclick = () => load();
      const status = list.querySelector('#serverStatsStatus');
      const createStatus = create.querySelector('#serverStatsCreateStatus');

      /** Runs one change with every control locked; reloads after success, reports a failure in place. */
      async function change(where, run, done) {
        const controls = [...root.querySelectorAll('#serverStatsLive button, #serverStatsLive select')];
        controls.forEach((control) => { control.disabled = true; });
        where.textContent = 'Memproses…';
        let result;
        try {
          result = await run();
        } catch (error) {
          if (!list.isConnected) return;
          controls.forEach((control) => { control.disabled = false; });
          where.textContent = `${error.message} Bila hasilnya tidak jelas, muat ulang dan periksa sebelum mengulang.`;
          return;
        }
        if (!list.isConnected) return;
        // The boxes are re-rendered with fresh controls by load(); re-enable whatever is static (e.g. diagnostik).
        controls.forEach((control) => { control.disabled = false; });
        const text = done(result);
        say(text);
        load(text);
      }

      list.querySelectorAll('form[data-counter]').forEach((form) => {
        const counter = data.counters[Number(form.dataset.counter)];
        form.onsubmit = (event) => {
          event.preventDefault();
          const type = form.elements.type.value;
          if (type === counter.type) { status.textContent = 'Jenis tidak berubah.'; return; }
          if (!confirm(`Ubah counter ${counter.channelName ?? counter.id} menjadi "${typeName(type)}"? Nama channel di Discord akan ikut berubah.`)) return;
          change(status, () => request('PATCH', '/counters/' + encodeURIComponent(counter.id), { confirmed: true, revision: data.revision, type }),
            (result) => `Jenis counter diubah. ${refreshText(result.refresh)}`);
        };
        form.querySelector('[data-delete]').onclick = () => {
          const target = counter.channelName === null ? 'Channel-nya tidak terlihat oleh bot; hanya catatan counter yang dihapus bila channel memang sudah tidak ada.'
            : `Channel "${counter.channelName}" DIHAPUS dari Discord dan tidak dapat dikembalikan.`;
          if (!confirm(`Hapus counter ${counter.id}? ${target}`)) return;
          change(status, () => request('DELETE', '/counters/' + encodeURIComponent(counter.id), { confirmed: true, revision: data.revision }),
            (result) => (result.channelDeleted ? 'Counter dan channel-nya dihapus.' : result.channelKept
              ? 'Counter dihapus. Channel-nya bukan channel suara atau teks, jadi tidak dihapus.' : 'Counter dihapus. Channel-nya sudah tidak ada.'));
        };
      });

      const notationStatus = notationBox.querySelector('#serverStatsNotationStatus');
      const notationFormEl = notationBox.querySelector('#serverStatsNotationForm');
      if (notationFormEl) {
        notationFormEl.onsubmit = (event) => {
          event.preventDefault();
          const chosen = notationFormEl.elements.notation.value;
          const chosenOption = NOTATION_OPTIONS.find((option) => option.id === chosen);
          if (!chosenOption) { notationStatus.textContent = 'Format angka tidak dikenal.'; return; }
          change(notationStatus, () => request('PUT', '/notation', { notation: chosen }),
            () => `Format angka disimpan: ${chosenOption.label}.`);
        };
      }

      const setupStatus = setupBox.querySelector('#serverStatsSetupStatus');
      const setupFormEl = setupBox.querySelector('#serverStatsSetupForm');
      if (setupFormEl) {
        setupFormEl.onsubmit = (event) => {
          event.preventDefault();
          const body = { confirmed: true, categoryId: setupFormEl.elements.categoryId.value, channelType: setupFormEl.elements.channelType.value };
          if (!body.categoryId) { setupStatus.textContent = 'Pilih kategori terlebih dahulu.'; return; }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!confirm(`Buat bundle counter standar di kategori "${category?.name ?? body.categoryId}"? Jenis yang sudah ada dilewati.`)) return;
          change(setupStatus, () => request('POST', '/setup', body),
            (result) => `Setup selesai: ${result.created} dibuat, ${result.skipped} sudah ada, ${result.failed} gagal. Muat ulang untuk hasilnya.`);
        };
      }

      const form = create.querySelector('#serverStatsCreateForm');
      if (form) {
        const roleField = form.querySelector('#serverStatsRoleField');
        const goalStatField = form.querySelector('#serverStatsGoalStatField');
        const goalTargetField = form.querySelector('#serverStatsGoalTargetField');
        const syncBoundFields = () => {
          const wanted = form.elements.type.value;
          if (roleField) roleField.hidden = wanted !== 'role';
          if (goalStatField) goalStatField.hidden = wanted !== 'goal';
          if (goalTargetField) goalTargetField.hidden = wanted !== 'goal';
        };
        form.elements.type.addEventListener('change', syncBoundFields);
        syncBoundFields();
        form.onsubmit = (event) => {
          event.preventDefault();
          const body = { confirmed: true, type: form.elements.type.value, channelType: form.elements.channelType.value, categoryId: form.elements.categoryId.value };
          if (!body.categoryId) { createStatus.textContent = 'Pilih kategori terlebih dahulu.'; return; }
          let confirmType;
          if (body.type === 'role') {
            body.roleId = form.elements.roleId.value;
            if (!body.roleId) { createStatus.textContent = 'Pilih role terlebih dahulu.'; return; }
            const role = (data.roles ?? []).find((entry) => entry.id === body.roleId);
            confirmType = `${typeName('role')} "${role?.name ?? body.roleId}"`;
          } else if (body.type === 'goal') {
            body.goalStat = form.elements.goalStat.value;
            const target = Number(form.elements.goal.value);
            if (!body.goalStat) { createStatus.textContent = 'Pilih stat untuk goal ini.'; return; }
            if (!Number.isSafeInteger(target) || target < 1 || target > 2000000000) { createStatus.textContent = 'Target harus bilangan bulat antara 1 dan 2.000.000.000.'; return; }
            body.goal = target;
            confirmType = `Goal ${typeName(body.goalStat)} menuju ${target.toLocaleString('id-ID')}`;
          } else {
            confirmType = `"${typeName(body.type)}"`;
          }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!confirm(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} baru di kategori "${category?.name ?? body.categoryId}" untuk counter ${confirmType}?`)) return;
          change(createStatus, () => request('POST', '/counters', body),
            (result) => `Counter dibuat: channel "${result.channelName}".${result.count === null ? ' Angkanya ditambahkan setelah daftar anggota terbaca.' : ''}`);
        };
      }

      const gameFormEl = externalBox?.querySelector('#serverStatsGameForm');
      if (gameFormEl) {
        const externalStatus = externalBox.querySelector('#serverStatsExternalStatus');
        const steamField = gameFormEl.querySelector('[data-game="steam"]');
        const hostFields = gameFormEl.querySelectorAll('[data-game="host"]');
        const syncGame = () => {
          const provider = gameFormEl.elements.provider.value;
          steamField.hidden = provider !== 'steam';
          hostFields.forEach((field) => { field.hidden = provider === 'steam'; });
        };
        gameFormEl.elements.provider.addEventListener('change', syncGame);
        syncGame();
        gameFormEl.onsubmit = (event) => {
          event.preventDefault();
          const provider = gameFormEl.elements.provider.value;
          const body = { confirmed: true, type: 'game', provider, label: gameFormEl.elements.label.value.trim(), channelType: gameFormEl.elements.channelType.value, categoryId: gameFormEl.elements.categoryId.value };
          if (!body.categoryId) { externalStatus.textContent = 'Pilih kategori terlebih dahulu.'; return; }
          if (provider === 'steam') {
            const appId = Number(gameFormEl.elements.appId.value);
            if (!Number.isSafeInteger(appId) || appId < 1) { externalStatus.textContent = 'AppID Steam harus angka positif.'; return; }
            body.appId = appId;
          } else {
            body.host = gameFormEl.elements.host.value.trim();
            const rawPort = gameFormEl.elements.port.value.trim();
            if (rawPort !== '') body.port = Number(rawPort);
            if (!body.host) { externalStatus.textContent = 'Isi alamat server.'; return; }
          }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!confirm(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter game "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`)) return;
          change(externalStatus, () => request('POST', '/counters', body),
            (result) => `Counter game dibuat: channel "${result.channelName}".${result.count === null ? ' Angkanya menyusul saat sumbernya menjawab.' : ''}`);
        };
      }
      const socialFormEl = externalBox?.querySelector('#serverStatsSocialForm');
      if (socialFormEl) {
        const externalStatus = externalBox.querySelector('#serverStatsExternalStatus');
        const noteEl = socialFormEl.querySelector('#serverStatsSocialKeyNote');
        const platformFields = socialFormEl.querySelectorAll('[data-social]');
        const syncSocial = () => {
          const platform = socialFormEl.elements.platform.value;
          platformFields.forEach((field) => { field.hidden = field.dataset.social !== platform; });
          const missing = data.external?.missing?.[platform] ?? [];
          if (noteEl) {
            noteEl.innerHTML = missing.length
              ? `<small class="f-warn">Belum ada di .env: ${missing.map((name) => `<code>${esc(name)}</code>`).join(', ')} — angkanya tampil "tidak diketahui" sampai kuncinya diisi.</small>`
              : '<small>Kunci tersedia di .env.</small>';
          }
        };
        socialFormEl.elements.platform.addEventListener('change', syncSocial);
        syncSocial();
        socialFormEl.onsubmit = (event) => {
          event.preventDefault();
          const platform = socialFormEl.elements.platform.value;
          const body = { confirmed: true, type: 'social', platform, label: socialFormEl.elements.label.value.trim(), channelType: socialFormEl.elements.channelType.value, categoryId: socialFormEl.elements.categoryId.value };
          if (!body.categoryId) { externalStatus.textContent = 'Pilih kategori terlebih dahulu.'; return; }
          const targetField = { youtube: 'channelId', twitch: 'login', x: 'username', instagram: 'userId' }[platform];
          body[targetField] = socialFormEl.elements[targetField].value.trim();
          if (!body[targetField]) { externalStatus.textContent = 'Isi target akun terlebih dahulu.'; return; }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!confirm(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter sosial "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`)) return;
          change(externalStatus, () => request('POST', '/counters', body),
            (result) => `Counter sosial dibuat: channel "${result.channelName}".${result.count === null ? ' Angkanya menyusul saat sumbernya menjawab.' : ''}`);
        };
      }
    }

    load();
  }

  window.ZentixServerStats = { render, bind };
})();
