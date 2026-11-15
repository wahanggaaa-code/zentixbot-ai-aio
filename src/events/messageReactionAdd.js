import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';

/** Flag reactions (🇮🇩🇬🇧🇺🇸🇯🇵🇰🇷🇨🇳🇸🇦) translate the message into that language. Everything else is ignored. */
export default {
    name: Events.MessageReactionAdd,
    async execute(reaction, user, client) {
        try {
            if (user?.bot) return;
            if (reaction?.partial) await reaction.fetch().catch(() => {});
            if (reaction?.message?.partial) await reaction.message.fetch().catch(() => {});
            const message = reaction?.message;
            if (!message?.guild || message.guild.id !== client.homeGuildId) return;
            await client.aiSmart?.translate?.handleReaction?.(message, user, reaction.emoji?.name);
        } catch (error) {
            logger.error('messageReactionAdd:', error);
        }
    },
};
