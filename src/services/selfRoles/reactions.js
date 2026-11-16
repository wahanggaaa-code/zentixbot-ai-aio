// reactions.js — the classic (reaction emoji) face of a self-role panel.
//
// Unlike buttons and select menus, a reaction carries no ids: the panel is found by
// the message it is on and the item by the emoji that was pressed. Everything else —
// behavior mode, required role, hierarchy — is the same code path as the rest.

import { logger } from '../../utils/logger.js';
import { logEvent, EVENT_TYPES } from '../loggingService.js';
import { applyReactionChoice } from './manage.js';

/**
 * Handle one reaction worth on a panel message.
 * Returns true when the message is a reaction panel (handled, or deliberately ignored),
 * false when it is not a panel at all — the caller may then let other features look at the reaction.
 */
export async function handlePanelReaction(client, message, user, emoji, action) {
    if (!message?.guild || !user?.id) return false;
    // Panel messages are authored by the bot; anything else is not our business (skips a database read).
    if (message.author?.id && client.user?.id && message.author.id !== client.user.id) return false;

    let member = message.guild.members?.cache?.get?.(user.id) ?? null;
    if (!member && typeof message.guild.members?.fetch === 'function') {
        member = await message.guild.members.fetch({ user: user.id, force: false }).catch(() => null);
    }
    if (!member) {
        logger.warn(`[SELFROLES] Could not resolve member ${user.id} for panel message ${message?.id}; reaction ignored.`);
        return true;
    }

    let outcome;
    try {
        outcome = await applyReactionChoice(client, message.guild, member, message, emoji, action);
    } catch (error) {
        logger.error(`[SELFROLES] Could not apply reaction on panel message ${message?.id}:`, error);
        return true;
    }
    if (!outcome?.handled) return false;

    if (outcome.blocked === 'REQUIRED_ROLE') {
        logger.info(`[SELFROLES] User ${user.id} lacks the role required by panel ${message.id}; reaction ignored.`);
        return true;
    }
    if (outcome.ignored) return true;

    if (outcome.added?.length > 0 || outcome.removed?.length > 0) {
        try {
            await logEvent({
                client,
                guildId: message.guild.id,
                eventType: EVENT_TYPES.SELF_ROLE_UPDATE,
                data: {
                    description: `Self-role panel reaction by ${user.tag ?? user.id}`,
                    userId: user.id,
                    channelId: message.channelId,
                    fields: [
                        { name: '👤 Member', value: `${user.tag ?? user.id} (${user.id})`, inline: false },
                        ...(outcome.added.length ? [{ name: '✅ Roles Added', value: outcome.added.map((entry) => entry.name).join(', ').slice(0, 1024), inline: false }] : []),
                        ...(outcome.removed.length ? [{ name: '❌ Roles Removed', value: outcome.removed.map((entry) => entry.name).join(', ').slice(0, 1024), inline: false }] : []),
                    ],
                },
            });
        } catch (logError) {
            logger.warn('[SELFROLES] Failed to log the reaction panel change:', logError);
        }
    }
    return true;
}

