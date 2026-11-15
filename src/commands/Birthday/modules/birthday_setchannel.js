import { PermissionsBitField } from 'discord.js';
import { createV2Container, v2Message, v2Warning } from '../../../utils/componentsV2.js';
import { getGuildConfig, setGuildConfig } from '../../../services/config/guildConfig.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

export default {
    async execute(interaction, config, client) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            const container = createV2Container({
                title: 'Permission Denied',
                description: 'You need **Manage Server** permissions to configure the birthday channel.',
                color: 'error',
            });
            return InteractionHelper.safeReply(interaction, v2Message([container], { ephemeral: true }));
        }

        try {
            const channel = interaction.options.getChannel('channel');
            const guildId = interaction.guildId;
            const guildConfig = await getGuildConfig(client, guildId);

            if (channel) {
                guildConfig.birthdayChannelId = channel.id;
                await setGuildConfig(client, guildId, guildConfig);
                const container = createV2Container({
                    title: 'Birthday Announcements Enabled',
                    description: `Birthday announcements will now be posted in ${channel}.`,
                    color: 'success',
                });
                return InteractionHelper.safeReply(interaction, { ...v2Message([container], { ephemeral: true }), allowedMentions: { parse: [] } });
            } else {
                guildConfig.birthdayChannelId = null;
                await setGuildConfig(client, guildId, guildConfig);
                const container = createV2Container({
                    title: 'Birthday Announcements Disabled',
                    description: 'No channel provided — birthday announcements have been disabled.',
                    color: 'warning',
                });
                return InteractionHelper.safeReply(interaction, v2Message([container], { ephemeral: true }));
            }
        } catch (error) {
            logger.error('birthday_setchannel error:', error);
            const container = createV2Container({
                title: '⚠️ Configuration Error',
                description: 'Could not save the birthday channel configuration.',
                color: 'error',
                raw: true,
            });
            return InteractionHelper.safeReply(interaction, v2Message([container], { ephemeral: true }));
        }
    },
};