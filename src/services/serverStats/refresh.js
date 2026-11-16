// refresh.js — keeps the counter channel names in step with the member count.
//
// A channel name is a scarce thing to change: Discord lets a channel be renamed
// only a few times per ten minutes, and discord.js does not refuse a request
// over that limit, it holds the request until the limit ends. The old code
// renamed inline in the member join and leave handlers, so one busy minute left
// those handlers waiting for minutes with everything after the rename undone.
//
// Here a join or leave only asks for a refresh. Requests are collected, one
// refresh runs at a time per guild, a channel is renamed at most once per
// `minRenameIntervalMs`, at most one rename per channel is ever waiting, and a
// name that had to wait is applied by a later run. State is kept in memory;
// after a restart the first rename of each channel is not held back.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { logEvent, EVENT_TYPES } from '../loggingService.js';
import { formatLogLine } from '../../utils/logging/logEmbeds.js';
import { computeCounterName, computeGoalName, formatCounterChannelName, formatGoalName, getCounterTypeLabel, getRoleCounterBaseName } from '../serverstatsService.js';
import { COUNTER_TYPES, readCounters } from './store.js';
import { externalBaseName, gatherExternalCounts } from './external.js';

const UNKNOWN_CHANNEL = 10003;
// discord.js waits two minutes for a member list by default; a command or a dashboard page should not.
const MEMBER_FETCH_MS = 15_000;

export function countFor(type, stats, roleId = null) {
    if (type === 'role') return roleId ? (stats?.roleCounts?.[roleId] ?? null) : null;
    const map = {
        members: 'total', members_only: 'humans', bots: 'bots', pending: 'pending', norole: 'norole',
        channels: 'channels', text_channels: 'textChannels', voice_channels: 'voiceChannels',
        announcement_channels: 'announcementChannels', forum_channels: 'forumChannels', stage_channels: 'stageChannels',
        categories: 'categories', roles: 'roles',
        emojis: 'emojis', static_emojis: 'staticEmojis', animated_emojis: 'animatedEmojis', stickers: 'stickers',
        boosts: 'boosts', boost_tier: 'boostTier', bans: 'bans',
        connected: 'connected', online: 'online', idle: 'idle', dnd: 'dnd', offline: 'offline', streaming: 'streaming',
    };
    const key = map[type];
    return key ? (stats?.[key] ?? null) : null;
}

/**
 * The stat type a counter counts: a role counter counts its chosen role, a goal counter counts its chosen stat.
 * Everything that matches on type goes through this so bound counters cannot slip past the gates.
 */
export const statTypeOf = (counter) => (counter?.type === 'goal' ? counter.goalStat : (counter?.type === 'role' ? 'role' : counter?.type));

/** Types counted from the guild cache or from REST, no member list needed. Unknown/future param types are treated as needing the list. */
export const CACHE_ONLY_TYPES = new Set([
    'members', 'bans',
    'channels', 'text_channels', 'voice_channels', 'announcement_channels', 'forum_channels', 'stage_channels', 'categories',
    'roles', 'emojis', 'static_emojis', 'animated_emojis', 'stickers', 'boosts', 'boost_tier',
    'connected', 'online', 'idle', 'dnd', 'offline', 'streaming',
    'game', 'social',
]);
/** Whether any of `counters` requires the member list to be read. */
export const needsBots = (counters) => counters.some((counter) => !CACHE_ONLY_TYPES.has(statTypeOf(counter)));

const safeCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/**
 * Status stats from the gateway presence cache. Only available when the bot requested the Presence Intent
 * (ZENTIX_PRESENCE_INTENT=1 and approved in the Discord Developer Portal); otherwise every value is null,
 * which is what the counters and the diagnostics are supposed to say — never a made-up 0.
 * Above ~75k members Discord stops streaming presences; what the cache saw is what is counted.
 */
function presenceStats(guild) {
    const empty = { connected: null, online: null, idle: null, dnd: null, offline: null, streaming: null };
    if (process.env.ZENTIX_PRESENCE_INTENT !== '1') return empty;
    const presences = guild?.presences?.cache;
    if (!presences || typeof presences.filter !== 'function') return empty;
    try {
        const byStatus = (status) => presences.filter((presence) => presence?.status === status).size;
        const online = byStatus('online');
        const idle = byStatus('idle');
        const dnd = byStatus('dnd');
        const connected = online + idle + dnd;
        const total = safeCount(guild?.memberCount);
        // Offline from the presence cache is unreliable (invisible members are indistinguishable);
        // derive it from the member count instead. Clamped at 0 for when the cache cannot keep up.
        const offline = total !== null ? Math.max(total - connected, 0) : byStatus('offline');
        // While a member streams, Discord reports an activity of type STREAMING (1).
        const streaming = presences.filter((presence) => Array.isArray(presence?.activities)
            && presence.activities.some((activity) => activity?.type === 1)).size;
        return { connected, online, idle, dnd, offline, streaming };
    } catch {
        return empty;
    }
}

function cacheCount(guild, predicate) {
    const cache = guild?.channels?.cache;
    if (!cache || typeof cache.filter !== 'function') return null;
    try {
        return cache.filter(predicate).size;
    } catch {
        return null;
    }
}

/**
 * Everything the counters of this guild might need, in one pass. The member list is
 * fetched only when a counter needs it (or `fresh` is set); cache-only counters never
 * pay for the fetch. A count that cannot be known is null ('count_unknown' for that counter).
 */
export async function gatherCounterStats(guild, counters = [], { fresh = false } = {}) {
    const active = (counters ?? []).filter((counter) => COUNTER_TYPES.includes(counter?.type));
    const total = safeCount(guild?.memberCount);
    // `fresh` only forces the list to be read again; it is never a reason to read one
    // when no active counter needs it.
    const wantList = active.some((counter) => !CACHE_ONLY_TYPES.has(statTypeOf(counter)));

    let members = { total, bots: null, humans: null, pending: null, norole: null, roleCounts: null };
    if (wantList) {
        let list = guild?.members?.cache;
        if (fresh || total === null || !list || list.size < total) {
            try {
                list = await guild.members.fetch({ time: MEMBER_FETCH_MS });
            } catch (error) {
                logger.warn(`[SERVERSTATS] Member list of guild ${guild?.id} could not be fetched: ${error?.message ?? error}`);
                list = null;
            }
        }
        if (list && typeof list.filter === 'function') {
            const bots = list.filter((member) => member.user?.bot).size;
            const pending = list.filter((member) => member.pending === true).size;
            // Humans with no assigned role (bots are not counted as needing one).
            const norole = list.filter((member) => !member.user?.bot && member.roles?.cache
                && typeof member.roles.cache.filter === 'function'
                && member.roles.cache.filter((role) => role.id !== guild.id).size === 0).size;
            const roleCounts = {};
            for (const counter of active) {
                if (statTypeOf(counter) !== 'role' || !counter.roleId) continue;
                roleCounts[counter.roleId] = list.filter((member) => member.roles?.cache?.has?.(counter.roleId)).size;
            }
            const all = total ?? list.size;
            members = { total: all, bots, humans: Math.max(all - bots, 0), pending, norole, roleCounts };
        }
    }

    // Emojis and stickers sync over REST (GET /guilds/{id}/emojis|stickers), so they
    // are counted even when the GuildEmojisAndStickers intent is not enabled.
    let emojis = guild?.emojis?.cache ?? null;
    if (active.some((counter) => EMOJI_TYPES.has(statTypeOf(counter))) && typeof guild?.emojis?.fetch === 'function') {
        try {
            emojis = await guild.emojis.fetch();
        } catch (error) {
            logger.warn(`[SERVERSTATS] Emojis of guild ${guild?.id} could not be fetched: ${error?.message ?? error}`);
        }
    }
    let stickersCache = guild?.stickers?.cache ?? null;
    if (active.some((counter) => statTypeOf(counter) === 'stickers') && typeof guild?.stickers?.fetch === 'function') {
        try {
            stickersCache = await guild.stickers.fetch();
        } catch (error) {
            logger.warn(`[SERVERSTATS] Stickers of guild ${guild?.id} could not be fetched: ${error?.message ?? error}`);
        }
    }
    const safeCacheSize = (cache) => (cache && typeof cache.size === 'number' && Number.isSafeInteger(cache.size) ? cache.size : null);
    const emojisAll = safeCacheSize(emojis);
    const stickers = safeCacheSize(stickersCache);
    const rolesCache = guild?.roles?.cache;
    const premiumTier = Number(guild?.premiumTier);
    const stats = {
        ...members,
        ...presenceStats(guild),
        channels: cacheCount(guild, (channel) => channel.type !== ChannelType.GuildCategory),
        textChannels: cacheCount(guild, (channel) => channel.type === ChannelType.GuildText),
        voiceChannels: cacheCount(guild, (channel) => channel.type === ChannelType.GuildVoice),
        announcementChannels: cacheCount(guild, (channel) => channel.type === ChannelType.GuildAnnouncement),
        forumChannels: cacheCount(guild, (channel) => channel.type === ChannelType.GuildForum),
        stageChannels: cacheCount(guild, (channel) => channel.type === ChannelType.GuildStageVoice),
        categories: cacheCount(guild, (channel) => channel.type === ChannelType.GuildCategory),
        roles: rolesCache && typeof rolesCache.size === 'number' ? Math.max(rolesCache.size - 1, 0) : null,
        emojis: Number.isSafeInteger(emojisAll) ? emojisAll : null,
        staticEmojis: emojis && typeof emojis.filter === 'function' ? emojis.filter((emoji) => !emoji.animated).size : null,
        animatedEmojis: emojis && typeof emojis.filter === 'function' ? emojis.filter((emoji) => emoji.animated).size : null,
        stickers: Number.isSafeInteger(stickers) ? stickers : null,
        boosts: Number.isSafeInteger(guild?.premiumSubscriptionCount ?? null) ? guild.premiumSubscriptionCount : null,
        boostTier: Number.isSafeInteger(premiumTier) ? premiumTier : null,
        bans: null,
    };

    if (active.some((counter) => statTypeOf(counter) === 'bans') && typeof guild?.bans?.fetch === 'function') {
        try {
            const list = await guild.bans.fetch();
            stats.bans = Number.isSafeInteger(list?.size ?? list?.length) ? (list.size ?? list.length) : null;
        } catch (error) {
            logger.warn(`[SERVERSTATS] Ban list of guild ${guild?.id} could not be fetched: ${error?.message ?? error}`);
        }
    }
    return stats;
}

/** Emoji-related counter types, used to decide whether the emoji list needs a REST fetch. */
const EMOJI_TYPES = new Set(['emojis', 'static_emojis', 'animated_emojis']);

/** The base name for a role counter: the role's name as shown in a channel, or 'Role' when the role is gone. */
function roleBaseNameFor(guild, roleId) {
    if (!roleId) return 'Role';
    const role = guild?.roles?.cache?.get?.(roleId);
    return getRoleCounterBaseName(role?.name);
}

/** Whether the bot may rename and delete this channel. */
export function botCanManageChannel(guild, channel) {
    const me = guild.members?.me;
    if (!me || typeof channel?.permissionsFor !== 'function') return false;
    return Boolean(channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]));
}

/** Channel from the cache or from Discord. `{channel}`, `{missing: true}` (Discord says it is gone) or `{error}`. */
export async function findChannel(guild, channelId) {
    const cached = guild.channels.cache.get(channelId);
    if (cached) return { channel: cached };
    try {
        const fetched = await guild.channels.fetch(channelId);
        return fetched ? { channel: fetched } : { missing: true };
    } catch (error) {
        if (error?.code === UNKNOWN_CHANNEL) return { missing: true };
        return { error };
    }
}

export function createCounterRefresher({
    now = Date.now,
    minRenameIntervalMs = 305_000,
    debounceMs = 5_000,
    renameWaitMs = 8_000,
    audit = true,
} = {}) {
    /** channelId → { lastAt, pending, requested, result, lastCount, forceTemplate } */
    const channelState = new Map();
    /** guildId → { timer, timerAt, running, queued, fresh } */
    const guildState = new Map();
    let stopped = false;

    const ofChannel = (id) => {
        if (!channelState.has(id)) channelState.set(id, { lastAt: null, pending: null, requested: null, result: null, lastCount: null, forceTemplate: false });
        return channelState.get(id);
    };
    const ofGuild = (id) => {
        if (!guildState.has(id)) guildState.set(id, { timer: null, timerAt: 0, running: null, queued: null, fresh: false });
        return guildState.get(id);
    };

    /**
     * Whether the channel already shows `name`. Discord rewrites the name of a text channel (lower case, dashes), so
     * the name it gave back for the last request counts as showing that request.
     */
    function showsName(channel, name) {
        if (channel.name === name) return true;
        const state = channelState.get(channel.id);
        return Boolean(state && state.requested === name && state.result === channel.name);
    }

    /** Record that `channel` was created or renamed with `requested` as its name. */
    function noteName(channel, requested, count = null) {
        const state = ofChannel(channel.id);
        state.requested = requested;
        state.result = channel.name;
        if (Number.isSafeInteger(count)) state.lastCount = count;
    }

    /** The number the bot wrote in this channel last time (null when unknown, e.g. after a restart). */
    function preferredCount(channelId) {
        return channelState.get(channelId)?.lastCount ?? null;
    }

    /** The next rename of this channel writes the configured template, not the free-form name. */
    function forceTemplate(channelId) {
        ofChannel(channelId).forceTemplate = true;
    }

    function nextRenameAt(channelId) {
        const state = channelState.get(channelId);
        if (!state || state.lastAt === null) return null;
        const at = state.lastAt + minRenameIntervalMs;
        return at > now() ? at : null;
    }

    async function rename(client, guild, channel, counter, name, count) {
        const state = ofChannel(channel.id);
        if (state.pending) return { status: 'pending' };
        if (showsName(channel, name)) {
            ofChannel(channel.id).forceTemplate = false;
            return { status: 'current' };
        }
        const retryAt = nextRenameAt(channel.id);
        if (retryAt !== null) return { status: 'deferred', retryAt };
        if (!botCanManageChannel(guild, channel)) return { status: 'no_permission' };

        state.lastAt = now();
        const request = Promise.resolve()
            .then(() => channel.setName(name, 'Server stats counter'))
            .then((renamed) => {
                state.requested = name;
                state.result = (renamed ?? channel).name;
                state.forceTemplate = false;
                if (Number.isSafeInteger(count)) state.lastCount = count;
                if (audit) {
                    Promise.resolve().then(() => logEvent({
                        client,
                        guildId: guild.id,
                        eventType: EVENT_TYPES.COUNTER_UPDATE,
                        data: {
                            title: 'Counter Updated',
                            lines: [
                                formatLogLine('Type', getCounterTypeLabel(counter.type)),
                                formatLogLine('Count', String(count)),
                                formatLogLine('Channel', channel.toString()),
                            ],
                            channelId: channel.id,
                        },
                    })).catch(() => {});
                }
                return 'renamed';
            }, (error) => {
                logger.warn(`[SERVERSTATS] Counter channel ${channel.id} could not be renamed: ${error?.message ?? error}`);
                return 'failed';
            })
            .finally(() => {
                state.pending = null;
            });
        state.pending = request;

        let waitTimer;
        const slow = new Promise((resolve) => {
            waitTimer = setTimeout(() => resolve('slow'), renameWaitMs);
            waitTimer.unref?.();
        });
        const status = await Promise.race([request, slow]);
        clearTimeout(waitTimer);
        if (status === 'slow') {
            // Discord is holding the request. Look again once it is through; the count may have moved on.
            request.then(() => schedule(client, guild));
        }
        return { status };
    }

    async function refreshNow(client, guild, { fresh }) {
        const { counters, notation } = await readCounters(client, guild.id);
        const active = counters.filter((counter) => counter.enabled !== false && COUNTER_TYPES.includes(counter.type));
        if (!active.length) return [];

        const stats = await gatherCounterStats(guild, active, { fresh });
        const externalCounts = await gatherExternalCounts(active, { fresh, guildId: guild.id });
        const results = [];
        for (const counter of active) {
            const entry = { id: counter.id, type: counter.type, channelId: counter.channelId };
            const found = await findChannel(guild, counter.channelId);
            if (!found.channel) {
                results.push({ ...entry, status: found.missing ? 'missing' : 'unreachable' });
                continue;
            }
            const statType = statTypeOf(counter);
            const isExternal = counter.type === 'game' || counter.type === 'social';
            const count = isExternal
                ? (externalCounts.get(counter.id) ?? null)
                : countFor(statType, stats, counter.roleId ?? null);
            if (count === null) {
                results.push({ ...entry, status: 'count_unknown' });
                continue;
            }
            const state = channelState.get(found.channel.id);
            if (counter.type === 'goal') {
                const goal = counter.goal;
                const name = state?.forceTemplate
                    ? formatGoalName(counter.goalStat, count, goal, notation)
                    : computeGoalName(found.channel.name, count, goal, notation, counter.goalStat, preferredCount(found.channel.id)).name;
                results.push({ ...entry, count, name, ...(await rename(client, guild, found.channel, counter, name, count)) });
                continue;
            }
            const baseName = counter.type === 'role' ? roleBaseNameFor(guild, counter.roleId) : (isExternal ? externalBaseName(counter) : null);
            const name = state?.forceTemplate
                ? formatCounterChannelName(statType, count, notation, baseName)
                : computeCounterName(found.channel.name, statType, count, notation, preferredCount(found.channel.id), baseName).name;
            results.push({ ...entry, count, name, ...(await rename(client, guild, found.channel, counter, name, count)) });
        }

        const retryAt = Math.min(...results.filter((result) => result.status === 'deferred').map((result) => result.retryAt));
        if (Number.isFinite(retryAt)) schedule(client, guild, retryAt - now() + 250);
        return results;
    }

    /**
     * Refresh the counters of a guild and report what happened to each.
     * Calls made while a refresh is waiting to start share that refresh. Throws when the counters cannot be read.
     */
    function run(client, guild, { fresh = false } = {}) {
        const state = ofGuild(guild.id);
        state.fresh ||= fresh;
        if (state.queued) return state.queued;
        const queued = Promise.resolve(state.running).catch(() => {}).then(() => {
            const options = { fresh: state.fresh };
            state.fresh = false;
            state.queued = null;
            const running = refreshNow(client, guild, options).finally(() => {
                if (state.running === running) state.running = null;
            });
            state.running = running;
            return running;
        });
        state.queued = queued;
        return queued;
    }

    /** Ask for a refresh soon. Returns at once and never throws; a failure is logged. */
    function schedule(client, guild, delayMs = debounceMs) {
        if (stopped || !guild?.id) return;
        const state = ofGuild(guild.id);
        const at = now() + delayMs;
        if (state.timer) {
            if (state.timerAt <= at) return;
            clearTimeout(state.timer);
        }
        state.timerAt = at;
        state.timer = setTimeout(() => {
            state.timer = null;
            run(client, guild).catch((error) => {
                logger.warn(`[SERVERSTATS] Counter refresh failed for guild ${guild.id}: ${error?.message ?? error}`);
            });
        }, Math.max(0, delayMs));
        state.timer.unref?.();
    }

    function forgetChannel(channelId) {
        channelState.delete(channelId);
    }

    /** Cancel every timer. Renames already sent to Discord are not recalled. */
    function stop() {
        stopped = true;
        for (const state of guildState.values()) {
            if (state.timer) clearTimeout(state.timer);
            state.timer = null;
        }
    }

    /** Forget everything remembered about channels and cancel the timers, without stopping. For tests. */
    function reset() {
        for (const state of guildState.values()) {
            if (state.timer) clearTimeout(state.timer);
        }
        guildState.clear();
        channelState.clear();
    }

    return { run, schedule, showsName, noteName, nextRenameAt, forgetChannel, stop, reset, forceTemplate, minRenameIntervalMs };
}

/** The refresher used by the bot. */
export const counterRefresher = createCounterRefresher();

export const COUNTER_CHANNEL_TYPES = { voice: ChannelType.GuildVoice, text: ChannelType.GuildText };
