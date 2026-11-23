/* Server stats counters on the logged-in dashboard. Unlike most settings pages this one acts on Discord:
   creating a counter creates a channel, deleting a counter deletes its channel. */
(() => {
  const tr = (id, en) => window.ZentixI18n?.language === 'en' ? en : id;
  const API = '/dashboard/api/bot/server-stats';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STANDARD_BUNDLE_NAMES = tr('Anggota + bot, Semua channel, Roles, Emoji (semua), Boost dan Level boost','Members + bots, All channels, Roles, Emoji (all), Boosts and Boost level');
  const NOTATION_OPTIONS = [
    { id: 'plain', label: '1211', hint: tr('Angka biasa','Plain number') },
    { id: 'dot', label: '1.211', hint: tr('Pemisah ribuan (Indonesia)','Thousands separator (Indonesian)') },
    { id: 'comma', label: '1,211', hint: tr('Pemisah ribuan (Inggris)','Thousands separator (English)') },
    { id: 'compact', label: '1.21K', hint: tr('Ringkas, mis. 1.21K atau 2.5M','Compact, e.g. 1.21K or 2.5M') }
  ];
  const TYPE_NAMES = {
    members: tr('Anggota + bot','Members + bots'), members_only: tr('Anggota saja','Members only'), bots: tr('Bot saja','Bots only'),
    pending: tr('Menunggu screening','Pending screening'), norole: tr('Anggota tanpa role','Members without roles'),
    channels: tr('Semua channel','All channels'), text_channels: tr('Channel teks','Text channel'), voice_channels: tr('Channel suara','Voice channel'),
    announcement_channels: tr('Channel pengumuman','Announcement channels'), forum_channels: tr('Channel forum','Forum channels'), stage_channels: tr('Channel panggung','Stage channels'),
    categories: tr('Kategori','Category'), roles: 'Roles',
    emojis: tr('Emoji (semua)','Emoji (all)'), static_emojis: tr('Emoji statis','Static emoji'), animated_emojis: tr('Emoji animasi','Animated emoji'), stickers: 'Sticker',
    boosts: 'Boost', boost_tier: tr('Level boost','Boost level'), bans: 'Ban', role: tr('Role tertentu','Specific role'), goal: 'Goal',
    connected: tr('Terhubung (online + idle + dnd)','Connected (online + idle + DND)'), online: 'Online', idle: 'Idle', dnd: tr('Jangan ganggu (DND)','Do not disturb (DND)'),
    offline: 'Offline', streaming: tr('Sedang streaming','Streaming'),
    game: tr('Counter game','Game counter'), social: tr('Counter sosial','Social counter')
  };
  const KIND_NAMES = { voice: tr('Channel suara','Voice channel'), text: tr('Channel teks','Text channel') };
  const typeName = (type) => TYPE_NAMES[type] || tr(`Jenis tidak dikenal (${type})`,`Unknown type (${type})`);
  const clock = (ms) => new Date(ms).toLocaleTimeString(tr('id-ID','en-GB'), { hour: '2-digit', minute: '2-digit', hour12: false });

  // Dashboard API currently sends Indonesian messages without codes. Translate only exact built-in text.
  const API_ERRORS = new Map([
    ['Jenis counter tidak dikenal.','Unknown counter type.'],
    ['Pilih channel suara atau channel teks.','Choose a voice or text channel.'],
    ['Pilih kategori dari server ini.','Choose a category from this server.'],
    ['Bot membutuhkan izin View Channel dan Manage Channels di sana. Tidak ada yang diubah.','The bot needs View Channel and Manage Channels permissions there. Nothing was changed.'],
    ['Counter dengan jenis itu sudah ada di server ini.','A counter of that type already exists on this server.'],
    ['Server ini sudah memiliki jumlah counter maksimum.','This server already has the maximum number of counters.'],
    ['Counter itu sudah tidak ada. Muat ulang halaman.','That counter no longer exists. Reload the page.'],
    ['Daftar counter berubah sejak halaman dimuat. Muat ulang, periksa, lalu ulangi.','The counter list changed since the page was loaded. Reload, check, and try again.'],
    ['Data counter tersimpan perlu diperiksa sebelum dapat diubah.','Saved counter data needs review before it can be changed.'],
    ['Database tidak tersedia. Tidak ada yang diubah.','The database is unavailable. Nothing was changed.'],
    ['Discord menolak perubahan channel. Tidak ada yang diubah.','Discord rejected the channel change. Nothing was changed.'],
    ['Counter gagal disimpan dan channel baru tidak dapat dihapus lagi. Hapus channel itu secara manual.','The counter could not be saved and the new channel could not be removed. Delete that channel manually.'],
    ['Format angka tidak dikenal.','Unknown number format.'],
    ['Pilih role untuk counter jenis Role tertentu.','Choose a role for a specific-role counter.'],
    ['Role itu sudah tidak ada di server ini.','That role no longer exists on this server.'],
    ['Pilih stat yang dilacak oleh goal.','Choose the stat tracked by the goal.'],
    ['Target goal harus bilangan bulat antara 1 dan 2000000000.','The goal target must be a whole number between 1 and 2000000000.'],
    ['Counter game membutuhkan game yang dikenal dan label singkat.','A game counter needs a supported game and a short label.'],
    ['Counter sosial membutuhkan platform yang dikenal dan label singkat.','A social counter needs a supported platform and a short label.'],
    ['Perubahan tidak dapat diselesaikan saat ini. Muat ulang untuk melihat keadaan terbaru sebelum mencoba lagi.','The change cannot be completed right now. Reload to see the latest state before trying again.'],
    ['Counter tidak dapat dibaca dari database.','Counters could not be read from the database.'],
    ['Setup standar tidak dapat diselesaikan saat ini.','Standard setup cannot be completed right now.'],
    ['Diagnostik tidak dapat diselesaikan saat ini.','Diagnostics cannot be completed right now.'],
    ['Format angka tidak dapat disimpan saat ini.','Number format cannot be saved right now.'],
    ['Permintaan tidak valid.','Invalid request.'],
    ['Konfirmasi diperlukan.','Confirmation is required.'],
    ['Parameter tidak valid.','Invalid parameter.'],
    ['Bot belum siap.','The bot is not ready.'],
  ]);
  const apiError = message => window.ZentixI18n?.language === 'en' ? (API_ERRORS.get(message) ?? message) : message;

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? apiError(data.error)) || tr('Permintaan gagal.','Request failed.'));
    return data;
  }

  function render() {
    return `<div id="serverStatsLive"><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Counter aktif','Active counters')}</h2>`
      + `<p>${tr('Channel yang namanya mengikuti jumlah anggota. Satu per jenis, ditambah maksimal 10 counter role dan 10 counter goal.','Channels whose names track counts. One per type, plus up to 10 role counters and 10 goal counters.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsList" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Setup standar','Standard setup')}</h2>`
      + `<p>${tr('Buat paket counter umum sekaligus. Jenis yang sudah ada dilewati; yang lain dibuat dengan nama yang benar sejak awal.','Create a bundle of common counters. Existing types are skipped; others are created with the correct names from the start.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsSetup" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Buat counter','Create counter')}</h2>`
      + `<p>${tr('Membuat channel baru di Discord, di kategori yang dipilih.','Creates a new Discord channel in the selected category.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsCreate" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Counter eksternal — game & sosial','External counters — game & social')}</h2>`
      + `<p>${tr('Pemain game yang sedang online dan pengikut akun sosial. Angka diambil dari layanan luar, bukan dari Discord; counter tampil "tidak diketahui" bila sumbernya tidak menjawab. Kunci API (kalau perlu) diisi owner di .env, bukan di sini.','Online game players and social account followers. Counts come from external services, not Discord; counters show "unknown" when the source does not respond. The owner sets API keys (if required) in .env, not here.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsExternal" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Format angka','Number format')}</h2>`
      + `<p>${tr('Cara bot menulis angka pada nama channel counter. Berlaku untuk semua counter di server ini.','How the bot writes numbers in counter channel names. Applies to all counters on this server.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsNotation" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Diagnostik','Diagnostics')}</h2>`
      + `<p>${tr('Periksa apakah counter berjalan: izin bot, jumlah yang terbaca, entri rusak. Tidak mengubah apa pun.','Check counters: bot permissions, readable counts, and invalid entries. Does not change anything.')}</p></div><span>✳</span></div>`
      + `<div id="serverStatsCheck"><button type="button" class="f-outline" id="serverStatsCheckBtn">${tr('PERIKSA ↗','CHECK ↗')}</button><div id="serverStatsCheckResult" aria-live="polite"></div></div></section>`
      + `<div class="f-callout">ⓘ &nbsp; ${tr('Discord membatasi seberapa sering nama channel boleh diganti, jadi angka pada nama channel dapat tertinggal beberapa menit dari jumlah sebenarnya. ','Discord limits how often channel names can be changed, so the count may lag behind by a few minutes. ')}`
      + `${tr('Ganti nama channel counter di Discord sesuai keinginan, asalkan ada angka di dalamnya — bot hanya mengganti angka itu. ','Rename the counter channel in Discord as you like, provided it contains a number — the bot only changes that number. ')}`
      + `${tr('Channel counter memakai izin kategorinya: kunci kategori bila anggota tidak boleh masuk atau menulis di sana.','Counter channels use their category permissions: lock the category if members should not enter or write there.')}</div></div>`;
  }

  function notationForm(data) {
    const options = NOTATION_OPTIONS.map((option) => `<label class="f-field f-radio-row"><input type="radio" name="notation" value="${esc(option.id)}"${option.id === data.notation ? ' checked' : ''}>`
      + `<span><b>${esc(option.label)}</b><small>${esc(option.hint)}</small></span></label>`).join('');
    return `<form class="f-form" id="serverStatsNotationForm"><div>${options}</div>`
      + `<div class="f-form-actions"><span>${tr('BERLAKU UNTUK SEMUA COUNTER','APPLIES TO ALL COUNTERS')}</span><button type="submit" class="f-primary">${tr('SIMPAN FORMAT ↗','SAVE FORMAT ↗')}</button></div></form>`;
  }

  /** What the page says about one counter, from the fields of the API. */
  function statusText(counter) {
    if (!counter.known) return tr('Jenis tidak dikenal; tidak diperbarui','Unknown type; not updated');
    if (counter.channelName === null) return tr('Channel tidak terlihat oleh bot; mungkin sudah dihapus di Discord','Channel is not visible to the bot; it may have been deleted in Discord');
    if (!counter.enabled) return tr('Nonaktif','Disabled');
    if (counter.botCanManage === false) return tr('Bot tidak dapat mengganti nama channel ini (perlu View Channel dan Manage Channels)','The bot cannot rename this channel (requires View Channel and Manage Channels)');
    if (counter.count === null) return counter.type === 'game' || counter.type === 'social'
      ? tr('Sumber luar belum menjawab (kunci, host, atau jaringan)','External source has not responded (key, host, or network)')
      : tr('Daftar anggota belum dapat dibaca','The member list cannot be read yet');
    if (counter.current) return tr('Sesuai jumlah saat ini','Matches current count');
    if (counter.nextRenameAt) return tr(`Menunggu batas ganti nama Discord, sekitar pukul ${clock(counter.nextRenameAt)}`,`Waiting for Discord rename limit, until around ${clock(counter.nextRenameAt)}`);
    return tr('Nama akan diperbarui pada penyegaran berikutnya','Name will be updated on the next refresh');
  }

  function refreshText(refresh) {
    switch (refresh?.status) {
      case 'renamed': case 'current': return tr('Nama channel sudah mengikuti.','Channel name is up to date.');
      case 'deferred': return tr(`Nama channel menyusul setelah batas ganti nama Discord${refresh.retryAt ? `, sekitar pukul ${clock(refresh.retryAt)}` : ''}.`,`The channel name will update after the Discord rename limit${refresh.retryAt ? `, around ${clock(refresh.retryAt)}` : ''}.`);
      case 'pending': case 'slow': return tr('Discord menahan pergantian nama; nama channel menyusul.','Discord is delaying the rename; the channel name will update later.');
      case 'no_permission': return tr('Bot tidak dapat mengganti nama channel itu (perlu View Channel dan Manage Channels).','The bot cannot rename that channel (requires View Channel and Manage Channels).');
      case 'count_unknown': return tr('Daftar anggota belum dapat dibaca; nama channel belum diganti.','The member list cannot be read yet; the channel name was not changed.');
      case 'missing': return tr('Channel itu sudah tidak ada di Discord.','That channel no longer exists in Discord.');
      default: return tr('Nama channel belum dapat diganti; akan dicoba lagi pada penyegaran berikutnya.','The channel name could not be changed; it will be retried on the next refresh.');
    }
  }

  function counterForm(counter, index, data) {
    const free = data.types.filter((type) => type.id !== 'role' && type.id !== 'goal' && type.id !== 'game' && type.id !== 'social' && (!type.taken || type.id === counter.type));
    const options = (counter.known ? [] : [`<option value="${esc(counter.type)}" selected>${esc(typeName(counter.type))}</option>`])
      .concat(free.map((type) => `<option value="${esc(type.id)}"${type.id === counter.type ? ' selected' : ''}>${esc(typeName(type.id))}</option>`)).join('');
    const name = counter.channelName === null ? tr('Channel tidak terlihat','Channel not visible') : counter.channelName;
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
      ? ` · Role: ${counter.roleName ? esc(counter.roleName) : `<span class="f-warn">${tr('sudah dihapus — counter ini bisa dihapus','deleted — this counter can be removed')}</span>`}`
      : counter.type === 'goal'
        ? ` · Target: <b>${esc(counter.goal)}</b> (stat ${esc(typeName(counter.goalStat))})`
        : bindingLine();
    return `<form class="f-form" data-counter="${index}"><h3>${esc(name)}</h3>`
      + `<p class="f-muted">${esc(KIND_NAMES[counter.channelType] || tr('Jenis channel tidak diketahui','Unknown channel type'))} · ID counter ${esc(counter.id)} · ID channel ${esc(counter.channelId)}${roleLine}</p>`
      + `<p><b>${tr('Jumlah saat ini:','Current count:')}</b> ${counter.count === null ? tr('tidak diketahui','unknown') : esc(counter.count)} &nbsp;·&nbsp; <b>Status:</b> ${esc(statusText(counter))}</p>`
      + `<label class="f-field"><span><b>${tr('Jenis hitungan','Count type')}</b><small>${tr('Jenis yang sudah dipakai counter lain tidak ditawarkan.','Types already used by another counter are not offered.')}</small></span><select name="type" aria-label="${esc(tr(`Jenis hitungan ${name} (ID counter ${counter.id})`,`Count type for ${name} (counter ID ${counter.id})`))}">${options}</select></label>`
      + `<div class="f-form-actions"><button type="button" class="f-outline" data-delete="${index}" aria-label="${esc(tr(`Hapus counter dan channel ${name} (ID counter ${counter.id})`,`Delete counter and channel ${name} (counter ID ${counter.id})`))}">${tr('HAPUS COUNTER & CHANNEL','DELETE COUNTER & CHANNEL')}</button>`
      + `<button type="submit" class="f-primary" aria-label="${esc(tr(`Ubah jenis counter ${name} (ID counter ${counter.id})`,`Change type for counter ${name} (counter ID ${counter.id})`))}">${tr('UBAH JENIS ↗','CHANGE TYPE ↗')}</button></div></form>`;
  }

  function createForm(data) {
    const rolesAvailable = (data.roles ?? []).length > 0;
    const free = data.types.filter((type) => !type.taken && type.id !== 'game' && type.id !== 'social' && (type.id !== 'role' || rolesAvailable));
    if (!free.length) return `<p class="f-muted">${tr('Semua jenis counter sudah dipakai. Hapus salah satu untuk membuat yang baru.','All counter types are in use. Delete one to create a new one.')}</p>`;
    if (!data.categories.length) return `<p class="f-muted">${tr('Bot tidak melihat kategori di server ini. Buat kategori di Discord terlebih dahulu.','The bot cannot see a category on this server. Create one in Discord first.')}</p>`;
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : tr(' (izin bot kurang)',' (bot lacks permissions)')}</option>`).join('');
    const roleOptions = (data.roles ?? []).map((role) => `<option value="${esc(role.id)}">${esc(role.name)}${role.managed ? ' (bot)' : ''}</option>`).join('');
    return `<form class="f-form" id="serverStatsCreateForm">`
      + `<label class="f-field"><span><b>${tr('Jenis hitungan','Count type')}</b><small>${tr('Apa yang dihitung pada nama channel.','What the channel name counts.')}</small></span>`
      + `<select name="type">${free.map((type) => `<option value="${esc(type.id)}">${esc(typeName(type.id))}</option>`).join('')}</select></label>`
      + `<label class="f-field" id="serverStatsRoleField" hidden><span><b>Role</b><small>${tr('Wajib untuk counter jenis "Role tertentu"; jumlah anggota dengan role itu.','Required for a specific role counter; counts members with that role.')}</small></span>`
      + `<select name="roleId"><option value="">${tr('Pilih role','Choose role')}</option>${roleOptions}</select></label>`
      + `<label class="f-field" id="serverStatsGoalStatField" hidden><span><b>Stat</b><small>${tr('Stat yang dilacak oleh counter Goal ini.','Stat tracked by this goal counter.')}</small></span>`
      + `<select name="goalStat"><option value="">${tr('Pilih stat','Choose stat')}</option>${(data.goalStats ?? []).map((stat) => `<option value="${esc(stat.id)}">${esc(TYPE_NAMES[stat.id] ?? stat.label)}</option>`).join('')}</select></label>`
      + `<label class="f-field" id="serverStatsGoalTargetField" hidden><span><b>Target</b><small>${tr('Bilangan bulat minimal 1, mis. 2000 untuk "Anggota 1.204 / 2.000". Nama channel menampilkan angka saat ini dibanding target.','Integer of at least 1, e.g. 2000 for "Members 1,204 / 2,000". The channel name shows the current count against the target.')}</small></span>`
      + `<input type="number" name="goal" min="1" max="2000000000" step="1" inputmode="numeric" placeholder="2000"></label>`
      + `<label class="f-field"><span><b>${tr('Jenis channel','Channel type')}</b><small>${tr('Channel suara disarankan: namanya tampil apa adanya.','Voice channels are recommended: their names appear as written.')}</small></span>`
      + `<select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>${tr('Kategori','Category')}</b><small>${tr('Bot memerlukan View Channel dan Manage Channels di kategori itu.','The bot needs View Channel and Manage Channels in that category.')}${data.categoriesTruncated ? tr(' Daftar dipotong; kategori yang tidak tampil mungkin dibatasi oleh izin bot.',' List truncated; missing categories may be restricted by bot permissions.') : ''}</small></span>`
      + `<select name="categoryId"><option value="">${tr('Pilih kategori','Choose category')}</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>${tr('MEMBUAT CHANNEL DI DISCORD','CREATES A DISCORD CHANNEL')}</span><button type="submit" class="f-primary">${tr('BUAT COUNTER ↗','CREATE COUNTER ↗')}</button></div></form>`;
  }

  const GAME_PROVIDER_LABELS = { steam: 'Steam (AppID)', minecraft: 'Minecraft Java (host)', fivem: 'FiveM / FXServer (host)' };
  const SOCIAL_PLATFORM_LABELS = { youtube: 'YouTube (channel UC…)', twitch: 'Twitch (login)', x: 'X / Twitter (username)', instagram: tr('Instagram bisnis (ID angka)','Instagram business (numeric ID)') };

  /** Keys line + two creation forms; the counters themselves render in the "Counter aktif" list above. */
  function externalForm(data) {
    const ext = data.external ?? { gameProviders: [], socialPlatforms: [], keysPresent: {}, missing: {} };
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : tr(' (izin bot kurang)',' (bot lacks permissions)')}</option>`).join('');
    const keysLine = Object.entries(ext.keysPresent ?? {}).map(([name, present]) =>
      `<code>${esc(name)}</code> ${present ? tr('✓ terbaca','✓ available') : tr('✗ kosong','✗ empty')}`).join(' &nbsp;·&nbsp; ');
    const missingNote = (platform) => {
      const missing = ext.missing?.[platform] ?? [];
      return missing.length
        ? `<small class="f-warn">${tr('Belum ada di .env:','Missing from .env:')} ${missing.map((name) => `<code>${esc(name)}</code>`).join(', ')} ${tr('— counternya bisa dibuat, angkanya tampil "tidak diketahui" sampai kuncinya diisi.','— the counter can be created; the count shows "unknown" until the keys are supplied.')}</small>`
        : `<small>${tr('Kunci tersedia di .env.','Keys available in .env.')}</small>`;
    };
    return `<p class="f-muted">${tr('Kunci owner di .env:','Owner keys in .env:')} ${keysLine || tr('tidak ada yang diperlukan','none required')}. ${tr('Kunci tidak pernah ditampilkan nilainya.','Key values are never displayed.')}</p>`
      + `<form class="f-form" id="serverStatsGameForm" style="margin-bottom:16px"><h3>🎮 Game</h3>`
      + `<p class="f-muted">${tr('Steam butuh AppID game (mis. 730 = CS2); Minecraft/FiveM butuh alamat server yang DAPAT DIAKSES PUBLIK (maks. 10 counter game).','Steam needs the game AppID (e.g. 730 = CS2); Minecraft/FiveM needs a PUBLICLY ACCESSIBLE server address (maximum 10 game counters).')}</p>`
      + `<label class="f-field"><span><b>Provider</b></span><select name="provider">${Object.entries(GAME_PROVIDER_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>`
      + `<label class="f-field" data-game="steam"><span><b>AppID Steam</b><small>${tr('Angka dari halaman game di store.steampowered.com.','Number from the game page on store.steampowered.com.')}</small></span><input type="number" name="appId" min="1" step="1" inputmode="numeric" placeholder="730"></label>`
      + `<label class="f-field" data-game="host" hidden><span><b>${tr('Alamat server','Server address')}</b><small>${tr('Domain publik atau IP publik, tanpa http:// — mis. mc.contoh.com. Tidak boleh alamat lokal/privat.','Public domain or IP, without http:// — e.g. mc.example.com. Local/private addresses are not allowed.')}</small></span><input type="text" name="host" maxlength="253" autocomplete="off" placeholder="${tr('mc.contoh.com','mc.example.com')}"></label>`
      + `<label class="f-field" data-game="host" hidden><span><b>Port</b><small>${tr('Kosong = default (Minecraft 25565, FiveM 30120).','Leave blank for default (Minecraft 25565, FiveM 30120).')}</small></span><input type="number" name="port" min="1" max="65535" step="1" inputmode="numeric" placeholder="25565"></label>`
      + `<label class="f-field"><span><b>Label</b><small>${tr('Nama pendek pada channel counter, mis. "CS2" atau "Server MC" (maks. 30 karakter).','Short name on the counter channel, e.g. "CS2" or "MC Server" (maximum 30 characters).')}</small></span><input type="text" name="label" maxlength="30" required placeholder="CS2"></label>`
      + `<label class="f-field"><span><b>${tr('Jenis channel','Channel type')}</b></span><select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>${tr('Kategori','Category')}</b></span><select name="categoryId"><option value="">${tr('Pilih kategori','Choose category')}</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>${tr('MEMBUAT CHANNEL DI DISCORD','CREATES A DISCORD CHANNEL')}</span><button type="submit" class="f-primary">${tr('BUAT COUNTER GAME ↗','CREATE GAME COUNTER ↗')}</button></div></form>`
      + `<form class="f-form" id="serverStatsSocialForm"><h3>${tr('🔗 Sosial','🔗 Social')}</h3>`
      + `<p class="f-muted">${tr('Pengikut akun sosial kamu (maks. 10 counter sosial). Masing-masing butuh kunci owner di .env.','Your social account followers (maximum 10 social counters). Each requires an owner key in .env.')}</p>`
      + `<label class="f-field"><span><b>Platform</b></span><select name="platform">${Object.entries(SOCIAL_PLATFORM_LABELS).map(([id, label]) => `<option value="${id}">${esc(label)}</option>`).join('')}</select></label>`
      + `<p class="f-muted" id="serverStatsSocialKeyNote">${missingNote('youtube')}</p>`
      + `<label class="f-field" data-social="youtube"><span><b>Channel ID YouTube</b><small>${tr('UC… (Channel → Tentang → ID).','UC… (Channel → About → ID).')}</small></span><input type="text" name="channelId" maxlength="24" autocomplete="off" placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"></label>`
      + `<label class="f-field" data-social="twitch" hidden><span><b>Login Twitch</b><small>${tr('Nama login channel, huruf kecil.','Channel login name, lowercase.')}</small></span><input type="text" name="login" maxlength="25" autocomplete="off" placeholder="${tr('namaakun','accountname')}"></label>`
      + `<label class="f-field" data-social="x" hidden><span><b>Username X</b><small>${tr('Tanpa @.','Without @.')}</small></span><input type="text" name="username" maxlength="15" autocomplete="off" placeholder="${tr('akun','account')}"></label>`
      + `<label class="f-field" data-social="instagram" hidden><span><b>${tr('ID akun bisnis Instagram','Instagram business account ID')}</b><small>${tr('ID ANGKA akun bisnis/kreator (bukan username). Token owner di .env harus boleh membaca akun ini.','NUMERIC ID of the business/creator account (not username). The owner token in .env must be allowed to read this account.')}</small></span><input type="text" name="userId" maxlength="25" autocomplete="off" inputmode="numeric" placeholder="17841400000000000"></label>`
      + `<label class="f-field"><span><b>Label</b><small>${tr('Nama pendek pada channel counter (maks. 30 karakter).','Short name on the counter channel (maximum 30 characters).')}</small></span><input type="text" name="label" maxlength="30" required placeholder="YouTube"></label>`
      + `<label class="f-field"><span><b>${tr('Jenis channel','Channel type')}</b></span><select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<label class="f-field"><span><b>${tr('Kategori','Category')}</b></span><select name="categoryId"><option value="">${tr('Pilih kategori','Choose category')}</option>${categories}</select></label>`
      + `<div class="f-form-actions"><span>${tr('MEMBUAT CHANNEL DI DISCORD','CREATES A DISCORD CHANNEL')}</span><button type="submit" class="f-primary">${tr('BUAT COUNTER SOSIAL ↗','CREATE SOCIAL COUNTER ↗')}</button></div></form>`;
  }

  function setupForm(data) {
    if (!data.categories.length) return `<p class="f-muted">${tr('Bot tidak melihat kategori di server ini. Buat kategori di Discord terlebih dahulu.','The bot cannot see a category on this server. Create one in Discord first.')}</p>`;
    const categories = data.categories.map((category) => `<option value="${esc(category.id)}"${category.usable ? '' : ' disabled'}>`
      + `${esc(category.name)}${category.usable ? '' : tr(' (izin bot kurang)',' (bot lacks permissions)')}</option>`).join('');
    return `<form class="f-form" id="serverStatsSetupForm">`
      + `<p class="f-muted">${tr('Bundle membuat counter:','Bundle creates counters:')} ${STANDARD_BUNDLE_NAMES}.</p>`
      + `<label class="f-field"><span><b>${tr('Kategori','Category')}</b><small>${tr('Ke mana channel counter dibuat.','Where counter channels are created.')}</small></span>`
      + `<select name="categoryId"><option value="">${tr('Pilih kategori','Choose category')}</option>${categories}</select></label>`
      + `<label class="f-field"><span><b>${tr('Jenis channel','Channel type')}</b><small>${tr('Channel suara disarankan: namanya tampil apa adanya.','Voice channels are recommended: their names appear as written.')}</small></span>`
      + `<select name="channelType"><option value="voice">${KIND_NAMES.voice}</option><option value="text">${KIND_NAMES.text}</option></select></label>`
      + `<div class="f-form-actions"><span>${tr('MEMBUAT SAMPAI 6 CHANNEL','CREATES UP TO 6 CHANNELS')}</span><button type="submit" class="f-primary">${tr('SETUP STANDAR ↗','STANDARD SETUP ↗')}</button></div></form>`;
  }

  // Diagnostic text is owned by the bot. Match both the issue code and the complete
  // message so new or custom diagnostics are never silently rewritten.
  const CHECK_TEXT = new Map([
    ['missing\0Channel tidak terlihat oleh bot atau sudah dihapus di Discord; catatannya akan dibersihkan oleh pengecekan terjadwal.','The channel is not visible to the bot or was deleted in Discord; its record will be cleaned up by the scheduled check.'],
    ['no_permission\0Bot tidak dapat mengganti nama channel ini (butuh izin View Channel dan Manage Channels).','The bot cannot rename this channel (requires View Channel and Manage Channels permissions).'],
    ['member_list\0Daftar anggota tidak dapat diambil — periksa izin intent Guild Members (privileged) di Discord Developer Portal.','Could not fetch members — check the privileged Guild Members intent in the Discord Developer Portal.'],
    ['bans\0Daftar ban tidak dapat dibaca oleh bot.','The bot cannot read the ban list.'],
    ['emojis\0Emoji atau sticker server tidak dapat diambil.','Server emoji or stickers could not be fetched.'],
    ['count_unknown\0Angka ini belum dapat diketahui saat ini.','This count is currently unavailable.'],
    ['disabled\0Counter nonaktif; tidak diperbarui sampai diaktifkan lagi.','The counter is disabled and will not update until it is enabled again.'],
    ['rename_pending\0Menunggu batas ganti nama Discord; nama channel menyusul.','Waiting for the Discord rename limit; the channel name will update later.'],
    ['stale\0Nama channel belum mengikuti jumlah terkini; akan disesuaikan pada penyegaran berikutnya.','The channel name does not yet match the current count; it will be updated on the next refresh.'],
    ['role_missing\0Role untuk counter ini sudah tidak ada di server; hapus counternya atau buat yang baru untuk role lain.','The role for this counter no longer exists on the server; delete the counter or create one for another role.'],
    ['presence\0Status anggota tidak bisa dibaca. Aktifkan Presence Intent di Discord Developer Portal (Bot → Privileged Gateway Intents) lalu set ZENTIX_PRESENCE_INTENT=1 di .env dan restart bot.','Member presence cannot be read. Enable Presence Intent in the Discord Developer Portal (Bot → Privileged Gateway Intents), then set ZENTIX_PRESENCE_INTENT=1 in .env and restart the bot.'],
    ['external_key\0Counter sosial ini butuh kunci API yang belum ada di .env. Isi kuncinya lalu mulai ulang bot; tanpa itu angkanya memang tidak bisa dibaca.','This social counter needs an API key missing from .env. Add the key and restart the bot; without it the count cannot be read.'],
    ['external\0Angka di luar Discord belum bisa diambil sekarang (host tidak menjawab, kunci ditolak, atau jaringan bermasalah). Coba lagi nanti; pastikan konfigurasinya benar di dashboard.','The external count cannot currently be fetched (host not responding, key rejected, or network problem). Try again later and check the dashboard configuration.'],
  ]);
  const checkText = counter => window.ZentixI18n?.language === 'en' ? (CHECK_TEXT.get(`${counter.issue}\0${counter.text}`) ?? counter.text) : counter.text;

  const LEVEL_NAMES = { error: tr('MASALAH','ISSUE'), warn: tr('CATATAN','NOTE'), info: 'INFO' };

  /** The diagnostic report as safe HTML lines. */
  function renderCheck(report) {
    const checked = Number.isInteger(report.checked) ? tr(` (${report.checked} counter diperiksa.)`,` (${report.checked} counters checked.)`) : '';
    const lines = [`<p class="f-muted" role="status">${esc(report.ok ? tr(`Semua counter tampak beres.${checked}`,`All counters appear OK.${checked}`) : tr('Ada hal yang perlu diperhatikan.','Some items need attention.'))}</p>`];
    if (report.memberList === 'failed') lines.push(`<p>• ${tr('Daftar anggota tidak dapat diambil — periksa izin intent Guild Members (privileged) di Discord Developer Portal.','Could not fetch members — check the privileged Guild Members intent in the Discord Developer Portal.')}</p>`);
    if (report.rejected > 0) lines.push(`<p>• ${esc(report.rejected)} ${tr('entri tersimpan tidak dapat dibaca dan tidak akan ditampilkan atau diubah.','saved entries could not be read and will not be displayed or modified.')}</p>`);
    for (const counter of report.counters) {
      const name = counter.type === null ? 'Server' : (TYPE_NAMES[counter.type] || counter.type);
      lines.push(`<p>• [${LEVEL_NAMES[counter.level] || esc(counter.level)}] ${esc(name)} — ${esc(checkText(counter))}</p>`);
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
        checkResult.textContent = tr('Memeriksa…','Checking…');
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
      list.textContent = tr('Memuat…','Loading…');
      create.textContent = tr('Memuat…','Loading…');
      let data;
      try {
        data = await request();
      } catch (error) {
        if (!list.isConnected) return;
        list.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="f-outline" id="serverStatsRetry">${tr('COBA LAGI ↻','RETRY ↻')}</button>`;
        list.querySelector('#serverStatsRetry').onclick = () => load();
        create.innerHTML = `<p class="f-muted">${tr('Tidak tersedia sampai daftar counter dapat dibaca.','Unavailable until the counter list can be read.')}</p>`;
        if (notationBox.isConnected) notationBox.innerHTML = `<p class="f-muted">${tr('Tidak tersedia.','Unavailable.')}</p>`;
        if (setupBox.isConnected) setupBox.innerHTML = `<p class="f-muted">${tr('Tidak tersedia.','Unavailable.')}</p>`;
        if (externalBox?.isConnected) externalBox.innerHTML = `<p class="f-muted">${tr('Tidak tersedia.','Unavailable.')}</p>`;
        return;
      }
      if (!list.isConnected) return;

      const note = `<p id="serverStatsStatus" class="f-muted" role="status">${esc(message)}</p>`;
      const rejected = data.rejected > 0 ? `<p role="alert">${esc(data.rejected)} ${tr('entri tersimpan tidak dapat dibaca dan tidak ditampilkan.','saved entries could not be read and are not displayed.')}</p>` : '';
      list.innerHTML = note + rejected + (data.counters.length
        ? data.counters.map((counter, index) => counterForm(counter, index, data)).join('')
        : `<p class="f-muted">${tr('Belum ada counter.','No counters yet.')}</p>`)
        + `<div class="f-form-actions"><button type="button" class="f-outline" id="serverStatsReload">${tr('MUAT ULANG ↻','RELOAD ↻')}</button></div>`;
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
        where.textContent = tr('Memproses…','Processing…');
        let result;
        try {
          result = await run();
        } catch (error) {
          if (!list.isConnected) return;
          controls.forEach((control) => { control.disabled = false; });
          where.textContent = `${error.message} ${tr('Bila hasilnya tidak jelas, muat ulang dan periksa sebelum mengulang.','If the result is unclear, reload and check before retrying.')}`;
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
        form.onsubmit = async (event) => {
          event.preventDefault();
          const type = form.elements.type.value;
          if (type === counter.type) { status.textContent = tr('Jenis tidak berubah.','Type unchanged.'); return; }
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Ubah counter ${counter.channelName ?? counter.id} menjadi "${typeName(type)}"? Nama channel di Discord akan ikut berubah.`,`Change counter ${counter.channelName ?? counter.id} to "${typeName(type)}"? Its Discord channel name will also change.`)) : Promise.resolve(window.confirm(tr(`Ubah counter ${counter.channelName ?? counter.id} menjadi "${typeName(type)}"? Nama channel di Discord akan ikut berubah.`,`Change counter ${counter.channelName ?? counter.id} to "${typeName(type)}"? Its Discord channel name will also change.`)))))) return;
          change(status, () => request('PATCH', '/counters/' + encodeURIComponent(counter.id), { confirmed: true, revision: data.revision, type }),
            (result) => `${tr('Jenis counter diubah.','Counter type changed.')} ${refreshText(result.refresh)}`);
        };
        form.querySelector('[data-delete]').onclick = async () => {
          const target = counter.channelName === null ? tr('Channel-nya tidak terlihat oleh bot; hanya catatan counter yang dihapus bila channel memang sudah tidak ada.','The channel is not visible to the bot; only the counter record is deleted if the channel no longer exists.')
            : tr(`Channel "${counter.channelName}" DIHAPUS dari Discord dan tidak dapat dikembalikan.`,`Channel "${counter.channelName}" will be DELETED from Discord and cannot be restored.`);
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Hapus counter ${counter.id}? ${target}`,`Delete counter ${counter.id}? ${target}`)) : Promise.resolve(window.confirm(tr(`Hapus counter ${counter.id}? ${target}`,`Delete counter ${counter.id}? ${target}`)))))) return;
          change(status, () => request('DELETE', '/counters/' + encodeURIComponent(counter.id), { confirmed: true, revision: data.revision }),
            (result) => (result.channelDeleted ? tr('Counter dan channel-nya dihapus.','Counter and its channel deleted.') : result.channelKept
              ? tr('Counter dihapus. Channel-nya bukan channel suara atau teks, jadi tidak dihapus.','Counter deleted. Its channel is not a voice or text channel, so it was not deleted.') : tr('Counter dihapus. Channel-nya sudah tidak ada.','Counter deleted. Its channel no longer existed.')));
        };
      });

      const notationStatus = notationBox.querySelector('#serverStatsNotationStatus');
      const notationFormEl = notationBox.querySelector('#serverStatsNotationForm');
      if (notationFormEl) {
        notationFormEl.onsubmit = (event) => {
          event.preventDefault();
          const chosen = notationFormEl.elements.notation.value;
          const chosenOption = NOTATION_OPTIONS.find((option) => option.id === chosen);
          if (!chosenOption) { notationStatus.textContent = tr('Format angka tidak dikenal.','Unknown number format.'); return; }
          change(notationStatus, () => request('PUT', '/notation', { notation: chosen }),
            () => `${tr('Format angka disimpan:','Number format saved:')} ${chosenOption.label}.`);
        };
      }

      const setupStatus = setupBox.querySelector('#serverStatsSetupStatus');
      const setupFormEl = setupBox.querySelector('#serverStatsSetupForm');
      if (setupFormEl) {
        setupFormEl.onsubmit = async (event) => {
          event.preventDefault();
          const body = { confirmed: true, categoryId: setupFormEl.elements.categoryId.value, channelType: setupFormEl.elements.channelType.value };
          if (!body.categoryId) { setupStatus.textContent = tr('Pilih kategori terlebih dahulu.','Choose a category first.'); return; }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Buat bundle counter standar di kategori "${category?.name ?? body.categoryId}"? Jenis yang sudah ada dilewati.`,`Create the standard counter bundle in category "${category?.name ?? body.categoryId}"? Existing types are skipped.`)) : Promise.resolve(window.confirm(tr(`Buat bundle counter standar di kategori "${category?.name ?? body.categoryId}"? Jenis yang sudah ada dilewati.`,`Create the standard counter bundle in category "${category?.name ?? body.categoryId}"? Existing types are skipped.`)))))) return;
          change(setupStatus, () => request('POST', '/setup', body),
            (result) => tr(`Setup selesai: ${result.created} dibuat, ${result.skipped} sudah ada, ${result.failed} gagal. Muat ulang untuk hasilnya.`,`Setup finished: ${result.created} created, ${result.skipped} already existed, ${result.failed} failed. Reload for results.`));
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
        form.onsubmit = async (event) => {
          event.preventDefault();
          const body = { confirmed: true, type: form.elements.type.value, channelType: form.elements.channelType.value, categoryId: form.elements.categoryId.value };
          if (!body.categoryId) { createStatus.textContent = tr('Pilih kategori terlebih dahulu.','Choose a category first.'); return; }
          let confirmType;
          if (body.type === 'role') {
            body.roleId = form.elements.roleId.value;
            if (!body.roleId) { createStatus.textContent = tr('Pilih role terlebih dahulu.','Choose a role first.'); return; }
            const role = (data.roles ?? []).find((entry) => entry.id === body.roleId);
            confirmType = `${typeName('role')} "${role?.name ?? body.roleId}"`;
          } else if (body.type === 'goal') {
            body.goalStat = form.elements.goalStat.value;
            const target = Number(form.elements.goal.value);
            if (!body.goalStat) { createStatus.textContent = tr('Pilih stat untuk goal ini.','Choose a stat for this goal.'); return; }
            if (!Number.isSafeInteger(target) || target < 1 || target > 2000000000) { createStatus.textContent = tr('Target harus bilangan bulat antara 1 dan 2.000.000.000.','Target must be an integer between 1 and 2,000,000,000.'); return; }
            body.goal = target;
            confirmType = `Goal ${typeName(body.goalStat)} ${tr('menuju','towards')} ${target.toLocaleString(tr('id-ID','en-US'))}`;
          } else {
            confirmType = `"${typeName(body.type)}"`;
          }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} baru di kategori "${category?.name ?? body.categoryId}" untuk counter ${confirmType}?`,`Create a new ${KIND_NAMES[body.channelType].toLowerCase()} in category "${category?.name ?? body.categoryId}" for counter ${confirmType}?`)) : Promise.resolve(window.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} baru di kategori "${category?.name ?? body.categoryId}" untuk counter ${confirmType}?`,`Create a new ${KIND_NAMES[body.channelType].toLowerCase()} in category "${category?.name ?? body.categoryId}" for counter ${confirmType}?`)))))) return;
          change(createStatus, () => request('POST', '/counters', body),
            (result) => `${tr('Counter dibuat: channel','Counter created: channel')} "${result.channelName}".${result.count === null ? tr(' Angkanya ditambahkan setelah daftar anggota terbaca.',' The count will be added when the member list is readable.') : ''}`);
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
        gameFormEl.onsubmit = async (event) => {
          event.preventDefault();
          const provider = gameFormEl.elements.provider.value;
          const body = { confirmed: true, type: 'game', provider, label: gameFormEl.elements.label.value.trim(), channelType: gameFormEl.elements.channelType.value, categoryId: gameFormEl.elements.categoryId.value };
          if (!body.categoryId) { externalStatus.textContent = tr('Pilih kategori terlebih dahulu.','Choose a category first.'); return; }
          if (provider === 'steam') {
            const appId = Number(gameFormEl.elements.appId.value);
            if (!Number.isSafeInteger(appId) || appId < 1) { externalStatus.textContent = tr('AppID Steam harus angka positif.','Steam AppID must be a positive number.'); return; }
            body.appId = appId;
          } else {
            body.host = gameFormEl.elements.host.value.trim();
            const rawPort = gameFormEl.elements.port.value.trim();
            if (rawPort !== '') body.port = Number(rawPort);
            if (!body.host) { externalStatus.textContent = tr('Isi alamat server.','Enter a server address.'); return; }
          }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter game "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`,`Create a ${KIND_NAMES[body.channelType].toLowerCase()} for game counter "${body.label}" in category "${category?.name ?? body.categoryId}"?`)) : Promise.resolve(window.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter game "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`,`Create a ${KIND_NAMES[body.channelType].toLowerCase()} for game counter "${body.label}" in category "${category?.name ?? body.categoryId}"?`)))))) return;
          change(externalStatus, () => request('POST', '/counters', body),
            (result) => `${tr('Counter game dibuat: channel','Game counter created: channel')} "${result.channelName}".${result.count === null ? tr(' Angkanya menyusul saat sumbernya menjawab.',' The count will follow when the source responds.') : ''}`);
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
              ? `<small class="f-warn">${tr('Belum ada di .env:','Missing from .env:')} ${missing.map((name) => `<code>${esc(name)}</code>`).join(', ')} ${tr('— angkanya tampil "tidak diketahui" sampai kuncinya diisi.','— the count shows "unknown" until the keys are supplied.')}</small>`
              : `<small>${tr('Kunci tersedia di .env.','Keys available in .env.')}</small>`;
          }
        };
        socialFormEl.elements.platform.addEventListener('change', syncSocial);
        syncSocial();
        socialFormEl.onsubmit = async (event) => {
          event.preventDefault();
          const platform = socialFormEl.elements.platform.value;
          const body = { confirmed: true, type: 'social', platform, label: socialFormEl.elements.label.value.trim(), channelType: socialFormEl.elements.channelType.value, categoryId: socialFormEl.elements.categoryId.value };
          if (!body.categoryId) { externalStatus.textContent = tr('Pilih kategori terlebih dahulu.','Choose a category first.'); return; }
          const targetField = { youtube: 'channelId', twitch: 'login', x: 'username', instagram: 'userId' }[platform];
          body[targetField] = socialFormEl.elements[targetField].value.trim();
          if (!body[targetField]) { externalStatus.textContent = tr('Isi target akun terlebih dahulu.','Enter an account target first.'); return; }
          const category = data.categories.find((entry) => entry.id === body.categoryId);
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter sosial "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`,`Create a ${KIND_NAMES[body.channelType].toLowerCase()} for social counter "${body.label}" in category "${category?.name ?? body.categoryId}"?`)) : Promise.resolve(window.confirm(tr(`Buat ${KIND_NAMES[body.channelType].toLowerCase()} untuk counter sosial "${body.label}" di kategori "${category?.name ?? body.categoryId}"?`,`Create a ${KIND_NAMES[body.channelType].toLowerCase()} for social counter "${body.label}" in category "${category?.name ?? body.categoryId}"?`)))))) return;
          change(externalStatus, () => request('POST', '/counters', body),
            (result) => `${tr('Counter sosial dibuat: channel','Social counter created: channel')} "${result.channelName}".${result.count === null ? tr(' Angkanya menyusul saat sumbernya menjawab.',' The count will follow when the source responds.') : ''}`);
        };
      }
    }

    load();
  }

  window.ZentixServerStats = { render, bind };
})();
