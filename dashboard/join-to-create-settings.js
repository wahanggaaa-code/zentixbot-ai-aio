/* Join to Create settings. Changes are stored by the bot's transaction protocol; nothing here touches Discord. */
(() => {
  const tr = (id,en) => window.ZentixI18n?.language === 'en' ? en : id;
  const API = '/dashboard/api/bot/join-to-create/settings';
  const DEFAULTS = { nameTemplate: "{username}'s Room", userLimit: 0, bitrate: 64000 };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function request(method = 'GET', path = '', body) {
    const session = await window.ZentixSession;
    const response = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'x-csrf-token': session.csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw Error((window.ZentixI18n?.accessError?.(data.error,response.status) ?? window.ZentixI18n?.jtcError?.(data.error) ?? data.error) || tr('Permintaan gagal.','Request failed.'));
    return data;
  }

  function render() {
    return `<section class="f-panel"><div class="f-panel-head"><div><h2>${tr('Pengaturan trigger','Trigger settings')}</h2>`
      + `<p>${tr('Berlaku untuk channel sementara yang dibuat setelah disimpan. Channel yang sudah ada tidak diubah.','Applies to temporary channels created after saving. Existing channels are unchanged.')}</p></div><span>✳</span></div>`
      + `<div id="jtcSettings" aria-live="polite">${tr('Memuat…','Loading…')}</div></section>`;
  }

  function fields(values, data) {
    const guildKbps = data.limits.guildBitrate ? Math.floor(data.limits.guildBitrate / 1000) : null;
    return `<label class="f-field"><span><b>${tr('Template nama','Name template')}</b><small>Placeholder: ${esc(data.placeholders.join(' '))}</small></span>`
      + `<input name="nameTemplate" type="text" maxlength="${esc(data.limits.nameTemplate)}" value="${esc(values.nameTemplate)}"></label>`
      + `<label class="f-field"><span><b>${tr('Batas user','User limit')}</b><small>${tr('0 = tanpa batas, paling banyak 99.','0 = unlimited, maximum 99.')}</small></span>`
      + `<input name="userLimit" type="number" min="0" max="99" step="1" value="${esc(values.userLimit)}"></label>`
      + `<label class="f-field"><span><b>Bitrate (kbps)</b><small>${tr('8 sampai 384.','8 to 384.')}${guildKbps ? ` ${tr('Server ini saat ini mengizinkan sampai','This server currently allows up to')} ${esc(guildKbps)}; ${tr('nilai lebih tinggi diturunkan saat channel dibuat.','higher values are reduced when the channel is created.')}` : ''}</small></span>`
      + `<input name="bitrateKbps" type="number" min="8" max="384" step="any" value="${esc(values.bitrate / 1000)}"></label>`;
  }

  function triggerForm(trigger, index, data) {
    const name = trigger.channelName === null
      ? tr('Channel tidak ada di cache bot; mungkin sudah dihapus di Discord','Channel is not in the bot cache; it may have been deleted in Discord')
      : trigger.channelName;
    const permission = trigger.botCanManage === false
      ? tr('<p role="alert">Bot tidak memiliki izin Manage Channels, Move Members atau Connect pada channel ini; channel sementara tidak akan dibuat.</p>','<p role="alert">The bot lacks Manage Channels, Move Members or Connect permission in this channel; temporary channels will not be created.</p>')
      : '';
    return `<form class="f-form" data-trigger="${index}"><h3>${esc(name)}</h3><p class="f-muted">ID ${esc(trigger.channelId)}</p>${permission}`
      + fields(trigger, data)
      + `<div class="f-form-actions"><button type="button" class="f-outline" data-remove="${index}" aria-label="${esc(tr(`Lepas trigger ${name} (ID ${trigger.channelId})`,`Remove trigger ${name} (ID ${trigger.channelId})`))}">${tr('LEPAS TRIGGER','REMOVE TRIGGER')}</button><button type="submit" class="f-primary" aria-label="${esc(tr(`Simpan pengaturan trigger ${name} (ID ${trigger.channelId})`,`Save trigger settings for ${name} (ID ${trigger.channelId})`))}">${tr('SIMPAN ↗','SAVE ↗')}</button></div></form>`;
  }

  function setupForm(data) {
    if (!data.voiceChannels.length) {
      return tr('<p class="f-muted">Bot tidak melihat channel suara di server ini. Buat channel suara di Discord, atau jalankan /jointocreate setup.</p>','<p class="f-muted">The bot cannot see any voice channels in this server. Create one in Discord or run /jointocreate setup.</p>');
    }
    const channelLabel = channel => `${channel.category ? channel.category + ' / ' : ''}${channel.name || tr('Channel tanpa nama','Unnamed channel')}`;
    const options = data.voiceChannels.map((channel, index) => `<option value="${index}"${channel.usable ? '' : ' disabled'}>`
      + `${esc(channelLabel(channel))}${!channel.name || data.voiceChannels.filter(other => channelLabel(other) === channelLabel(channel)).length > 1 ? ` · ID ${esc(channel.id)}` : ''}${channel.usable ? '' : tr(' (izin bot kurang)',' (bot lacks permission)')}</option>`).join('');
    return `<form class="f-form" data-setup><p class="f-muted">${tr('Join to Create belum memiliki trigger. Pilih channel suara yang sudah ada; anggota yang masuk ke channel itu mendapat channel sementara di kategori yang sama.','Join to Create has no trigger yet. Choose an existing voice channel; members joining it get a temporary channel in the same category.')}</p>`
      + `<label class="f-field"><span><b>${tr('Channel trigger','Trigger channel')}</b><small>${tr('Bot memerlukan Manage Channels, Move Members dan Connect.','The bot needs Manage Channels, Move Members and Connect.')}${data.voiceChannelsTruncated ? tr(' Daftar dipotong; gunakan /jointocreate setup bila channel tidak tampil.',' List truncated; use /jointocreate setup if the channel is not shown.') : ''}</small></span>`
      + `<select name="channel"><option value="">${tr('Pilih channel suara','Select a voice channel')}</option>${options}</select></label>`
      + fields(DEFAULTS, data)
      + `<div class="f-form-actions"><span>${tr('PERUBAHAN TERSIMPAN DI DATABASE BOT','CHANGES SAVED IN BOT DATABASE')}</span><button type="submit" class="f-primary">${tr('AKTIFKAN JOIN TO CREATE ↗','ENABLE JOIN TO CREATE ↗')}</button></div></form>`;
  }

  /** Reads the three inputs. Returns { values } or { error }. */
  function readFields(form) {
    const nameTemplate = form.elements.nameTemplate.value.trim();
    const limitText = form.elements.userLimit.value.trim();
    const kbpsText = form.elements.bitrateKbps.value.trim();
    if (!nameTemplate) return { error: tr('Template nama tidak boleh kosong.','Name template cannot be empty.') };
    if (!/^\d{1,2}$/.test(limitText)) return { error: tr('Batas user harus bilangan bulat 0 sampai 99.','User limit must be an integer from 0 to 99.') };
    const bitrate = Math.round(Number(kbpsText) * 1000);
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(kbpsText) || bitrate < 8000 || bitrate > 384000) return { error: tr('Bitrate harus 8 sampai 384 kbps.','Bitrate must be between 8 and 384 kbps.') };
    return { values: { nameTemplate, userLimit: Number(limitText), bitrate } };
  }

  function bind(root, onChanged) {
    const slot = root.querySelector('#jtcSettings');
    if (!slot) return;

    async function load(notice = '') {
      slot.textContent = tr('Memuat…','Loading…');
      let data;
      try {
        data = await request();
      } catch (error) {
        if (!slot.isConnected) return;
        slot.textContent = error.message;
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'f-outline';
        retry.textContent = tr('COBA LAGI','RETRY');
        retry.onclick = () => load();
        slot.append(retry);
        return;
      }
      if (!slot.isConnected) return;

      const busy = data.busy ? tr('<p role="alert">Bot sedang membuat channel sementara. Perubahan ditolak sampai selesai; coba lagi beberapa detik lagi.</p>','<p role="alert">The bot is creating a temporary channel. Changes are rejected until it finishes; try again in a few seconds.</p>') : '';
      slot.innerHTML = `<p id="jtcSettingsStatus" class="f-muted" role="status">${esc(notice)}</p>${busy}`
        + (data.triggers.length ? data.triggers.map((trigger, index) => triggerForm(trigger, index, data)).join('') : setupForm(data))
        + `<p><button type="button" class="f-outline" id="jtcSettingsReload">${tr('MUAT ULANG ↻','RELOAD ↻')}</button></p>`;
      const status = slot.querySelector('#jtcSettingsStatus');
      slot.querySelector('#jtcSettingsReload').onclick = () => load();

      const lock = (locked) => slot.querySelectorAll('button,input,select').forEach((element) => { element.disabled = locked; });
      async function send(method, path, body, done) {
        lock(true);
        status.textContent = tr('Menyimpan…','Saving…');
        try {
          await request(method, path, body);
        } catch (error) {
          // Keep what was typed; the administrator decides whether to reload.
          lock(false);
          status.textContent = `${error.message} ${tr('Bila hasilnya tidak jelas, muat ulang sebelum mencoba lagi.','If the result is unclear, reload before trying again.')}`;
          return;
        }
        if (onChanged) onChanged();
        await load(done);
      }

      slot.querySelectorAll('form[data-trigger]').forEach((form) => {
        const trigger = data.triggers[Number(form.dataset.trigger)];
        form.onsubmit = async (event) => {
          event.preventDefault();
          const { values, error } = readFields(form);
          if (error) { status.textContent = error; return; }
          // Send only what changed, so untouched settings are never rewritten.
          const patch = {};
          for (const key of ['nameTemplate', 'userLimit', 'bitrate']) if (values[key] !== trigger[key]) patch[key] = values[key];
          if (!Object.keys(patch).length) { status.textContent = tr('Tidak ada perubahan.','No changes.'); return; }
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(tr('Simpan pengaturan trigger ini? Berlaku untuk channel sementara berikutnya.','Save these trigger settings? They apply to future temporary channels.')) : Promise.resolve(window.confirm(tr('Simpan pengaturan trigger ini? Berlaku untuk channel sementara berikutnya.','Save these trigger settings? They apply to future temporary channels.')))))) return;
          send('PATCH', `/triggers/${trigger.channelId}`, { ...patch, revision: data.configRevision, confirmed: true }, tr('Pengaturan disimpan.','Settings saved.'));
        };
        form.querySelector('[data-remove]').onclick = async () => {
          const message = tr('Lepas trigger ini? Join to Create berhenti membuat channel baru. Channel di Discord tidak dihapus, dan channel sementara yang masih ada tetap dihapus saat kosong.','Remove this trigger? Join to Create will stop creating new channels. The Discord channel is not deleted, and existing temporary channels are still deleted when empty.');
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(message) : Promise.resolve(window.confirm(message))))) return;
          send('DELETE', `/triggers/${trigger.channelId}`, { revision: data.configRevision, confirmed: true }, tr('Trigger dilepas. Channel di Discord tidak dihapus.','Trigger removed. The Discord channel was not deleted.'));
        };
      });

      const setup = slot.querySelector('form[data-setup]');
      if (setup) {
        setup.onsubmit = async (event) => {
          event.preventDefault();
          const channel = data.voiceChannels[Number(setup.elements.channel.value)];
          if (setup.elements.channel.value === '' || !channel || !channel.usable) { status.textContent = tr('Pilih channel suara yang dapat dikelola bot.','Select a voice channel the bot can manage.'); return; }
          const { values, error } = readFields(setup);
          if (error) { status.textContent = error; return; }
          const name = channel.name || tr('Channel tanpa nama','Unnamed channel');
          const identifier = !channel.name || data.voiceChannels.filter(other => other.name === channel.name).length > 1 ? ` (ID ${channel.id})` : '';
          if (!(await (window.ZentixDialog ? window.ZentixDialog.confirm(`${tr('Jadikan','Make')} "${name}${identifier}" ${tr('trigger Join to Create?','the Join to Create trigger?')}`) : Promise.resolve(window.confirm(`${tr('Jadikan','Make')} "${name}${identifier}" ${tr('trigger Join to Create?','the Join to Create trigger?')}`))))) return;
          send('POST', '/triggers', { ...values, channelId: channel.id, confirmed: true }, tr('Join to Create diaktifkan.','Join to Create enabled.'));
        };
      }
    }
    load();
  }

  window.ZentixJoinToCreateSettings = { render, bind };
})();
