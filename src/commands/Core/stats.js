import { SlashCommandBuilder, version } from 'discord.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("View bot statistics"),

  async execute(interaction) {
    try {
      await InteractionHelper.safeDefer(interaction);
      
      const totalGuilds = interaction.client.guilds.cache.size;
      const totalMembers = interaction.client.guilds.cache.reduce(
        (acc, guild) => acc + guild.memberCount,
        0,
      );
      const nodeVersion = process.version;

      const container = createV2Container({
        title: "System Statistics",
        description: "Real-time performance metrics.",
        color: "primary",
        fields: [
          { name: "Servers", value: `${totalGuilds}` },
          { name: "Users", value: `${totalMembers}` },
          { name: "Node.js", value: `${nodeVersion}` },
          { name: "Discord.js", value: `v${version}` },
          {
            name: "Memory Usage",
            value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
          },
        ],
      });

      await InteractionHelper.safeEditReply(interaction, v2Message([container]));
    } catch (error) {
      logger.error('Stats command error:', error);
      return InteractionHelper.safeEditReply(interaction, {
        ...v2Message([createV2Container({ title: 'System Error', description: 'Could not fetch system statistics.', color: 'error' })], { ephemeral: true }),
      });
    }
  },
};