import { SlashCommandBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getLeaderboard, getLevelingConfig, getXpForLevel } from '../../services/leveling/leveling.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription("Shows the server's level leaderboard")
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

    const leaderboard = await getLeaderboard(client, interaction.guildId, 10);

    if (leaderboard.length === 0) {
      throw new ZentixBotError(
        'No leaderboard data found',
        ErrorTypes.DATABASE,
        'No level data found yet. Start chatting to gain XP!'
      );
    }

    const leaderboardText = await Promise.all(
      leaderboard.map(async (user, index) => {
        try {
          const member = await interaction.guild.members.fetch(user.userId).catch(() => null);
          const userMention = member?.user.toString() || `<@${user.userId}>`;
          const xpForNextLevel = getXpForLevel(user.level + 1);

          let rankPrefix = `${index + 1}.`;
          if (index === 0) rankPrefix = '🥇';
          else if (index === 1) rankPrefix = '🥈';
          else if (index === 2) rankPrefix = '🥉';
          else rankPrefix = `**${index + 1}.**`;

          return `${rankPrefix} ${userMention} - Level ${user.level} (${user.xp}/${xpForNextLevel} XP)`;
        } catch {
          return `**${index + 1}.** Error loading user ${user.userId}`;
        }
      })
    );


    const embed = createV2Container({ title: 'Level Leaderboard', description: "Top 10 most active members in this server:", color: '#2ecc71', fields: [{ name: 'Rankings', value: leaderboardText.join('\n') }] });

    await InteractionHelper.safeEditReply(interaction, { ...v2Message([embed]) });
    logger.debug(`Leaderboard displayed for guild ${interaction.guildId}`);
  }
};