import { ChannelType } from 'discord.js';
/** A single bot instance serves only its configured home guild. */
export function requireHomeGuildId(value) {
  const id = String(value || '').trim();
  if (!/^\d{17,20}$/.test(id)) throw new Error('GUILD_ID must be the 17–20 digit Discord server ID.');
  return id;
}
export function isHomeGuild(client, guildId) {
  return Boolean(client?.homeGuildId && typeof guildId === 'string' && guildId === client.homeGuildId);
}
/** Fail closed on events without guild context except narrowly scoped ticket feedback and AI DM interactions. */
export function mayDispatchEvent(client, eventName, args) {
  if (eventName === 'interactionCreate' && !args[0]?.guildId && !args[0]?.guild) {
    const interaction = args[0];
    const parts = String(interaction?.customId || '').split(':');
    if (parts.length === 3 && ['ai_dm_start','ai_dm_memory','ai_dm_clear'].includes(parts[0]) && isHomeGuild(client,parts[1]) && /^\d{17,20}$/.test(parts[2]||'') && interaction.user?.id===parts[2]) {
      return Boolean(interaction.isButton?.() && client.user?.id && interaction.message?.author?.id===client.user.id);
    }
    const allowed = (parts[0] === 'ticket_feedback' && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) ||
      (['ticket_feedback_comment','ticket_feedback_decline'].includes(parts[0]) && interaction.isButton?.()) ||
      (parts[0] === 'ticket_feedback_comment_modal' && interaction.isModalSubmit?.());
    const validTail = parts[0] === 'ticket_feedback' && interaction.isButton?.() ? parts.length === 4 && /^[1-5]$/.test(parts[3]) : parts.length === 3;
    const botMessage = interaction.isModalSubmit?.() || (client.user?.id && interaction.message?.author?.id === client.user.id);
    return Boolean(allowed && validTail && botMessage && isHomeGuild(client, parts[1]) && /^\d{17,20}$/.test(parts[2] || ''));
  }
  if (eventName === 'messageCreate' && !args[0]?.guildId && !args[0]?.guild) {
    // A direct message to the bot is the AI DM chat's only input — let it reach the handler.
    const channel = args[0]?.channel;
    const isDm = channel?.type === ChannelType.DM || (typeof channel?.isDMBased === 'function' && channel.isDMBased());
    return Boolean(isDm && args[0]?.author);
  }
  if (eventName === 'messageReactionAdd' || eventName === 'messageReactionRemove') {
    const message = args[0]?.message;
    return isHomeGuild(client, message?.guildId ?? message?.guild?.id);
  }
  if (eventName === 'clientReady' || eventName === 'ready' || eventName === 'userUpdate') return Boolean(client?.homeGuildId);
  if (eventName === 'guildAuditLogEntryCreate') return isHomeGuild(client, args[1]?.id);
  if (eventName === 'guildCreate' || eventName === 'guildDelete' || eventName === 'guildUpdate') {
    return args.some(x => isHomeGuild(client, x?.id));
  }
  return args.some(x => isHomeGuild(client, x?.guildId || x?.guild?.id));
}
