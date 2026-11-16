import { SlashCommandBuilder } from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';


export default {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from the server")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to ban")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for the ban"),
        ),
    category: "moderation",

    async execute(interaction, config, client) {
        const user = interaction.options.getUser("target");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!user) {
            throw new ZentixBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to ban.',
                { subtype: 'invalid_user' },
            );
        }

        if (user.id === interaction.user.id) {
            throw new ZentixBotError(
                'Cannot ban self',
                ErrorTypes.VALIDATION,
                'You cannot ban yourself.',
            );
        }
        if (user.id === client.user.id) {
            throw new ZentixBotError(
                'Cannot ban bot',
                ErrorTypes.VALIDATION,
                'You cannot ban the bot.',
            );
        }

        const result = await ModerationService.banUser({
            guild: interaction.guild,
            user,
            moderator: interaction.member,
            reason,
        });

        await InteractionHelper.universalReply(interaction, {
            ...v2Message([createV2Container({ title: `🚫 **Banned** ${user.tag}`, description: `**Reason:** ${reason}\n**Case ID:** #${result.caseId}`, color: 'success' })]),
        });
    },
};
