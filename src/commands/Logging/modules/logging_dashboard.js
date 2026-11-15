import { MessageFlags, PermissionsBitField } from 'discord.js';
import { createV2Container, v2Message } from '../../../utils/componentsV2.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { getLoggingStatus } from '../../../services/loggingService.js';
import {
  createLoggingDashboardComponents,
  createLoggingCategoryViewComponents,
  createLoggingFilterComponents,
  DASHBOARD_CATEGORIES,
  DASHBOARD_CATEGORY_LABELS,
  EVENT_TYPES_BY_CATEGORY,
} from '../../../utils/logging/loggingUi.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';

import { replyUserError, ErrorTypes } from '../../../utils/errorHandler.js';
/** Ready-to-send v2 payload for the dashboard views (ephemeral messages keep their visibility). */
export function viewPayload(view) {
  return { ...v2Message([view.container, ...view.components]), allowedMentions: { parse: [] } };
}

export function containerTitle(message) {
  for (const top of message?.components ?? []) {
    const parent = typeof top?.toJSON === 'function' ? top.toJSON() : top;
    if (parent?.type !== 17) continue;
    for (const childRaw of parent.components ?? []) {
      const child = typeof childRaw?.toJSON === 'function' ? childRaw.toJSON() : childRaw;
      if (child?.type === 10 && typeof child.content === 'string') return child.content;
    }
  }
  return '';
}

export function getCategoryStatus(enabledEvents, category, auditEnabled) {
  if (!auditEnabled) return false;
  const events = enabledEvents || {};
  if (events[`${category}.*`] === false) return false;
  const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
  if (categoryEvents.length === 0) return true;
  return categoryEvents.every((eventType) => events[eventType] !== false);
}

async function formatChannelMention(guild, id) {
  if (!id) return '`Not configured`';
  const channel = guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
  return channel ? channel.toString() : `⚠️ Missing (${id})`;
}

function countEnabledCategories(enabledEvents, auditEnabled) {
  const enabled = DASHBOARD_CATEGORIES.filter((key) =>
    getCategoryStatus(enabledEvents, key, auditEnabled),
  ).length;
  return { enabled, total: DASHBOARD_CATEGORIES.length };
}

export async function buildLoggingDashboardView(interaction, client) {
  const guildConfig = await getGuildConfig(client, interaction.guildId);
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);

  const auditEnabled = Boolean(loggingStatus.enabled);
  const channels = loggingStatus.channels || {};

  const auditChannel = await formatChannelMention(interaction.guild, channels.audit);
  const applicationsChannel = await formatChannelMention(interaction.guild, channels.applications);
  const reportsChannel = await formatChannelMention(interaction.guild, channels.reports);
  const lifecycleChannel = await formatChannelMention(interaction.guild, guildConfig.ticketLogsChannelId);
  const transcriptChannel = await formatChannelMention(interaction.guild, guildConfig.ticketTranscriptChannelId);

  const ignore = loggingStatus.ignore || { users: [], channels: [] };
  const { enabled: enabledCount, total } = countEnabledCategories(loggingStatus.enabledEvents, auditEnabled);

  const container = createV2Container({
    title: '📝 Logging Dashboard',
    description: `Manage server logging for **${interaction.guild.name}**. Use the menu below to configure channels, categories, and filters.`,
    color: auditEnabled ? 'success' : 'warning',
    raw: true,
    fields: [
      { name: 'Logging Status', value: auditEnabled ? '✅ Enabled' : '❌ Disabled' },
      { name: 'Event Categories', value: auditEnabled ? `${enabledCount}/${total} enabled` : '`Logging disabled`' },
      { name: 'Ignore Filters', value: `${ignore.users?.length || 0} users · ${ignore.channels?.length || 0} channels` },
      {
        name: 'Log Channels',
        value: [
          `**Audit:** ${auditChannel}`,
          `**Applications:** ${applicationsChannel}`,
          `**Reports:** ${reportsChannel}`,
        ].join('\n'),
      },
      {
        name: 'Ticket Channels (read-only)',
        value: [
          `**Ticket Logs:** ${lifecycleChannel}`,
          `**Transcripts:** ${transcriptChannel}`,
        ].join('\n'),
      },
    ],
    footer: { text: 'Ticket channels: configure via /ticket dashboard', always: true },
  });

  const components = createLoggingDashboardComponents(loggingStatus.enabledEvents, auditEnabled);
  return { container, components };
}

export async function buildLoggingCategoriesView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const auditEnabled = Boolean(loggingStatus.enabled);

  const categoryLines = DASHBOARD_CATEGORIES.map((key) => {
    const on = getCategoryStatus(loggingStatus.enabledEvents, key, auditEnabled);
    const label = DASHBOARD_CATEGORY_LABELS[key] || key;
    return `${on ? '✅' : '❌'} ${label}`;
  }).join('\n');

  const container = createV2Container({
    title: '📋 Event Categories',
    description:
      auditEnabled
        ? 'Toggle which types of events are logged to your audit channel.'
        : 'Logging is disabled. Enable it from the main dashboard to send logs.',
    color: 'info',
    raw: true,
    fields: [{ name: 'Category Status', value: categoryLines }],
  });

  const components = createLoggingCategoryViewComponents(loggingStatus.enabledEvents, auditEnabled);
  return { container, components };
}

export async function buildLoggingFilterView(interaction, client) {
  const loggingStatus = await getLoggingStatus(client, interaction.guildId);
  const ignore = loggingStatus.ignore || { users: [], channels: [] };

  const userLines = (ignore.users || []).length
    ? ignore.users.map((id) => `• User \`${id}\``).join('\n')
    : '*No ignored users*';

  const channelLines = (ignore.channels || []).length
    ? ignore.channels.map((id) => `• Channel \`${id}\``).join('\n')
    : '*No ignored channels*';

  const container = createV2Container({
    title: '🔇 Log Ignore Filters',
    description: 'Users and channels on this list will be skipped when sending audit logs.',
    color: 'info',
    raw: true,
    fields: [
      { name: 'Ignored Users', value: userLines.slice(0, 1024) },
      { name: 'Ignored Channels', value: channelLines.slice(0, 1024) },
    ],
  });

  const components = createLoggingFilterComponents();
  return { container, components };
}

export function isCategoriesView(interaction) {
  return containerTitle(interaction?.message).includes('Event Categories');
}

export function isFilterView(interaction) {
  return containerTitle(interaction?.message).includes('Log Ignore Filters');
}

export async function refreshDashboardMessage(interaction, client) {
  let view;
  if (isCategoriesView(interaction)) {
    view = await buildLoggingCategoriesView(interaction, client);
  } else if (isFilterView(interaction)) {
    view = await buildLoggingFilterView(interaction, client);
  } else {
    view = await buildLoggingDashboardView(interaction, client);
  }

  await interaction.message.edit(viewPayload(view)).catch(() => {});
}

export default {
  prefixOnly: false,
  async execute(interaction, config, client) {
    try {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return await replyUserError(interaction, { type: ErrorTypes.PERMISSION, message: 'You need **Manage Server** permissions to view the logging dashboard.' });
      }

      await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      const view = await buildLoggingDashboardView(interaction, client);
      await InteractionHelper.safeEditReply(interaction, viewPayload(view));
    } catch (error) {
      logger.error('logging_dashboard error:', error);
      await replyUserError(interaction, { type: ErrorTypes.UNKNOWN, message: 'Failed to load the logging dashboard.' });
    }
  },
};
