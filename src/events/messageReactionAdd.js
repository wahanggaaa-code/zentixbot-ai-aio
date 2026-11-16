import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { handlePanelReaction } from '../services/selfRoles/reactions.js';

/** Panel reactions first (a role for the member); flag emojis translate the message after that. */
export default {
    name: Events.MessageReactionAdd,
    async execute(reaction, user, client) {
        try {
            if (user?.bot) return;
            if (reaction?.partial) await reaction.fetch().catch(() => {});
            if (reaction?.message?.partial) await reaction.message.fetch().catch(() => {});
            const message = reaction?.message;
            if (!message?.guild || message.guild.id !== client.homeGuildId) return;
            // A classic self-role panel claims the reaction; the translation feature must not see it.
            if (await handlePanelReaction(client, message, user, reaction.emoji, 'add')) return;
            await client.aiSmart?.translate?.handleReaction?.(message, user, reaction.emoji?.name);
        } catch (error) {
            logger.error('messageReactionAdd:', error);
        }
    },
};
