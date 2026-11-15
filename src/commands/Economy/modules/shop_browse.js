import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { shopItems } from '../../../config/shop/items.js';
import { logger } from '../../../utils/logger.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';

export default {
    async execute(interaction, config, client) {
        try {
            const TARGET_MAX_PAGES = 3;
            const ITEMS_PER_PAGE = Math.max(1, Math.ceil(shopItems.length / TARGET_MAX_PAGES));
            const totalPages = Math.ceil(shopItems.length / ITEMS_PER_PAGE);
            let currentPage = 1;

            const createShopEmbed = (page) => {
                const startIndex = (page - 1) * ITEMS_PER_PAGE;
                const pageItems = shopItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
                return createV2Container({
                    title: 'Store',
                    color: 'primary',
                    description: 'Use `/buy item_id:<id> quantity:<amount>` to purchase an item.',
                    fields: pageItems.map((item) => ({
                        name: `${item.name} (${item.id})`,
                        value: `**Type:** ${item.type}\n **Price:** $${item.price.toLocaleString()}\n${item.description}`,
                    })),
                    footer: `Page ${page}/${totalPages}`,
                });
            };

            const createShopComponents = (page) => {
                if (totalPages <= 1) return [];
                return [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('shop_prev')
                            .setLabel('⬅️ Previous')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === 1),
                        new ButtonBuilder()
                            .setCustomId('shop_next')
                            .setLabel('Next ➡️')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(page === totalPages),
                    ),
                ];
            };

            const message = await interaction.reply(v2Message([createShopEmbed(currentPage), ...createShopComponents(currentPage)]));

            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 300000,
            });

            collector.on('collect', async (buttonInteraction) => {
                if (buttonInteraction.user.id !== interaction.user.id) {
                    await buttonInteraction.reply({ content: '❌ You cannot use these buttons. Run `/shop` to get your own shop view.', flags: 64 });
                    return;
                }
                const { customId } = buttonInteraction;
                if (customId === 'shop_prev' || customId === 'shop_next') {
                    await buttonInteraction.deferUpdate();
                    if (customId === 'shop_prev' && currentPage > 1) currentPage--;
                    else if (customId === 'shop_next' && currentPage < totalPages) currentPage++;
                    await buttonInteraction.editReply(v2Message([createShopEmbed(currentPage), ...createShopComponents(currentPage)]));
                }
            });

            collector.on('end', async () => {
                try {
                    const disabledComponents = createShopComponents(currentPage);
                    disabledComponents.forEach(row => row.components.forEach(btn => btn.setDisabled(true)));
                    await message.edit({ ...v2Message([createShopEmbed(currentPage), ...disabledComponents]), allowedMentions: { parse: [] } });
                } catch (error) {
                    logger.debug('shop_browse: could not disable components on collector end', {
                        error: error.message,
                    });
                }
            });
        } catch (error) {
            await handleInteractionError(interaction, error, { command: 'shop_browse' });
        }
    },
};