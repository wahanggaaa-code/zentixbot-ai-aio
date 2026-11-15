import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getUserLevelData, getLevelingConfig, getXpForLevel } from '../../services/leveling/leveling.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription("Check your or another user's rank and level")
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to check the rank of')
        .setRequired(false)
    )
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const levelingConfig = await getLevelingConfig(client, interaction.guildId);
    if (!levelingConfig?.enabled) {
      await InteractionHelper.safeEditReply(interaction, {
        ...v2Message([createV2Container({ description: 'The leveling system is currently disabled on this server.', color: '#f1c40f' })], { ephemeral: true }),
      });
      return;
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    if (!member) {
      throw new ZentixBotError(
        `User ${targetUser.id} not found in guild`,
        ErrorTypes.USER_INPUT,
        'Could not find the specified user in this server.'
      );
    }

    const userData = await getUserLevelData(client, interaction.guildId, targetUser.id);

    const safeUserData = {
      level: userData?.level ?? 0,
      xp: userData?.xp ?? 0,
      totalXp: userData?.totalXp ?? 0
    };

    const xpNeeded = getXpForLevel(safeUserData.level + 1);
    const progress = xpNeeded > 0 ? Math.floor((safeUserData.xp / xpNeeded) * 100) : 0;
    const progressBar = createProgressBar(progress, 20);

    const embed = createV2Container({ title: `${member.displayName}'s Rank`, color: '#2ecc71', fields: [{ name: 'Level', value: safeUserData.level.toString() }, { name: 'XP', value: `${safeUserData.xp}/${xpNeeded}` }, { name: 'Total XP', value: safeUserData.totalXp.toString() }, { name: `Progress to Level ${safeUserData.level + 1}`, value: `${progressBar} ${progress}%` }], thumbnail: member.displayAvatarURL({ dynamic: true }) });

    await InteractionHelper.safeEditReply(interaction, { ...v2Message([embed]) });
    logger.debug(`Rank checked for user ${targetUser.id} in guild ${interaction.guildId}`);
  }
};

function createProgressBar(percentage, length = 10) {
  if (percentage < 0 || percentage > 100) {
    percentage = Math.max(0, Math.min(100, percentage));
  }
  const filled = Math.round((percentage / 100) * length);
  return '█'.repeat(filled) + '░'.repeat(length - filled);
}