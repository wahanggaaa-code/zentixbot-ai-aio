import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ownerProfileUrl } from '../../utils/ownerContact.js';
export default {
    data: new SlashCommandBuilder()
    .setName("support")
    .setDescription("Get the link to contact the bot owner"),

  async execute(interaction) {
    try {
      // There is no support server: the contact is the bot owner's Discord profile, from OWNER_IDS.
      const ownerUrl = ownerProfileUrl();
      if (!ownerUrl) {
        return await InteractionHelper.safeReply(interaction, {
          ...v2Message([createV2Container({ title: "Need Help?", description: "The bot owner's contact has not been set up yet. Ask a server admin for help.", color: 'info' })], { ephemeral: true }),
        });
      }

      const supportButton = new ButtonBuilder()
        .setLabel("Contact the Owner")
        .setStyle(ButtonStyle.Link)
        .setURL(ownerUrl);

      const actionRow = new ActionRowBuilder().addComponents(supportButton);

      await InteractionHelper.safeReply(interaction, {
        ...v2Message([createV2Container({ title: "Need Help?", description: "Contact the bot owner on Discord for help, to report a bug, or to suggest a feature.", color: 'info' }), actionRow], { ephemeral: true }),
      });
    } catch (error) {
      logger.error('Support command error:', error);
      
      try {
        return await InteractionHelper.safeReply(interaction, {
          ...v2Message([createV2Container({ title: 'System Error', description: 'Could not display support information.', color: 'error' })], { ephemeral: true }),
        });
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  },
};