import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { v2Info, v2Success, v2Message } from '../../utils/componentsV2.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { verifyUser } from '../../services/verificationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify yourself and gain access to the server'),

    async execute(interaction, config, client) {
        const guild = interaction.guild;

        const result = await verifyUser(client, guild.id, interaction.user.id, {
            source: 'command_self',
            moderatorId: null
        });

        if (result.status === 'already_verified') {
            return await InteractionHelper.safeReply(interaction, v2Message([v2Info('Already Verified', "You are already verified.")], { ephemeral: true }));
        }

        await InteractionHelper.safeReply(interaction, v2Message([v2Success(
            "Verification Complete",
            `You have been verified and given the **${result.roleName}** role! Welcome to the server!`
        )], { ephemeral: true }));
    }
};
