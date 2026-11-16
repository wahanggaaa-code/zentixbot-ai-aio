// manage.js — create, change, delete and inspect server stats counters.
//
// One entry point per action, used by the slash command, its confirm button and
// the web dashboard, so the checks and the order of effects are the same
// everywhere. Failures are thrown with a `code`; callers turn it into a message.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
    computeCounterName, computeGoalName, formatCounterChannelName, formatGoalName, getCounterBaseName, getRoleCounterBaseName,
} from '../serverstatsService.js';
import { COUNTER_TYPES, GOAL_STATS, MAX_COUNTERS, MAX_GAME_COUNTERS, MAX_GOAL, MAX_GOAL_COUNTERS, MAX_ROLE_COUNTERS, MAX_SOCIAL_COUNTERS, fail, mutateCounters, readCounters } from './store.js';
import { externalBaseName, fetchExternalCount, gatherExternalCounts, validateGameBinding, validateSocialBinding } from './external.js';
import { NOTATIONS } from './notation.js';
import {
    COUNTER_CHANNEL_TYPES, botCanManageChannel, countFor, counterRefresher, findChannel, gatherCounterStats, statTypeOf,
} from './refresh.js';

const SNOWFLAKE = /^\d{17,20}$/;
const UNKNOWN_CHANNEL = 10003;
const DELETABLE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildText];

/** Message for a failure code, in the language of the caller. Unknown codes get `fallback`. */
export const COUNTER_ERRORS = {
    SERVERSTATS_TYPE: { en: 'Unknown counter type.', id: 'Jenis counter tidak dikenal.' },
    SERVERSTATS_CHANNEL_TYPE: { en: 'Choose a voice or a text channel.', id: 'Pilih channel suara atau channel teks.' },
    SERVERSTATS_CATEGORY: { en: 'Please select a category of this server.', id: 'Pilih kategori dari server ini.' },
    SERVERSTATS_BOT_PERMISSION: {
        en: 'I need **View Channel** and **Manage Channels** there. Nothing was changed.',
        id: 'Bot membutuhkan izin View Channel dan Manage Channels di sana. Tidak ada yang diubah.',
    },
    SERVERSTATS_DUPLICATE: { en: 'A counter of that type already exists for this server.', id: 'Counter dengan jenis itu sudah ada di server ini.' },
    SERVERSTATS_LIMIT: { en: 'This server already has the maximum number of counters.', id: 'Server ini sudah memiliki jumlah counter maksimum.' },
    SERVERSTATS_MISSING: { en: 'That counter no longer exists. Use `/serverstats list` to see the counters.', id: 'Counter itu sudah tidak ada. Muat ulang halaman.' },
    SERVERSTATS_STALE: { en: 'The counters changed in the meantime. Check the list and try again.', id: 'Daftar counter berubah sejak halaman dimuat. Muat ulang, periksa, lalu ulangi.' },
    SERVERSTATS_INVALID: { en: 'The stored counter data needs to be checked before it can be changed.', id: 'Data counter tersimpan perlu diperiksa sebelum dapat diubah.' },
    SERVERSTATS_UNAVAILABLE: { en: 'The database is not available right now. Nothing was changed.', id: 'Database tidak tersedia. Tidak ada yang diubah.' },
    SERVERSTATS_CHANNEL_FAILED: {
        en: 'Discord refused the channel change. Nothing was changed.',
        id: 'Discord menolak perubahan channel. Tidak ada yang diubah.',
    },
    SERVERSTATS_CHANNEL_LEFT: {
        en: 'The counter could not be saved and the new channel could not be removed again. Please delete that channel by hand.',
        id: 'Counter gagal disimpan dan channel baru tidak dapat dihapus lagi. Hapus channel itu secara manual.',
    },
    SERVERSTATS_NOTATION: { en: 'Unknown number notation.', id: 'Format angka tidak dikenal.' },
    SERVERSTATS_ROLE_REQUIRED: { en: 'Pick a role for a role counter.', id: 'Pilih role untuk counter jenis Role tertentu.' },
    SERVERSTATS_ROLE_MISSING: { en: 'That role no longer exists on this server.', id: 'Role itu sudah tidak ada di server ini.' },
    SERVERSTATS_GOAL_STAT: { en: 'Pick which stat the goal counts.', id: 'Pilih stat yang dilacak oleh goal.' },
    SERVERSTATS_GOAL: { en: `The goal target must be a whole number between 1 and ${String(MAX_GOAL)}.`, id: `Target goal harus bilangan bulat antara 1 dan ${String(MAX_GOAL)}.` },
    SERVERSTATS_GAME: { en: 'A game counter needs a known game and a short label.', id: 'Counter game membutuhkan game yang dikenal dan label singkat.' },
    SERVERSTATS_SOCIAL: { en: 'A social counter needs a known platform and a short label.', id: 'Counter sosial membutuhkan platform yang dikenal dan label singkat.' },
};

export function counterErrorMessage(error, language, fallback) {
    return COUNTER_ERRORS[error?.code]?.[language] ?? fallback;
}

/** Exported for the setup bundle, which validates the category once before creating anything. */
export function botCanCreateIn(guild, category) {
    const me = guild.members?.me;
    if (!me || typeof category?.permissionsFor !== 'function') return false;
    return Boolean(category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels]));
}

/**
 * The stored counters next to what Discord shows. Reads only; nothing is written or renamed.
 * `count` is null when it cannot be known right now, `channel` is null when the bot does not see the channel.
 */
export async function inspectCounters(client, guild, { refresher = counterRefresher } = {}) {
    const { counters, rejected, revision, notation } = await readCounters(client, guild.id);
    const regular = counters.filter((counter) => COUNTER_TYPES.includes(counter.type) && counter.type !== 'game' && counter.type !== 'social');
    // The member list is only read when a stored counter needs it; external sources are read separately.
    const stats = await gatherCounterStats(guild, regular);
    const externalCounts = await gatherExternalCounts(counters);
    return {
        revision,
        rejected,
        notation,
        stats,
        counters: counters.map((counter) => {
            const channel = guild.channels.cache.get(counter.channelId) ?? null;
            const known = COUNTER_TYPES.includes(counter.type);
            const role = counter.type === 'role' ? guild?.roles?.cache?.get?.(counter.roleId) ?? null : null;
            const isExternal = counter.type === 'game' || counter.type === 'social';
            const baseName = counter.type === 'role' ? getRoleCounterBaseName(role?.name) : (isExternal ? externalBaseName(counter) : null);
            const statType = statTypeOf(counter);
            const count = isExternal
                ? (externalCounts.get(counter.id) ?? null)
                : (known ? countFor(statType, stats, counter.roleId ?? null) : null);
            const expectedName = count === null ? null
                : counter.type === 'goal'
                    ? computeGoalName(channel?.name ?? '', count, counter.goal, notation, counter.goalStat).name
                    : computeCounterName(channel?.name ?? '', statType, count, notation, null, baseName).name;
            return {
                ...counter,
                known,
                count,
                expectedName,
                roleName: counter.type === 'role' ? (role?.name ?? null) : undefined,
                goalStat: counter.type === 'goal' ? counter.goalStat : undefined,
                goal: counter.type === 'goal' ? counter.goal : undefined,
                game: counter.type === 'game' ? counter.game : undefined,
                social: counter.type === 'social' ? counter.social : undefined,
                channel,
                current: Boolean(channel && expectedName !== null && refresher.showsName(channel, expectedName)),
                botCanManage: channel ? botCanManageChannel(guild, channel) : null,
                nextRenameAt: refresher.nextRenameAt(counter.channelId),
            };
        }),
    };
}

/**
 * Remove the records of counters whose channel Discord reports as gone.
 * A channel that merely cannot be looked up right now keeps its record.
 */
export async function pruneMissingCounters(client, guild, { refresher = counterRefresher } = {}) {
    const { counters } = await readCounters(client, guild.id);
    const gone = [];
    for (const counter of counters) {
        const found = await findChannel(guild, counter.channelId);
        if (found.missing) gone.push(counter);
    }
    if (!gone.length) return [];

    const removed = await mutateCounters(client, guild.id, (current) => {
        const isGone = (counter) => gone.some((entry) => entry.id === counter.id && entry.channelId === counter.channelId);
        const dropped = current.filter(isGone);
        if (!dropped.length) return { write: false, result: [] };
        return { counters: current.filter((counter) => !isGone(counter)), result: dropped };
    });
    for (const counter of removed) {
        refresher.forgetChannel(counter.channelId);
        logger.info(`[SERVERSTATS] Removed counter ${counter.id} (${counter.type}) of guild ${guild.id}: channel ${counter.channelId} no longer exists`);
    }
    return removed;
}

/** The record of a channel that was just deleted in Discord, if it was a counter. */
export async function forgetDeletedCounterChannel(client, guildId, channelId, { refresher = counterRefresher } = {}) {
    const { counters } = await readCounters(client, guildId);
    if (!counters.some((counter) => counter.channelId === channelId)) return null;
    const removed = await mutateCounters(client, guildId, (current) => {
        const hit = current.find((counter) => counter.channelId === channelId);
        if (!hit) return { write: false, result: null };
        return { counters: current.filter((counter) => counter.channelId !== channelId), result: hit };
    });
    refresher.forgetChannel(channelId);
    return removed;
}

function newCounterId(existing) {
    let stamp = Date.now();
    while (existing.some((counter) => counter.id === String(stamp))) stamp += 1;
    return String(stamp);
}

/**
 * Create a counter: a new channel in `categoryId` plus its record.
 *
 * Order: checks, channel, record. When the record cannot be stored the new
 * channel is deleted again; if that fails too the error says so
 * (SERVERSTATS_CHANNEL_LEFT, with `channelId`).
 */
/** Same provider+target = same data source, so one counter per source. */
const sameGame = (counter, game) => counter.type === 'game' && counter.game
    && counter.game.provider === game.provider
    && (game.provider === 'steam'
        ? counter.game.appId === game.appId
        : counter.game.host === game.host && counter.game.port === game.port);
const sameSocial = (counter, social) => counter.type === 'social' && counter.social
    && counter.social.platform === social.platform
    && (social.platform === 'youtube' ? counter.social.channelId === social.channelId
        : social.platform === 'twitch' ? counter.social.login === social.login
            : social.platform === 'x' ? counter.social.username === social.username
                : counter.social.userId === social.userId);

export async function createCounter(client, guild, { type, channelType, categoryId, roleId = null, goalStat = null, goal = null, game = null, social = null, actor = 'unknown' }, { refresher = counterRefresher } = {}) {
    if (!COUNTER_TYPES.includes(type)) throw fail('Unknown counter type', 'SERVERSTATS_TYPE');
    // A game counter is bound to one game or server; a social counter to one account.
    let wantedGame = null;
    let wantedSocial = null;
    if (type === 'game') {
        wantedGame = validateGameBinding(game);
        if (!wantedGame) throw fail('A game counter needs a known game and a short label', 'SERVERSTATS_GAME');
    }
    if (type === 'social') {
        wantedSocial = validateSocialBinding(social);
        if (!wantedSocial) throw fail('A social counter needs a known platform and a short label', 'SERVERSTATS_SOCIAL');
    }
    // A role counter is bound to one role; every other type ignores (and stores) no role.
    const wantedRoleId = type === 'role' ? String(roleId ?? '') : null;
    let role = null;
    if (type === 'role') {
        if (!SNOWFLAKE.test(wantedRoleId ?? '')) throw fail('A role counter needs the id of a role of this server', 'SERVERSTATS_ROLE_REQUIRED');
        role = guild?.roles?.cache?.get?.(wantedRoleId) ?? null;
        if (!role) throw fail('That role does not exist on this server', 'SERVERSTATS_ROLE_MISSING');
    }
    // A goal counter is bound to one stat+target pair; every other type ignores (and stores) no goal.
    const wantedGoalStat = type === 'goal' ? String(goalStat ?? '') : null;
    const wantedGoal = type === 'goal' && goal !== undefined && goal !== null && goal !== '' ? Number(goal) : null;
    if (type === 'goal') {
        if (!GOAL_STATS.includes(wantedGoalStat ?? '')) throw fail('A goal counter needs the stat it counts', 'SERVERSTATS_GOAL_STAT');
        if (!Number.isSafeInteger(wantedGoal) || wantedGoal < 1 || wantedGoal > MAX_GOAL) throw fail('The goal target must be a whole number', 'SERVERSTATS_GOAL');
    }
    if (!Object.hasOwn(COUNTER_CHANNEL_TYPES, channelType)) throw fail('Unknown channel type', 'SERVERSTATS_CHANNEL_TYPE');
    const category = SNOWFLAKE.test(categoryId || '') ? guild.channels.cache.get(categoryId) : null;
    if (category?.type !== ChannelType.GuildCategory) throw fail('Not a category of this guild', 'SERVERSTATS_CATEGORY');
    if (!botCanCreateIn(guild, category)) throw fail('Bot cannot manage channels in the category', 'SERVERSTATS_BOT_PERMISSION');

    // A counter whose channel was deleted while the bot was away must not block a new one.
    await pruneMissingCounters(client, guild, { refresher });
    const { counters, notation } = await readCounters(client, guild.id);
    const isDuplicate = (counter) => {
        if (type === 'role') return counter.type === 'role' && counter.roleId === wantedRoleId;
        if (type === 'goal') return counter.type === 'goal' && counter.goalStat === wantedGoalStat && counter.goal === wantedGoal;
        if (type === 'game') return sameGame(counter, wantedGame);
        if (type === 'social') return sameSocial(counter, wantedSocial);
        return counter.type === type;
    };
    const duplicate = counters.find(isDuplicate);
    if (duplicate) throw fail('Counter type exists', 'SERVERSTATS_DUPLICATE', { channelId: duplicate.channelId });
    if (type === 'role' && counters.filter((counter) => counter.type === 'role').length >= MAX_ROLE_COUNTERS) {
        throw fail('Role counter limit reached', 'SERVERSTATS_LIMIT');
    }
    if (type === 'goal' && counters.filter((counter) => counter.type === 'goal').length >= MAX_GOAL_COUNTERS) {
        throw fail('Goal counter limit reached', 'SERVERSTATS_LIMIT');
    }
    if (type === 'game' && counters.filter((counter) => counter.type === 'game').length >= MAX_GAME_COUNTERS) {
        throw fail('Game counter limit reached', 'SERVERSTATS_LIMIT');
    }
    if (type === 'social' && counters.filter((counter) => counter.type === 'social').length >= MAX_SOCIAL_COUNTERS) {
        throw fail('Social counter limit reached', 'SERVERSTATS_LIMIT');
    }
    if (counters.length >= MAX_COUNTERS) throw fail('Counter limit reached', 'SERVERSTATS_LIMIT');

    const isExternal = type === 'game' || type === 'social';
    const baseName = type === 'role' ? getRoleCounterBaseName(role.name) : isExternal ? (type === 'game' ? wantedGame.label : wantedSocial.label) : null;

    // Created with its final name where the count is known: a rename right after creation would use up the rename allowance.
    let statType = type === 'goal' ? wantedGoalStat : type;
    let count = null;
    if (isExternal) {
        count = await fetchExternalCount(type === 'game' ? wantedGame : wantedSocial, type);
    } else {
        const stats = await gatherCounterStats(guild, [{ type: statType, roleId: wantedRoleId }]);
        count = countFor(statType, stats, wantedRoleId);
    }
    const requestedName = type === 'goal'
        ? (count === null ? `Goal ${getCounterBaseName(wantedGoalStat)}` : formatGoalName(wantedGoalStat, count, wantedGoal, notation))
        : count === null
            ? (baseName ?? getCounterBaseName(type))
            : formatCounterChannelName(statType, count, notation, baseName);

    let channel;
    try {
        channel = await guild.channels.create({
            name: requestedName,
            type: COUNTER_CHANNEL_TYPES[channelType],
            parent: category.id,
            reason: `Server stats counter created by ${actor}`.slice(0, 500),
        });
    } catch (error) {
        throw fail('Discord refused to create the channel', 'SERVERSTATS_CHANNEL_FAILED', { cause: error });
    }

    let counter;
    try {
        counter = await mutateCounters(client, guild.id, (current) => {
            const taken = current.find(isDuplicate);
            if (taken) throw fail('Counter type exists', 'SERVERSTATS_DUPLICATE', { channelId: taken.channelId });
            if (type === 'role' && current.filter((entry) => entry.type === 'role').length >= MAX_ROLE_COUNTERS) {
                throw fail('Role counter limit reached', 'SERVERSTATS_LIMIT');
            }
            if (type === 'goal' && current.filter((entry) => entry.type === 'goal').length >= MAX_GOAL_COUNTERS) {
                throw fail('Goal counter limit reached', 'SERVERSTATS_LIMIT');
            }
            if (type === 'game' && current.filter((entry) => entry.type === 'game').length >= MAX_GAME_COUNTERS) {
                throw fail('Game counter limit reached', 'SERVERSTATS_LIMIT');
            }
            if (type === 'social' && current.filter((entry) => entry.type === 'social').length >= MAX_SOCIAL_COUNTERS) {
                throw fail('Social counter limit reached', 'SERVERSTATS_LIMIT');
            }
            if (current.length >= MAX_COUNTERS) throw fail('Counter limit reached', 'SERVERSTATS_LIMIT');
            const created = {
                id: newCounterId(current),
                type,
                channelId: channel.id,
                guildId: guild.id,
                createdAt: new Date().toISOString(),
                enabled: true,
                ...(type === 'role' ? { roleId: wantedRoleId } : {}),
                ...(type === 'goal' ? { goalStat: wantedGoalStat, goal: wantedGoal } : {}),
                ...(type === 'game' ? { game: wantedGame } : {}),
                ...(type === 'social' ? { social: wantedSocial } : {}),
            };
            return { counters: [...current, created], result: created };
        });
    } catch (error) {
        try {
            await channel.delete('Server stats counter could not be saved');
        } catch (deleteError) {
            if (deleteError?.code !== UNKNOWN_CHANNEL) {
                logger.error(`[SERVERSTATS] Channel ${channel.id} of an unsaved counter could not be deleted:`, deleteError);
                throw fail('Counter not saved and channel left behind', 'SERVERSTATS_CHANNEL_LEFT', { channelId: channel.id, cause: error });
            }
        }
        throw error;
    }

    if (count !== null) refresher.noteName(channel, requestedName, count);
    else refresher.schedule(client, guild);
    return { counter, channel, count };
}

/**
 * Change the type of a counter and ask for its channel name to follow.
 * `revision`, when given, must match the stored list (SERVERSTATS_STALE otherwise).
 * Returns `{counter, changed, refresh}`; `refresh` is what happened to the channel name, or null when it is unknown.
 */
export async function changeCounterType(client, guild, counterId, type, { revision = null, refresher = counterRefresher } = {}) {
    if (!COUNTER_TYPES.includes(type) || type === 'role' || type === 'goal' || type === 'game' || type === 'social') throw fail('Unknown counter type', 'SERVERSTATS_TYPE');
    const outcome = await mutateCounters(client, guild.id, (current, storedRevision) => {
        if (revision !== null && revision !== storedRevision) throw fail('Counters changed', 'SERVERSTATS_STALE');
        const counter = current.find((entry) => entry.id === counterId);
        if (!counter) throw fail('Counter not found', 'SERVERSTATS_MISSING');
        if (counter.type === type) return { write: false, result: { counter, changed: false, previousType: type } };
        const taken = current.find((entry) => entry.type === type);
        if (taken) throw fail('Counter type exists', 'SERVERSTATS_DUPLICATE', { channelId: taken.channelId });
        const previousType = counter.type;
        counter.type = type;
        if (counter.type !== 'role') delete counter.roleId;
        if (counter.type !== 'goal') { delete counter.goalStat; delete counter.goal; }
        delete counter.game; delete counter.social;
        counter.updatedAt = new Date().toISOString();
        return { counters: current, result: { counter, changed: true, previousType } };
    });

    // The stored type changed, so the channel carries the new base name of the template, not the old label.
    // (Outcome is {counter, changed, previousType}; the channel id is on the stored counter.)
    if (outcome?.changed) refresher.forceTemplate?.(outcome.counter.channelId);

    let refresh = null;
    try {
        const results = await refresher.run(client, guild);
        refresh = results.find((result) => result.id === counterId) ?? null;
    } catch (error) {
        logger.warn(`[SERVERSTATS] Counter ${counterId} was changed but its channel name could not be refreshed: ${error?.message ?? error}`);
    }
    return { ...outcome, refresh };
}

/**
 * Delete a counter: its channel first, then its record.
 *
 * When Discord refuses to delete the channel nothing is changed, so the
 * counter does not vanish from the bot while its channel stays behind.
 * A channel that is not a voice or text channel is never deleted; only the
 * record goes. Returns `{counter, channelName, channelDeleted}`.
 */
export async function deleteCounter(client, guild, counterId, { actor = 'unknown', revision = null, refresher = counterRefresher } = {}) {
    const { counters, revision: storedRevision } = await readCounters(client, guild.id);
    if (revision !== null && revision !== storedRevision) throw fail('Counters changed', 'SERVERSTATS_STALE');
    const counter = counters.find((entry) => entry.id === counterId);
    if (!counter) throw fail('Counter not found', 'SERVERSTATS_MISSING');

    const found = await findChannel(guild, counter.channelId);
    if (found.error) throw fail('Channel lookup failed', 'SERVERSTATS_CHANNEL_FAILED', { cause: found.error });

    let channelDeleted = false;
    let channelKept = false;
    const channel = found.channel ?? null;
    if (channel) {
        if (!DELETABLE_TYPES.includes(channel.type)) {
            channelKept = true;
        } else {
            if (!botCanManageChannel(guild, channel)) throw fail('Bot cannot delete the channel', 'SERVERSTATS_BOT_PERMISSION');
            try {
                await channel.delete(`Server stats counter deleted by ${actor}`.slice(0, 500));
                channelDeleted = true;
            } catch (error) {
                if (error?.code !== UNKNOWN_CHANNEL) throw fail('Discord refused to delete the channel', 'SERVERSTATS_CHANNEL_FAILED', { cause: error });
            }
        }
    }

    // The channel is gone from here on. If this fails, the channel delete event and the scheduled check remove the record.
    await mutateCounters(client, guild.id, (current) => {
        const hit = current.find((entry) => entry.id === counter.id && entry.channelId === counter.channelId);
        if (!hit) return { write: false, result: null };
        return { counters: current.filter((entry) => entry !== hit), result: hit };
    });
    refresher.forgetChannel(counter.channelId);
    return { counter, channelName: channel?.name ?? null, channelDeleted, channelKept };
}

/**
 * Change how the number in the counter channels is written, for the whole guild.
 * Cosmetic and reversible; it does not touch the stored counters. Returns the notation in effect.
 */
export async function setCounterNotation(client, guildId, notation, { actor = 'unknown' } = {}) {
    if (!NOTATIONS.includes(notation)) throw fail('Unknown number notation', 'SERVERSTATS_NOTATION');
    const result = await mutateCounters(client, guildId, (counters) => ({
        counters, notation, result: { notation },
    }));
    logger.info(`[SERVERSTATS] Notation of guild ${guildId} set to ${result.notation} by ${actor}`);
    return result;
}

/** Scheduled upkeep: drop records of deleted channels, then bring every name up to date. */
export async function maintainCounters(client, guild, { refresher = counterRefresher } = {}) {
    const removed = await pruneMissingCounters(client, guild, { refresher });
    const results = await refresher.run(client, guild, { fresh: true });
    return { removed, results };
}
