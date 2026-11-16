import { SlashCommandBuilder } from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';


export default {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a user from the server")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("The user to kick")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Reason for the kick"),
        ),
    category: "moderation",

    async execute(interaction, config, client) {
        const targetUser = interaction.options.getUser("target");
        const member = interaction.options.getMember("target");
        const reason = interaction.options.getString("reason") || "No reason provided";

        if (!targetUser) {
            throw new ZentixBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to kick.',
                { subtype: 'invalid_user' },
            );
        }

        if (targetUser.id === interaction.user.id) {
            throw new ZentixBotError(
                "Cannot kick self",
                ErrorTypes.VALIDATION,
                "You cannot kick yourself.",
            );
        }

        if (targetUser.id === client.user.id) {
            throw new ZentixBotError(
                "Cannot kick bot",
                ErrorTypes.VALIDATION,
                "You cannot kick the bot.",
            );
        }

        if (!member) {
            throw new ZentixBotError(
                "Target not found",
                ErrorTypes.USER_INPUT,
                "The target user is not currently in this server.",
                { subtype: 'user_not_found' },
            );
        }

        const result = await ModerationService.kickUser({
            guild: interaction.guild,
            member,
            moderator: interaction.member,
            reason,
        });

        await InteractionHelper.universalReply(interaction, {
            ...v2Message([createV2Container({ title: `👢 **Kicked** ${targetUser.tag}`, description: `**Reason:** ${reason}\n**Case ID:** #${result.caseId}`, color: 'success' })]),
        });
    },
};
