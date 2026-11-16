import express from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { COUNTER_TYPE_CONFIG } from '../services/serverstatsService.js';
import {
    changeCounterType, counterErrorMessage, createCounter, deleteCounter, inspectCounters, setCounterNotation,
} from '../services/serverStats/manage.js';
import { setupStandardCounters } from '../services/serverStats/setup.js';
import { diagnoseCounters } from '../services/serverStats/diagnose.js';
import { NOTATIONS } from '../services/serverStats/notation.js';
import { COUNTER_TYPES, GOAL_STATS, MAX_COUNTERS, MAX_GAME_COUNTERS, MAX_GOAL, MAX_GOAL_COUNTERS, MAX_ROLE_COUNTERS, MAX_SOCIAL_COUNTERS } from '../services/serverStats/store.js';
import { missingSocialKeys } from '../services/serverStats/external.js';
import { logger } from '../utils/logger.js';

/**
 * Server stats counters for the web dashboard.
 *
 * Unlike most settings pages this one acts on Discord: creating a counter
 * creates a channel and deleting a counter deletes its channel. Every change
 * goes through the same service functions, so the checks and the order of
 * effects are the same everywhere. Reading changes nothing.
 */

const MAX_LISTED_CATEGORIES = 200;
const isId = (value) => typeof value === 'string' && /^\d{17,20}$/.test(value);
const isCounterId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
const isRevision = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bad = (status, message) => Object.assign(new Error(message), { status });

const STATUS = {
    SERVERSTATS_TYPE: 400,
    SERVERSTATS_CHANNEL_TYPE: 400,
    SERVERSTATS_CATEGORY: 400,
    SERVERSTATS_BOT_PERMISSION: 409,
    SERVERSTATS_DUPLICATE: 409,
    SERVERSTATS_LIMIT: 409,
    SERVERSTATS_MISSING: 404,
    SERVERSTATS_STALE: 409,
    SERVERSTATS_INVALID: 409,
    SERVERSTATS_UNAVAILABLE: 503,
    SERVERSTATS_CHANNEL_FAILED: 502,
    SERVERSTATS_CHANNEL_LEFT: 500,
    SERVERSTATS_NOTATION: 400,
    SERVERSTATS_ROLE_REQUIRED: 400,
    SERVERSTATS_ROLE_MISSING: 400,
    SERVERSTATS_GOAL_STAT: 400,
    SERVERSTATS_GOAL: 400,
    SERVERSTATS_GAME: 400,
    SERVERSTATS_SOCIAL: 400,
};

function respond(res, error, fallback) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    const status = STATUS[error.code];
    if (status) {
        if (status >= 500) logger.warn(`[SERVERSTATS] Dashboard request failed (${error.code}): ${error.cause?.message ?? error.message}`);
        const body = { error: counterErrorMessage(error, 'id', fallback) };
        if (error.code === 'SERVERSTATS_CHANNEL_LEFT') body.channelId = error.channelId;
        return res.status(status).json(body);
    }
    // Includes a lost COMMIT response: the change may or may not be stored.
    logger.warn(`[SERVERSTATS] Dashboard request failed: ${error?.message ?? error}`);
    return res.status(503).json({ error: fallback });
}

function requireBody(body, required) {
    if (!isPlainObject(body)) throw bad(400, 'Permintaan tidak valid.');
    const keys = Object.keys(body);
    if (keys.length !== required.length || required.some((key) => !Object.hasOwn(body, key))) throw bad(400, 'Permintaan tidak valid.');
    if (body.confirmed !== true) throw bad(400, 'Konfirmasi diperlukan.');
}

function listCategories(guild) {
    const me = guild.members?.me;
    const categories = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory);
    categories.sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || (a.id < b.id ? -1 : 1));
    return {
        truncated: categories.length > MAX_LISTED_CATEGORIES,
        categories: categories.slice(0, MAX_LISTED_CATEGORIES).map((category) => ({
            id: category.id,
            name: String(category.name ?? '').slice(0, 100),
            // The bot's cached permissions, not a live Discord lookup.
            usable: Boolean(me && category.permissionsFor?.(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])),
        })),
    };
}

const channelKind = (channel) => (channel?.type === ChannelType.GuildVoice ? 'voice' : channel?.type === ChannelType.GuildText ? 'text' : null);

function refreshView(refresh) {
    if (!refresh) return { status: 'unknown', retryAt: null };
    return { status: refresh.status, retryAt: refresh.status === 'deferred' ? refresh.retryAt : null };
}

export function createServerStatsApi(client, { auth, csrf }) {
    const router = express.Router();
    const base = '/server-stats';
    router.use(base, express.json({ limit: '2kb' }));
    router.use(base, (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    const actor = (req) => `${String(req.session?.user?.username ?? 'dashboard').slice(0, 60)} (${req.session?.user?.id ?? req.member?.id ?? 'unknown'}) via dashboard`;
    const ready = () => {
        if (!client.isReady?.()) throw bad(503, 'Bot belum siap.');
    };

    router.get(base, auth, async (req, res) => {
        try {
            if (Object.keys(req.query).length) throw bad(400, 'Parameter tidak valid.');
            const view = await inspectCounters(client, req.guild);
            const { categories, truncated } = listCategories(req.guild);
            res.json({
                revision: view.revision,
                rejected: view.rejected,
                notation: view.notation,
                notations: NOTATIONS,
                counters: view.counters.map((counter) => ({
                    id: counter.id,
                    type: counter.type,
                    known: counter.known,
                    enabled: counter.enabled !== false,
                    channelId: counter.channelId,
                    // The bot's cache: null means the bot does not see the channel right now.
                    channelName: counter.channel ? String(counter.channel.name ?? '').slice(0, 100) : null,
                    channelType: channelKind(counter.channel),
                    count: counter.count,
                    expectedName: counter.expectedName,
                    current: counter.current,
                    botCanManage: counter.botCanManage,
                    nextRenameAt: counter.nextRenameAt,
                    createdAt: counter.createdAt,
                    roleName: counter.type === 'role' ? (counter.roleName ?? null) : undefined,
                    goalStat: counter.type === 'goal' ? (counter.goalStat ?? null) : undefined,
                    goal: counter.type === 'goal' ? (counter.goal ?? null) : undefined,
                    game: counter.type === 'game' ? (counter.game ?? null) : undefined,
                    social: counter.type === 'social' ? (counter.social ?? null) : undefined,
                })),
                types: COUNTER_TYPES.map((type) => ({
                    id: type,
                    label: COUNTER_TYPE_CONFIG[type].label,
                    taken: (type === 'role' || type === 'goal' || type === 'game' || type === 'social')
                        ? false   // role, goal, game and social counters keep their own slots
                        : view.counters.some((counter) => counter.type === type),
                })),
                external: {
                    gameProviders: [
                        { id: 'steam', label: 'Steam (pemain online game ini)', needsKeys: [] },
                        { id: 'minecraft', label: 'Minecraft Java (pemain di server)', needsKeys: [] },
                        { id: 'fivem', label: 'FXServer/FiveM (pemain di server)', needsKeys: [] },
                    ],
                    socialPlatforms: [
                        { id: 'youtube', label: 'YouTube (subscribers)', needsKeys: ['YOUTUBE_API_KEY'] },
                        { id: 'twitch', label: 'Twitch (followers)', needsKeys: ['TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET'] },
                        { id: 'x', label: 'X / Twitter (followers)', needsKeys: ['X_BEARER_TOKEN'] },
                        { id: 'instagram', label: 'Instagram bisnis (followers)', needsKeys: ['INSTAGRAM_ACCESS_TOKEN'] },
                    ],
                    // Which owner-wide keys from .env are present right now — the page shows what is missing, never the values.
                    keysPresent: Object.fromEntries(['YOUTUBE_API_KEY', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'X_BEARER_TOKEN', 'INSTAGRAM_ACCESS_TOKEN']
                        .map((name) => [name, Boolean(process.env[name]?.trim())])),
                    missing: {
                        youtube: missingSocialKeys('youtube'),
                        twitch: missingSocialKeys('twitch'),
                        x: missingSocialKeys('x'),
                        instagram: missingSocialKeys('instagram'),
                    },
                },
                goalStats: GOAL_STATS.map((type) => ({ id: type, label: COUNTER_TYPE_CONFIG[type].label })),
                roles: [...(req.guild.roles?.cache?.values?.() ?? [])]
                    .filter((role) => role.id !== req.guild.id)
                    .slice(0, 250)
                    .map((role) => ({ id: String(role.id), name: String(role.name ?? '').slice(0, 100), managed: Boolean(role.managed) })),
                categories,
                categoriesTruncated: truncated,
                limits: { counters: MAX_COUNTERS, roleCounters: MAX_ROLE_COUNTERS, goalCounters: MAX_GOAL_COUNTERS, gameCounters: MAX_GAME_COUNTERS, socialCounters: MAX_SOCIAL_COUNTERS },
            });
        } catch (error) {
            respond(res, error, 'Counter tidak dapat dibaca dari database.');
        }
    });

    const unknownResult = 'Perubahan tidak dapat diselesaikan saat ini. Muat ulang untuk melihat keadaan terbaru sebelum mencoba lagi.';

    router.post(`${base}/counters`, auth, csrf, async (req, res) => {
        try {
            if (!isPlainObject(req.body)) throw bad(400, 'Permintaan tidak valid.');
            const ALLOWED_KEYS = ['confirmed', 'type', 'channelType', 'categoryId', 'roleId', 'goalStat', 'goal',
                'label', 'provider', 'appId', 'host', 'port', 'platform', 'channelId', 'login', 'username', 'userId'];
            const keys = Object.keys(req.body);
            if (!['confirmed', 'type', 'channelType', 'categoryId'].every((key) => keys.includes(key))
                || keys.some((key) => !ALLOWED_KEYS.includes(key))) {
                throw bad(400, 'Permintaan tidak valid.');
            }
            if (req.body.confirmed !== true) throw bad(400, 'Konfirmasi diperlukan.');
            if (typeof req.body.type !== 'string' || typeof req.body.channelType !== 'string' || !isId(req.body.categoryId)) {
                throw bad(400, 'Permintaan tidak valid.');
            }
            const roleId = req.body.roleId === undefined ? null : String(req.body.roleId);
            if (roleId !== null && !isId(roleId)) throw bad(400, 'Permintaan tidak valid.');
            // A role is only meaningful for a role counter; a stray roleId on anything else is refused, not ignored.
            if (roleId !== null && req.body.type !== 'role') throw bad(400, 'Permintaan tidak valid.');
            // Game and social counters carry their own binding; nothing else belongs to them.
            const gameKeys = ['provider', 'appId', 'host', 'port'];
            const socialKeys = ['platform', 'channelId', 'login', 'username', 'userId'];
            const hasGame = keys.some((key) => gameKeys.includes(key));
            const hasSocial = keys.some((key) => socialKeys.includes(key));
            const hasLabel = keys.includes('label');
            if (hasGame && req.body.type !== 'game') throw bad(400, 'Permintaan tidak valid.');
            if (hasSocial && req.body.type !== 'social') throw bad(400, 'Permintaan tidak valid.');
            if (hasLabel && req.body.type !== 'game' && req.body.type !== 'social') throw bad(400, 'Permintaan tidak valid.');
            if (req.body.type === 'game' && hasSocial) throw bad(400, 'Permintaan tidak valid.');
            if (req.body.type === 'social' && hasGame) throw bad(400, 'Permintaan tidak valid.');
            if (hasGame && req.body.type === 'game') {
                if (typeof req.body.provider !== 'string' || !['steam', 'minecraft', 'fivem'].includes(req.body.provider)) throw bad(400, 'Permintaan tidak valid.');
                if (typeof req.body.label !== 'string') throw bad(400, 'Permintaan tidak valid.');
                if (req.body.provider === 'steam') {
                    if (typeof req.body.appId !== 'number' || req.body.host !== undefined || req.body.port !== undefined) throw bad(400, 'Permintaan tidak valid.');
                } else {
                    if (typeof req.body.host !== 'string' || req.body.appId !== undefined) throw bad(400, 'Permintaan tidak valid.');
                    if (req.body.port !== undefined && (typeof req.body.port !== 'number' || !Number.isSafeInteger(req.body.port) || req.body.port < 1 || req.body.port > 65535)) throw bad(400, 'Permintaan tidak valid.');
                }
            }
            if (hasSocial && req.body.type === 'social') {
                if (typeof req.body.platform !== 'string' || !['youtube', 'twitch', 'x', 'instagram'].includes(req.body.platform)) throw bad(400, 'Permintaan tidak valid.');
                if (typeof req.body.label !== 'string') throw bad(400, 'Permintaan tidak valid.');
                const platformKeys = { youtube: 'channelId', twitch: 'login', x: 'username', instagram: 'userId' };
                const wantedKey = platformKeys[req.body.platform];
                const forbidden = Object.values(platformKeys).filter((key) => key !== wantedKey);
                if (typeof req.body[wantedKey] !== 'string') throw bad(400, 'Permintaan tidak valid.');
                if (forbidden.some((key) => req.body[key] !== undefined)) throw bad(400, 'Permintaan tidak valid.');
            }
            if ((req.body.type === 'game' || req.body.type === 'social') && (!hasGame && req.body.type === 'game' || !hasSocial && req.body.type === 'social')) {
                throw bad(400, 'Permintaan tidak valid.');
            }
            const goalStat = req.body.goalStat === undefined ? null : String(req.body.goalStat);
            const goal = req.body.goal === undefined ? null : req.body.goal;
            const hasGoal = req.body.goalStat !== undefined || req.body.goal !== undefined;
            if (hasGoal !== (req.body.type === 'goal')) throw bad(400, 'Permintaan tidak valid.');
            if (req.body.type === 'goal') {
                if (typeof req.body.goalStat !== 'string' || !GOAL_STATS.includes(goalStat ?? '')) throw bad(400, 'Permintaan tidak valid.');
                // The target must be a JSON number; a string that merely parses as one is refused.
                if (typeof req.body.goal !== 'number' || !Number.isSafeInteger(goal) || goal < 1 || goal > MAX_GOAL) throw bad(400, 'Permintaan tidak valid.');
            }
            const game = req.body.type === 'game'
                ? { provider: req.body.provider, label: req.body.label, appId: req.body.appId, host: req.body.host, port: req.body.port }
                : null;
            const social = req.body.type === 'social'
                ? { platform: req.body.platform, label: req.body.label, channelId: req.body.channelId, login: req.body.login, username: req.body.username, userId: req.body.userId }
                : null;
            ready();
            const { counter, channel, count } = await createCounter(client, req.guild, {
                type: req.body.type,
                channelType: req.body.channelType,
                categoryId: req.body.categoryId,
                roleId,
                goalStat,
                goal,
                game,
                social,
                actor: actor(req),
            });
            res.json({
                ok: true,
                id: counter.id,
                channelId: channel.id,
                channelName: String(channel.name ?? '').slice(0, 100),
                count,
                roleName: counter.type === 'role' ? String((req.guild.roles?.cache?.get?.(counter.roleId)?.name ?? '')).slice(0, 100) : undefined,
                goalStat: counter.type === 'goal' ? counter.goalStat : undefined,
                goal: counter.type === 'goal' ? counter.goal : undefined,
                game: counter.type === 'game' ? counter.game : undefined,
                social: counter.type === 'social' ? counter.social : undefined,
            });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.post(`${base}/setup`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'categoryId', 'channelType']);
            if (!isId(req.body.categoryId) || typeof req.body.channelType !== 'string') throw bad(400, 'Permintaan tidak valid.');
            ready();
            const outcome = await setupStandardCounters(client, req.guild, {
                categoryId: req.body.categoryId,
                channelType: req.body.channelType,
                actor: actor(req),
            });
            res.json({ ok: true, created: outcome.created, skipped: outcome.skipped, failed: outcome.failed, results: outcome.results });
        } catch (error) {
            respond(res, error, 'Setup standar tidak dapat diselesaikan saat ini.');
        }
    });

    router.get(`${base}/check`, auth, async (req, res) => {
        try {
            if (Object.keys(req.query).length) throw bad(400, 'Parameter tidak valid.');
            ready();
            const report = await diagnoseCounters(client, req.guild);
            res.json({
                ok: report.ok,
                rejected: report.rejected,
                notation: report.notation,
                memberList: report.memberList,
                renamePending: report.renamePending,
                checked: report.checked,
                counters: report.counters.map((counter) => ({
                    id: counter.id,
                    type: counter.type,
                    channelId: counter.channelId,
                    level: counter.level,
                    issue: counter.issue,
                    text: counter.text,
                    ...(counter.nextRenameAt ? { nextRenameAt: counter.nextRenameAt } : {}),
                })),
            });
        } catch (error) {
            respond(res, error, 'Diagnostik tidak dapat diselesaikan saat ini.');
        }
    });

    router.patch(`${base}/counters/:id`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision', 'type']);
            if (!isCounterId(req.params.id) || !isRevision(req.body.revision) || typeof req.body.type !== 'string') throw bad(400, 'Permintaan tidak valid.');
            ready();
            const { changed, refresh } = await changeCounterType(client, req.guild, req.params.id, req.body.type, { revision: req.body.revision });
            res.json({ ok: true, changed, refresh: refreshView(refresh) });
        } catch (error) {
            respond(res, error, unknownResult);
        }
    });

    router.put(`${base}/notation`, auth, csrf, async (req, res) => {
        try {
            if (!isPlainObject(req.body) || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'notation')
                || typeof req.body.notation !== 'string') {
                throw bad(400, 'Permintaan tidak valid.');
            }
            ready();
            const { notation } = await setCounterNotation(client, req.guild.id, req.body.notation, { actor: actor(req) });
            res.json({ ok: true, notation });
        } catch (error) {
            respond(res, error, 'Format angka tidak dapat disimpan saat ini.');
        }
    });

    router.delete(`${base}/counters/:id`, auth, csrf, async (req, res) => {
        try {
            requireBody(req.body, ['confirmed', 'revision']);
            if (!isCounterId(req.params.id) || !isRevision(req.body.revision)) throw bad(400, 'Permintaan tidak valid.');
            ready();
            const { channelDeleted, channelKept } = await deleteCounter(client, req.guild, req.params.id, { revision: req.body.revision, actor: actor(req) });
            res.json({ ok: true, channelDeleted, channelKept });
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
