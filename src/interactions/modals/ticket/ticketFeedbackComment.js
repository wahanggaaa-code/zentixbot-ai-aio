import { MessageFlags } from 'discord.js';
import { getTicketData, saveTicketData } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { logTicketFeedback } from '../../../utils/ticket/ticketLogging.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

function buildContainer(title, description, color) {
    return createV2Container({ title, description, color });
}

export default {
    name: 'ticket_feedback_comment_modal',

    async execute(interaction, client, args) {
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await InteractionHelper.safeReply(interaction, {
                ...v2Message([buildContainer(
                    'Invalid Feedback Submission',
                    'This feedback form appears to be malformed.',
                    'error',
                )], { ephemeral: true }),
            });
            return;
        }

        const comment = interaction.fields.getTextInputValue('feedback_comment')?.trim();
        if (!comment) {
            await InteractionHelper.safeReply(interaction, {
                ...v2Message([buildContainer(
                    'Empty Feedback',
                    'Please enter a comment before submitting your feedback.',
                    'warning',
                )], { ephemeral: true }),
            });
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedbackComment: failed to load ticket data', { guildId, channelId });
            await InteractionHelper.safeEditReply(interaction, { content: 'Ticket data is temporarily unavailable. Please try again.' });
            return;
        }

        if (!ticketData) {
            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([buildContainer(
                    'Ticket Not Found',
                    'Could not find the ticket associated with this feedback.',
                    'error',
                )]),
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([buildContainer(
                    'Not Allowed',
                    'Only the ticket creator can submit feedback for this ticket.',
                    'error',
                )]),
            });
            return;
        }

        ticketData.feedback = {
            ...ticketData.feedback,
            comment,
            commentSubmittedAt: new Date().toISOString(),
        };

        try {
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedbackComment: failed to save feedback', { guildId, channelId, error: err.message });
            await InteractionHelper.safeEditReply(interaction, { content: 'Feedback could not be saved. Please try again.' });
            return;
        }

        try {
            await logTicketFeedback({
                client: interaction.client,
                guildId,
                ticketNumber: ticketData.id,
                ticketChannelId: channelId,
                userId: interaction.user.id,
                rating: ticketData.feedback?.rating ?? null,
                comment,
            });
        } catch (err) {
            logger.warn('ticketFeedbackComment: failed to send log', { guildId, channelId, error: err.message });
        }

        await InteractionHelper.safeEditReply(interaction, {
            ...v2Message([buildContainer(
                    'Feedback Submitted',
                    'Your written feedback has been recorded. Thank you for helping us improve!',
                    'success',
                )]),
        });

        logger.info('Ticket feedback comment submitted', {
            guildId,
            channelId,
            userId: interaction.user.id,
        });
    },
};
