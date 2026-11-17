import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { debugLog } from '../utils/debugLog.js';
import { isHomeGuild } from '../utils/singleGuild.js';
import { handlePanelReaction } from '../services/selfRoles/reactions.js';

/** Classic self-role panels only; un-reacting on any other message is none of the bot's business here. */
export default {
    name: Events.MessageReactionRemove,
    // See messageReactionAdd: discord.js >=14.18 passes a burst object as the third argument; take the client from the tail.
    async execute(reaction, user, ...rest) {
        const client = rest.at(-1);
        try {
            if (user?.bot) return;
            if (reaction?.partial) await reaction.fetch().catch(() => {});
            if (reaction?.message?.partial) await reaction.message.fetch().catch(() => {});
            const message = reaction?.message;
            // Same identifiers the wrapper gate uses (payload guildId first).
            const guildId = message?.guildId ?? message?.guild?.id ?? null;
            if (!guildId) { debugLog('messageReactionRemove: no message guild context after fetch (partial fetch failed?)'); return; }
            if (!isHomeGuild(client, guildId)) { debugLog(`messageReactionRemove: message not in the home guild (guild=${JSON.stringify(guildId)} home=${JSON.stringify(client.homeGuildId)})`); return; }
            await handlePanelReaction(client, message, user, reaction.emoji, 'remove');
        } catch (error) {
            logger.error('messageReactionRemove:', error);
        }
    },
};
