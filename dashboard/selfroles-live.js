/* Self-role panels on the logged-in dashboard. This page acts on Discord: creating or reposting a panel
   sends a message, changing it edits that message, deleting it deletes the message. */
(() => {
  const tr=(id,en)=>window.ZentixI18n?.language==='en'?en:id;
  const API = '/dashboard/api/bot/self-roles';
  const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = {
    ok: tr('Aktif di Discord','Active in Discord'),
    message_missing: tr('Pesan panel sudah dihapus di Discord — pasang ulang untuk memakainya lagi','Panel message deleted in Discord — repost to use it again'),
    channel_missing: tr('Channel panel sudah tidak ada — hapus panel ini lalu buat panel baru','Panel channel no longer exists — delete this panel and create a new one'),
    unknown: tr('Belum dapat diperiksa di Discord saat ini','Cannot currently check Discord'),
  };
  /** What happened to the posted message after a stored change, from the `message` field of the API. */
  const REDRAW = {
    updated: tr('Pesan panel di Discord sudah mengikuti.','Discord panel message updated.'),
    missing: tr('Tersimpan, tetapi pesan panelnya sudah tidak ada di Discord. Pasang ulang panel.','Saved, but the panel message no longer exists in Discord. Repost the panel.'),
    channel_missing: tr('Tersimpan, tetapi channel panelnya sudah tidak ada.','Saved, but the panel channel no longer exists.'),
    no_roles: tr('Tersimpan, tetapi tidak ada lagi role panel yang masih ada di server, jadi pesannya tidak diubah.','Saved, but none of the panel roles remain on the server, so the message was not changed.'),
  };
  const redrawText = (state) => REDRAW[state] || tr('Tersimpan, tetapi pesan panel belum dapat diperbarui. Tekan SEGARKAN PESAN untuk mencoba lagi.','Saved, but the panel message could not be updated. Press REFRESH MESSAGE to try again.');
  /** Only a Discord message link is turned into a link. */
  const messageLink = (url) => (typeof url === 'string' && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(url)
    ? ` · <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${tr('buka pesan ↗','open message ↗')}</a>` : '');
  /** An uploaded banner lives inside the panel message: it is not a link anyone can open. */
  const bannerText = (url) => {
    if (!url) return null;
    if (String(url).startsWith('attachment://')) return `<p><b>Banner:</b> ${tr('unggahan tersimpan','saved upload')} ✓</p>`;
    return `<p><b>Banner:</b> <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${tr('lihat gambar ↗','view image ↗')}</a></p>`;
  };
  const PREVIEW_ACCENT = '#99aab5';
  const STYLE_COLORS = { Primary: '#5865f2', Secondary: '#4e5058', Success: '#248046', Danger: '#da373c' };
  const safeObjectUrl = (file) => (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);

  /** The (empty) preview card markup; filled by paintPreview. Not a form control. */
  function previewShell() {
    return `<div style="margin:14px 0;max-width:440px">`
      + `<p class="f-muted" style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em">${tr('Pratinjau tampilan pesan','Message appearance preview')}</p>`
      + `<div data-card style="background:#2b2d31;border:1px solid #1e1f22;border-left:4px solid ${PREVIEW_ACCENT};border-radius:14px;overflow:hidden;color:#dbdee1"></div>`
      + `<p class="f-muted" style="margin:6px 0 0;font-size:11px">${tr('Mode perilaku tidak terlihat di pesan. Isi form di atas mengubah pratinjau ini.','Behavior mode is not shown in the message. The form above updates this preview.')}</p>`
      + `</div>`;
  }

  /** Paints the preview card inside `scope` (the create form, or a panel block). `roles` resolves names. */
  function paintPreview(scope, roles) {
    const card = scope.querySelector('[data-card]');
    if (!card) return;
    const isCreate = scope.matches('form');
    const settings = isCreate ? scope : scope.querySelector('form[data-text]');
    if (!settings) return;
    const roleNameOf = (id) => { const found = roles.find((role) => role.id === id); return found ? roleName(found) : tr('Role terhapus','Deleted role'); };

    const title = settings.elements.title.value.trim() || 'Self-Role';
    const description = settings.elements.description.value.trim() || 'Select your roles.';
    const interactionType = settings.elements.interactionType.value;
    const behaviorMode = settings.elements.behaviorMode.value;
    const maxSelect = Math.max(1, Math.min(25, Number(settings.elements.maxSelect?.value) || 1));
    const placeholder = settings.elements.dropdownPlaceholder?.value.trim() || 'Select your roles';
    const accentRaw = (settings.elements.accentColor.value || '').trim();
    const accent = /^#?[0-9a-fA-F]{6}$/.test(accentRaw) ? '#' + accentRaw.replace(/^#/, '') : 'transparent';

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
      bannerHtml = `<div style="padding:18px;text-align:center;color:#dbdee1;border-bottom:1px dashed #3f4147">${tr('Banner unggahan tersimpan akan dipakai','The saved uploaded banner will be used')}</div>`;
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
      body = `<p style="color:#dbdee1;font-style:italic;margin:0">${tr('Pilih role untuk melihat pratinjau.','Select roles to see the preview.')}</p>`;
    } else if (interactionType === 'buttons') {
      body = `<div style="display:flex;flex-wrap:wrap;gap:6px">${items.map((item) => `<span style="background:${STYLE_COLORS[item.buttonStyle]};color:#fff;border-radius:4px;padding:4px 10px;font-size:13px;font-weight:500;display:inline-flex;gap:6px;align-items:center">${esc(item.emoji)} ${esc(item.label)}</span>`).join('')}</div>`;
    } else if (interactionType === 'section_buttons') {
      const accessory = behaviorMode === 'verify' ? 'Verifikasi' : behaviorMode === 'unique' ? 'Ambil' : 'Ambil/Lepas';
      body = items.map((item) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;background:#313338;border-radius:6px;padding:8px 10px;margin-bottom:6px"><span style="min-width:0"><span style="display:block;color:#f2f3f5">${esc(item.emoji)} ${esc(item.label)}</span>${item.description ? `<span style="display:block;color:#dbdee1;font-size:12px;margin-top:2px">${esc(item.description)}</span>` : ''}</span><span style="flex:none;background:${STYLE_COLORS[item.buttonStyle]};color:#fff;border-radius:4px;padding:4px 10px;font-size:12px;font-weight:500">${accessory}</span></div>`).join('');
    } else if (interactionType === 'dropdown') {
      body = `<div style="background:#1e1f22;border:1px solid #3f4147;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;gap:10px;color:#dbdee1"><span>${esc(placeholder)}</span><span>▾</span></div><p style="color:#dbdee1;font-size:12px;margin:6px 2px 0">${tr('Maks','Max')} ${esc(maxSelect)} ${tr('dari','of')} ${esc(items.length)} role</p>`;
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
    reader.onerror = () => reject(new Error(tr('Berkas tidak dapat dibaca.','Could not read file.')));
    reader.readAsDataURL(file);
  });
  const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

  // Match only known API text. Unknown role/server details must remain unchanged.
  const API_ERRORS = new Map([
    ["Judul harus 1 sampai 256 karakter.", "The title must be 1 to 256 characters long."],
    ["Deskripsi harus 1 sampai 2048 karakter.", "The description must be 1 to 2048 characters long."],
    ["Pilih channel teks atau pengumuman dari server ini.", "Please select a text or announcement channel of this server."],
    ["Bot membutuhkan izin View Channel, Send Messages, dan Embed Links di channel itu. Tidak ada yang diubah.", "The bot needs View Channel, Send Messages and Embed Links in that channel. Nothing was changed."],
    ["Pilih minimal satu role.", "Choose at least one role."],
    ["Satu panel paling banyak memuat 25 role.", "A panel can hold at most 25 roles."],
    ["Role itu tidak dapat ditawarkan di panel.", "That role cannot be offered on a panel."],
    ["Role itu sudah ada di panel ini.", "That role is already on this panel."],
    ["Role itu tidak ada di panel ini.", "That role is not on this panel."],
    ["Itu role terakhir di panel ini. Hapus panelnya jika memang tidak diperlukan lagi.", "That is the last role on this panel. Delete the panel instead if it is no longer needed."],
    ["Server ini sudah memiliki 5 panel self-role (batas maksimum). Hapus satu panel untuk membuat yang baru.", "This server already has the maximum of 5 self-role panels. Delete a panel to create a new one."],
    ["Panel itu sudah tidak ada. Muat ulang halaman.", "That panel no longer exists. Reload the page."],
    ["Panel berubah sejak halaman dimuat. Muat ulang, periksa, lalu ulangi.", "The panel changed in the meantime. Check it and try again."],
    ["Pesan panel masih ada, jadi tidak perlu dipasang ulang.", "The panel message still exists, so there is nothing to repost."],
    ["Tidak ada lagi role panel ini yang masih ada di server, jadi panel tidak dapat dipasang ulang. Hapus panel ini.", "None of the roles on this panel exist any more, so it cannot be posted again. Delete the panel."],
    ["Channel panel ini sudah tidak ada. Hapus panel ini lalu buat panel baru di channel lain.", "The channel of this panel no longer exists. Delete the panel and create a new one in another channel."],
    ["Pesan panel tidak dapat diperiksa di Discord saat ini. Tidak ada yang diubah. Coba lagi nanti.", "The bot could not check the panel message at Discord right now. Nothing was changed. Please try again."],
    ["Data panel tersimpan perlu diperiksa sebelum dapat diubah.", "The stored panel data needs to be checked before it can be changed."],
    ["Database tidak tersedia. Tidak ada yang diubah.", "The database is not available right now. Nothing was changed."],
    ["Discord menolak permintaan. Tidak ada yang diubah.", "Discord refused the request. Nothing was changed."],
    ["Panel gagal disimpan dan pesan barunya tidak dapat dihapus lagi. Hapus pesan itu secara manual; menunya tidak berfungsi.", "The panel could not be saved and its new message could not be removed again. Please delete that message by hand; its menu does not work."],
    ["Pesan panel sudah dihapus, tetapi catatannya gagal dihapus. Hapus panel sekali lagi untuk menyelesaikan.", "The panel message was deleted, but its stored record could not be removed. Delete the panel again to finish."],
    ["Banner harus berupa gambar PNG, JPEG, WebP atau GIF paling banyak 5 MB. Tidak ada yang diubah.", "The banner must be a PNG, JPEG, WebP or GIF image of at most 5 MB. Nothing was changed."],
    ["Panel reaksi memerlukan satu emoji yang valid dan berbeda per item, dan emoji itu harus ada di server ini. Tidak ada yang diubah.", "Reaction panels need one valid, distinct emoji per item, and the emoji must exist in this server. Nothing was changed."],
    ["Item panel perlu diperiksa sebelum dapat disimpan. Tidak ada yang diubah.", "The panel items need to be checked before they can be saved. Nothing was changed."],
    ["Perubahan tidak dapat diselesaikan saat ini. Muat ulang untuk melihat keadaan terbaru sebelum mencoba lagi.", "The change cannot be completed right now. Reload to see the latest state before trying again."],
    ["Panel tidak dapat dibaca dari database.", "Panels could not be read from the database."],
    ["Banner URL harus memakai https://", "The banner URL must use https://"],
    ["Banner URL tidak valid.", "Invalid banner URL."],
    ["Banner harus gambar PNG, JPEG, WebP atau GIF paling banyak 5 MB.", "The banner must be a PNG, JPEG, WebP or GIF image of at most 5 MB."],
    ["Banner tidak valid.", "Invalid banner."],
    ["Batas pilihan dropdown tidak valid.", "Invalid dropdown selection limit."],
    ["Deskripsi item tidak valid.", "Invalid item description."],
    ["Emoji item tidak valid.", "Invalid item emoji."],
    ["Gaya tombol tidak valid.", "Invalid button style."],
    ["Item panel tidak valid.", "Invalid panel item."],
    ["Item tidak cocok dengan daftar role.", "The items do not match the role list."],
    ["Label item tidak valid.", "Invalid item label."],
    ["Mode perilaku tidak valid.", "Invalid behavior mode."],
    ["Pilih salah satu: unggah banner atau pakai URL.", "Choose either a banner upload or a URL."],
    ["Placeholder tidak valid.", "Invalid placeholder."],
    ["Required role tidak valid.", "Invalid required role."],
    ["Tipe interaksi tidak valid.", "Invalid interaction type."],
    ["Warna accent tidak valid.", "Invalid accent color."],
    ["Permintaan tidak valid.", "Invalid request."],
    ["Konfirmasi diperlukan.", "Confirmation is required."],
    ["Parameter tidak valid.", "Invalid parameter."],
    ["Akses ditolak.", "Access denied."],
    ["Role itu tidak ada di server ini.", "That role does not exist on this server."],
    ["Role tidak dapat diperiksa di Discord saat ini. Tidak ada yang diubah.", "The role cannot be checked on Discord right now. Nothing was changed."],
  ]);
  const ROLE_REASONS = new Map([
    ["Role sudah tidak ada.", "It no longer exists."],
    ["Role tidak dapat diperiksa di Discord saat ini.", "It could not be looked up at Discord right now."],
    ["@everyone tidak dapat dipakai.", "@everyone cannot be used."],
    ["Role dikelola oleh bot atau integrasi.", "It is managed by a bot or an integration."],
    ["Role memberi izin pengelolaan server, moderasi, atau mention @everyone.", "It grants server management, moderation or @everyone mention permissions."],
    ["Bot tidak memiliki izin Manage Roles.", "The bot does not have the Manage Roles permission."],
    ["Posisinya tidak di bawah role tertinggi bot.", "It is not below the bot’s highest role."],
    ["Posisinya tidak di bawah role tertinggi Anda.", "It is not below your own highest role."],
    ["Anda memerlukan role tertentu untuk memakai panel ini.", "You need a specific role to use this panel."],
    ["Role itu tidak ada di panel ini.", "That role is not on this panel."],
  ]);
  const roleReason = reason => window.ZentixI18n?.language === 'en' ? (ROLE_REASONS.get(reason) ?? reason) : reason;
  const apiError = message => {
    if (window.ZentixI18n?.language !== 'en') return message;
    const exact = API_ERRORS.get(message);
    if (exact !== undefined) return exact;
    // The API may append one known role refusal reason. Do not translate partial or custom details.
    const prefix = 'Role itu tidak dapat ditawarkan di panel. ';
    if (typeof message === 'string' && message.startsWith(prefix)) {
      const reason = message.slice(prefix.length);
      if (ROLE_REASONS.has(reason)) return `${API_ERRORS.get(prefix.trim())} ${ROLE_REASONS.get(reason)}`;
    }
    return message;
  };

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? apiError(data.error)) || tr('Permintaan gagal.','Request failed.'));
    return data;
  }

  function render() {
    return `<div id="selfRolesLive"><section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Panel tersimpan','Saved panels')}</h2>`
      + `<p>${tr('Pesan interaktif tempat anggota memilih sendiri role-nya: tombol, daftar section, dropdown atau reaksi klasik.','Interactive messages where members choose roles: buttons, section lists, dropdowns or classic reactions.')}</p></div><span>✳</span></div>`
      + `<div id="selfRolesList" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<section class="f-panel" style="margin-top:18px"><div class="f-panel-head"><div><h2>${tr('Buat panel','Create panel')}</h2>`
      + `<p>${tr('Mengirim pesan baru ke channel yang dipilih.','Sends a new message to the selected channel.')}</p></div><span>✳</span></div>`
      + `<div id="selfRolesCreate" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`
      + `<div class="f-callout">ⓘ &nbsp; Mode <b>Toggle</b>: ${tr('klik/pilih lagi untuk lepas.','click/select again to remove.')} <b>Unique</b>: ${tr('hanya 1 role dari panel ini.','only one role from this panel.')} <b>Verify</b>: ${tr('hanya bisa menambah.','add only.')} `
      + `${tr('Pada tipe','For')} <b>Dropdown</b>, ${tr('role panel yang tidak terpilih akan dilepas (kecuali mode Verify).','unselected panel roles are removed (except in Verify mode).')} `
      + `${tr('Pada tipe','For')} <b>Reaction</b>, ${tr('tiap item wajib punya emoji yang berbeda.','each item must have a different emoji.')} `
      + `${tr('Role dengan izin pengelolaan server, moderasi, atau mention @everyone, role milik bot/integrasi, dan role yang tidak berada di bawah role tertinggi bot tidak dapat ditawarkan.','Roles with server management, moderation or mention @everyone permissions, bot/integration roles, and roles not below the bot’s highest role cannot be offered.')}</div></div>`;
  }

  const roleName = (role) => (role.name === null ? tr(`Role terhapus (${role.id})`,`Deleted role (${role.id})`) : role.name);
  const TYPE_TEXT = { buttons: tr('Tombol Grid','Button grid'), section_buttons: 'Section List', dropdown: 'Dropdown', reaction: 'Reaction' };
  const MODE_TEXT = { toggle: 'Toggle', unique: 'Unique (1 role)', verify: tr('Verify (hanya tambah)','Verify (add only)') };
  const STYLE_OPTIONS = ['Primary', 'Secondary', 'Success', 'Danger'];
  const roleChoice = (role, roles) => `${role.name || tr('Role tanpa nama','Unnamed role')}${!role.name || roles.filter(other => other.name === role.name).length > 1 ? ` · ID ${role.id}` : ''}`;
  const requiredRoleOptions = (selected, roles) => [`<option value="">${tr('Tidak ada','None')}</option>`]
    .concat(roles.filter((role) => role.usable).map((role) => `<option value="${esc(role.id)}"${role.id === selected ? ' selected' : ''}>${esc(roleChoice(role, roles))}</option>`))
    .concat(selected && !roles.some(role => role.id === selected && role.usable) ? [`<option value="${esc(selected)}" selected disabled>${esc(tr('Role tersimpan tidak tersedia','Saved role unavailable'))} · ID ${esc(selected)}</option>`] : [])
    .join('');

  function panelBlock(panel, index, data) {
    const onPanel = new Set(panel.roles.map((role) => role.id));
    const free = data.roles.filter((role) => role.usable && !onPanel.has(role.id));
    const place = panel.channelName === null ? tr('Channel tidak terlihat oleh bot','Channel not visible to the bot') : `#${panel.channelName}`;
    const panelName = panel.title || tr('Panel tanpa judul','Untitled panel');
    const roles = panel.roles.map((role) => `<li style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 0">`
      + `<span><b>${esc(roleName(role))}</b>${role.ok ? '' : ` <small role="note">⚠ ${tr('Tidak dapat diberikan:','Cannot be assigned:')} ${esc(roleReason(role.reason))}</small>`}</span>`
      + `<button type="button" class="f-outline" data-remove="${esc(role.id)}" aria-label="${esc(tr(`Lepas role ${roleName(role)} (ID ${role.id})`,`Remove role ${roleName(role)} (ID ${role.id})`))}"${panel.roles.length < 2 ? ` disabled title="${tr('Role terakhir tidak dapat dilepas; hapus panelnya.','The last role cannot be removed; delete the panel instead.')}"` : ''}>${tr('LEPAS','REMOVE')}</button></li>`).join('');

    const interactionType = panel.interactionType || 'buttons';
    const behaviorMode = panel.behaviorMode || 'toggle';
    const requiredRole = panel.requiredRoleId ? (data.roles.find((entry) => entry.id === panel.requiredRoleId)?.name ?? panel.requiredRoleId) : null;

    const add = panel.roles.length >= data.limits.roles ? `<p class="f-muted">${tr(`Panel sudah memuat ${esc(data.limits.roles)} role (batas maksimum).`,`The panel already has ${esc(data.limits.roles)} roles (maximum).`)}</p>`
      : free.length ? `<form class="f-form" data-add="${index}"><label class="f-field"><span><b>${tr('Tambah role','Add role')}</b><small>${tr('Hanya role yang boleh ditawarkan dan belum ada di panel ini.','Only eligible roles not already on this panel.')}</small></span>`
        + `<select name="roleId"><option value="">${tr('Pilih role','Choose role')}</option>${free.map((role) => `<option value="${esc(role.id)}">${esc(roleChoice(role, data.roles))}</option>`).join('')}</select></label>`
        + `<div class="f-form-actions"><span>${tr('MENGUBAH PESAN DI DISCORD','CHANGES THE DISCORD MESSAGE')}</span><button type="submit" class="f-primary" aria-label="${esc(tr(`Tambah role ke panel ${panelName} (ID pesan ${panel.messageId})`,`Add role to panel ${panelName} (message ID ${panel.messageId})`))}">${tr('TAMBAH ROLE ↗','ADD ROLE ↗')}</button></div></form>`
        : `<p class="f-muted">${tr('Tidak ada role lain yang boleh ditawarkan.','No other roles are eligible to be offered.')}</p>`;

    const settings = `<p><b>${tr('Tipe:','Type:')}</b> ${esc(TYPE_TEXT[interactionType] || interactionType)} · <b>Mode:</b> ${esc(MODE_TEXT[behaviorMode] || behaviorMode)}`
      + (interactionType === 'dropdown' ? ` · <b>${tr('Maks pilihan:','Max selections:')}</b> ${esc(panel.maxSelect ?? 1)}` : '') + `</p>`
      + (requiredRole ? `<p><b>${tr('Butuh role:','Required role:')}</b> ${esc(requiredRole)}</p>` : '')
      + (bannerText(panel.bannerUrl) || '')
      + (panel.accentColor ? `<p><b>${tr('Warna:','Color:')}</b> <span style="color:#${esc(panel.accentColor)}">#${esc(panel.accentColor)}</span></p>` : '');

    // Item editor: order with ↑/↓ and per-item label, description, emoji and button style.
    const itemRows = panel.roles.map((role) => {
      const item = role.item || {};
      return `<li data-item="${esc(role.id)}" style="display:grid;grid-template-columns:auto 2fr 2fr 1.6fr 110px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px dashed var(--softline)">`
        + `<span style="white-space:nowrap"><button type="button" class="f-outline" data-move="up" aria-label="${esc(tr(`Naikkan role ${roleName(role)} (ID ${role.id})`,`Move role ${roleName(role)} up (ID ${role.id})`))}">↑</button> <button type="button" class="f-outline" data-move="down" aria-label="${esc(tr(`Turunkan role ${roleName(role)} (ID ${role.id})`,`Move role ${roleName(role)} down (ID ${role.id})`))}">↓</button></span>`
        + `<input aria-label="${esc(tr(`Label role ${roleName(role)} (ID ${role.id})`,`Label for role ${roleName(role)} (ID ${role.id})`))}" name="label" maxlength="80" placeholder="${esc(roleName(role))}" value="${esc(item.label ?? '')}">`
        + `<input aria-label="${esc(tr(`Deskripsi role ${roleName(role)} (ID ${role.id})`,`Description for role ${roleName(role)} (ID ${role.id})`))}" name="description" maxlength="100" placeholder="${tr('deskripsi','description')}" value="${esc(item.description ?? '')}">`
        + `<input aria-label="${esc(tr(`Emoji role ${roleName(role)} (ID ${role.id})`,`Emoji for role ${roleName(role)} (ID ${role.id})`))}" name="emoji" maxlength="48" placeholder="${tr('🎭 atau &lt;:nama:id&gt;','🎭 or &lt;:name:id&gt;')}" value="${esc(item.emoji ?? '')}">`
        + `<select aria-label="${esc(tr(`Gaya tombol role ${roleName(role)} (ID ${role.id})`,`Button style for role ${roleName(role)} (ID ${role.id})`))}" name="buttonStyle">${STYLE_OPTIONS.map((style) => `<option value="${style}"${style === (item.buttonStyle || 'Primary') ? ' selected' : ''}>${style}</option>`).join('')}</select>`
        + `</li>`;
    }).join('');
    const itemsForm = `<form class="f-form" data-items="${index}">`
      + `<div class="f-field"><span><b>${tr('Atur item','Configure items')}</b><small>${tr('Urutan tampil, label, deskripsi, emoji dan gaya tombol per role. Emoji wajib dan berbeda untuk mode Reaction.','Display order, label, description, emoji and button style for each role. Reaction mode requires a unique emoji for each item.')}</small></span>`
      + `<ol style="list-style:none;margin:0;padding:0" data-itemrows>${itemRows}</ol></div>`
      + `<div class="f-form-actions"><span>${tr('MENGUBAH PESAN DI DISCORD','CHANGES THE DISCORD MESSAGE')}</span><button type="submit" class="f-primary" aria-label="${esc(tr(`Simpan item panel ${panelName} (ID pesan ${panel.messageId})`,`Save items for panel ${panelName} (message ID ${panel.messageId})`))}">${tr('SIMPAN ITEM ↗','SAVE ITEMS ↗')}</button></div></form>`;

    const typeOptions = Object.entries(TYPE_TEXT).map(([value, label]) => `<option value="${value}"${value === interactionType ? ' selected' : ''}>${esc(label)}</option>`).join('');
    const modeOptions = Object.entries(MODE_TEXT).map(([value, label]) => `<option value="${value}"${value === behaviorMode ? ' selected' : ''}>${esc(label)}</option>`).join('');

    return `<div data-panel="${index}" style="padding:18px 0;border-bottom:1px solid var(--softline)"><h3>${esc(panel.title ?? tr('Panel tanpa judul','Untitled panel'))}</h3>`
      + `<p class="f-muted">${esc(place)} · ${tr('ID pesan','Message ID')} ${esc(panel.messageId)}${messageLink(panel.url)}</p>`
      + `<p><b>Status:</b> ${esc(STATUS[panel.status] || STATUS.unknown)}</p>`
      + settings
      + `<form class="f-form" data-text="${index}">`
      + `<label class="f-field"><span><b>${tr('Judul','Title')}</b><small>${tr(`Paling banyak ${esc(data.limits.title)} karakter.`,`Maximum ${esc(data.limits.title)} characters.`)}</small></span><input name="title" maxlength="${esc(data.limits.title)}" value="${esc(panel.title ?? '')}"></label>`
      + `<label class="f-field"><span><b>${tr('Deskripsi','Description')}</b><small>${tr(`Paling banyak ${esc(data.limits.description)} karakter.`,`Maximum ${esc(data.limits.description)} characters.`)}</small></span><textarea name="description" maxlength="${esc(data.limits.description)}">${esc(panel.description ?? '')}</textarea></label>`
      + `<label class="f-field"><span><b>Banner URL</b><small>${String(panel.bannerUrl || '').startsWith('attachment://') ? tr('Banner unggahan tersimpan — isi untuk menggantinya dengan link, kosongkan untuk mempertahankannya','Saved uploaded banner — enter a link to replace it, leave blank to keep it') : tr('(opsional, harus https://)','(optional, must use https://)')}</small></span><input name="bannerUrl" type="url" maxlength="2048" value="${esc(panel.bannerUrl && !String(panel.bannerUrl).startsWith('attachment://') ? panel.bannerUrl : '')}" placeholder="https://…"></label>`
      + `<label class="f-field"><span><b>${tr('Unggah banner','Upload banner')}</b><small>${tr('PNG, JPEG, WebP atau GIF, paling banyak 5 MB. Menggantikan banner yang ada.','PNG, JPEG, WebP or GIF, maximum 5 MB. Replaces the existing banner.')}</small></span><input name="bannerFile" type="file" accept="${BANNER_TYPES.join(',')}"></label>`
      + `<label class="f-field"><span><b>${tr('Hapus banner','Delete banner')}</b><small>${tr('Hapus banner tanpa menggantinya.','Delete the banner without replacing it.')}</small></span><span class="f-check"><input type="checkbox" name="bannerClear"><span class="fake-switch" aria-hidden="true"></span></span></label>`
      + `<div class="f-field"><span><b>${tr('Warna container','Container color')}</b><small>${tr('Pilih warna atau tekan Tanpa warna.','Choose a color or press No color.')}</small></span>${window.ZentixGreetingColor?.render(panel.accentColor ? '#' + panel.accentColor : '', PREVIEW_ACCENT, {name:'accentColor',optional:true}) || `<input name="accentColor" maxlength="7" value="${esc(panel.accentColor ? '#' + panel.accentColor : '')}" placeholder="#99aab5">`}</div>`
      + `<label class="f-field"><span><b>${tr('Tipe interaksi','Interaction type')}</b></span><select name="interactionType">${typeOptions}</select></label>`
      + `<label class="f-field"><span><b>${tr('Mode perilaku','Behavior mode')}</b></span><select name="behaviorMode">${modeOptions}</select></label>`
      + `<label class="f-field data-dropdown-only"><span><b>${tr('Maks pilihan','Maximum selections')}</b><small>${tr('Dropdown saja: 1–25.','Dropdown only: 1–25.')}</small></span><input name="maxSelect" type="number" min="1" max="25" value="${esc(panel.maxSelect ?? 1)}"></label>`
      + `<label class="f-field data-dropdown-only"><span><b>${tr('Placeholder dropdown','Dropdown placeholder')}</b><small>${tr('Teks sebelum dipilih.','Text before selection.')}</small></span><input name="dropdownPlaceholder" maxlength="100" value="${esc(panel.dropdownPlaceholder ?? '')}"></label>`
      + `<label class="f-field"><span><b>${tr('Butuh role','Required role')}</b><small>${tr('(opsional) Hanya anggota dengan role ini yang bisa memakai panel.','(optional) Only members with this role can use the panel.')}</small></span><select name="requiredRoleId">${requiredRoleOptions(panel.requiredRoleId ?? '', data.roles)}</select></label>`
      + `<div class="f-form-actions"><span>${tr('MENGUBAH PESAN DI DISCORD','CHANGES THE DISCORD MESSAGE')}</span><button type="submit" class="f-primary" aria-label="${esc(tr(`Simpan pengaturan panel ${panelName} (ID pesan ${panel.messageId})`,`Save settings for panel ${panelName} (message ID ${panel.messageId})`))}">${tr('SIMPAN PENGATURAN ↗','SAVE SETTINGS ↗')}</button></div></form>`
      + `<p><b>${tr('Role di panel','Roles on panel')} (${esc(panel.roles.length)} / ${esc(data.limits.roles)})</b></p><ul style="list-style:none;margin:0;padding:0">${roles}</ul>${add}`
      + itemsForm
      + previewShell()
      + `<div class="f-form-actions"><span></span><span>`
      + (panel.status === 'message_missing' ? `<button type="button" class="f-outline" data-repost="${index}" aria-label="${esc(tr(`Pasang ulang panel ${panelName} (ID pesan ${panel.messageId})`,`Repost panel ${panelName} (message ID ${panel.messageId})`))}">${tr('PASANG ULANG ↗','REPOST ↗')}</button> ` : '')
      + (panel.status === 'ok' ? `<button type="button" class="f-outline" data-refresh="${index}" aria-label="${esc(tr(`Segarkan pesan panel ${panelName} (ID pesan ${panel.messageId})`,`Refresh panel message ${panelName} (message ID ${panel.messageId})`))}">${tr('SEGARKAN PESAN ↻','REFRESH MESSAGE ↻')}</button> ` : '')
      + `<button type="button" class="f-outline" data-delete="${index}" aria-label="${esc(tr(`Hapus panel ${panelName} (ID pesan ${panel.messageId})`,`Delete panel ${panelName} (message ID ${panel.messageId})`))}">${tr('HAPUS PANEL','DELETE PANEL')}</button></span></div></div>`;
  }

  function createForm(data) {
    if (data.panels.length >= data.limits.panels) return `<p class="f-muted">${tr(`Server ini sudah memiliki ${esc(data.limits.panels)} panel (batas maksimum). Hapus satu panel untuk membuat yang baru.`,`This server already has ${esc(data.limits.panels)} panels (maximum). Delete one to create another.`)}</p>`;
    if (!data.channels.length) return `<p class="f-muted">${tr('Bot tidak melihat channel teks di server ini.','The bot cannot see text channels on this server.')}</p>`;
    const usable = data.roles.filter((role) => role.usable);
    if (!usable.length) return `<p class="f-muted">${tr('Belum ada role yang boleh ditawarkan. Buat role biasa di Discord dan letakkan di bawah role bot.','No eligible roles yet. Create a regular role in Discord and place it below the bot role.')}</p>`;

    const channels = data.channels.map((channel) => `<option value="${esc(channel.id)}"${channel.usable ? '' : ' disabled'}>#${esc(channel.name)}${data.channels.filter(c=>c.name===channel.name).length>1?` · ID ${esc(channel.id)}`:''}${channel.usable ? '' : tr(' (izin bot kurang)',' (bot lacks permissions)')}</option>`).join('');
    const boxes = data.roles.map((role) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><label style="flex:1;display:flex;align-items:center;gap:6px"><input type="checkbox" name="roleIds" value="${esc(role.id)}" aria-label="${esc(`Role ${role.name} (ID ${role.id})${role.usable ? '' : ` — ${roleReason(role.reason)}`}`)}"${role.usable ? '' : ' disabled'}> `
      + `${esc(roleChoice(role, data.roles))}${role.usable ? '' : ` <small>— ${esc(roleReason(role.reason))}</small>`}</label>`
      + `<input name="emoji-${esc(role.id)}" maxlength="48" placeholder="emoji" aria-label="${esc(tr(`Emoji untuk ${role.name} (ID ${role.id})`,`Emoji for ${role.name} (ID ${role.id})`))}" style="width:130px"${role.usable ? '' : ' disabled'}></div>`).join('');

    return `<form class="f-form" id="selfRolesCreateForm">`
      + `<label class="f-field"><span><b>Channel</b><small>${tr('Bot memerlukan View Channel, Send Messages, dan Embed Links di sana.','The bot needs View Channel, Send Messages and Embed Links there.')}${data.channelsTruncated ? tr(' Daftar dipotong.',' List truncated.') : ''}</small></span>`
      + `<select name="channelId"><option value="">${tr('Pilih channel','Choose channel')}</option>${channels}</select></label>`
      + `<label class="f-field"><span><b>${tr('Judul','Title')}</b><small>${tr(`Paling banyak ${esc(data.limits.title)} karakter.`,`Maximum ${esc(data.limits.title)} characters.`)}</small></span><input name="title" maxlength="${esc(data.limits.title)}"></label>`
      + `<label class="f-field"><span><b>${tr('Deskripsi','Description')}</b><small>${tr(`Paling banyak ${esc(data.limits.description)} karakter.`,`Maximum ${esc(data.limits.description)} characters.`)}</small></span><textarea name="description" maxlength="${esc(data.limits.description)}"></textarea></label>`
      + `<label class="f-field"><span><b>Banner URL</b><small>${tr(tr('(opsional, harus https://)','(optional, must use https://)'),'(optional, must use https://)')}</small></span><input name="bannerUrl" type="url" maxlength="2048" placeholder="https://…"></label>`
      + `<label class="f-field"><span><b>${tr('Unggah banner','Upload banner')}</b><small>${tr('PNG, JPEG, WebP atau GIF, paling banyak 5 MB. Dipilih lebih diutamakan daripada URL.','PNG, JPEG, WebP or GIF, maximum 5 MB. The selected file takes precedence over the URL.')}</small></span><input name="bannerFile" type="file" accept="${BANNER_TYPES.join(',')}"></label>`
      + `<div class="f-field"><span><b>${tr('Warna container','Container color')}</b><small>${tr('Pilih warna atau tekan Tanpa warna.','Choose a color or press No color.')}</small></span>${window.ZentixGreetingColor?.render('', PREVIEW_ACCENT, {name:'accentColor',optional:true}) || `<input name="accentColor" maxlength="7" placeholder="#99aab5">`}</div>`
      + `<label class="f-field"><span><b>${tr('Tipe interaksi','Interaction type')}</b></span><select name="interactionType"><option value="buttons">${tr('Tombol Grid','Button grid')}</option><option value="section_buttons">Section List</option><option value="dropdown">Dropdown</option><option value="reaction">${tr('Reaction (Klasik)','Reaction (classic)')}</option></select></label>`
      + `<label class="f-field"><span><b>${tr('Mode perilaku','Behavior mode')}</b></span><select name="behaviorMode"><option value="toggle">${tr('Toggle (klik/pilih lagi untuk lepas)','Toggle (click/select again to remove)')}</option><option value="unique">${tr('Unique (hanya 1 role)','Unique (one role only)')}</option><option value="verify">${tr('Verify (hanya tambah)','Verify (add only)')}</option></select></label>`
      + `<label class="f-field data-dropdown-only"><span><b>${tr('Maks pilihan','Maximum selections')}</b><small>${tr('Dropdown saja: 1–25.','Dropdown only: 1–25.')}</small></span><input name="maxSelect" type="number" min="1" max="25" value="1"></label>`
      + `<label class="f-field data-dropdown-only"><span><b>${tr('Placeholder dropdown','Dropdown placeholder')}</b><small>${tr('Teks sebelum dipilih.','Text before selection.')}</small></span><input name="dropdownPlaceholder" maxlength="100" placeholder="${tr('Pilih role kamu','Select your roles')}"></label>`
      + `<label class="f-field"><span><b>${tr('Butuh role','Required role')}</b><small>${tr('(opsional) Hanya anggota dengan role ini yang bisa memakai panel.','(optional) Only members with this role can use the panel.')}</small></span><select name="requiredRoleId">${requiredRoleOptions('', data.roles)}</select></label>`
      + `<div class="f-field"><span><b>${tr('Role yang ditawarkan','Offered roles')}</b><small>${tr(`Pilih 1 sampai ${esc(data.limits.roles)} role. Emoji hanya wajib untuk mode Reaction.`,`Choose 1 to ${esc(data.limits.roles)} roles. Emoji are required only for Reaction mode.`)}${data.rolesTruncated ? tr(' Daftar role dipotong.',' Role list truncated.') : ''}</small></span>`
      + `<div style="max-height:260px;overflow:auto">${boxes}</div></div>`
      + previewShell()
      + `<div class="f-form-actions"><span>${tr('MENGIRIM PESAN KE DISCORD','SENDS A DISCORD MESSAGE')}</span><button type="submit" class="f-primary">${tr('BUAT PANEL ↗','CREATE PANEL ↗')}</button></div></form>`;
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
      list.textContent = tr('Memuat…','Loading…');
      create.textContent = tr('Memuat…','Loading…');
      let data;
      try {
        data = await request();
      } catch (error) {
        if (!list.isConnected) return;
        list.innerHTML = `<p role="alert">${esc(error.message)}</p><button type="button" class="f-outline" id="selfRolesRetry">${tr('COBA LAGI ↻','RETRY ↻')}</button>`;
        list.querySelector('#selfRolesRetry').onclick = () => load();
        create.innerHTML = `<p class="f-muted">${tr('Tidak tersedia sampai daftar panel dapat dibaca.','Unavailable until the panel list can be read.')}</p>`;
        return;
      }
      if (!list.isConnected) return;

      const note = `<p id="selfRolesStatus" class="f-muted" role="status">${esc(message)}</p>`;
      const rejected = data.rejected > 0 ? `<p role="alert">${esc(data.rejected)} ${tr('catatan panel tersimpan tidak dapat dibaca dan tidak ditampilkan.','saved panel records could not be read and are not displayed.')}</p>` : '';
      list.innerHTML = note + rejected + (data.panels.length
        ? data.panels.map((panel, index) => panelBlock(panel, index, data)).join('')
        : `<p class="f-muted">${tr('Belum ada panel.','No panels yet.')}</p>`)
        + `<div class="f-form-actions"><button type="button" class="f-outline" id="selfRolesReload">${tr('MUAT ULANG ↻','RELOAD ↻')}</button></div>`;
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
        const text = done(result);
        say(text);
        load(text);
      }

      /** The banner file of a form, decoded to `{ name, mime, base64 }`, or null when none is chosen. */
      async function bannerUpload(fileInput) {
        const file = fileInput?.files?.[0];
        if (!file) return null;
        if (!BANNER_TYPES.includes(file.type)) throw Error(tr('Banner harus PNG, JPEG, WebP atau GIF.','Banner must be PNG, JPEG, WebP or GIF.'));
        if (file.size > 5 * 1024 * 1024) throw Error(tr('Banner paling banyak 5 MB.','Banner must be at most 5 MB.'));
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
          if (!title || !description) { status.textContent = tr('Judul dan deskripsi wajib diisi.','Title and description are required.'); return; }
          const originalBannerUrl = storedUpload ? '' : (panel.bannerUrl || '');
          const unchanged = title === (panel.title ?? '') && description === (panel.description ?? '')
            && bannerUrl === originalBannerUrl && accentColor === (panel.accentColor ? '#' + panel.accentColor : '')
            && interactionType === (panel.interactionType || 'buttons') && behaviorMode === (panel.behaviorMode || 'toggle')
            && dropdownPlaceholder === (panel.dropdownPlaceholder ?? '') && maxSelect === (panel.maxSelect ?? 1)
            && (requiredRoleId || '') === (panel.requiredRoleId ?? '')
            && !bannerFile && !bannerClear;
          if (unchanged) { status.textContent = tr('Tidak ada yang berubah.','Nothing changed.'); return; }
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Ubah pengaturan panel "${label}"? Pesannya di Discord ikut diubah.`,`Change settings for panel "${label}"? Its Discord message will also be changed.`)) : Promise.resolve(window.confirm(tr(`Ubah pengaturan panel "${label}"? Pesannya di Discord ikut diubah.`,`Change settings for panel "${label}"? Its Discord message will also be changed.`)))))) return;
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
          (result) => `${tr('Pengaturan panel disimpan.','Panel settings saved.')} ${redrawText(result.message)}`);
        };

        block.__storedBannerUpload = typeof panel.bannerUrl === 'string' && panel.bannerUrl.startsWith('attachment://');
        const panelRoles = panel.roles.map((role) => ({ id: role.id, name: role.name === null ? tr('Role terhapus','Deleted role') : role.name }));
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
        itemsForm.onsubmit = async (event) => {
          event.preventDefault();
          const items = [...itemsForm.querySelectorAll('[data-item]')].map((row) => ({
            roleId: row.dataset.item,
            label: row.querySelector('input[name="label"]').value.trim() || null,
            description: row.querySelector('input[name="description"]').value.trim() || null,
            emoji: row.querySelector('input[name="emoji"]').value.trim() || null,
            buttonStyle: row.querySelector('select[name="buttonStyle"]').value,
          }));
          if (!items.length) { status.textContent = tr('Panel harus memuat minimal satu role.','The panel must contain at least one role.'); return; }
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Simpan item panel "${label}"? Pesannya di Discord ikut diubah.`,`Save items for panel "${label}"? Its Discord message will also be changed.`)) : Promise.resolve(window.confirm(tr(`Simpan item panel "${label}"? Pesannya di Discord ikut diubah.`,`Save items for panel "${label}"? Its Discord message will also be changed.`)))))) return;
          change(status, () => request('PUT', path + '/items', { confirmed: true, revision: panel.revision, items }),
            (result) => `${tr('Item panel disimpan.','Panel items saved.')} ${redrawText(result.message)}`);
        };

        const add = block.querySelector('form[data-add]');
        if (add) {
          add.onsubmit = async (event) => {
            event.preventDefault();
            const roleId = add.elements.roleId.value;
            if (!roleId) { status.textContent = tr('Pilih role terlebih dahulu.','Choose a role first.'); return; }
            const role = data.roles.find((entry) => entry.id === roleId);
            const roleLabel = role ? roleChoice(role, data.roles) : roleId;
            if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Tambahkan role "${roleLabel}" ke panel "${label}"? Semua anggota yang melihat panel dapat mengambil role itu sendiri.`,`Add role "${roleLabel}" to panel "${label}"? All members who see the panel can assign themselves that role.`)) : Promise.resolve(window.confirm(tr(`Tambahkan role "${roleLabel}" ke panel "${label}"? Semua anggota yang melihat panel dapat mengambil role itu sendiri.`,`Add role "${roleLabel}" to panel "${label}"? All members who see the panel can assign themselves that role.`)))))) return;
            change(status, () => request('POST', path + '/roles', { confirmed: true, revision: panel.revision, roleId }),
              (result) => `${tr('Role ditambahkan.','Role added.')} ${redrawText(result.message)}`);
          };
        }

        block.querySelectorAll('[data-remove]').forEach((button) => {
          button.onclick = async () => {
            const role = panel.roles.find((entry) => entry.id === button.dataset.remove);
            if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Lepas role "${roleName(role)}" dari panel "${label}"? Anggota yang sudah memilikinya tetap memilikinya.`,`Remove role "${roleName(role)}" from panel "${label}"? Members who already have it will keep it.`)) : Promise.resolve(window.confirm(tr(`Lepas role "${roleName(role)}" dari panel "${label}"? Anggota yang sudah memilikinya tetap memilikinya.`,`Remove role "${roleName(role)}" from panel "${label}"? Members who already have it will keep it.`)))))) return;
            change(status, () => request('DELETE', path + '/roles/' + encodeURIComponent(role.id), { confirmed: true, revision: panel.revision }),
              (result) => `${tr('Role dilepas dari panel.','Role removed from panel.')} ${redrawText(result.message)}`);
          };
        });

        const repost = block.querySelector('[data-repost]');
        if (repost) {
          repost.onclick = async () => {
            if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Pasang ulang panel "${label}"? Pesan baru dikirim ke ${panel.channelName === null ? 'channel panel' : '#' + panel.channelName}.`,`Repost panel "${label}"? A new message will be sent to ${panel.channelName === null ? 'the panel channel' : '#' + panel.channelName}.`)) : Promise.resolve(window.confirm(tr(`Pasang ulang panel "${label}"? Pesan baru dikirim ke ${panel.channelName === null ? 'channel panel' : '#' + panel.channelName}.`,`Repost panel "${label}"? A new message will be sent to ${panel.channelName === null ? 'the panel channel' : '#' + panel.channelName}.`)))))) return;
            change(status, () => request('POST', path + '/repost', { confirmed: true }),
              (result) => (result.bannerLost
                ? tr('Panel dipasang ulang, tetapi banner unggahan lama hilang. Unggah ulang banner di pengaturan panel.','Panel reposted, but the old uploaded banner was lost. Upload it again in panel settings.')
                : result.reactionFailures?.length
                  ? tr('Panel dipasang ulang, tetapi sebagian emoji reaksi gagal ditempel.','Panel reposted, but some reactions could not be added.')
                  : tr('Panel dipasang ulang sebagai pesan baru.','Panel reposted as a new message.')));
          };
        }
        const refresh = block.querySelector('[data-refresh]');
        if (refresh) {
          refresh.onclick = async () => {
            if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Gambar ulang pesan panel "${label}" di Discord dari data tersimpan?`,`Refresh panel "${label}" in Discord from saved data?`)) : Promise.resolve(window.confirm(tr(`Gambar ulang pesan panel "${label}" di Discord dari data tersimpan?`,`Refresh panel "${label}" in Discord from saved data?`)))))) return;
            change(status, () => request('POST', path + '/refresh', { confirmed: true }),
              (result) => (result.message === 'updated' ? tr('Pesan panel digambar ulang.','Panel message refreshed.') : redrawText(result.message)));
          };
        }
        block.querySelector('[data-delete]').onclick = async () => {
          const target = panel.status === 'ok' ? tr('Pesannya DIHAPUS dari Discord dan tidak dapat dikembalikan.','Its message will be DELETED from Discord and cannot be restored.')
            : tr('Pesannya tidak ditemukan; hanya catatan panel yang dihapus bila pesan memang sudah tidak ada.','The message was not found; only the panel record is deleted if the message no longer exists.');
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Hapus panel "${label}"? ${target} Role yang sudah dimiliki anggota tidak dicabut.`,`Delete panel "${label}"? ${target} Roles already held by members will not be removed.`)) : Promise.resolve(window.confirm(tr(`Hapus panel "${label}"? ${target} Role yang sudah dimiliki anggota tidak dicabut.`,`Delete panel "${label}"? ${target} Roles already held by members will not be removed.`)))))) return;
          change(status, () => request('DELETE', path, { confirmed: true, revision: panel.revision }),
            (result) => (result.messageDeleted ? tr('Panel dan pesannya dihapus.','Panel and message deleted.') : tr('Panel dihapus. Pesannya sudah tidak ada.','Panel deleted. Its message no longer existed.')));
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
          if (!body.channelId) { createStatus.textContent = tr('Pilih channel terlebih dahulu.','Choose a channel first.'); return; }
          if (!body.title || !body.description) { createStatus.textContent = tr('Judul dan deskripsi wajib diisi.','Title and description are required.'); return; }
          if (!body.roleIds.length) { createStatus.textContent = tr('Pilih minimal satu role.','Choose at least one role.'); return; }
          if (interactionType === 'reaction') {
            const missing = items.filter((item) => !item.emoji).map((item) => { const role=data.roles.find(entry=>entry.id===item.roleId); return role ? roleChoice(role,data.roles) : item.roleId; });
            if (missing.length) { createStatus.textContent = tr(`Mode Reaction memerlukan emoji untuk setiap role. Belum ada: ${missing.join(', ')}`,`Reaction mode requires an emoji for every role. Missing: ${missing.join(', ')}`); return; }
          }
          const channel = data.channels.find((entry) => entry.id === body.channelId);
          const namesList = body.roleIds.map((id) => { const role=data.roles.find(entry=>entry.id===id); return role ? roleChoice(role,data.roles) : id; }).join(', ');
          const channelName = channel ? `${channel.name}${data.channels.filter(other=>other.name===channel.name).length>1?` · ID ${channel.id}`:''}` : body.channelId;
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr(`Kirim panel "${body.title}" ke #${channelName}? Semua anggota yang melihatnya dapat mengambil sendiri role: ${namesList}.`,`Send panel "${body.title}" to #${channelName}? All members who see it can assign themselves these roles: ${namesList}.`)) : Promise.resolve(window.confirm(tr(`Kirim panel "${body.title}" ke #${channelName}? Semua anggota yang melihatnya dapat mengambil sendiri role: ${namesList}.`,`Send panel "${body.title}" to #${channelName}? All members who see it can assign themselves these roles: ${namesList}.`)))))) return;
          change(createStatus, () => request('POST', '/panels', body),
            (result) => (result.reactionFailures?.length
              ? tr('Panel dibuat, tetapi sebagian emoji reaksi gagal ditempel. Tambahkan reaksi secara manual atau buat ulang panel.','Panel created, but some reactions could not be added. Add them manually or recreate the panel.')
              : tr('Panel dibuat dan dikirim ke Discord.','Panel created and sent to Discord.')));
        };
      }
    }

    load();
  }

  window.ZentixSelfRoles = { render, bind };
})();
