import { SlashCommandBuilder, MessageFlags, version } from 'discord.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';
import { isBotOwner } from '../../config/bot.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Bot health summary: uptime, latency and statistics (owner only)"),

  async execute(interaction) {
    if (!isBotOwner(interaction.user.id)) {
      return InteractionHelper.safeReply(interaction, {
        ...v2Message([createV2Container({
          title: 'Owner Only',
          description: 'This command is only available to the bot owner.',
          color: 'error',
        })], { ephemeral: true }),
      });
    }

    try {
      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

      let totalSeconds = Math.floor((interaction.client.uptime ?? 0) / 1000);
      const days = Math.floor(totalSeconds / 86400);
      totalSeconds %= 86400;
      const hours = Math.floor(totalSeconds / 3600);
      totalSeconds %= 3600;
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.floor(totalSeconds % 60);

      const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;

      const startTime = interaction._commandStartTime || interaction.createdTimestamp;
      const latency = Math.max(0, Date.now() - startTime);
      const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

      const totalGuilds = interaction.client.guilds.cache.size;
      const totalMembers = interaction.client.guilds.cache.reduce(
        (acc, guild) => acc + (guild.memberCount ?? 0),
        0,
      );

      const container = createV2Container({
        title: "System Health",
        description: "Real-time performance metrics (bot owner only).",
        color: "primary",
        fields: [
          { name: "Uptime", value: `\`${uptimeStr}\`` },
          { name: "Bot Latency", value: `${latency}ms` },
          { name: "API Latency", value: `${apiLatency}ms` },
          { name: "Servers", value: `${totalGuilds}` },
          { name: "Users", value: `${totalMembers}` },
          { name: "Node.js", value: `${process.version}` },
          { name: "Discord.js", value: `v${version}` },
          {
            name: "Memory Usage",
            value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
          },
        ],
      });

      await InteractionHelper.safeEditReply(interaction, v2Message([container]));
    } catch (error) {
      logger.error('Uptime command error:', error);
      
      try {
        return await InteractionHelper.safeEditReply(interaction, v2Message([createV2Container({ title: 'System Error', description: 'Could not compute bot health information.', color: 'error' })], { ephemeral: true }));
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  },
};
