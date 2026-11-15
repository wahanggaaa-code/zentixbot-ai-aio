import { SlashCommandBuilder } from 'discord.js';

import { withEconomyTransaction } from '../../services/economy/transaction.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';

export default {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Withdraw money from your bank to your wallet')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount to withdraw')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        if (!await InteractionHelper.safeDefer(interaction)) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getInteger("amount");

            const result = await withEconomyTransaction(client,guildId,[userId],accounts => {
                const userData = accounts.get(userId);
                let withdrawAmount = amountInput;

                if (withdrawAmount <= 0) {
                    throw createError(
                        "Invalid withdrawal amount",
                        ErrorTypes.VALIDATION,
                        "You must withdraw a positive amount.",
                        { amount: withdrawAmount, userId }
                    );
                }

                if (withdrawAmount > userData.bank) {
                    withdrawAmount = userData.bank;
                }

                if (withdrawAmount === 0) {
                    throw createError(
                        "Empty bank account",
                        ErrorTypes.VALIDATION,
                        "Your bank account is empty.",
                        { userId, bankBalance: userData.bank }
                    );
                }

                userData.wallet += withdrawAmount;
                userData.bank -= withdrawAmount;

                return {withdrawAmount,wallet:userData.wallet,bank:userData.bank};
            });
            const {withdrawAmount,wallet,bank}=result;

            const embed = createV2Container({ title: 'Withdrawal Successful', description: `You successfully withdrew **$${withdrawAmount.toLocaleString()}** from your bank.`, color: 'success', fields: [{ name: "New Cash Balance", value: `$${wallet.toLocaleString()}` }, { name: "New Bank Balance", value: `$${bank.toLocaleString()}` }] });

            await InteractionHelper.safeEditReply(interaction, { ...v2Message([embed]) });
    }, { command: 'withdraw' })
};