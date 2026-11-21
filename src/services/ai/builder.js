// Server Builder: turns a description or a ready-made theme into categories, channels and roles on the
// home server, and can take its own builds down again.
//
// The steps are always the same: a plan is drafted (by the AI or from a theme), shown for review, optionally
// edited, and only created on Discord after an explicit confirmation by the same person who drafted it.
// A plan is kept in memory for five minutes and can be applied once.
//
// What is created is written to a history (builderHistory.js) with the Discord ID of every object. Taking a
// build down ("bongkar") deletes exactly those IDs, newest build first, after a typed confirmation.
import crypto from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createBuilderHistory, MAX_BUILDS } from './builderHistory.js';
import { getTheme, pickTheme } from './builderThemes.js';
import { createKV } from './kv.js';

const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });

export const PLAN_LIMITS = Object.freeze({ categories: 8, channelsPerCategory: 15, channels: 40, roles: 12, nameLength: 50, topicLength: 200 });
/** How long a drafted plan or an undo review stays valid. */
export const PLAN_TTL_MS = 300000;
const MAX_PENDING = 50;

// Channel types a plan may use. `slug` types are named like text channels (lower case, no spaces); the others
// take a free label. `community` types exist only on servers with Discord's Community feature.
const TYPES = Object.freeze({
    text: { discord: ChannelType.GuildText, slug: true, topic: true, community: false },
    voice: { discord: ChannelType.GuildVoice, slug: false, topic: false, community: false },
    forum: { discord: ChannelType.GuildForum, slug: true, topic: true, community: true },
    news: { discord: ChannelType.GuildAnnouncement, slug: true, topic: true, community: true },
    stage: { discord: ChannelType.GuildStageVoice, slug: false, topic: false, community: true },
});
export const CHANNEL_TYPES = Object.freeze(Object.keys(TYPES));

// Names are checked against a list of allowed characters instead of a list of forbidden ones: letters and
// digits of any script, emoji, a few separators people decorate channel names with, and plain punctuation.
// That leaves out everything Discord gives a meaning to: @ # < > : ` * ~ | and line breaks.
const EMOJI = '\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\u200d\\ufe0f\\u20e3';
const DECOR = '・•│┃｜︱';
const LABEL = new RegExp(`^[\\p{L}\\p{M}\\p{N}${EMOJI}${DECOR} _.,&'+!?()/-]+$`, 'u');
const SLUG = new RegExp(`^[\\p{L}\\p{M}\\p{N}${EMOJI}${DECOR}_-]+$`, 'u');
const HAS_WORD = /[\p{L}\p{N}]/u;

/** A category, role, voice or stage name: trimmed, or null when it is not acceptable. */
function label(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name.length >= 1 && name.length <= PLAN_LIMITS.nameLength && LABEL.test(name) && HAS_WORD.test(name) ? name : null;
}

/** A text, forum or announcement channel name: lower case, no spaces; or null. */
function slug(value) {
    if (typeof value !== 'string') return null;
    return value.length >= 1 && value.length <= PLAN_LIMITS.nameLength && SLUG.test(value) && HAS_WORD.test(value) && value === value.toLowerCase() ? value : null;
}

/** True when `value` is a plain object with all `required` keys and no key outside `required` and `optional`. */
function shaped(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

// Raw permission bits are never accepted. Existing roles are selected explicitly by ID and rechecked against Discord.
function cleanAccess(access, where) {
    if (!shaped(access, ['mode', 'roles'], ['existingRoles']) || !['read-only', 'private', 'private-read-only'].includes(access.mode) || !Array.isArray(access.roles) || access.roles.length > PLAN_LIMITS.roles || (access.existingRoles !== undefined && !Array.isArray(access.existingRoles))) throw err(`${where}: access harus berisi mode dan daftar role.`);
    const roles = access.roles.map(label), existingRoles = access.existingRoles ?? [];
    if (roles.some(x => !x) || new Set(roles.map(x => x.toLowerCase())).size !== roles.length || existingRoles.length > 25 || new Set(existingRoles).size !== existingRoles.length || existingRoles.some(id=>typeof id !== 'string' || !/^\d{17,20}$/.test(id)) || roles.length + existingRoles.length === 0) throw err(`${where}: daftar role akses tidak valid atau berulang.`);
    return { mode: access.mode, roles, ...(existingRoles.length ? {existingRoles:[...existingRoles]} : {}) };
}
const WRITING = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads];
function accessOverwrites(access, guild, botId, roleIds) {
    const restricted = access.mode === 'private' || access.mode === 'private-read-only';
    const readOnly = access.mode === 'read-only' || access.mode === 'private-read-only';
    const denied = [...(restricted ? [PermissionFlagsBits.ViewChannel] : []), ...(readOnly ? WRITING : [])];
    const allowed = [...(restricted ? [PermissionFlagsBits.ViewChannel] : []), ...(readOnly ? WRITING : [])];
    return [
        { id: guild.id, deny: denied },
        ...access.roles.map(name => ({ id: roleIds.get(name.toLowerCase()), allow: allowed })),
        ...(access.existingRoles || []).map(id => ({id, allow: allowed})),
        { id: botId, type: 1, allow: allowed },
    ];
}

/**
 * Checks a plan and returns a clean copy; throws (status 400) with the place of the first problem.
 *
 * Access uses fixed presets and explicitly selected role IDs. Raw permission bits and deletions are not accepted.
 */
export function validatePlan(value) {
    if (!shaped(value, ['categories', 'roles']) || !Array.isArray(value.categories) || !Array.isArray(value.roles)) {
        throw err('Rancangan harus berupa objek berisi "categories" dan "roles" saja.');
    }
    if (value.categories.length < 1 || value.categories.length > PLAN_LIMITS.categories) throw err(`Rancangan harus memiliki 1–${PLAN_LIMITS.categories} kategori.`);
    if (value.roles.length > PLAN_LIMITS.roles) throw err(`Rancangan paling banyak memiliki ${PLAN_LIMITS.roles} role.`);

    const categoryNames = new Set(), channelNames = new Set(), roleNames = new Set();
    let total = 0;
    const categories = value.categories.map((category, c) => {
        const at = `Kategori ke-${c + 1}`;
        if (!shaped(category, ['name', 'channels'], ['access']) || !Array.isArray(category.channels)) throw err(`${at}: harus berisi "name" dan "channels" saja.`);
        const name = label(category.name);
        if (!name) throw err(`${at}: nama tidak valid.`);
        if (categoryNames.has(name.toLowerCase())) throw err(`${at}: nama kategori dipakai dua kali.`);
        categoryNames.add(name.toLowerCase());
        if (category.channels.length > PLAN_LIMITS.channelsPerCategory) throw err(`${at}: paling banyak ${PLAN_LIMITS.channelsPerCategory} channel per kategori.`);
        const channels = category.channels.map((channel, i) => {
            const where = `Channel ke-${i + 1} di kategori ke-${c + 1}`;
            if (!shaped(channel, ['name', 'type'], ['topic', 'access'])) throw err(`${where}: harus berisi "name" dan "type", boleh ditambah "topic".`);
            const type = Object.hasOwn(TYPES, channel.type) ? TYPES[channel.type] : null;
            if (!type) throw err(`${where}: "type" harus salah satu dari ${CHANNEL_TYPES.join(', ')}.`);
            const channelName = type.slug ? slug(channel.name) : label(channel.name);
            if (!channelName) throw err(type.slug ? `${where}: nama channel ${channel.type} harus huruf kecil tanpa spasi (pakai -).` : `${where}: nama tidak valid.`);
            if (channelNames.has(channelName.toLowerCase())) throw err(`${where}: nama channel dipakai dua kali.`);
            channelNames.add(channelName.toLowerCase());
            total++;
            const clean = { name: channelName, type: channel.type };
            if (channel.topic !== undefined && channel.topic !== null) {
                if (typeof channel.topic !== 'string') throw err(`${where}: "topic" harus berupa teks.`);
                const topic = channel.topic.trim();
                if (topic) {
                    if (!type.topic) throw err(`${where}: "topic" hanya untuk channel text, forum atau news.`);
                    if (topic.length > PLAN_LIMITS.topicLength || /[\u0000-\u001f\u007f@<>`]|:\/\//.test(topic)) throw err(`${where}: "topic" paling banyak ${PLAN_LIMITS.topicLength} karakter, satu baris, tanpa @, <, >, \` atau tautan.`);
                    clean.topic = topic;
                }
            }
            if (channel.access !== undefined) clean.access = cleanAccess(channel.access, where);
            return clean;
        });
        return { name, channels, ...(category.access !== undefined ? { access: cleanAccess(category.access, at) } : {}) };
    });
    if (total < 1 || total > PLAN_LIMITS.channels) throw err(`Rancangan harus memiliki 1–${PLAN_LIMITS.channels} channel.`);

    const roles = value.roles.map((entry, r) => {
        const at = `Role ke-${r + 1}`;
        const given = typeof entry === 'string' ? { name: entry } : entry;
        if (!shaped(given, ['name'], ['color'])) throw err(`${at}: harus berisi "name", boleh ditambah "color".`);
        const name = label(given.name);
        if (!name || ['everyone', 'here'].includes(name.toLowerCase())) throw err(`${at}: nama tidak valid.`);
        if (roleNames.has(name.toLowerCase())) throw err(`${at}: nama role dipakai dua kali.`);
        roleNames.add(name.toLowerCase());
        if (given.color === undefined || given.color === null) return { name };
        if (typeof given.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(given.color)) throw err(`${at}: "color" harus berbentuk #RRGGBB.`);
        return { name, color: given.color.toUpperCase() };
    });
    for (const category of categories) {
        if (['private', 'private-read-only'].includes(category.access?.mode) && category.channels.some(c => c.access?.mode === 'read-only')) throw err(`Kategori ${category.name} privat: channel baca saja harus memakai private-read-only agar tidak membuka akses lihat.`);
    }
    for (const category of categories) for (const access of [category.access, ...category.channels.map(c => c.access)].filter(Boolean)) {
        for (const name of access.roles) if (!roleNames.has(name.toLowerCase())) throw err(`Role akses ${name} tidak ada di rancangan.`);
        access.roles = access.roles.map(name => roles.find(r => r.name.toLowerCase() === name.toLowerCase()).name);
    }
    return { categories, roles };
}

/** How many categories, channels and roles a plan holds. */
export function planCounts(plan) {
    return {
        categories: plan.categories.length,
        channels: plan.categories.reduce((sum, category) => sum + category.channels.length, 0),
        roles: plan.roles.length,
    };
}

/** How many categories, channels and roles a list of created (or recorded) objects holds. */
export function itemCounts(items) {
    const counts = { categories: 0, channels: 0, roles: 0 };
    for (const item of items) counts[item.type === 'category' ? 'categories' : item.type === 'role' ? 'roles' : 'channels']++;
    return counts;
}

/**
 * How large a plan the AI is asked for. A provider stops writing at the owner's "max output tokens"
 * setting, and a plan cut off in the middle is not valid JSON, so the request is sized to fit: about 24
 * tokens per channel, twice that once topics are asked for.
 */
export function planSizeFor(maxOutputTokens) {
    const budget = Number.isInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 256;
    const topics = budget >= 1200;
    const channels = Math.max(4, Math.min(PLAN_LIMITS.channels, Math.floor((budget * 0.8 - 60) / (topics ? 48 : 24))));
    return {
        topics,
        channels,
        categories: Math.max(1, Math.min(PLAN_LIMITS.categories, Math.ceil(channels / 4))),
        roles: Math.max(1, Math.min(PLAN_LIMITS.roles, Math.floor(channels / 3))),
    };
}

function buildPrompt(description, size, community) {
    const types = community ? 'text, voice, forum, news (pengumuman) atau stage' : 'text atau voice';
    return [
        'Buat rancangan struktur server Discord dari deskripsi di bawah. Keluarkan HANYA satu objek JSON, tanpa penjelasan dan tanpa blok kode, dengan bentuk persis seperti contoh ini:',
        `{"categories":[{"name":"💬 Obrolan","channels":[{"name":"ngobrol-umum","type":"text"${size.topics ? ',"topic":"Obrolan santai."' : ''}},{"name":"Ruang Santai","type":"voice"}]}],"roles":[{"name":"🎮 Gamer","color":"#57F287"}]}`,
        'Aturan:',
        `- Paling banyak ${size.categories} kategori, ${size.channels} channel seluruhnya dan ${size.roles} role. Rancangan ringkas yang utuh lebih baik daripada rancangan panjang yang terpotong.`,
        `- "type" hanya ${types}.`,
        '- Nama channel selain voice dan stage: huruf kecil, tanpa spasi (pakai -), boleh diawali emoji. Nama kategori, role, voice dan stage boleh memakai huruf besar, spasi dan emoji.',
        `- Semua nama paling banyak ${PLAN_LIMITS.nameLength} karakter, tanpa @ # < > : dan tidak boleh ada dua channel bernama sama.`,
        size.topics ? `- "topic" opsional, hanya untuk channel selain voice dan stage, satu kalimat pendek tanpa tautan.` : '- Jangan sertakan "topic".',
        '- "color" opsional, berbentuk #RRGGBB.',
        '- Untuk izin channel/kategori opsional tambahkan contoh "access":{"mode":"read-only","roles":["Admin"]}, dengan mode yang boleh hanya read-only, private atau private-read-only. read-only: everyone tidak boleh mengirim pesan atau membuat thread, role tersebut boleh; private: everyone tidak bisa melihat, role tersebut boleh melihat. private-read-only: gabungkan keduanya. Dalam kategori privat gunakan private-read-only, bukan read-only, untuk channel baca saja. Jika tidak ada access, channel mengikuti kategori atau pengaturan server. Role harus ada di roles, tidak boleh kosong. Jangan gunakan access untuk sekadar channel umum.',
        '- Jangan sertakan izin mentah, ID, penghapusan atau kunci lain.',
        'Deskripsi:',
        description,
    ].join('\n');
}

/** Reads the JSON object out of an AI answer, also when the model wrapped it in a code block or a sentence. */
export function parsePlanText(text) {
    const source = String(text ?? '');
    const start = source.indexOf('{'), end = source.lastIndexOf('}');
    if (start < 0 || end <= start) throw err('Jawaban AI tidak berisi JSON.');
    return JSON.parse(source.slice(start, end + 1));
}

const shortLabel = (value, max = 60) => {
    const flat = String(value).replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const UNKNOWN_CHANNEL = 10003, UNKNOWN_ROLE = 10011;

export function createBuilder({ client, foundation = client.aiFoundation, now = Date.now, history = createBuilderHistory(client), drafts = createKV(client) }) {
    const plans = new Map();   // plan id → {guildId, userId, plan, expires, source, label, edited}
    const tickets = new Map(); // undo review id → {guildId, userId, buildId, count, expires}
    const activeGuilds = new Set();

    const home = (guildId) => typeof guildId === 'string' && guildId === client.homeGuildId;
    function purge() {
        for (const [id, entry] of plans) if (entry.expires <= now()) plans.delete(id);
        for (const [id, entry] of tickets) if (entry.expires <= now()) tickets.delete(id);
    }
    /** Keeps a plan for review. A person has one plan at a time: a new draft replaces the earlier one. */
    function keep({ guildId, userId, plan, source, label: text, theme = null, note = null }) {
        purge();
        for (const [id, entry] of plans) if (entry.userId === userId) plans.delete(id);
        if (plans.size >= MAX_PENDING) throw err('Terlalu banyak rancangan menunggu.', 429);
        const id = crypto.randomBytes(20).toString('hex');
        plans.set(id, { guildId, userId, plan, source, label: text, theme, note, edited: false, expires: now() + PLAN_TTL_MS });
        return { id, plan, counts: planCounts(plan), source, theme, note, expiresInSeconds: PLAN_TTL_MS / 1000 };
    }
    function owned(id, guildId, userId) {
        purge();
        const entry = typeof id === 'string' ? plans.get(id) : null;
        if (!entry || entry.userId !== userId || entry.guildId !== guildId || !home(guildId)) throw err('Rancangan tidak ditemukan atau kedaluwarsa.', 404);
        return entry;
    }
    const secondsLeft = (entry) => Math.max(0, Math.ceil((entry.expires - now()) / 1000));

    /** What became of each recorded object of a build: still there, already gone, or not safe to delete. */
    async function inspect(guild, build) {
        const wantsRoles = build.items.some((item) => item.type === 'role');
        const wantsChannels = build.items.some((item) => item.type !== 'role');
        let channels = new Map(), roles = new Map();
        try {
            if (wantsChannels) channels = await guild.channels.fetch();
            if (wantsRoles) roles = await guild.roles.fetch();
        } catch {
            throw err('Keadaan server tidak dapat dibaca dari Discord. Coba lagi.', 503);
        }
        const own = new Set(build.items.map((item) => item.id));
        const system = new Set([guild.systemChannelId, guild.rulesChannelId, guild.publicUpdatesChannelId, guild.afkChannelId, guild.widgetChannelId, guild.safetyAlertsChannelId].filter(Boolean));
        const items = build.items.map((item) => {
            const notes = [];
            let state = 'delete';
            const object = item.type === 'role' ? roles.get(item.id) : channels.get(item.id);
            if (!object) return { ...item, state: 'gone', notes: ['sudah tidak ada'] };
            if (object.name !== item.name) notes.push(`sekarang bernama "${shortLabel(object.name, 50)}"`);
            if (item.type === 'role') {
                if (object.managed || object.id === guild.id || object.editable !== true) {
                    state = 'blocked';
                    notes.push('tidak dapat dihapus bot: role berada di atas role bot atau dikelola integrasi');
                } else if (BigInt(object.permissions?.bitfield ?? 0n) !== 0n) {
                    notes.push('izinnya sudah diubah');
                }
            } else if (system.has(item.id)) {
                state = 'blocked';
                notes.push('tidak dihapus: dipakai sebagai channel sistem server');
            } else if (item.type === 'category') {
                const foreign = [...channels.values()].filter((channel) => channel && channel.parentId === item.id && !own.has(channel.id)).length;
                if (foreign) {
                    state = 'blocked';
                    notes.push(`tidak dihapus: masih berisi ${foreign} channel yang bukan bagian bangunan ini`);
                }
            } else if (item.type === 'voice' || item.type === 'stage') {
                const inside = Number(object.members?.size) || 0;
                if (inside > 0) notes.push(`${inside} orang sedang di dalam`);
            } else if (object.lastMessageId) {
                notes.push('sudah berisi pesan');
            }
            return { ...item, state, notes };
        });
        return { items, channels, roles };
    }
    const deletable = (items) => items.filter((item) => item.state === 'delete').length;

    // Identical checks are run for preview and immediately before applying. They inspect cache state; Discord remains authoritative.
    function checkPlan(guild, plan, freshRoles) {
            const me = guild.members.me;
            if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels) || (plan.roles.length && !me.permissions.has(PermissionFlagsBits.ManageRoles))) {
                throw err('Bot memerlukan Manage Channels dan Manage Roles sesuai rencana.', 403);
            }
            const accesses = plan.categories.flatMap(c => [c.access, ...c.channels.map(ch => ch.access)]).filter(Boolean);
            if (accesses.length) {
                if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles) || !client.user?.id) throw err('Izin channel memerlukan Manage Roles dan identitas bot.', 403);
                const needed = [...(accesses.some(a => a.mode === 'private' || a.mode === 'private-read-only') ? [PermissionFlagsBits.ViewChannel] : []), ...(accesses.some(a => a.mode === 'read-only' || a.mode === 'private-read-only') ? WRITING : [])];
                if (needed.some(bit => !me.permissions.has(bit))) throw err('Bot harus memiliki izin dasar yang akan diatur pada channel sebelum menerapkan.', 403);
            }
            for (const access of accesses) for (const roleId of access.existingRoles || []) {
                const role = freshRoles?.get(roleId);
                if (!role || role.id === guild.id || role.managed) throw err('Role yang dipilih tidak tersedia, adalah @everyone atau dikelola integrasi. Pilih ulang.',409, {code:'PLAN_NAME_CONFLICT'});
            }
            const planned = planCounts(plan);
            const needsCommunity = plan.categories.flatMap((category) => category.channels).filter((channel) => TYPES[channel.type].community);
            if (needsCommunity.length && !guild.features?.includes?.('COMMUNITY')) {
                throw err(`Channel bertipe forum, news dan stage memerlukan fitur Komunitas Discord, yang belum aktif di server ini. Ubah tipe ${needsCommunity.length} channel itu menjadi text atau voice, atau aktifkan Komunitas di Pengaturan Server.`, 409);
            }
            const existing = [...guild.channels.cache.values()];
            const existingCategories = existing.filter((channel) => channel.type === ChannelType.GuildCategory).length;
            if (existingCategories + planned.categories > 50 || existing.length + planned.categories + planned.channels > 500 || guild.roles.cache.size + planned.roles > 250) {
                throw err('Rencana melewati batas server.', 409);
            }
            const channelNames = new Set(existing.map((channel) => String(channel.name || '').toLowerCase()));
            const roleNames = new Set([...guild.roles.cache.values()].map((role) => String(role.name || '').toLowerCase()));
            const conflicts = [];
            for (const category of plan.categories) {
                if (channelNames.has(category.name.toLowerCase())) conflicts.push(`kategori: ${category.name}`);
                for (const channel of category.channels) if (channelNames.has(channel.name.toLowerCase())) conflicts.push(`channel: ${channel.name}`);
            }
            for (const role of plan.roles) if (roleNames.has(role.name.toLowerCase())) conflicts.push(`role: ${role.name}`);
            if (conflicts.length) throw err(`Nama sudah ada di server: ${conflicts.slice(0, 10).join(', ')}${conflicts.length > 10 ? ' dan lainnya' : ''}. Sunting nama lalu validasi lagi.`, 409, {code:'PLAN_NAME_CONFLICT'});

            return accesses;
    }

    return {
        /** Drafts a plan with the AI. When the AI gives no usable plan, the closest theme is used and `note` says so. */
        async draft({ guildId, userId, description, consent }) {
            if (!home(guildId) || consent !== true) throw err('Server atau persetujuan tidak valid.', 403);
            if (typeof description !== 'string' || !description.trim() || description.length > 1000) throw err('Deskripsi harus 1–1000 karakter.');
            purge();
            if (plans.size >= MAX_PENDING && ![...plans.values()].some((entry) => entry.userId === userId)) throw err('Terlalu banyak rancangan menunggu.', 429);

            let maxOutputTokens = 256;
            try { maxOutputTokens = (await foundation.store.read(guildId)).maxOutputTokens; } catch { /* the request below reports what is wrong */ }
            const community = Boolean(client.guilds?.cache?.get?.(guildId)?.features?.includes?.('COMMUNITY'));

            let plan = null, reason = null;
            try {
                const output = await foundation.generate({ guildId, userId, consent: true,kind:'builder', prompt: buildPrompt(description, planSizeFor(maxOutputTokens), community) });
                try {
                    plan = validatePlan(parsePlanText(output.text));
                    if (plan.categories.some(c => [c.access, ...c.channels.map(ch=>ch.access)].some(a=>a?.existingRoles?.length))) throw err('AI tidak boleh memilih role yang sudah ada.');
                } catch {
                    plan = null;
                    reason = 'AI tidak menghasilkan rancangan yang valid (jawabannya terpotong atau bentuknya salah).';
                }
            } catch (error) {
                // A wrong server, member or consent is not a reason to build something else instead.
                if (error?.code === 'FORBIDDEN' || error?.code === 'CONSENT_REQUIRED') throw error;
                reason = error?.status && error.status < 500 && typeof error.message === 'string' ? error.message : 'Provider AI tidak dapat dihubungi.';
            }
            if (plan) return keep({ guildId, userId, plan, source: 'ai', label: shortLabel(description) });

            const theme = getTheme(pickTheme(description).id);
            const note = `${reason} Sebagai gantinya dipakai tema terdekat: ${theme.emoji} ${theme.label}. Rancangan ini tetap bisa disunting sebelum diterapkan.`;
            return keep({ guildId, userId, plan: validatePlan(theme.plan), source: 'fallback', label: theme.label, theme: { id: theme.id, label: theme.label, emoji: theme.emoji }, note });
        },

        /** Drafts a plan from a ready-made theme. Nothing is sent to an AI provider. */
        async draftFromTheme({ guildId, userId, themeId }) {
            if (!home(guildId)) throw err('Server tidak valid.', 403);
            const theme = getTheme(themeId);
            if (!theme) throw err('Tema tidak dikenal.', 404);
            return keep({ guildId, userId, plan: validatePlan(theme.plan), source: 'theme', label: theme.label, theme: { id: theme.id, label: theme.label, emoji: theme.emoji } });
        },

        /** The plan a person has waiting, or null. */
        pending({ guildId, userId }) {
            purge();
            for (const [id, entry] of plans) {
                if (entry.userId === userId && entry.guildId === guildId && home(guildId)) {
                    return { id, plan: entry.plan, counts: planCounts(entry.plan), source: entry.source, theme: entry.theme, note: entry.note, expiresInSeconds: secondsLeft(entry) };
                }
            }
            return null;
        },

        /** Replaces a waiting plan with an edited one. The five minutes are not extended. */
        async edit({ guildId, userId, id, plan }) {
            const entry = owned(id, guildId, userId);
            const updated = validatePlan(plan);
            entry.plan = updated;
            entry.edited = true;
            return { plan: updated, counts: planCounts(updated), expiresInSeconds: secondsLeft(entry) };
        },

        async preflight({guild,userId,id}) {
            const entry=owned(id,guild.id,userId), plan=entry.plan;
            let freshRoles=null;
            if (plan.categories.some(c=>[c.access,...c.channels.map(ch=>ch.access)].some(a=>a?.existingRoles?.length))) {
                try {freshRoles=await guild.roles.fetch();} catch {throw err('Daftar role Discord tidak dapat dibaca.',503)}
            }
            if (owned(id,guild.id,userId)!==entry || entry.plan!==plan) throw err('Rancangan berubah. Tinjau lagi.',409);
            checkPlan(guild,plan,freshRoles);
            return {ready:true, warning:'Pemeriksaan memakai keadaan saat ini dan tidak menjamin Discord menerima penerapan; akan diperiksa lagi saat diterapkan.'};
        },

        /** A saved, validated snapshot is separate from the short-lived one-shot apply ticket. */
        async saveDraft({guildId,userId,id}) {
            const entry=owned(id,guildId,userId);
            await drafts.set(`ai:builder:draft:${guildId}:${userId}`, {plan:entry.plan, source:entry.source, label:entry.label, theme:entry.theme, note:entry.note});
            return {saved:true};
        },
        async deleteDraft({guildId,userId}) {
            if (!home(guildId) || typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) throw err('Server atau pengguna tidak valid.',403);
            await drafts.set(`ai:builder:draft:${guildId}:${userId}`, null);
            return {deleted:true};
        },
        async restoreDraft({guildId,userId}) {
            if (!home(guildId) || typeof userId !== 'string' || !/^\d{17,20}$/.test(userId)) throw err('Server atau pengguna tidak valid.',403);
            const saved=await drafts.get(`ai:builder:draft:${guildId}:${userId}`);
            if (!saved) throw err('Belum ada draft tersimpan.',404);
            const plan=validatePlan(saved.plan);
            const source=['ai','theme','fallback'].includes(saved.source)?saved.source:'theme';
            return keep({guildId,userId,plan,source,label:shortLabel(saved.label||'Draft tersimpan'),theme:saved.theme||null,note:'Draft tersimpan dimuat kembali. Tinjau dan periksa sebelum diterapkan.'});
        },
        async listExistingRoles({guild}) {
            if (!home(guild.id)) throw err('Server tidak valid.',403);
            let roles;try {roles=await guild.roles.fetch();} catch {throw err('Daftar role Discord tidak dapat dibaca.',503)}
            return [...roles.values()].filter(r=>r && r.id !== guild.id && !r.managed).map(r=>({id:r.id,name:String(r.name||'Role').slice(0,100)}));
        },

        /** Drops a waiting plan. */
        async cancel({ guildId, userId, id }) {
            owned(id, guildId, userId);
            plans.delete(id);
            return { cancelled: true };
        },

        /** Creates the objects of a plan on Discord and records them, so the build can be taken down later. */
        async apply({ guild, userId, id, confirmed }) {
            owned(id, guild.id, userId);
            if (confirmed !== true) throw err('Konfirmasi penerapan diperlukan.');
            // Without a readable history the result could not be recorded, and so not be taken down again.
            try { await history.read(guild.id); } catch { throw err('Riwayat pembangunan tidak dapat dibaca, jadi penerapan dibatalkan. Coba lagi nanti.', 503); }
            let freshRoles = null;
            const candidate = owned(id, guild.id, userId);
            const candidatePlan = candidate.plan;
            if (candidatePlan.categories.some(c=>[c.access,...c.channels.map(ch=>ch.access)].some(a=>a?.existingRoles?.length))) {
                try { freshRoles = await guild.roles.fetch(); } catch { throw err('Daftar role Discord tidak dapat dibaca. Coba lagi.',503); }
            }
            // No await from here until the plan is consumed: a second request for the same plan finds it gone.
            const entry = owned(id, guild.id, userId);
            if (activeGuilds.has(guild.id)) throw err('Penerapan atau pembongkaran lain masih berjalan.', 409);
            const plan = entry.plan;
            if (entry !== candidate || entry.plan !== candidatePlan) throw err('Rancangan berubah saat diperiksa. Tinjau lagi.',409);
            const accesses = checkPlan(guild, plan, freshRoles);

            // Consumed before the first side effect: no repeat even if Discord later reports an error.
            plans.delete(id);
            activeGuilds.add(guild.id);
            const created = [];
            const reason = 'AI builder: owner confirmed';
            let failed = false;
            try {
                try {
                    const roleIds = new Map();
                    const createRoles = async () => {
                        for (const role of plan.roles) {
                            const result = await guild.roles.create({
                                name: role.name, permissions: 0n, mentionable: false, hoist: false,
                                ...(role.color ? { colors: { primaryColor: role.color } } : {}), reason,
                            });
                            created.push({ type: 'role', id: result.id, name: role.name });
                            roleIds.set(role.name.toLowerCase(), result.id);
                        }
                    };
                    // Restricted channels are never created until their planned staff roles exist.
                    if (accesses.length) await createRoles();
                    for (const category of plan.categories) {
                        const parentAccess = category.access ? accessOverwrites(category.access, guild, client.user.id, roleIds) : null;
                        const parent = await guild.channels.create({ name: category.name, type: ChannelType.GuildCategory, ...(parentAccess ? { permissionOverwrites: parentAccess } : {}), reason });
                        created.push({ type: 'category', id: parent.id, name: category.name });
                        for (const channel of category.channels) {
                            const overrides = channel.access ? accessOverwrites(channel.access, guild, client.user.id, roleIds) : parentAccess;
                            const result = await guild.channels.create({
                                name: channel.name, type: TYPES[channel.type].discord, parent: parent.id,
                                ...(overrides ? { permissionOverwrites: overrides } : {}),
                                ...(channel.topic ? { topic: channel.topic } : {}), reason,
                            });
                            created.push({ type: channel.type, id: result.id, name: channel.name });
                        }
                    }
                    if (!accesses.length) await createRoles();
                } catch {
                    failed = true;
                }
                let buildId = null, recorded = false;
                if (created.length) {
                    buildId = crypto.randomBytes(8).toString('hex');
                    const build = { id: buildId, at: now(), actorId: userId, label: entry.label, source: entry.source, edited: entry.edited, partial: failed, items: created };
                    try {
                        const builds = await history.read(guild.id);
                        const saved = await history.save(guild.id, [...builds, build].slice(-MAX_BUILDS));
                        // The store keeps only well-formed builds; say "recorded" only when this one is really in it.
                        recorded = saved.some((kept) => kept.id === buildId);
                    } catch { /* reported to the caller below */ }
                }
                if (failed) {
                    throw err(
                        !created.length ? 'Penerapan gagal sebelum ada yang dibuat. Periksa izin bot lalu buat rancangan baru.'
                            : recorded ? 'Penerapan berhenti di tengah jalan. Yang sudah dibuat tercatat di riwayat dan dapat dibongkar dari sana.'
                                : 'Penerapan berhenti di tengah jalan dan riwayat tidak dapat disimpan. Periksa Discord dan hapus objek di daftar hasil secara manual.',
                        409, { created, buildId, recorded });
                }
                return { created, counts: itemCounts(created), buildId, recorded };
            } finally {
                activeGuilds.delete(guild.id);
            }
        },

        /** The recorded builds of the server, newest first. Only the first one can be taken down. */
        async history({ guildId }) {
            if (!home(guildId)) throw err('Server tidak valid.', 403);
            const builds = await history.read(guildId);
            return { builds: builds.reverse().map((build) => ({ ...build, counts: itemCounts(build.items) })) };
        },

        /**
         * Looks at the newest build on Discord and says what taking it down would delete. Returns a review id
         * and the sentence that must be typed to confirm. Nothing is changed.
         */
        async prepareUndo({ guild, userId }) {
            if (!home(guild.id)) throw err('Server tidak valid.', 403);
            const builds = await history.read(guild.id);
            const build = builds.at(-1);
            if (!build) throw err('Belum ada bangunan yang tercatat.', 404);
            const { items } = await inspect(guild, build);
            purge();
            for (const [id, ticket] of tickets) if (ticket.userId === userId) tickets.delete(id);
            if (tickets.size >= MAX_PENDING) throw err('Terlalu banyak tinjauan menunggu.', 429);
            const id = crypto.randomBytes(20).toString('hex');
            const count = deletable(items);
            tickets.set(id, { guildId: guild.id, userId, buildId: build.id, count, expires: now() + PLAN_TTL_MS });
            return {
                id,
                build: { id: build.id, at: build.at, actorId: build.actorId, label: build.label, source: build.source, edited: build.edited, partial: build.partial },
                items,
                counts: { delete: count, gone: items.filter((item) => item.state === 'gone').length, blocked: items.filter((item) => item.state === 'blocked').length },
                confirmation: `BONGKAR ${count}`,
                expiresInSeconds: PLAN_TTL_MS / 1000,
                warning: 'PENGHAPUSAN PERMANEN: channel dihapus beserta seluruh pesannya dan role dilepas dari semua anggota. Bot tidak dapat memulihkannya.',
            };
        },

        /** Deletes the objects of the newest build: channels first, then categories, then roles. */
        async undo({ guild, userId, id, confirmation }) {
            purge();
            const ticket = typeof id === 'string' ? tickets.get(id) : null;
            if (!ticket || ticket.userId !== userId || ticket.guildId !== guild.id || !home(guild.id)) throw err('Tinjauan tidak ditemukan atau kedaluwarsa.', 404);
            if (confirmation !== `BONGKAR ${ticket.count}`) throw err('Konfirmasi tidak cocok.');
            if (activeGuilds.has(guild.id)) throw err('Penerapan atau pembongkaran lain masih berjalan.', 409);
            activeGuilds.add(guild.id);
            try {
                const builds = await history.read(guild.id);
                const build = builds.at(-1);
                if (!build || build.id !== ticket.buildId) throw err('Riwayat berubah setelah ditinjau; tinjau lagi.', 409);
                const { items, channels, roles } = await inspect(guild, build);
                if (deletable(items) !== ticket.count) throw err('Keadaan server berubah setelah ditinjau; tinjau lagi.', 409);
                const me = guild.members.me;
                const needsChannels = items.some((item) => item.state === 'delete' && item.type !== 'role');
                const needsRoles = items.some((item) => item.state === 'delete' && item.type === 'role');
                if ((needsChannels && !me?.permissions?.has(PermissionFlagsBits.ManageChannels)) || (needsRoles && !me?.permissions?.has(PermissionFlagsBits.ManageRoles))) {
                    throw err('Bot memerlukan Manage Channels dan Manage Roles untuk membongkar.', 403);
                }
                // One shot, also when a Discord timeout leaves part of it undone: what is left stays recorded.
                tickets.delete(id);

                const reason = `AI builder: owner confirmed removal of build ${build.id}`;
                const removed = [], kept = [], surviving = new Set();
                const plain = ({ type, id: itemId, name }) => ({ type, id: itemId, name });
                async function remove(item, object) {
                    try {
                        await object.delete(reason);
                        removed.push(plain(item));
                    } catch (error) {
                        if (error?.code === UNKNOWN_CHANNEL || error?.code === UNKNOWN_ROLE) { removed.push(plain(item)); return; }
                        surviving.add(item.id);
                        kept.push({ ...plain(item), reason: 'Discord menolak atau tidak menjawab' });
                    }
                }
                const leave = (item) => { surviving.add(item.id); kept.push({ ...plain(item), reason: item.notes.at(-1) }); };

                for (const item of items.filter((entry) => entry.type !== 'category' && entry.type !== 'role')) {
                    if (item.state === 'gone') continue;
                    if (item.state === 'blocked') leave(item);
                    else await remove(item, channels.get(item.id));
                }
                for (const item of items.filter((entry) => entry.type === 'category')) {
                    if (item.state === 'gone') continue;
                    if (item.state === 'blocked') { leave(item); continue; }
                    // Deleting a category does not delete what is in it; Discord would move those channels out.
                    const left = [...channels.values()].filter((channel) => channel && channel.parentId === item.id && surviving.has(channel.id)).length;
                    if (left) { surviving.add(item.id); kept.push({ ...plain(item), reason: `masih berisi ${left} channel yang tidak terhapus` }); continue; }
                    await remove(item, channels.get(item.id));
                }
                for (const item of items.filter((entry) => entry.type === 'role')) {
                    if (item.state === 'gone') continue;
                    if (item.state === 'blocked') leave(item);
                    else await remove(item, roles.get(item.id));
                }

                let recorded = true, remainingBuilds = builds.length;
                try {
                    const current = await history.read(guild.id);
                    const next = kept.length
                        ? current.map((entry) => (entry.id === build.id ? { ...entry, items: kept.map(plain) } : entry))
                        : current.filter((entry) => entry.id !== build.id);
                    await history.save(guild.id, next);
                    remainingBuilds = next.length;
                } catch {
                    recorded = false;
                }
                return { buildId: build.id, removed, kept, counts: itemCounts(removed), done: kept.length === 0, recorded, remainingBuilds };
            } finally {
                activeGuilds.delete(guild.id);
            }
        },

        /**
         * Drops the newest build from the history without deleting anything on Discord: for a build whose
         * leftovers are to stay, so that the build before it can be reached.
         */
        async forget({ guild, userId, buildId, confirmed }) {
            if (!home(guild.id) || typeof userId !== 'string') throw err('Server tidak valid.', 403);
            if (confirmed !== true) throw err('Konfirmasi diperlukan.');
            if (activeGuilds.has(guild.id)) throw err('Penerapan atau pembongkaran lain masih berjalan.', 409);
            activeGuilds.add(guild.id);
            try {
                const builds = await history.read(guild.id);
                const build = builds.at(-1);
                if (!build || build.id !== buildId) throw err('Catatan itu bukan bangunan terakhir; muat ulang riwayat.', 409);
                const next = await history.save(guild.id, builds.slice(0, -1));
                for (const [id, ticket] of tickets) if (ticket.buildId === buildId) tickets.delete(id);
                return { forgotten: true, remainingBuilds: next.length };
            } finally {
                activeGuilds.delete(guild.id);
            }
        },
    };
}
