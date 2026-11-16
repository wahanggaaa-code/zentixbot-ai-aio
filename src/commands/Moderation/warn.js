import { SlashCommandBuilder, PermissionsBitField, ChannelType } from 'discord.js';

import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/moderation/warningService.js';
import { ModerationService } from '../../services/moderation/moderationService.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setDescription("Warn a user")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("User to warn"),
        )
        .addStringOption((o) =>
            o
                .setName("reason")
                .setRequired(true)
                .setDescription("Reason for the warning"),
        ),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warn interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warn'
            });
            return;
        }

        const target = interaction.options.getUser("target");
        const member = interaction.options.getMember("target");
        const reason = interaction.options.getString("reason");
        const moderator = interaction.user;
        const guildId = interaction.guildId;

        if (!target) {
            throw new ZentixBotError(
                'Missing target user',
                ErrorTypes.USER_INPUT,
                'You must specify a user to warn.',
                { subtype: 'invalid_user' },
            );
        }

        if (!reason) {
            throw new ZentixBotError(
                'Missing warning reason',
                ErrorTypes.VALIDATION,
                'You must provide a reason for the warning.',
                { subtype: 'missing_required' },
            );
        }

        if (!member) {
            throw new ZentixBotError(
                "Target not found",
                ErrorTypes.USER_INPUT,
                "The target user is not currently in this server."
            );
        }

        ModerationService.assertModerationHierarchy(interaction.member, member, 'warn');

        const { id, totalCount } = await WarningService.addWarning({
            guildId,
            userId: target.id,
            moderatorId: moderator.id,
            reason,
            timestamp: Date.now()
        });

        await logModerationAction({
            client,
            guild: interaction.guild,
            event: {
                action: "User Warned",
                target: `${target.tag} (${target.id})`,
                executor: `${moderator.tag} (${moderator.id})`,
                reason,
                metadata: {
                    userId: target.id,
                    moderatorId: moderator.id,
                    totalWarns: totalCount,
                    warningNumber: totalCount,
                    warningId: id
                }
            }
        });

        await InteractionHelper.safeEditReply(interaction, {
            ...v2Message([createV2Container({ title: `⚠️ **Warned** ${target.tag}`, description: `**Reason:** ${reason}\n**Total Warns:** ${totalCount}`, color: 'success' })]),
        });
    }
};