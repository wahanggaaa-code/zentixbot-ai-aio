import { SlashCommandBuilder } from 'discord.js';

import { claimDailyAtomic } from '../../services/economy/daily.js';
import { getGuildConfig } from '../../services/config/guildConfig.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';


export default {
    data: new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily cash reward'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            logger.debug(`[ECONOMY] Daily claimed started for ${userId}`, { userId, guildId });

            const guildConfig = await getGuildConfig(client, guildId);
            const premiumRoleId = guildConfig.premiumRoleId;
            const hasPremiumRole = Boolean(premiumRoleId && interaction.member && interaction.member.roles.cache.has(premiumRoleId));
            const result = await claimDailyAtomic({client,guildId,userId,premium:hasPremiumRole,now});
            const earned = result.earned;
            const bonusMessage = result.bonus ? `\n✨ **Premium Bonus:** +$${result.bonus.toLocaleString()}` : '';

            logger.info(`[ECONOMY_TRANSACTION] Daily claimed`, {
                userId,
                guildId,
                amount: earned,
                newWallet: result.newWallet,
                hasPremium: hasPremiumRole,
                timestamp: new Date().toISOString()
            });

            const embed = createV2Container({ title: "✅ Daily Claimed!", description: `You have claimed your daily **$${earned.toLocaleString()}**!${bonusMessage}`, color: 'success', fields: [{ name: "New Cash Balance", value: `$${result.newWallet.toLocaleString()}` }], footer: { text: hasPremiumRole
                        ? `Next claim in 24 hours. (Premium Active)`
                        : `Next claim in 24 hours.`, always: true } });

            await InteractionHelper.safeEditReply(interaction, { ...v2Message([embed]) });
    }, { command: 'daily' })
};