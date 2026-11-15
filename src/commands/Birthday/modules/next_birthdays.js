import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { plainText } from '../../../services/searchLookup.js';
import { getUpcomingBirthdays } from '../../../services/birthdayService.js';
import { logger } from '../../../utils/logger.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const next5 = await getUpcomingBirthdays(client, interaction.guildId, 5);

        if (next5.length === 0) {
            const container = createV2Container({
                title: 'No Birthdays Found',
                description: 'No birthdays have been set up in this server yet. Use `/birthday set` to add birthdays!',
                color: 'error',
            });
            return await InteractionHelper.safeEditReply(interaction, v2Message([container]));
        }

        let displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = '🎉 **Today!**';
            } else if (birthday.daysUntil === 1) {
                timeUntil = '📅 **Tomorrow!**';
            } else {
                timeUntil = `In ${birthday.daysUntil} day${birthday.daysUntil > 1 ? 's' : ''}`;
            }
        }

        if (displayIndex === 0) {
            const container = createV2Container({
                title: 'No Upcoming Birthdays',
                description: 'No upcoming birthdays found for current server members.',
                color: 'error',
            });
            return await InteractionHelper.safeEditReply(interaction, v2Message([container]));
        }

        let birthdayList = `🎂 **Next 5 Upcoming Birthdays**\n\nHere are the next 5 birthdays in ${interaction.guild.name}:\n\n`;
        displayIndex = 0;
        for (const birthday of next5) {
            const member = await interaction.guild.members.fetch(birthday.userId).catch(() => null);
            if (!member) {
                continue;
            }
            displayIndex++;

            let timeUntil = '';
            if (birthday.daysUntil === 0) {
                timeUntil = '🎉 **Today!**';
            } else if (birthday.daysUntil === 1) {
                timeUntil = '📅 **Tomorrow!**';
            } else {
                timeUntil = `In ${birthday.daysUntil} day${birthday.daysUntil > 1 ? 's' : ''}`;
            }

            birthdayList += `${displayIndex}. **${plainText(member.displayName, 80)}**\n<@${birthday.userId}>\n📅 **Date:** ${birthday.monthName} ${birthday.day}\n⏰ **Time:** ${timeUntil}\n\n`;
        }

        birthdayList += `Use /birthday set to add your birthday!`;

        const container = createV2Container({
            title: '🎉 Next 5 Upcoming Birthdays',
            description: birthdayList,
            color: 'success',
            raw: true,
        });

        await InteractionHelper.safeEditReply(interaction, { ...v2Message([container]), allowedMentions: { parse: [] } });

        logger.info('Next birthdays retrieved successfully', {
            userId: interaction.user.id,
            guildId: interaction.guildId,
            upcomingCount: displayIndex,
            commandName: 'next_birthdays'
        });
    }
};