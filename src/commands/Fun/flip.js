import { SlashCommandBuilder } from 'discord.js';
import { v2Message, createV2Container } from '../../utils/componentsV2.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("flip")
    .setDescription("Flips a coin (Heads or Tails)."),
  category: 'Fun',

  async execute(interaction, config, client) {
    const result = Math.random() < 0.5 ? "Heads" : "Tails";
    const emoji = result === "Heads" ? "🪙" : "🔮";

    const container = createV2Container({
      title: 'Heads or Tails?',
      description: `The coin landed on... **${result}** ${emoji}!`,
      color: 'success',
      raw: true,
    });

    await InteractionHelper.safeReply(interaction, v2Message([container]));
    logger.debug(`Flip command executed by user ${interaction.user.id} in guild ${interaction.guildId}`);
  },
};