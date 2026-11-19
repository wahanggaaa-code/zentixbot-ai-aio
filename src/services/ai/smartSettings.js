// Settings of the "Fitur pintar" room of AI Studio: one record per server, one section per feature.
// Every section has its own on/off switch and is saved on its own; every feature starts switched off.
import { ChannelType } from 'discord.js';
import { createKV } from './kv.js';

export const MAX_SMART_CHANNELS = 10;
export const MAX_FAQ_ENTRIES = 25;
/** Languages the translator offers: code → the name used in the prompt and on the dashboard. */
export const LANGUAGES = Object.freeze({
    id: 'Bahasa Indonesia', en: 'Bahasa Inggris', ja: 'Bahasa Jepang', ko: 'Bahasa Korea', zh: 'Bahasa Mandarin', ar: 'Bahasa Arab',
    fr: 'Bahasa Prancis', de: 'Bahasa Jerman', es: 'Bahasa Spanyol', it: 'Bahasa Italia', pt: 'Bahasa Portugis', ru: 'Bahasa Rusia',
    nl: 'Bahasa Belanda', tr: 'Bahasa Turki', pl: 'Bahasa Polandia', uk: 'Bahasa Ukraina', cs: 'Bahasa Ceko', ro: 'Bahasa Rumania',
    hu: 'Bahasa Hongaria', el: 'Bahasa Yunani', th: 'Bahasa Thai', vi: 'Bahasa Vietnam', ms: 'Bahasa Melayu', sv: 'Bahasa Swedia',
}); // 24 languages + the /personal reset choice = exactly Discord's 25 option cap.
export const ZONES = Object.freeze({ WIB: 'Asia/Jakarta', WITA: 'Asia/Makassar', WIT: 'Asia/Jayapura' });

export const DEFAULT_SMART = Object.freeze({
    // Answers kept by the owner. A match is answered by the bot itself, without an AI request.
    faq: Object.freeze({ enabled: false, autoAnswer: false, varyWithAI: false, channelIds: Object.freeze([]), entries: Object.freeze([]) }),
    // The same question asked again within `minutes` gets the earlier answer, without an AI request.
    cache: Object.freeze({ enabled: false, minutes: 15 }),
    // Counts AI requests per day, per kind and per member for the report.
    usage: Object.freeze({ enabled: false }),
    // Entries in the menu of a message (press and hold, or right click → Apps).
    menu: Object.freeze({ translate: false, explain: false, factCheck: false, recap: false, language: 'id' }),
    // News, up to three scheduled editions per day.
    digest: Object.freeze({ enabled: false, channelIds: Object.freeze([]), times: Object.freeze(['07:00']), zone: 'WIB', topics: '' }),
    // Independent daily facts.
    facts: Object.freeze({ enabled: false, channelId: null, times: Object.freeze(['07:00']), zone: 'WIB', topics: '' }),
    // Additions to AI Welcome and AI Goodbye, written by the bot itself.
    greeting: Object.freeze({ multilingual: false, tenure: false }),
    // Translates what members write in the chosen channels.
    translate: Object.freeze({ enabled: false, channelIds: Object.freeze([]), target: 'id', hourlyLimit: 30, reactionEnabled: false, deleteAfterSeconds: 0, channelLanguages: Object.freeze({}), reverse: Object.freeze([]) }),
});
export const SMART_SECTIONS = Object.freeze(Object.keys(DEFAULT_SMART));

const SNOWFLAKE = /^\d{17,20}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const err = (message, status = 400) => Object.assign(new Error(message), { status, code: 'INVALID_SMART' });
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const oneLine = (text) => String(text).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

function exact(v, section) {
    const keys = Object.keys(DEFAULT_SMART[section]);
    if (!plain(v) || Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) throw err('Pengaturan tidak valid.');
}
function booleans(v, names) {
    if (names.some((k) => typeof v[k] !== 'boolean')) throw err('Pilihan aktif/nonaktif tidak valid.');
}
function channelList(value, guild, label) {
    if (!Array.isArray(value) || value.length > MAX_SMART_CHANNELS) throw err(`${label}: paling banyak ${MAX_SMART_CHANNELS} channel.`);
    if (value.some((id) => typeof id !== 'string' || !SNOWFLAKE.test(id)) || new Set(value).size !== value.length) throw err(`${label}: channel tidak valid.`);
    if (guild && value.some((id) => guild.channels.cache.get(id)?.type !== ChannelType.GuildText)) throw err(`${label}: pilih channel teks server.`);
    return [...value];
}

const MAX_REVERSE = 5;
/** Per-channel target overrides: only overrides for channels in the chosen set are kept; the rest are dropped, not an error. */
function checkChannelLanguages(value, channelIds, guild) {
    if (!plain(value)) throw err('Bahasa khusus per channel tidak valid.');
    const entries = Object.entries(value);
    if (entries.length > MAX_SMART_CHANNELS) throw err(`Bahasa khusus: paling banyak ${MAX_SMART_CHANNELS} channel.`);
    const out = {};
    for (const [id, target] of entries) {
        if (!SNOWFLAKE.test(id)) throw err('Bahasa khusus: ID channel tidak valid.');
        if (!Object.hasOwn(LANGUAGES, target)) throw err('Bahasa khusus: bahasa tujuan tidak valid.');
        if (!channelIds.includes(id)) continue;
        if (guild && guild.channels?.cache?.get?.(id)?.type !== ChannelType.GuildText) throw err('Bahasa khusus: pilih channel teks server.');
        out[id] = target;
    }
    return out;
}
/** Two-way channels: messages in either language are translated into the other; any other language is left alone (the AI answers SAMA). */
function checkReverse(value, guild) {
    if (!Array.isArray(value) || value.length > MAX_REVERSE) throw err(`Pasangan dua arah: paling banyak ${MAX_REVERSE} pasangan.`);
    const seen = new Set(), out = [];
    for (const entry of value) {
        if (!plain(entry) || Object.keys(entry).length !== 3 || !SNOWFLAKE.test(entry.channelId ?? '')
            || !Object.hasOwn(LANGUAGES, entry.langA) || !Object.hasOwn(LANGUAGES, entry.langB)) throw err('Pasangan dua arah tidak valid.');
        if (entry.langA === entry.langB) throw err('Pasangan dua arah: dua bahasa harus berbeda.');
        if (seen.has(entry.channelId)) throw err('Pasangan dua arah: channel yang sama dipakai dua kali.');
        seen.add(entry.channelId);
        if (guild && guild.channels?.cache?.get?.(entry.channelId)?.type !== ChannelType.GuildText) throw err('Pasangan dua arah: pilih channel teks server.');
        out.push({ channelId: entry.channelId, langA: entry.langA, langB: entry.langB });
    }
    return out;
}
const VALIDATORS = {
    faq(v, guild) {
        booleans(v, ['enabled', 'autoAnswer', 'varyWithAI']);
        const channelIds = channelList(v.channelIds, guild, 'Channel FAQ');
        if (!Array.isArray(v.entries) || v.entries.length > MAX_FAQ_ENTRIES) throw err(`FAQ: paling banyak ${MAX_FAQ_ENTRIES} entri.`);
        const entries = v.entries.map((entry) => {
            if (!plain(entry) || Object.keys(entry).length !== 3 || typeof entry.id !== 'string' || !/^[a-z0-9]{6,16}$/.test(entry.id) || typeof entry.question !== 'string' || typeof entry.answer !== 'string') throw err('Entri FAQ tidak valid.');
            const question = oneLine(entry.question), answer = entry.answer.trim();
            if (question.length < 3 || question.length > 150) throw err('Pertanyaan FAQ harus 3–150 karakter.');
            if (!answer || answer.length > 800) throw err('Jawaban FAQ harus 1–800 karakter.');
            return { id: entry.id, question, answer };
        });
        if (new Set(entries.map((e) => e.id)).size !== entries.length) throw err('Entri FAQ ganda.');
        if (v.autoAnswer && channelIds.length === 0) throw err('Jawab otomatis memerlukan minimal satu channel.');
        return { enabled: v.enabled, autoAnswer: v.autoAnswer, varyWithAI: v.varyWithAI, channelIds, entries };
    },
    cache(v) {
        booleans(v, ['enabled']);
        if (!Number.isInteger(v.minutes) || v.minutes < 1 || v.minutes > 120) throw err('Lama cache harus 1–120 menit.');
        return { ...v };
    },
    usage(v) { booleans(v, ['enabled']); return { ...v }; },
    menu(v) {
        booleans(v, ['translate', 'explain', 'factCheck', 'recap']);
        if (!Object.hasOwn(LANGUAGES, v.language)) throw err('Bahasa tujuan tidak valid.');
        return { ...v };
    },
    digest(v, guild) {
        booleans(v, ['enabled']);
        if (!Array.isArray(v.channelIds) || v.channelIds.length > 1) throw err('Pilih paling banyak satu channel koran hari ini.');
        const channelIds = channelList(v.channelIds, guild, 'Channel koran hari ini');
        if (!Array.isArray(v.times) || v.times.length < 1 || v.times.length > 3 || v.times.some(t => typeof t !== 'string' || !CLOCK.test(t)) || new Set(v.times).size !== v.times.length) throw err('Jam kirim harus 1–3 waktu yang valid dan berbeda.');
        if (!Object.hasOwn(ZONES, v.zone)) throw err('Zona waktu tidak valid.');
        if (typeof v.topics !== 'string' || v.topics.length > 120) throw err('Topik paling banyak 120 karakter.');
        if (v.enabled && channelIds.length === 0) throw err('Koran hari ini memerlukan minimal satu channel.');
        return { ...v, times: [...v.times], channelIds, topics: oneLine(v.topics) };
    },
    facts(v, guild) {
        booleans(v, ['enabled']);
        if (v.channelId !== null && (typeof v.channelId !== 'string' || !SNOWFLAKE.test(v.channelId))) throw err('Channel fakta tidak valid.');
        if (v.channelId && guild && guild.channels.cache.get(v.channelId)?.type !== ChannelType.GuildText) throw err('Pilih satu channel teks untuk fakta.');
        if (v.enabled && !v.channelId) throw err('Pilih satu channel untuk fakta.');
        if (!Array.isArray(v.times) || v.times.length < 1 || v.times.length > 3 || v.times.some(t => typeof t !== 'string' || !CLOCK.test(t)) || new Set(v.times).size !== v.times.length) throw err('Pilih 1–3 jam fakta yang valid dan berbeda.');
        if (!Object.hasOwn(ZONES, v.zone)) throw err('Zona waktu fakta tidak valid.');
        if (typeof v.topics !== 'string' || v.topics.length > 120) throw err('Topik paling banyak 120 karakter.');
        return {...v, times: [...v.times], topics: oneLine(v.topics)};
    },
    greeting(v) { booleans(v, ['multilingual', 'tenure']); return { ...v }; },
    translate(v, guild) {
        booleans(v, ['enabled', 'reactionEnabled']);
        const channelIds = channelList(v.channelIds, guild, 'Channel terjemahan');
        if (!Object.hasOwn(LANGUAGES, v.target)) throw err('Bahasa tujuan tidak valid.');
        if (!Number.isInteger(v.hourlyLimit) || v.hourlyLimit < 1 || v.hourlyLimit > 120) throw err('Batas per jam harus 1–120.');
        if (!Number.isInteger(v.deleteAfterSeconds) || v.deleteAfterSeconds < 0 || v.deleteAfterSeconds > 3600) throw err('Hapus balasan otomatis harus antara 0–3600 detik.');
        const channelLanguages = checkChannelLanguages(v.channelLanguages, channelIds, guild);
        const reverse = checkReverse(v.reverse, guild);
        if ((v.enabled || v.reactionEnabled) && channelIds.length === 0) throw err('Terjemahan otomatis dan reaksi bendera memerlukan minimal satu channel.');
        return { ...v, channelIds, channelLanguages, reverse };
    },
};

/** Checks one complete section; `guild` (optional) also checks that the channels exist. */
export function validateSmartSection(section, value, guild) {
    if (!Object.hasOwn(VALIDATORS, section)) throw err('Bagian pengaturan tidak dikenal.', 404);
    if (section === 'faq' && plain(value) && !Object.hasOwn(value,'varyWithAI')) value = { ...value, varyWithAI: false };
    exact(value, section);
    return VALIDATORS[section](value, guild);
}

const copy = (section) => structuredClone(DEFAULT_SMART[section]);
export const defaultSmart = () => Object.fromEntries(SMART_SECTIONS.map((section) => [section, copy(section)]));

/** A stored record as usable settings. Keys added later get their default; a broken section falls back to "off". */
export function upgradeSmart(stored) {
    const out = {};
    for (const section of SMART_SECTIONS) {
        const known = Object.keys(DEFAULT_SMART[section]);
        let raw = plain(stored?.[section]) ? stored[section] : {};
        // Preserve the first previously selected digest channel; extra legacy destinations are no longer used.
        if (section === 'digest' && Array.isArray(raw.channelIds) && raw.channelIds.length > 1) raw = {...raw, channelIds: raw.channelIds.slice(0, 1)};
        // Keep a previously configured single time as the first slot without changing its enabled state.
        if ((section === 'facts' || section === 'digest') && !Object.hasOwn(raw, 'times') && Object.hasOwn(raw, 'time')) raw = {...raw, times: [raw.time]};
        try { out[section] = validateSmartSection(section, { ...copy(section), ...Object.fromEntries(known.filter((k) => Object.hasOwn(raw, k)).map((k) => [k, raw[k]])) }); }
        catch { out[section] = copy(section); }
    }
    return out;
}

export function createSmartStore(client, kv = createKV(client)) {
    const key = (guildId) => `ai:smart:settings:${guildId}`;
    return {
        async read(guildId) { return upgradeSmart(await kv.get(key(guildId))); },
        /** Saves one section and returns all settings. The other sections are kept as stored. */
        async saveSection(guildId, section, value) {
            const checked = validateSmartSection(section, value);
            return kv.update(key(guildId), (current) => ({ ...upgradeSmart(current), [section]: checked }));
        },
    };
}
