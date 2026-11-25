import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { getTicketData, saveTicketData } from '../../utils/database.js';
import { createAIFeatureControlsStore } from './featureControls.js';
import { summarizeTicket } from './ticketSummary.js';

// Best effort, launched only after the close is saved. Not a durable queue:
// failures/restarts do not retry. Never log ticket text or provider errors.
export async function automaticTicketSummary({ channel, closedAt }) {
    const client = channel.client, guild = channel.guild, id = channel.id;
    const enabled = async () => (await createAIFeatureControlsStore(client).read(guild.id)).ticketAutoSummaryEnabled;
    if (!client.aiFoundation || !client.user?.id || !(await enabled())) return;
    const current = await getTicketData(guild.id, id);
    if (!current || current.status !== 'closed' || current.closedAt !== closedAt) return;
    const { text, lines } = await summarizeTicket({ client, channel, userId: client.user.id });
    if (!(await enabled())) return;
    const latest = await getTicketData(guild.id, id);
    if (!latest || latest.status !== 'closed' || latest.closedAt !== closedAt) return;
    latest.aiSummary = { text, closedAt, createdAt: new Date().toISOString(), lines };
    // Uses the ticket's optimistic snapshot: a concurrent change aborts rather than
    // overwriting a reopen, delete, or another staff action.
    await saveTicketData(guild.id, id, latest);
    if (!(await enabled())) return;
    const config = await getGuildConfig(client, guild.id), targetId = config.ticketTranscriptChannelId;
    if (!targetId || targetId === id) return;
    const target = await client.channels.fetch(targetId).catch(() => null);
    if (!target || target.guildId !== guild.id || !target.isSendable?.()) return;
    // Fail closed for a public @everyone channel; other channel access still needs
    // to be reviewed by the owner before enabling the feature.
    const everyone = guild.roles?.everyone;
    if (!everyone || !target.permissionsFor || target.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel) !== false) return;
    const fresh = await getTicketData(guild.id, id);
    if (!fresh || fresh.status !== 'closed' || fresh.closedAt !== closedAt || !(await enabled())) return;
    await target.send({ content: `**Ringkasan tiket AI** · ${id}\nSampel pesan awal dan terbaru; hasil perlu diperiksa staff.\n${text}`.slice(0, 2000), allowedMentions: { parse: [] } });
}

export function scheduleAutomaticTicketSummary(channel, closedAt) {
    setImmediate(() => { void automaticTicketSummary({ channel, closedAt }).catch(() => {}); });
}
