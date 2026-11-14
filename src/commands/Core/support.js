import { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
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
          embeds: [
            createEmbed({ title: "Need Help?", description: "The bot owner's contact has not been set up yet. Ask a server admin for help." }),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const supportButton = new ButtonBuilder()
        .setLabel("Contact the Owner")
        .setStyle(ButtonStyle.Link)
        .setURL(ownerUrl);

      const actionRow = new ActionRowBuilder().addComponents(supportButton);

      await InteractionHelper.safeReply(interaction, {
        embeds: [
          createEmbed({ title: "Need Help?", description: "Contact the bot owner on Discord for help, to report a bug, or to suggest a feature." }),
        ],
        components: [actionRow],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('Support command error:', error);
      
      try {
        return await InteractionHelper.safeReply(interaction, {
          embeds: [createEmbed({ title: 'System Error', description: 'Could not display support information.', color: 'error' })],
          flags: MessageFlags.Ephemeral,
        });
      } catch (replyError) {
        logger.error('Failed to send error reply:', replyError);
      }
    }
  },
};