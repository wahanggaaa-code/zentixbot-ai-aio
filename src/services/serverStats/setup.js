// setup.js — the one-click standard bundle.
//
// The bundle deliberately only contains counters that never need the member list,
// so setup is quick and works even before the privileged Guild Members intent is
// configured: members, channels, roles, emojis, boosts and boost tier.
// Each counter goes through createCounter, so the cap, duplicates, permission checks
// and the rename allowance behave exactly like creating them one by one.

import { ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { fail, readCounters } from './store.js';
import { createCounter, botCanCreateIn } from './manage.js';
import { COUNTER_CHANNEL_TYPES, counterRefresher } from './refresh.js';

const SNOWFLAKE = /^\d{17,20}$/;

/** The standard bundle, in creation order. Shown in the dashboard exactly as it is created. */
export const STANDARD_BUNDLE = ['members', 'channels', 'roles', 'emojis', 'boosts', 'boost_tier'];

/**
 * Create the standard counter bundle by the book: validate the category first, then create
 * one counter per missing type. Existing types are skipped, never replaced.
 * Returns per-type results: `{ results: [{ type, status, ... }], created, skipped, failed }`.
 */
export async function setupStandardCounters(client, guild, { categoryId, channelType, actor = 'unknown' } = {}, { refresher = counterRefresher } = {}) {
    if (!Object.hasOwn(COUNTER_CHANNEL_TYPES, channelType)) throw fail('Unknown channel type', 'SERVERSTATS_CHANNEL_TYPE');
    const category = SNOWFLAKE.test(categoryId || '') ? guild.channels.cache.get(categoryId) : null;
    if (category?.type !== ChannelType.GuildCategory) throw fail('Not a category of this guild', 'SERVERSTATS_CATEGORY');
    if (!botCanCreateIn(guild, category)) throw fail('Bot cannot manage channels in the category', 'SERVERSTATS_BOT_PERMISSION');

    const { counters } = await readCounters(client, guild.id);
    const taken = new Set(counters.map((counter) => counter.type));

    const results = [];
    for (const type of STANDARD_BUNDLE) {
        if (taken.has(type)) {
            const existing = counters.find((counter) => counter.type === type);
            results.push({ type, status: 'skipped', channelId: existing?.channelId ?? null });
            continue;
        }
        try {
            const { counter, channel, count } = await createCounter(client, guild, { type, channelType, categoryId, actor }, { refresher });
            taken.add(type);
            results.push({
                type,
                status: 'created',
                channelId: counter.channelId,
                channelName: typeof channel?.name === 'string' ? channel.name.slice(0, 100) : null,
                count,
            });
        } catch (error) {
            results.push({ type, status: 'failed', error: error?.code ?? 'SERVERSTATS_UNKNOWN' });
        }
    }

    // The bundle grows the very number a channels counter measures, so one settling refresh keeps the names
    // truthful (only stale names move). The scheduled refresh would fix the same thing a few minutes later.
    try {
        await refresher.run(client, guild);
    } catch (error) {
        logger.warn(`[SERVERSTATS] Setup of guild ${guild?.id}: the settling refresh failed: ${error?.message ?? error}`);
    }

    return {
        results,
        created: results.filter((result) => result.status === 'created').length,
        skipped: results.filter((result) => result.status === 'skipped').length,
        failed: results.filter((result) => result.status === 'failed').length,
    };
}
