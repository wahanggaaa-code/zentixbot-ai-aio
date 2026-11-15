import { SlashCommandBuilder } from 'discord.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { plainText } from '../../services/searchLookup.js';

export default {
    data: new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Get detailed information about the server")
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) {
      return await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: 'This command can only be used in a server.' });
    }

    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) {
      logger.warn(`ServerInfo interaction defer failed`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'serverinfo'
      });
      return;
    }

    // The owner is one field of many; when Discord does not answer, the rest is still shown.
    const owner = await guild.fetchOwner().catch((error) => {
      logger.warn(`ServerInfo could not fetch the owner: ${error.message}`, { guildId: guild.id });
      return null;
    });
    const ownerId = owner?.id ?? owner?.user?.id ?? guild.ownerId ?? null;
    const ownerName = owner?.user?.tag ? plainText(owner.user.tag, 80) : null;
    const ownerText = [ownerName, ownerId ? `<@${ownerId}>` : null].filter(Boolean).join(" · ") || "Unknown";

    const createdTimestamp = Math.floor(guild.createdAt.getTime() / 1000);
    // Threads are cached next to channels but are not channels of the server list.
    const channelCount = guild.channels.cache.filter((channel) => !channel.isThread?.()).size;

    const container = createV2Container({
      title: `Server Info: ${plainText(guild.name, 100)}`,
      description: `Server ID: ${guild.id}`,
      thumbnail: guild.iconURL({ size: 256 }),
      fields: [
        { name: "Owner", value: ownerText, inline: true },
        { name: "Members", value: `${guild.memberCount}`, inline: true },
        { name: "Channels", value: `${channelCount}`, inline: true },
        { name: "Roles", value: `${guild.roles.cache.size}`, inline: true },
        {
          name: "Boosts",
          value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount ?? 0})`,
          inline: true,
        },
        {
          name: "Creation Date",
          value: `<t:${createdTimestamp}:R>`,
          inline: true,
        },
      ],
    });

    await InteractionHelper.safeEditReply(interaction, { ...v2Message([container]), allowedMentions: { parse: [] } });
    logger.info(`ServerInfo command executed`, {
      userId: interaction.user.id,
      guildId: guild.id,
      memberCount: guild.memberCount
    });
  },
};
