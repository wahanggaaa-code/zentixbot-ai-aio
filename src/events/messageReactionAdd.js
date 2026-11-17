import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { handlePanelReaction } from '../services/selfRoles/reactions.js';
import { debugLog } from '../utils/debugLog.js';
import { isHomeGuild } from '../utils/singleGuild.js';

/** Panel reactions first (a role for the member); flag emojis translate the message after that. */
export default {
    name: Events.MessageReactionAdd,
    // discord.js >=14.18 emits (reaction, user, burstDetails); older versions emit (reaction, user).
    // The loader always appends the client as the last argument, so take the client from the tail.
    async execute(reaction, user, ...rest) {
        const client = rest.at(-1);
        try {
            if (user?.bot) return;
            if (reaction?.partial) await reaction.fetch().catch(() => {});
            if (reaction?.message?.partial) await reaction.message.fetch().catch(() => {});
            const message = reaction?.message;
            // Compare the same identifiers the wrapper gate uses (payload guildId first):
            // in production `message.guild.id` failed a comparison the wrapper had passed.
            const guildId = message?.guildId ?? message?.guild?.id ?? null;
            if (!guildId) { debugLog('messageReactionAdd: no message guild context after fetch (partial fetch failed?)'); return; }
            if (!isHomeGuild(client, guildId)) { debugLog(`messageReactionAdd: message not in the home guild (guild=${JSON.stringify(guildId)} home=${JSON.stringify(client.homeGuildId)})`); return; }
            // A classic self-role panel claims the reaction; the translation feature must not see it.
            if (await handlePanelReaction(client, message, user, reaction.emoji, 'add')) { debugLog('messageReactionAdd: claimed by the self-role panel'); return; }
            await client.aiSmart?.translate?.handleReaction?.(message, user, reaction.emoji?.name);
        } catch (error) {
            logger.error('messageReactionAdd:', error);
        }
    },
};
