import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { handlePanelReaction } from '../services/selfRoles/reactions.js';

/** Classic self-role panels only; un-reacting on any other message is none of the bot's business here. */
export default {
    name: Events.MessageReactionRemove,
    async execute(reaction, user, client) {
        try {
            if (user?.bot) return;
            if (reaction?.partial) await reaction.fetch().catch(() => {});
            if (reaction?.message?.partial) await reaction.message.fetch().catch(() => {});
            const message = reaction?.message;
            if (!message?.guild || message.guild.id !== client.homeGuildId) return;
            await handlePanelReaction(client, message, user, reaction.emoji, 'remove');
        } catch (error) {
            logger.error('messageReactionRemove:', error);
        }
    },
};
