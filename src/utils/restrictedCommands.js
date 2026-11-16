// restrictedCommands.js — the shared gate for the 15 restricted commands.
//
// /ban /unban /kick /timeout /untimeout /massban /masskick /purge /lock
// /unlock /dm /warn /warnings /serverinfo /userinfo are limited to the bot
// owner and to a list of roles chosen per server in the dashboard
// (`commandAccessRoleIds` in the guild config). Native Discord permissions —
// including Administrator — neither hide nor gate these commands.
//
// An empty `commandAccessRoleIds` means: owner bot only.
//
// The old `modRole` config key is intentionally not consulted here.

import { isBotOwner } from '../config/bot.js';

export const RESTRICTED_COMMANDS = Object.freeze(new Set([
    'ban', 'unban', 'kick',
    'timeout', 'untimeout',
    'massban', 'masskick',
    'purge',
    'lock', 'unlock',
    'dm',
    'warn', 'warnings',
    'serverinfo', 'userinfo',
]));

export function isRestrictedCommand(commandName) {
    const name = String(commandName ?? '').toLowerCase().trim();
    // Subcommand access keys are gated by their top-level command name.
    const base = name.split(/\s+/, 1)[0];
    return RESTRICTED_COMMANDS.has(base);
}

/**
 * Whether `member` may run a restricted command in the guild whose normalized
 * config is `guildConfig`. The bot owner is allowed everywhere; everyone else
 * needs at least one configured role.
 * @param {import('discord.js').GuildMember | null | undefined} member
 * @param {string | null | undefined} userId — the invoking user's id (owner check)
 * @param {object | null | undefined} guildConfig
 * @returns {boolean}
 */
export function memberHasRestrictedAccess(member, userId, guildConfig) {
    if (isBotOwner(userId)) return true;
    if (!member) return false;
    const ids = Array.isArray(guildConfig?.commandAccessRoleIds) ? guildConfig.commandAccessRoleIds : [];
    if (ids.length === 0) return false;
    const memberRoles = member.roles?.cache;
    if (!memberRoles || typeof memberRoles.some !== 'function') return false;
    return memberRoles.some((role) => ids.includes(role.id));
}

/**
 * Strip anything that is not a Discord snowflake id from a stored or
 * requested role id list: strings only, unique, at most `max` entries.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string[]}
 */
export function normalizeRoleIdList(value, max = 25) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    for (const entry of value) {
        const id = typeof entry === 'string' ? entry.trim() : (entry && typeof entry === 'object' ? String(entry.id ?? '') : '');
        if (/^\d{17,20}$/.test(id) && !seen.has(id)) seen.add(id);
        if (seen.size >= max) break;
    }
    return [...seen];
}
