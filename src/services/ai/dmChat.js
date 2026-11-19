import { createChatStore, requireDMMembership, runChat } from './chat.js';
import { createLongTermMemory } from './longTermMemory.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';

// DM chat sessions: an in-process, opt-in gate between "user clicked Mulai chatting" and the AI answering.
// Sliding 30-minute idle TTL, like the DM memory. A restart asks for one click again.
const sessions = new Map(), memoryConsents = new Map();
const sessionTtl = 30 * 60 * 1000, maxSessions = 500, RATE_LIMIT_ATTEMPTS = 10, RATE_LIMIT_WINDOW_MS = 60000;
const key = (guildId, userId) => `${guildId}:${userId}`;
function prune(now) { for (const [k, v] of sessions) if (v <= now) sessions.delete(k); while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value); }
/** Opens (or extends) the DM chat session for this user. `now` injectable for tests. */
export function startDMSession(guildId, userId, now = Date.now()) { prune(now); sessions.set(key(guildId, userId), now + sessionTtl); return true; }
/** True (and refreshes the idle TTL) when the user has an active session. */
export function touchDMSession(guildId, userId, now = Date.now()) { const k = key(guildId, userId); const exp = sessions.get(k); if (!exp || exp <= now) { sessions.delete(k); return false; } sessions.set(k, now + sessionTtl); return true; }
export function isDMSessionActive(guildId, userId, now = Date.now()) { const exp = sessions.get(key(guildId, userId)); if (!exp || exp <= now) return false; return true; }
export function endDMSession(guildId, userId) { sessions.delete(key(guildId, userId)); }

const IMAGE = /\.(png|jpe?g)$/i, AUDIO = /\.(ogg|wav|mp3|m4a|mp4|flac|webm)$/i, FILE = /\.(txt|md|csv|json)$/i;

/**
 * Handles a direct message to the bot as a chat turn, like texting a person:
 * the user clicked "Mulai chatting" (their consent that messages go to the external AI provider),
 * so every message in the DM is answered directly — no per-message form.
 * One attachment (image, audio or text file) is answered too. `akhiri` closes the session.
 */
export async function handleDMChatMessage(message, client) {
  const homeId = client?.homeGuildId;
  const user = message.author, reply = (content) => message.channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
  if (!homeId || !user || user.bot) return true;
  // Allow a user to erase their own persistent memory even after leaving the
  // server or when DM chat is switched off. This path never reveals its contents.
  const rawContent = String(message.content ?? '').trim();
  if (/^!memori (?:nonaktif|hapus semua)$/i.test(rawContent)) {
    if (!await checkRateLimit(`ai-dm:${homeId}:${user.id}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) { await reply('Pelan-pelan ya, coba lagi sebentar lagi.'); return true; }
    memoryConsents.delete(key(homeId,user.id));
    try { const memory=createLongTermMemory(client); if (/nonaktif$/i.test(rawContent)) await memory.disable(homeId,user.id); else await memory.clear(homeId,user.id); await reply('Isi memori jangka panjang dihapus dari penyimpanan aktif. Cadangan database mungkin tetap menyimpan salinan.'); }
    catch { await reply('Memori tidak tersedia. Coba lagi nanti.'); }
    return true;
  }
  if (!await requireDMMembership(client, homeId, user.id)) { await reply('Chat hanya tersedia untuk anggota server utama.'); return true; }
  let cfg;
  try { cfg = await createChatStore(client).read(homeId); } catch { await reply('Chat DM belum tersedia. Coba lagi nanti.'); return true; }
  if (!cfg.dmEnabled) { await reply('Chat DM sedang nonaktif. Minta owner di server untuk mengaktifkannya.'); return true; }
  if (!await checkRateLimit(`ai-dm:${homeId}:${user.id}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) { await reply('Pelan-pelan ya, terlalu banyak pesan. Coba lagi sebentar lagi.'); return true; }
  const content = rawContent;
  // Memory is separate from the short-lived conversation. Explicit opt-in and
  // explicit writes only; these commands never ask the model to save data.
  if (/^!(?:memori|ingat)(?:\s|$)/i.test(content)) {
    const memory = createLongTermMemory(client), parts = content.match(/^!(memori|ingat)(?:\s+([\s\S]*))?$/i);
    const command = parts[1].toLowerCase(), argument = (parts[2] || '').trim();
    try {
      if (command === 'ingat') { await memory.add(homeId,user.id,argument); await reply('Tersimpan. Ketik !memori untuk melihatnya. Jangan simpan data sensitif.'); }
      else if (/^aktif$/i.test(argument)) { for(const [k,until] of memoryConsents)if(until<=Date.now())memoryConsents.delete(k); if(memoryConsents.size>=500)memoryConsents.delete(memoryConsents.keys().next().value); memoryConsents.set(key(homeId,user.id),Date.now()+10*60000); await reply('Memori jangka panjang disimpan di database bot dan dikirim ke provider saat chat DM. Operator database dapat mengaksesnya, dan cadangan bisa menyimpan salinan. Jangan simpan data sensitif. Jika setuju, ketik !memori setuju.'); }
      else if (/^setuju$/i.test(argument)) { const pending=key(homeId,user.id); if((memoryConsents.get(pending) || 0)<=Date.now()){memoryConsents.delete(pending);await reply('Ketik !memori aktif dulu untuk membaca penjelasan dan menyetujui penyimpanan.');return true;} await memory.enable(homeId,user.id);memoryConsents.delete(pending); await reply('Memori jangka panjang aktif. Simpan secara manual dengan !ingat teks. Data disimpan di database bot dan dikirim ke provider saat chat DM; operator database dapat mengaksesnya. Jangan simpan data sensitif.'); }
      else if (/^nonaktif$/i.test(argument)) { await memory.disable(homeId,user.id); await reply('Memori jangka panjang dinonaktifkan dan semua isinya dihapus dari penyimpanan aktif. Cadangan database mungkin tetap menyimpan salinan.'); }
      else if (/^hapus semua$/i.test(argument)) { await memory.clear(homeId,user.id); await reply('Semua isi memori jangka panjang dihapus dari penyimpanan aktif; pengaturan tetap aktif. Cadangan database mungkin tetap menyimpan salinan.'); }
      else if (/^hapus \d+$/i.test(argument)) { await memory.remove(homeId,user.id,Number(argument.split(/\s+/)[1])); await reply('Memori dihapus dari penyimpanan aktif.'); }
      else if (!argument) { const row=await memory.read(homeId,user.id); await reply(`Memori jangka panjang: ${row.enabled?'aktif':'nonaktif'}.\n${row.items.length?row.items.map((x,i)=>`${i+1}. ${x}`).join('\n'):'Belum ada memori.'}\nPerintah: !memori aktif lalu !memori setuju, !ingat teks, !memori hapus nomor, !memori hapus semua, !memori nonaktif. Jangan simpan data sensitif.`); }
      else await reply('Gunakan !memori, !memori aktif lalu !memori setuju, !ingat teks, !memori hapus nomor, !memori hapus semua, atau !memori nonaktif.');
    } catch (error) { await reply(error?.status && error.status < 500 ? error.message : 'Memori tidak tersedia. Coba lagi nanti.'); }
    return true;
  }
  // Ends the session without touching the stored memory; the user can clear it with the button.
  if (/^\/?akhiri$/i.test(content)) { endDMSession(homeId, user.id); await reply('Sesi chat ditutup. Sampai jumpa! Klik tombol **Mulai chatting** di pesan awal kalau mau ngobrol lagi.'); return true; }
  if (!touchDMSession(homeId, user.id)) { await reply('Klik tombol **Mulai chatting** di pesan awal dulu ya — itu persetujuanmu bahwa pesan dikirim ke provider AI eksternal.'); return true; }
  const files = message.attachments ? [...(message.attachments.values ? message.attachments.values() : message.attachments)] : [];
  if (files.length > 1) { await reply('Satu lampiran saja ya.'); return true; }
  const file = files[0] ?? null, name = file?.name ?? '';
  let image = null, audio = null, textFile = null;
  if (file) { if (IMAGE.test(name)) image = file; else if (AUDIO.test(name)) audio = file; else if (FILE.test(name)) textFile = file; else { await reply('Lampiran yang didukung: PNG/JPEG, audio, atau TXT/MD/CSV/JSON.'); return true; } }
  const question = content || (file ? 'Tolong periksa lampiran ini.' : '');
  if (!question) { await reply('Tulis pesan atau kirim satu lampiran ya.'); return true; }
  if (question.length > 1500) { await reply('Pertanyaan maksimal 1500 karakter ya.'); return true; }
  await message.channel.sendTyping?.().catch(() => {});
  let streamMessage = null, streamAttempted = false, lastEdit = 0, partial = '';
  const onDelta = async text => {
    partial = text.slice(0, 1850);
    if (!partial.trim()) return;
    if (!streamMessage) {
      // A failed send may still have reached Discord: never send a duplicate.
      streamAttempted = true;
      streamMessage = await message.channel.send({content:partial,allowedMentions:{parse:[]}});
      lastEdit = Date.now();
    } else if (Date.now() - lastEdit >= 1400) {
      await streamMessage.edit({content:partial,allowedMentions:{parse:[]}}); lastEdit = Date.now();
    }
  };
  try {
    const result = await runChat({ client, guildId: homeId, channelId: null, userId: user.id, question, consent: true, dm: true, memory: true, attachment: image, audioAttachment: audio, fileAttachment: textFile, onDelta });
    const sources = result.sources.length ? '\n\nSumber kandidat: ' + result.sources.map((x) => `[${x.index}] ${x.name}`).join(', ') : '';
    const final = (result.text + sources).slice(0, 2000);
    if (streamMessage) await streamMessage.edit({content:final,allowedMentions:{parse:[]}}); else if (!streamAttempted) await reply(final);
  } catch (error) {
    if (streamMessage) await streamMessage.edit({content:error?.code==='STREAM_FILTERED'?'Respons diblokir oleh kebijakan provider.':`${partial.slice(0,1850)}\n\n-# Jawaban terputus; mungkin belum lengkap.`,allowedMentions:{parse:[]}}).catch(()=>{});
    else if (!streamAttempted) await reply(error?.status && error.status < 500 ? error.message : 'Chat AI tidak tersedia. Coba lagi nanti.');
  }
  return true;
}

