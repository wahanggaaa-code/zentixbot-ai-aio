import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { getAllBirthdays } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const guildId = interaction.guildId;

        const sortedBirthdays = await getAllBirthdays(client, guildId);

        if (sortedBirthdays.length === 0) {
            const container = createV2Container({
                title: 'No Birthdays',
                description: 'No birthdays have been set in this server yet.',
                color: 'error',
            });
            return await InteractionHelper.safeEditReply(interaction, v2Message([container]));
        }

        const userIds = sortedBirthdays.map(b => b.userId);
        const fetchedMembers = await interaction.guild.members.fetch({ user: userIds }).catch(() => null);

        let birthdayList = '';
        let displayIndex = 0;
        const staleUserIds = [];

        for (const birthday of sortedBirthdays) {
            if (fetchedMembers && !fetchedMembers.has(birthday.userId)) {
                staleUserIds.push(birthday.userId);
                continue;
            }
            displayIndex++;
            birthdayList += `${displayIndex}. <@${birthday.userId}> - ${birthday.monthName} ${birthday.day}\n`;
        }


        if (displayIndex === 0) {
            const container = createV2Container({
                title: 'No Birthdays',
                description: 'No birthdays have been set by current server members.',
                color: 'error',
            });
            return await InteractionHelper.safeEditReply(interaction, v2Message([container]));
        }

        birthdayList = `**${displayIndex} birthday${displayIndex !== 1 ? 's' : ''} in ${interaction.guild.name}**\n\n` + birthdayList;

        const container = createV2Container({
            title: 'Server Birthdays',
            description: `${birthdayList}\n\nTotal: ${displayIndex} birthday${displayIndex !== 1 ? 's' : ''}`,
            color: 'success',
        });

        await InteractionHelper.safeEditReply(interaction, { ...v2Message([container]), allowedMentions: { parse: [] } });

        logger.info('Birthday list retrieved successfully', {
            userId: interaction.user.id,
            guildId,
            birthdayCount: displayIndex,
            unresolvedMembers: staleUserIds.length,
            commandName: 'birthday_list'
        });
    }
};