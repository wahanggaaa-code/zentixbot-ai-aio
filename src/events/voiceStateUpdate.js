import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { handleMusicVoiceState } from '../services/music/musicVoiceState.js';
import { handleJoinToCreateVoiceState } from '../services/joinToCreateRuntime.js';

export default {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        // Music auto-pause must see every voice change, including bots and
        // guilds where Join to Create is not configured.
        if (client.config?.features?.music) {
            handleMusicVoiceState(client, oldState, newState).catch((error) => {
                logger.error('Music voice state handler error:', error);
            });
        }

        // Only channel changes; mute/deafen and stream changes are deliberately omitted.
        if (oldState.channelId !== newState.channelId && (newState.guild || oldState.guild) && !(newState.member || oldState.member)?.user?.bot) {
            const guild=newState.guild || oldState.guild, userId=newState.id || oldState.id;
            logEvent({client,guildId:guild.id,eventType:EVENT_TYPES.VOICE_MOVE,data:{title:'Perubahan voice',lines:[`Anggota: ${userId}`,`Dari: ${oldState.channelId || 'tidak di voice'}`,`Ke: ${newState.channelId || 'tidak di voice'}`],userId,channelIds:[oldState.channelId,newState.channelId].filter(Boolean)}}).catch(error=>logger.warn('Voice log gagal:',error));
        }

        try {
            await handleJoinToCreateVoiceState(client, oldState, newState);
        } catch (error) {
            const guildId = newState?.guild?.id ?? oldState?.guild?.id;
            // Nothing was half-written. Records are brought back in line by
            // the next event for the same channel or at the next startup.
            logger.error(`Join to Create failed to handle a voice event in guild ${guildId}:`, error);
        }
    }
};
