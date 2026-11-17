/* Self-role panels on the logged-in dashboard. This page acts on Discord: creating or reposting a panel
   sends a message, changing it edits that message, deleting it deletes the message. */
(() => {
  const API = '/dashboard/api/bot/self-roles';
  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = {
    ok: 'Aktif di Discord',
    message_missing: 'Pesan panel sudah dihapus di Discord — pasang ulang untuk memakainya lagi',
    channel_missing: 'Channel panel sudah tidak ada — hapus panel ini lalu buat panel baru',
    unknown: 'Belum dapat diperiksa di Discord saat ini',
  };
  /** What happened to the posted message after a stored change, from the `message` field of the API. */
  const REDRAW = {
    updated: 'Pesan panel di Discord sudah mengikuti.',
    missing: 'Tersimpan, tetapi pesan panelnya sudah tidak ada di Discord. Pasang ulang panel.',
    channel_missing: 'Tersimpan, tetapi channel panelnya sudah tidak ada.',
    no_roles: 'Tersimpan, tetapi tidak ada lagi role panel yang masih ada di server, jadi pesannya tidak diubah.',
  };
  const redrawText = (state) => REDRAW[state] || 'Tersimpan, tetapi pesan panel belum dapat diperbarui. Tekan SEGARKAN PESAN untuk mencoba lagi.';
  /** Only a Discord message link is turned into a link. */
  const messageLink = (url) => (typeof url === 'string' && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(url)
    ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">buka pesan ↗</a>` : '');
  /** An uploaded banner lives inside the panel message: it is not a link anyone can open. */
  const bannerText = (url) => {
    if (!url) return null;
    if (String(url).startsWith('attachment://')) return '<p><b>Banner:</b> unggahan tersimpan ✓</p>';
    return `<p><b>Banner:</b> <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">lihat gambar ↗</a></p>`;
  };
  const PREVIEW_ACCENT = '#99aab5';
  const STYLE_COLORS = { Primary: '#5865f2', Secondary: '#4e5058', Success: '#248046', Danger: '#da373c' };
  const safeObjectUrl = (file) => (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);

  /** The (empty) preview card markup; filled by paintPreview. Not a form control. */
  function previewShell() {
    return `<div style="margin:14px 0;max-width:440px">`
      + `<p class="f-muted" style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em">Pratinjau tampilan pesan</p>`
      + `<div data-card style="background:#2b2d31;border:1px solid #1e1f22;border-left:4px solid ${PREVIEW_ACCENT};border-radius:14px;overflow:hidden;color:#dbdee1"></div>`
      + `<p class="f-muted" style="margin:6px 0 0;font-size:11px">Mode perilaku tidak terlihat di pesan. Isi form di atas mengubah pratinjau ini.</p>`
      + `</div>`;
  }

  /** Paints the preview card inside `scope` (the create form, or a panel block). `roles` resolves names. */
  function paintPreview(scope, roles) {
    const card = scope.querySelector('[data-card]');
    if (!card) return;
    const isCreate = scope.matches('form');
    const settings = isCreate ? scope : scope.querySelector('form[data-text]');
    if (!settings) return;
    const roleNameOf = (id) => { const found = roles.find((role) => role.id === id); return found ? roleName(found) : 'Role terhapus'; };

    const title = settings.elements.title.value.trim() || 'Self-Role';
    const description = settings.elements.description.value.trim() || 'Select your roles.';
    const interactionType = settings.elements.interactionType.value;
    const behaviorMode = settings.elements.behaviorMode.value;
    const maxSelect = Math.max(1, Math.min(25, Number(settings.elements.maxSelect?.value) || 1));
    const placeholder = settings.elements.dropdownPlaceholder?.value.trim() || 'Select your roles';
    const accentRaw = (settings.elements.accentColor.value || '').trim();
    const accent = /^#?[0-9a-fA-F]{6}$/.test(accentRaw) ? '#' + accentRaw.replace(/^#/, '') : PREVIEW_ACCENT;

    // Banner: the file input wins (it is what the save sends), then a typed URL, then a stored upload.
    let bannerHtml = '';
    const file = settings.elements.bannerFile?.files?.[0] ?? null;
    const url = settings.elements.bannerUrl.value.trim();
    if (file) {
      if (scope.__objectUrl) URL.revokeObjectURL(scope.__objectUrl);
      const objectUrl = safeObjectUrl(file);
      scope.__objectUrl = objectUrl;
      if (objectUrl) bannerHtml = `<img src="${esc(objectUrl)}" alt="" style="display:block;width:100%;max-height:180px;object-fit:cover">`;
    } else if (/^https:\/\//.test(url)) {
      bannerHtml = `<img src="${esc(url)}" alt="" style="display:block;width:100%;max-height:180px;object-fit:cover" onerror="this.style.display='none'">`;
    } else if (scope.__storedBannerUpload === true && !settings.elements.bannerClear?.checked) {
      bannerHtml = `<div style="padding:18px;text-align:center;color:#dbdee1;border-bottom:1px dashed #3f4147">Banner unggahan tersimpan akan dipakai</div>`;
    }

    // Items, in display order.
    let items;
    if (isCreate) {
      items = [...scope.querySelectorAll('input[name="roleIds"]:checked')].map((box) => {
        const name = roleNameOf(box.value);
        return { name, label: name, description: '', emoji: scope.elements[`emoji-${box.value}`]?.value.trim() || '🎭', buttonStyle: 'Primary' };
      });
    } else {
      items = [...scope.querySelectorAll('[data-item]')].map((row) => {
        const name = roleNameOf(row.dataset.item);
        return {
          name,
          label: row.querySelector('input[name="label"]').value.trim() || name,
          description: row.querySelector('input[name="description"]').value.trim(),
          emoji: row.querySelector('input[name="emoji"]').value.trim() || '🎭',
          buttonStyle: row.querySelector('select[name="buttonStyle"]').value || 'Primary',
        };
      });
    }

    let body;
    if (!items.length) {
      body = '<p style="color:#dbdee1;font-style:italic;margin:0">Pilih role untuk melihat pratinjau.</p>';
    } else if (interactionType === 'buttons') {
      body = `<div style="display:flex;flex-wrap:wrap;gap:6px">${items.map((item) => `<span style="background:${STYLE_COLORS[item.buttonStyle]};color:#fff;border-radius:4px;padding:4px 10px;font-size:13px;font-weight:500;display:inline-flex;gap:6px;align-items:center">${esc(item.emoji)} ${esc(item.label)}</span>`).join('')}</div>`;
    } else if (interactionType === 'section_buttons') {
      const accessory = behaviorMode === 'verify' ? 'Verifikasi' : behaviorMode === 'unique' ? 'Ambil' : 'Ambil/Lepas';
      body = items.map((item) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:#313338;border-radius:6px;padding:8px 10px;margin-bottom:6px"><span style="min-width:0"><span style="display:block;color:#f2f3f5">${esc(item.emoji)} ${esc(item.label)}</span>${item.description ? `<span style="display:block;color:#dbdee1;font-size:12px;margin-top:2px">${esc(item.description)}</span>` : ''}</span><span style="flex:none;background:${STYLE_COLORS[item.buttonStyle]};color:#fff;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:500">${accessory}</span></div>`).join('');
    } else if (interactionType === 'dropdown') {
      body = `<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;gap:10px;color:#dbdee1"><span>${esc(placeholder)}</span><span>▾</span></div><p style="color:#dbdee1;font-size:12px;margin:6px 2px 0">Maks ${esc(maxSelect)} dari ${esc(items.length)} role</p>`;
    } else {
      body = items.map((item) => `<div style="display:flex;gap:8px;align-items:center;padding:5px 2px;border-bottom:1px dashed #3f4147"><span>${esc(item.emoji)}</span><span style="flex:1;color:#f2f3f5">${esc(item.name)}${item.label && item.label !== item.name ? ` (${esc(item.label)})` : ''}</span></div>`).join('');
    }

    card.style.borderLeftColor = accent;
    card.innerHTML = `${bannerHtml}<div style="padding:12px 14px">`
      + `<div style="font-weight:700;font-size:17px;color:#f2f3f5;margin-bottom:4px;white-space:pre-wrap">${esc(title)}</div>`
      + `<div style="color:#dbdee1;margin-bottom:10px;white-space:pre-wrap">${esc(description)}</div>`
      + `<div style="border-top:1px solid #3f4147;margin:10px 0"></div>`
      + body
      + `<div style="border-top:1px solid #3f4147;margin:10px 0"></div>`
      + `<div style="color:#dbdee1;font-size:11px">-# Zentix Self-Role</div>`
      + `</div>`;
  }
  const readFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
  const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Permintaan gagal.');
    return data;
  }

  function render() {
    return `<div id="selfRolesLive"><section class="f-panel"><div class="f-panel-head"><div><h2>Panel tersimpan</h2>`
      + `<p>Pesan interaktif tempat anggota memilih sendiri role-nya: tombol, daftar section, dropdown atau reaksi klasik.</p></div><span>✳</span></div>`
      + `<div id="selfRolesList" aria-live="polite">Memuat…</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>Buat panel</h2>`
      + `<p>Mengirim pesan baru ke channel yang dipilih.</p></div><span>✳</span></div>`
      + `<div id="selfRolesCreate" aria-live="polite">Memuat…</div></section>`
      + `<div class="f-callout">ⓘ &nbsp; Mode <b>Toggle</b>: klik/pilih lagi untuk lepas. <b>Unique</b>: hanya 1 role dari panel ini. <b>Verify</b>: hanya bisa menambah. `
      + `Pada tipe <b>Dropdown</b>, role panel yang tidak terpilih akan dilepas (kecuali mode Verify). `
      + `Pada tipe <b>Reaction</b>, tiap item wajib punya emoji yang berbeda. `
      + `Role dengan izin pengelolaan server, moderasi, atau mention @everyone, role milik bot/integrasi, dan role yang tidak berada di bawah role tertinggi bot tidak dapat ditawarkan.</div></div>`;
  }

  const roleName = (role) => (role.name === null ? `Role terhapus (${role.id})` : role.name);
  const TYPE_TEXT = { buttons: 'Tombol Grid', section_buttons: 'Section List', dropdown: 'Dropdown', reaction: 'Reaction' };
  const MODE_TEXT = { toggle: 'Toggle', unique: 'Unique (1 role)', verify: 'Verify (hanya tambah)' };
  const STYLE_OPTIONS = ['Primary', 'Secondary', 'Success', 'Danger'];
  const requiredRoleOptions = (selected, roles) => ['<option value="">Tidak ada</option>']
    .concat(roles.filter((role) => role.usable).map((role) => `<option value="${esc(role.id)}"${role.id === selected ? ' selected' : ''}>${esc(role.name)}</option>`))
    .join('');

  function panelBlock(panel, index, data) {
    const onPanel = new Set(panel.roles.map((role) => role.id));
    const free = data.roles.filter((role) => role.usable && !onPanel.has(role.id));
    const place = panel.channelName === null ? 'Channel tidak terlihat oleh bot' : `#${panel.channelName}`;
    const roles = panel.roles.map((role) => `<li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0">`
      + `<span><b>${esc(roleName(role))}</b>${role.ok ? '' : ` <small role="note">⚠ Tidak dapat diberikan: ${esc(role.reason)}</small>`}</span>`
      + `<button type="button" class="f-outline" data-remove="${esc(role.id)}"${panel.roles.length < 2 ? ' disabled title="Role terakhir tidak dapat dilepas; hapus panelnya."' : ''}>LEPAS</button></li>`).join('');

    const interactionType = panel.interactionType || 'buttons';
    const behaviorMode = panel.behaviorMode || 'toggle';
    const requiredRole = panel.requiredRoleId ? (data.roles.find((entry) => entry.id === panel.requiredRoleId)?.name ?? panel.requiredRoleId) : null;

    const add = panel.roles.length >= data.limits.roles ? `<p class="f-muted">Panel sudah memuat ${esc(data.limits.roles)} role (batas maksimum).</p>`
      : free.length ? `<form class="f-form" data-add="${index}"><label class="f-field"><span><b>Tambah role</b><small>Hanya role yang boleh ditawarkan dan belum ada di panel ini.</small></span>`
        + `<select name="roleId"><option value="">Pilih role</option>${free.map((role) => `<option value="${esc(role.id)}">${esc(role.name)}</option>`).join('')}</select></label>`
        + `<div class="f-form-actions"><span>MENGUBAH PESAN DI DISCORD</span><button type="submit" class="f-primary">TAMBAH ROLE ↗</button></div></form>`
        : '<p class="f-muted">Tidak ada role lain yang boleh ditawarkan.</p>';

    const settings = `<p><b>Tipe:</b> ${esc(TYPE_TEXT[interactionType] || interactionType)} · <b>Mode:</b> ${esc(MODE_TEXT[behaviorMode] || behaviorMode)}`
      + (interactionType === 'dropdown' ? ` · <b>Maks pilihan:</b> ${esc(panel.maxSelect ?? 1)}` : '') + `</p>`
      + (requiredRole ? `<p><b>Butuh role:</b> ${esc(requiredRole)}</p>` : '')
      + (bannerText(panel.bannerUrl) || '')
      + (panel.accentColor ? `<p><b>Warna:</b> <span style="color:#${esc(panel.accentColor)}">#${esc(panel.accentColor)}</span></p>` : '');

    // Item editor: order with ↑/↓ and per-item label, description, emoji and button style.
    const itemRows = panel.roles.map((role) => {
      const item = role.item || {};
      return `<li data-item="${esc(role.id)}" style="display:grid;grid-template-columns:auto 2fr 2fr 1.6fr 110px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--softline)">`
        + `<span style="white-space:nowrap"><button type="button" class="f-outline" data-move="up" aria-label="Naikkan">↑</button> <button type="button" class="f-outline" data-move="down" aria-label="Turunkan">↓</button></span>`
        + `<input aria-label="Label ${esc(roleName(role))}" name="label" maxlength="80" placeholder="${esc(roleName(role))}" value="${esc(item.label ?? '')}">`
        + `<input aria-label="Deskripsi ${esc(roleName(role))}" name="description" maxlength="100" placeholder="deskripsi" value="${esc(item.description ?? '')}">`
        + `<input aria-label="Emoji ${esc(roleName(role))}" name="emoji" maxlength="48" placeholder="🎭 atau &lt;:nama:id&gt;" value="${esc(item.emoji ?? '')}">`
        + `<select aria-label="Gaya tombol ${esc(roleName(role))}" name="buttonStyle">${STYLE_OPTIONS.map((style) => `<option value="${style}"${style === (item.buttonStyle || 'Primary') ? ' selected' : ''}>${style}</option>`).join('')}</select>`
        + `</li>`;
    }).join('');
    const itemsForm = `<form class="f-form" data-items="${index}">`
      + `<div class="f-field"><span><b>Atur item</b><small>Urutan tampil, label, deskripsi, emoji dan gaya tombol per role. Emoji wajib dan berbeda untuk mode Reaction.</small></span>`
      + `<ol style="list-style:none;margin:0;padding:0" data-itemrows>${itemRows}</ol></div>`
      + `<div class="f-form-actions"><span>MENGUBAH PESAN DI DISCORD</span><button type="submit" class="f-primary">SIMPAN ITEM ↗</button></div></form>`;

    const typeOptions = Object.entries(TYPE_TEXT).map(([value, label]) => `<option value="${value}"${value === interactionType ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const modeOptions = Object.entries(MODE_TEXT).map(([value, label]) => `<option value="${value}"${value === behaviorMode ? ' selected' : ''}>${esc(label)}</option>`).join('');

    return `<div data-panel="${index}" style="padding:18px 0;border-bottom:1px solid var(--softline)"><h3>${esc(panel.title ?? 'Panel tanpa judul')}</h3>`
      + `<p class="f-muted">${esc(place)} · ID pesan ${esc(panel.messageId)}${messageLink(panel.url)}</p>`
      + `<p><b>Status:</b> ${esc(STATUS[panel.status] || STATUS.unknown)}</p>`
      + settings
      + `<form class="f-form" data-text="${index}">`
      + `<label class="f-field"><span><b>Judul</b><small>Paling banyak ${esc(data.limits.title)} karakter.</small></span><input name="title" maxlength="${esc(data.limits.title)}" value="${esc(panel.title ?? '')}"></label>`
      + `<label class="f-field"><span><b>Deskripsi</b><small>Paling banyak ${esc(data.limits.description)} karakter.</small></span><textarea name="description" maxlength="${esc(data.limits.description)}">${esc(panel.description ?? '')}</textarea></label>`
      + `<label class="f-field"><span><b>Banner URL</b><small>${String(panel.bannerUrl || '').startsWith('attachment://') ? 'Banner unggahan tersimpan — isi untuk menggantinya dengan link, kosongkan untuk mempertahankannya' : '(opsional, harus https://)'}</small></span><input name="bannerUrl" type="url" maxlength="2048" value="${esc(panel.bannerUrl && !String(panel.bannerUrl).startsWith('attachment://') ? panel.bannerUrl : '')}" placeholder="https://…"></label>`
      + `<label class="f-field"><span><b>Unggah banner</b><small>PNG, JPEG, WebP atau GIF, paling banyak 5 MB. Menggantikan banner yang ada.</small></span><input name="bannerFile" type="file" accept="${BANNER_TYPES.join(',')}"></label>`
      + `<label class="f-field"><span><b>Hapus banner</b><small>Hapus banner tanpa menggantinya.</small></span><span class="f-check"><input type="checkbox" name="bannerClear"><span class="fake-switch" aria-hidden="true"></span></span></label>`
      + `<div class="f-field"><span><b>Warna container</b><small>Pilih warna atau tekan Reset untuk warna bawaan.</small></span>${window.ZentixGreetingColor?.render(panel.accentColor ? '#' + panel.accentColor : '', PREVIEW_ACCENT, {name:'accentColor',optional:true}) || `<input name="accentColor" maxlength="7" value="${esc(panel.accentColor ? '#' + panel.accentColor : '')}" placeholder="#99aab5">`}</div>`
      + `<label class="f-field"><span><b>Tipe interaksi</b></span><select name="interactionType">${typeOptions}</select></label>`
      + `<label class="f-field"><span><b>Mode perilaku</b></span><select name="behaviorMode">${modeOptions}</select></label>`
      + `<label class="f-field data-dropdown-only"><span><b>Maks pilihan</b><small>Dropdown saja: 1–25.</small></span><input name="maxSelect" type="number" min="1" max="25" value="${esc(panel.maxSelect ?? 1)}"></label>`
      + `<label class="f-field data-dropdown-only"><span><b>Placeholder dropdown</b><small>Teks sebelum dipilih.</small></span><input name="dropdownPlaceholder" maxlength="100" value="${esc(panel.dropdownPlaceholder ?? '')}"></label>`
      + `<label class="f-field"><span><b>Butuh role</b><small>(opsional) Hanya anggota dengan role ini yang bisa memakai panel.</small></span><select name="requiredRoleId">${requiredRoleOptions(panel.requiredRoleId ?? '', data.roles)}</select></label>`
      + `<div class="f-form-actions"><span>MENGUBAH PESAN DI DISCORD</span><button type="submit" class="f-primary">SIMPAN PENGATURAN ↗</button></div></form>`
      + `<p><b>Role di panel (${esc(panel.roles.length)} / ${esc(data.limits.roles)})</b></p><ul style="list-style:none;margin:0;padding:0">${roles}</ul>${add}`
      + itemsForm
      + previewShell()
      + `<div class="f-form-actions"><span></span><span>`
      + (panel.status === 'message_missing' ? `<button type="button" class="f-outline" data-repost="${index}">PASANG ULANG ↗</button> ` : '')
      + (panel.status === 'ok' ? `<button type="button" class="f-outline" data-refresh="${index}">SEGARKAN PESAN ↻</button> ` : '')
      + `<button type="button" class="f-outline" data-delete="${index}">HAPUS PANEL</button></span></div></div>`;
  }

  function createForm(data) {
    if (data.panels.length >= data.limits.panels) return `<p class="f-muted">Server ini sudah memiliki ${esc(data.limits.panels)} panel (batas maksimum). Hapus satu panel untuk membuat yang baru.</p>`;
    if (!data.channels.length) return '<p class="f-muted">Bot tidak melihat channel teks di server ini.</p>';
    const usable = data.roles.filter((role) => role.usable);
    if (!usable.length) return '<p class="f-muted">Belum ada role yang boleh ditawarkan. Buat role biasa di Discord dan letakkan di bawah role bot.</p>';

    const channels = data.channels.map((channel) => `<option value="${esc(channel.id)}"${channel.usable ? '' : ' disabled'}>#${esc(channel.name)}${channel.usable ? '' : ' (izin bot kurang)'}</option>`).join('');
    const boxes = data.roles.map((role) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><label style="flex:1;display:flex;align-items:center;gap:6px"><input type="checkbox" name="roleIds" value="${esc(role.id)}"${role.usable ? '' : ' disabled'}> `
      + `${esc(role.name)}${role.usable ? '' : ` <small>— ${esc(role.reason)}</small>`}</label>`
      + `<input name="emoji-${esc(role.id)}" maxlength="48" placeholder="emoji" aria-label="Emoji untuk ${esc(role.name)}" style="width:130px"${role.usable ? '' : ' disabled'}></div>`).join('');

    return `<form class="f-form" id="selfRolesCreateForm">`
      + `<label class="f-field"><span><b>Channel</b><small>Bot memerlukan View Channel, Send Messages, dan Embed Links di sana.${data.channelsTruncated ? ' Daftar dipotong.' : ''}</small></span>`
      + `<select name="channelId"><option value="">Pilih channel</option>${channels}</select></label>`
      + `<label class="f-field"><span><b>Judul</b><small>Paling banyak ${esc(data.limits.title)} karakter.</small></span><input name="title" maxlength="${esc(data.limits.title)}"></label>`
      + `<label class="f-field"><span><b>Deskripsi</b><small>Paling banyak ${esc(data.limits.description)} karakter.</small></span><textarea name="description" maxlength="${esc(data.limits.description)}"></textarea></label>`
      + `<label class="f-field"><span><b>Banner URL</b><small>(opsional, harus https://)</small></span><input name="bannerUrl" type="url" maxlength="2048" placeholder="https://…"></label>`
      + `<label class="f-field"><span><b>Unggah banner</b><small>PNG, JPEG, WebP atau GIF, paling banyak 5 MB. Dipilih lebih diutamakan daripada URL.</small></span><input name="bannerFile" type="file" accept="${BANNER_TYPES.join(',')}"></label>`
      + `<div class="f-field"><span><b>Warna container</b><small>Pilih warna atau tekan Reset untuk warna bawaan.</small></span>${window.ZentixGreetingColor?.render('', PREVIEW_ACCENT, {name:'accentColor',optional:true}) || `<input name="accentColor" maxlength="7" placeholder="#99aab5">`}</div>`
      + `<label class="f-field"><span><b>Tipe interaksi</b></span><select name="interactionType"><option value="buttons">Tombol Grid</option><option value="section_buttons">Section List</option><option value="dropdown">Dropdown</option><option value="reaction">Reaction (Klasik)</option></select></label>`
      + `<label class="f-field"><span><b>Mode perilaku</b></span><select name="behaviorMode"><option value="toggle">Toggle (klik/pilih lagi untuk lepas)</option><option value="unique">Unique (hanya 1 role)</option><option value="verify">Verify (hanya tambah)</option></select></label>`
      + `<label class="f-field data-dropdown-only"><span><b>Maks pilihan</b><small>Dropdown saja: 1–25.</small></span><input name="maxSelect" type="number" min="1" max="25" value="1"></label>`
      + `<label class="f-field data-dropdown-only"><span><b>Placeholder dropdown</b><small>Teks sebelum dipilih.</small></span><input name="dropdownPlaceholder" maxlength="100" placeholder="Select your roles"></label>`
      + `<label class="f-field"><span><b>Butuh role</b><small>(opsional) Hanya anggota dengan role ini yang bisa memakai panel.</small></span><select name="requiredRoleId">${requiredRoleOptions('', data.roles)}</select></label>`
      + `<div class="f-field"><span><b>Role yang ditawarkan</b><small>Pilih 1 sampai ${esc(data.limits.roles)} role. Emoji hanya wajib untuk mode Reaction.${data.rolesTruncated ? ' Daftar role dipotong.' : ''}</small></span>`
      + `<div style="max-height:260px;overflow:auto">${boxes}</div></div>`
      + previewShell()
      + `<div class="f-form-actions"><span>MENGIRIM PESAN KE DISCORD</span><button type="submit" class="f-primary">BUAT PANEL ↗</button></div></form>`;
  }

  function bind(root) {
    const list = root.querySelector('#selfRolesList');
    const create = root.querySelector('#selfRolesCreate');
    if (!list || !create) return;
    const say = (text) => {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.textContent = text;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2600);
    };

    /** Show the dropdown-only fields only for the dropdown type; hide them otherwise. */
    function syncDropdownOnly(scope) {
      scope.querySelectorAll('select[name="interactionType"]').forEach((select) => {
        const container = select.closest('form') || scope;
        const show = select.value === 'dropdown';
        container.querySelectorAll('.data-dropdown-only').forEach((field) => { field.style.display = show ? '' : 'none'; });
      });
    }

    async function load(message = '') {
      list.textContent = 'Memuat…';
      create.textContent = 'Memuat…';
      let data;
      try {
        data = await request();
      } catch (error) {
        if (!list.isConnected) return;
        list.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="f-outline" id="selfRolesRetry">COBA LAGI ↻</button>`;
        list.querySelector('#selfRolesRetry').onclick = () => load();
        create.innerHTML = '<p class="f-muted">Tidak tersedia sampai daftar panel dapat dibaca.</p>';
        return;
      }
      if (!list.isConnected) return;

      const note = `<p id="selfRolesStatus" class="f-muted" role="status">${esc(message)}</p>`;
      const rejected = data.rejected > 0 ? `<p role="alert">${esc(data.rejected)} catatan panel tersimpan tidak dapat dibaca dan tidak ditampilkan.</p>` : '';
      list.innerHTML = note + rejected + (data.panels.length
        ? data.panels.map((panel, index) => panelBlock(panel, index, data)).join('')
        : '<p class="f-muted">Belum ada panel.</p>')
        + '<div class="f-form-actions"><button type="button" class="f-outline" id="selfRolesReload">MUAT ULANG ↻</button></div>';
      create.innerHTML = '<p id="selfRolesCreateStatus" class="f-muted" role="status"></p>' + createForm(data);
      list.querySelector('#selfRolesReload').onclick = () => load();
      const status = list.querySelector('#selfRolesStatus');
      const createStatus = create.querySelector('#selfRolesCreateStatus');
      syncDropdownOnly(root);
      root.querySelectorAll('select[name="interactionType"]').forEach((select) => select.addEventListener('change', () => syncDropdownOnly(root)));

      /** Runs one change with every control locked; reloads after success, reports a failure in place. */
      async function change(where, run, done) {
        const controls = [...root.querySelectorAll('#selfRolesLive button, #selfRolesLive select, #selfRolesLive input, #selfRolesLive textarea')].filter((control) => !control.disabled);
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
        const text = done(result);
        say(text);
        load(text);
      }

      /** The banner file of a form, decoded to `{ name, mime, base64 }`, or null when none is chosen. */
      async function bannerUpload(fileInput) {
        const file = fileInput?.files?.[0];
        if (!file) return null;
        if (!BANNER_TYPES.includes(file.type)) throw Error('Banner harus PNG, JPEG, WebP atau GIF.');
        if (file.size > 5 * 1024 * 1024) throw Error('Banner paling banyak 5 MB.');
        return { name: file.name, mime: file.type, base64: await readFile(file) };
      }

      list.querySelectorAll('[data-panel]').forEach((block) => {
        const panel = data.panels[Number(block.dataset.panel)];
        const path = '/panels/' + encodeURIComponent(panel.messageId);
        const label = panel.title ?? panel.messageId;

        const text = block.querySelector('form[data-text]');
        window.ZentixGreetingColor?.bind(text);
        text.onsubmit = async (event) => {
          event.preventDefault();
          const form = text;
          const title = form.elements.title.value.trim();
          const description = form.elements.description.value.trim();
          const bannerUrl = form.elements.bannerUrl.value.trim();
          const accentColor = form.elements.accentColor.value.trim();
          const interactionType = form.elements.interactionType.value;
          const behaviorMode = form.elements.behaviorMode.value;
          const dropdownPlaceholder = form.elements.dropdownPlaceholder ? form.elements.dropdownPlaceholder.value.trim() : '';
          const maxSelect = form.elements.maxSelect ? Math.max(1, Math.min(25, Number(form.elements.maxSelect.value) || 1)) : undefined;
          const requiredRoleId = form.elements.requiredRoleId ? form.elements.requiredRoleId.value : '';
          const bannerClear = Boolean(form.elements.bannerClear?.checked);
          const storedUpload = typeof panel.bannerUrl === 'string' && panel.bannerUrl.startsWith('attachment://');
          const sendingBannerUrl = storedUpload && !bannerUrl ? undefined : bannerUrl;
          let bannerFile = null;
          try {
            bannerFile = await bannerUpload(form.elements.bannerFile);
          } catch (error) { status.textContent = error.message; return; }
          if (!title || !description) { status.textContent = 'Judul dan deskripsi wajib diisi.'; return; }
          const originalBannerUrl = storedUpload ? '' : (panel.bannerUrl || '');
          const unchanged = title === (panel.title ?? '') && description === (panel.description ?? '')
            && bannerUrl === originalBannerUrl && accentColor === (panel.accentColor ? '#' + panel.accentColor : '')
            && interactionType === (panel.interactionType || 'buttons') && behaviorMode === (panel.behaviorMode || 'toggle')
            && dropdownPlaceholder === (panel.dropdownPlaceholder ?? '') && maxSelect === (panel.maxSelect ?? 1)
            && (requiredRoleId || '') === (panel.requiredRoleId ?? '')
            && !bannerFile && !bannerClear;
          if (unchanged) { status.textContent = 'Tidak ada yang berubah.'; return; }
          if (!confirm(`Ubah pengaturan panel "${label}"? Pesannya di Discord ikut diubah.`)) return;
          change(status, () => request('PATCH', path, {
            confirmed: true, revision: panel.revision, title, description,
            ...(sendingBannerUrl !== undefined ? { bannerUrl: sendingBannerUrl } : {}),
            accentColor: accentColor || '',
            interactionType, behaviorMode,
            dropdownPlaceholder,
            maxSelect,
            requiredRoleId,
            ...(bannerFile ? { bannerFile } : {}),
            ...(bannerClear ? { bannerClear: true } : {}),
          }),
          (result) => `Pengaturan panel disimpan. ${redrawText(result.message)}`);
        };

        block.__storedBannerUpload = typeof panel.bannerUrl === 'string' && panel.bannerUrl.startsWith('attachment://');
        const panelRoles = panel.roles.map((role) => ({ id: role.id, name: role.name === null ? 'Role terhapus' : role.name }));
        const repaintPanel = () => paintPreview(block, panelRoles);
        block.addEventListener('input', repaintPanel);
        block.addEventListener('change', repaintPanel);
        repaintPanel();
        const itemsForm = block.querySelector('form[data-items]');
        itemsForm.querySelectorAll('[data-move]').forEach((button) => {
          button.onclick = () => {
            const row = button.closest('[data-item]');
            if (!row) return;
            const rows = row.parentNode;
            if (button.dataset.move === 'up' && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
            if (button.dataset.move === 'down' && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
          };
        });
        itemsForm.onsubmit = (event) => {
          event.preventDefault();
          const items = [...itemsForm.querySelectorAll('[data-item]')].map((row) => ({
            roleId: row.dataset.item,
            label: row.querySelector('input[name="label"]').value.trim() || null,
            description: row.querySelector('input[name="description"]').value.trim() || null,
            emoji: row.querySelector('input[name="emoji"]').value.trim() || null,
            buttonStyle: row.querySelector('select[name="buttonStyle"]').value,
          }));
          if (!items.length) { status.textContent = 'Panel harus memuat minimal satu role.'; return; }
          if (!confirm(`Simpan item panel "${label}"? Pesannya di Discord ikut diubah.`)) return;
          change(status, () => request('PUT', path + '/items', { confirmed: true, revision: panel.revision, items }),
            (result) => `Item panel disimpan. ${redrawText(result.message)}`);
        };

        const add = block.querySelector('form[data-add]');
        if (add) {
          add.onsubmit = (event) => {
            event.preventDefault();
            const roleId = add.elements.roleId.value;
            if (!roleId) { status.textContent = 'Pilih role terlebih dahulu.'; return; }
            const role = data.roles.find((entry) => entry.id === roleId);
            if (!confirm(`Tambahkan role "${role?.name ?? roleId}" ke panel "${label}"? Semua anggota yang melihat panel dapat mengambil role itu sendiri.`)) return;
            change(status, () => request('POST', path + '/roles', { confirmed: true, revision: panel.revision, roleId }),
              (result) => `Role ditambahkan. ${redrawText(result.message)}`);
          };
        }

        block.querySelectorAll('[data-remove]').forEach((button) => {
          button.onclick = () => {
            const role = panel.roles.find((entry) => entry.id === button.dataset.remove);
            if (!confirm(`Lepas role "${roleName(role)}" dari panel "${label}"? Anggota yang sudah memilikinya tetap memilikinya.`)) return;
            change(status, () => request('DELETE', path + '/roles/' + encodeURIComponent(role.id), { confirmed: true, revision: panel.revision }),
              (result) => `Role dilepas dari panel. ${redrawText(result.message)}`);
          };
        });

        const repost = block.querySelector('[data-repost]');
        if (repost) {
          repost.onclick = () => {
            if (!confirm(`Pasang ulang panel "${label}"? Pesan baru dikirim ke ${panel.channelName === null ? 'channel panel' : '#' + panel.channelName}.`)) return;
            change(status, () => request('POST', path + '/repost', { confirmed: true }),
              (result) => (result.bannerLost
                ? 'Panel dipasang ulang, tetapi banner unggahan lama hilang. Unggah ulang banner di pengaturan panel.'
                : result.reactionFailures?.length
                  ? 'Panel dipasang ulang, tetapi sebagian emoji reaksi gagal ditempel.'
                  : 'Panel dipasang ulang sebagai pesan baru.'));
          };
        }
        const refresh = block.querySelector('[data-refresh]');
        if (refresh) {
          refresh.onclick = () => {
            if (!confirm(`Gambar ulang pesan panel "${label}" di Discord dari data tersimpan?`)) return;
            change(status, () => request('POST', path + '/refresh', { confirmed: true }),
              (result) => (result.message === 'updated' ? 'Pesan panel digambar ulang.' : redrawText(result.message)));
          };
        }
        block.querySelector('[data-delete]').onclick = () => {
          const target = panel.status === 'ok' ? 'Pesannya DIHAPUS dari Discord dan tidak dapat dikembalikan.'
            : 'Pesannya tidak ditemukan; hanya catatan panel yang dihapus bila pesan memang sudah tidak ada.';
          if (!confirm(`Hapus panel "${label}"? ${target} Role yang sudah dimiliki anggota tidak dicabut.`)) return;
          change(status, () => request('DELETE', path, { confirmed: true, revision: panel.revision }),
            (result) => (result.messageDeleted ? 'Panel dan pesannya dihapus.' : 'Panel dihapus. Pesannya sudah tidak ada.'));
        };
      });

      const createRoles = data.roles;
      const form = create.querySelector('#selfRolesCreateForm');
      if (form) {
        window.ZentixGreetingColor?.bind(form);
        const repaintCreate = () => paintPreview(form, createRoles);
        form.addEventListener('input', repaintCreate);
        form.addEventListener('change', repaintCreate);
        repaintCreate();
        form.onsubmit = async (event) => {
          event.preventDefault();
          const checked = [...form.querySelectorAll('input[name="roleIds"]:checked')].map((box) => box.value);
          const interactionType = form.elements.interactionType.value;
          const bannerUrl = form.elements.bannerUrl.value.trim();
          const accentColor = form.elements.accentColor.value.trim();
          const behaviorMode = form.elements.behaviorMode.value;
          let bannerFile = null;
          try {
            bannerFile = await bannerUpload(form.elements.bannerFile);
          } catch (error) { createStatus.textContent = error.message; return; }
          const items = checked.map((roleId) => ({
            roleId,
            label: null, description: null, buttonStyle: 'Primary',
            emoji: (form.elements[`emoji-${roleId}`]?.value ?? '').trim() || null,
          }));
          const maxSelect = Math.max(1, Math.min(25, Number(form.elements.maxSelect.value) || 1));
          const dropdownPlaceholder = form.elements.dropdownPlaceholder.value.trim();
          const requiredRoleId = form.elements.requiredRoleId.value || '';
          const body = {
            confirmed: true,
            channelId: form.elements.channelId.value,
            title: form.elements.title.value.trim(),
            description: form.elements.description.value.trim(),
            ...(bannerUrl ? { bannerUrl } : {}),
            ...(bannerFile ? { bannerFile } : {}),
            ...(accentColor ? { accentColor } : {}),
            interactionType,
            behaviorMode,
            maxSelect,
            ...(dropdownPlaceholder ? { dropdownPlaceholder } : {}),
            ...(requiredRoleId ? { requiredRoleId } : {}),
            roleIds: checked,
            items,
          };
          if (!body.channelId) { createStatus.textContent = 'Pilih channel terlebih dahulu.'; return; }
          if (!body.title || !body.description) { createStatus.textContent = 'Judul dan deskripsi wajib diisi.'; return; }
          if (!body.roleIds.length) { createStatus.textContent = 'Pilih minimal satu role.'; return; }
          if (interactionType === 'reaction') {
            const missing = items.filter((item) => !item.emoji).map((item) => data.roles.find((entry) => entry.id === item.roleId)?.name ?? item.roleId);
            if (missing.length) { createStatus.textContent = `Mode Reaction memerlukan emoji untuk setiap role. Belum ada: ${missing.join(', ')}`; return; }
          }
          const channel = data.channels.find((entry) => entry.id === body.channelId);
          const namesList = body.roleIds.map((id) => data.roles.find((entry) => entry.id === id)?.name ?? id).join(', ');
          if (!confirm(`Kirim panel "${body.title}" ke #${channel?.name ?? body.channelId}? Semua anggota yang melihatnya dapat mengambil sendiri role: ${namesList}.`)) return;
          change(createStatus, () => request('POST', '/panels', body),
            (result) => (result.reactionFailures?.length
              ? 'Panel dibuat, tetapi sebagian emoji reaksi gagal ditempel. Tambahkan reaksi secara manual atau buat ulang panel.'
              : 'Panel dibuat dan dikirim ke Discord.'));
        };
      }
    }

    load();
  }

  window.ZentixSelfRoles = { render, bind };
})();
