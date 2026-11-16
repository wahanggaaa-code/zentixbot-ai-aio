// deliver.js — one canonical way to deliver a social alert payload to its target channel.
//
// Shared by the poller (real alerts) and the dashboard's Test button so a test exercises
// exactly the same path — channel resolution, permission check and Components V2 payload —
// as a live alert. Callers decide what the payload's mention rules are.

import { PermissionFlagsBits } from 'discord.js';

/**
 * Resolve the target channel (guild cache first, then Discord), verify the bot may post,
 * and send. Throws an Error with an Indonesian message when the channel cannot be used.
 */
export async function deliverSocialAlert(client, alert, payload) {
    const guild = client?.guilds?.cache?.get(client.homeGuildId);
    const cacheHit = guild?.channels?.cache?.get(alert.targetChannelId);
    const channel = cacheHit ?? await client?.channels?.fetch?.(alert.targetChannelId).catch(() => null) ?? null;
    if (!channel || typeof channel.send !== 'function') {
        throw new Error('Channel tidak tersedia atau bot tidak dapat mengaksesnya.');
    }
    const me = guild?.members?.me ?? null;
    if (me && typeof channel.permissionsFor === 'function') {
        const perms = channel.permissionsFor(me);
        if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
            throw new Error('Bot tidak punya izin View Channel / Send Messages di channel target.');
        }
    }
    return channel.send(payload);
}
