import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { getUserBirthday } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const targetUser = interaction.options.getUser("user") || interaction.user;
        const userId = targetUser.id;
        const guildId = interaction.guildId;

        const birthdayData = await getUserBirthday(client, guildId, userId);

        if (!birthdayData) {
            const container = createV2Container({
                title: 'No Birthday Found',
                description: targetUser.id === interaction.user.id
                    ? "You haven't set your birthday yet. Use `/birthday set` to add it!"
                    : `${targetUser.username} hasn't set their birthday yet.`,
                color: 'error',
            });
            return await InteractionHelper.safeEditReply(interaction, v2Message([container]));
        }

        const container = createV2Container({
            title: 'Birthday Information',
            description: `**Date:** ${birthdayData.monthName} ${birthdayData.day}\n**User:** ${targetUser.toString()}`,
            color: 'success',
        });

        await InteractionHelper.safeEditReply(interaction, { ...v2Message([container]), allowedMentions: { parse: [] } });

        logger.info('Birthday info retrieved successfully', {
            userId: interaction.user.id,
            targetUserId: targetUser.id,
            guildId,
            commandName: 'birthday_info'
        });
    }
};