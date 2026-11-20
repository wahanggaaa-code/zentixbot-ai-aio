import { Events } from 'discord.js';
import {handleRaidJoin} from '../services/moderation/raidAlert.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { getWelcomeConfig } from '../utils/database.js';
import { deliverJoinWelcome } from '../services/ai/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { counterRefresher } from '../services/serverStats/refresh.js';
import { setBirthday as dbSetBirthday } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import {isSQLiteBirthdayBackend,restoreSQLiteBirthdayOnJoin} from '../services/storage/sqliteBirthdays.js';
import {isPostgresBirthdayBackend,restorePostgresBirthdayOnJoin} from '../services/storage/postgresBirthdays.js';

export default {
  name: Events.GuildMemberAdd,
  once: false,
  
  async execute(member) {
    // Raid alert is isolated from welcome and onboarding; failure must not block either.
    handleRaidJoin(member,member.client).catch(error=>logger.warn(`Anti-raid gagal: ${error?.message||error}`));
    try {
        const { guild, user } = member;
        
        const config = await getGuildConfig(member.client, guild.id);
        
        const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
        
        // Welcome runs independently so slow or failed AI/Discord delivery cannot block onboarding.
        const welcomeTask = deliverJoinWelcome(member, welcomeConfig).then(result => {
            if (result.failed || result.source === 'unavailable' || result.source === 'legacy-unavailable') logger.warn('Welcome could not be delivered to one or more configured destinations.');
        }).catch(() => {
            logger.warn('Welcome delivery failed; other join actions continue.');
        });

        if (welcomeConfig?.roleIds && welcomeConfig.roleIds.length > 0) {
            const delay = welcomeConfig.autoRoleDelay || 0;
            const roleIds = [...new Set(welcomeConfig.roleIds)];
            const assignAll = async () => {
                for (const roleId of roleIds) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        await assignRoleSafely(member, role);
                    } else {
                        logger.warn(`[Welcome] Autorole ${roleId} not found in guild ${guild.id}`);
                    }
                }
            };

            if (delay > 0) {
                const timeout = setTimeout(() => { assignAll().catch((error) => logger.warn('[Welcome] Autorole assignment failed:', error)); }, delay * 1000);
                if (typeof timeout.unref === 'function') {
                    timeout.unref();
                }
            } else {
                await assignAll();
            }
        }
        
        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_JOIN,
                data: {
                    title: 'User joined',
                    lines: [
                        `**User:** ${user.toString()} (${user.displayName !== user.username ? `@${user.displayName}` : user.tag})`,
                        `**ID:** \`${user.id}\``,
                        `**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
                        `**Members:** ${guild.memberCount}`,
                    ],
                    quoted: false,
                    thumbnail: user.displayAvatarURL({ dynamic: true }),
                    userId: user.id,
                }
            });
        } catch (error) {
            logger.debug('Error logging member join:', error);
        }

        // Only a request: the rename happens later and never holds up the rest of this handler.
        counterRefresher.schedule(member.client, guild);

        try {
            if (isSQLiteBirthdayBackend(member.client)) {
                if (restoreSQLiteBirthdayOnJoin(member.client, guild.id, user.id)) {
                    logger.debug(`Birthday restored for user ${user.id} in guild ${guild.id}`);
                }
            } else if (isPostgresBirthdayBackend(member.client)) {
                if (await restorePostgresBirthdayOnJoin(member.client, guild.id, user.id)) logger.debug(`Birthday restored for user ${user.id} in guild ${guild.id}`);
            } else {
                const backupKey = `guild:${guild.id}:birthdays:left`;
                const backup = (await member.client.db.get(backupKey)) || {};
                if (backup[user.id]) {
                    const { month, day } = backup[user.id];
                    await dbSetBirthday(member.client, guild.id, user.id, month, day);
                    delete backup[user.id];
                    await member.client.db.set(backupKey, backup);
                    logger.debug(`Birthday restored for user ${user.id} in guild ${guild.id}`);
                }
            }
        } catch (error) {
            logger.debug('Error restoring birthday on member join:', error);
        }
        await welcomeTask;
    } catch (error) {
        logger.error('Error in guildMemberAdd event:', error);
    }
  }
};

async function assignRoleSafely(member, role) {
    try {
        await member.roles.add(role);
    } catch (error) {
        logger.warn(`Failed to assign role ${role.id} to member ${member.id}:`, error);
    }
}