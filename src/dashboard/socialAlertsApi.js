import express from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
    createAlert, readAlerts, updateAlert, deleteAlert,
    MAX_ALERTS, MAX_CUSTOM_MESSAGE, MAX_LABEL, YOUTUBE_NOTIFY_TYPES,
} from '../services/socialAlerts/store.js';
import { readSocialAlertsSettings, writeSocialAlertsSettings } from '../services/socialAlerts/settings.js';
import { resolveYouTubeChannel, parseTwitchInput, missingPlatformKeys } from '../services/socialAlerts/platforms.js';
import { buildSocialAlertMessage } from '../services/socialAlerts/message.js';
import { deliverSocialAlert } from '../services/socialAlerts/deliver.js';
import { logger } from '../utils/logger.js';

/**
 * Social Alerts for the web dashboard.
 *
 * Reads change nothing. Writes go through the same store functions the poller uses, and the
 * Test button delivers through the same path a real alert takes — a test is a real message,
 * sent once, with mentions always suppressed. Creating a YouTube feed resolves the channel
 * against the API server-side; the client never supplies the channel id or the uploads
 * playlist itself.
 */

const MAX_LISTED = 250;
const SNOWFLAKE = /^\d{17,20}$/;
const ALERT_ID = /^sa_[a-z0-9_]{2,32}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const isId = (value) => typeof value === 'string' && SNOWFLAKE.test(value);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bad = (status, message) => Object.assign(new Error(message), { status });
const name = (value) => String(value ?? '').slice(0, 100);

const STATUS = {
    SOCIALALERTS_INVALID: 400,
    SOCIALALERTS_INPUT: 400,
    SOCIALALERTS_NOT_FOUND: 404,
    SOCIALALERTS_LIMIT: 409,
    SOCIALALERTS_DUPLICATE: 409,
    SOCIALALERTS_NO_KEY: 503,
    SOCIALALERTS_UPSTREAM: 502,
    SOCIALALERTS_UNAVAILABLE: 503,
};

function respond(res, error, fallback) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    const status = STATUS[error.code];
    if (status) {
        if (status >= 500) logger.warn(`[SOCIALALERTS] Dashboard request failed (${error.code}): ${error.cause?.message ?? error.message}`);
        return res.status(status).json({ error: error.message });
    }
    logger.warn(`[SOCIALALERTS] Dashboard request failed: ${error?.message ?? error}`);
    return res.status(503).json({ error: fallback });
}

function requireBody(body, required) {
    if (!isPlainObject(body)) throw bad(400, 'Permintaan tidak valid.');
    const keys = Object.keys(body);
    if (keys.length !== required.length || required.some((key) => !Object.hasOwn(body, key))) throw bad(400, 'Permintaan tidak valid.');
    if (body.confirmed !== true) throw bad(400, 'Konfirmasi diperlukan.');
}

/** Text channels worth posting to, with the bot's cached permission answer. */
function listChannels(guild) {
    const me = guild.members?.me;
    const channels = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement);
    channels.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || (a.id < b.id ? -1 : 1));
    const usable = (channel) => {
        if (!me || typeof channel.permissionsFor !== 'function') return false;
        const perms = channel.permissionsFor(me);
        if (!perms?.has) return false;
        return perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
    };
    return {
        truncated: channels.length > MAX_LISTED,
        channels: channels.slice(0, MAX_LISTED).map((channel) => ({ id: channel.id, name: name(channel.name), usable: usable(channel) })),
    };
}

/** Roles a mention may select: every non-@everyone role, marked with whether the bot may ping it. */
function listRoles(guild) {
    const me = guild.members?.me;
    const canManageRoles = Boolean(me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
    const roles = [...guild.roles.cache.values()].filter((role) => role.id !== guild.id);
    roles.sort((a, b) => (b.position ?? 0) - (a.position ?? 0) || (a.id < b.id ? -1 : 1));
    return {
        truncated: roles.length > MAX_LISTED,
        roles: roles.slice(0, MAX_LISTED).map((role) => ({
            id: role.id,
            name: name(role.name),
            // A role may be pinged when it is mentionable or the bot holds Manage Roles.
            usable: role.mentionable === true || canManageRoles,
        })),
    };
}

const NOTIFY_TYPES = [...YOUTUBE_NOTIFY_TYPES];

function asAccentColor(value) {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && HEX_COLOR.test(value.trim())) return value.trim().toUpperCase();
    return null;
}

function asNotifyTypes(value, platform) {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string')) return null;
    const clean = [...new Set(value.map((item) => item.trim().toLowerCase()))];
    const allowed = platform === 'twitch' ? ['live'] : NOTIFY_TYPES;
    if (clean.some((item) => !allowed.includes(item))) return null;
    return clean;
}

export function createSocialAlertsApi(client, { auth, csrf }) {
    const router = express.Router();
    const base = '/social-alerts';
    router.use(base, express.json({ limit: '16kb' }));
    router.use(base, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    const ready = () => {
        if (!client.isReady?.()) throw bad(503, 'Bot belum siap.');
    };
    /** null | 'everyone' | a snowflake of a role the bot may actually ping (mentionable, or the bot holds Manage Roles). */
    const mentionable = (guild, value) => {
        if (value === null) return true;
        if (value === 'everyone') return true;
        if (!isId(value)) return false;
        const role = guild?.roles?.cache?.get?.(value);
        if (!role) return false;
        const canManageRoles = Boolean(guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.ManageRoles));
        return role.mentionable === true || canManageRoles;
    };
    const alertId = (req) => {
        if (!ALERT_ID.test(req.params.id || '')) throw bad(400, 'Permintaan tidak valid.');
        return req.params.id;
    };
    const channelName = (guild, id) => guild?.channels?.cache?.get(id)?.name ?? null;

    router.get(base, auth, async (req, res) => {
        try {
            if (Object.keys(req.query).length) throw bad(400, 'Parameter tidak valid.');
            ready();
            const [view, settings] = await Promise.all([
                readAlerts(client, req.guild.id),
                readSocialAlertsSettings(client, req.guild.id),
            ]);
            const channels = listChannels(req.guild);
            const roles = listRoles(req.guild);
            res.json({
                settings,
                rejected: view.rejected,
                alerts: view.alerts.map((alert) => ({
                    id: alert.id,
                    platform: alert.platform,
                    label: alert.label,
                    targetChannelId: alert.targetChannelId,
                    channelName: channelName(req.guild, alert.targetChannelId),
                    mentionRoleId: alert.mentionRoleId,
                    notifyTypes: alert.notifyTypes,
                    customMessage: alert.customMessage,
                    accentColor: alert.accentColor,
                    aiSummaryEnabled: alert.aiSummaryEnabled,
                    enabled: alert.enabled,
                    isLive: alert.isLive,
                    lastCheckedAt: alert.lastCheckedAt,
                    lastError: alert.lastError,
                    createdAt: alert.createdAt,
                })),
                channels: channels.channels,
                channelsTruncated: channels.truncated,
                roles: roles.roles,
                rolesTruncated: roles.truncated,
                limits: { alerts: MAX_ALERTS, label: MAX_LABEL, customMessage: MAX_CUSTOM_MESSAGE },
                keys: {
                    youtube: missingPlatformKeys('youtube').length === 0,
                    twitch: missingPlatformKeys('twitch').length === 0,
                },
            });
        } catch (error) {
            respond(res, error, 'Social Alerts tidak dapat dibaca dari database.');
        }
    });

    router.post(`${base}/settings`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'enabled']);
            if (typeof req.body.enabled !== 'boolean') throw bad(400, 'Permintaan tidak valid.');
            ready();
            const settings = await writeSocialAlertsSettings(client, req.guild.id, req.body.enabled);
            res.json({ ok: true, settings });
        } catch (error) {
            respond(res, error, 'Pengaturan tidak dapat disimpan.');
        }
    });

    router.post(base, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'platform', 'input', 'targetChannelId', 'notifyTypes', 'customMessage', 'accentColor', 'mentionRoleId', 'aiSummaryEnabled', 'label']);
            ready();
            const { platform, input, targetChannelId, customMessage, mentionRoleId, aiSummaryEnabled, label } = req.body;
            if (!['youtube', 'twitch'].includes(platform)) throw bad(400, 'Platform tidak dikenal.');
            if (typeof input !== 'string' || !input.trim() || input.length > 200) throw bad(400, 'Input channel tidak valid.');
            if (!isId(targetChannelId)) throw bad(400, 'Channel target tidak valid.');
            const notifyTypes = asNotifyTypes(req.body.notifyTypes, platform);
            if (!notifyTypes) throw bad(400, platform === 'twitch' ? 'Twitch hanya mendukung tipe Live.' : 'Tipe konten tidak valid.');
            if (typeof customMessage !== 'string' || customMessage.length > MAX_CUSTOM_MESSAGE) throw bad(400, 'Pesan kustom terlalu panjang.');
            const accentColor = asAccentColor(req.body.accentColor);
            if (accentColor === null) throw bad(400, 'Warna tidak valid.');
            if (!mentionable(req.guild, mentionRoleId)) throw bad(400, 'Role mention tidak valid atau tidak ada di server ini.');
            if (typeof aiSummaryEnabled !== 'boolean') throw bad(400, 'Permintaan tidak valid.');
            if (label !== undefined && (typeof label !== 'string' || label.trim().length > MAX_LABEL)) throw bad(400, 'Label terlalu panjang.');

            if (!req.guild.channels?.cache?.has?.(targetChannelId)) {
                throw bad(400, 'Channel target tidak ada di server ini.');
            }

            let draft;
            if (platform === 'youtube') {
                // The API verifies the channel and hands back the uploads playlist; the client cannot pick them.
                const resolved = await resolveYouTubeChannel(input);
                draft = {
                    platform, channelId: resolved.channelId, uploadsPlaylistId: resolved.uploadsPlaylistId,
                    label: label?.trim() || resolved.label, targetChannelId, notifyTypes, customMessage,
                    accentColor: accentColor ?? undefined, mentionRoleId, aiSummaryEnabled,
                };
            } else {
                const login = parseTwitchInput(input);
                draft = {
                    platform, login,
                    label: label?.trim() || login, targetChannelId, notifyTypes, customMessage,
                    accentColor: accentColor ?? undefined, mentionRoleId, aiSummaryEnabled,
                };
            }
            const alert = await createAlert(client, req.guild.id, draft);
            res.json({ ok: true, id: alert.id, label: alert.label });
        } catch (error) {
            respond(res, error, 'Feed tidak dapat disimpan.');
        }
    });

    router.patch(`${base}/:id`, auth, csrf, async (req, res) => {
        try {
            if (!isPlainObject(req.body)) throw bad(400, 'Permintaan tidak valid.');
            if (req.body.confirmed !== true) throw bad(400, 'Konfirmasi diperlukan.');
            const allowed = new Set(['confirmed', 'targetChannelId', 'mentionRoleId', 'notifyTypes', 'customMessage', 'accentColor', 'aiSummaryEnabled', 'enabled']);
            if (Object.keys(req.body).some((key) => !allowed.has(key))) throw bad(400, 'Permintaan tidak valid.');
            ready();
            const id = alertId(req);
            const patch = {};
            if ('targetChannelId' in req.body) {
                if (!isId(req.body.targetChannelId)) throw bad(400, 'Channel target tidak valid.');
                patch.targetChannelId = req.body.targetChannelId;
            }
            if ('mentionRoleId' in req.body) {
                if (!mentionable(req.guild, req.body.mentionRoleId)) throw bad(400, 'Role mention tidak valid atau tidak ada di server ini.');
                patch.mentionRoleId = req.body.mentionRoleId;
            }
            if ('notifyTypes' in req.body) {
                // The twitch shape is enforced inside the store; here only the list shape is checked.
                const list = req.body.notifyTypes;
                if (!Array.isArray(list) || list.length === 0 || list.some((item) => typeof item !== 'string')) throw bad(400, 'Tipe konten tidak valid.');
                patch.notifyTypes = [...new Set(list.map((item) => item.trim().toLowerCase()))];
            }
            if ('customMessage' in req.body) {
                if (typeof req.body.customMessage !== 'string' || req.body.customMessage.length > MAX_CUSTOM_MESSAGE) throw bad(400, 'Pesan kustom terlalu panjang.');
                patch.customMessage = req.body.customMessage;
            }
            if ('accentColor' in req.body) {
                const accentColor = asAccentColor(req.body.accentColor);
                if (accentColor == null) throw bad(400, 'Warna tidak valid.');
                patch.accentColor = accentColor;
            }
            if ('aiSummaryEnabled' in req.body) {
                if (typeof req.body.aiSummaryEnabled !== 'boolean') throw bad(400, 'Permintaan tidak valid.');
                patch.aiSummaryEnabled = req.body.aiSummaryEnabled;
            }
            if ('enabled' in req.body) {
                if (typeof req.body.enabled !== 'boolean') throw bad(400, 'Permintaan tidak valid.');
                patch.enabled = req.body.enabled;
            }
            const alert = await updateAlert(client, req.guild.id, id, patch);
            res.json({ ok: true, id: alert.id });
        } catch (error) {
            respond(res, error, 'Perubahan tidak dapat disimpan.');
        }
    });

    router.delete(`${base}/:id`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed']);
            ready();
            const removed = await deleteAlert(client, req.guild.id, alertId(req));
            if (!removed) throw bad(404, 'Feed tidak ditemukan.');
            res.json({ ok: true });
        } catch (error) {
            respond(res, error, 'Feed tidak dapat dihapus.');
        }
    });

    router.post(`${base}/:id/test`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed']);
            ready();
            const id = alertId(req);
            const { alerts } = await readAlerts(client, req.guild.id);
            const alert = alerts.find((entry) => entry.id === id);
            if (!alert) throw bad(404, 'Feed tidak ditemukan.');
            const kind = alert.notifyTypes[0] ?? (alert.platform === 'twitch' ? 'live' : 'video');
            const url = alert.platform === 'twitch'
                ? `https://www.twitch.tv/${alert.login}`
                : `https://www.youtube.com/channel/${alert.channelId}`;
            // A test never pings: the mention rules are stripped before the message is built.
            const quiet = { ...alert, mentionRoleId: null };
            const payload = buildSocialAlertMessage({
                alert: quiet,
                event: { kind, title: 'Tes notifikasi — Social Alerts', url, thumbnail: null, creator: alert.label, game: kind === 'live' ? 'Tes' : null, viewerCount: kind === 'live' ? 0 : null },
            });
            await deliverSocialAlert(client, alert, payload);
            res.json({ ok: true });
        } catch (error) {
            respond(res, error, 'Pesan tes gagal dikirim. Periksa izin bot dan channel target.');
        }
    });

    // Malformed or oversized JSON: answer in the API's own format, without details.
    router.use(base, (error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error?.status === 413 ? 413 : 400).json({ error: 'Permintaan tidak valid.' });
    });

    return router;
}
