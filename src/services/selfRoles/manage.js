// manage.js — create, change, repost, delete and inspect self-role panels (unified with reaction roles),
// and apply a member's choice on a panel.
//
// One entry point per action, used by the panel's components, the panel's reaction
// events and the web dashboard, so the checks and the order of effects are the same
// everywhere. Failures are thrown with a `code`; callers turn it into a message.
//
// The stored record is the authority; the Discord message is drawn from it.
// A change is stored first and the message is redrawn afterwards. If the redraw
// fails the caller is told so (`message.state`), and "Refresh panel message"
// draws it again. Nothing here deletes a record because Discord could not be
// reached: only an answer that says "this does not exist" counts as missing.

import { randomBytes, randomUUID } from 'node:crypto';
import {
    ActionRowBuilder, ChannelType, PermissionFlagsBits, StringSelectMenuBuilder,
    ButtonBuilder, ButtonStyle, ContainerBuilder, SectionBuilder,
    TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    AttachmentBuilder,
} from 'discord.js';
import { v2Message, v2TextRaw, v2Separator } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';
import {
    MAX_BANNER_BYTES, MAX_DESCRIPTION, MAX_PANELS, MAX_ROLES, MAX_TITLE, BEHAVIOR_MODES, INTERACTION_TYPES,
    bannerExtension, deleteBannerAsset, fail, isButtonStyle, isPanelId, isSnowflake, isValidEmoji,
    mutatePanels, readBannerAsset, readPanel, readPanels, revisionOf, writeBannerAsset,
} from './store.js';

export const PANEL_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const DEFAULT_TITLE = 'Self-Role';
const DEFAULT_DESCRIPTION = 'Select your roles.';
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_ROLE = 10011;

/** A role with one of these must never be handed out by a menu anyone can use. */
export const BLOCKED_PERMISSIONS = [
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers', 'MentionEveryone',
];

/** Message for a failure code, in the language of the caller. Unknown codes get `fallback`. */
export const PANEL_ERRORS = {
    REACTROLES_TITLE: { en: `The title must be 1 to ${MAX_TITLE} characters long.`, id: `Judul harus 1 sampai ${MAX_TITLE} karakter.` },
    REACTROLES_DESCRIPTION: { en: `The description must be 1 to ${MAX_DESCRIPTION} characters long.`, id: `Deskripsi harus 1 sampai ${MAX_DESCRIPTION} karakter.` },
    REACTROLES_CHANNEL: { en: 'Please select a text or announcement channel of this server.', id: 'Pilih channel teks atau pengumuman dari server ini.' },
    REACTROLES_BOT_PERMISSION: {
        en: 'I need **View Channel**, **Send Messages** and **Embed Links** in that channel. Nothing was changed.',
        id: 'Bot membutuhkan izin View Channel, Send Messages, dan Embed Links di channel itu. Tidak ada yang diubah.',
    },
    REACTROLES_NO_ROLES: { en: 'Choose at least one role.', id: 'Pilih minimal satu role.' },
    REACTROLES_ROLE_LIMIT: { en: `A panel can hold at most ${MAX_ROLES} roles.`, id: `Satu panel paling banyak memuat ${MAX_ROLES} role.` },
    REACTROLES_ROLE_REFUSED: { en: 'That role cannot be offered on a panel.', id: 'Role itu tidak dapat ditawarkan di panel.' },
    REACTROLES_ROLE_DUPLICATE: { en: 'That role is already on this panel.', id: 'Role itu sudah ada di panel ini.' },
    REACTROLES_ROLE_NOT_ON_PANEL: { en: 'That role is not on this panel.', id: 'Role itu tidak ada di panel ini.' },
    REACTROLES_LAST_ROLE: {
        en: 'That is the last role on this panel. Delete the panel instead if it is no longer needed.',
        id: 'Itu role terakhir di panel ini. Hapus panelnya jika memang tidak diperlukan lagi.',
    },
    REACTROLES_LIMIT: {
        en: `This server already has the maximum of ${MAX_PANELS} self-role panels. Delete a panel to create a new one.`,
        id: `Server ini sudah memiliki ${MAX_PANELS} panel self-role (batas maksimum). Hapus satu panel untuk membuat yang baru.`,
    },
    REACTROLES_MISSING: { en: 'That panel no longer exists. Run `/selfroles dashboard` again.', id: 'Panel itu sudah tidak ada. Muat ulang halaman.' },
    REACTROLES_STALE: { en: 'The panel changed in the meantime. Check it and try again.', id: 'Panel berubah sejak halaman dimuat. Muat ulang, periksa, lalu ulangi.' },
    REACTROLES_NOT_MISSING: { en: 'The panel message still exists, so there is nothing to repost.', id: 'Pesan panel masih ada, jadi tidak perlu dipasang ulang.' },
    REACTROLES_ROLES_GONE: {
        en: 'None of the roles on this panel exist any more, so it cannot be posted again. Delete the panel.',
        id: 'Tidak ada lagi role panel ini yang masih ada di server, jadi panel tidak dapat dipasang ulang. Hapus panel ini.',
    },
    REACTROLES_CHANNEL_MISSING: {
        en: 'The channel of this panel no longer exists. Delete the panel and create a new one in another channel.',
        id: 'Channel panel ini sudah tidak ada. Hapus panel ini lalu buat panel baru di channel lain.',
    },
    REACTROLES_UNCERTAIN: {
        en: 'I could not check the panel message at Discord right now. Nothing was changed. Please try again.',
        id: 'Pesan panel tidak dapat diperiksa di Discord saat ini. Tidak ada yang diubah. Coba lagi nanti.',
    },
    REACTROLES_INVALID: { en: 'The stored panel data needs to be checked before it can be changed.', id: 'Data panel tersimpan perlu diperiksa sebelum dapat diubah.' },
    REACTROLES_UNAVAILABLE: { en: 'The database is not available right now. Nothing was changed.', id: 'Database tidak tersedia. Tidak ada yang diubah.' },
    REACTROLES_DISCORD: { en: 'Discord refused the request. Nothing was changed.', id: 'Discord menolak permintaan. Tidak ada yang diubah.' },
    REACTROLES_MESSAGE_LEFT: {
        en: 'The panel could not be saved and its new message could not be removed again. Please delete that message by hand; its menu does not work.',
        id: 'Panel gagal disimpan dan pesan barunya tidak dapat dihapus lagi. Hapus pesan itu secara manual; menunya tidak berfungsi.',
    },
    REACTROLES_RECORD_LEFT: {
        en: 'The panel message was deleted, but its stored record could not be removed. Delete the panel again to finish.',
        id: 'Pesan panel sudah dihapus, tetapi catatannya gagal dihapus. Hapus panel sekali lagi untuk menyelesaikan.',
    },
    REACTROLES_BANNER: {
        en: 'The banner must be a PNG, JPEG, WebP or GIF image of at most 5 MB. Nothing was changed.',
        id: 'Banner harus berupa gambar PNG, JPEG, WebP atau GIF paling banyak 5 MB. Tidak ada yang diubah.',
    },
    REACTROLES_EMOJI: {
        en: 'Reaction panels need one valid, distinct emoji per item, and the emoji must exist in this server. Nothing was changed.',
        id: 'Panel reaksi memerlukan satu emoji yang valid dan berbeda per item, dan emoji itu harus ada di server ini. Tidak ada yang diubah.',
    },
    REACTROLES_ITEMS: {
        en: 'The panel items need to be checked before they can be saved. Nothing was changed.',
        id: 'Item panel perlu diperiksa sebelum dapat disimpan. Tidak ada yang diubah.',
    },
};

export function panelErrorMessage(error, language, fallback) {
    const text = PANEL_ERRORS[error?.code]?.[language] ?? fallback;
    if (error?.code === 'REACTROLES_ROLE_REFUSED' && error.reason) return `${text} ${roleReason(error.reason, language)}`;
    return text;
}

const ROLE_REASONS = {
    ROLE_MISSING: { en: 'It no longer exists.', id: 'Role sudah tidak ada.' },
    ROLE_UNKNOWN: { en: 'It could not be looked up at Discord right now.', id: 'Role tidak dapat diperiksa di Discord saat ini.' },
    ROLE_EVERYONE: { en: '@everyone cannot be used.', id: '@everyone tidak dapat dipakai.' },
    ROLE_MANAGED: { en: 'It is managed by a bot or an integration.', id: 'Role dikelola oleh bot atau integrasi.' },
    ROLE_DANGEROUS: {
        en: 'It grants server management, moderation or @everyone mention permissions.',
        id: 'Role memberi izin pengelolaan server, moderasi, atau mention @everyone.',
    },
    BOT_NO_MANAGE_ROLES: { en: 'I do not have the Manage Roles permission.', id: 'Bot tidak memiliki izin Manage Roles.' },
    ROLE_TOO_HIGH: { en: 'It is not below my highest role.', id: 'Posisinya tidak di bawah role tertinggi bot.' },
    ACTOR_TOO_LOW: { en: 'It is not below your own highest role.', id: 'Posisinya tidak di bawah role tertinggi Anda.' },
    REQUIRED_ROLE: { en: 'You need a specific role to use this panel.', id: 'Anda memerlukan role tertentu untuk memakai panel ini.' },
    NOT_ON_PANEL: { en: 'That role is not on this panel.', id: 'Role itu tidak ada di panel ini.' },
};
export const roleReason = (code, language = 'en') => ROLE_REASONS[code]?.[language] ?? ROLE_REASONS.ROLE_UNKNOWN[language];

function has(holder, name) {
    try {
        return holder?.permissions?.has?.(PermissionFlagsBits[name]) === true;
    } catch {
        return false;
    }
}

/**
 * May the bot hand out `role` through a panel right now?
 * `{ok: true}` or `{ok: false, code}`. Never throws.
 */
export function checkPanelRole(guild, role) {
    if (!role || !isSnowflake(role.id)) return { ok: false, code: 'ROLE_MISSING' };
    if (role.id === guild?.id) return { ok: false, code: 'ROLE_EVERYONE' };
    if (role.managed === true) return { ok: false, code: 'ROLE_MANAGED' };
    if (BLOCKED_PERMISSIONS.some((name) => has(role, name))) return { ok: false, code: 'ROLE_DANGEROUS' };
    const me = guild?.members?.me;
    if (!me || !has(me, 'ManageRoles')) return { ok: false, code: 'BOT_NO_MANAGE_ROLES' };
    const highest = me.roles?.highest;
    if (!highest || !(Number(highest.position) > Number(role.position))) return { ok: false, code: 'ROLE_TOO_HIGH' };
    return { ok: true };
}

/**
 * May `member` put `role` on a panel? Discord lets a member give out only roles
 * below their own highest role; a panel must not be a way around that.
 */
export function checkActorRole(guild, member, role) {
    if (!member) return { ok: true };
    if (guild?.ownerId && member.id === guild.ownerId) return { ok: true };
    const highest = member.roles?.highest;
    if (!highest || !(Number(highest.position) > Number(role.position))) return { ok: false, code: 'ACTOR_TOO_LOW' };
    return { ok: true };
}

/** `{role}`, `{missing: true}` (Discord says it does not exist) or `{error}` (nothing is known). */
export async function resolveRole(guild, roleId) {
    const cached = guild?.roles?.cache?.get?.(roleId);
    if (cached) return { role: cached };
    if (typeof guild?.roles?.fetch !== 'function') return { missing: true };
    try {
        const fetched = await guild.roles.fetch(roleId);
        if (!fetched) return { missing: true };
        return { role: fetched };
    } catch (error) {
        if (Number(error?.code) === UNKNOWN_ROLE) return { missing: true };
        return { error };
    }
}

function assertRoleAllowed(guild, role, actor) {
    const check = checkPanelRole(guild, role);
    if (!check.ok) throw fail('Role refused for panel', 'REACTROLES_ROLE_REFUSED', { reason: check.code, roleId: role?.id });
    const mine = checkActorRole(guild, actor, role);
    if (!mine.ok) throw fail('Role above the member who asked', 'REACTROLES_ROLE_REFUSED', { reason: mine.code, roleId: role.id });
}

function cleanText(value, max, code) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length < 1 || text.length > max) throw fail('Invalid panel text', code);
    return text;
}

function parseAccentColor(value) {
    const text = typeof value === 'string' ? value.replace(/^#/, '').trim().toLowerCase() : '';
    if (!/^[0-9a-f]{6}$/.test(text)) return 0x99aab5;
    return parseInt(text, 16);
}

/** Magic-byte check for the uploads we accept; the extension and the declared mime follow the sniffed type. */
export function validateBannerUpload(upload) {
    if (!upload || typeof upload !== 'object') throw fail('Invalid banner upload', 'REACTROLES_BANNER');
    const { mime } = upload;
    const ext = bannerExtension(mime);
    if (!ext) throw fail('Invalid banner image type', 'REACTROLES_BANNER');
    const base64 = typeof upload.base64 === 'string' ? upload.base64.replace(/^data:[^,]*,/, '') : null;
    if (!base64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64)) throw fail('Invalid banner data', 'REACTROLES_BANNER');
    let buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch {
        throw fail('Invalid banner data', 'REACTROLES_BANNER');
    }
    if (buffer.length === 0 || buffer.length > MAX_BANNER_BYTES) throw fail('Invalid banner size', 'REACTROLES_BANNER');
    const sniffed = (() => {
        if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
        if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
        if (buffer.length >= 6 && buffer.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
        if (buffer.length >= 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
        return null;
    })();
    if (sniffed !== mime) throw fail('The banner file is not a valid image of that type', 'REACTROLES_BANNER');
    const filename = `banner-${randomBytes(4).toString('hex')}.${ext}`;
    return { filename, mime, buffer, base64: buffer.toString('base64') };
}

/** An item as stored: bounded text, a valid emoji or none, a known button style. Throws REACTROLES_ITEMS. */
export function cleanItem(item) {
    if (!item || typeof item !== 'object' || !isSnowflake(item.roleId)) throw fail('Invalid panel item', 'REACTROLES_ITEMS');
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 80) : null;
    const description = typeof item.description === 'string' && item.description.trim() ? item.description.trim().slice(0, 100) : null;
    if (item.emoji != null && (typeof item.emoji !== 'string' || !isValidEmoji(item.emoji))) {
        throw fail('Invalid item emoji', 'REACTROLES_EMOJI');
    }
    const emoji = typeof item.emoji === 'string' && item.emoji.trim() ? item.emoji.trim() : null;
    return {
        roleId: item.roleId,
        label,
        description,
        emoji,
        buttonStyle: isButtonStyle(item.buttonStyle) ? item.buttonStyle : 'Primary',
    };
}

/** Reaction panels need one valid, distinct emoji per item. Throws REACTROLES_EMOJI. */
function assertReactionEmojis(items) {
    const seen = new Set();
    for (const item of items) {
        if (!item.emoji) throw fail('Each item needs an emoji in reaction mode', 'REACTROLES_EMOJI');
        const key = customEmojiId(item.emoji) ?? item.emoji;
        if (seen.has(key)) throw fail('Each item needs a distinct emoji in reaction mode', 'REACTROLES_EMOJI');
        seen.add(key);
    }
}

/** The numeric id of a custom emoji (<a?:name:id> or a bare snowflake), or null for a unicode emoji. */
export function customEmojiId(value) {
    const text = String(value ?? '').trim();
    const match = /^<a?:[A-Za-z0-9_]{2,32}:(\d{17,20})>$/.exec(text);
    if (match) return match[1];
    if (/^\d{17,20}$/.test(text)) return text;
    return null;
}

/** The emoji usable to add a reaction, or null when `value` is not one. */
function reactionEmojiFor(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const custom = customEmojiId(text);
    if (custom) return custom;
    return /[^\x00-\x7f\s]/.test(text) ? text : null;
}

// ---- the Discord message ---------------------------------------------------------

export function botCanPostIn(guild, channel) {
    const me = guild.members?.me;
    if (!me || typeof channel?.permissionsFor !== 'function') return false;
    return Boolean(channel.permissionsFor(me)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks,
    ]));
}

/**
 * Where the panel message is.
 * `{state: 'ok', channel, message}`, `{state: 'message_missing', channel}`, `{state: 'channel_missing'}`
 * or `{state: 'unknown', error}` when Discord could not be asked.
 */
export async function locatePanel(guild, panel) {
    let channel = guild.channels?.cache?.get?.(panel.channelId) ?? null;
    if (!channel) {
        try {
            channel = await guild.channels.fetch(panel.channelId);
        } catch (error) {
            if (Number(error?.code) === UNKNOWN_CHANNEL) return { state: 'channel_missing' };
            return { state: 'unknown', error };
        }
        if (!channel) return { state: 'channel_missing' };
    }
    if (typeof channel.messages?.fetch !== 'function') return { state: 'channel_missing' };
    try {
        const message = await channel.messages.fetch(panel.messageId);
        if (!message) return { state: 'message_missing', channel };
        return { state: 'ok', channel, message };
    } catch (error) {
        if (Number(error?.code) === UNKNOWN_MESSAGE) return { state: 'message_missing', channel };
        if (Number(error?.code) === UNKNOWN_CHANNEL) return { state: 'channel_missing' };
        return { state: 'unknown', error, channel };
    }
}

/** Title and description as the posted message shows them (for panels stored before the text was kept). */
export function shownText(message) {
    const text = {};
    for (const top of message?.components ?? []) {
        const parent = typeof top?.toJSON === 'function' ? top.toJSON() : top;
        for (const childRaw of parent?.components ?? []) {
            const c = typeof childRaw?.toJSON === 'function' ? childRaw.toJSON() : childRaw;
            if (c?.type === 10 || c?.type === 11 || c?.type === 12) { // TextDisplay, Section, Separator
                // Extract from TextDisplayBuilder content
                if (c?.type === 10 && typeof c.content === 'string') {
                    const line = c.content.trim();
                    if (line.startsWith('## ')) {
                        if (text.title === undefined) text.title = line.slice(3).trim().slice(0, MAX_TITLE);
                        continue;
                    }
                    if (line.startsWith('-# ') || /^\\*\\*((?:\\\\.|[^*\\n])+)\\*\\*\\n/.test(line)) continue;
                    if (text.description === undefined && line) text.description = line.slice(0, MAX_DESCRIPTION);
                }
            }
        }
    }
    return text;
}

/** The roles of a panel that exist in the server, in stored order. Unknown lookups are left out as well. */
export async function existingRoles(guild, panel) {
    const roles = [];
    for (const item of panel.items) {
        const found = await resolveRole(guild, item.roleId);
        if (found.role) roles.push({ role: found.role, item });
    }
    return roles;
}

export function buildPanelMessage(panel, rolesWithItems) {
    const container = new ContainerBuilder().setAccentColor(parseAccentColor(panel.accentColor));
    
    // Banner
    if (panel.bannerUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(panel.bannerUrl))
        );
    }
    
    // Title & Description
    container.addTextDisplayComponents(
        v2TextRaw(`## ${panel.title ?? DEFAULT_TITLE}`),
        v2TextRaw(panel.description ?? DEFAULT_DESCRIPTION)
    );
    
    // Separator
    container.addSeparatorComponents(v2Separator({ divider: true, spacing: 1 }));
    
    // Interaction Type Logic
    const interactionType = panel.interactionType || 'buttons';
    const behaviorMode = panel.behaviorMode || 'toggle';
    
    if (interactionType === 'buttons') {
        // Buttons (Grid): Max 5 per row
        let currentRow = new ActionRowBuilder();
        rolesWithItems.forEach(({ role, item }, index) => {
            const btn = new ButtonBuilder()
                .setCustomId(`sr_btn:${role.id}`)
                .setLabel(item.label || role.name)
                .setStyle(ButtonStyle[item.buttonStyle || 'Primary'] || ButtonStyle.Primary)
                .setEmoji(item.emoji || '🎭');
            
            currentRow.addComponents(btn);
            if ((index + 1) % 5 === 0 || index === rolesWithItems.length - 1) {
                container.addActionRowComponents(currentRow);
                currentRow = new ActionRowBuilder();
            }
        });
    } else if (interactionType === 'section_buttons') {
        // Section Button List
        rolesWithItems.forEach(({ role, item }) => {
            const section = new SectionBuilder()
                .addTextDisplayComponents(v2TextRaw(`${item.label || role.name}${item.description ? `\n${item.description}` : ''}`))
                .setButtonAccessory(
                    new ButtonBuilder()
                        .setCustomId(`sr_btn:${role.id}`)
                        .setLabel(behaviorMode === 'verify' ? 'Verifikasi' : (behaviorMode === 'unique' ? 'Ambil' : 'Ambil/Lepas'))
                        .setStyle(ButtonStyle[item.buttonStyle || 'Primary'] || ButtonStyle.Primary)
                        .setEmoji(item.emoji || '🎭')
                );
            container.addSectionComponents(section);
        });
    } else if (interactionType === 'dropdown') {
        // Dropdown
        const menu = new StringSelectMenuBuilder()
            .setCustomId('sr_sel')
            .setPlaceholder(panel.dropdownPlaceholder || 'Select your roles')
            .setMinValues(behaviorMode === 'verify' ? 0 : 1)
            .setMaxValues(Math.min(panel.maxSelect || 1, rolesWithItems.length))
            .addOptions(rolesWithItems.map(({ role, item }) => ({
                label: (item.label || role.name).slice(0, 100),
                description: (item.description || '').slice(0, 100),
                value: role.id,
                emoji: item.emoji || '🎭',
            })));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    } else if (interactionType === 'reaction') {
        // Reaction (Classic)
        const lines = rolesWithItems.map(({ role, item }) => 
            `${item.emoji || '🎭'} — <@&${role.id}>${item.label ? ` (${item.label})` : ''}`
        );
        container.addTextDisplayComponents(v2TextRaw(lines.join('\n')));
    }
    
    // Footer
    container.addSeparatorComponents(v2Separator({ divider: true, spacing: 1 }));
    container.addTextDisplayComponents(v2TextRaw('-# Zentix Self-Role'));
    
    return { ...v2Message([container]), allowedMentions: { parse: [] } };
}

/**
 * Draw the stored panel onto its message.
 * `{state: 'updated'}` or `{state: 'missing' | 'channel_missing' | 'no_roles' | 'unknown' | 'failed'}`. Never throws.
 */
/**
 * Draw the stored panel onto its message.
 * `bannerFile` attaches a NEW banner image and replaces whatever was there; `dropAttachments`
 * removes the old banner image (the banner was cleared or switched to a link). With neither,
 * an untouched attachment banner is kept as it is — Discord keeps it while the edit only touches components.
 */
export async function redraw(guild, panel, located = null, { bannerFile = null, dropAttachments = false } = {}) {
    try {
        const where = located ?? await locatePanel(guild, panel);
        if (where.state === 'message_missing') return { state: 'missing' };
        if (where.state !== 'ok') return { state: where.state };
        const rolesWithItems = await existingRoles(guild, panel);
        if (rolesWithItems.length === 0) return { state: 'no_roles' };
        const payload = buildPanelMessage(panel, rolesWithItems);
        if (bannerFile) payload.files = [new AttachmentBuilder(bannerFile.buffer, { name: bannerFile.filename })];
        if (bannerFile || dropAttachments) payload.attachments = [];
        await where.message.edit(payload);
        return { state: 'updated', url: where.message.url ?? null };
    } catch (error) {
        if (Number(error?.code) === UNKNOWN_MESSAGE) return { state: 'missing' };
        logger.warn(`[SELFROLES] Could not redraw panel ${panel.messageId}: ${error?.message ?? error}`);
        return { state: 'failed' };
    }
}

export async function removeMessage(message) {
    try {
        await message.delete();
        return true;
    } catch (error) {
        if (Number(error?.code) === UNKNOWN_MESSAGE) return true;
        logger.warn(`[SELFROLES] Could not delete message ${message?.id}: ${error?.message ?? error}`);
        return false;
    }
}

function discordFailure(error) {
    return fail('Discord refused the request', 'REACTROLES_DISCORD', { cause: error });
}

// ---- reading ----------------------------------------------------------------------

/**
 * The stored panels next to what Discord shows. Reads only; nothing is written, edited or deleted.
 * Each panel gets `status` (`ok`, `message_missing`, `channel_missing`, `unknown`), the text it shows
 * and its roles with a reason when a role cannot be handed out.
 */
export async function inspectPanels(client, guild) {
    const { panels, rejected } = await readPanels(client, guild.id);
    const view = [];
    for (const panel of panels) {
        const where = await locatePanel(guild, panel);
        const shown = where.state === 'ok' ? shownText(where.message) : {};
        const rolesStates = [];
        for (const item of panel.items) {
            const found = await resolveRole(guild, item.roleId);
            if (found.role) {
                const check = checkPanelRole(guild, found.role);
                rolesStates.push({ id: item.roleId, name: String(found.role.name ?? item.roleId), ok: check.ok, reason: check.ok ? null : check.code, item });
            } else {
                rolesStates.push({ id: item.roleId, name: null, ok: false, reason: found.missing ? 'ROLE_MISSING' : 'ROLE_UNKNOWN', item });
            }
        }
        view.push({
            ...panel,
            revision: revisionOf(panel),
            status: where.state,
            channel: where.channel ?? guild.channels?.cache?.get?.(panel.channelId) ?? null,
            url: where.state === 'ok' ? where.message.url ?? null : null,
            title: panel.title ?? shown.title ?? null,
            description: panel.description ?? shown.description ?? null,
            roleStates: rolesStates,
        });
    }
    return { panels: view, rejected };
}

// ---- changes ----------------------------------------------------------------------

/**
 * Post a new panel and store it.
 * The message is sent first because its id is the key of the record; if the record cannot be stored
 * the message is deleted again, and if that fails too the error says a message was left behind.
 */
export async function createPanel(client, guild, { channel, title, description, items, bannerUrl, bannerFile = null, accentColor, interactionType, behaviorMode, requiredRoleId, maxSelect, dropdownPlaceholder, actor = null } = {}) {
    const cleanTitle = cleanText(title, MAX_TITLE, 'REACTROLES_TITLE');
    const cleanDescription = cleanText(description, MAX_DESCRIPTION, 'REACTROLES_DESCRIPTION');
    const cleanBannerUrl = typeof bannerUrl === 'string' && bannerUrl.trim() ? cleanText(bannerUrl, 2048, 'REACTROLES_BANNER') : null;
    const cleanBannerFile = bannerFile ? validateBannerUpload(bannerFile) : null;
    const cleanDropdownPlaceholder = dropdownPlaceholder ? cleanText(dropdownPlaceholder, 100, 'REACTROLES_TITLE') : null;
    const cleanInteractionType = interactionType || 'buttons';
    const cleanBehaviorMode = behaviorMode || 'toggle';
    if (!INTERACTION_TYPES.includes(cleanInteractionType)) throw fail('Invalid interaction type', 'REACTROLES_ITEMS');
    if (!BEHAVIOR_MODES.includes(cleanBehaviorMode)) throw fail('Invalid behavior mode', 'REACTROLES_ITEMS');

    // The server's own copy of the channel: an object from elsewhere is not trusted.
    const target = guild.channels?.cache?.get?.(channel?.id) ?? null;
    if (!target || !PANEL_CHANNEL_TYPES.includes(target.type)) throw fail('Invalid panel channel', 'REACTROLES_CHANNEL');

    const uniqueItems = [...new Map((Array.isArray(items) ? items : []).filter((item) => item && typeof item === 'object').map((item) => [item.roleId, item])).values()]
        .map((item) => cleanItem(item));
    if (uniqueItems.length === 0) throw fail('No roles', 'REACTROLES_NO_ROLES');
    if (uniqueItems.length > MAX_ROLES) throw fail('Too many roles', 'REACTROLES_ROLE_LIMIT');
    if (cleanInteractionType === 'reaction') {
        assertReactionEmojis(uniqueItems);
        const customIds = [...new Set(uniqueItems.map((item) => customEmojiId(item.emoji)).filter(Boolean))];
        if (customIds.length && typeof guild.emojis?.fetch === 'function') {
            const missing = [];
            for (const id of customIds) {
                const found = guild.emojis.cache?.get?.(id) ?? await guild.emojis.fetch(id).catch(() => null);
                if (!found) missing.push(id);
            }
            if (missing.length) throw fail('Emoji not in this server', 'REACTROLES_EMOJI', { emojiIds: missing });
        }
    }

    const roles = [];
    for (const item of uniqueItems) {
        const role = await resolveRole(guild, item.roleId);
        if (!role.role) throw fail('Role not found', 'REACTROLES_ROLE_REFUSED', { reason: 'ROLE_MISSING', roleId: item.roleId });
        assertRoleAllowed(guild, role.role, actor);
        roles.push(role.role);
    }

    if (!botCanPostIn(guild, target)) throw fail('Bot cannot post in the panel channel', 'REACTROLES_BOT_PERMISSION');

    // Checked before posting so that a full server does not get a message that is deleted a moment later.
    const before = await readPanels(client, guild.id);
    if (before.panels.length >= MAX_PANELS) throw fail('Panel limit reached', 'REACTROLES_LIMIT', { limit: MAX_PANELS });

    const draft = {
        id: randomUUID(),
        guildId: guild.id,
        channelId: target.id,
        items: uniqueItems,
        title: cleanTitle,
        description: cleanDescription,
        bannerUrl: cleanBannerFile ? `attachment://${cleanBannerFile.filename}` : cleanBannerUrl,
        accentColor: (typeof accentColor === 'string' ? accentColor : '').replace(/^#/, '').toLowerCase() || null,
        interactionType: cleanInteractionType,
        behaviorMode: cleanBehaviorMode,
        requiredRoleId: requiredRoleId ? (isSnowflake(requiredRoleId) ? requiredRoleId : null) : null,
        maxSelect: maxSelect ? Math.max(1, Math.min(25, Math.floor(maxSelect) || 1)) : 1,
        dropdownPlaceholder: cleanDropdownPlaceholder || 'Select your roles',
        createdAt: new Date().toISOString(),
    };

    let message;
    try {
        const payload = buildPanelMessage(draft, roles.map((role, index) => ({ role, item: uniqueItems[index] })));
        if (cleanBannerFile) payload.files = [new AttachmentBuilder(cleanBannerFile.buffer, { name: cleanBannerFile.filename })];
        message = await target.send(payload);
    } catch (error) {
        throw discordFailure(error);
    }

    const panel = { ...draft, messageId: message.id };
    try {
        await mutatePanels(client, guild.id, (panels) => {
            if (panels.length >= MAX_PANELS) throw fail('Panel limit reached', 'REACTROLES_LIMIT', { limit: MAX_PANELS });
            return { put: [panel] };
        });
    } catch (error) {
        if (await removeMessage(message)) throw error;
        throw fail('Panel message left behind', 'REACTROLES_MESSAGE_LEFT', { cause: error, url: message.url ?? null, messageId: message.id });
    }
    const result = { panel, message, roles };
    if (cleanBannerFile) {
        try {
            await writeBannerAsset(client, guild.id, panel.id, { filename: cleanBannerFile.filename, mime: cleanBannerFile.mime, base64: cleanBannerFile.base64 });
        } catch (error) {
            logger.warn(`[SELFROLES] The panel was created but its banner bytes could not be stored: ${error?.message ?? error}`);
            result.bannerWarning = true;
        }
    }
    if (cleanInteractionType === 'reaction') result.reactionFailures = await addPanelReactions(message, panel);
    return result;
}

/** Add one reaction per item, in order. Best effort: an item's reaction that cannot be added is reported, never thrown. */
async function addPanelReactions(message, panel) {
    const failures = [];
    for (const item of panel.items) {
        const emoji = reactionEmojiFor(item.emoji);
        if (!emoji) {
            failures.push({ roleId: item.roleId, emoji: item.emoji ?? null });
            continue;
        }
        try {
            await message.react(emoji);
        } catch (error) {
            logger.warn(`[SELFROLES] Could not add reaction ${item.emoji} to panel message ${message?.id}: ${error?.message ?? error}`);
            failures.push({ roleId: item.roleId, emoji: item.emoji });
        }
    }
    return failures;
}

/** Run a change on one stored panel. `change(panel)` edits the copy it gets or throws. */
async function changePanel(client, guild, messageId, { revision = null, fallbackText = {} } = {}, change) {
    return mutatePanels(client, guild.id, (panels) => {
        const panel = panels.find((entry) => entry.messageId === messageId);
        if (!panel) throw fail('Panel not found', 'REACTROLES_MISSING');
        if (revision && revision !== revisionOf(panel)) throw fail('Panel changed', 'REACTROLES_STALE');
        change(panel);
        // Panels stored before the text was kept get it from the message they show.
        if (!panel.title && fallbackText.title) panel.title = fallbackText.title;
        if (!panel.description && fallbackText.description) panel.description = fallbackText.description;
        panel.updatedAt = new Date().toISOString();
        return { put: [panel], result: panel };
    });
}

async function stored(client, guild, messageId) {
    if (!isSnowflake(messageId)) throw fail('Panel not found', 'REACTROLES_MISSING');
    const panel = await readPanel(client, guild.id, messageId);
    if (!panel) throw fail('Panel not found', 'REACTROLES_MISSING');
    return panel;
}

/** Add a role to a panel. Returns `{panel, message}`; `message.state` says whether the posted panel shows it. */
export async function addPanelRole(client, guild, messageId, role, { revision = null, actor = null, item = {} } = {}) {
    assertRoleAllowed(guild, role, actor);
    const current = await stored(client, guild, messageId);
    const where = await locatePanel(guild, current);
    const panel = await changePanel(client, guild, messageId, { revision, fallbackText: shownText(where.message) }, (entry) => {
        if (entry.items.some(i => i.roleId === role.id)) throw fail('Role already on panel', 'REACTROLES_ROLE_DUPLICATE');
        if (entry.items.length >= MAX_ROLES) throw fail('Too many roles', 'REACTROLES_ROLE_LIMIT');
        entry.items.push(cleanItem({ ...item, roleId: role.id }));
    });
    return { panel, message: await redraw(guild, panel, where) };
}

/** Take a role off a panel. The last role is refused: an empty menu cannot be posted. */
export async function removePanelRole(client, guild, messageId, roleId, { revision = null } = {}) {
    const current = await stored(client, guild, messageId);
    const where = await locatePanel(guild, current);
    const panel = await changePanel(client, guild, messageId, { revision, fallbackText: shownText(where.message) }, (entry) => {
        const index = entry.items.findIndex(i => i.roleId === roleId);
        if (index === -1) throw fail('Role not on panel', 'REACTROLES_ROLE_NOT_ON_PANEL');
        if (entry.items.length === 1) throw fail('Last role', 'REACTROLES_LAST_ROLE');
        entry.items.splice(index, 1);
    });
    return { panel, message: await redraw(guild, panel, where) };
}

/**
 * Replace the whole item list: order, label, description, emoji and button style of every role.
 * Roles already on the panel keep their stored permissions check (they were allowed when added);
 * roles NEW to the panel are checked like added roles are. The list may not be emptied: an empty
 * menu cannot be posted.
 */
export async function editPanelItems(client, guild, messageId, items, { revision = null, actor = null } = {}) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === 'object').map((item) => cleanItem(item));
    if (list.length === 0) throw fail('No roles', 'REACTROLES_NO_ROLES');
    if (list.length > MAX_ROLES) throw fail('Too many roles', 'REACTROLES_ROLE_LIMIT');
    if (new Set(list.map((item) => item.roleId)).size !== list.length) throw fail('Duplicate roles in the list', 'REACTROLES_ROLE_DUPLICATE');

    const current = await stored(client, guild, messageId);
    const known = new Set(current.items.map((item) => item.roleId));
    if (current.interactionType === 'reaction') assertReactionEmojis(list);
    for (const item of list) {
        if (known.has(item.roleId)) continue; // already on the panel; checked when it was added
        const role = await resolveRole(guild, item.roleId);
        if (!role.role) throw fail('Role not found', 'REACTROLES_ROLE_REFUSED', { reason: 'ROLE_MISSING', roleId: item.roleId });
        assertRoleAllowed(guild, role.role, actor);
    }
    const panel = await changePanel(client, guild, messageId, { revision }, (entry) => {
        entry.items = list;
    });
    return { panel, message: await redraw(guild, panel) };
}

/**
 * Change title, description and other panel properties.
 * `bannerUrl`: a link to set, an empty string or null to clear, `undefined` to keep the current one.
 * `bannerFile` uploads a new banner image (it replaces whatever the panel had); `bannerClear` removes it.
 */
export async function editPanelText(client, guild, messageId, { title, description, bannerUrl, bannerFile = null, bannerClear = false, accentColor, interactionType, behaviorMode, requiredRoleId, maxSelect, dropdownPlaceholder, revision = null } = {}) {
    const cleanTitle = cleanText(title, MAX_TITLE, 'REACTROLES_TITLE');
    const cleanDescription = cleanText(description, MAX_DESCRIPTION, 'REACTROLES_DESCRIPTION');
    const cleanBannerFile = bannerFile ? validateBannerUpload(bannerFile) : null;
    const cleanBannerUrl = (() => {
        if (bannerUrl === undefined) return undefined;      // keep
        if (bannerUrl === null || bannerUrl === '') return null; // clear
        const text = cleanText(bannerUrl, 2048, 'REACTROLES_BANNER');
        if (!/^https:\/\//.test(text)) throw fail('The banner link must start with https://', 'REACTROLES_BANNER');
        return text;
    })();
    const cleanDropdownPlaceholder = dropdownPlaceholder ? cleanText(dropdownPlaceholder, 100, 'REACTROLES_ITEMS') : null;
    if (interactionType !== undefined && !INTERACTION_TYPES.includes(interactionType)) throw fail('Invalid interaction type', 'REACTROLES_ITEMS');
    if (behaviorMode !== undefined && !BEHAVIOR_MODES.includes(behaviorMode)) throw fail('Invalid behavior mode', 'REACTROLES_ITEMS');

    // Captured inside the synchronous change callback; used to drop the old banner attachment only
    // when the edit really switches the banner away from an uploaded image.
    let dropAttachments = false;
    const panel = await changePanel(client, guild, messageId, { revision }, (entry) => {
        entry.title = cleanTitle;
        entry.description = cleanDescription;
        if (bannerClear || cleanBannerUrl === null) {
            if (typeof entry.bannerUrl === 'string' && entry.bannerUrl.startsWith('attachment://')) dropAttachments = true;
            entry.bannerUrl = null;
        } else if (cleanBannerFile) {
            entry.bannerUrl = `attachment://${cleanBannerFile.filename}`;
        } else if (cleanBannerUrl !== undefined) {
            if (typeof entry.bannerUrl === 'string' && entry.bannerUrl.startsWith('attachment://') && cleanBannerUrl !== entry.bannerUrl) dropAttachments = true;
            entry.bannerUrl = cleanBannerUrl;
        }
        if (accentColor !== undefined) entry.accentColor = (accentColor || '').replace(/^#/, '').trim().toLowerCase() || null;
        if (interactionType !== undefined) entry.interactionType = interactionType;
        if (behaviorMode !== undefined) entry.behaviorMode = behaviorMode;
        if (requiredRoleId !== undefined) entry.requiredRoleId = requiredRoleId ? (isSnowflake(requiredRoleId) ? requiredRoleId : null) : null;
        if (maxSelect !== undefined) entry.maxSelect = maxSelect ? Math.max(1, Math.min(25, Math.floor(maxSelect) || 1)) : 1;
        if (dropdownPlaceholder !== undefined) entry.dropdownPlaceholder = cleanDropdownPlaceholder || 'Select your roles';
        if (entry.interactionType === 'reaction') {
            // A reaction panel whose emojis collide or vanish is worse than a refused save.
            try {
                assertReactionEmojis(entry.items);
            } catch (error) {
                throw error;
            }
        }
    });
    // Bytes go to the banner store before the message is edited, so a failure to save them never
    // leaves the panel record pointing at an attachment the bytes for. Best effort after the fact.
    if (cleanBannerFile) {
        try {
            await writeBannerAsset(client, guild.id, panel.id, { filename: cleanBannerFile.filename, mime: cleanBannerFile.mime, base64: cleanBannerFile.base64 });
        } catch (error) {
            logger.warn(`[SELFROLES] The panel was changed but its banner bytes could not be stored: ${error?.message ?? error}`);
        }
    } else if (dropAttachments || bannerClear) {
        await deleteBannerAsset(client, guild.id, panel.id).catch((error) => {
            logger.warn(`[SELFROLES] Could not delete the stored banner bytes: ${error?.message ?? error}`);
        });
    }
    return { panel, message: await redraw(guild, panel, null, { bannerFile: cleanBannerFile, dropAttachments }) };
}

/** Draw the stored panel onto its message again. Stores the shown text for panels that had none stored. */
export async function refreshPanelMessage(client, guild, messageId) {
    let panel = await stored(client, guild, messageId);
    const where = await locatePanel(guild, panel);
    const text = shownText(where.message);
    if ((!panel.title && text.title) || (!panel.description && text.description)) {
        panel = await changePanel(client, guild, messageId, { fallbackText: text }, () => {});
    }
    return { panel, message: await redraw(guild, panel, where) };
}

/**
 * Delete a panel: the Discord message first, then the record.
 * If Discord refuses or cannot be asked, nothing is changed. A message that is already gone is fine.
 */
export async function deletePanel(client, guild, messageId, { revision = null } = {}) {
    const panel = await stored(client, guild, messageId);
    if (revision && revision !== revisionOf(panel)) throw fail('Panel changed', 'REACTROLES_STALE');
    const where = await locatePanel(guild, panel);
    if (where.state === 'unknown') throw fail('Panel message could not be checked', 'REACTROLES_UNCERTAIN', { cause: where.error });

    let messageDeleted = false;
    if (where.state === 'ok') {
        try {
            await where.message.delete();
            messageDeleted = true;
        } catch (error) {
            if (Number(error?.code) !== UNKNOWN_MESSAGE) throw discordFailure(error);
        }
    }
    try {
        await mutatePanels(client, guild.id, (panels) => (
            panels.some((entry) => entry.messageId === messageId) ? { remove: [messageId] } : { write: false }
        ));
    } catch (error) {
        throw fail('Record left behind', 'REACTROLES_RECORD_LEFT', { cause: error });
    }
    await deleteBannerAsset(client, guild.id, panel.id).catch((error) => {
        logger.warn(`[SELFROLES] Could not delete the stored banner bytes: ${error?.message ?? error}`);
    });
    return { panel, messageDeleted, title: panel.title ?? shownText(where.message).title ?? null };
}

/**
 * Post the panel again after its message was deleted. The record moves to the new message id.
 * Refused while the old message still exists or cannot be checked.
 */
export async function repostPanel(client, guild, messageId) {
    const panel = await stored(client, guild, messageId);
    const where = await locatePanel(guild, panel);
    if (where.state === 'ok') throw fail('Panel message still exists', 'REACTROLES_NOT_MISSING');
    if (where.state === 'channel_missing') throw fail('Panel channel missing', 'REACTROLES_CHANNEL_MISSING');
    if (where.state === 'unknown') throw fail('Panel message could not be checked', 'REACTROLES_UNCERTAIN', { cause: where.error });
    if (!botCanPostIn(guild, where.channel)) throw fail('Bot cannot post in the panel channel', 'REACTROLES_BOT_PERMISSION');

    const rolesWithItems = await existingRoles(guild, panel);
    if (rolesWithItems.length === 0) throw fail('No roles left', 'REACTROLES_ROLES_GONE');

    // The banner bytes survive a deleted panel message; an image banner does not.
    let bannerFile = null;
    let bannerLost = false;
    if (typeof panel.bannerUrl === 'string' && panel.bannerUrl.startsWith('attachment://')) {
        const asset = await readBannerAsset(client, guild.id, panel.id).catch((error) => {
            logger.warn(`[SELFROLES] Could not read the stored banner bytes: ${error?.message ?? error}`);
            return null;
        });
        if (asset) bannerFile = { buffer: asset.buffer, filename: asset.filename, mime: asset.mime, base64: asset.base64 };
        else bannerLost = true;
    }
    const panelForDraw = bannerLost ? { ...panel, bannerUrl: null } : panel;
    let message;
    try {
        const payload = buildPanelMessage(panelForDraw, rolesWithItems);
        if (bannerFile) payload.files = [new AttachmentBuilder(bannerFile.buffer, { name: bannerFile.filename })];
        message = await where.channel.send(payload);
    } catch (error) {
        throw discordFailure(error);
    }
    const moved = { ...panel, messageId: message.id, updatedAt: new Date().toISOString() };
    try {
        await mutatePanels(client, guild.id, (panels) => {
            // Someone else reposted or deleted it in the meantime.
            if (!panels.some((entry) => entry.messageId === messageId)) throw fail('Panel not found', 'REACTROLES_MISSING');
            return { remove: [messageId], put: [moved] };
        });
    } catch (error) {
        if (await removeMessage(message)) throw error;
        throw fail('Panel message left behind', 'REACTROLES_MESSAGE_LEFT', { cause: error, url: message.url ?? null, messageId: message.id });
    }
    if (bannerLost) {
        // The image died with the old message; keep the record honest instead of pointing at a missing file.
        moved.bannerUrl = null;
        try {
            await mutatePanels(client, guild.id, (panels) => {
                const target = panels.find((entry) => entry.messageId === message.id);
                if (!target) return { write: false };
                target.bannerUrl = null;
                target.updatedAt = new Date().toISOString();
                return { put: [target], result: target };
            });
        } catch (error) {
            logger.warn(`[SELFROLES] The reposted panel lost its banner, but the record could not be updated: ${error?.message ?? error}`);
        }
    }
    if (moved.interactionType === 'reaction') moved.reactionFailures = await addPanelReactions(message, moved);
    return { panel: moved, message, bannerLost };
}

// ---- a member's choice -------------------------------------------------------------

const memberQueues = new Map();

/** One choice at a time per member, so two quick submits do not interleave their role changes. */
function inMemberOrder(key, run) {
    const previous = memberQueues.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    const tail = next.catch(() => {});
    memberQueues.set(key, tail);
    tail.then(() => {
        if (memberQueues.get(key) === tail) memberQueues.delete(key);
    });
    return next;
}

/**
 * Make the member's panel roles match what they selected.
 *
 * Returns `null` when no panel is stored for the message, otherwise
 * `{added, removed, skipped, failed}`: lists of `{id, name, reason?}`.
 * A role the bot may not hand out (see checkPanelRole) is not touched in either direction.
 * When the panel demands a role the member does not have, returns `{blocked: 'REQUIRED_ROLE', requiredRoleId}`
 * and nothing is changed. The behavior mode is read from the stored panel: `verify` never takes a role away,
 * `unique` keeps at most one panel role per member, `toggle` flips what was picked.
 * Throws when the database cannot be read: "no panel" must never be guessed.
 */
export async function applyMemberChoice(client, guild, member, messageId, selectedIds) {
    const panel = await readPanel(client, guild.id, messageId);
    if (!panel) return null;

    if (panel.requiredRoleId && !member?.roles?.cache?.has?.(panel.requiredRoleId)) {
        return { added: [], removed: [], skipped: [], failed: [], blocked: 'REQUIRED_ROLE', requiredRoleId: panel.requiredRoleId };
    }
    const behaviorMode = panel.behaviorMode || 'toggle';
    const wanted = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter((id) => panel.items.some(i => i.roleId === id)));

    return inMemberOrder(`${guild.id}:${member.id}`, async () => {
        const outcome = { added: [], removed: [], skipped: [], failed: [] };
        const currentRoles = member.roles.cache;

        const attempt = async (item, give) => {
            const roleId = item.roleId;
            const found = await resolveRole(guild, roleId);
            if (!found.role) {
                outcome.skipped.push({ id: roleId, name: null, reason: found.missing ? 'ROLE_MISSING' : 'ROLE_UNKNOWN' });
                return;
            }
            const entry = { id: roleId, name: String(found.role.name ?? roleId) };
            const check = checkPanelRole(guild, found.role);
            if (!check.ok) {
                outcome.skipped.push({ ...entry, reason: check.code });
                return;
            }
            try {
                if (give) {
                    await member.roles.add(found.role, 'Self-role panel');
                    outcome.added.push(entry);
                } else {
                    await member.roles.remove(found.role, 'Self-role panel');
                    outcome.removed.push(entry);
                }
            } catch (error) {
                logger.warn(`[SELFROLES] Could not ${give ? 'give' : 'take'} role ${roleId} for ${member.id}: ${error?.message ?? error}`);
                outcome.failed.push({ ...entry, wanted: give });
            }
        };

        // Removals first, so a member swapping roles in a unique panel never holds two of them.
        if (behaviorMode !== 'verify') {
            for (const item of panel.items) {
                if (currentRoles.has(item.roleId) && !wanted.has(item.roleId)) await attempt(item, false);
            }
        }
        for (const item of panel.items) {
            if (wanted.has(item.roleId) && !member.roles.cache.has(item.roleId)) await attempt(item, true);
        }
        return outcome;
    });
}

/**
 * Apply one button of a panel. Returns `null` when no panel is stored for the message.
 * `toggle` flips the role; `unique` gives the role and takes the member's other roles from this panel
 * (pressing the one role they hold unpicks it); `verify` only ever gives the role.
 */
export async function applyButtonChoice(client, guild, member, messageId, roleId) {
    const panel = await readPanel(client, guild.id, messageId);
    if (!panel) return null;

    if (panel.requiredRoleId && !member?.roles?.cache?.has?.(panel.requiredRoleId)) {
        return { added: [], removed: [], skipped: [], failed: [], blocked: 'REQUIRED_ROLE', requiredRoleId: panel.requiredRoleId };
    }
    const item = panel.items.find((entry) => entry.roleId === roleId);
    if (!item) {
        return { added: [], removed: [], skipped: [{ id: roleId, name: null, reason: 'NOT_ON_PANEL' }], failed: [] };
    }
    const behaviorMode = panel.behaviorMode || 'toggle';

    return inMemberOrder(`${guild.id}:${member.id}`, async () => {
        const outcome = { added: [], removed: [], skipped: [], failed: [] };
        const currentRoles = member.roles.cache;
        const holds = currentRoles.has(roleId);
        const heldOthers = panel.items.filter((entry) => entry.roleId !== roleId && currentRoles.has(entry.roleId));

        const attempt = async (target, give) => {
            const found = await resolveRole(guild, target.roleId);
            if (!found.role) {
                outcome.skipped.push({ id: target.roleId, name: null, reason: found.missing ? 'ROLE_MISSING' : 'ROLE_UNKNOWN' });
                return;
            }
            const entry = { id: target.roleId, name: String(found.role.name ?? target.roleId) };
            const check = checkPanelRole(guild, found.role);
            if (!check.ok) {
                outcome.skipped.push({ ...entry, reason: check.code });
                return;
            }
            try {
                if (give) {
                    await member.roles.add(found.role, 'Self-role panel button');
                    outcome.added.push(entry);
                } else {
                    await member.roles.remove(found.role, 'Self-role panel button');
                    outcome.removed.push(entry);
                }
            } catch (error) {
                logger.warn(`[SELFROLES] Could not ${give ? 'give' : 'take'} role ${target.roleId} for ${member.id}: ${error?.message ?? error}`);
                outcome.failed.push({ ...entry, wanted: give });
            }
        };

        if (behaviorMode === 'verify') {
            if (!holds) await attempt(item, true);
            return outcome;
        }
        if (behaviorMode === 'unique') {
            if (holds && heldOthers.length === 0) {
                await attempt(item, false);
                return outcome;
            }
            for (const other of heldOthers) await attempt(other, false);
            if (!holds) await attempt(item, true);
            return outcome;
        }
        // toggle
        await attempt(item, !holds);
        return outcome;
    });
}

/**
 * Apply one reaction on a classic panel. `action` is `'add'` or `'remove'`.
 * Returns `{handled: false}` when the message is not a reaction panel; `{blocked: 'REQUIRED_ROLE'}`
 * when the member may not use the panel; otherwise `{handled: true, added, removed, skipped, failed}`.
 * In `verify` mode an un-react changes nothing: the role stays with the member.
 */
export async function applyReactionChoice(client, guild, member, message, emoji, action) {
    const messageId = message?.id ?? message?.messageId;
    if (!isSnowflake(messageId)) return { handled: false };
    const panel = await readPanel(client, guild.id, messageId);
    if (!panel || panel.interactionType !== 'reaction') return { handled: false };

    // The message is a panel: no reaction on it is processed elsewhere.
    const behaviorMode = panel.behaviorMode || 'toggle';
    const emojiId = emoji?.id ?? null;
    const emojiName = emoji?.name ?? null;
    const item = panel.items.find((entry) => {
        const custom = customEmojiId(entry.emoji);
        if (custom) return emojiId === custom;
        return !emojiId && String(entry.emoji ?? '').trim() === String(emojiName ?? '').trim();
    });
    if (!item) return { handled: true, added: [], removed: [], skipped: [], failed: [], ignored: 'unknown_emoji' };

    if (panel.requiredRoleId && !member?.roles?.cache?.has?.(panel.requiredRoleId)) {
        return { handled: true, blocked: 'REQUIRED_ROLE', requiredRoleId: panel.requiredRoleId };
    }

    return inMemberOrder(`${guild.id}:${member.id}`, async () => {
        const outcome = { handled: true, added: [], removed: [], skipped: [], failed: [] };
        const currentRoles = member.roles.cache;
        const holds = currentRoles.has(item.roleId);

        const attempt = async (target, give) => {
            const found = await resolveRole(guild, target.roleId);
            if (!found.role) {
                outcome.skipped.push({ id: target.roleId, name: null, reason: found.missing ? 'ROLE_MISSING' : 'ROLE_UNKNOWN' });
                return;
            }
            const entry = { id: target.roleId, name: String(found.role.name ?? target.roleId) };
            const check = checkPanelRole(guild, found.role);
            if (!check.ok) {
                outcome.skipped.push({ ...entry, reason: check.code });
                return;
            }
            try {
                if (give) {
                    await member.roles.add(found.role, 'Self-role panel reaction');
                    outcome.added.push(entry);
                } else {
                    await member.roles.remove(found.role, 'Self-role panel reaction');
                    outcome.removed.push(entry);
                }
            } catch (error) {
                logger.warn(`[SELFROLES] Could not ${give ? 'give' : 'take'} role ${target.roleId} for ${member.id}: ${error?.message ?? error}`);
                outcome.failed.push({ ...entry, wanted: give });
            }
        };

        if (action === 'add') {
            if (behaviorMode === 'unique') {
                for (const other of panel.items) {
                    if (other.roleId !== item.roleId && currentRoles.has(other.roleId)) await attempt(other, false);
                }
            }
            if (!member.roles.cache.has(item.roleId)) await attempt(item, true);
            if (behaviorMode === 'unique' && message?.reactions) await clearMemberReactions(message, panel.items, item, member.id);
            return outcome;
        }
        // action === 'remove'
        if (behaviorMode === 'verify') return outcome; // un-reacting changes nothing in verify mode
        if (member.roles.cache.has(item.roleId)) await attempt(item, false);
        return outcome;
    });
}

/** Best effort: drop the member's reactions on the other items of this panel. */
async function clearMemberReactions(message, items, keep, memberId) {
    for (const other of items) {
        if (other.roleId === keep.roleId) continue;
        const emoji = reactionEmojiFor(other.emoji);
        if (!emoji) continue;
        try {
            const reaction = message.reactions?.resolve?.(emoji) ?? null;
            if (reaction) await reaction.users.remove(memberId);
        } catch (error) {
            logger.warn(`[SELFROLES] Could not remove the reaction for role ${other.roleId} from member ${memberId}: ${error?.message ?? error}`);
        }
    }
}

/** A one-line summary for the startup log. Reads only. */
export async function summarizePanels(client, guild) {
    const { panels, rejected } = await inspectPanels(client, guild);
    const count = (status) => panels.filter((panel) => panel.status === status).length;
    return {
        stored: panels.length,
        ok: count('ok'),
        messageMissing: count('message_missing'),
        channelMissing: count('channel_missing'),
        unknown: count('unknown'),
        unreadable: rejected,
    };
}
