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
    FileBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    PermissionFlagsBits,
    MessageFlags,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
    RoleSelectMenuBuilder,
    MentionableSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    TextDisplayBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    WebhookClient,
} from 'discord.js';
import { createKV } from './ai/kv.js';
import { createV2Container, v2Message } from '../utils/componentsV2.js';
import { normalizeStudioFlow, runStudioFlow, supportsDurableStudioFlow } from './messageStudioFlow.js';
import { createStudioDurableQueue } from './messageStudioDurableQueue.js';
import { createStudioDurableWorker } from './messageStudioDurableWorker.js';
import { createStudioRecurring, createStudioRecurringWorker } from './messageStudioRecurring.js';
import { checkPanelRole, resolveRole, roleReason } from './selfRoles/manage.js';
import { logger } from '../utils/logger.js';

const err = (message, status = 400, code = 'MESSAGE_STUDIO_INVALID', extra = {}) => Object.assign(new Error(message), { status, code, ...extra });
// Only explicitly tagged errors are shown to users; never expose Discord errors or tokens.
const flowError = (reason) => Object.assign(new Error('Message Studio flow failed'), { studioFlowReason: reason });
const flowFailureMessage = (error) => {
    let reason;
    if (error?.studioFlowReason === 'role') reason = 'Role tidak tersedia atau tidak aman dikelola bot. Periksa izin dan posisi role bot.';
    else if (error?.studioFlowReason === 'channel') reason = 'Channel tujuan tidak tersedia atau izin bot tidak mencukupi.';
    else if (error?.studioFlowReason === 'template') reason = 'Template tujuan tidak ditemukan atau respons interaktif mencapai batas.';
    else if ([50001, 50013].includes(error?.code)) reason = 'Discord menolak akses atau izin bot. Periksa izin dan hierarki role.';
    else reason = 'Izin, konfigurasi, atau Discord bermasalah.';
    return `Flow berhenti. ${reason} Sebagian action sebelumnya mungkin sudah berjalan, atau action yang gagal mungkin sudah membuat sebagian perubahan; periksa server sebelum mencoba ulang.`;
};
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
const FILE_MIMES = Object.freeze({ 'application/pdf': 'pdf', 'text/plain': 'txt' });
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
    own(value, ['version', 'containers', 'before', 'after', 'order']);
    if (value.version !== 1 || !Array.isArray(value.containers) || value.containers.length > MESSAGE_STUDIO_LIMITS.containers) throw err('Dokumen boleh berisi paling banyak 4 container.');
    const containerIds = new Set(), blockIds = new Set();
    let mediaItems = 0;
    const normalizeBlock = (block) => {
        own(block, ['id', 'type', 'content', 'divider', 'spacing', 'items', 'buttons', 'placeholder', 'minValues', 'maxValues', 'options', 'kind', 'response', 'source', 'spoiler', 'roleSync', 'flow']);
        const id = mint(block.id, blockIds, 'ID komponen', makeId);
        if (block.type === 'text') {
            if (Object.keys(block).some((key) => !['id', 'type', 'content'].includes(key))) throw err('Komponen teks tidak valid.');
            return { id, type: 'text', content: text(block.content, 4000, 'Teks') };
        }
        if (block.type === 'file') {
            if (Object.keys(block).some((key) => !['id', 'type', 'source', 'spoiler'].includes(key))) throw err('File tidak valid.');
            if (block.spoiler !== undefined && typeof block.spoiler !== 'boolean') throw err('Status spoiler file tidak valid.');
            const source = normalizeSource(block.source, allowUploads);
            if (source.kind === 'url') throw err('File harus diunggah, bukan URL.');
            return { id, type: 'file', source, spoiler: block.spoiler === true };
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
                own(button, ['id', 'label', 'style', 'url', 'response', 'emoji', 'disabled', 'flow'], 'Tombol tidak valid.');
                const buttonId = mint(button.id, buttonIds, 'ID tombol', makeId);
                if (!Object.hasOwn(BUTTON_STYLES, button.style)) throw err('Gaya tombol tidak valid.');
                if (button.disabled !== undefined && typeof button.disabled !== 'boolean') throw err('Status tombol tidak valid.');
                const base = { id: buttonId, label: text(button.label, 80, 'Label tombol'), style: button.style, emoji: normalizeEmoji(button.emoji), disabled: button.disabled === true };
                if (button.style === 'link') {
                    if (typeof button.url !== 'string' || button.url.length > 2000 || !HTTPS.test(button.url) || (button.response !== undefined || button.flow !== undefined)) throw err('Tombol link memerlukan URL HTTPS.');
                    return { ...base, url: button.url };
                }
                if (button.url !== undefined) throw err('Tombol respons tidak boleh memiliki URL.');
                if (button.flow !== undefined) {
                    if (button.response !== undefined) throw err('Gunakan flow atau respons, bukan keduanya.');
                    return { ...base, flow: normalizeStudioFlow(button.flow) };
                }
                if (typeof button.response !== 'string' || button.response.length > 2000 || !button.response.trim()) throw err('Tombol respons memerlukan isi respons singkat.');
                return { ...base, response: button.response };
            });
            return { id, type: 'buttons', buttons };
        }
        if (block.type === 'entity-select') {
            if (Object.keys(block).some((key) => !['id', 'type', 'kind', 'placeholder', 'minValues', 'maxValues', 'response', 'flow'].includes(key))) throw err('Menu pilihan tidak valid.');
            if (!['user', 'role', 'mentionable', 'channel'].includes(block.kind)) throw err('Jenis menu pilihan tidak valid.');
            const minValues = block.minValues === undefined ? 1 : block.minValues;
            const maxValues = block.maxValues === undefined ? 1 : block.maxValues;
            if (!Number.isInteger(minValues) || !Number.isInteger(maxValues) || minValues < 0 || maxValues < 1 || minValues > maxValues || maxValues > 25) throw err('Batas pilihan menu tidak valid.');
            if (block.flow !== undefined && block.response !== undefined) throw err('Gunakan flow atau respons, bukan keduanya.');
            if (block.flow?.some?.(action => action?.type === 'open_modal')) throw err('Open Modal hanya tersedia pada tombol.');
            return { id, type: 'entity-select', kind: block.kind, placeholder: optionalText(block.placeholder, 150, 'Placeholder menu'), minValues, maxValues, ...(block.flow !== undefined ? { flow: normalizeStudioFlow(block.flow) } : { response: text(block.response, 2000, 'Respons pilihan') }) };
        }
        if (block.type === 'select') {
            if (Object.keys(block).some((key) => !['id', 'type', 'placeholder', 'minValues', 'maxValues', 'options', 'roleSync'].includes(key)) || !Array.isArray(block.options) || !block.options.length || block.options.length > 25 || (block.roleSync !== undefined && block.roleSync !== true)) throw err('Menu pilihan tidak valid.');
            const optionIds = new Set(), roleIds = new Set();
            const options = block.options.map((option) => {
                own(option, block.roleSync ? ['id', 'label', 'description', 'emoji', 'roleId'] : ['id', 'label', 'description', 'emoji', 'response', 'flow'], 'Pilihan menu tidak valid.');
                if (block.roleSync && (!snowflake(option.roleId) || roleIds.has(option.roleId))) throw err('Setiap pilihan sinkronisasi memerlukan ID role yang valid dan berbeda.');
                if (block.roleSync) roleIds.add(option.roleId);
                if (option.flow !== undefined && option.response !== undefined) throw err('Gunakan flow atau respons, bukan keduanya.');
                if (option.flow?.some?.((action) => action?.type === 'open_modal')) throw err('Open Modal hanya tersedia pada tombol.');
                const optionId = mint(option.id, optionIds, 'ID pilihan', makeId);
                return {
                    id: optionId,
                    label: text(option.label, 100, 'Label pilihan'),
                    description: optionalText(option.description, 100, 'Deskripsi pilihan'),
                    emoji: normalizeEmoji(option.emoji),
                    ...(block.roleSync ? { roleId: option.roleId } : option.flow !== undefined ? { flow: normalizeStudioFlow(option.flow) } : { response: text(option.response, 2000, 'Respons pilihan') }),
                };
            });
            const minValues = block.minValues === undefined ? 1 : block.minValues;
            const maxValues = block.maxValues === undefined ? 1 : block.maxValues;
            if (!Number.isInteger(minValues) || !Number.isInteger(maxValues) || minValues < 0 || maxValues < 1 || minValues > maxValues || maxValues > options.length) throw err('Batas pilihan menu tidak valid.');
            if (options.some((option) => option.flow) && maxValues > 5) throw err('Menu dengan flow maksimal 5 pilihan sekaligus.');
            return { id, type: 'select', placeholder: optionalText(block.placeholder, 150, 'Placeholder menu'), minValues, maxValues, options, ...(block.roleSync ? { roleSync: true } : {}) };
        }
        throw err('Jenis komponen tidak didukung.');
    };
    const containers = value.containers.map((container) => {
        own(container, ['id', 'accentColor', 'spoiler', 'blocks']);
        const id = mint(container.id, containerIds, 'ID container', makeId);
        if (container.accentColor !== null && container.accentColor !== undefined && (typeof container.accentColor !== 'string' || !HEX.test(container.accentColor))) throw err('Warna container harus berupa kode hex seperti #5865F2.');
        if (container.spoiler !== undefined && typeof container.spoiler !== 'boolean') throw err('Status spoiler container tidak valid.');
        if (!Array.isArray(container.blocks) || !container.blocks.length || container.blocks.length > MESSAGE_STUDIO_LIMITS.blocksPerContainer) throw err('Setiap container harus berisi 1 sampai 10 komponen.');
        const blocks = container.blocks.map(normalizeBlock);
        return { id, accentColor: container.accentColor || null, spoiler: container.spoiler === true, blocks };
    });
    const normalizeOutside = (items) => {
        if (items === undefined) return [];
        if (!Array.isArray(items) || items.length > 10) throw err('Bagian luar container maksimal 10 komponen.');
        return items.map((block) => {
            if (!plain(block) || !['text', 'buttons', 'select', 'entity-select', 'media', 'separator', 'file'].includes(block.type)) throw err('Jenis komponen di luar container tidak didukung.');
            return normalizeBlock(block);
        });
    };
    const before = normalizeOutside(value.before), after = normalizeOutside(value.after);
    if (!containers.length && !before.length && !after.length) throw err('Pesan harus memiliki setidaknya satu komponen.');
    // Discord limits the entire V2 message to 40 components, including nested children,
    // and 4,000 characters across all text displays.
    let componentCount = containers.length, textLength = 0;
    for (const block of [...before, ...containers.flatMap((container) => container.blocks), ...after]) {
        componentCount++;
        if (block.type === 'text' || block.type === 'section') textLength += block.content.length;
        if (block.type === 'section') componentCount += 2; // text display and thumbnail
        if (block.type === 'buttons') componentCount += block.buttons.length;
        if (block.type === 'select' || block.type === 'entity-select') componentCount++;
    }
    const attachments = new Set();
    for (const block of [...before, ...containers.flatMap((container) => container.blocks), ...after]) {
        const sources = block.type === 'file' ? [block.source] : (block.type === 'media' || block.type === 'section') ? block.items.map((item) => item.source) : [];
        for (const source of sources) if (source.kind === 'asset' || source.kind === 'upload') attachments.add(`${source.kind}:${source.assetId || source.uploadId}`);
    }
    if (attachments.size > 10) throw err('Satu pesan dapat memuat paling banyak 10 file terlampir.');
    if (componentCount > 40) throw err('Satu pesan dapat memuat paling banyak 40 komponen Discord.');
    if (textLength > 4000) throw err('Total teks pesan maksimal 4.000 karakter.');
    let order;
    if (value.order !== undefined) {
        const available = new Set([...containers.map((item) => `container:${item.id}`), ...[...before, ...after].map((item) => `block:${item.id}`)]);
        if (!Array.isArray(value.order) || value.order.length !== available.size) throw err('Urutan komponen tidak lengkap.');
        order = value.order.map((entry) => {
            own(entry, ['kind', 'id'], 'Urutan komponen tidak valid.');
            const key = `${entry.kind}:${entry.id}`;
            if (!available.delete(key)) throw err('Urutan komponen tidak valid atau berulang.');
            return { kind: entry.kind, id: entry.id };
        });
    }
    return { version: 1, containers, ...(value.before !== undefined ? { before } : {}), ...(value.after !== undefined ? { after } : {}), ...(order ? { order } : {}) };
}

function allBlocks(document) {
    return [...(document.before || []), ...document.containers.flatMap((container) => container.blocks), ...(document.after || [])];
}

function hasInteractive(document) {
    return allBlocks(document).some((block) => (block.type === 'select' || block.type === 'entity-select') || (block.type === 'buttons' && block.buttons.some((button) => button.style !== 'link')));
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
    if (!safeId(value.id) || typeof value.mime !== 'string' || !(Object.hasOwn(IMAGE_MIMES, value.mime) || Object.hasOwn(FILE_MIMES, value.mime))) throw err('Jenis file tidak didukung.');
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
    if (Object.hasOwn(IMAGE_MIMES, value.mime) && magic !== value.mime) throw err('Isi file bukan gambar yang sesuai dengan jenisnya.');
    if (value.mime === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw err('Isi file bukan PDF yang valid.');
    if (value.mime === 'text/plain' && (buffer.includes(0) || !Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer))) throw err('File teks harus berupa UTF-8.');
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
        && (Object.hasOwn(IMAGE_MIMES, value.mime) || Object.hasOwn(FILE_MIMES, value.mime)) && Number.isInteger(value.parts) && value.parts >= 1 && value.parts <= MESSAGE_STUDIO_LIMITS.uploadParts;
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
    for (const block of allBlocks(document)) {
        if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'asset') ids.add(item.source.assetId);
        if (block.type === 'file' && block.source.kind === 'asset') ids.add(block.source.assetId);
    }
    return ids;
}

function addTestNotice(document) {
    const copy = structuredClone(document);
    const notice = { id: `test-${shortId()}`, type: 'text', content: '-# PESAN UJI · Message Studio' };
    copy.before = [notice, ...(copy.before || [])];
    if (copy.order) copy.order.unshift({ kind: 'block', id: notice.id });
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
    let durableQueue, durableWorker, recurringQueue, recurringWorker;
    const recurring = () => recurringQueue ||= createStudioRecurring({ kv, guildId: client.homeGuildId, now });
    const queue = () => durableQueue ||= createStudioDurableQueue({ kv, guildId: client.homeGuildId, now });
    let lastWorkerWarning = 0;
    const workerWarning = () => { if (Date.now() - lastWorkerWarning >= 60000) { lastWorkerWarning = Date.now(); logger.warn('Message Studio: antrean terjadwal tidak dapat diproses; akan diperiksa lagi.'); } };
    const startDurableWorker = () => { if (!durableWorker) durableWorker = createStudioDurableWorker({ client, queue: queue(), resumeFlow: resumeDurableFlow, onError: workerWarning }); if (!recurringWorker) recurringWorker = createStudioRecurringWorker({ client, queue: recurring(), send, onError: workerWarning }); durableWorker.start(); recurringWorker.start(); };
    const stopDurableWorker = async () => { if (durableWorker) await durableWorker.stop(); if (recurringWorker) await recurringWorker.stop(); };
    const changing = new Set();
    const flowCooldowns = new Map();
    let activeFlows = 0;
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
            const filename = `studio-${assetId}.${IMAGE_MIMES[upload.mime] || FILE_MIMES[upload.mime]}`;
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
        for (const block of allBlocks(doc)) {
            if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'upload') wanted.add(item.source.uploadId);
            if (block.type === 'file' && block.source.kind === 'upload') wanted.add(block.source.uploadId);
        }
        for (const uploadId of wanted) {
            const upload = uploads.get(uploadId);
            if (!upload) throw err('Satu gambar unggahan tidak ditemukan dalam permintaan.');
            const assetId = makeId();
            map.set(uploadId, await saveAsset(guildId, assetId, upload));
        }
        for (const block of allBlocks(doc)) if (block.type === 'media' || block.type === 'section') for (const item of block.items) if (item.source.kind === 'upload') item.source = { kind: 'asset', assetId: map.get(item.source.uploadId).id };
        for (const block of allBlocks(doc)) if (block.type === 'file' && block.source.kind === 'upload') block.source = { kind: 'asset', assetId: map.get(block.source.uploadId).id };
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
        function buttonRow(block) {
            const row = new ActionRowBuilder();
            for (const button of block.buttons) {
                const built = new ButtonBuilder().setLabel(button.label).setStyle(BUTTON_STYLES[button.style]).setDisabled(button.disabled);
                if (button.style === 'link') built.setURL(button.url);
                else built.setCustomId(`ms_btn:${recordId}:${block.id}:${button.id}`);
                if (button.emoji) built.setEmoji(button.emoji);
                row.addComponents(built);
            }
            return row;
        }
        function selectRow(block) {
            const Builder = block.type === 'select' ? StringSelectMenuBuilder : ({ user: UserSelectMenuBuilder, role: RoleSelectMenuBuilder, mentionable: MentionableSelectMenuBuilder, channel: ChannelSelectMenuBuilder })[block.kind];
            const menu = new Builder().setCustomId(`ms_sel:${recordId}:${block.id}`).setMinValues(block.minValues).setMaxValues(block.maxValues);
            if (block.placeholder) menu.setPlaceholder(block.placeholder);
            if (block.type === 'select') menu.addOptions(block.options.map((option) => ({ label: option.label, value: option.id, ...(option.description ? { description: option.description } : {}), ...(option.emoji ? { emoji: option.emoji } : {}) })));
            return new ActionRowBuilder().addComponents(menu);
        }
        function mediaGallery(block) {
        const gallery = new MediaGalleryBuilder();
        for (const item of block.items) {
            const media = new MediaGalleryItemBuilder();
            if (item.source.kind === 'url') media.setURL(item.source.url);
            else {
                const asset = assets.get(item.source.assetId);
                if (!asset || !Object.hasOwn(IMAGE_MIMES, asset.mime)) throw err('Gambar unggahan tidak tersedia.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
                media.setURL(`attachment://${asset.filename}`);
                attached.set(asset.id, asset);
            }
            if (item.description) media.setDescription(item.description);
            if (item.spoiler) media.setSpoiler(true);
            gallery.addItems(media);
        }
        return gallery;
        }
        function fileComponent(block) {
            const asset = assets.get(block.source.assetId);
            if (!asset || !Object.hasOwn(FILE_MIMES, asset.mime)) throw err('File unggahan tidak tersedia.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
            attached.set(asset.id, asset);
            return new FileBuilder().setURL(`attachment://${asset.filename}`).setSpoiler(block.spoiler);
        }
        const outside = (block) => {
            if (block.type === 'text') return new TextDisplayBuilder().setContent(block.content);
            if (block.type === 'separator') return new SeparatorBuilder().setDivider(block.divider).setSpacing(block.spacing);
            if (block.type === 'media') return mediaGallery(block);
            if (block.type === 'file') return fileComponent(block);
            return block.type === 'buttons' ? buttonRow(block) : selectRow(block);
        };
        const containers = shown.containers.map((source) => {
            const container = new ContainerBuilder();
            if (source.accentColor) container.setAccentColor(colorNumber(source.accentColor));
            if (source.spoiler) container.setSpoiler(true);
            for (const block of source.blocks) {
                if (block.type === 'text') container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content));
                else if (block.type === 'file') container.addFileComponents(fileComponent(block));
                else if (block.type === 'separator') container.addSeparatorComponents(new SeparatorBuilder().setDivider(block.divider).setSpacing(block.spacing));
                else if (block.type === 'section') {
                    const item = block.items[0], thumbnail = new ThumbnailBuilder();
                    if (item.source.kind === 'url') thumbnail.setURL(item.source.url);
                    else {
                        const asset = assets.get(item.source.assetId);
                        if (!asset || !Object.hasOwn(IMAGE_MIMES, asset.mime)) throw err('Gambar unggahan tidak tersedia.', 409, 'MESSAGE_STUDIO_ASSET_MISSING');
                        thumbnail.setURL(`attachment://${asset.filename}`); attached.set(asset.id, asset);
                    }
                    if (item.description) thumbnail.setDescription(item.description);
                    if (item.spoiler) thumbnail.setSpoiler(true);
                    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(block.content)).setThumbnailAccessory(thumbnail));
                }
                else if (block.type === 'media') {
                    container.addMediaGalleryComponents(mediaGallery(block));
                } else if (block.type === 'buttons') {
                    container.addActionRowComponents(buttonRow(block));
                } else if (block.type === 'select' || block.type === 'entity-select') {
                    container.addActionRowComponents(selectRow(block));
                }
            }
            return container;
        });
        const components = shown.order
            ? shown.order.map((entry) => entry.kind === 'container' ? containers[shown.containers.findIndex((item) => item.id === entry.id)] : outside([...(shown.before || []), ...(shown.after || [])].find((item) => item.id === entry.id)))
            : [...(shown.before || []).map(outside), ...containers, ...(shown.after || []).map(outside)];
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
    // Preview names are separate from delivery targets: forum, voice, stage and
    // cached public threads can be mentioned even though Studio cannot send to them.
    // Private-thread membership cannot be inferred from ViewChannel alone.
    function mentionChannels(guild) {
        const me = guild.members?.me;
        if (!me) return [];
        const types = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia, ChannelType.PublicThread, ChannelType.AnnouncementThread].filter(type => typeof type === 'number'));
        return [...(guild.channels?.cache?.values?.() ?? [])]
            .filter(channel => types.has(channel.type) && snowflake(channel.id) && typeof channel.name === 'string' && channel.name && channel.permissionsFor?.(me)?.has?.(PermissionFlagsBits.ViewChannel))
            .map(channel => ({ id: channel.id, name: channel.name.slice(0, 100) }));
    }
    function roles(guild) {
        const available = [...(guild.roles?.cache?.values?.() ?? [])]
            .filter(role => snowflake(role.id))
            .sort((a, b) => (b.position ?? 0) - (a.position ?? 0) || String(a.id).localeCompare(String(b.id)));
        return { roles: available.slice(0, 250).map(role => {
            const check = checkPanelRole(guild, role);
            return { id: role.id, name: String(role.name || '').slice(0, 100), usable: check.ok, reason: check.ok ? null : roleReason(check.code, 'id') };
        }), rolesTruncated: available.length > 250 };
    }
    async function overview(guild) {
        ensureGuild(guild);
        const state = await readState(guild.id);
        return { limits: MESSAGE_STUDIO_LIMITS, channels: channels(guild), mentionChannels: mentionChannels(guild), ...roles(guild), templates: state.templates.map(safeSummary), messages: state.messages.map(safeSummary) };
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
        const state = await readState(interaction.guildId);
        const record = state.messages.find((item) => item.id === recordId);
        if (record) return record.sender === 'bot' && record.messageId === interaction.message?.id ? record : null;
        if (!recordId.startsWith('flow-')) return null;
        const session = await kv.get(`message-studio:v1:reply:${interaction.guildId}:${recordId}`);
        if (!plain(session) || session.version !== 1 || session.id !== recordId || session.messageId !== interaction.message?.id || !snowflake(session.messageId) || !Number.isFinite(session.expiresAt) || session.expiresAt <= now() || (session.userId !== null && session.userId !== interaction.user?.id) || !Number.isInteger(session.depth) || session.depth < 1 || session.depth > 3 || !state.messages.some((item) => item.id === session.rootId && item.sender === 'bot')) return null;
        const document = cleanDocument(session.document);
        return document ? { id: session.id, rootId: session.rootId, depth: session.depth, document } : null;
    }
    async function handleButton(interaction, args = []) {
        const [recordId, blockId, buttonId] = args;
        const record = await interactionRecord(interaction, recordId);
        const block = (record ? allBlocks(record.document) : []).find((item) => item.id === blockId && item.type === 'buttons');
        const button = block?.buttons.find((item) => item.id === buttonId && item.style !== 'link' && !item.disabled);
        if (!button) return reply(interaction, 'Tombol ini tidak lagi aktif atau pesan sudah diubah.');
        if (!button.flow) return reply(interaction, button.response);
        if (button.flow[0]?.type === 'open_modal') return openStudioModal(interaction, record, button.flow[0]);
        return executeInteractionFlows(interaction, record, [button.flow]);
    }
    // Resume only the supported, token-free subset after fetching the current
    // member and rechecking roles and channel permissions. Errors after a claim
    // are uncertain because Discord writes may already have happened.
    async function resumeDurableFlow(guild, job) {
        const { userId, rootId, snapshot } = job.payload;
        let followingFlows = job.payload.followingFlows ?? [];
        const depth = job.payload.depth ?? 0;
        return lock(`flow:${guild.id}:${userId}`, async () => {
            const state = await readState(guild.id);
            if (!state.messages.some(item => item.id === rootId && item.sender === 'bot')) throw Error('Pesan asal tidak aktif.');
            const member = await guild.members.fetch({ user: userId, force: true });
            if (!member || member.id !== userId) throw Error('Anggota tidak tersedia.');
            const roleFor = async id => { const { role } = await resolveRole(guild, id); if (!checkPanelRole(guild, role).ok) throw flowError('role'); return role; };
            const destination = (id, extra = []) => {
                const channel = guild.channels?.cache?.get(id);
                if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || !channel.permissionsFor?.(guild.members.me)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, ...extra])) throw flowError('channel');
                return channel;
            };
            const context = {
                get checkpointOnFinalWait() { return followingFlows.length > 0; },
                wait: seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000)),
                checkpoint: async (seconds, next) => {
                    if (!seconds) return false;
                    if (!await queue().suspend(job.id, job.token, now() + seconds * 1000, { userId, rootId, depth, snapshot: next, followingFlows })) throw Error('Checkpoint tidak tersimpan.');
                    return true;
                },
                scheduleMessage: async (seconds, id, message) => { destination(id); await queue().schedule({ id: shortId(), runAt: now() + seconds * 1000, payload: { channelId: id, message } }); },
                hasRole: async id => { const role = await roleFor(id); return member.roles.cache.has(role.id); },
                changeRole: async (action, id) => { const role = await roleFor(id), has = member.roles.cache.has(role.id); if (action === 'add_role' && !has || action === 'toggle_role' && !has) await member.roles.add(role); else if (action === 'remove_role' && has || action === 'toggle_role' && has) await member.roles.remove(role); },
                selectUniqueRole: async (selectedId, ids) => { const roles = []; for (const id of ids) roles.push(await roleFor(id)); for (const role of roles) if (role.id !== selectedId && member.roles.cache.has(role.id)) await member.roles.remove(role); if (!member.roles.cache.has(selectedId)) await member.roles.add(roles.find(role => role.id === selectedId)); },
                send: async (type, id, message) => {
                    if (!message.trim() || message.length > 4000) throw Error('Teks flow tidak valid.');
                    const channel = destination(id, type === 'send_webhook_message' ? [PermissionFlagsBits.ManageWebhooks] : []);
                    const payload = { ...v2Message([new TextDisplayBuilder().setContent(message)]), allowedMentions: { parse: [], repliedUser: false } };
                    if (type === 'send_message') {
                        const sent = await channel.send(payload);
                        if (!snowflake(sent?.id)) throw Error('Pesan mungkin terkirim tetapi ID tidak tersedia.');
                        return { checkpointRef: { kind:'bot', channelId:id, messageId:sent.id } };
                    }
                    const webhook = await webhookFor(guild.id, channel, { create: true });
                    const sent = await webhook.client.send({ ...payload, withComponents: true });
                    if (!snowflake(sent?.id)) throw Error('Pesan webhook mungkin terkirim tetapi ID tidak tersedia.');
                    return { checkpointRef: { kind:'webhook', channelId:id, messageId:sent.id, webhookId:webhook.id } };
                },
                // Templates sent to a channel don't need an interaction token. Use the
                // latest template, just like a normal flow, and bind interactive sessions.
                sendTemplate: async (templateId, _isPrivate, channelId) => {
                    if (!channelId) throw flowError('template');
                    const template = (await readState(guild.id)).templates.find(item => item.id === templateId);
                    if (!template) throw flowError('template');
                    const interactive = hasInteractive(template.document), nextDepth = depth + 1;
                    if (interactive && nextDepth > 3) throw flowError('template');
                    const id = interactive ? `flow-${shortId()}` : null;
                    const key = interactive ? `message-studio:v1:reply:${guild.id}:${id}` : null;
                    const session = interactive ? { version: 1, id, rootId, messageId: null, userId: null, depth: nextDepth, expiresAt: now() + 15 * 60 * 1000, document: template.document } : null;
                    const payload = await buildPayload(guild.id, template.document, { recordId: id });
                    const channel = destination(channelId);
                    if (interactive) await kv.set(key, session, 15 * 60);
                    const sent = await channel.send(payload);
                    if (!sent?.delete || (interactive && !snowflake(sent.id))) throw Error('Respons terkirim tetapi identitasnya tidak tersedia.');
                    if (interactive) {
                        try { await kv.set(key, { ...session, messageId: sent.id }, 15 * 60); }
                        catch (error) { await sent.delete().catch(() => {}); throw error; }
                    }
                    return { checkpointRef: { kind:'bot', channelId, messageId:sent.id, ...(id ? {sessionId:id} : {}) } };
                },
                deleteMessage: async message => {
                    const ref = message?.checkpointRef || message;
                    const channel = destination(ref.channelId, ref.kind === 'webhook' ? [PermissionFlagsBits.ManageWebhooks] : []);
                    if (!channel.messages?.fetch) throw Error('Pesan flow tidak dapat diperiksa.');
                    const target = await channel.messages.fetch(ref.messageId);
                    if (ref.kind === 'bot') {
                        if (target?.author?.id !== client.user?.id || !target.delete) throw Error('Pesan bukan milik bot.');
                        await target.delete();
                        if (ref.sessionId) await kv.set(`message-studio:v1:reply:${guild.id}:${ref.sessionId}`, null, 1);
                    } else {
                        const webhook = await webhookFor(guild.id, channel, { create:false });
                        if (webhook.id !== ref.webhookId || (target?.webhookId || target?.author?.id) !== webhook.id) throw Error('Pesan bukan milik webhook flow.');
                        await webhook.client.deleteMessage(ref.messageId);
                    }
                },
                createThread: async (id, name) => { if (!name.trim() || name.length > 100) throw Error('Nama thread tidak valid.'); const channel = destination(id, [PermissionFlagsBits.CreatePublicThreads]); if (!channel.threads?.create) throw Error('Channel tidak mendukung thread.'); await channel.threads.create({ name, type: ChannelType.PublicThread }); },
            };
            let result = await runStudioFlow(null, context, snapshot);
            if (result?.paused) return 'paused';
            while (followingFlows.length) {
                const [flow, ...rest] = followingFlows; followingFlows = rest;
                result = await runStudioFlow(flow, context);
                if (result?.paused) return 'paused';
            }
            return 'done';
        });
    }
    async function executeInteractionFlows(interaction, record, flows, successContent = 'Flow selesai.', initialVariables = undefined, alreadyDeferred = false, preface = '') {
        if (!interaction.guild || interaction.guild.id !== client.homeGuildId || !snowflake(interaction.user?.id) || typeof interaction.deferReply !== 'function') return reply(interaction, 'Flow tidak dapat dijalankan tanpa konteks server yang valid.');
        // Bound combined work across all selected options before acknowledging or side effects.
        try { normalizeStudioFlow(flows.flat()); } catch { return reply(interaction, preface + 'Gabungan flow melebihi batas atau tidak valid.'); }
        // Acknowledge before doing any side effects. Never execute if acknowledgement failed.
        if (!alreadyDeferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const key = `${record.id}:${interaction.user.id}`, timestamp = now();
            for (const [id, until] of flowCooldowns) if (until <= timestamp) flowCooldowns.delete(id);
            const expiresAt = flowCooldowns.get(key);
            if (expiresAt) return reply(interaction, preface + `Flow sedang cooldown. Tunggu ${Math.ceil((expiresAt - timestamp) / 1000)} detik sebelum mencoba lagi. Tidak ada action yang dijalankan pada percobaan ini.`);
            if (activeFlows >= 10 || flowCooldowns.size >= 1000) return reply(interaction, preface + 'Flow sedang sibuk. Coba lagi sebentar lagi. Tidak ada action yang dijalankan pada percobaan ini.');
            flowCooldowns.set(key, timestamp + 5000);
            activeFlows++;
            let scheduled = false, paused = false, initialResponseCompleted = false;
            const durable = flows.every(supportsDurableStudioFlow);
            try { await lock(`flow:${interaction.guildId}:${interaction.user.id}`, async () => {
                const guild = interaction.guild;
                const member = await guild.members?.fetch?.(interaction.user.id);
                if (!member || member.id !== interaction.user.id) throw Error('Anggota tidak dapat diperiksa.');
                const roleFor = async (id) => {
                    const { role } = await resolveRole(guild, id);
                    if (!checkPanelRole(guild, role).ok) throw flowError('role');
                    return role;
                };
                const destination = (id, extra = []) => {
                    const channel = guild.channels?.cache?.get(id);
                    if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw flowError('channel');
                    if (!channel.permissionsFor?.(guild.members.me)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, ...extra])) throw flowError('channel');
                    return channel;
                };
                for (const [index, flow] of flows.entries()) {
                  const result = await runStudioFlow(flow, {
                    ...(index === 0 && initialVariables !== undefined ? { initialVariables } : {}),
                    ...(durable ? { checkpointOnFinalWait: index < flows.length - 1, checkpoint: async (seconds, snapshot) => {
                        if (!seconds) return false;
                        await queue().schedule({ id: shortId(), runAt: now() + seconds * 1000, kind: 'flow', payload: { userId: interaction.user.id, rootId: record.rootId || record.id, depth: record.depth || 0, snapshot, followingFlows: flows.slice(index + 1) } });
                        paused = true; return true;
                    }} : {}),
                    wait: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
                    scheduleMessage: async (seconds, id, message) => {
                        destination(id); // Validate permissions now; the worker checks them again before delivery.
                        await queue().schedule({ id: shortId(), runAt: now() + seconds * 1000, payload: { channelId: id, message } });
                        scheduled = true;
                    },
                    hasRole: async (id) => { const role = await roleFor(id); return member.roles.cache.has(role.id); },
                    changeRole: async (action, id) => { const role = await roleFor(id); const has = member.roles.cache.has(role.id); if (action === 'add_role' && !has || action === 'toggle_role' && !has) await member.roles.add(role); else if (action === 'remove_role' && has || action === 'toggle_role' && has) await member.roles.remove(role); },
                    selectUniqueRole: async (selectedId, ids) => {
                        // Validate the entire group before any write. Discord role changes are not atomic.
                        const roles = [];
                        for (const id of ids) roles.push(await roleFor(id));
                        for (const role of roles) if (role.id !== selectedId && member.roles.cache.has(role.id)) await member.roles.remove(role);
                        if (!member.roles.cache.has(selectedId)) await member.roles.add(roles.find((role) => role.id === selectedId));
                    },
                    sendTemplate: async (templateId, isPrivate, channelId) => {
                        const template = (await readState(guild.id)).templates.find((item) => item.id === templateId);
                        if (!template) throw flowError('template');
                        if (!channelId && typeof interaction.followUp !== 'function') throw Error('Respons interaksi tidak tersedia.');
                        const interactive = hasInteractive(template.document), depth = (record.depth || 0) + 1;
                        if (interactive && depth > 3) throw flowError('template');
                        // Follow-up interactions need their own snapshot and message binding. Sessions expire
                        // after 15 minutes and never store the interaction token. Private sessions bind the user.
                        const id = interactive ? `flow-${shortId()}` : null;
                        const key = interactive ? `message-studio:v1:reply:${guild.id}:${id}` : null;
                        const snapshot = interactive ? { version: 1, id, rootId: record.rootId || record.id, messageId: null, userId: !channelId && isPrivate ? interaction.user.id : null, depth, expiresAt: now() + 15 * 60 * 1000, document: template.document } : null;
                        const payload = await buildPayload(guild.id, template.document, { recordId: id });
                        if (!channelId && isPrivate) payload.flags |= MessageFlags.Ephemeral;
                        if (!channelId && !initialResponseCompleted) {
                            // Discord may treat the first follow-up after a defer as an edit of the
                            // original response, ignoring its visibility flag. Finish that response
                            // first so the template is a separate message and cannot be overwritten.
                            if (typeof interaction.editReply !== 'function') throw Error('Respons interaksi tidak tersedia.');
                            await reply(interaction, 'Flow sedang berjalan.');
                            initialResponseCompleted = true;
                        }
                        if (interactive) await kv.set(key, snapshot, 15 * 60);
                        const sent = channelId ? await destination(channelId).send(payload) : await interaction.followUp(payload);
                        if (!sent?.delete || (interactive && !snowflake(sent.id))) throw Error('Respons terkirim tetapi identitasnya tidak tersedia.');
                        if (interactive) {
                            try { await kv.set(key, { ...snapshot, messageId: sent.id }, 15 * 60); }
                            catch (error) { await sent.delete().catch(() => {}); throw error; }
                        }
                        return { delete: async () => { await sent.delete(); if (key) await kv.set(key, null, 1); }, ...(channelId && snowflake(sent.id) ? { checkpointRef: { kind:'bot', channelId, messageId:sent.id, ...(id ? {sessionId:id} : {}) } } : {}) };
                    },
                    send: async (action, id, message) => {
                        if (!message.trim() || message.length > 4000) throw Error('Teks hasil flow tidak valid.');
                        const channel = destination(id, action === 'send_webhook_message' ? [PermissionFlagsBits.ManageWebhooks] : []);
                        const payload = { ...v2Message([new TextDisplayBuilder().setContent(message)]), allowedMentions: { parse: [], repliedUser: false } };
                        if (action === 'send_message') { const sent = await channel.send(payload); return { delete: () => sent.delete(), ...(snowflake(sent?.id) ? {checkpointRef:{kind:'bot',channelId:id,messageId:sent.id}} : {}) }; }
                        const webhook = await webhookFor(guild.id, channel, { create: true }); const sent = await webhook.client.send({ ...payload, withComponents: true });
                        if (!snowflake(sent?.id)) throw Error('Pesan webhook mungkin terkirim tetapi ID tidak tersedia.');
                        return { delete: () => webhook.client.deleteMessage(sent.id), checkpointRef:{kind:'webhook',channelId:id,messageId:sent.id,webhookId:webhook.id} };
                    },
                    createThread: async (id, name) => { if (!name.trim() || name.length > 100) throw Error('Nama thread tidak valid.'); const channel = destination(id, [PermissionFlagsBits.CreatePublicThreads]); if (!channel.threads?.create) throw Error('Channel tidak mendukung thread.'); await channel.threads.create({ name, type: ChannelType.PublicThread }); },
                    deleteMessage: async (message) => message.delete(),
                  });
                  if (result?.paused) break;
                }
            }); } finally { activeFlows--; }
            if (paused) {
                const notice = preface + 'Flow dijeda dan disimpan; akan dilanjutkan setelah waktunya, termasuk setelah restart.';
                const responses = successContent.startsWith('Flow selesai.\n\n') ? successContent.slice('Flow selesai.'.length) : '';
                return reply(interaction, notice.length + responses.length <= 4000 ? notice + responses : notice + '\nSebagian respons pilihan tidak ditampilkan karena terlalu panjang.');
            }
            const scheduledNote = '\nPesan terjadwal disimpan; pengiriman belum terjadi.';
            return reply(interaction, scheduled ? (successContent.length + scheduledNote.length <= 4000 ? successContent : 'Flow selesai.') + scheduledNote : successContent);
        } catch (error) {
            return reply(interaction, preface + flowFailureMessage(error));
        }
    }
    async function openStudioModal(interaction, record, action) {
        if (!interaction.guild || interaction.guild.id !== client.homeGuildId || !snowflake(interaction.user?.id) || typeof interaction.showModal !== 'function') return reply(interaction, 'Formulir tidak dapat dibuka.');
        const timestamp = now(), cooldownKey = `modal:${record.id}:${interaction.user.id}`;
        for (const [id, until] of flowCooldowns) if (until <= timestamp) flowCooldowns.delete(id);
        if (flowCooldowns.has(cooldownKey) || flowCooldowns.size >= 1000) return reply(interaction, 'Tunggu sebentar sebelum membuka formulir lagi.');
        flowCooldowns.set(cooldownKey, timestamp + 5000);
        const modalId = shortId(), key = `message-studio:v1:modal:${interaction.guildId}:${modalId}`;
        const session = { version: 1, userId: interaction.user.id, rootId: record.rootId || record.id, depth: record.depth || 0, expiresAt: timestamp + 600000, action };
        const modal = new ModalBuilder().setCustomId(`ms_form:${modalId}`).setTitle(action.title);
        for (const field of action.fields) {
            const input = new TextInputBuilder().setCustomId(field.id).setLabel(field.label).setStyle(field.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(field.required).setMaxLength(500);
            modal.addComponents(new ActionRowBuilder().addComponents(input));
        }
        await kv.set(key, session, 600);
        await interaction.showModal(modal);
    }
    async function handleModal(interaction, args = []) {
        const [id] = args;
        if (!interaction?.guild || interaction.guild.id !== client.homeGuildId || interaction.guildId !== client.homeGuildId || !snowflake(interaction.user?.id) || !safeId(id)) return reply(interaction, 'Formulir tidak valid.');
        const key = `message-studio:v1:modal:${interaction.guildId}:${id}`;
        const session = await kv.get(key);
        if (!plain(session) || session.version !== 1 || session.userId !== interaction.user.id || !Number.isFinite(session.expiresAt) || session.expiresAt <= now() || (session.depth !== undefined && (!Number.isInteger(session.depth) || session.depth < 0 || session.depth > 3)) || !(await readState(interaction.guildId)).messages.some((item) => item.id === session.rootId && item.sender === 'bot')) return reply(interaction, 'Formulir ini tidak aktif atau sudah kedaluwarsa.');
        let action;
        try { [action] = normalizeStudioFlow([session.action]); if (action.type !== 'open_modal') throw Error(); } catch { return reply(interaction, 'Formulir tidak valid.'); }
        const values = [];
        try {
            for (const field of action.fields) {
                const value = interaction.fields.getTextInputValue(field.id);
                if (typeof value !== 'string' || value.length > 500 || value.includes('\0') || (field.required && !value.trim())) throw Error();
                values.push(value);
            }
        } catch { return reply(interaction, 'Isi formulir tidak valid.'); }
        const escape = (value) => value.replace(/[\\*_~`|>#]/g, '\\$&');
        const content = [`## ${escape(action.title)}`, `Dari: <@${interaction.user.id}>`, ...action.fields.map((field, i) => `**${escape(field.label)}**\n${escape(values[i] || '—')}`)].join('\n\n');
        if (content.length > 4000) return reply(interaction, 'Isi formulir terlalu panjang untuk dikirim.');
        if (typeof interaction.deferReply !== 'function') return reply(interaction, 'Formulir tidak dapat dikirim.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        // Atomically consume only this user's unexpired session before sending, so replays cannot duplicate reports.
        const taken = await kv.update(key, (current) => {
            if (!current || current.userId !== interaction.user.id || current.expiresAt <= now()) return undefined;
            return null;
        }, 1);
        if (taken === undefined) return reply(interaction, 'Formulir ini sudah dikirim atau kedaluwarsa.');
        try {
            const channel = interaction.guild.channels?.cache?.get(action.channelId);
            if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || !channel.permissionsFor?.(interaction.guild.members.me)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw Error('Channel atau izin tidak tersedia.');
            await channel.send({ ...v2Message([new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))]), allowedMentions: { parse: [], repliedUser: false } });
        } catch {
            return reply(interaction, 'Formulir gagal atau hasil pengiriman tidak pasti. Periksa channel tujuan sebelum mencoba lagi.');
        }
        if (action.onSubmit) {
            const variables = Object.fromEntries(action.fields.map((field, index) => [field.id, values[index]]));
            const record = { id: session.rootId, rootId: session.rootId, depth: session.depth || 0 };
            return executeInteractionFlows(interaction, record, [action.onSubmit], 'Formulir berhasil dikirim. Flow selesai.', variables, true, 'Formulir berhasil dikirim. ');
        }
        return reply(interaction, 'Formulir berhasil dikirim.');
    }
    async function syncSelectedRoles(interaction, record, block, picked) {
        if (!interaction.guild || interaction.guild.id !== client.homeGuildId || !snowflake(interaction.user?.id) || typeof interaction.deferReply !== 'function') return reply(interaction, 'Sinkronisasi role memerlukan konteks server yang valid.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const key = `${record.id}:${interaction.user.id}`, timestamp = now();
        for (const [id, until] of flowCooldowns) if (until <= timestamp) flowCooldowns.delete(id);
        const until = flowCooldowns.get(key);
        if (until) return reply(interaction, `Flow sedang cooldown. Tunggu ${Math.ceil((until - timestamp) / 1000)} detik sebelum mencoba lagi. Tidak ada action yang dijalankan pada percobaan ini.`);
        if (activeFlows >= 10 || flowCooldowns.size >= 1000) return reply(interaction, 'Flow sedang sibuk. Coba lagi sebentar lagi. Tidak ada action yang dijalankan pada percobaan ini.');
        flowCooldowns.set(key, timestamp + 5000); activeFlows++;
        try {
            await lock(`flow:${interaction.guildId}:${interaction.user.id}`, async () => {
                const guild = interaction.guild;
                const member = await guild.members.fetch({ user: interaction.user.id, force: true });
                if (!member || member.id !== interaction.user.id) throw Error('Anggota tidak dapat diperiksa.');
                const roles = [];
                for (const option of block.options) {
                    const { role } = await resolveRole(guild, option.roleId);
                    if (!checkPanelRole(guild, role).ok) throw flowError('role');
                    roles.push(role);
                }
                const selected = new Set(picked.map(option => option.roleId));
                // All roles are validated first; Discord writes are separate and may partially fail.
                for (const role of roles) if (!selected.has(role.id) && member.roles.cache.has(role.id)) await member.roles.remove(role);
                for (const role of roles) if (selected.has(role.id) && !member.roles.cache.has(role.id)) await member.roles.add(role);
            });
            return reply(interaction, 'Pilihan role berhasil disinkronkan.');
        } catch (error) { return reply(interaction, flowFailureMessage(error)); }
        finally { activeFlows--; }
    }
    async function handleSelect(interaction, args = []) {
        const [recordId, blockId] = args;
        const record = await interactionRecord(interaction, recordId);
        const block = (record ? allBlocks(record.document) : []).find((item) => item.id === blockId && (item.type === 'select' || item.type === 'entity-select'));
        if (block?.type === 'entity-select') {
            const expected = { user: 5, role: 6, mentionable: 7, channel: 8 }[block.kind];
            const values = Array.isArray(interaction.values) ? interaction.values : [];
            if (interaction.componentType !== expected || values.length < block.minValues || values.length > block.maxValues || new Set(values).size !== values.length || values.some((value) => !snowflake(value))) return reply(interaction, 'Pilihan ini tidak lagi aktif atau tidak valid.');
            if (block.flow) {
                // Selected IDs are data only; role actions still target the interacting
                // member and fixed, permission-checked role IDs, never selected users.
                const variables = { selected_ids: values.join(', '), selected_first: values[0] || '', selected_count: String(values.length) };
                return executeInteractionFlows(interaction, record, [block.flow], 'Flow selesai.', variables);
            }
            return reply(interaction, block.response);
        }
        const values = Array.isArray(interaction.values) ? interaction.values : [];
        if (!block || interaction.componentType !== 3 || values.length < block.minValues || values.length > block.maxValues || new Set(values).size !== values.length) return reply(interaction, 'Pilihan ini tidak lagi aktif atau tidak valid.');
        const picked = values.map((id) => block.options.find((item) => item.id === id));
        if (picked.some((item) => !item)) return reply(interaction, 'Pilihan ini tidak lagi aktif atau tidak valid.');
        if (block.roleSync) return syncSelectedRoles(interaction, record, block, picked);
        if (!values.length) return reply(interaction, 'Tidak ada pilihan. Tidak ada role yang diubah.');
        if (picked.some((item) => item.flow)) {
            const flows = picked.filter((item) => item.flow).map((item) => item.flow);
            const messages = picked.filter((item) => !item.flow).map((item) => `**${item.label}**\n${item.response}`);
            const success = ['Flow selesai.', ...messages].join('\n\n');
            if (success.length > 4000) return reply(interaction, 'Gabungan respons terlalu panjang. Pilih lebih sedikit opsi.');
            return executeInteractionFlows(interaction, record, flows, success);
        }
        return reply(interaction, picked.map((option) => `**${option.label}**\n${option.response}`).join('\n\n'));
    }
    async function createRecurring({guild, actorId, templateId, channelId, sender, identity, recurrence}) {
        ensureGuild(guild);
        if (!safeId(templateId) || !snowflake(actorId)) throw err('Template atau pemilik tidak valid.');
        const template=(await readState(guild.id)).templates.find(item=>item.id===templateId);
        if (!template) throw err('Template tidak ditemukan.',404,'MESSAGE_STUDIO_TEMPLATE_MISSING');
        const document=normalizeMessageDocument(template.document), cleanSender=normalizeSender(sender), cleanIdentity=normalizeIdentity(identity,cleanSender);
        assertSenderDocument(cleanSender,document);
        resolveChannel(guild,channelId,cleanSender,document);
        await assetsFor(guild.id,document);
        return recurring().add({id:makeId(),recurrence,payload:{actorId,channelId,sender:cleanSender,identity:cleanIdentity,document,templateName:template.name}});
    }
    async function listRecurring(guild) { ensureGuild(guild); return recurring().list(); }
    async function removeRecurring(guild,id) { ensureGuild(guild); if(!await recurring().remove(id)) throw err('Jadwal tidak ditemukan atau sedang diproses.',409,'MESSAGE_STUDIO_JOB_BUSY'); }
    async function listScheduled(guild) { ensureGuild(guild); return queue().list(); }
    async function removeScheduled(guild, id) { ensureGuild(guild); if (!await queue().remove(id)) throw err('Jadwal tidak ditemukan atau sedang diproses.', 409, 'MESSAGE_STUDIO_JOB_BUSY'); }
    return { overview, asset, send, edit, remove, forget, saveTemplate, deleteTemplate, handleButton, handleSelect, handleModal, listScheduled, removeScheduled, createRecurring, listRecurring, removeRecurring, startDurableWorker, stopDurableWorker, normalizeDocument: normalizeMessageDocument };
}
