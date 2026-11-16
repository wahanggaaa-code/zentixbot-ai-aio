import { SlashCommandBuilder, PermissionsBitField, ChannelType } from 'discord.js';

import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/validation.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a direct message to a user (Staff only)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send a DM to")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The message to send")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(false)
        )
        .setDMPermission(false),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm'
            });
            return;
        }

    const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const anonymous = interaction.options.getBoolean("anonymous") || false;

        try {
            
            if (message.length > 2000) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Messages must be under 2000 characters.' });
            }

            if (targetUser.bot) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'You cannot send DMs to bot accounts.' });
            }

            const sanitized = sanitizeMarkdown(message);

            const dmChannel = await targetUser.createDM();
            
            await dmChannel.send({
                ...v2Message([createV2Container({ title: anonymous ? "Message from the Staff Team" : `Message from ${interaction.user.tag}`, description: sanitized, color: 'success', footer: { text: `You cannot reply to this message. | Logger ID: ${interaction.id}`, always: true } })])
            });

            await logEvent({
                client: interaction.client,
                guild: interaction.guild,
                event: {
                    action: "DM Sent",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `Anonymous: ${anonymous ? 'Yes' : 'No'}`,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                        anonymous,
                        messageLength: sanitized.length
                    }
                }
            });

            return await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([createV2Container({ title: "DM Sent", description: `Successfully sent a message to ${targetUser.tag}`, color: 'success' })]),
            });
        } catch (error) {
            logger.error('DM command error:', error);
            
if (error.code === 50007) {
                return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Could not send a DM to ${targetUser.tag}. They may have DMs disabled.` });
            }
            
            return await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: `Failed to send DM: ${error.message}` });
        }
    }
};