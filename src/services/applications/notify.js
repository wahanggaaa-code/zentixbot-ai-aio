// notify.js — what follows a stored application or decision: the log channel entry and the
// direct message to the applicant. All of it is best effort: the application or decision is
// already stored, so nothing here may fail the action. Each function reports whether it worked.

import { EmbedBuilder } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { EVENT_TYPES, isEventEnabled, logEvent, resolveApplicationLogChannel } from '../loggingService.js';
import { formatLogLine, resolveUserAuthor } from '../../utils/logging/logEmbeds.js';
import { buildStandardLogContainer, buildLogDescription } from '../../utils/logging/logEmbeds.js';
import { noteApplication } from './store.js';
import { v2Message } from '../../utils/componentsV2.js';
import { applicantDm, logEntryButtons, shown, statusLabel, statusOf } from './view.js';

/**
 * Where entries about `form` (or, without a form, about any application) go, and whether the
 * logging settings let them through: `{ channelId, enabled, applicationEvents }`.
 */
export async function loggingFor(client, guildId, settings, form = null) {
    const config = await getGuildConfig(client, guildId);
    return {
        channelId: resolveApplicationLogChannel(config, form ?? {}, settings),
        enabled: config?.logging?.enabled === true,
        applicationEvents: isEventEnabled({ logging: { ...config?.logging, enabled: true } }, EVENT_TYPES.APPLICATION_SUBMIT),
    };
}

/** Post the entry about a new application, with its Review button. Returns true when it was posted. */
export async function postSubmissionLog(client, guild, application, form, settings) {
    try {
        const { channelId } = await loggingFor(client, guild.id, settings, form);
        if (!channelId) return false;
        const message = await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.APPLICATION_SUBMIT,
            channelId,
            components: logEntryButtons(application.id),
            data: {
                title: 'Application Submitted',
                lines: [
                    formatLogLine('Applicant', `<@${application.userId}>`),
                    formatLogLine('Application', shown(application.roleName, 80)),
                    formatLogLine('Role', `<@&${application.roleId}>`),
                    formatLogLine('Application ID', `\`${application.id}\``),
                ],
                inlineFields: [{ name: 'Status', value: statusLabel(application), inline: true }],
                author: await resolveUserAuthor(client, application.userId),
            },
        });
        if (!message) return false;
        // The entry is posted; remembering where only matters for updating it after the review.
        await noteApplication(client, guild.id, application.id, { logMessageId: message.id, logChannelId: channelId })
            .catch((error) => logger.warn('Could not remember the log entry of an application', { applicationId: application.id, code: error?.code }));
        return true;
    } catch (error) {
        logger.warn('Could not post the log entry of an application', { applicationId: application.id, guildId: guild.id, error: error?.message });
        return false;
    }
}

async function editLogEntry(client, guild, application, text) {
    if (!application.logMessageId || !application.logChannelId) return false;
    const channel = guild.channels.cache.get(application.logChannelId);
    const message = await channel?.messages?.fetch(application.logMessageId);
    if (!message) return false;
    // Entries posted before the v2 migration are classic embeds: patch them in place.
    const legacy = message?.embeds?.[0];
    if (legacy) {
        const next = EmbedBuilder.from(legacy).setColor(getColor(statusOf(application).color));
        const fields = legacy.fields ?? [];
        const at = fields.findIndex((field) => field.name === 'Status');
        if (at === -1) next.addFields({ name: 'Status', value: text, inline: true });
        else next.spliceFields(at, 1, { name: 'Status', value: text, inline: true });
        await message.edit({ embeds: [next], components: [] });
        return true;
    }
    // v2 entries: rebuild the submission entry with the decision as its status, keeping the Review button.
    const author = await resolveUserAuthor(client, application.userId).catch(() => null);
    const container = buildStandardLogContainer({
        color: getColor(statusOf(application).color),
        title: 'Application Submitted',
        description: buildLogDescription({
            lines: [
                formatLogLine('Applicant', `<@${application.userId}>`),
                formatLogLine('Application', shown(application.roleName, 80)),
                formatLogLine('Role', `<@&${application.roleId}>`),
                formatLogLine('Application ID', `\`${application.id}\``),
            ],
            quoted: true,
        }),
        inlineFields: [{ name: 'Status', value: text }],
        author,
    });
    await message.edit({ ...v2Message([container, ...logEntryButtons(application.id)]), allowedMentions: { parse: [] } });
    return true;
}

/**
 * Show the decision in the log: on the entry of the application when there is one, else as an
 * entry of its own. Returns true when either worked.
 */
export async function recordDecisionInLog(client, guild, outcome, settings, form = null) {
    const { application } = outcome;
    const text = `${statusLabel(application)} · by <@${application.reviewer}>`;
    try {
        if (await editLogEntry(client, guild, application, text)) return true;
    } catch (error) {
        logger.warn('Could not update the log entry of an application', { applicationId: application.id, error: error?.message });
    }
    try {
        const { channelId } = await loggingFor(client, guild.id, settings, form);
        if (!channelId) return false;
        const message = await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.APPLICATION_REVIEW,
            channelId,
            data: {
                title: 'Application Reviewed',
                color: getColor(statusOf(application).color),
                lines: [
                    formatLogLine('Applicant', `<@${application.userId}>`),
                    formatLogLine('Application', shown(application.roleName, 80)),
                    formatLogLine('Application ID', `\`${application.id}\``),
                    formatLogLine('Reviewer', `<@${application.reviewer}>`),
                ],
                inlineFields: [{ name: 'Status', value: statusLabel(application), inline: true }],
            },
        });
        return Boolean(message);
    } catch (error) {
        logger.warn('Could not post the review entry of an application', { applicationId: application.id, error: error?.message });
        return false;
    }
}

/** Tell the applicant. Returns true when the direct message was delivered. */
export async function tellApplicant(client, guild, outcome) {
    try {
        const user = await client.users.fetch(outcome.application.userId);
        await user.send({ ...v2Message([applicantDm(guild, outcome)]), allowedMentions: { parse: [] } });
        return true;
    } catch (error) {
        logger.info('Applicant could not be told by direct message', { applicationId: outcome.application.id, code: error?.code });
        return false;
    }
}
