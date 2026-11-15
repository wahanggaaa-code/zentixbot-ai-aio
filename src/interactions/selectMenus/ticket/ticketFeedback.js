import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { getTicketData, saveTicketData } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { logTicketFeedback } from '../../../utils/ticket/ticketLogging.js';

const STAR_LABELS = {
    '1': '⭐ 1 — Poor',
    '2': '⭐ 2 — Below Average',
    '3': '⭐ 3 — Average',
    '4': '⭐ 4 — Good',
    '5': '⭐ 5 — Excellent',
};

export default {
    name: 'ticket_feedback',

    async execute(interaction, client, args) {
        
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await interaction.update({
                ...v2Message([createV2Container({
                    title: 'Invalid Feedback Link',
                    description: 'This feedback link appears to be malformed.',
                    color: 'error',
                })]),
            });
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedback: failed to load ticket data', { guildId, channelId, error: err.message });
        }

        if (!ticketData) {
            await interaction.update({
                ...v2Message([createV2Container({
                    title: 'Ticket Not Found',
                    description: 'Could not find the ticket associated with this survey.',
                    color: 'error',
                })]),
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await interaction.reply({
                ...v2Message([createV2Container({
                    title: 'Not Allowed',
                    description: 'Only the ticket creator can submit feedback for this ticket.',
                    color: 'error',
                })], { ephemeral: true }),
            });
            return;
        }

        if (ticketData.feedback?.rating) {
            await interaction.update({
                ...v2Message([createV2Container({
                    title: 'Already Submitted',
                    description: `You already rated this ticket **${STAR_LABELS[String(ticketData.feedback.rating)]}**.\nThank you for your feedback!`,
                    color: 'success',
                })]),
            });
            return;
        }

        if (!/^[1-5]$/.test(interaction.values[0] || '')) { await interaction.update(v2Message([createV2Container({ title: 'Invalid Rating', description: 'The selected rating is invalid.', color: 'warning' })])); return; }
        const rating = Number(interaction.values[0]);
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
            await interaction.update(v2Message([createV2Container({ title: 'Not Saved', description: 'Feedback could not be saved. Please try again.', color: 'error' })]));
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

        await interaction.update({
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