import { createChatStore, requireDMMembership, runChat } from './chat.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';

// DM chat sessions: an in-process, opt-in gate between "user clicked Mulai chatting" and the AI answering.
// Sliding 30-minute idle TTL, like the DM memory. A restart asks for one click again.
const sessions = new Map();
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
  if (!await requireDMMembership(client, homeId, user.id)) { await reply('Chat hanya tersedia untuk anggota server utama.'); return true; }
  let cfg;
  try { cfg = await createChatStore(client).read(homeId); } catch { await reply('Chat DM belum tersedia. Coba lagi nanti.'); return true; }
  if (!cfg.dmEnabled) { await reply('Chat DM sedang nonaktif. Minta owner di server untuk mengaktifkannya.'); return true; }
  if (!await checkRateLimit(`ai-dm:${homeId}:${user.id}`, RATE_LIMIT_ATTEMPTS, RATE_LIMIT_WINDOW_MS)) { await reply('Pelan-pelan ya, terlalu banyak pesan. Coba lagi sebentar lagi.'); return true; }
  const content = String(message.content ?? '').trim();
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
  try {
    const result = await runChat({ client, guildId: homeId, channelId: null, userId: user.id, question, consent: true, dm: true, memory: true, attachment: image, audioAttachment: audio, fileAttachment: textFile });
    const sources = result.sources.length ? '\n\nSumber kandidat: ' + result.sources.map((x) => `[${x.index}] ${x.name}`).join(', ') : '';
    await reply((result.text + sources).slice(0, 2000));
  } catch (error) {
    await reply(error?.status && error.status < 500 ? error.message : 'Chat AI tidak tersedia. Coba lagi nanti.');
  }
  return true;
}

