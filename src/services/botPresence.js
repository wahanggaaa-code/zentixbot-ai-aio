import { createKV } from './ai/kv.js';
import { botConfig } from '../config/bot.js';

const error = (message, status = 400) => Object.assign(new Error(message), { status });
const STATUSES = new Set(['online', 'idle', 'dnd', 'invisible']);
export function validateBotPresence(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value,'status') || !Object.hasOwn(value,'text')) throw error('Pengaturan status tidak valid.');
 if (!STATUSES.has(value.status)) throw error('Status online tidak valid.');
 if (typeof value.text !== 'string' || value.text.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(value.text)) throw error('Tulisan status harus paling banyak 128 karakter tanpa karakter kontrol.');
 return { status:value.status, text:value.text.trim() };
}
function defaultPresence() {
 return validateBotPresence({ status:botConfig.presence.status, text:botConfig.presence.activities?.[0]?.state ?? '' });
}
function discordPresence(settings) {
 return {status:settings.status, activities:settings.text ? [{name:'Custom Status',state:settings.text,type:4}] : []};
}

// One queue per client orders startup restoration and dashboard writes. A successful
// setPresence only means it was submitted to the gateway; Discord sends no confirmation.
export function createBotPresence(client, store = createKV(client)) {
 const key = 'bot:presence:settings';
 let chain = Promise.resolve();
 const serialize = (job) => { const result = chain.then(job); chain = result.catch(() => {}); return result; };
 const read = async () => { const saved = await store.get(key); return saved === null ? defaultPresence() : validateBotPresence(saved); };
 const apply = async (settings) => {
  if (client.isReady?.() === false || typeof client.user?.setPresence !== 'function') return false;
  try { await client.user.setPresence(discordPresence(settings)); return true; } catch { return false; }
 };
 return {
  read: () => serialize(read),
  restore: () => serialize(async () => { const settings = await read(); return {settings, sent:await apply(settings)}; }),
  save: (value) => serialize(async () => { const settings = validateBotPresence(value); await store.set(key, settings); return {settings, sent:await apply(settings)}; }),
 };
}
const services = new WeakMap();
export function botPresenceFor(client) {
 if (!services.has(client)) services.set(client, createBotPresence(client));
 return services.get(client);
}
