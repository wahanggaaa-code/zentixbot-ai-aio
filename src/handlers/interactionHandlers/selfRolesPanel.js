// selfRolesPanel.js — the panel's interactive replies: buttons, select menus and
// the legacy `reaction_roles` menu (panels posted before the unified module).
// One flow for all of them so a member always gets the same ephemeral answer.

import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { createV2Container, v2Message } from '../../utils/componentsV2.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { isSnowflake } from '../../services/selfRoles/store.js';
import { applyMemberChoice, applyButtonChoice, roleReason } from '../../services/selfRoles/manage.js';

const names = (entries) => entries.map((entry) => (entry.name ? `**${entry.name}**` : `\`${entry.id}\``)).join(', ');

/**
 * What the member is told. The title and colour follow what really happened:
 * success only when every wanted change was made.
 */
export function describeChoice(outcome) {
    if (outcome?.blocked === 'REQUIRED_ROLE') {
        return {
            description: '🎭 **This panel needs a role you don\'t have yet.**\n\nAsk a server administrator about the role required for this panel.',
            color: 'error',
        };
    }
    const changed = outcome.added.length + outcome.removed.length;
    const problems = outcome.skipped.length + outcome.failed.length;
    const lines = [];
    if (outcome.added.length) lines.push(`✅ **Added:** ${names(outcome.added)}`);
    if (outcome.removed.length) lines.push(`❌ **Removed:** ${names(outcome.removed)}`);
    for (const entry of outcome.skipped) {
        const reason = entry.reason === 'NOT_ON_PANEL' ? 'That role is not on this panel.' : roleReason(entry.reason);
        lines.push(`⚠️ **Not changed:** ${entry.name ? `**${entry.name}**` : `\`${entry.id}\``} — ${reason}`);
    }
    for (const entry of outcome.failed) {
        lines.push(`⚠️ **Could not ${entry.wanted ? 'add' : 'remove'}:** **${entry.name}** — Discord refused the change.`);
    }
    if (problems) lines.push('\nPlease tell a server administrator about the roles that could not be changed.');

    let title = '🎭 **Roles updated successfully!**';
    let color = 'success';
    if (!changed && !problems) {
        title = '🎭 **No changes were made to your roles.**';
        color = 'info';
    } else if (changed && problems) {
        title = '🎭 **Some of your roles were updated.**';
        color = 'warning';
    } else if (problems) {
        title = '🎭 **Your roles could not be updated.**';
        color = 'error';
    }
    return { description: [title, '', ...lines].join('\n').trim(), color };
}

async function replyOutcome(interaction, client, member, outcome) {
    const { description, color } = describeChoice(outcome);
    await interaction.editReply({
        ...v2Message([createV2Container({ description, color, raw: true })]),
        allowedMentions: { parse: [] },
    });

    if (outcome.added?.length > 0 || outcome.removed?.length > 0) {
        try {
            await logEvent({
                client,
                guildId: interaction.guildId,
                eventType: EVENT_TYPES.SELF_ROLE_UPDATE,
                data: {
                    description: `Self-role panel used by ${member.user.tag}`,
                    userId: member.user.id,
                    channelId: interaction.channelId,
                    fields: [
                        { name: '👤 Member', value: `${member.user.tag} (${member.user.id})`, inline: false },
                        ...(outcome.added.length ? [{ name: '✅ Roles Added', value: outcome.added.map((entry) => entry.name).join(', ').slice(0, 1024), inline: false }] : []),
                        ...(outcome.removed.length ? [{ name: '❌ Roles Removed', value: outcome.removed.map((entry) => entry.name).join(', ').slice(0, 1024), inline: false }] : []),
                    ],
                },
            });
        } catch (logError) {
            logger.warn('Failed to log the self-role panel change:', logError);
        }
    }

    logger.info(`Self-role panel for ${member.user.tag}: +${outcome.added?.length ?? 0}, -${outcome.removed?.length ?? 0}, skipped ${outcome.skipped?.length ?? 0}, failed ${outcome.failed?.length ?? 0}`);
}

async function runPanelInteraction(interaction, client, resolve) {
    try {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
            throw createError(
                'Self-role panel interaction used outside a guild context',
                ErrorTypes.VALIDATION,
                'This panel can only be used inside a server.',
                { userId: interaction.user.id },
            );
        }

        const member = interaction.member;
        let outcome;
        try {
            outcome = await resolve(member);
        } catch (error) {
            // The panel may well be active: a database problem is not "no panel".
            logger.error(`Could not read self-role panel ${interaction.message?.id}:`, error);
            await interaction.editReply(v2Message([createV2Container({
                description: '❌ Your roles could not be changed right now. Nothing was changed. Please try again in a moment.',
                color: 'error',
                raw: true,
            })]));
            return;
        }

        if (!outcome) {
            logger.warn(`Self-role panel not found for message ${interaction.message?.id} in guild ${interaction.guildId}`);
            await interaction.editReply(v2Message([createV2Container({
                description: '❌ This self-role panel is no longer active.',
                color: 'error',
                raw: true,
            })]));
            return;
        }

        await replyOutcome(interaction, client, member, outcome);
    } catch (error) {
        await handleInteractionError(interaction, error, { type: 'component', customId: interaction.customId });
    }
}

/** A button of a panel: `sr_btn:<messageId>:<roleId>`. */
export async function handleSelfRoleButton(interaction, client, args) {
    const [messageId, roleId] = Array.isArray(args) ? args : [];
    if (!isSnowflake(messageId) || !isSnowflake(roleId)) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (deferSuccess) {
            await interaction.editReply(v2Message([createV2Container({ description: '❌ This button does not belong to any panel.', color: 'error', raw: true })]));
        }
        return;
    }
    await runPanelInteraction(interaction, client, (member) => applyButtonChoice(client, interaction.guild, member, messageId, roleId));
}

/**
 * A select menu of a panel: `sr_sel:<messageId>`, or the pre-unification `reaction_roles` menu,
 * which carried no id and is bound to the message it is on.
 */
export async function handlePanelSelect(interaction, client, messageId) {
    const resolved = messageId ?? (isSnowflake(args0(interaction)) ? args0(interaction) : interaction.message?.id);
    if (!isSnowflake(resolved)) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (deferSuccess) {
            await interaction.editReply(v2Message([createV2Container({ description: '❌ This menu does not belong to any panel.', color: 'error', raw: true })]));
        }
        return;
    }
    await runPanelInteraction(interaction, client, (member) => applyMemberChoice(client, interaction.guild, member, resolved, interaction.values ?? []));
}

function args0(interaction) {
    const customId = String(interaction.customId ?? '');
    const index = customId.indexOf(':');
    return index === -1 ? null : customId.slice(index + 1);
}
