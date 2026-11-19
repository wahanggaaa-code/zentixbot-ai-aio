import { ChannelType, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { v2Message } from '../utils/componentsV2.js';

// A claim is never retried automatically, even after a timeout or ambiguous network failure.
export function createStudioDurableWorker({ client, queue, intervalMs = 5000, onError = () => {}, resumeFlow = null }) {
    let timer = null, current = null, stopped = true;
    async function runOne() {
        if (typeof client.isReady === 'function' && !client.isReady()) return;
        const guild = client.guilds?.cache?.get(client.homeGuildId);
        if (!guild || guild.id !== client.homeGuildId || !guild.members?.me) return;
        const job = await queue.claim();
        if (!job) return;
        if (job.kind === 'flow') {
            if (typeof resumeFlow !== 'function') { await queue.finish(job.id, job.token, 'failed'); return; }
            try {
                const outcome = await resumeFlow(guild, job);
                if (outcome !== 'paused') await queue.finish(job.id, job.token, 'done');
            } catch { await queue.finish(job.id, job.token, 'uncertain'); }
            return;
        }
        const channel = guild.channels?.cache?.get(job.payload.channelId);
        if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || !channel.permissionsFor?.(guild.members.me)?.has?.([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
            await queue.finish(job.id, job.token, 'failed'); return;
        }
        const payload = { ...v2Message([new TextDisplayBuilder().setContent(job.payload.message)]), allowedMentions: { parse: [], repliedUser: false } };
        let outcome;
        try { await channel.send(payload); outcome = 'done'; }
        catch { outcome = 'uncertain'; }
        await queue.finish(job.id, job.token, outcome);
    }
    function tick() {
        if (stopped || current) return current;
        current = runOne().catch(() => { try { onError(); } catch {} }).finally(() => { current = null; });
        return current;
    }
    return {
        start() { if (!stopped) return; stopped = false; timer = setInterval(tick, intervalMs); timer.unref?.(); tick(); },
        async stop() { stopped = true; if (timer) clearInterval(timer); timer = null; if (current) await current; },
        tick,
    };
}
