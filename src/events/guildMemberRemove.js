import { Events, PermissionFlagsBits } from 'discord.js';
import { getWelcomeConfig } from '../utils/database.js';
import { deleteApplicationsOf } from '../services/applications/store.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { deliverLeaveGoodbye } from '../services/ai/welcome.js';
import { buildGoodbyePayload } from '../services/welcomePayload.js';
import { botConfig } from '../config/bot.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { counterRefresher } from '../services/serverStats/refresh.js';
import { getGuildBirthdays, deleteBirthday } from '../utils/database.js';
import { deleteUserLevelData } from '../services/leveling/leveling.js';
import { logger } from '../utils/logger.js';
import {isSQLiteBirthdayBackend,moveSQLiteBirthdayOnLeave} from '../services/storage/sqliteBirthdays.js';
import {isPostgresBirthdayBackend,movePostgresBirthdayOnLeave} from '../services/storage/postgresBirthdays.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,
  
  async execute(member) {
    try {
        const { guild, user } = member;
        
        const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
        
        const goodbyeTask=deliverLeaveGoodbye(member,()=>deliverLegacyGoodbye(member,welcomeConfig)).then(result=>{
            if(result.source==='unavailable')logger.warn('Goodbye channel unavailable.');
        }).catch(()=>logger.warn('Goodbye delivery failed; other leave actions continue.'));

        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_LEAVE,
                data: {
                    title: 'User left',
                    lines: [
                        `**User:** ${user.toString()} (${user.tag})`,
                        `**ID:** \`${user.id}\``,
                        `**Joined:** <t:${Math.floor((member.joinedTimestamp || Date.now()) / 1000)}:R>`,
                        `**Members:** ${guild.memberCount}`,
                    ],
                    quoted: false,
                    thumbnail: user.displayAvatarURL({ dynamic: true }),
                    userId: user.id,
                }
            });
        } catch (error) {
            logger.debug('Error logging member leave:', error);
        }

        // Only a request: the rename happens later and never holds up the rest of this handler.
        counterRefresher.schedule(member.client, guild);

        try {
            if (isSQLiteBirthdayBackend(member.client)) {
                if (moveSQLiteBirthdayOnLeave(member.client, guild.id, user.id)) {
                    logger.debug(`Birthday backed up and removed for user ${user.id} in guild ${guild.id}`);
                }
            } else if (isPostgresBirthdayBackend(member.client)) {
                if (await movePostgresBirthdayOnLeave(member.client, guild.id, user.id)) logger.debug(`Birthday backed up and removed for user ${user.id} in guild ${guild.id}`);
            } else {
                const birthdays = await getGuildBirthdays(member.client, guild.id);
                if (birthdays[user.id]) {
                    const backupKey = `guild:${guild.id}:birthdays:left`;
                    const backup = (await member.client.db.get(backupKey)) || {};
                    backup[user.id] = birthdays[user.id];
                    await member.client.db.set(backupKey, backup);
                    await deleteBirthday(member.client, guild.id, user.id);
                    logger.debug(`Birthday backed up and removed for user ${user.id} in guild ${guild.id}`);
                }
            }
        } catch (error) {
            logger.debug('Error handling birthday on member leave:', error);
        }

        try {
            const removed = await deleteApplicationsOf(member.client, guild.id, user.id);
            if (removed > 0) {
                logger.debug(`Removed ${removed} applications for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling applications on member leave:', error);
        }

        try {
            await deleteUserLevelData(member.client, guild.id, user.id);
            logger.debug(`Removed leveling data for user ${user.id} in guild ${guild.id}`);
        } catch (error) {
            logger.debug('Error handling leveling data on member leave:', error);
        }
        await goodbyeTask;
    } catch (error) {
        logger.error('Error in guildMemberRemove event:', error);
    }
  }
};

async function deliverLegacyGoodbye(member,welcomeConfig) {
 const {guild,user}=member;
        const goodbyeChannelId = welcomeConfig?.goodbyeChannelId;

        if (welcomeConfig?.goodbyeEnabled && goodbyeChannelId) {
            const channel = guild.channels.cache.get(goodbyeChannelId);
            if (channel?.isTextBased?.()) {
                const me = guild.members.me;
                const permissions = me ? channel.permissionsFor(me) : null;
                if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                    return;
                }

                if (!permissions.has(PermissionFlagsBits.EmbedLinks)) {
                    const formatData = { user, guild, member };
                    const goodbyeMessage = formatWelcomeMessage(
                        welcomeConfig.leaveMessage || welcomeConfig.leaveEmbed?.description || botConfig.welcome?.defaultGoodbyeMessage || '{user} has left the server.',
                        formatData
                    );
                    await channel.send({
                        content: welcomeConfig?.goodbyePing ? `<@${user.id}> ${goodbyeMessage}` : goodbyeMessage,
                        allowedMentions: welcomeConfig?.goodbyePing ? { users: [user.id] } : { parse: [] }
                    });
                } else {
                    await channel.send(buildGoodbyePayload({ member, config: welcomeConfig }));
                }
            }
        }

}
