import { Events } from 'discord.js';
import { handleDiscordModerationAudit } from '../services/discordModerationAudit.js';
export default {
 name: Events.GuildAuditLogEntryCreate,
 async execute(entry,guild,client) { await handleDiscordModerationAudit(entry,guild,client); }
};
