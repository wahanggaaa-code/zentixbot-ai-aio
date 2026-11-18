// Message Studio — a persisted Components V2 composer for messages sent by ZentixBot.
//
// This deliberately uses containers rather than legacy Discord embeds. A document is strict JSON,
// every Discord write is owner-confirmed by the dashboard API, and no externally supplied webhook
// URL/token is ever accepted. Webhook tokens created by the bot are encrypted at rest.
import crypto from 'node:crypto';
import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    PermissionFlagsBits,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    WebhookClient,
} from 'discord.js';
import { createKV } from './ai/kv.js';
import { createV2Container, v2Message } from '../utils/componentsV2.js';

const err = (message, status = 400, code = 'MESSAGE_STUDIO_INVALID', extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, keys, message = 'Format pesan tidak valid.') => {
    if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key))) throw err(message);
};
const idPattern = /^[A-Za-z0-9_-]{1,48}$/;
const snowflake = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const safeId = (value) => typeof value === 'string' && idPattern.test(value);
const shortId = () => crypto.randomBytes(12).toString('hex');
const date = (now) => new Date(now()).toISOString();
const text = (value, max, label, { required = true } = {}) => {
    if (value === undefined && !required) return null;
    if (typeof value !== 'string' || value.includes('\0') || value.length > max || (required && !value.trim())) throw err(`${label} tidak valid.`);
    return value;
};
const optionalText = (value, max, label) => value === undefined || value === null || value === '' ? null : text(value, max, label);
const unique = (set, value, label) => {
    if (set.has(value)) throw err(`${label} tidak boleh berulang.`);
    set.add(value);
    return value;
};
const mint = (value, used, label, makeId) => {
    if (value !== undefined && !safeId(value)) throw err(`${label} tidak valid.`);
    let next = value || makeId();
    while (!value && used.has(next)) next = makeId();
    return unique(used, next, label);
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const HTTPS = /^https:\/\//i;
const BUTTON_STYLES = Object.freeze({ primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link });
const IMAGE_MIMES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' });

export const MESSAGE_STUDIO_LIMITS = Object.freeze({
    templates: 50,
    messages: 100,
    containers: 4,
    blocksPerContainer: 10,
    mediaItemsPerBlock: 10,
    imageBytes: 5 * 1024 * 1024,
    uploadParts: 8,
});

/** A small useful default, also used by the browser when starting from an empty document. */
export function defaultMessageDocument() {
    return {
        version: 1,
        containers: [{
            id: 'container1',
            accentColor: '#5865F2',
            spoiler: false,
            blocks: [{ id: 'text1', type: 'text', content: '## Judul pesan\nTulis pesanmu di sini.' }],
        }],
    };
}

function normalizeEmoji(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 48 || /\s/.test(value)) throw err('Emoji komponen tidak valid.');
    return value.trim();
}

function normalizeSource(value, allowUploads) {
    own(value, ['kind', 'url', 'assetId', 'uploadId'], 'Sumber gambar tidak valid.');
    if (value.kind === 'url') {
        if (typeof value.url !== 'string' || value.url.length > 2000 || !HTTPS.test(value.url)) throw err('URL gambar harus HTTPS.');
        if (Object.keys(value).some((key) => !['kind', 'url'].includes(key))) throw err('Sumber gambar tidak valid.');
        return { kind: 'url', url: value.url };
    }
    if (value.kind === 'asset') {
        if (!safeId(value.assetId) || Object.keys(value).some((key) => !['kind', 'assetId'].includes(key))) throw err('Gambar unggahan tidak valid.');
        return { kind: 'asset', assetId: value.assetId };
    }
    if (allowUploads && value.kind === 'upload') {
        if (!safeId(value.uploadId) || Object.keys(value).some((key) => !['kind', 'uploadId'].includes(key))) throw err('Gambar unggahan tidak valid.');
        return { kind: 'upload', uploadId: value.uploadId };
    }
    throw err('Sumber gambar tidak valid.');
}

/**
 * Strictly normalize the JSON format exposed in the editor/importer. It makes all component IDs
 * explicit so component custom IDs can never be supplied by a user as arbitrary bot handlers.
 */
export function normalizeMessageDocument(value, { allowUploads = false, makeId = shortId } = {}) {
    own(value, ['version', 'containers']);
    if (value.version !== 1 || !Array.isArray(value.containers) || value.containers.length < 1 || value.containers.length > MESSAGE_STUDIO_LIMITS.containers) throw err('Dokumen harus berisi 1 sampai 4 container.');
    const containerIds = new Set(), blockIds = new Set();
    let mediaItems = 0;
    const containers = value.containers.map((container) => {
        own(container, ['id', 'accentColor', 'spoiler', 'blocks']);
        const id = mint(container.id, containerIds, 'ID container', makeId);
        if (container.accentColor !== null && container.accentColor !== undefined && (typeof container.accentColor !== 'string' || !HEX.test(container.accentColor))) throw err('Warna container harus berupa kode hex seperti #5865F2.');
        if (container.spoiler !== undefined && typeof container.spoiler !== 'boolean') throw err('Status spoiler container tidak valid.');
        if (!Array.isArray(container.blocks) || !container.blocks.length || container.blocks.length > MESSAGE_STUDIO_LIMITS.blocksPerContainer) throw err('Setiap container harus berisi 1 sampai 10 komponen.');
        const blocks = container.blocks.map((block) => {
            own(block, ['id', 'type', 'content', 'divider', 'spacing', 'items', 'buttons', 'placeholder', 'minValues', 'maxValues', 'options']);
            const id = mint(block.id, blockIds, 'ID komponen', makeId);
            if (block.type === 'text') {
                if (Object.keys(block).some((key) => !['id', 'type', 'content'].includes(key))) throw err('Komponen teks tidak valid.');
                return { id, type: 'text', content: text(block.content, 4000, 'Teks') };
            }
            if (block.type === 'separator') {
                if (Object.keys(block).some((key) => !['id', 'type', 'divider', 'spacing'].includes(key))) throw err('Pemisah tidak valid.');
                if (block.divider !== undefined && typeof block.divider !== 'boolean') throw err('Pemisah tidak valid.');
                if (block.spacing !== undefined && block.spacing !== 1 && block.spacing !== 2) throw err('Jarak pemisah tidak valid.');
                return { id, type: 'separator', divider: block.divider !== false, spacing: block.spacing === 2 ? 2 : 1 };
            }
            if (block.type === 'media' || block.type === 'section') {
                if (Object.keys(block).some((key) => !(block.type === 'section' ? ['id', 'type', 'items', 'content'] : ['id', 'type', 'items']).includes(key)) || !Array.isArray(block.items) || !block.items.length || block.items.length > (block.type === 'section' ? 1 : MESSAGE_STUDIO_LIMITS.mediaItemsPerBlock)) throw err('Galeri gambar tidak valid.');
                const itemIds = new Set();
                const items = block.items.map((item) => {
                    own(item, ['id', 'source', 'description', 'spoiler'], 'Item gambar tidak valid.');
                    const itemId = mint(item.id, itemIds, 'ID gambar', makeId);
                    if (item.spoiler !== undefined && typeof item.spoiler !== 'boolean') throw err('Status spoiler gambar tidak valid.');
                    return { id: itemId, source: normalizeSource(item.source, allowUploads), description: optionalText(item.description, 1024, 'Deskripsi gambar'), spoiler: item.spoiler === true };
                });
                mediaItems += items.length;
                if (mediaItems > 10) throw err('Satu pesan dapat memuat paling banyak 10 gambar.');
                return block.type === 'section' ? { id, type: 'section', content: text(block.content, 4000, 'Teks section'), items } : { id, type: 'media', items };
            }
            if (block.type === 'buttons') {
                if (Object.keys(block).some((key) => !['id', 'type', 'buttons'].includes(key)) || !Array.isArray(block.buttons) || !block.buttons.length || block.buttons.length > 5) throw err('Baris tombol tidak valid.');
                const buttonIds = new Set();
                const buttons = block.buttons.map((button) => {
                    own(button, ['id', 'label', 'style', 'url', 'response', 'emoji', 'disabled'], 'Tombol tidak valid.');
                    const buttonId = mint(button.id, buttonIds, 'ID tombol', makeId);
                    if (!Object.hasOwn(BUTTON_STYLES, button.style)) throw err('Gaya tombol tidak valid.');
                    if (button.disabled !== undefined && typeof button.disabled !== 'boolean') throw err('Status tombol tidak valid.');
                    const base = { id: buttonId, label: text(button.label, 80, 'Label tombol'), style: button.style, emoji: normalizeEmoji(button.emoji), disabled: button.disabled === true };
                    if (button.style === 'link') {
                        if (typeof button.url !== 'string' || button.url.length > 2000 || !HTTPS.test(button.url) || button.response !== undefined) throw err('Tombol link memerlukan URL HTTPS.');
                        return { ...base, url: button.url };
                    }
                    if (button.url !== undefined || typeof button.response !== 'string' || button.response.length > 2000 || !button.response.trim()) throw err('Tombol respons memerlukan isi respons singkat.');
                    return { ...base, response: button.response };
                });
                return { id, type: 'buttons', buttons };
            }
            if (block.type === 'select') {
                if (Object.keys(block).some((key) => !['id', 'type', 'placeholder', 'minValues', 'maxValues', 'options'].includes(key)) || !Array.isArray(block.options) || !block.options.length || block.options.length > 25) throw err('Menu pilihan tidak valid.');
                const optionIds = new Set();
                const options = block.options.map((option) => {
                    own(option, ['id', 'label', 'description', 'emoji', 'response'], 'Pilihan menu tidak valid.');
                    const optionId = mint(option.id, optionIds, 'ID pilihan', makeId);
                    return {
                        id: optionId,
                        label: text(option.label, 100, 'Label pilihan'),
                        description: optionalText(option.description, 100, 'Deskripsi pilihan'),
                        emoji: normalizeEmoji(option.emoji),
                        response: text(option.response, 2000, 'Respons pilihan'),
                    };
                });
                const minValues = block.minValues === undefined ? 1 : block.minValues;
                const maxValues = block.maxValues === undefined ? 1 : block.maxValues;
                if (!Number.isInteger(minValues) || !Number.isInteger(maxValues) || minValues < 0 || maxValues < 1 || minValues > maxValues || maxValues > options.length) throw err('Batas pilihan menu tidak valid.');
                return { id, type: 'select', placeholder: optionalText(block.placeholder, 150, 'Placeholder menu'), minValues, maxValues, options };
            }
            throw err('Jenis komponen tidak didukung.');
        });
        return { id, accentColor: container.accentColor || null, spoiler: container.spoiler === true, blocks };
    });
    // Discord limits the entire V2 message to 40 components, including nested children,
    // and 4,000 characters across all text displays.
    let componentCount = containers.length, textLength = 0;
    for (const container of containers) for (const block of container.blocks) {
        componentCount++;
        if (block.type === 'text' || block.type === 'section') textLength += block.content.length;
        if (block.type === 'section') componentCount += 2; // text display and thumbnail
        if (block.type === 'buttons') componentCount += block.buttons.length;
        if (block.type === 'select') componentCount++;
    }
    if (componentCount > 40) throw err('Satu pesan dapat memuat paling banyak 40 komponen Discord.');
    if (textLength > 4000) throw err('Total teks pesan maksimal 4.000 karakter.');
    return { version: 1, containers };
}

function hasInteractive(document) {
    return document.containers.some((container) => container.blocks.some((block) => block.type === 'select' || (block.type === 'buttons' && block.buttons.some((button) => button.style !== 'link'))));
}

function normalizeSender(value) {
    if (value !== 'bot' && value !== 'webhook') throw err('Mode pengirim tidak valid.');
    return value;
}

function normalizeIdentity(value, sender) {
    if (value === undefined || value === null) return null;
    own(value, ['name', 'avatarUrl'], 'Identitas webhook tidak valid.');
    if (sender !== 'webhook') throw err('Nama dan avatar khusus hanya tersedia pada mode webhook.');
    const name = optionalText(value.name, 80, 'Nama webhook');
    const avatarUrl = optionalText(value.avatarUrl, 2000, 'URL avatar');
    if (avatarUrl && !HTTPS.test(avatarUrl)) throw err('URL avatar harus HTTPS.');
    return name || avatarUrl ? { ...(name ? { name } : {}), ...(avatarUrl ? { avatarUrl } : {}) } : null;
}

function normalizeUpload(value) {
    own(value, ['id', 'name', 'mime', 'base64'], 'Gambar unggahan tidak valid.');
    if (!safeId(value.id) || typeof value.mime !== 'string' || !Object.hasOwn(IMAGE_MIMES, value.mime)) throw err('Jenis gambar harus PNG, JPEG, WebP atau GIF.');
    if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 100)) throw err('Nama gambar tidak valid.');
    const source = typeof value.base64 === 'string' ? value.base64.replace(/^data:[^,]*,/i, '') : '';
    if (!source || !/^[A-Za-z0-9+/=\r\n]+$/.test(source)) throw err('Data gambar tidak valid.');
    const buffer = Buffer.from(source, 'base64');
    if (!buffer.length || buffer.length > MESSAGE_STUDIO_LIMITS.imageBytes) throw err('Gambar maksimal berukuran 5 MB.');
    const magic = (() => {
        if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
        if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
        if (buffer.length >= 6 && buffer.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
        if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
        return null;
    })();
    if (magic !== value.mime) throw err('Isi file bukan gambar yang sesuai dengan jenisnya.');
    return { id: value.id, mime: value.mime, buffer };
}

function normalizeUploads(value) {
    if (value === undefined) return new Map();
    if (!Array.isArray(value) || value.length > 10) throw err('Daftar gambar unggahan tidak valid.');
    const uploads = new Map();
    for (const item of value) {
        const upload = normalizeUpload(item);
        if (uploads.has(upload.id)) throw err('ID gambar unggahan tidak boleh berulang.');
        uploads.set(upload.id, upload);
    }
    return uploads;
}

function colorNumber(color) { return color ? Number.parseInt(color.slice(1), 16) : null; }
function assetMetaKey(guildId, assetId) { return `message-studio:v1:asset:${guildId}:${assetId}`; }
function assetPartKey(guildId, assetId, index) { return `${assetMetaKey(guildId, assetId)}:part:${index}`; }
const ASSET_CHUNK_CHARS = 900000;

function validAssetMeta(value) {
    return plain(value) && value.version === 1 && typeof value.filename === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value.filename)
        && Object.hasOwn(IMAGE_MIMES, value.mime) && Number.isInteger(value.parts) && value.parts >= 1 && value.parts <= MESSAGE_STUDIO_LIMITS.uploadParts;
}

function stateKey(guildId) { return `message-studio:v1:state:${guildId}`; }
function webhookKey(guildId, channelId) { return `message-studio:v1:webhook:${guildId}:${channelId}`; }

function cleanDocument(value) {
    try { return normalizeMessageDocument(value); } catch { return null; }
}
function cleanTemplate(value) {
    if (!plain(value) || !safeId(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) return null;
    const document = cleanDocument(value.document);
    if (!document) return null;
    return { id: value.id, name: value.name, document, createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString() };
}
function cleanMessage(value) {
    if (!plain(value) || !safeId(value.id) || !snowflake(value.channelId) || !snowflake(value.messageId) || (value.sender !== 'bot' && value.sender !== 'webhook')) return null;
    const document = cleanDocument(value.document);
    if (!document) return null;
    const identity = (() => { try { return normalizeIdentity(value.identity, value.sender); } catch { return null; } })();
    return {
        id: value.id,
        channelId: value.channelId,
        channelName: typeof value.channelName === 'string' ? value.channelName.slice(0, 100) : null,
        messageId: value.messageId,
        sender: value.sender,
        identity,
        webhookId: value.sender === 'webhook' && snowflake(value.webhookId) ? value.webhookId : null,
        document,
        test: value.test === true,
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
        actorId: snowflake(value.actorId) ? value.actorId : null,
        url: typeof value.url === 'string' && /^https:\/\//.test(value.url) ? value.url : null,
    };
}
function cleanState(value) {
    const templates = [], messages = [], ids = new Set();
    for (const item of Array.isArray(value?.templates) ? value.templates : []) {
        const cleaned = cleanTemplate(item);
        if (cleaned && !ids.has(`t:${cleaned.id}`)) { ids.add(`t:${cleaned.id}`); templates.push(cleaned); }
    }
    for (const item of Array.isArray(value?.messages) ? value.messages : []) {
        const cleaned = cleanMessage(item);
        if (cleaned && !ids.has(`m:${cleaned.id}`)) { ids.add(`m:${cleaned.id}`); messages.push(cleaned); }
    }
    return { version: 1, templates: templates.slice(0, MESSAGE_STUDIO_LIMITS.templates), messages: messages.slice(0, MESSAGE_STUDIO_LIMITS.messages) };
}

function safeSummary(record) {
    return structuredClone(record);
}

function documentAssetIds(document) {
    const ids = new Set();
    for (const container of document.containers) for (const block of container.blocks) if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'asset') ids.add(item.source.assetId);
    return ids;
}

function addTestNotice(document) {
    const copy = structuredClone(document);
    const first = copy.containers[0];
    if (first.blocks.length < MESSAGE_STUDIO_LIMITS.blocksPerContainer) first.blocks.unshift({ id: `test-${shortId()}`, type: 'text', content: '-# PESAN UJI · Message Studio' });
    else copy.containers.unshift({ id: `test-container-${shortId()}`, accentColor: '#FEE75C', spoiler: false, blocks: [{ id: `test-${shortId()}`, type: 'text', content: '-# PESAN UJI · Message Studio' }] });
    return copy;
}

/**
 * Service functions receive a guild object already authorised by the dashboard. Storage deliberately
 * keeps records only for messages sent by this service, never arbitrary messages in a channel.
 */
export function createMessageStudio({
    client,
    kv = createKV(client),
    now = Date.now,
    secret = client?.token || process.env.DISCORD_TOKEN || null,
    makeId = shortId,
    webhookClientFactory = (data) => new WebhookClient(data, client?.rest ? { rest: client.rest } : undefined),
} = {}) {
    if (!client) throw Error('Message Studio membutuhkan client Discord.');
    const changing = new Set();
    const home = (guild) => guild?.id === client.homeGuildId;
    const lock = async (key, task) => {
        if (changing.has(key)) throw err('Pesan ini sedang diubah. Tunggu sebentar lalu muat ulang.', 429, 'MESSAGE_STUDIO_BUSY');
        changing.add(key);
        try { return await task(); } finally { changing.delete(key); }
    };
    const keyForCipher = () => {
        if (typeof secret !== 'string' || secret.length < 16) throw err('Mode webhook belum dapat dipakai karena rahasia bot tidak tersedia.', 503, 'MESSAGE_STUDIO_WEBHOOK_UNAVAILABLE');
        return crypto.createHash('sha256').update(secret).digest();
    };
    const seal = (value) => {
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', keyForCipher(), iv);
        const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    };
    const open = (value) => {
        if (!plain(value) || value.version !== 1 || typeof value.iv !== 'string' || typeof value.tag !== 'string' || typeof value.data !== 'string') throw err('Webhook yang dikelola bot tidak dapat dipakai lagi. Kirim pesan baru untuk membuat webhook baru.', 409, 'MESSAGE_STUDIO_WEBHOOK_STALE');
        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', keyForCipher(), Buffer.from(value.iv, 'base64'));
            decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
            return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
        } catch { throw err('Webhook yang dikelola bot tidak dapat dipakai lagi. Kirim pesan baru untuk membuat webhook baru.', 409, 'MESSAGE_STUDIO_WEBHOOK_STALE'); }
    };
    const readState = async (guildId) => cleanState(await kv.get(stateKey(guildId)));
    const changeState = async (guildId, change) => kv.update(stateKey(guildId), (raw) => change(cleanState(raw)));

    async function saveAsset(guildId, assetId, upload) {
        const encoded = upload.buffer.toString('base64');
        const parts = encoded.match(new RegExp(`.{1,${ASSET_CHUNK_CHARS}}`, 'g')) || [];
        if (!parts.length || parts.length > MESSAGE_STUDIO_LIMITS.uploadParts) throw err('Gambar terlalu besar untuk disimpan.', 400, 'MESSAGE_STUDIO_IMAGE');
        try {
            for (let index = 0; index < parts.length; index++) await kv.set(assetPartKey(guildId, assetId, index), parts[index]);
            const filename = `studio-${assetId}.${IMAGE_MIMES[upload.mime]}`;
            await kv.set(assetMetaKey(guildId, assetId), { version: 1, filename, mime: upload.mime, parts: parts.length });
            return { id: assetId, filename, mime: upload.mime, buffer: upload.buffer };
        } catch { throw err('Gambar tidak dapat disimpan. Tidak ada pesan Discord yang dikirim.', 503, 'MESSAGE_STUDIO_STORAGE'); }
    }
    async function readAsset(guildId, assetId) {
        if (!safeId(assetId)) return null;
        let meta;
        try { meta = await kv.get(assetMetaKey(guildId, assetId)); } catch { throw err('Gambar tidak dapat dibaca dari database.', 503, 'MESSAGE_STUDIO_STORAGE'); }
        if (!validAssetMeta(meta)) return null;
        const chunks = [];
        try {
            for (let index = 0; index < meta.parts; index++) {
                const value = await kv.get(assetPartKey(guildId, assetId, index));
                if (typeof value !== 'string') return null;
                chunks.push(value);
            }
        } catch { throw err('Gambar tidak dapat dibaca dari database.', 503, 'MESSAGE_STUDIO_STORAGE'); }
        const buffer = Buffer.from(chunks.join(''), 'base64');
        if (!buffer.length || buffer.length > MESSAGE_STUDIO_LIMITS.imageBytes) return null;
        return { id: assetId, filename: meta.filename, mime: meta.mime, buffer };
    }
    async function materializeUploads(guildId, document, uploadsValue) {
        const uploads = normalizeUploads(uploadsValue);
        const doc = structuredClone(document), map = new Map();
        const wanted = new Set();
        for (const container of doc.containers) for (const block of container.blocks) if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'upload') wanted.add(item.source.uploadId);
        for (const uploadId of wanted) {
            const upload = uploads.get(uploadId);
            if (!upload) throw err('Satu gambar unggahan tidak ditemukan dalam permintaan.');
            const assetId = makeId();
            map.set(uploadId, await saveAsset(guildId, assetId, upload));
        }
        for (const container of doc.containers) for (const block of container.blocks) if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'upload') item.source = { kind: 'asset', assetId: map.get(item.source.uploadId).id };
        return normalizeMessageDocument(doc);
    }
    async function assetsFor(guildId, document) {
        const assets = new Map();
        for (const assetId of documentAssetIds(document)) {
            const asset = await readAsset(guildId, assetId);
            if (!asset) throw err('Satu gambar unggahan tidak lagi tersedia. Ganti atau unggah ulang gambar sebelum mengirim.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
            assets.set(assetId, asset);
        }
        return assets;
    }
    function ensureGuild(guild) {
        if (!home(guild)) throw err('Message Studio hanya tersedia pada server yang dikonfigurasi.', 403, 'MESSAGE_STUDIO_GUILD');
        return guild;
    }
    function resolveChannel(guild, channelId, sender, document) {
        if (!snowflake(channelId)) throw err('Pilih channel teks tujuan.');
        const channel = guild.channels?.cache?.get(channelId);
        if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || typeof channel.send !== 'function') throw err('Channel tujuan tidak ditemukan atau bukan channel teks yang didukung.', 404, 'MESSAGE_STUDIO_CHANNEL');
        const permissions = channel.permissionsFor?.(guild.members?.me);
        const needs = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
        if (documentAssetIds(document).size) needs.push(PermissionFlagsBits.AttachFiles);
        if (sender === 'webhook') needs.push(PermissionFlagsBits.ManageWebhooks);
        if (!permissions?.has?.(needs)) throw err(sender === 'webhook' ? 'Bot membutuhkan izin Lihat Channel, Kirim Pesan, Kelola Webhook dan bila ada unggahan Lampirkan File.' : 'Bot membutuhkan izin Lihat Channel, Kirim Pesan, dan bila ada unggahan Lampirkan File.', 403, 'MESSAGE_STUDIO_PERMISSION');
        return channel;
    }
    function assertSenderDocument(sender, document) {
        if (sender === 'webhook' && hasInteractive(document)) throw err('Pada mode webhook, hanya tombol link yang didukung. Tombol respons dan menu pilihan memakai handler bot; kirim sebagai akun bot untuk memakainya.');
    }
    async function buildPayload(guildId, document, { recordId, test = false } = {}) {
        const shown = test ? normalizeMessageDocument(addTestNotice(document)) : document;
        const assets = await assetsFor(guildId, shown);
        const attached = new Map();
        const components = shown.containers.map((source) => {
            const container = new ContainerBuilder();
            if (source.accentColor) container.setAccentColor(colorNumber(source.accentColor));
            if (source.spoiler) container.setSpoiler(true);
            for (const block of source.blocks) {
                if (block.type === 'text') container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content));
                else if (block.type === 'separator') container.addSeparatorComponents(new SeparatorBuilder().setDivider(block.divider).setSpacing(block.spacing));
                else if (block.type === 'section') {
                    const item = block.items[0], thumbnail = new ThumbnailBuilder();
                    if (item.source.kind === 'url') thumbnail.setURL(item.source.url);
                    else {
                        const asset = assets.get(item.source.assetId);
                        if (!asset) throw err('Gambar unggahan tidak tersedia.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
                        thumbnail.setURL(`attachment://${asset.filename}`); attached.set(asset.id, asset);
                    }
                    if (item.description) thumbnail.setDescription(item.description);
                    if (item.spoiler) thumbnail.setSpoiler(true);
                    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content)).setThumbnailAccessory(thumbnail));
                }
                else if (block.type === 'media') {
                    const gallery = new MediaGalleryBuilder();
                    for (const item of block.items) {
                        const media = new MediaGalleryItemBuilder();
                        if (item.source.kind === 'url') media.setURL(item.source.url);
                        else {
                            const asset = assets.get(item.source.assetId);
                            if (!asset) throw err('Gambar unggahan tidak tersedia.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
                            media.setURL(`attachment://${asset.filename}`);
                            attached.set(asset.id, asset);
                        }
                        if (item.description) media.setDescription(item.description);
                        if (item.spoiler) media.setSpoiler(true);
                        gallery.addItems(media);
                    }
                    container.addMediaGalleryComponents(gallery);
                } else if (block.type === 'buttons') {
                    const row = new ActionRowBuilder();
                    for (const button of block.buttons) {
                        const built = new ButtonBuilder().setLabel(button.label).setStyle(BUTTON_STYLES[button.style]).setDisabled(button.disabled);
                        if (button.style === 'link') built.setURL(button.url);
                        else built.setCustomId(`ms_btn:${recordId}:${block.id}:${button.id}`);
                        if (button.emoji) built.setEmoji(button.emoji);
                        row.addComponents(built);
                    }
                    container.addActionRowComponents(row);
                } else if (block.type === 'select') {
                    const menu = new StringSelectMenuBuilder().setCustomId(`ms_sel:${recordId}:${block.id}`).setMinValues(block.minValues).setMaxValues(block.maxValues);
                    if (block.placeholder) menu.setPlaceholder(block.placeholder);
                    menu.addOptions(block.options.map((option) => ({ label: option.label, value: option.id, ...(option.description ? { description: option.description } : {}), ...(option.emoji ? { emoji: option.emoji } : {}) })));
                    container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
                }
            }
            return container;
        });
        const payload = v2Message(components);
        payload.allowedMentions = { parse: [], repliedUser: false };
        if (attached.size) payload.files = [...attached.values()].map((asset) => new AttachmentBuilder(asset.buffer, { name: asset.filename }));
        return payload;
    }
    async function webhookFor(guildId, channel, { create = false } = {}) {
        const key = webhookKey(guildId, channel.id);
        const stored = await kv.get(key).catch(() => { throw err('Webhook tidak dapat dibaca dari database.', 503, 'MESSAGE_STUDIO_STORAGE'); });
        if (plain(stored) && snowflake(stored.id) && stored.token) {
            const token = open(stored.token);
            return { id: stored.id, client: webhookClientFactory({ id: stored.id, token }) };
        }
        if (!create) throw err('Webhook pengirim tidak lagi tersedia. Kirim pesan baru melalui mode webhook.', 409, 'MESSAGE_STUDIO_WEBHOOK_STALE');
        let created;
        try { created = await channel.createWebhook({ name: 'Zentix Message Studio', reason: 'Managed by Zentix Message Studio' }); }
        catch { throw err('Discord menolak pembuatan webhook. Periksa izin Kelola Webhook.', 502, 'MESSAGE_STUDIO_WEBHOOK_CREATE'); }
        if (!snowflake(created?.id) || typeof created?.token !== 'string' || !created.token) throw err('Discord tidak memberikan token webhook yang diperlukan. Tidak ada pesan dikirim.', 502, 'MESSAGE_STUDIO_WEBHOOK_CREATE');
        try { await kv.set(key, { version: 1, id: created.id, token: seal(created.token) }); }
        catch { throw err('Webhook dibuat tetapi tidak dapat disimpan. Tidak ada pesan dikirim; hapus webhook Zentix Message Studio yang tidak dipakai bila perlu.', 503, 'MESSAGE_STUDIO_WEBHOOK_RECORD'); }
        return { id: created.id, client: webhookClientFactory({ id: created.id, token: created.token }) };
    }
    function messageUrl(guild, channelId, message) {
        if (typeof message?.url === 'string' && /^https:\/\//.test(message.url)) return message.url;
        return `https://discord.com/channels/${guild.id}/${channelId}/${message.id}`;
    }
    async function appendMessage(guildId, record) {
        let output;
        await changeState(guildId, (state) => {
            if (state.messages.length >= MESSAGE_STUDIO_LIMITS.messages) state.messages = state.messages.slice(0, MESSAGE_STUDIO_LIMITS.messages - 1);
            state.messages.unshift(record); output = record; return state;
        });
        return output;
    }
    async function findMessage(guildId, id) {
        if (!safeId(id)) throw err('Pesan Message Studio tidak valid.');
        const record = (await readState(guildId)).messages.find((item) => item.id === id);
        if (!record) throw err('Pesan tidak ditemukan di riwayat Message Studio.', 404, 'MESSAGE_STUDIO_MESSAGE_MISSING');
        return record;
    }
    async function replaceMessage(guildId, id, change) {
        let next = null;
        await changeState(guildId, (state) => {
            const index = state.messages.findIndex((item) => item.id === id);
            if (index < 0) throw err('Pesan tidak ditemukan di riwayat Message Studio.', 404, 'MESSAGE_STUDIO_MESSAGE_MISSING');
            next = change(state.messages[index]); state.messages[index] = next; return state;
        });
        return next;
    }
    async function send({ guild, actorId, channelId, sender, identity, document, uploads, test = false }) {
        ensureGuild(guild);
        const cleanSender = normalizeSender(sender), cleanIdentity = normalizeIdentity(identity, cleanSender);
        if (typeof test !== 'boolean') throw err('Mode pesan uji tidak valid.');
        const parsed = normalizeMessageDocument(document, { allowUploads: true, makeId });
        const materialized = await materializeUploads(guild.id, parsed, uploads);
        assertSenderDocument(cleanSender, materialized);
        const channel = resolveChannel(guild, channelId, cleanSender, materialized);
        const id = makeId();
        const payload = await buildPayload(guild.id, materialized, { recordId: id, test });
        let sent, webhookId = null;
        try {
            if (cleanSender === 'bot') sent = await channel.send(payload);
            else {
                const webhook = await webhookFor(guild.id, channel, { create: true }); webhookId = webhook.id;
                sent = await webhook.client.send({ ...payload, withComponents: true, ...(cleanIdentity?.name ? { username: cleanIdentity.name } : {}), ...(cleanIdentity?.avatarUrl ? { avatarURL: cleanIdentity.avatarUrl } : {}) });
            }
        } catch (error) {
            if (error?.status) throw error;
            throw err('Hasil pengiriman tidak pasti. Periksa channel sebelum mencoba lagi agar tidak mengirim pesan ganda.', 502, 'MESSAGE_STUDIO_UNCERTAIN', { uncertain: true });
        }
        if (!snowflake(sent?.id)) throw err('Discord mungkin menerima pesan tetapi ID pesan tidak dapat dibaca. Periksa channel sebelum mencoba lagi.', 502, 'MESSAGE_STUDIO_UNCERTAIN', { uncertain: true });
        const at = date(now);
        const record = { id, channelId: channel.id, channelName: String(channel.name || '').slice(0, 100) || null, messageId: sent.id, sender: cleanSender, identity: cleanIdentity, webhookId, document: materialized, test, createdAt: at, updatedAt: at, actorId: snowflake(actorId) ? actorId : null, url: messageUrl(guild, channel.id, sent) };
        try { return safeSummary(await appendMessage(guild.id, record)); }
        catch { throw err('Pesan mungkin sudah terkirim, tetapi riwayatnya tidak dapat disimpan. Periksa channel; jangan mengirim ulang secara buta.', 502, 'MESSAGE_STUDIO_RECORD_LEFT', { uncertain: true }); }
    }
    async function editBotMessage(guild, record, payload) {
        const channel = resolveChannel(guild, record.channelId, 'bot', record.document);
        if (!channel.messages?.fetch) throw err('Pesan bot tidak dapat diambil dari Discord saat ini.', 502, 'MESSAGE_STUDIO_DISCORD');
        const message = await channel.messages.fetch(record.messageId).catch(() => null);
        if (!message || message.author?.id !== client.user?.id || typeof message.edit !== 'function') throw err('Pesan bot tidak ditemukan atau bukan milik bot. Tidak ada perubahan yang diterapkan.', 404, 'MESSAGE_STUDIO_MESSAGE_GONE');
        return message.edit(payload);
    }
    async function editWebhookMessage(guild, record, payload) {
        const channel = resolveChannel(guild, record.channelId, 'webhook', record.document);
        const webhook = await webhookFor(guild.id, channel, { create: false });
        if (record.webhookId && webhook.id !== record.webhookId) throw err('Webhook asal pesan tidak lagi tersedia. Pesan lama tidak dapat diubah lewat dashboard.', 409, 'MESSAGE_STUDIO_WEBHOOK_STALE');
        return webhook.client.editMessage(record.messageId, { ...payload, withComponents: true });
    }
    async function edit({ guild, actorId, id, document, uploads }) {
        ensureGuild(guild);
        return lock(`edit:${guild.id}:${id}`, async () => {
            const record = await findMessage(guild.id, id);
            const parsed = normalizeMessageDocument(document, { allowUploads: true, makeId });
            const materialized = await materializeUploads(guild.id, parsed, uploads);
            assertSenderDocument(record.sender, materialized);
            const payload = await buildPayload(guild.id, materialized, { recordId: record.id, test: record.test });
            try {
                if (record.sender === 'bot') await editBotMessage(guild, { ...record, document: materialized }, payload);
                else await editWebhookMessage(guild, { ...record, document: materialized }, payload);
            } catch (error) {
                if (error?.status && error.code === 'MESSAGE_STUDIO_MESSAGE_GONE') throw error;
                if (error?.status && error.code === 'MESSAGE_STUDIO_WEBHOOK_STALE') throw error;
                throw err('Hasil pengubahan pesan tidak pasti. Muat ulang riwayat dan periksa channel sebelum mencoba lagi.', 502, 'MESSAGE_STUDIO_UNCERTAIN', { uncertain: true });
            }
            const at = date(now);
            try { return safeSummary(await replaceMessage(guild.id, record.id, (old) => ({ ...old, document: materialized, updatedAt: at, actorId: snowflake(actorId) ? actorId : old.actorId }))); }
            catch { throw err('Pesan mungkin sudah berubah di Discord, tetapi riwayat tidak dapat diperbarui. Periksa channel sebelum mencoba lagi.', 502, 'MESSAGE_STUDIO_RECORD_LEFT', { uncertain: true }); }
        });
    }
    async function removeDiscordMessage(guild, record) {
        if (record.sender === 'bot') {
            const channel = resolveChannel(guild, record.channelId, 'bot', record.document);
            const message = await channel.messages?.fetch?.(record.messageId).catch(() => null);
            if (!message || message.author?.id !== client.user?.id || typeof message.delete !== 'function') throw err('Pesan bot tidak ditemukan atau bukan milik bot.', 404, 'MESSAGE_STUDIO_MESSAGE_GONE');
            return message.delete();
        }
        const channel = resolveChannel(guild, record.channelId, 'webhook', record.document);
        const webhook = await webhookFor(guild.id, channel, { create: false });
        if (record.webhookId && webhook.id !== record.webhookId) throw err('Webhook asal pesan tidak lagi tersedia. Pesan lama tidak dapat dihapus lewat dashboard.', 409, 'MESSAGE_STUDIO_WEBHOOK_STALE');
        return webhook.client.deleteMessage(record.messageId);
    }
    async function remove({ guild, id }) {
        ensureGuild(guild);
        return lock(`edit:${guild.id}:${id}`, async () => {
            const record = await findMessage(guild.id, id);
            try { await removeDiscordMessage(guild, record); }
            catch (error) {
                if (error?.status && ['MESSAGE_STUDIO_MESSAGE_GONE', 'MESSAGE_STUDIO_WEBHOOK_STALE'].includes(error.code)) throw error;
                throw err('Hasil penghapusan pesan tidak pasti. Muat ulang riwayat dan periksa channel sebelum mencoba lagi.', 502, 'MESSAGE_STUDIO_UNCERTAIN', { uncertain: true });
            }
            try {
                await changeState(guild.id, (state) => { state.messages = state.messages.filter((item) => item.id !== record.id); return state; });
                return { id: record.id, deleted: true };
            } catch { throw err('Pesan mungkin sudah dihapus dari Discord, tetapi riwayatnya tidak dapat diperbarui. Periksa channel sebelum mencoba lagi.', 502, 'MESSAGE_STUDIO_RECORD_LEFT', { uncertain: true }); }
        });
    }
    async function forget({ guild, id }) {
        ensureGuild(guild);
        if (!safeId(id)) throw err('Pesan tidak valid.');
        return lock(`edit:${guild.id}:${id}`, async () => {
            let found = false;
            await changeState(guild.id, (state) => {
                const before = state.messages.length;
                state.messages = state.messages.filter((item) => item.id !== id);
                found = state.messages.length !== before;
                return state;
            });
            if (!found) throw err('Pesan tidak ditemukan di riwayat Message Studio.', 404, 'MESSAGE_STUDIO_MESSAGE_MISSING');
            return { id, forgotten: true };
        });
    }
    async function saveTemplate({ guild, name, document, uploads, id = null }) {
        ensureGuild(guild);
        if (typeof name !== 'string' || !name.trim() || name.length > 80) throw err('Nama template harus berisi maksimal 80 karakter.');
        if (id !== null && !safeId(id)) throw err('ID template tidak valid.');
        const parsed = normalizeMessageDocument(document, { allowUploads: true, makeId });
        const materialized = await materializeUploads(guild.id, parsed, uploads);
        const at = date(now), templateId = id || makeId();
        let saved;
        await changeState(guild.id, (state) => {
            const index = state.templates.findIndex((item) => item.id === templateId);
            if (index < 0) {
                if (state.templates.length >= MESSAGE_STUDIO_LIMITS.templates) throw err('Batas 50 template sudah tercapai. Hapus template lama terlebih dahulu.', 409, 'MESSAGE_STUDIO_TEMPLATE_LIMIT');
                saved = { id: templateId, name: name.trim(), document: materialized, createdAt: at, updatedAt: at };
                state.templates.unshift(saved);
            } else {
                saved = { ...state.templates[index], name: name.trim(), document: materialized, updatedAt: at };
                state.templates[index] = saved;
            }
            return state;
        });
        return safeSummary(saved);
    }
    async function deleteTemplate({ guild, id }) {
        ensureGuild(guild);
        if (!safeId(id)) throw err('ID template tidak valid.');
        let found = false;
        await changeState(guild.id, (state) => { const before = state.templates.length; state.templates = state.templates.filter((item) => item.id !== id); found = state.templates.length !== before; return state; });
        if (!found) throw err('Template tidak ditemukan.', 404, 'MESSAGE_STUDIO_TEMPLATE_MISSING');
        return { id, deleted: true };
    }
    function channels(guild) {
        const me = guild.members?.me;
        return [...(guild.channels?.cache?.values?.() ?? [])]
            .filter((channel) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
            .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || String(a.id).localeCompare(String(b.id)))
            .slice(0, 250)
            .map((channel) => {
                const permissions = channel.permissionsFor?.(me);
                return { id: channel.id, name: String(channel.name || '').slice(0, 100), botUsable: Boolean(permissions?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])), webhookUsable: Boolean(permissions?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageWebhooks])) };
            });
    }
    async function overview(guild) {
        ensureGuild(guild);
        const state = await readState(guild.id);
        return { limits: MESSAGE_STUDIO_LIMITS, channels: channels(guild), templates: state.templates.map(safeSummary), messages: state.messages.map(safeSummary) };
    }
    async function asset(guild, id) { ensureGuild(guild); return readAsset(guild.id, id); }
    async function reply(interaction, content) {
        const payload = { ...v2Message([createV2Container({ description: content, color: 'info', raw: true })], { ephemeral: true }), allowedMentions: { parse: [] } };
        if (interaction.deferred && typeof interaction.editReply === 'function') return interaction.editReply(payload);
        if (typeof interaction.reply === 'function') return interaction.reply(payload);
        return null;
    }
    async function interactionRecord(interaction, recordId) {
        if (!interaction?.guildId || !safeId(recordId) || interaction.guildId !== client.homeGuildId) return null;
        const record = (await readState(interaction.guildId)).messages.find((item) => item.id === recordId);
        if (!record || record.sender !== 'bot' || record.messageId !== interaction.message?.id) return null;
        return record;
    }
    async function handleButton(interaction, args = []) {
        const [recordId, blockId, buttonId] = args;
        const record = await interactionRecord(interaction, recordId);
        const block = record?.document.containers.flatMap((container) => container.blocks).find((item) => item.id === blockId && item.type === 'buttons');
        const button = block?.buttons.find((item) => item.id === buttonId && item.style !== 'link');
        if (!button) return reply(interaction, 'Tombol ini tidak lagi aktif atau pesan sudah diubah.');
        return reply(interaction, button.response);
    }
    async function handleSelect(interaction, args = []) {
        const [recordId, blockId] = args;
        const record = await interactionRecord(interaction, recordId);
        const block = record?.document.containers.flatMap((container) => container.blocks).find((item) => item.id === blockId && item.type === 'select');
        const picked = (Array.isArray(interaction.values) ? interaction.values : []).map((id) => block?.options.find((item) => item.id === id)).filter(Boolean);
        if (!block || !picked.length) return reply(interaction, 'Pilihan ini tidak lagi aktif atau pesan sudah diubah.');
        return reply(interaction, picked.map((option) => `**${option.label}**\n${option.response}`).join('\n\n'));
    }
    return { overview, asset, send, edit, remove, forget, saveTemplate, deleteTemplate, handleButton, handleSelect, normalizeDocument: normalizeMessageDocument };
}
