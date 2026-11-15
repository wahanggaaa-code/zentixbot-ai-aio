import { ComponentType, MessageFlags } from 'discord.js';
import { createV2Container, v2Message } from './componentsV2.js';
import { ZentixBotError, ErrorTypes, replyUserError } from './errorHandler.js';
import { InteractionHelper } from './interactionHelper.js';
import { logger } from './logger.js';

function matchesCustomId(customId, matcher) {
    if (typeof matcher === 'function') return matcher(customId);
    if (Array.isArray(matcher)) return matcher.includes(customId);
    return customId === matcher;
}

export function wrapDashboardHandler(handler, interactionLabel = 'dashboard') {
    return async (componentInteraction) => {
        try {
            await handler(componentInteraction);
        } catch (error) {
            if (error?.code === 40060) return;

            if (error instanceof ZentixBotError) {
                logger.debug(`${interactionLabel} error: ${error.message}`);
            } else {
                logger.error(`Unexpected ${interactionLabel} error:`, error);
            }

            const errorMessage =
                error instanceof ZentixBotError
                    ? error.userMessage || 'An error occurred while processing your selection.'
                    : 'An unexpected error occurred while updating the configuration.';

            if (!componentInteraction.replied && !componentInteraction.deferred) {
                await componentInteraction.deferUpdate().catch(() => {});
            }

            await replyUserError(componentInteraction, {
                type: ErrorTypes.CONFIGURATION,
                message: errorMessage,
            }).catch(() => {});
        }
    };
}

/**
 * Shared select + button collector lifecycle for admin dashboards.
 */
export async function startDashboardSession({
    interaction,
    container,
    components,
    flags,
    timeoutMs = 600_000,
    selectMenuId,
    buttonMatcher,
    onSelect,
    onButton,
    onTimeout,
}) {
    if (!container) throw new Error('startDashboardSession requires a Components v2 container');
    const ephemeral = Boolean(flags && (flags & MessageFlags.Ephemeral));
    await InteractionHelper.safeEditReply(interaction, {
        ...v2Message([container, ...components], { ephemeral }),
        allowedMentions: { parse: [] },
    });

    const replyMessage = await interaction.fetchReply().catch(() => null);
    const replyMessageId = replyMessage?.id;

    const belongsToDashboard = (componentInteraction) =>
        componentInteraction.user.id === interaction.user.id &&
        (!replyMessageId || componentInteraction.message.id === replyMessageId);

    const collectors = [];

    if (selectMenuId && onSelect) {
        const selectCollector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => belongsToDashboard(i) && i.customId === selectMenuId,
            time: timeoutMs,
        });

        selectCollector.on('collect', wrapDashboardHandler(onSelect, 'dashboard select'));
        collectors.push(selectCollector);
    }

    if (buttonMatcher && onButton) {
        const buttonCollector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: (i) => belongsToDashboard(i) && matchesCustomId(i.customId, buttonMatcher),
            time: timeoutMs,
        });

        buttonCollector.on('collect', wrapDashboardHandler(onButton, 'dashboard button'));
        collectors.push(buttonCollector);
    }

    const stopAll = () => collectors.forEach((collector) => collector.stop());

    if (collectors.length > 0) {
        collectors[0].on('end', async (_collected, reason) => {
            stopAll();
            if (reason !== 'time') return;

            if (onTimeout) {
                await onTimeout(interaction).catch(() => {});
                return;
            }

            const timeoutContainer = createV2Container({
                title: 'Dashboard Timed Out',
                description: 'This dashboard has been closed due to inactivity. Please run the command again to continue.',
                color: 'error',
            });

            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([timeoutContainer]),
            }).catch(() => {});
        });
    }

    return { stop: stopAll, replyMessageId };
}
