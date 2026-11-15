import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { ZentixBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { addLevels, getLevelingConfig } from '../../services/leveling/leveling.js';
import { syncMemberRewardRoles, describeRewardSync } from '../../services/leveling/rewardRoles.js';


import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
  data: new SlashCommandBuilder()
    .setName('leveladd')
    .setDescription('Add levels to a user')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user to add levels to')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('levels')
        .setDescription('Number of levels to add')
        .setRequired(true)
        .setMinValue(1)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const hasPermission = await checkUserPermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      'You need ManageGuild permission to use this command.'
    );
    if (!hasPermission) return;

    const levelingConfig = await getLevelingConfig(client, interaction.guildId);
    if (!levelingConfig?.enabled) {
      await InteractionHelper.safeEditReply(interaction, {
        ...v2Message([createV2Container({ description: 'The leveling system is currently disabled on this server.', color: '#f1c40f' })], { ephemeral: true }),
      });
      return;
    }

    const targetUser = interaction.options.getUser('user');
    const levelsToAdd = interaction.options.getInteger('levels');

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      throw new ZentixBotError(
        `User ${targetUser.id} not found in this guild`,
        ErrorTypes.USER_INPUT,
        'The specified user is not in this server.'
      );
    }

    const userData = await addLevels(client, interaction.guildId, targetUser.id, levelsToAdd);

    // The level is stored. Reward roles follow and cannot undo it.
    const rewardLine = describeRewardSync(
      await syncMemberRewardRoles(interaction.guild, member, userData.level, levelingConfig, { source: '/leveladd' })
    );

    await InteractionHelper.safeEditReply(interaction, {
      ...v2Message([createV2Container({ title: 'Levels Added', description: `Successfully added ${levelsToAdd} levels to ${targetUser.tag}.\n**New Level:** ${userData.level}${rewardLine ? `\n${rewardLine}` : ''}`, color: 'success' })])
    });

    logger.info(
      `[ADMIN] User ${interaction.user.tag} added ${levelsToAdd} levels to ${targetUser.tag} in guild ${interaction.guildId}`
    );
  }
};