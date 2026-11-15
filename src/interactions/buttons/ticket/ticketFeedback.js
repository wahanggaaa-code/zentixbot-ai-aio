import { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { getTicketData, saveTicketData } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { logTicketFeedback } from '../../../utils/ticket/ticketLogging.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

const STAR_LABELS = {
    '1': '⭐ 1 — Poor',
    '2': '⭐ 2 — Below Average',
    '3': '⭐ 3 — Average',
    '4': '⭐ 4 — Good',
    '5': '⭐ 5 — Excellent',
};

const feedbackHandler = {
    name: 'ticket_feedback',

    async execute(interaction, client, args) {
        
        const [guildId, channelId, ratingStr] = args;

        if (!guildId || !channelId || !/^[1-5]$/.test(ratingStr || '')) {
            await InteractionHelper.safeReply(interaction, {
                ...v2Message([createV2Container({
                    title: 'Invalid Feedback Link',
                    description: 'This feedback link appears to be malformed.',
                    color: 'error',
                })]),
            });
            return;
        }

        try {
            await interaction.deferUpdate();
        } catch (err) {
            logger.warn('ticketFeedback: interaction expired before deferUpdate', { guildId, channelId, error: err.message });
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedback: failed to load ticket data', { guildId, channelId });
            await InteractionHelper.safeEditReply(interaction, { content: 'Ticket data is temporarily unavailable. Please try again.' });
            return;
        }

        if (!ticketData) {
            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([createV2Container({
                    title: 'Ticket Not Found',
                    description: 'Could not find the ticket associated with this survey.',
                    color: 'error',
                })]),
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([createV2Container({
                    title: 'Not Allowed',
                    description: 'Only the ticket creator can submit feedback for this ticket.',
                    color: 'error',
                })]),
            });
            return;
        }

        if (ticketData.feedback?.rating) {
            await InteractionHelper.safeEditReply(interaction, {
                ...v2Message([createV2Container({
                    title: 'Already Submitted',
                    description: `You already rated this ticket **${STAR_LABELS[String(ticketData.feedback.rating)]}**.\nThank you for your feedback!`,
                    color: 'success',
                })]),
            });
            return;
        }

        const rating = parseInt(ratingStr, 10);
        const ratingLabel = STAR_LABELS[String(rating)] ?? `${rating} stars`;

        try {
            ticketData.feedback = {
                ...ticketData.feedback,
                rating,
                submittedAt: new Date().toISOString(),
            };
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedback: failed to save feedback', { guildId, channelId, rating, error: err.message });
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
                rating,
            });
        } catch (err) {
            logger.warn('ticketFeedback: failed to send log', { guildId, channelId, error: err.message });
        }

        await InteractionHelper.safeEditReply(interaction, {
            ...v2Message([createV2Container({
                title: 'Thanks for your feedback!',
                description: `You rated your support experience **${ratingLabel}**.\n\nYour feedback has been recorded and helps us improve!\n\nThank you for using our support system.`,
                color: 'success',
            })]),
        });

        logger.info('Ticket feedback submitted', {
            guildId,
            channelId,
            userId: interaction.user.id,
            rating,
        });
    },
};

const commentHandler = {
    name: 'ticket_feedback_comment',

    async execute(interaction, client, args) {
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await interaction.update({
                ...v2Message([createV2Container({
                    title: 'Invalid Feedback Link',
                    description: 'This feedback action appears to be malformed.',
                    color: 'error',
                })]),
            });
            return;
        }

        let ticketData;
        try { ticketData = await getTicketData(guildId, channelId); }
        catch { await InteractionHelper.safeReply(interaction, { content: 'Ticket data is temporarily unavailable. Please try again.' }); return; }
        if (!ticketData || ticketData.userId !== interaction.user.id) {
            await InteractionHelper.safeReply(interaction, { content: 'Only the ticket creator can submit feedback for this ticket.' });
            return;
        }

        const modal = new ModalBuilder()
            .setCustomId(`ticket_feedback_comment_modal:${guildId}:${channelId}`)
            .setTitle('Add Ticket Feedback');

        const commentInput = new TextInputBuilder()
            .setCustomId('feedback_comment')
            .setLabel('Your feedback')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Share what went well or how we can improve...')
            .setRequired(true)
            .setMaxLength(1000);

        modal.addComponents(new ActionRowBuilder().addComponents(commentInput));

        await interaction.showModal(modal);
    },
};

const declineHandler = {
    name: 'ticket_feedback_decline',

    async execute(interaction, client, args) {
        const [guildId, channelId] = args;
        let ticketData;
        try { ticketData = await getTicketData(guildId, channelId); }
        catch { await InteractionHelper.safeReply(interaction, { content: 'Ticket data is temporarily unavailable. Please try again.' }); return; }
        if (!ticketData || ticketData.userId !== interaction.user.id) {
            await InteractionHelper.safeReply(interaction, { content: 'Only the ticket creator can dismiss this survey.' });
            return;
        }
        await interaction.update({
            ...v2Message([createV2Container({
                title: 'No problem!',
                description: 'You can always reach out again if you need further support.',
                color: 'default',
            })]),
        });
    },
};

export default [feedbackHandler, commentHandler, declineHandler];