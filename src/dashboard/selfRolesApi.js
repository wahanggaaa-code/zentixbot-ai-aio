import express from 'express';
import {
    PANEL_CHANNEL_TYPES, addPanelRole, botCanPostIn, checkActorRole, checkPanelRole, createPanel, deletePanel, editPanelItems, editPanelText,
    inspectPanels, panelErrorMessage, refreshPanelMessage, removePanelRole, repostPanel, resolveRole, roleReason, validateBannerUpload,
} from '../services/selfRoles/manage.js';
import { MAX_DESCRIPTION, MAX_PANELS, MAX_ROLES, MAX_TITLE } from '../services/selfRoles/store.js';
import { recordPanelChange } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

/**
 * Self-role panels for the web dashboard.
 *
 * This page acts on Discord: creating or reposting a panel sends a message,
 * changing it edits that message and deleting it deletes the message. Every
 * change goes through the same functions as `/selfroles`, so the checks and
 * the order of effects are the same. Reading changes nothing.
 */

const MAX_LISTED = 250;
const isId = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const isRevision = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bad = (status, message) => Object.assign(new Error(message), { status });

const STATUS = {
    REACTROLES_TITLE: 400,
    REACTROLES_DESCRIPTION: 400,
    REACTROLES_CHANNEL: 400,
    REACTROLES_NO_ROLES: 400,
    REACTROLES_ROLE_LIMIT: 409,
    REACTROLES_ROLE_REFUSED: 409,
    REACTROLES_ROLE_DUPLICATE: 409,
    REACTROLES_ROLE_NOT_ON_PANEL: 409,
    REACTROLES_LAST_ROLE: 409,
    REACTROLES_LIMIT: 409,
    REACTROLES_BOT_PERMISSION: 409,
    REACTROLES_MISSING: 404,
    REACTROLES_STALE: 409,
    REACTROLES_NOT_MISSING: 409,
    REACTROLES_CHANNEL_MISSING: 409,
    REACTROLES_ROLES_GONE: 409,
    REACTROLES_INVALID: 409,
    REACTROLES_UNCERTAIN: 502,
    REACTROLES_DISCORD: 502,
    REACTROLES_UNAVAILABLE: 503,
    REACTROLES_MESSAGE_LEFT: 500,
    REACTROLES_RECORD_LEFT: 500,
    REACTROLES_BANNER: 400,
    REACTROLES_EMOJI: 400,
    REACTROLES_ITEMS: 400,
};

function respond(res, error, fallback) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    const status = STATUS[error.code];
    if (status) {
        if (status >= 500) logger.warn(`[SELFROLES] Dashboard request failed (${error.code}): ${error.cause?.message ?? error.message}`);
        const body = { error: panelErrorMessage(error, 'id', fallback) };
        if (error.code === 'REACTROLES_MESSAGE_LEFT') body.messageUrl = error.url ?? null;
        return res.status(status).json(body);
    }
    // Includes a lost COMMIT response: the change may or may not be stored.
    logger.warn(`[SELFROLES] Dashboard request failed: ${error?.message ?? error}`);
    return res.status(503).json({ error: fallback });
}

/**
 * The body must carry every `required` key, may only carry keys from `required` ∪ `optional`,
 * and must confirm. (An exact key-count match used to reject every form that sent extra fields.)
 */
function requireBody(body, required, optional = []) {
    if (!isPlainObject(body)) throw bad(400, 'Permintaan tidak valid.');
    const allowed = new Set([...required, ...optional]);
    if (Object.keys(body).some((key) => !allowed.has(key))) throw bad(400, 'Permintaan tidak valid.');
    if (required.some((key) => !Object.hasOwn(body, key))) throw bad(400, 'Permintaan tidak valid.');
    if (body.confirmed !== true) throw bad(400, 'Konfirmasi diperlukan.');
}

/** `bannerFile` as accepted from the page: `{ name?, mime, base64 }`. Returns the decoded upload or null when absent. */
function bannerFileOf(value) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) throw bad(400, 'Banner tidak valid.');
    try {
        return validateBannerUpload(value);
    } catch (error) {
        if (error?.code === 'REACTROLES_BANNER') throw bad(400, 'Banner harus gambar PNG, JPEG, WebP atau GIF paling banyak 5 MB.');
        throw error;
    }
}

const name = (value) => String(value ?? '').slice(0, 100);

function listChannels(guild) {
    const channels = [...guild.channels.cache.values()].filter((channel) => PANEL_CHANNEL_TYPES.includes(channel.type));
    channels.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || (a.id < b.id ? -1 : 1));
    return {
        truncated: channels.length > MAX_LISTED,
        // The bot's cached permissions, not a live Discord lookup.
        channels: channels.slice(0, MAX_LISTED).map((channel) => ({ id: channel.id, name: name(channel.name), usable: botCanPostIn(guild, channel) })),
    };
}

function listRoles(guild, member) {
    const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id);
    roles.sort((a, b) => (b.position ?? 0) - (a.position ?? 0) || (a.id < b.id ? -1 : 1));
    return {
        truncated: roles.length > MAX_LISTED,
        roles: roles.slice(0, MAX_LISTED).map((role) => {
            const check = checkPanelRole(guild, role);
            const mine = check.ok ? checkActorRole(guild, member, role) : check;
            return { id: role.id, name: name(role.name), usable: mine.ok, reason: mine.ok ? null : roleReason(mine.code, 'id') };
        }),
    };
}

export function createSelfRolesApi(client, { auth, csrf, audit = recordPanelChange }) {
    const router = express.Router();
    const base = '/self-roles';
    // The panel create/edit routes accept a banner image inline; everything else stays small.
    router.use(`${base}/panels`, express.json({ limit: '8mb' }));
    router.use(base, express.json({ limit: '16kb' }));
    router.use(base, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    const ready = () => {
        if (!client.isReady?.()) throw bad(503, 'Bot belum siap.');
    };
    /** The member the session belongs to. Role rules are checked against this member, so a request without one is refused. */
    const actorOf = (req) => {
        if (!req.member?.id) throw bad(403, 'Akses ditolak.');
        return req.member;
    };
    /** A line in the bot's log channel. The answer to the browser never waits for it or depends on it. */
    const record = (req, action, details) => {
        Promise.resolve()
            .then(() => audit(client, req.guild.id, action, { source: 'dashboard', actorId: req.member?.id, ...details }))
            .catch(() => {});
    };
    const panelId = (req) => {
        if (!isId(req.params.id)) throw bad(400, 'Permintaan tidak valid.');
        return req.params.id;
    };
    /** The role as the server knows it now; an id the server does not know is refused before anything else. */
    async function roleOf(guild, id) {
        const found = await resolveRole(guild, id);
        if (found.role) return found.role;
        if (found.missing) throw bad(400, 'Role itu tidak ada di server ini.');
        throw bad(502, 'Role tidak dapat diperiksa di Discord saat ini. Tidak ada yang diubah.');
    }
    const unknownResult = 'Perubahan tidak dapat diselesaikan saat ini. Muat ulang untuk melihat keadaan terbaru sebelum mencoba lagi.';

    router.get(base, auth, async (req, res) => {
        try {
            if (Object.keys(req.query).length) throw bad(400, 'Parameter tidak valid.');
            actorOf(req);
            const view = await inspectPanels(client, req.guild);
            const channels = listChannels(req.guild);
            const roles = listRoles(req.guild, actorOf(req));
            res.json({
                rejected: view.rejected,
                panels: view.panels.map((panel) => ({
                    messageId: panel.messageId,
                    channelId: panel.channelId,
                    channelName: panel.channel ? name(panel.channel.name) : null,
                    status: panel.status,
                    url: panel.url,
                    title: panel.title,
                    description: panel.description,
                    bannerUrl: panel.bannerUrl,
                    accentColor: panel.accentColor,
                    interactionType: panel.interactionType,
                    behaviorMode: panel.behaviorMode,
                    requiredRoleId: panel.requiredRoleId,
                    maxSelect: panel.maxSelect,
                    dropdownPlaceholder: panel.dropdownPlaceholder,
                    revision: panel.revision,
                    createdAt: panel.createdAt,
                    roles: panel.roleStates.map((state) => ({
                        id: state.id,
                        name: state.name === null ? null : name(state.name),
                        ok: state.ok,
                        reason: state.ok ? null : roleReason(state.reason, 'id'),
                        item: state.item,
                    })),
                })),
                channels: channels.channels,
                channelsTruncated: channels.truncated,
                roles: roles.roles,
                rolesTruncated: roles.truncated,
                limits: { panels: MAX_PANELS, roles: MAX_ROLES, title: MAX_TITLE, description: MAX_DESCRIPTION },
            });
        } catch (error) {
            respond(res, error, 'Panel tidak dapat dibaca dari database.');
        }
    });

    router.post(`${base}/panels`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'channelId', 'title', 'description', 'roleIds', 'interactionType', 'behaviorMode'],
                ['bannerUrl', 'bannerFile', 'accentColor', 'dropdownPlaceholder', 'requiredRoleId', 'maxSelect', 'items']);
            const { channelId, title, description, roleIds, interactionType, behaviorMode, bannerUrl, accentColor, dropdownPlaceholder, requiredRoleId, maxSelect } = req.body;
            if (!isId(channelId) || typeof title !== 'string' || typeof description !== 'string'
                || !Array.isArray(roleIds) || roleIds.length > MAX_ROLES || !roleIds.every(isId) || new Set(roleIds).size !== roleIds.length) {
                throw bad(400, 'Permintaan tidak valid.');
            }
            if (!['buttons', 'section_buttons', 'dropdown', 'reaction'].includes(interactionType)) throw bad(400, 'Tipe interaksi tidak valid.');
            if (!['toggle', 'unique', 'verify'].includes(behaviorMode)) throw bad(400, 'Mode perilaku tidak valid.');
            if (bannerUrl !== undefined && bannerUrl !== null) {
                if (typeof bannerUrl !== 'string' || bannerUrl.length > 2048 || (bannerUrl && !/^https:\/\//.test(bannerUrl))) throw bad(400, 'Banner URL tidak valid.');
            }
            if (accentColor !== undefined && accentColor !== null) {
                if (typeof accentColor !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(accentColor)) throw bad(400, 'Warna accent tidak valid.');
            }
            if (dropdownPlaceholder !== undefined && dropdownPlaceholder !== null && (typeof dropdownPlaceholder !== 'string' || dropdownPlaceholder.length > 100)) throw bad(400, 'Placeholder tidak valid.');
            if (requiredRoleId !== undefined && requiredRoleId !== null && requiredRoleId !== '' && !isId(requiredRoleId)) throw bad(400, 'Required role tidak valid.');
            if (maxSelect !== undefined && maxSelect !== null && (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > 25)) throw bad(400, 'Batas pilihan dropdown tidak valid.');
            const bannerFile = bannerFileOf(req.body.bannerFile);
            if (bannerFile && bannerUrl) throw bad(400, 'Pilih salah satu: unggah banner atau pakai URL.');
            // Optional detailed items (label, description, emoji, style) aligned with roleIds, or one object per role.
            let items = roleIds.map((id) => ({ roleId: id, label: null, description: null, emoji: null, buttonStyle: 'Primary' }));
            if (req.body.items !== undefined) {
                if (!Array.isArray(req.body.items)) throw bad(400, 'Permintaan tidak valid.');
                items = req.body.items
                    .filter((item) => item && typeof item === 'object')
                    .map((item) => ({ ...item, roleId: String(item.roleId ?? '') }));
                if (items.length !== roleIds.length || items.some((item) => !isId(item.roleId) || !roleIds.includes(item.roleId))) {
                    throw bad(400, 'Item tidak cocok dengan daftar role.');
                }
            }

            ready();
            actorOf(req);

            for (const item of items) {
                await roleOf(req.guild, item.roleId);
            }

            const { panel, message, bannerWarning, reactionFailures } = await createPanel(client, req.guild, {
                channel: req.guild.channels.cache.get(channelId) ?? null,
                title, description, items,
                bannerUrl: bannerUrl || null, bannerFile, accentColor, interactionType, behaviorMode,
                requiredRoleId: requiredRoleId || null, maxSelect: maxSelect || null, dropdownPlaceholder,
                actor: actorOf(req),
            });
            record(req, 'create', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title, roleIds: panel.items.map(i => i.roleId) });
            res.json({
                ok: true,
                messageId: panel.messageId,
                url: message.url ?? null,
                ...(bannerWarning ? { bannerWarning: true } : {}),
                ...(reactionFailures?.length ? { reactionFailures } : {}),
            });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.patch(`${base}/panels/:id`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision', 'title', 'description'],
                ['bannerUrl', 'bannerFile', 'bannerClear', 'accentColor', 'interactionType', 'behaviorMode', 'dropdownPlaceholder', 'requiredRoleId', 'maxSelect']);
            if (!isRevision(req.body.revision) || typeof req.body.title !== 'string' || typeof req.body.description !== 'string') throw bad(400, 'Permintaan tidak valid.');

            // Optional fields; an omitted key keeps the stored value.
            const { bannerUrl, accentColor, interactionType, behaviorMode, dropdownPlaceholder, requiredRoleId, maxSelect } = req.body;
            const bannerClear = req.body.bannerClear === true;
            if (bannerUrl !== undefined) {
                if (typeof bannerUrl !== 'string' || bannerUrl.length > 2048) throw bad(400, 'Banner URL tidak valid.');
                if (bannerUrl && !/^https:\/\//.test(bannerUrl)) throw bad(400, 'Banner URL harus memakai https://');
            }
            if (accentColor !== undefined && accentColor !== '' && (typeof accentColor !== 'string' || !/^#?[0-9a-fA-F]{6}$/.test(accentColor))) throw bad(400, 'Warna accent tidak valid.');
            if (interactionType !== undefined && !['buttons', 'section_buttons', 'dropdown', 'reaction'].includes(interactionType)) throw bad(400, 'Tipe interaksi tidak valid.');
            if (behaviorMode !== undefined && !['toggle', 'unique', 'verify'].includes(behaviorMode)) throw bad(400, 'Mode perilaku tidak valid.');
            if (dropdownPlaceholder !== undefined && (typeof dropdownPlaceholder !== 'string' || dropdownPlaceholder.length > 100)) throw bad(400, 'Placeholder tidak valid.');
            if (requiredRoleId !== undefined && requiredRoleId !== null && requiredRoleId !== '' && !isId(requiredRoleId)) throw bad(400, 'Required role tidak valid.');
            if (maxSelect !== undefined && maxSelect !== null && (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > 25)) throw bad(400, 'Batas pilihan dropdown tidak valid.');
            const bannerFile = bannerFileOf(req.body.bannerFile);
            if (bannerFile && bannerUrl) throw bad(400, 'Pilih salah satu: unggah banner atau pakai URL.');

            ready();
            actorOf(req);
            const { panel, message } = await editPanelText(client, req.guild, panelId(req), {
                title: req.body.title,
                description: req.body.description,
                // undefined keeps the stored one; '' clears it; a value sets it.
                bannerUrl: bannerUrl === undefined ? undefined : bannerUrl,
                bannerFile, bannerClear: bannerClear || undefined, accentColor: accentColor === undefined ? undefined : accentColor,
                interactionType, behaviorMode, dropdownPlaceholder,
                requiredRoleId: requiredRoleId === undefined ? undefined : (requiredRoleId || null),
                maxSelect: maxSelect === undefined ? undefined : (maxSelect || null),
                revision: req.body.revision,
            });
            record(req, 'update', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title });
            res.json({ ok: true, message: message.state });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.put(`${base}/panels/:id/items`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision', 'items']);
            if (!isRevision(req.body.revision) || !Array.isArray(req.body.items)) throw bad(400, 'Permintaan tidak valid.');
            const items = [];
            for (const raw of req.body.items) {
                if (!raw || typeof raw !== 'object' || !isId(raw.roleId)) throw bad(400, 'Item panel tidak valid.');
                if (raw.label !== undefined && raw.label !== null && (typeof raw.label !== 'string' || raw.label.length > 80)) throw bad(400, 'Label item tidak valid.');
                if (raw.description !== undefined && raw.description !== null && (typeof raw.description !== 'string' || raw.description.length > 100)) throw bad(400, 'Deskripsi item tidak valid.');
                if (raw.emoji !== undefined && raw.emoji !== null && (typeof raw.emoji !== 'string' || raw.emoji.length > 48)) throw bad(400, 'Emoji item tidak valid.');
                if (raw.buttonStyle !== undefined && !['Primary', 'Secondary', 'Success', 'Danger'].includes(raw.buttonStyle)) throw bad(400, 'Gaya tombol tidak valid.');
                items.push({ roleId: raw.roleId, label: raw.label ?? null, description: raw.description ?? null, emoji: raw.emoji ?? null, buttonStyle: raw.buttonStyle ?? 'Primary' });
            }
            ready();
            const actor = actorOf(req);
            const { panel, message } = await editPanelItems(client, req.guild, panelId(req), items, { revision: req.body.revision, actor });
            record(req, 'update', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title, roleIds: panel.items.map((item) => item.roleId) });
            res.json({ ok: true, message: message.state });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.post(`${base}/panels/:id/roles`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision', 'roleId']);
            if (!isRevision(req.body.revision) || !isId(req.body.roleId)) throw bad(400, 'Permintaan tidak valid.');
            ready();
            actorOf(req);
            const role = await roleOf(req.guild, req.body.roleId);
            const { panel, message } = await addPanelRole(client, req.guild, panelId(req), role, { revision: req.body.revision, actor: actorOf(req) });
            record(req, 'add', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title, roleId: role.id });
            res.json({ ok: true, message: message.state });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.delete(`${base}/panels/:id/roles/:roleId`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision']);
            if (!isRevision(req.body.revision) || !isId(req.params.roleId)) throw bad(400, 'Permintaan tidak valid.');
            ready();
            actorOf(req);
            const { panel, message } = await removePanelRole(client, req.guild, panelId(req), req.params.roleId, { revision: req.body.revision });
            record(req, 'remove', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title, roleId: req.params.roleId });
            res.json({ ok: true, message: message.state });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.post(`${base}/panels/:id/repost`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed']);
            ready();
            actorOf(req);
            const { panel, message, bannerLost, reactionFailures } = await repostPanel(client, req.guild, panelId(req));
            record(req, 'repost', { messageId: panel.messageId, channelId: panel.channelId, title: panel.title, roleIds: panel.items.map(i => i.roleId) });
            res.json({
                ok: true,
                messageId: panel.messageId,
                url: message.url ?? null,
                ...(bannerLost ? { bannerLost: true } : {}),
                ...(reactionFailures?.length ? { reactionFailures } : {}),
            });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.post(`${base}/panels/:id/refresh`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed']);
            ready();
            actorOf(req);
            const { message } = await refreshPanelMessage(client, req.guild, panelId(req));
            res.json({ ok: true, message: message.state });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.delete(`${base}/panels/:id`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision']);
            if (!isRevision(req.body.revision)) throw bad(400, 'Permintaan tidak valid.');
            ready();
            actorOf(req);
            const { messageDeleted, panel, title } = await deletePanel(client, req.guild, panelId(req), { revision: req.body.revision });
            record(req, 'delete', { messageId: panel.messageId, channelId: panel.channelId, title });
            res.json({ ok: true, messageDeleted });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    // Malformed or oversized JSON: answer in the API's own format, without details.
    router.use(base, (error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error?.status === 413 ? 413 : 400).json({ error: 'Permintaan tidak valid.' });
    });

    return router;
}
