import { SlashCommandBuilder } from 'discord.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { plainText } from '../../services/searchLookup.js';
export default {
    data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Display a user's avatar image")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription(
          "The user whose avatar you want to see (defaults to you)",
        ),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser("target") || interaction.user;
    const avatarUrl = user.displayAvatarURL({ size: 2048 });

    const container = createV2Container({
      title: `${plainText(user.username, 100)}'s Avatar`,
      description: `[Download Link](${avatarUrl})`,
      image: avatarUrl,
    });

    await InteractionHelper.safeReply(interaction, v2Message([container]));
    logger.info(`Avatar command executed`, {
      userId: interaction.user.id,
      targetUserId: user.id,
      guildId: interaction.guildId
    });
  }
};